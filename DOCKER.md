# Deployment (Docker / Unraid)

Rockett CAD ships as a single container: Node 22 serving the API and the
built client, with the OpenCascade kernel embedded as WebAssembly (no native
dependencies). All persistent state lives under **one volume: `/data`**.

## Docker Compose

```bash
ROCKETT_COMMIT=$(git rev-parse HEAD) docker compose up -d --build
# → http://127.0.0.1:8788
```

`docker-compose.yml` builds the image locally and keeps `/data` in a named
volume. It publishes on `127.0.0.1` unless `ROCKETT_BIND` says otherwise;
the header of the file lists every variable.

### Several instances on one host

`-p` names the instance, so containers, volumes and data stay separate:

```bash
# dev: rebuild from the checkout you are working in
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_HOST_PORT="$DEV_PORT" ROCKETT_TAG=dev \
ROCKETT_COMMIT=$(git rev-parse HEAD) \
  docker compose -p rockett-cad-dev up -d --build

# prod: build a revision-tagged image from a clean deploy checkout
REV=$(git rev-parse --short HEAD)
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_TAG=$REV ROCKETT_COMMIT=$(git rev-parse HEAD) \
  docker compose -p rockett-cad-prod up -d --build
```

Roll prod back by rerunning `up -d --no-build` with the previous `ROCKETT_TAG`;
keep that image until the new one is trusted. Confirm what is running with
`curl http://<host>:<port>/api/health`, whose `commit` must match the intended
revision.

Back up an instance's data with
`docker compose -p rockett-cad-prod exec -T rockett-cad tar czf - -C /data . > rockett-prod.tgz`

## Manual

```bash
docker build -t rockett-cad:latest .
docker run -d --name rockett-cad \
  -p 8788:8788 \
  -v /path/to/appdata/rockett-cad:/data \
  --restart unless-stopped \
  rockett-cad:latest
```

## Unraid

1. Build the image on the server (or push it to a registry you control):
   `docker build -t rockett-cad:latest .`
2. Copy `docker/unraid-rockett-cad.xml` to
   `/boot/config/plugins/dockerMan/templates-user/` on the Unraid box.
3. Add the container from the template. Defaults: WebUI port `8788`, data path
   `/mnt/user/appdata/rockett-cad`.

## Persistent layout (`/data`)

```
/data
└── projects/
    └── {projectId}/
        ├── document.json   # the parametric document (full history)
        ├── assets/         # uploaded reference images
        └── exports/        # server-retained exports (opt-in per export)
```

Documents are written atomically (tmp file + rename), so a crash or container
kill never corrupts a project. **The container is stateless outside `/data`**
— recreating it (upgrades, host moves) loses nothing; this is verified by the
persistence tests and was smoke-tested against a live container.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROCKETT_PORT` | `8788` | HTTP port inside the container |
| `DATA_DIR` | `/data` | Persistent root |
| `ROCKETT_COMMIT` | empty | Git revision reported by `/api/health` (build arg) |

## Security

- Runs as the non-root `rockett` user.
- No outbound network use; no cloud services; fully offline-capable.
- Single-user by design for v1 — put it behind your reverse proxy
  (basic auth, Authelia, Cloudflare Access, …) if it is reachable beyond your
  LAN. The auth layer is intentionally separable from the CAD logic
  (see ARCHITECTURE.md).
- Healthcheck hits `/api/health` (60 s start period — the WASM kernel takes a
  few seconds to load on first boot).
