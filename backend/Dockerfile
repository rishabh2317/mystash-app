# Render root directory / Docker build context: backend
# Runtime secrets must be supplied by Render, never as build arguments or COPYs.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    INGEST_WORKER_EMBEDDED=false \
    PATH="/opt/video-tools/bin:${PATH}"
# Match the installed local yt-dlp version; keep existing extraction commands.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
    && python3 -m venv /opt/video-tools \
    && /opt/video-tools/bin/pip install --no-cache-dir "yt-dlp==2026.7.4" \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node config/shopping.json ./config/shopping.json
USER node
# Render injects PORT; index.ts already binds 0.0.0.0.
# Override CMD per worker service; do not use this image to run migrations.
CMD ["node", "dist/index.js"]
