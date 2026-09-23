# Docker deployment

Rockett CAD ships as a single container: Node 24 serving the API and the
built client, with the OpenCascade kernel embedded as WebAssembly (no native
dependencies). All persistent state lives under **one volume: `/data`**.

## Compose

```bash
ROCKETT_COMMIT=$(git rev-parse HEAD) \
ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose up -d --build
# → http://127.0.0.1:8788
```

`docker-compose.yml` builds the image locally and keeps `/data` in a named
volume. It publishes on `127.0.0.1` unless `ROCKETT_BIND` says otherwise;
the header of the file lists every variable.

### Several instances on one host

`-p` names the instance, so containers, volumes and data stay separate. Both
instances run `rockett-cad:<tag>` images from the same engine.

Prod never builds. Dev builds one image, tagged with the short SHA of the
commit it bakes in, and prod runs that image once dev has verified it.

```bash
# dev: build and run the image from a clean checkout
COMMIT=$(git rev-parse HEAD)
REV=$(git rev-parse --short "$COMMIT")
git diff --quiet HEAD &&
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_HOST_PORT="$DEV_PORT" ROCKETT_TAG=$REV \
ROCKETT_COMMIT=$COMMIT ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose -p rockett-cad-dev up -d --build

# prod: promote the image dev verified
docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  rockett-cad:$REV
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_TAG=$REV \
  docker compose -p rockett-cad-prod up -d --no-build
```

`git diff --quiet HEAD` refuses a tree that `describe` would mark `-dirty`,
so the tag, the image revision label and `/api/health` all name `COMMIT`.
`REV` uses the same abbreviation as `describe`, so the corner label
`v0.1.0-4-g1a2b3c4` runs as `rockett-cad:1a2b3c4`; on a tagged commit the
label shows the tag and its tooltip the commit. Before promoting,
`docker image inspect` must print `COMMIT`. If prod uses another engine, move
the image there with `docker save` and `docker load`; do not rebuild it.

Roll prod back by rerunning the prod command with the previous `REV`; keep
that image until the new one is trusted. Confirm what is running with
`curl http://<host>:<port>/api/health`, whose `commit` must match the intended
revision. The UI shows the same build in its bottom-right corner: `describe`
when set, else the version and short commit, else `dev`.

Back up an instance's data with
`docker compose -p rockett-cad-prod exec -T rockett-cad tar czf - -C /data . > rockett-prod.tgz`

## Manual

```bash
docker build -t rockett-cad:latest \
  --build-arg ROCKETT_COMMIT=$(git rev-parse HEAD) \
  --build-arg ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) .
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
kill never corrupts a project. **The container is stateless outside `/data`**.
Recreating it (upgrades, host moves) loses nothing; this is verified by the
persistence tests and was smoke-tested against a live container.

## Environment

| Variable           | Default | Purpose                                                                      |
| ------------------ | ------- | ---------------------------------------------------------------------------- |
| `ROCKETT_PORT`     | `8788`  | HTTP port inside the container                                               |
| `DATA_DIR`         | `/data` | Persistent root                                                              |
| `ROCKETT_COMMIT`   | empty   | Git revision reported by `/api/health` (build arg)                           |
| `ROCKETT_DESCRIBE` | empty   | `git describe --tags --always --dirty` reported by `/api/health` (build arg) |

## Security

- Runs as the non-root `rockett` user. `/app` is root-owned, so the app
  cannot change its own code. `/data` is the only path it writes; it needs no
  ephemeral writable path, and `--read-only` with the `/data` volume serves.
  The base image's `/tmp` stays world-writable unless the root is read-only.
- No outbound network use; no cloud services; fully offline-capable.
- Single-user by design for v1. Put it behind your reverse proxy
  (basic auth, Authelia, Cloudflare Access, …) if it is reachable beyond your
  LAN. The auth layer is intentionally separable from the CAD logic
  (see ARCHITECTURE.md).
- Healthcheck hits `/api/health` (60 s start period, because the WASM
  kernel takes a few seconds to load on first boot). A long regeneration
  blocks the event loop, so each probe waits 10 s and the container turns
  unhealthy only after 10 failed probes in a row, 30 s apart: about five
  minutes.
