# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.0.0] - 2026-08-26

Fork of [ananddtyagi/webpage-screenshot-mcp](https://github.com/ananddtyagi/webpage-screenshot-mcp) with the following changes:

### Changed
- **Transport**: replaced stdio with **Streamable HTTP** (port 8200, configurable via `PORT` env).
  The server now exposes a stateless-over-HTTP MCP endpoint at `MCP_PATH` (default `/mcp`).
- **Session management**: one `StreamableHTTPServerTransport` per MCP session,
  stored in-memory keyed by `Mcp-Session-Id` header.
- **Browser**: uses system Chromium (`/usr/bin/chromium`) instead of Puppeteer-bundled download.
  Set `PUPPETEER_SKIP_DOWNLOAD=1` during install.

### Added
- Multi-stage **Dockerfile** (Node 22 bookworm-slim + Chromium from apt).
- `.dockerignore` for clean Docker builds.
- This `CHANGELOG.md`.
- `AGENTS.md` — development/deployment reference.

### Removed
- `StdioServerTransport` import (replaced by Streamable HTTP).
- `login-and-wait`, `clear-auth-cookies`, `signal-login-complete` tools (cookie-based auth removed for public use).
- `useSavedAuth`, `reuseAuthPage`, `visibleBrowser`, `useDefaultBrowser` parameters.
- All anti-detection / fingerprint spoofing code (navigator.webdriver, fake plugins, etc.).
- `--disable-web-security` Chromium flag.
- Cookie persistence (`~/.mcp-screenshot-cookies/`, `saveCookies`, `loadCookies`).
- Persistent browser page between tool calls.

### Added (security hardening)
- **Rate limiting**: 10 tool calls per minute per IP, returns HTTP 429 on excess.
- **URL blacklist**: blocks `localhost`, `127.*`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.169.254`, `fe80:*`, `metadata.google.internal`.
- **Browser idle timeout**: Chromium auto-closes after 5 minutes of inactivity.
- **Ephemeral pages**: each tool call creates and destroys its own page.
- **Protocol check**: only `http:` and `https:` URLs are accepted.

---

## [0.1.0] - 2026-08-26

Initial fork from upstream (commit `cad4a14`).

### Tools provided
- `screenshot-page` — full-page or viewport screenshot of any URL.
- `screenshot-element` — screenshot of a specific CSS-selected element.
- `login-and-wait` — open browser for manual login, save cookies.
- `clear-auth-cookies` — clear saved cookies.
- `signal-login-complete` — signal that login flow finished.
