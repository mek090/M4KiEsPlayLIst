# Multi-stage build: PWA client + Fastify server + bgutil PO-token provider,
# all shipped in ONE image so a single Render/Fly web service runs everything.
#
# Why the PO-token provider: cloud datacenter IPs (Render/Fly/AWS/...) trip
# YouTube's "Sign in to confirm you're not a bot" check. Instead of uploading
# browser cookies, we run the bgutil provider in-container; yt-dlp's bundled
# plugin fetches a proof-of-origin token from it (127.0.0.1:4416) so yt-dlp
# looks legitimate — NO login, NO cookies. (Cookies still work as a fallback
# via /etc/secrets/yt-cookies.txt — see server/src/youtube.ts.)
#
# Build context is the repo root (the directory containing this server/ folder
# and the PWA client at the same level).

# --- 1. Build the PWA client  (-> /app/dist) ---
FROM node:20-slim AS client-builder
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
RUN npm install
COPY public ./public
COPY src ./src
RUN npm run build

# --- 2. Build the server  (-> /app/server/dist) ---
FROM node:20-slim AS server-builder
WORKDIR /app/server
COPY server/package*.json server/tsconfig.json ./
RUN npm install
COPY server/src ./src
RUN npm run build

# --- 3. Final image: based on the prebuilt bgutil provider so its native
#        canvas/jsdom deps come pre-working. The provider lives at /app
#        (build/main.js + node_modules); we layer yt-dlp + our app on top. ---
FROM brainicism/bgutil-ytdlp-pot-provider:1.3.1-node
USER root
ENV NODE_ENV=production
# yt-dlp (spawned by our server) looks for plugins under $HOME/.config/yt-dlp/plugins
ENV HOME=/root

# yt-dlp static binary + the bgutil yt-dlp plugin. The plugin (a .zip dropped in
# the plugins dir, per the provider's docs) makes yt-dlp request a PO token from
# the local provider. yt-dlp >= 2025.05.22 is required for the GetPOT framework;
# the latest release satisfies that.
ARG BGUTIL_VERSION=1.3.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
       -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && mkdir -p /root/.config/yt-dlp/plugins \
    && curl -L "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
       -o /root/.config/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip \
    && rm -rf /var/lib/apt/lists/*

# Our server's runtime deps live under /app/server, separate from the
# provider's own /app/node_modules.
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev && npm cache clean --force
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/dist ./dist
ENV STATIC_DIR=/app/dist

EXPOSE 3000
# Run the PO-token provider in the background (its node_modules resolve relative
# to /app/build/main.js regardless of cwd), then hand off to our server as PID 1.
ENTRYPOINT ["/bin/sh", "-c", "node /app/build/main.js & exec node /app/server/dist/index.js"]
