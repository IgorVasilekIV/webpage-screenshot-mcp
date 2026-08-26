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

---

## [0.1.0] - 2026-08-26

Initial fork from upstream (commit `cad4a14`).

### Tools provided
- `screenshot-page` — full-page or viewport screenshot of any URL.
- `screenshot-element` — screenshot of a specific CSS-selected element.
- `login-and-wait` — open browser for manual login, save cookies.
- `clear-auth-cookies` — clear saved cookies.
- `signal-login-complete` — signal that login flow finished.
