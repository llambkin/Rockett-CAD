# CAD model

The document is a recipe. Geometry is rebuilt from it and never saved. This
file keeps the contracts code cannot show and names the code that owns each.

Parameter shapes live in the types, not here: `CadDocument` in
`shared/src/documents.ts`, one module per feature in `shared/src/features/`, JSON
schemas in `shared/src/schema/`.

## Saved projects

Saved projects are user data. A shape change ships a migration, a backup and
a test that loads the previous schema.

- `SCHEMA_VERSION` in `shared/src/documents.ts` is the document version. A shape
  change bumps it and adds the step from the old version to
  `documentMigrations` in `server/src/store/migrations.ts`.
- `migrate` refuses a newer file with `TooNewError` and a gap with
  `MissingStepError`.
- Load migrates in memory. The first save backs up the complete project
  through `NamespaceBackup` in `server/src/store/jsonStore.ts`, then writes
  one generation.
- Boot lists outdated projects and migrates none: `server/src/index.ts`.
- Loading never writes. `pinRefs` in `server/src/geometry/pinRefs.ts` pins
  `targets` and `sig` in memory only.
- An optional field needs no step when documents saved without it read the
  same, as an `importStep` without `format` reads as STEP:
  `shared/src/features/importStep.ts`.
- The store sets `revision` to the stored value plus one on every write:
  `server/src/store/projectStore.ts`.
- STEP, IGES and BREP bytes live in the project blob store under their
  sha256 (`server/src/store/blobStore.ts`). The feature holds `blob`.
- `extensions` values keep their `{ version, data }` envelope. The server
  never reads `data`.
- A feature is a `CoreFeature` or an `ExtensionFeature`, whose dotted
  `type` names its module and whose own `version` and `params` its
  `FeatureSpec` owns. Load runs the spec's `migrate` through `migrate`, with
  the type as namespace (`documentMigrations.nested`). Core features carry no
  `version` and load unchanged; an unregistered type stays as stored.

### Schema steps

| Step     | Change                                             |
| -------- | -------------------------------------------------- |
| 1 to 5   | version only: projection, offsets, `lineAngle`     |
| 5 to 6   | `groups: []`                                       |
| 6 to 7   | `revision: 0`, `savedWith: null`                   |
| 7 to 8   | inline STEP `data` becomes a `blob`                |
| 8 to 9   | reference image asset becomes a blob               |
| 9 to 10  | `extensions: {}`                                   |
| 10 to 11 | `visible` moves to the user view, `camera` dropped |
| 11 to 12 | `namingVersion: 1`                                 |
| 12 to 13 | stale `visible` dropped                            |
| 13 to 14 | version only: refs may carry `sig`                 |
| 14 to 15 | version only: tools may carry `targets`            |
| 15 to 16 | version only: revolve `faces`                      |
| 16 to 17 | version only: sketch distances, `lineAngle.axis`   |
| 17 to 18 | version only: construction plane `method` kinds    |
| 18 to 19 | `units` moves to the project settings layer        |
| 19 to 20 | version 2 join `targets` sorted by `compareNames`  |
| 20 to 21 | `modifiedBy: null`                                 |

## Body identity

Owners: `orderBodyPieces` in `server/src/geometry/naming.ts`, `derivedBodyId`
and `compareNames` in `shared/src/topoRefs.ts`.

- A new body is `b:{featureId}`. Extra pieces are `b:{featureId}:2`, and so
  on.
- Join and cut keep the target's id. Bodies one tool bridges keep the first
  id in `targets`, else the first by `compareNames`.
- Split pieces: version 1 orders by volume. Version 2 orders by each piece's
  smallest unshared face name, and a piece with no name of its own fails as
  an identity conflict. The first piece keeps the target's id. Under version
  2 a join, cut or intersect names the rest `b:{featureId}:{n}`, numbered
  from 2 across the feature, so the id never grows with chain depth; version
  1 appends `:{n}` to the target's id.
- Mirror and pattern copies are `b:{featureId}:{n}`, fixed length at any
  depth. The first `splitBody` piece keeps its id.
- A fresh process gives the same ids and names.
- Display names live in `document.bodyMeta`. Visibility lives in the user
  view; see [API.md](API.md), View state. `document.groups` never reaches
  evaluation.

## Topological naming

Never reference topology by index. `server/src/geometry/naming.ts` owns
names. The document's `namingVersion` picks the rules. New projects get 2;
only the Naming upgrade changes a stored version.

### Face names

| Origin                                      | Name                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| Extrude or revolve side from a sketch curve | `f:{featureId}:s:{sketchEntityId}`                      |
| Extrude or revolve cap                      | `f:{featureId}:cap:start`, `f:{featureId}:cap:end`      |
| Sweep and loft side and cap, version 2      | as extrude                                              |
| Fillet or chamfer face from an edge         | `f:{featureId}:fe:{n}`                                  |
| Press/pull moved face, version 2            | the source face's name                                  |
| Mirror or pattern copy, version 1           | `m:{featureId}:{name}`, `p{i}:{featureId}:{name}`       |
| Mirror or pattern copy, version 2           | `m:{featureId}:{key}{~n}`, `p{i}:{featureId}:{key}{~n}` |
| STEP, IGES or BREP import face, version 2   | `f:{featureId}:g:{surface}:{key}`                       |
| Anything the history cannot attribute       | `f:{featureId}:x{n}`                                    |

- Names follow the kernel history (`propagateNames`, `historyNames`).
- A name map is a `ShapeMap` (`server/src/geometry/shapeMap.ts`) matched by
  `IsSame`, so hash collisions keep names.
- Duplicates get `~n` in centroid order x, y, z (`suffixDuplicates`).
  Version 2 rounds to `LINEAR_TOL` first and marks equal cells `~?n`.
- Version 2 `key` is the first 16 hex digits of the SHA-256 of the source
  name without its `~n` or `~?n` suffix, so a copy name keeps one length at
  any mirror or pattern depth.
- A face merged by unify takes its inputs' shared base name. Version 1 keeps
  the seams it always had.

### Edge and vertex names

```
e[{faceA}|{faceB}]          edge bounded by two faces (names sorted)
e[{faceA}|seam]             seam edge
v[{faceA}|{faceB}|{faceC}]  vertex named by its adjacent faces, version 1
v[{key}]                    vertex, version 2: key of the sorted face names
```

`computeEdgeNames` and `computeVertexNames` own them. Duplicates take `~n` as
faces do. Stored names are bounded only by the request size.

### Signatures

`server/src/geometry/signature.ts` describes a face or edge as a
`RefSignature` of type, point and direction. Under
version 2, `geometryNames` names import faces from their signature, so two
imports of one file name faces alike. Mesh imports keep
`x{n}` names.

### Resolution

`resolveRefs` in `server/src/geometry/resolve.ts` sorts each reference into
`resolved`, `candidate`, `ambiguous` or `missing`.

- A name its body still bears is `resolved`. Under version 2, a picked `~?n`
  edge also resolves when its stored signature uniquely matches that name.
  Unsigned ties require repair; coincident matches report both edge names.
- Version 2: a name whose `sig` now matches a renumbered sibling is a
  `candidate`, not followed.
- Otherwise lineage decides, then the `sig` on the referenced body. Other
  bodies give `suggestions` only.
- Evaluation never writes a candidate or a `sig`. Only a feature update, the
  repair, changes a stored reference's name.
- Version 2: an unresolved reference fails its feature and blocks later
  features that name its bodies. Other bodies build. Export refuses a
  blocked body.
- Version 1: nothing blocks. Failures still report their references.
- Measurement skips the resolver. It measures the live pick by its exact
  name, a tied `~?` name included, and never repairs or stores it.

### Known limitations

- `~n` order swaps when an upstream edit moves duplicates past each other.
  Version 2 still swaps across a rounding step.
- Split pieces renumber. A signed reference becomes a `candidate`; an
  unsigned one moves silently, as every version 1 one does.
- A save evaluated only up to an open sketch refreshes no `sig` after that
  sketch, and finishing the sketch only evaluates. Those references keep
  their old `sig` until a later save changes a feature before them.
- A failure that is not a reference, such as a fillet too large, blocks
  nothing. Later features build on the unchanged body.
- A consumed face errors its feature; the edit dialog repairs it. See
  [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md).

## Regeneration

`DocumentEngine` in `server/src/geometry/engine.ts`.

1. Features evaluate in timeline order. Each sees only the state before it.
2. Each feature stores a snapshot keyed by `featureKey`, and by that key with
   its reported `targets` when it had none.
3. The longest unchanged prefix is reused, so an edit to feature _k_
   re-evaluates _k..end_.
4. The marker truncates evaluation; later features report `rolledBack`.
   `shouldStop` cancels between features and inside kernel calls, and the
   next run resumes at the first `cancelled`.
5. A failing feature records `error` and evaluation continues from the state
   before it.
6. Suppressed features skip evaluation but keep their snapshot slot.
7. A changed `namingVersion` drops the cached timeline.

## Feature guards

A kernel success is not trusted. Each guard errors and keeps the previous
body.

- Cut tool operations, Combine cuts, Press/Pull cuts and Shell hollow cuts
  run through `checkedCut` in `server/src/geometry/boolean.ts`.
- Every join ends in `finishJoin` in `server/src/geometry/booleanNaming.ts`.
  Two guards warn instead: zero-thickness detection in
  `server/src/geometry/joinCheck.ts` and contact-only joins in
  `server/src/geometry/boolean.ts`. A join, or
  an extrude, revolve, sweep, loft or emboss cut, that leaves a zero-thickness
  edge its inputs lacked builds, and the feature status is `warning` naming
  the edge length. A join tool that touches a body only along an edge or at a
  vertex stays a separate body, and the status is `warning` saying so.
- Fillet and Chamfer check validity, shell count, cut-through, run-past ends
  and loose tolerances (`cutsThrough`, `looseBlend`).
- Shell stores an optional `body` (schema 24). With no open faces it hollows
  that body, else the first body; open faces must lie on the chosen body.
- Shell currently accepts valid geometry with significant volume loss
  (`server/src/geometry/shell.ts`); this does not qualify openings or thickness.
  Closed and top-open synthetic boxes qualify independently. A 20 mm cube
  with one vertical 2 mm corner fillet, shelled inward 1 mm at that cylinder,
  reports success but retains material across the selected opening. Its cavity
  is square, leaving a 0.586 mm diagonal wall. The direct kernel result passes
  the volume guard, so the fallback is never reached. At a 2 mm wall the same
  filleted body's top-face offset throws; the previous body survives, but its
  error has no explanation. These are distinct failures.
- The Shell fallback cuts the inner offset joined to a slab over each selected
  inner face: a prism for a flat face, thickening for a rounded one. References
  computed with that same offset cannot independently qualify its geometry.
- Shell rebuild acceptance requires independent opening probes, inner and outer
  dimensions, retained wall thickness and analytic volume, separately from
  feature status and kernel validity. The rounded cylinder fixture requires
  an unobstructed radial path through the wall between its inner top and bottom
  planes; those end collars remain. Inside, outside and both-sides offsets must
  qualify separately; an outside 2 mm box wall grows each dimension by 4 mm.
  Refused, partial or unqualified results keep the previous body and explain
  the error. Cold regeneration and previous-schema loading must also pass.
- Tangent chains: `server/src/geometry/tangentEdges.ts`.
- Mesh imports cap at `MAX_MESH_TRIANGLES` in
  `server/src/geometry/importers.ts`.

## Tolerances

`shared/src/tolerance.ts` owns `LINEAR_TOL`, `ANGULAR_TOL_DEG` and
`UNIT_DOT_TOL`, one constant per quantity even where values match.
`MIN_OFFSET_MM` in `shared/src/features/sketch.ts` is an
input bound, not a tolerance.

## Sketches

- The solver is `shared/src/solver.ts`: `shared/test/solver.test.ts`.
- A profile id hashes its bounding entity ids. `findProfile` in
  `shared/src/profiles.ts` still finds ids saved before tangent splitting
  (DEC-101): `shared/test/profiles.test.ts`.
- A planar face supports a sketch independently of its boundary curves.
  Automatic boundary import retains exact straight edges, circles and circular
  arcs. If any curve is unsupported, the sketch starts empty and reports that
  limit instead of importing a partial profile. Reference import classifies
  unsupported curves without sampling them; DXF export still samples them.
  Project can import supported edges individually; unsupported edges report
  their limit.
- Projections (`shared/src/projection.ts`) keep child ids `:a`, `:b` across
  regeneration. A missing source fails the sketch rather
  than keep stale points.
- `editSketchOffset` in `shared/src/sketchOffsets.ts` keeps generated entity
  ids: `shared/test/sketchOffsets.test.ts`.
- Trim (`shared/src/sketchTrim.ts`) and extend (`extendSketch` in
  `shared/src/sketchModify.ts`) keep unchanged endpoints:
  `shared/test/sketchModify.test.ts`.
- `editedEntities` in `shared/src/solver.ts` refuses a write whose added or
  changed constraints stop a converging sketch from converging, and names the
  first such constraint. Client and server both call it. A sketch already in
  conflict is not refused.
- The solver skips a dimension with `driven: true`. The field is optional, so
  sketches saved without it load unchanged with no schema step.

## Frame conventions

`server/src/geometry/frames.ts` owns sketch frames. Origin planes use
`ORIGIN_FRAMES`. A face frame's origin is the point on its plane closest to
the global origin, so a sketch rides its face. Construction plane methods:
`shared/src/features/constructionPlane.ts`. Placements:
`shared/src/placement.ts`, `shared/test/placement.test.ts`.

## Tessellation

`server/src/geometry/tessellate.ts` and `server/src/geometry/mesh.ts`. Every
face triangle range, edge polyline and vertex carries its persistent name, so
selection is topology, never a triangle index. The viewport and STL export
both mesh through `meshShape`. Export formats:
`server/src/geometry/exporters.ts`.

## Naming upgrade

`server/src/store/namingUpgrade.ts` moves a version 1 document to version 2
only when the user asks, after a `naming1-{hash}` backup of the complete
project. `planNamingUpgrade` in `server/src/geometry/upgradeNaming.ts` proves
a mapping by provenance only, never by an `x{n}` or `~n` name. The commit
refuses while a `candidate` or `ambiguous` mapping lacks a choice, and writes
one save. Vertex references are not mapped. A version 1 copy name compares
by its version 2 form, each `m:` or `p{i}:` prefix applied as a key from
the inside out.

## Reference signatures

Feature add and update fill each missing `sig` from the state before the
feature and keep one sent with the reference. `collectTopoRefs` in
`shared/src/topoRefs.ts` derives face and edge paths from `FeatureSpec.refs`.
The same contract owns body and feature dependencies, including references
inside planes, axes and points. Opaque extension parameters are not references
unless their registered spec declares them.

A save that changes a feature refreshes the stored `sig` of each reference
that still resolves on its name in every later feature the save left
unchanged, from the state before that feature, so a later renumbering is
still caught. A reference that no longer resolves, or whose body is blocked,
keeps its `sig`. Only features the save evaluates refresh; one past the
timeline marker refreshes when the timeline rolls forward over it. A preview
refreshes at commit. `refreshSigs` in `server/src/api/projectMutations.ts`
owns this and runs after the save's evaluation. Evaluation never writes `sig`.

## Tool targets

Extrude, revolve, sweep, loft and emboss may store `targets`. Stored targets
give the result the defaults gave. Add and update write them; hidden bodies
are never default participants; evaluation never reads the view:
`pinTargets` in `shared/src/topoRefs.ts`.

## Loft sections

Loft stores profile and planar-face references in picked order. Face sections
use their existing boundary, with one outline and no holes. Join includes
each selected source body before any explicit extra target, retaining the
first source body's identity. Profile-only lofts keep their existing target
behaviour.

Schema 22 adds mixed sections without changing existing profile references.
The fork migration chain remains authoritative. Upstream schema 12 documents
that have no naming version receive version 1 while retaining the fork's
view split. The project store backs up the complete previous project before
the first migrated save.

## Named parameters

Schema 23 adds `parameters` and `parameterBindings`, empty for prior documents.
Parameters retain name, unit, expression and comment; bindings retain a feature
id, schema-relative numeric path and expression. Stored feature inputs remain
numbers. `resolveDocumentParameters` in `shared/src/parameters.ts` owns derived
values and a resolved feature copy, without changing the stored associations.
Numeric schemas own binding eligibility, units and bounds. Names, references,
cycles, dimensions and numeric results are validated before document acceptance.
Model inputs retain associations; settings and export options calculate once.
Geometry resolves inputs before feature-cache keys. Project mutations compare
resolved sketch dimensions and use the existing write-time solver only for added
or changed constraints, retaining other stored positions and bound literals.
History restore keeps the snapshot's stored positions. Deleting a feature removes
its bindings; undo restores them. Parameter edits use the same revision, preview
and history owners as feature edits; rejected expressions and conflicting
dimensions leave the saved document and history unchanged.

Core feature schemas live in `shared/src/schema/coreFeatures.ts`, below the
parameter resolver and document validation. `schema/features.ts` retains their
public exports alongside the document schemas. The cached parser lives in
`schema/validation.ts` without document or feature imports.
