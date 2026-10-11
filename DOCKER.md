# Docker deployment

One container: Node 24 serves the API and the built client, with the
OpenCascade kernel as WebAssembly. All state lives in **one volume:
`/data`**. The container is stateless outside it.

## Compose

```bash
ROCKETT_ALLOWED_ORIGINS=http://127.0.0.1:8788 \
ROCKETT_COOKIE_SECURE=false \
ROCKETT_COMMIT=$(git rev-parse HEAD) \
ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose up -d --build
```

Supply `ROCKETT_SETUP_TOKEN` before the first run; see Security.
`docker-compose.yml` lists its variables in its header.

Gotchas:

- `ROCKETT_ALLOWED_ORIGINS` is the browser-facing origin, with its port if
  the URL has one. Behind a TLS proxy that is `https://...`, even if the
  proxy talks HTTP to the container.
- Plain HTTP needs `ROCKETT_COOKIE_SECURE=false`, or the browser drops the
  session cookie.
- Behind a proxy, set `ROCKETT_TRUST_PROXY` (`1`, or the proxy's addresses)
  so sign-in rate limits count each client, not the proxy. Leave it unset
  without a proxy.

### Dev and prod on one host

`-p` names the instance, so containers and volumes stay apart. Prod never
builds: dev builds an image tagged with the commit's short SHA, and prod runs
that image once dev has verified it.

```bash
# dev: build and run the image from a clean checkout
COMMIT=$(git rev-parse HEAD)
REV=$(git rev-parse --short "$COMMIT")
git diff --quiet HEAD &&
ROCKETT_ALLOWED_ORIGINS="$DEV_ORIGIN" \
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_HOST_PORT="$DEV_PORT" ROCKETT_TAG=$REV \
ROCKETT_COMMIT=$COMMIT ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose -p rockett-cad-dev up -d --build

# prod: promote the image dev verified
docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  rockett-cad:$REV
ROCKETT_ALLOWED_ORIGINS="$PROD_ORIGIN" \
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_TAG=$REV \
  docker compose -p rockett-cad-prod up -d --no-build
```

- `git diff --quiet HEAD` refuses a dirty tree, so the tag, the image label
  and `/api/health` all name `COMMIT`.
- `docker image inspect` must print `COMMIT` before you promote.
- Another engine: move the image with `docker save` and `docker load`. Never
  rebuild it.
- Roll back by rerunning the prod command with the previous `REV`. Keep that
  image until the new one is trusted.
- `/api/health` returns the running `commit`.

Keep deployment values in your shell, outside this repository.

## Manual

```bash
docker build -t rockett-cad:latest \
  --build-arg ROCKETT_COMMIT=$(git rev-parse HEAD) \
  --build-arg ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) .
docker run -d --name rockett-cad \
  -p 127.0.0.1:8788:8788 \
  -e ROCKETT_ALLOWED_ORIGINS=http://127.0.0.1:8788 \
  -e ROCKETT_COOKIE_SECURE=false \
  -e ROCKETT_SETUP_TOKEN \
  -v /path/to/appdata/rockett-cad:/data \
  --restart unless-stopped \
  rockett-cad:latest
```

## Unraid

1. Build the image on the server, or push it to a registry you control.
2. Copy `docker/unraid-rockett-cad.xml` to
   `/boot/config/plugins/dockerMan/templates-user/`.
3. Add the container from the template. Set Allowed Origins. Set Setup Token
   for first-admin setup, then clear it and restart. Set Secure Cookie to
   `false` only for plain HTTP.

## Persistent layout (`/data`)

```
/data
├── backups/
│   ├── projects/{projectId}/
│   │   ├── v{schema}-{hash}/   # the project before a migration
│   │   │   ├── SHA256SUMS      # written last; the backup is complete once it exists
│   │   │   └── files/          # byte-for-byte copy of the project directory
│   │   ├── history1-{hash}/    # version 1 history files, before they moved into log.bin
│   │   └── history2-{hash}/    # version 2 log.bin, before features were stored once
│   └── {namespace}/v{version}-{hash}/  # same shape, for users/, folders/ and others
├── folders/folders.json        # folder tree and project placement
├── sessions/sessions.json      # sessions, stored as the SHA-256 of each token
├── settings/app.json           # app-wide settings
├── users/
│   ├── users.json              # accounts and password hashes
│   └── {userId}/
│       ├── settings.json
│       └── views/{projectId}.json  # the user's hidden items and camera
├── uploads/                    # imports and project files while they stream in
├── mesh-cache/                 # served meshes evicted from memory, {sha256}.rkm
└── projects/{projectId}/
    ├── project.json            # manifest: version and documents
    ├── documents/{projectId}.json  # the part document (full history)
    ├── documents/{assemblyId}.json # an assembly document
    ├── documents/{assemblyId}/history/log.bin  # that assembly's undo history
    ├── settings.json
    ├── temporary.json          # only on a temporary copy of a browser project: owner, touchedAt
    ├── thumbnail.png
    ├── blobs/                  # images and STEP, IGES, BREP sources, named by sha256
    ├── history/log.bin         # undo history, append-only
    └── exports/                # retained exports (opt-in)
```

Rules the code keeps, with their owner:

- Writes are atomic: `server/src/store/storage.ts`.
- A migration backs up the whole project before its first write, and a crash
  mid-migration restores from that backup. Other namespaces back up the same
  way: `backupNamespace` in `server/src/store/jsonStore.ts`.
- A crash mid-save leaves the old or the new generation:
  `server/src/store/historyStore.ts`.
- An invalid project, or one from a newer schema, stays listed and is never
  rewritten: `server/src/store/projectStore.ts`.
- Temporary projects get no backup and are swept after 24 hours idle:
  `server/src/store/projectStore.ts`.
- Backups are never pruned.

Treat every `/data` backup as credential material: `/data/users` holds
password hashes. `mesh-cache/` is cleared at start and refilled from
projects, so it is safe to delete and the backup leaves it out. Back up an
instance with:

```bash
docker compose -p rockett-cad-prod exec -T rockett-cad tar czf - --exclude=./mesh-cache -C /data . > rockett-prod.tgz
```

Restore a migration backup by hand:

1. Stop the container.
2. In the backup's `files/`, run `sha256sum -c ../SHA256SUMS`.
3. Replace the project directory with a copy of `files/`. Do not copy over
   it: a later `documents/{projectId}.json` wins over a restored
   `document.json`.

Undo a history move: stop the container, delete `history/log.bin`, and copy
the `history1-{hash}/files/history/` back into the project. Before running an
older build, restore `history/log.bin` from `history2-{hash}/files/history/`
the same way.

### Naming report

```bash
node scripts/naming-report.mjs <copy-of-data>
```

Lists projects still on naming version 1 and the mappings an upgrade would
stage (API.md, Naming upgrade). Run it from a checkout after `npm ci`. It
never writes. Exit 0 when all projects are on version 2, else 1.

## Environment

| Variable                   | Default            | Purpose                                                           |
| -------------------------- | ------------------ | ----------------------------------------------------------------- |
| `ROCKETT_ALLOWED_ORIGINS`  | required           | Comma-separated browser origins; other origins get 403 on writes  |
| `ROCKETT_SETUP_TOKEN`      | empty              | One-time first-admin token; remove after setup                    |
| `ROCKETT_COOKIE_SECURE`    | `true`             | `false` for plain HTTP                                            |
| `ROCKETT_TRUST_PROXY`      | unset              | Proxy hop count or addresses whose `X-Forwarded-For` is trusted   |
| `ROCKETT_CF_ACCESS_TEAM`   | unset              | Cloudflare Access team; with the audience, enables Access sign-in |
| `ROCKETT_CF_ACCESS_AUD`    | unset              | Cloudflare Access application audience                            |
| `ROCKETT_PORT`             | `8788`             | HTTP port inside the container                                    |
| `DATA_DIR`                 | `/data`            | Persistent root                                                   |
| `ROCKETT_MESH_CACHE_DIR`   | `/data/mesh-cache` | Served meshes evicted from memory, up to 1 GiB, cleared at start  |
| `ROCKETT_PLUGIN_DIR`       | `/data/plugins`    | Third-party plugin folders, loaded once an admin enables them     |
| `ROCKETT_COMMIT`           | empty              | Git revision for `/api/health` (build arg)                        |
| `ROCKETT_DESCRIBE`         | empty              | `git describe` output for `/api/health` (build arg)               |
| `ROCKETT_KERNEL`           | unset              | `inprocess` runs the kernel on the main thread                    |
| `ROCKETT_UPLOAD_MAX_MB`    | `1024`             | Largest import or project file upload written to `/data/uploads`  |
| `ROCKETT_IMPORT_BUDGET_MB` | `256`              | Largest import or project file read into memory; larger is 413    |

## Security

- Runs as the non-root `rockett` user. `/app` is root-owned; `/data` is the
  only path it writes, so `--read-only` with the `/data` volume works.
- Needs no outbound network, except Cloudflare Access key lookup when Access
  is on.
- First admin: generate a token with `openssl rand -hex 32`, supply it as
  `ROCKETT_SETUP_TOKEN`, start, and create the admin in the app.
  `GET /api/auth/status` then returns `{"setup":"done"}`. Remove the token,
  restart, and confirm it is gone without printing it:
  `docker compose -p <instance> exec rockett-cad sh -c 'test -z "$ROCKETT_SETUP_TOKEN"'`.
  Clear it from the Unraid template too.
- Sessions survive restarts; the store keeps only token hashes:
  `server/src/auth/sessions.ts`. A restart mid-TOTP-enrolment means
  starting enrolment again.
- Cloudflare Access: set both `ROCKETT_CF_ACCESS_TEAM` and
  `ROCKETT_CF_ACCESS_AUD`, and set the user's email on the Users page first.
  The Access email maps to an existing active account; the login form stays
  available: `server/src/auth/cfAccess.ts`.
- Forgotten password: stop the instance, then run
  `docker compose -p <instance> run --rm --no-deps -T rockett-cad node server.mjs reset-password <username>`.
  Send the new password on standard input, never as an argument. The reset
  turns off the account's TOTP. Restart afterward.
  Code: `server/src/auth/resetPassword.ts`.
- Healthcheck hits `/api/health` (30 s start period, above the kernel
  worker's boot time). The worker keeps health answering during a long
  regeneration (`server/src/kernel/workerKernel.ts`). The container turns
  unhealthy after about five minutes of failed probes; the Dockerfile
  `HEALTHCHECK` owns the numbers.
