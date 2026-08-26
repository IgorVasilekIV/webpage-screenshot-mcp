FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN PUPPETEER_SKIP_DOWNLOAD=1 npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- runtime ---
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r mcp && useradd -r -g mcp -m mcp

WORKDIR /home/mcp/app
COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ ./node_modules/

ENV NODE_ENV=production
ENV PORT=8200
ENV MCP_PATH=/mcp
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_NO_SANDBOX=1

USER mcp
EXPOSE 8200

CMD ["node", "dist/index.js"]
