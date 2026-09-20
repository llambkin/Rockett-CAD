# Deployment (Docker / Unraid)

Rockett CAD ships as a single container: Node 20 serving the API and the
built client, with the OpenCascade kernel embedded as WebAssembly (no native
dependencies). All persistent state lives under **one volume: `/data`**.

## Docker Compose

```bash
docker compose up -d
# → http://localhost:8788
```

`docker-compose.yml` builds the image locally and bind-mounts `./data`.

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

## Security

- Runs as the non-root `rockett` user.
- No outbound network use; no cloud services; fully offline-capable.
- Single-user by design for v1 — put it behind your reverse proxy
  (basic auth, Authelia, Cloudflare Access, …) if it is reachable beyond your
  LAN. The auth layer is intentionally separable from the CAD logic
  (see ARCHITECTURE.md).
- Healthcheck hits `/api/health` (60 s start period — the WASM kernel takes a
  few seconds to load on first boot).
