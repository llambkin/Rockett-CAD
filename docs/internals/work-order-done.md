# Done work order rows

Done rows move here from `WORK-ORDER.md`, one line each with the commit that
landed them, grouped by phase in work order order. `scripts/check-work-order.sh`
counts them as done. Rulings in `WORK-ORDER.md` keep each decision, and git
history keeps each full row.

## Decisions

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-002 | - | Mark chose in-app accounts with scrypt password hashes and an HttpOnly session cookie. |
| DEC-003 | - | Mark adopted this work order revision, replacing the version from `53e5600`. |
| DEC-004 | - | Mark ruled that UI built only from existing patterns needs no separate design approval. |

## OPS, masterrulez adoption and hygiene

| ID | Commit | Outcome |
| --- | --- | --- |
| OPS-029 | - | The queue checker rejects early completion, names the next ready row and supports deferred rows. |
| OPS-001 | c04b3ed | Every workspace dependency is an exact version, and `.npmrc` blocks ranges and install scripts. |
| OPS-002 | 1913e3e | Node 24 is the one version across engines, types, Dockerfile and docs. |
| OPS-003 | 162c02d | Upload size and content limits are proven on the locked Express and multer versions. |
| OPS-004 | e2491f9 | The major dependency upgrades are verified end to end, with audit findings fixed or ruled. |
| OPS-005 | 35da18d | Prettier formats the repository and `npm run format:check` enforces it. |
| OPS-006 | bbf8194 | Oxlint lints the repository with the masterrulez config and exits clean. |
| OPS-007 | 470163a | A per-file comment ratchet fails any file whose comment count rises. |
| OPS-008 | 2267c0d | Every tracked markdown file passes the masterrulez writing lint. |
| OPS-009 | 74bd498 | Husky and lint-staged format, lint and check comments at each commit. |
| OPS-010 | ace7b78 | Vitest runs node and DOM test projects separately, with a pinned DOM library. |
| OPS-011 | 8c89194 | `npm run check` is the one ship command and stops at the first failure. |
| OPS-012 | ba292a1 | The free strict TypeScript flags are on everywhere and client tests are typechecked. |
| OPS-013 | cfd2e4e | The sketch solver compiles under `noUncheckedIndexedAccess` with unchanged behaviour. |
| OPS-014 | 93d3225 | `sketchModify.ts`, `sketchOffsets.ts` and `projection.ts` compile under `noUncheckedIndexedAccess`. |
| OPS-015 | af04903 | The `shared` workspace is fully strict. |
| OPS-016 | 24683bc | `server/src` compiles under `noUncheckedIndexedAccess`. |
| OPS-017 | a1881ad | The `server` workspace, tests included, is fully strict. |
| OPS-018 | a4b55d7 | `ViewportView.tsx` and `toolPreview.ts` compile under `noUncheckedIndexedAccess`. |
| OPS-019 | 67b9f84 | The `client` workspace, tests included, is fully strict. |
| OPS-020 | 9d494b1 | The Docker healthcheck tolerates long regenerations and turns unhealthy only after about five minutes. |
| OPS-021 | fb670c5 | The container runs as an unprivileged user that can write only under `/data`. |
| OPS-022 | 42cb9c6 | `THIRD-PARTY-NOTICES.md` lists every shipped package with its version, licence and source. |
| OPS-024 | ea42d73 | `DEVELOPMENT.md` gives setup, test and check commands that work. |
| OPS-025 | e113d77 | `CAD_MODEL.md` and `README.md` match the code, including schema 4 sketch offsets. |
| OPS-026 | 7da4358 | `ROADMAP.md` was folded into work order rows and deleted. |
| OPS-027 | a73b004 | `DOCKER.md` documents promoting the image dev verified instead of rebuilding for prod. |
| OPS-028 | 04b4a7c | `CHANGELOG.md` states the version, tag and schema line conventions for releases. |
| OPS-030 | 6e88137 | A real-browser acceptance test drives an isolated app through a modelling session. |
| OPS-031 | 01b1b73 | The running build shows its version in `/api/health` and in a small corner label. |
| OPS-032 | 5f7cfa8 | README `## Features` is one short line per user feature, with the how-to detail moved out. |
| OPS-033 | 1d22a1b | `npm run cost` prints line counts, long functions and bench timings for large files and modules. |
| OPS-034 | ed93c25 | Every exported function of the god files has a bench case, so the cost table shows timings. |
| OPS-CP | 856bdea | The OPS phase checkpoint passed. |

## BUG, known defects

| ID | Commit | Outcome |
| --- | --- | --- |
| BUG-001 | 6b8c066 | A sweep path with an arc builds, through one shared arc edge helper. |
| BUG-002 | 156bf14 | A sweep path works whatever order its curves were drawn in. |
| BUG-003 | 6c7cb7c | A shell with no open faces hollows the body. |
| DEC-101 | - | Mark ruled that existing projects keep today's evaluation until an explicit, backed-up upgrade. |
| BUG-009 | 92f22e6 | The validator throws `ValidationError` instead of crashing on malformed shapes. |
| BUG-010 | 0f34a24 | Profile, face and list references in features are validated. |
| BUG-011 | 6bec570 | Feature enums and boolean flags are validated. |
| BUG-012 | 78b44dc | Plane and axis references are validated in depth. |
| BUG-013 | 0d15861 | `suppressed` and the document base fields are validated. |
| BUG-014 | f3334f2 | Feature writes reject non-object patches and keys a feature type does not declare. |
| BUG-015 | 7aa8c47 | Export requests reject bad body ids with a 400, and the unused `binary` flag is gone. |
| BUG-016 | 76f2f58 | Evaluating a project never writes to disk. |
| BUG-017 | 775bba1 | STEP import uses a per-call file path in the kernel filesystem. |
| BUG-018 | 25f59ac | Each evaluator sees only the features before it, so its cache key matches its inputs. |
| BUG-019 | f682981 | Reopening an extrude and pressing OK with no edits leaves the feature unchanged. |
| BUG-020 | 2ce5ee8 | Tests pin the fillet and chamfer `tangentChain` defaults as consistent. |
| BUG-021 | 3812513 | Escape cancels an open feature dialog. |
| BUG-022 | 7ddb363 | Live previews are sequenced so a stale response never applies. |
| BUG-023 | ee70076 | Sketch rendering frees its geometries and materials on rebuild through `dispose.ts`. |
| BUG-024 | f03511b | `CadViewport` frees the geometry, materials and textures it owns. |
| BUG-025 | bd7188a | Reference images free their GPU textures once no image shows them. |
| BUG-026 | a4db88c | A line's angle is stored when drawn and can be edited afterwards. |
| BUG-027 | ff8f71d | Shift snaps a line's angle to 15 degree steps while drawing, and A locks it. |
| BUG-028 | 0adb16e | Reloading the page reopens the project that was open. |
| BUG-029 | 0cfd867 | A context menu closes on any click outside it and on Escape. |
| BUG-030 | d17c461 | Three colour pairs that SET-023 left under target now meet their contrast ratios. |
| BUG-031 | b26ccfe | Every toolbar group is at least as wide as its label. |
| BUG-032 | 8228507 | Scrollbars follow the dark theme. |
| BUG-033 | 71a1869 | Coincident joins a point to a line, circle or arc. |
| BUG-034 | 4131005 | The view cube and the other SET-023 colour leftovers paint their theme tokens. |
| BUG-CP | f6022f3 | The BUG phase checkpoint passed. |

## KIT, reusable primitives

| ID | Commit | Outcome |
| --- | --- | --- |
| KIT-001 | 0274e15 | Every disposal goes through `client/src/three/dispose.ts`. |
| KIT-002 | e953cee | Screen and ray conversions live once in `client/src/three/screen.ts`. |
| KIT-003 | 37c948b | A shared `Manipulator` base owns gizmo raycasting, hit tests and disposal. |
| KIT-004 | c4d0d33 | `ExtrudeGizmo` extends `Manipulator` with unchanged results. |
| KIT-005 | 2e28c7c | `MoveGizmo` extends `Manipulator`. |
| KIT-006 | da11fdc | `GizmoSlot` owns the rule for rebuilding and disposing gizmos around drags. |
| KIT-007 | d68a426 | `createLivePreview` replaces the three copies of the live preview throttle. |
| KIT-010 | 727923a | `shared/src/units.ts` owns units, conversions and length and angle formatting. |
| KIT-014 | 5a4b14d | `shared/src/tolerance.ts` owns the modelling tolerances. |
| KIT-016 | a0967ee | `meshShape` is the one tessellation loop for display and mesh export. |
| KIT-017 | 0f5cb88 | `planarFacePlane` replaces four copies of the planar face frame code. |
| KIT-018 | 5f9115f | `collectEdges` resolves fillet and chamfer edges once. |
| KIT-019 | 48b29ee | `byPosition` and `suffixDuplicates` own topology name ordering, with unchanged names. |
| KIT-020 | 186f6e9 | `parseEdgeRef` replaces two copies of edge reference parsing. |
| KIT-021 | 88ce5a9 | API errors share one body shape with a closed set of codes. |
| KIT-022 | 739bbba | The client makes every JSON call through one `request` that throws `ApiError`. |
| KIT-023 | 4423c0b | `request` also handles uploads and file downloads. |
| KIT-024 | fc90e36 | `shared/src/routes.ts` lists every API route once for server and client. |
| DEC-201 | - | Mark chose one exact-pinned JSON Schema library, with TypeBox as the candidate. |
| KIT-025 | 745bf80 | Non-feature request bodies are parsed once at the boundary through the shared schema. |
| KIT-026 | ccfda02 | Five feature types validate through schemas checked against their model types. |
| KIT-027 | 1d1887f | The remaining feature types validate through schemas, and the hand-written switch is gone. |

## DOC, document model and storage

| ID | Commit | Outcome |
| --- | --- | --- |
| DOC-001 | beb7873 | Fixtures for schema versions 1 to 4 load and upgrade with their features unchanged. |
| DOC-002 | 29467dd | `JsonStore` owns atomic, serialised JSON file storage, and `ProjectStore` uses it. |
| DEC-301 | - | Mark chose a mounted SMB or NFS share at `/data` as the first non-local storage. |
| DOC-028 | c247f99 | `docs/internals/design-projects.md` proposes folders and file management for the project list. |
| DEC-406 | - | Mark approved the project folders design. |
| DOC-029 | 2d6e31e | The server stores project folders in `folders.json`, with routes to manage them. |
| DEC-302 | - | Mark ruled that `/api` stays unversioned until PLUG sets the plugin API. |

## AUTH, identity

| ID | Commit | Outcome |
| --- | --- | --- |
| AUTH-002 | af4117a | Passwords are hashed with scrypt and checked in constant time. |
| AUTH-003 | 65d4eaf | An in-memory session store issues, slides and revokes tokens with idle and absolute expiry. |
| AUTH-004 | 0c6a83c | `createApp` builds the Express app, so tests start the real app on a temporary data dir. |
| AUTH-008 | 8b3dfd9 | State-changing API routes accept only the configured allowed origins. |
| AUTH-011 | - | Retired by DEC-004, with no auth design file. |
| DEC-401 | - | Mark ruled that DEC-004 covers the auth screens. |
| DEC-402 | - | Mark ruled that Cloudflare Access becomes a second identity source after AUTH-CP. |

## SET, settings core

| ID | Commit | Outcome |
| --- | --- | --- |
| SET-006 | 22f2484 | `docs/internals/design-settings.md` wireframes the Settings panel and proposes the black theme. |
| DEC-403 | - | Mark approved the settings design with the black default and one blue accent. |
| SET-008 | a355f49 | `client/src/theme/tokens.ts` is the one colour source for the UI. |
| SET-009 | 62ed303 | three.js colours come from the same theme tokens. |
| SET-011 | 6996b15 | The theme took the approved palette, with contrast checked per token pair. |
| SET-023 | 31c2c11 | Surfaces took back the graded greys, with text tokens lightened to meet contrast. |

## CUST, user customisation

| ID | Commit | Outcome |
| --- | --- | --- |
| CUST-003 | 6569b79 | `docs/internals/design-customisation.md` wireframes shortcuts, toolbar, docking and theme customisation. |
| CUST-019 | d006be7 | `docs/internals/design-icons.md` proposes one original SVG icon per toolbar button. |
| CUST-020 | 8f4d171 | Toolbar buttons show the 51 approved icons, with labels under them by default, amber hover and the accent when active. |
| DEC-405 | 50ba613 | Mark approved the toolbar icons, with icons and labels as the default layout. |
| CUST-022 | 5cbca2e | Right-click menus exist on the surfaces listed in `docs/internals/context-menus.md`. |

## PERF, scale

| ID | Commit | Outcome |
| --- | --- | --- |
| PERF-001 | 4fe1d3f | `npm run bench` runs the server benches, and `docs/internals/performance.md` holds the baseline table. |
| PERF-002 | c6ec467 | Deterministic many-feature and many-body fixtures back the evaluation benches. |
| PERF-009 | 254884c | A test proves the kernel worker starts, stops and restarts cleanly on host and container Node. |
| DEC-203 | - | Mark approved job progress and Cancel in the existing viewport hint line. |
| PERF-020 | 47ab981 | `shared/src/meshFormat.ts` defines a versioned binary body mesh format. |
| DEC-202 | - | Mark ruled to stop at PERF-029 unless picking takes over 4 ms. |

## EXCH, import and export

| ID | Commit | Outcome |
| --- | --- | --- |
| EXCH-001 | d3f81d6 | A probe test proved which XDE calls work in the pinned `opencascade.js` build. |
| DEC-205 | - | Mark approved dev-only interoperability readers that never ship. |
| EXCH-013 | 77d322f | A project exports and imports as one `.rockett` file with its assets. |
| EXCH-014 | d1fa132 | The UI downloads and opens `.rockett` project files. |
| EXCH-016 | 5ffe418 | IGES and BREP files import as exact solids. |
| EXCH-017 | 809b867 | DXF files import into a sketch as editable entities. |
| EXCH-018 | e70e10e | SVG files import into a sketch as editable entities. |

## ASM, assemblies

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-601 | - | Mark chose rigid, revolute and slider joints solved as a tree. |
| DEC-602 | - | Mark chose components that track the latest part revision with an update badge. |

## PLUG, plugin packaging and loading

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-501 | - | Mark ruled that third-party modules are trusted code, installed by folder drop and enabled by an admin. |

## CAM, CNC and CAM

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-611 | - | Mark ruled that each post maps tool changes its own way. |
| DEC-612 | - | Mark ruled that data stays in mm and inch appears only in display and post output. |
| DEC-613 | - | Mark ruled that tool and machine libraries live per user on the server. |
| DEC-614 | - | Mark ruled that toolpaths generate on the server as kernel-worker jobs. |
| DEC-616 | - | Mark ruled that third-party JavaScript posts wait until a real one exists. |
| DEC-617 | - | Mark ruled that adaptive clearing and 3D surfacing wait until 2.5D has cut real parts. |

## PCB bridge

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-620 | - | Mark chose KiCad 9 as the minimum version. |
| DEC-621 | - | Mark chose browser upload first for boards. |
| DEC-622 | - | Mark ruled that KiCad owns the board outline by default. |
| DEC-623 | - | Mark allowed `kicad-cli` only as a dev-only fixture oracle. |

## ELEC, electrical

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-640 | - | Mark chose to keep the schematic in KiCad and show board nets and connectors in 3D. |

## PRINT, additive as a module

| ID | Commit | Outcome |
| --- | --- | --- |
| DEC-660 | - | Mark chose a 3MF download placed for the chosen printer as the slicer handoff. |
