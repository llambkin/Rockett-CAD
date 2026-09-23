# Rockett CAD

Team Rockett!

Prepare for trouble!
And make it double!

To protect the world from devastation!
To unite all peoples within our nation!

To denounce the evils of truth and love!
To extend our reach to the stars above!

Liam
Mark

Team Rocket blasts off at the speed of light!
Surrender now, or prepare to fight!

Self-hosted, browser-based **parametric CAD** for designing 3D-printable parts.
A deliberately simplified, self-hostable take on the parametric solid-modelling
portion of Fusion 360:

> **Sketch → constrain → feature → body → timeline → modify → regenerate → export**

Built on a real B-Rep solid-modelling kernel (OpenCascade / OCCT compiled to
WebAssembly), not a mesh editor. Every operation is an editable parametric
feature in a chronological timeline; editing an earlier feature rebuilds
everything downstream against persistent topology references.

![stack](https://img.shields.io/badge/kernel-OpenCascade%207.6-blue)

## Features

### Sketch

- **Sketcher**: draw lines, rectangles, circles, arcs, polygons, slots, points and construction geometry.
- **Constraints and dimensions**: constrain shapes, drive them with editable dimensions and watch the remaining degrees of freedom.
- **Line angles**: a typed angle is kept; double-click a line to edit its length and angle.
- **Offsets**: offset a curve or chain, then change its distance later from the badge in the sketch.
- **Project, trim and extend**: link earlier model edges into a sketch, trim curves at intersections, extend them to boundaries.
- **Edit in place**: editing a sketch rolls the model back to it; Finish Sketch returns to the saved position.

### Model

- **Solid features**: extrude, revolve, sweep, loft, emboss and deboss from sketch profiles or planar faces.
- **Modify**: fillet, chamfer, shell, combine, split, press/pull and move bodies; shell with no open face hollows the body.
- **Tangent chains**: fillet and chamfer pick smooth connected edges in one click.
- **Replicate**: mirror, rectangular pattern and circular pattern.
- **Construction**: offset planes and midplanes; sketch on any planar face.
- **Reference images**: place PNG, JPEG or WebP images on planes and calibrate them to real size.
- **Feature timeline**: rename, edit, suppress, delete, roll back and insert features; broken references are flagged, never dropped.

### Inspect

- **Measure**: distance, ΔXYZ, angle, radius, area and length between points, edges and faces.

### Files

- **STEP import**: start a project from a STEP file, or import one into an open project.
- **Export**: download binary STL or multi-body 3MF with named bodies and a quality setting.
- **Autosave**: every change saves to a readable JSON file that keeps the full feature history.

### Workspace

- **Viewport**: orbit, pan, zoom to cursor, named views, fit, ViewCube, orthographic or perspective.
- **Shortcuts**: single keys start tools; ? lists every keyboard and mouse control.
- **Undo and redo**: undo any edit, even inside a sketch, separately from the feature timeline.
- **Tool panels**: panels stay inside the window; Escape cancels a feature dialog and reverts its preview.
- **Errors**: stay visible until dismissed, and their text can be copied.
- **Version label**: the bottom-right corner shows the running build; hover for commit, version and schema.

[docs/user/guide.md](docs/user/guide.md) explains how to use each one.

## Quick start (Docker)

```bash
ROCKETT_ALLOWED_ORIGINS=http://localhost:8788 docker compose up -d
```

Then open http://localhost:8788. The server refuses to start without
`ROCKETT_ALLOWED_ORIGINS`, the comma-separated browser origins allowed to
change projects; list the origin you browse to. All state lives in the
`rockett-cad_data` volume; DOCKER.md covers LAN access, running dev and prod
side by side, and promoting the image dev verified to prod.
The container runs as the unprivileged `rockett` user: `/app` is root-owned
and `/data` is the only path it writes.

For Unraid, see [DOCKER.md](DOCKER.md) and the template in
`docker/unraid-rockett-cad.xml`.

## Running build

The bottom-right corner of the project list and the workspace shows the
running build: the image's `git describe` output, else `v<version> <commit>`,
else `v<version> dev`. Hover it for the full commit, version and schema.
`GET /api/health` returns the same fields.

A plain `docker compose up` records neither, so the label reads
`v<version> dev`. For a granular label, build with
`--build-arg ROCKETT_COMMIT=$(git rev-parse HEAD) --build-arg ROCKETT_DESCRIBE=$(git describe --tags --always --dirty)`.
[DOCKER.md](DOCKER.md) has the full Compose and `docker build` commands.

## Development

```bash
npm ci                 # .npmrc: install scripts off, exact pins on save
npm run prepare        # once per clone: husky sets core.hooksPath to .husky/_
export ROCKETT_ALLOWED_ORIGINS=http://localhost:5173
npm run dev            # server on :8788 + Vite client on :5173
npm test               # typecheck, then shared, server and client tests
npm run lint           # oxlint
npm run format:check   # Prettier
npm run lint:readme    # README feature items stay within 20 words
npm run lint:comments  # comment ratchet: no file may gain a comment
npm run lint:writing   # writing lint over tracked markdown
```

The last two need masterrulez cloned to `~/masterrulez`. See
[DEVELOPMENT.md](DEVELOPMENT.md).

## Documentation

| Doc                                        | Contents                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [docs/user/guide.md](docs/user/guide.md)   | How to use each feature, controls and shortcuts                   |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | System overview, layers, technology choices                       |
| [CAD_MODEL.md](CAD_MODEL.md)               | B-Rep representation, topology naming, regeneration, tessellation |
| [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md) | Timeline semantics, rollback, dependency handling                 |
| [API.md](API.md)                           | REST API reference                                                |
| [DOCKER.md](DOCKER.md)                     | Deployment (Docker / Compose / Unraid)                            |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Repo layout, workflows, testing                                   |
| [WORK-ORDER.md](WORK-ORDER.md)             | Scope, rulings and planned work                                   |
| [CHANGELOG.md](CHANGELOG.md)               | Changes per release, release and schema conventions               |
| [Brief.md](Brief.md)                       | Original 3D-printing brief, kept as history                       |

## License note

Rockett CAD bundles [opencascade.js](https://github.com/donalffons/opencascade.js)
(LGPL-2.1-only), the WASM build of Open CASCADE Technology.
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists every third-party
package in the image and the client bundle, with its version, licence and the
obligations to meet before distribution.
