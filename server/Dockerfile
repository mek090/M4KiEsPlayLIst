# Multi-stage build: build client + server, then ship one slim runtime image.
#
# Build context is the repo root (the directory containing this server/ folder
# and the PWA client at the same level).

FROM node:20-slim AS client-builder
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:20-slim AS server-builder
WORKDIR /app/server
COPY server/package*.json server/tsconfig.json ./
RUN npm install
COPY server/src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# yt-dlp resolves YouTube URLs to direct audio streams (bypassing the embed
# restrictions that affect official music videos). The static linux binary
# from upstream is the easiest path; no Python dependency, updated frequently.
# When YouTube changes its player script, rebuild this image to refresh the
# binary, or `docker exec` and run `yt-dlp -U`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
       -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev && npm cache clean --force
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/dist ./dist
ENV STATIC_DIR=/app/dist
WORKDIR /app/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
