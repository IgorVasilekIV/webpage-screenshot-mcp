# Webpage Screenshot MCP Server

Fork of [ananddtyagi/webpage-screenshot-mcp](https://github.com/ananddtyagi/webpage-screenshot-mcp) with the following changes:

- **Streamable HTTP transport** instead of stdio — the server runs as a standalone HTTP service
- **Docker support** with Chromium bundled inside the image
- **System Chromium** — uses OS-installed Chromium instead of Puppeteer's bundled download
- **Public-facing security hardening** — rate limiting, URL blacklist, no cookie persistence, no fingerprint spoofing

An MCP (Model Context Protocol) server that captures screenshots of web pages using Puppeteer. This server allows AI agents to visually verify web applications and see their progress when generating web apps.

![Screen Recording May 27 2025 (2)](https://github.com/user-attachments/assets/9f186ec4-5a5c-449b-9a30-a5ec0cdba695)


## Features

- **Full page screenshots**: Capture entire web pages or just the viewport
- **Element screenshots**: Target specific elements using CSS selectors
- **Multiple formats**: Support for PNG, JPEG, and WebP formats
- **Customizable options**: Set viewport size, image quality, wait conditions, and delays
- **Base64 encoding**: Returns screenshots as base64 encoded images for easy integration
- **Streamable HTTP transport**: Host as a remote MCP server over HTTP
- **Rate limiting**: 10 tool calls per minute per IP
- **URL blacklist**: Blocks private networks, loopback, and cloud metadata endpoints
- **Browser auto-cleanup**: Idle Chromium closes after 5 minutes
- **Stateless**: No cookie persistence, ephemeral pages per call

## Installation

### Docker (recommended)

```bash
git clone https://github.com/IgorVasilekIV/webpage-screenshot-mcp.git
cd webpage-screenshot-mcp
docker build -t webpage-screenshot-mcp .
docker run -d \
  --name mcp-screenshot \
  --restart unless-stopped \
  -p 127.0.0.1:8200:8200 \
  --memory=1g \
  --cpus=1.0 \
  --shm-size=512m \
  webpage-screenshot-mcp
```

### Without Docker

Requires system Chromium (`/usr/bin/chromium`).

```bash
git clone https://github.com/IgorVasilekIV/webpage-screenshot-mcp.git
cd webpage-screenshot-mcp
PUPPETEER_SKIP_DOWNLOAD=1 npm install
npm run build
PORT=8200 PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node dist/index.js
```

The server listens on `http://0.0.0.0:8200/mcp` (Streamable HTTP).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8200` | HTTP listen port |
| `MCP_PATH` | `/mcp` | URL path for the MCP endpoint |
| `PUPPETEER_EXECUTABLE_PATH` | — | Path to Chromium/Chrome binary |
| `PUPPETEER_SKIP_DOWNLOAD` | `1` | Skip Puppeteer's bundled browser download |

### Adding to Claude or Cursor

Since this server uses Streamable HTTP, add it as a remote MCP server pointing to `http://your-host:8200/mcp` instead of a local stdio command.

## Usage

### Tools

This MCP server provides two tools:

#### 1. screenshot-page

Captures a screenshot of a given URL and returns it as base64 encoded image.

```json
{
  "url": "https://example.com/dashboard",
  "fullPage": true,
  "width": 1920,
  "height": 1080,
  "format": "png",
  "quality": 80,
  "waitFor": "networkidle2",
  "delay": 500
}
```

- `url` (required): The URL of the webpage to screenshot
- `fullPage` (optional): Whether to capture the full page or just the viewport (default: true)
- `width` (optional): Viewport width in pixels (default: 1920)
- `height` (optional): Viewport height in pixels (default: 1080)
- `format` (optional): Image format - "png", "jpeg", or "webp" (default: "png")
- `quality` (optional): Quality of the image (0-100), only applicable for jpeg and webp
- `waitFor` (optional): When to consider the page loaded - "load", "domcontentloaded", "networkidle0", or "networkidle2" (default: "networkidle2")
- `delay` (optional): Additional delay in milliseconds after page load (default: 0)

#### 2. screenshot-element

Captures a screenshot of a specific element on a webpage using a CSS selector.

```json
{
  "url": "https://example.com/dashboard",
  "selector": ".user-profile",
  "waitForSelector": true,
  "format": "png",
  "quality": 80,
  "padding": 10
}
```

- `url` (required): The URL of the webpage
- `selector` (required): CSS selector for the element to screenshot
- `waitForSelector` (optional): Whether to wait for the selector to appear (default: true)
- `format` (optional): Image format - "png", "jpeg", or "webp" (default: "png")
- `quality` (optional): Quality of the image (0-100), only applicable for jpeg and webp
- `padding` (optional): Padding around the element in pixels (default: 0)

## Headless vs. Visible Mode

- **Headless mode** (default): Faster and suitable for automated workflows.
- **Visible mode**: Not currently supported in this fork (removed for security in public-facing mode).

## Platform Support

The default browser detection works on:

- **macOS**: Detects Chrome, Edge, and Safari
- **Windows**: Detects Chrome and Edge via registry or common installation paths
- **Linux**: Detects Chrome and Chromium via system commands

## Security

This fork includes security hardening for public deployment:

| Feature | Detail |
|---|---|
| **Rate limiting** | 10 tool calls/min/IP, returns 429 on excess |
| **URL blacklist** | Blocks `localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.169.254` (metadata), `fe80:*` |
| **Protocol** | Only `http:` and `https:` allowed |
| **Browser timeout** | Idle Chromium auto-closes after 5 minutes |
| **No cookies** | Stateless — no auth persistence between calls |
| **No CORS bypass** | `--disable-web-security` is NOT used |
| **No fingerprint spoofing** | No navigator.webdriver removal or plugin spoofing |
| **Ephemeral pages** | Each tool call creates and destroys its own page |

### Removed from upstream

- `login-and-wait` tool — requires cookie persistence, not suitable for public use
- `clear-auth-cookies` tool — no cookies to clear
- `signal-login-complete` tool — no persistent login flow
- `useSavedAuth`, `reuseAuthPage` parameters — no auth persistence
- `visibleBrowser`, `useDefaultBrowser` parameters — hidden mode only for public safety
- All anti-detection / fingerprint spoofing code

### Blocked URL patterns

The following addresses are rejected before any browser navigation:

- `localhost`, `127.*`, `::1`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`
- `169.254.169.254` (AWS/GCP/Azure metadata)
- `fe80:*` (IPv6 link-local)
- `metadata.google.internal`

## Troubleshooting

### Common Issues

1. **Rate limited**: Wait 60 seconds, the limit resets automatically.
2. **URL blocked**: The target is in a private/reserved range. This is by design.
3. **Browser timeout**: Chromium closes after 5 min idle. Next call restarts it automatically.

### Debugging

The server logs error messages to stderr. Check `docker logs -f mcp-screenshot` or console output.
