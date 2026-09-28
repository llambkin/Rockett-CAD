# CAD model

The document is a recipe. Geometry is rebuilt from it and never saved. This
file keeps the contracts code cannot show and names the test that guards
each. Test files named without a directory live in `server/test/`.

Parameter shapes live in the types, not here: `CadDocument` in
`shared/src/model.ts`, one module per feature in `shared/src/features/`, JSON
schemas in `shared/src/schema/`.

## Saved projects

Saved projects are user data. A shape change ships a migration, a backup and
a test that loads the previous schema.

- `SCHEMA_VERSION` in `shared/src/model.ts` is the document version. A shape
  change bumps it and adds the step from the old version to
  `documentMigrations` in `server/src/store/migrations.ts`.
- `migrate` refuses a newer file with `TooNewError` and a gap with
  `MissingStepError`: `migrations.test.ts`.
- Load migrates in memory. The first save backs up the complete project
  through `NamespaceBackup` in `server/src/store/jsonStore.ts`, then writes
  one generation: `migrateBackup.test.ts`.
- Boot lists outdated projects and migrates none: `migrateBackup.test.ts`,
  "inventories outdated projects at boot".
- Previous-schema fixtures are `server/test/fixtures/schema/v{N}.json`.
  `schemaFixtures.test.ts` loads each one and "the previous schema". A bump
  adds its fixture and case there.
- Loading never writes. `pinRefs` in `server/src/geometry/pinRefs.ts` pins
  `targets` and `sig` in memory only: `pinRefs.test.ts`.
- An optional field needs no step when documents saved without it read the
  same, as an `importStep` without `format` reads as STEP:
  `importFormats.test.ts`.
- The store sets `revision` to the stored value plus one on every write:
  `storeRevision.test.ts`.
- STEP, IGES and BREP bytes live in the project blob store under their
  sha256. The feature holds `blob`: `stepBlob.test.ts`.
- `extensions` values keep their `{ version, data }` envelope. The server
  never reads `data`: `extensions.test.ts`.

### Schema steps

| Step     | Change                                             | Guard                    |
| -------- | -------------------------------------------------- | ------------------------ |
| 1 to 5   | version only: projection, offsets, `lineAngle`     | `schemaFixtures.test.ts` |
| 5 to 6   | `groups: []`                                       | `schemaFixtures.test.ts` |
| 6 to 7   | `revision: 0`, `savedWith: null`                   | `storeRevision.test.ts`  |
| 7 to 8   | inline STEP `data` becomes a `blob`                | `stepBlob.test.ts`       |
| 8 to 9   | reference image asset becomes a blob               | `assetBlob.test.ts`      |
| 9 to 10  | `extensions: {}`                                   | `extensions.test.ts`     |
| 10 to 11 | `visible` moves to the user view, `camera` dropped | `viewMigration.test.ts`  |
| 11 to 12 | `namingVersion: 1`                                 | `migrateBackup.test.ts`  |
| 12 to 13 | stale `visible` dropped                            | `migrateBackup.test.ts`  |
| 13 to 14 | version only: refs may carry `sig`                 | `refSignature.test.ts`   |
| 14 to 15 | version only: tools may carry `targets`            | `joinTarget.test.ts`     |
| 15 to 16 | version only: revolve `faces`                      | `migrations.test.ts`     |
| 16 to 17 | version only: sketch distances, `lineAngle.axis`   | `migrations.test.ts`     |
| 17 to 18 | version only: construction plane `method` kinds    | `migrations.test.ts`     |
| 18 to 19 | `units` moves to the project settings layer        | `unitsMigration.test.ts` |
| 19 to 20 | version 2 join `targets` sorted by `compareNames`  | `joinTarget.test.ts`     |
| 20 to 21 | `modifiedBy: null`                                 | `modifiedBy.test.ts`     |

## Body identity

Owners: `assignBodyIds` in `server/src/geometry/naming.ts`, `derivedBodyId`
and `compareNames` in `shared/src/topoRefs.ts`.

- A new body is `b:{featureId}`. Extra pieces are `b:{featureId}:2`, and so
  on: `unifyFaces.test.ts`.
- Join and cut keep the target's id. Bodies one tool bridges keep the first
  id in `targets`, else the first by `compareNames`: `joinEvery.test.ts`.
- Split pieces: version 1 orders by volume. Version 2 orders by each piece's
  smallest unshared face name, and a piece with no name of its own fails as
  an identity conflict: `bodyIds.test.ts`.
- Mirror and pattern copies are `b:{featureId}:{n}`, fixed length at any
  depth. The first `splitBody` piece keeps its id: `derivedBodyIds.test.ts`.
- A fresh process gives the same ids and names: `namingDeterminism.test.ts`.
- Display names live in `document.bodyMeta`. Visibility lives in the user
  view; see [API.md](API.md), View state. `document.groups` never reaches
  evaluation: `groups.test.ts`.

## Topological naming

Never reference topology by index. `server/src/geometry/naming.ts` owns
names. The document's `namingVersion` picks the rules. New projects get 2;
only the Naming upgrade changes a stored version.

### Face names

| Origin                                      | Name                                               |
| ------------------------------------------- | -------------------------------------------------- |
| Extrude or revolve side from a sketch curve | `f:{featureId}:s:{sketchEntityId}`                 |
| Extrude or revolve cap                      | `f:{featureId}:cap:start`, `f:{featureId}:cap:end` |
| Sweep and loft side and cap, version 2      | as extrude                                         |
| Fillet or chamfer face from an edge         | `f:{featureId}:fe:{n}`                             |
| Press/pull moved face, version 2            | the source face's name                             |
| Mirror or pattern copy                      | `m:{featureId}:{name}`, `p{i}:{featureId}:{name}`  |
| STEP, IGES or BREP import face, version 2   | `f:{featureId}:g:{surface}:{key}`                  |
| Anything the history cannot attribute       | `f:{featureId}:x{n}`                               |

- Names follow the kernel history (`propagateNames`, `historyNames`).
- A name map is a `ShapeMap` (`server/src/geometry/shapeMap.ts`) matched by
  `IsSame`, so hash collisions keep names: `shapeIdentity.test.ts`.
- Duplicates get `~n` in centroid order x, y, z (`suffixDuplicates`).
  Version 2 rounds to `LINEAR_TOL` first and marks equal cells `~?n`:
  `nameSuffix.test.ts`, `tieBreak.test.ts`.
- A face merged by unify takes its inputs' shared base name. Version 1 keeps
  the seams it always had: `unifyFaces.test.ts`, `flatSeam.test.ts`.

### Edge and vertex names

```
e[{faceA}|{faceB}]          edge bounded by two faces (names sorted)
e[{faceA}|seam]             seam edge
v[{faceA}|{faceB}|{faceC}]  vertex named by its adjacent faces
```

`computeEdgeNames` and `computeVertexNames` own them. Duplicates take `~n` as
faces do.

### Signatures

`server/src/geometry/signature.ts` describes a face or edge as a
`RefSignature` of type, point and direction: `signature.test.ts`. Under
version 2, `geometryNames` names import faces from their signature, so two
imports of one file name faces alike: `stepNames.test.ts`. Mesh imports keep
`x{n}` names.

### Resolution

`resolveRefs` in `server/src/geometry/resolve.ts` sorts each reference into
`resolved`, `candidate`, `ambiguous` or `missing`: `resolve.test.ts`.

- A name its body still bears is `resolved`. A `~?n` name never is.
- Version 2: a name whose `sig` now matches a renumbered sibling is a
  `candidate`, not followed.
- Otherwise lineage decides, then the `sig` on the referenced body. Other
  bodies give `suggestions` only.
- Evaluation never writes a candidate. Only a feature update, the repair,
  changes a stored reference.
- Version 2: an unresolved reference fails its feature and blocks later
  features that name its bodies. Other bodies build. Export refuses a
  blocked body.
- Version 1: nothing blocks. Failures still report their references.
- Measurement refuses any reference that is not `resolved`.

### Known limitations

- `~n` order swaps when an upstream edit moves duplicates past each other.
  Version 2 still swaps across a rounding step: `tieBreak.test.ts`.
- Split pieces renumber. A signed reference becomes a `candidate`; an
  unsigned one moves silently, as every version 1 one does:
  `namingProperty.test.ts`, `bodyIds.test.ts`.
- A failure that is not a reference, such as a fillet too large, blocks
  nothing. Later features build on the unchanged body.
- A consumed face errors its feature; the edit dialog repairs it. See
  [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md).

## Regeneration

`DocumentEngine` in `server/src/geometry/engine.ts`.

1. Features evaluate in timeline order. Each sees only the state before it.
2. Each feature stores a snapshot keyed by `featureKey`, and by that key with
   its reported `targets` when it had none: `engineCache.test.ts`.
3. The longest unchanged prefix is reused, so an edit to feature _k_
   re-evaluates _k..end_: `engineCache.test.ts`.
4. The marker truncates evaluation; later features report `rolledBack`.
   `shouldStop` cancels between features and inside kernel calls, and the
   next run resumes at the first `cancelled`: `engineProgress.test.ts`.
5. A failing feature records `error` and evaluation continues from the state
   before it: `geometry.test.ts`.
6. Suppressed features skip evaluation but keep their snapshot slot.
7. A changed `namingVersion` drops the cached timeline.

## Feature guards

A kernel success is not trusted. Each guard errors and keeps the previous
body.

- Every cut runs through `checkedCut` in `server/src/geometry/cutCheck.ts`:
  `cutInsideOut.test.ts`.
- Every join ends in `finishJoin` in `server/src/geometry/features.ts`, which
  refuses zero-thickness edges through `server/src/geometry/joinCheck.ts`:
  `joinZeroThickness.test.ts`.
- Fillet and Chamfer check validity, shell count, cut-through, run-past ends
  and loose tolerances (`cutsThrough`, `looseBlend`):
  `filletValidity.test.ts`, `chamferEnvelope.test.ts`.
- Shell must leave a hollow (`server/src/geometry/shell.ts`):
  `shellBlend.test.ts`.
- Tangent chains: `server/src/geometry/tangentEdges.ts`,
  `tangentEdges.test.ts`.
- Mesh imports cap at `MAX_MESH_TRIANGLES` in
  `server/src/geometry/importers.ts`: `importMesh.test.ts`,
  `read3mf.test.ts`.

## Tolerances

`shared/src/tolerance.ts` owns `LINEAR_TOL`, `ANGULAR_TOL_DEG` and
`UNIT_DOT_TOL`, one constant per quantity even where values match:
`tolerance.test.ts`. `MIN_OFFSET_MM` in `shared/src/features/sketch.ts` is an
input bound, not a tolerance.

## Sketches

- The solver is `shared/src/solver.ts`: `shared/test/solver.test.ts`.
- A profile id hashes its bounding entity ids. `findProfile` in
  `shared/src/profiles.ts` still finds ids saved before tangent splitting
  (DEC-101): `sketchRegions.test.ts`, `shared/test/profiles.test.ts`.
- Projections (`shared/src/projection.ts`) keep child ids `:a`, `:b` across
  regeneration: `geometry.test.ts`. A missing source fails the sketch rather
  than keep stale points.
- `editSketchOffset` in `shared/src/sketchOffsets.ts` keeps generated entity
  ids: `shared/test/sketchOffsets.test.ts`.
- Trim (`shared/src/sketchTrim.ts`) and extend (`extendSketch` in
  `shared/src/sketchModify.ts`) keep unchanged endpoints:
  `shared/test/sketchModify.test.ts`.

## Frame conventions

`server/src/geometry/frames.ts` owns sketch frames. Origin planes use
`ORIGIN_FRAMES`. A face frame's origin is the point on its plane closest to
the global origin, so a sketch rides its face. Construction plane methods:
`shared/src/features/constructionPlane.ts`,
`constructionPlaneMethods.test.ts`. Placements: `shared/src/placement.ts`,
`shared/test/placement.test.ts`.

## Tessellation

`server/src/geometry/tessellate.ts` and `server/src/geometry/mesh.ts`. Every
face triangle range, edge polyline and vertex carries its persistent name, so
selection is topology, never a triangle index: `tessellate.test.ts`. The
viewport and STL export both mesh through `meshShape`: `mesh.test.ts`. Export formats:
`server/src/geometry/exporters.ts`, `export.test.ts`.

## Naming upgrade

`server/src/store/namingUpgrade.ts` moves a version 1 document to version 2
only when the user asks, after a `naming1-{hash}` backup of the complete
project. `planNamingUpgrade` in `server/src/geometry/upgradeNaming.ts` proves
a mapping by provenance only, never by an `x{n}` or `~n` name. The commit
refuses while a `candidate` or `ambiguous` mapping lacks a choice, and writes
one save: `upgradeNaming.test.ts`. Vertex references are not mapped.

## Reference signatures

Feature add and update fill each missing `sig` from the state before the
feature and keep one sent with the reference. `collectTopoRefs` in
`shared/src/topoRefs.ts` finds the references: `refSignature.test.ts`.

## Tool targets

Extrude, revolve, sweep, loft and emboss may store `targets`. Stored targets
give the result the defaults gave. Add and update write them; hidden bodies
are never default participants; evaluation never reads the view:
`joinTarget.test.ts`.
