#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { randomUUID } from "crypto";
import puppeteer, { Browser, Page } from 'puppeteer';
import { z } from 'zod';

// ─── Rate Limiter ────────────────────────────────────────────────────────────

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const rateLimiter = {
    store: new Map<string, RateLimitEntry>(),
    windowMs: 60_000,       // 1 minute window
    maxRequests: 10,        // max 10 tool calls per minute per IP

    allow(ip: string): boolean {
        const now = Date.now();
        const entry = this.store.get(ip);

        if (!entry || now > entry.resetAt) {
            this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
            return true;
        }

        if (entry.count >= this.maxRequests) {
            return false;
        }

        entry.count++;
        return true;
    },

    cleanup() {
        const now = Date.now();
        for (const [ip, entry] of this.store) {
            if (now > entry.resetAt) {
                this.store.delete(ip);
            }
        }
    },
};

// Cleanup stale entries every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60_000).unref();

// ─── URL Blacklist ───────────────────────────────────────────────────────────

const BLOCKED_URL_PATTERNS: Array<{ test: (url: URL) => boolean; reason: string }> = [
    // Loopback
    {
        test: (u) => u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1' || u.hostname === '[::1]',
        reason: 'loopback address blocked',
    },
    // Link-local / metadata
    {
        test: (u) => u.hostname === '169.254.169.254',
        reason: 'cloud metadata endpoint blocked',
    },
    // Private 10.x.x.x
    {
        test: (u) => /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname),
        reason: 'private network (10.x) blocked',
    },
    // Private 172.16-31.x.x
    {
        test: (u) => /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(u.hostname),
        reason: 'private network (172.16-31.x) blocked',
    },
    // Private 192.168.x.x
    {
        test: (u) => /^192\.168\.\d{1,3}\.\d{1,3}$/.test(u.hostname),
        reason: 'private network (192.168.x) blocked',
    },
    // IPv6 link-local
    {
        test: (u) => u.hostname.startsWith('fe80'),
        reason: 'IPv6 link-local blocked',
    },
    // AWS/GCP/Azure metadata
    {
        test: (u) => u.hostname === 'metadata.google.internal' || u.hostname === 'metadata AzGuestConfig/instance',
        reason: 'cloud metadata endpoint blocked',
    },
];

function assertUrlAllowed(urlString: string): void {
    let parsed: URL;
    try {
        parsed = new URL(urlString);
    } catch {
        throw new Error(`Invalid URL: ${urlString}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Protocol "${parsed.protocol}" not allowed. Use http: or https:.`);
    }

    for (const rule of BLOCKED_URL_PATTERNS) {
        if (rule.test(parsed)) {
            throw new Error(`URL blocked: ${rule.reason} (${parsed.hostname})`);
        }
    }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
    name: "screenshot-page",
    version: "1.0.0",
});

let browser: Browser | null = null;
const BROWSER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes idle → close
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;

function resetBrowserTimer() {
    if (browserIdleTimer) clearTimeout(browserIdleTimer);
    browserIdleTimer = setTimeout(async () => {
        if (browser) {
            try { await browser.close(); } catch {}
            browser = null;
        }
    }, BROWSER_TIMEOUT_MS);
    browserIdleTimer.unref();
}

async function initBrowser(headless: boolean = true): Promise<Browser> {
    if (browser) {
        const isHeadless = browser.process()?.spawnargs?.includes('--headless') ?? true;
        if (isHeadless !== headless) {
            try { await browser.close(); } catch {}
            browser = null;
        }
    }

    if (!browser) {
        browser = await puppeteer.launch({
            headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                '--disable-ipc-flooding-protection',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--disable-features=TranslateUI',
                '--disable-features=BlinkGenPropertyTrees',
                '--disable-client-side-phishing-detection',
                headless ? '--disable-gpu' : '',
            ].filter(Boolean),
        });

        resetBrowserTimer();
    }

    resetBrowserTimer();
    return browser;
}

async function cleanupBrowser() {
    if (browserIdleTimer) {
        clearTimeout(browserIdleTimer);
        browserIdleTimer = null;
    }
    if (browser) {
        try { await browser.close(); } catch {}
        browser = null;
    }
}

process.on('exit', () => { try { browser?.close().catch(() => {}); } catch {} });
process.on('SIGINT', async () => { await cleanupBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { await cleanupBrowser(); process.exit(0); });

// ─── Tool: screenshot-page ───────────────────────────────────────────────────

server.tool(
    "screenshot-page",
    "Captures a screenshot of a given URL and returns it as base64 encoded image.",
    {
        url: z.string().url().describe("The URL of the webpage to screenshot"),
        fullPage: z.boolean().optional().default(true).describe("Whether to capture the full page or just the viewport"),
        width: z.number().optional().default(1920).describe("Viewport width in pixels"),
        height: z.number().optional().default(1080).describe("Viewport height in pixels"),
        format: z.enum(['png', 'jpeg', 'webp']).optional().default('png').describe("Image format for the screenshot"),
        quality: z.number().min(0).max(100).optional().describe("Quality of the image (0-100), only for jpeg/webp"),
        waitFor: z.enum(['load', 'domcontentloaded', 'networkidle0', 'networkidle2']).optional().default('networkidle2').describe("When to consider the page loaded"),
        delay: z.number().optional().default(0).describe("Additional delay in milliseconds after page load"),
    },
    async ({ url, fullPage, width, height, format, quality, waitFor, delay }) => {
        assertUrlAllowed(url);

        let page: Page | null = null;
        try {
            const browserInstance = await initBrowser(true);
            page = await browserInstance.newPage();

            await page.setViewport({ width, height });
            await page.setUserAgent(
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            await page.goto(url, { waitUntil: waitFor as any, timeout: 30_000 });

            if (delay > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay));
            }

            const screenshotOptions: any = {
                encoding: 'base64',
                fullPage,
                type: format,
            };
            if ((format === 'jpeg' || format === 'webp') && quality !== undefined) {
                screenshotOptions.quality = quality;
            }

            const screenshot = await page.screenshot(screenshotOptions) as string;
            const pageTitle = await page.title();
            const finalUrl = page.url();

            return {
                content: [
                    {
                        type: "text",
                        text: `Screenshot captured!\n\nPage Title: ${pageTitle}\nFinal URL: ${finalUrl}\nFormat: ${format}\nDimensions: ${width}x${height}\nFull Page: ${fullPage}`,
                    },
                    {
                        type: "image",
                        data: screenshot,
                        mimeType: `image/${format}`,
                    },
                ],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                isError: true,
                content: [{ type: "text", text: `Error capturing screenshot: ${errorMessage}` }],
            };
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }
);

// ─── Tool: screenshot-element ────────────────────────────────────────────────

server.tool(
    "screenshot-element",
    "Captures a screenshot of a specific element on a webpage using a CSS selector",
    {
        url: z.string().url().describe("The URL of the webpage"),
        selector: z.string().describe("CSS selector for the element to screenshot"),
        waitForSelector: z.boolean().optional().default(true).describe("Whether to wait for the selector to appear"),
        format: z.enum(['png', 'jpeg', 'webp']).optional().default('png').describe("Image format for the screenshot"),
        quality: z.number().min(0).max(100).optional().describe("Quality of the image (0-100), only for jpeg/webp"),
        padding: z.number().optional().default(0).describe("Padding around the element in pixels"),
    },
    async ({ url, selector, waitForSelector, format, quality, padding }) => {
        assertUrlAllowed(url);

        let page: Page | null = null;
        try {
            const browserInstance = await initBrowser(true);
            page = await browserInstance.newPage();

            await page.setViewport({ width: 1920, height: 1080 });
            await page.setUserAgent(
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });

            if (waitForSelector) {
                await page.waitForSelector(selector, { timeout: 10_000 });
            }

            const element = await page.$(selector);
            if (!element) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Element not found with selector: ${selector}` }],
                };
            }

            if (padding > 0) {
                await page.evaluate((sel, pad) => {
                    const el = document.querySelector(sel);
                    if (el) (el as HTMLElement).style.padding = `${pad}px`;
                }, selector, padding);
            }

            const screenshotOptions: any = { encoding: 'base64', type: format };
            if ((format === 'jpeg' || format === 'webp') && quality !== undefined) {
                screenshotOptions.quality = quality;
            }

            const screenshot = await element.screenshot(screenshotOptions) as string;

            return {
                content: [
                    {
                        type: "text",
                        text: `Element screenshot captured!\n\nURL: ${url}\nSelector: ${selector}\nFormat: ${format}`,
                    },
                    {
                        type: "image",
                        data: screenshot,
                        mimeType: `image/${format}`,
                    },
                ],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                isError: true,
                content: [{ type: "text", text: `Error capturing element screenshot: ${errorMessage}` }],
            };
        } finally {
            if (page) await page.close().catch(() => {});
        }
    }
);

// ─── HTTP Server + Rate Limiting ─────────────────────────────────────────────

const PORT = Number(process.env.PORT || 8200);
const PATHNAME = process.env.MCP_PATH || "/mcp";
const transports = new Map();

function getClientIp(req: http.IncomingMessage): string {
    const xfwd = req.headers['x-forwarded-for'];
    if (typeof xfwd === 'string') return xfwd.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

async function main() {
    const httpServer = http.createServer(async (req, res) => {
        const clientIp = getClientIp(req);
        const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

        if (url.pathname !== PATHNAME) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }

        // Rate limit
        if (!rateLimiter.allow(clientIp)) {
            res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
            res.end(JSON.stringify({ error: "Rate limit exceeded. Try again later." }));
            return;
        }

        // CORS — restricted: no wildcard, accept only same-origin or configured origins
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID");
        res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const sessionId = req.headers["mcp-session-id"];
        let transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;

        if (!transport) {
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                enableJsonResponse: true,
                onsessioninitialized: (sid) => {
                    transports.set(sid, transport);
                },
            });
            await server.connect(transport);
            transport.onclose = () => {
                transports.delete(transport.sessionId ?? sessionId);
            };
        }

        if (req.method === "GET" || req.method === "DELETE") {
            transport.handleRequest(req, res);
        } else if (req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const parsed = body ? JSON.parse(body) : undefined;
                    transport.handleRequest(req, res, parsed);
                } catch (e) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON body" }));
                }
            });
        } else {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
        }
    });

    httpServer.listen(PORT, "0.0.0.0", () => {
        console.error(`Screenshot MCP Server running on http://0.0.0.0:${PORT}${PATHNAME}`);
    });

    const shutdown = async () => {
        await cleanupBrowser();
        httpServer.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
