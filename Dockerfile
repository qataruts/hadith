# الجامع — Hadith Knowledge Graph, server image for CapRover / any Docker host.
#
# Slim (~400 MB): server + dashboard + monlite. The two databases (~4.5 GB) are
# NOT baked in — the container downloads them from the public Hugging Face
# dataset into /data on first boot (resumable), so they survive redeploys on a
# persistent volume and can be updated without rebuilding the image.
#
#   docker run -p 8077:80 -v jami-data:/data -e GEMINI_API_KEY=... emadjumaah/hadith
#
# GEMINI_API_KEY is optional (semantic search + chat); the rest works without it.

# ---- server runtime deps (flat, production) ----------------------------------
FROM node:22-slim AS deps
WORKDIR /app/js
COPY js/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- dashboard build ----------------------------------------------------------
FROM node:22-slim AS ui
WORKDIR /app/dash
COPY js/apps/dashboard/package.json ./
RUN npm install --no-audit --no-fund
COPY js/apps/dashboard ./
RUN npm run build

# ---- runtime ------------------------------------------------------------------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=80 DATA_DIR=/data
COPY --from=deps /app/js/node_modules ./js/node_modules
COPY js/package.json ./js/
COPY js/server ./js/server
COPY js/shared ./js/shared
COPY --from=ui /app/dash/dist ./js/apps/dashboard/dist
COPY docker/entrypoint.mjs ./docker/entrypoint.mjs
RUN mkdir -p /data
VOLUME /data
EXPOSE 80
CMD ["node", "docker/entrypoint.mjs"]
