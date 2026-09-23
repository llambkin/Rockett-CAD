# Rockett CAD — self-hosted parametric CAD
#
# Multi-stage build: workspace build → slim runtime.
# The runtime runs as a non-root user and stores all state under /data.

# ---------- build ----------
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY shared shared
COPY server server
COPY client client
RUN npm run build --workspace server \
  && npm run build --workspace client

# ---------- runtime ----------
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS runtime
# Reported by /api/health; pass --build-arg ROCKETT_COMMIT=$(git rev-parse HEAD)
# and --build-arg ROCKETT_DESCRIBE=$(git describe --tags --always --dirty).
ARG ROCKETT_COMMIT=
ARG ROCKETT_DESCRIBE=
LABEL org.opencontainers.image.revision=$ROCKETT_COMMIT
ENV ROCKETT_COMMIT=$ROCKETT_COMMIT \
    ROCKETT_DESCRIBE=$ROCKETT_DESCRIBE \
    NODE_ENV=production \
    DATA_DIR=/data \
    ROCKETT_PORT=8788
WORKDIR /app

# Runtime dependencies only (the server bundle externalises these),
# installed from the same lockfile as the build.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace server --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

COPY --from=build /app/server/dist/server.js server.mjs
COPY --from=build /app/client/dist client/dist

# Non-root user; /data is the single persistent volume.
RUN groupadd -r rockett && useradd -r -g rockett rockett \
  && mkdir -p /data && chown rockett:rockett /data
USER rockett
VOLUME /data
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
