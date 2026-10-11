# Rockett CAD — self-hosted parametric CAD
#
# Multi-stage build: dependencies → server and client builds → slim runtime.
# The runtime runs as a non-root user and stores all state under /data.

# ---------- build ----------
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
COPY plugin-api/package.json plugin-api/package.json
COPY modules/cam/package.json modules/cam/package.json
COPY modules/kicad/package.json modules/kicad/package.json
COPY modules/elec/package.json modules/elec/package.json
COPY modules/measure/package.json modules/measure/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS server
COPY shared shared
COPY plugin-api plugin-api
COPY modules modules
COPY server server
RUN npm run build --workspace server

FROM deps AS client
COPY shared shared
COPY plugin-api plugin-api
COPY modules modules
COPY client client
RUN npm run build --workspace client

FROM deps AS notices
COPY THIRD-PARTY-NOTICES.md ./
COPY scripts/check-notices.sh scripts/

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
COPY plugin-api/package.json plugin-api/package.json
COPY modules/cam/package.json modules/cam/package.json
COPY modules/kicad/package.json modules/kicad/package.json
COPY modules/elec/package.json modules/elec/package.json
COPY modules/measure/package.json modules/measure/package.json
RUN npm ci --omit=dev --workspace server --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force
COPY THIRD-PARTY-NOTICES.md ./
RUN --mount=type=bind,from=notices,source=/app,target=/build \
  sh /build/scripts/check-notices.sh --collect /app/licences

COPY --from=server /app/server/dist/*.mjs /app/server/dist/blend.wasm ./
COPY modules/elec/LICENSE elec/LICENSE
COPY modules/kicad/LICENSE kicad/LICENSE
COPY modules/measure/LICENSE measure/LICENSE
COPY --from=client /app/client/dist client/dist

# Non-root user; /data is the single persistent volume.
RUN groupadd -r rockett && useradd -r -g rockett rockett \
  && mkdir -p /data && chown rockett:rockett /data
USER rockett
VOLUME /data
EXPOSE $ROCKETT_PORT

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:$ROCKETT_PORT/api/health',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
