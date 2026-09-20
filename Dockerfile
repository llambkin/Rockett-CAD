# Rockett CAD — self-hosted parametric CAD
#
# Multi-stage build: workspace build → slim runtime.
# The runtime runs as a non-root user and stores all state under /data.

# ---------- build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm install --no-audit --no-fund

COPY shared shared
COPY server server
COPY client client
RUN npm run build --workspace server \
  && npm run build --workspace client

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    ROCKETT_PORT=8788
WORKDIR /app

# Runtime dependencies only (the server bundle externalises these).
COPY docker/runtime-package.json package.json
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --from=build /app/server/dist/server.js server.js
COPY --from=build /app/client/dist client/dist

# Non-root user; /data is the single persistent volume.
RUN groupadd -r rockett && useradd -r -g rockett rockett \
  && mkdir -p /data && chown -R rockett:rockett /data /app
USER rockett
VOLUME /data
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
