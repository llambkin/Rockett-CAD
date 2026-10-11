# CAD model

Geometry is rebuilt from the document recipe. `shared/src/documents.ts` owns
`CadDocument`, `shared/src/features/` owns features, and `shared/src/schema/`
owns validation. This file keeps their durable contracts.

## Saved projects

Saved-data shape changes require a migration, backup and previous-schema proof.

- Shape changes bump `SCHEMA_VERSION` and add the previous-version step to
  `documentMigrations` in `server/src/store/migrations.ts`.
- `migrate` refuses a newer file with `TooNewError` and a gap with
  `MissingStepError`.
- Load migrates in memory; first save backs up the project through
  `NamespaceBackup` in `server/src/store/jsonStore.ts`, then writes one generation.
- Boot lists outdated projects and migrates none: `server/src/index.ts`.
- Loading never writes. `pinRefs` in `server/src/geometry/pinRefs.ts` pins
  `targets` and `sig` in memory only.
- An optional field needs no step when documents saved without it read the
  same, as an `importStep` without `format` reads as STEP:
  `shared/src/features/importStep.ts`.
- The store sets `revision` to the stored value plus one on every write:
  `server/src/store/projectStore.ts`.
- STEP, IGES, BREP, STL, OBJ and 3MF bytes live in the project blob store
  under their sha256 (`server/src/store/blobStore.ts`). The feature holds
  `blob`.
- `extensions` keeps opaque `{ version, data }` envelopes, including extra fields.
  `moduleAssets.namespaces` owns module portable SHA-256 references, independent
  of features and loaded modules. Project mutations declare only their manifest
  namespace through `assets.set`; the existing blob owner validates bytes before
  save. Schema 45 to 46 keeps absent maps absent and preserves any older root
  `moduleAssets` value unchanged in `moduleAssets.legacy`. The first save backs
  up the complete source; core never reinterprets an extension envelope.
- A feature is a `CoreFeature` or an `ExtensionFeature`, whose dotted
  `type` names its module and whose own `version` and `params` its
  `FeatureSpec` owns. Load runs the spec's `migrate` through `migrate`, with
  the type as namespace (`documentMigrations.nested`). Core features carry no
  `version` and load unchanged; an unregistered type stays as stored.
- A feature newer than its spec also stays as stored. Validation, references
  and bindings treat it as unregistered (`opaqueFeature` in
  `shared/src/featureSpec.ts`), and evaluation fails it with
  `<type> version <n> is newer than this module reads (<m>)`.
- A module whose manifest declares `dataVersion` migrates its
  `extensions[<moduleId>]` envelope in the same nested pass, through the
  `migrations` of its server entry. A newer envelope stays as stored. Like
  every step, the first save backs up the project before writing.

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
- Mirror, pattern and Move copies are `b:{featureId}:{n}`, fixed length at
  any depth. The first `splitBody` piece keeps its id.
- A module body is `{moduleId}:{featureId}:{key}`, one solid, made by that
  feature whatever its timeline position (API.md, API 0.17.0).
- A fresh process gives the same ids and names.
- Display names live in `document.bodyMeta`, set once when a body first
  appears, except a module body's, which follows its module's name on every
  evaluation: a STEP body takes its instance or product name, made unique with
  ` (2)`, ` (3)`, with control characters removed and capped at 200
  characters; any other body, or a STEP name that is empty or OCCT's default
  `Open CASCADE STEP translator {version} {n}`, takes `BodyN` from
  `counters.body`. Schema 31 adds an optional `bodyMeta` `color`, lowercase
  `#rrggbb`, which wins over a STEP colour in evaluation; an earlier
  document migrates unchanged. Visibility lives in the user
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
| Fillet or chamfer face from an edge         | `f:{featureId}:fe:{n}`, `f:{featureId}:fe:{n}:{part}`   |
| Press/pull moved face, version 2            | the source face's name                                  |
| Mirror or pattern copy, version 1           | `m:{featureId}:{name}`, `p{i}:{featureId}:{name}`       |
| Mirror or pattern copy, version 2           | `m:{featureId}:{key}{~n}`, `p{i}:{featureId}:{key}{~n}` |
| Move copy                                   | as the pattern copy with `i` 1                          |
| STEP, IGES, BREP or module face, version 2  | `f:{featureId}:g:{surface}:{key}`                       |
| Labelled module face, both versions         | `f:{featureId}:l:{label}`                               |
| Anything the history cannot attribute       | `f:{featureId}:x{n}`                                    |

- Names follow the kernel history (`propagateNames`, `historyNames`).
- Every face name template lives in `server/src/geometry/naming.ts`; a
  fillet or chamfer adds `:{part}` only when one edge makes several faces.
- A name map is a `ShapeMap` (`server/src/geometry/shapeMap.ts`) matched by
  `IsSame`, so hash collisions keep names.
- Duplicates get `~n` in centroid order x, y, z (`suffixDuplicates`).
  Version 2 rounds to `LINEAR_TOL` first and marks equal cells `~?n`.
  Fallback faces in an equal cell become `f:{featureId}:x~?{n}`.
- Version 2 names a face its history missed from the profile edge whose
  midpoint lies on it. A face touched by several takes the first name with
  `~?1`.
- A face reference to a `~?` name never resolves; the resolver reports it.
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
- Extrude, revolve, sweep and loft bodies of every operation, and Combine
  results, pass `rejectInvalidBody` in `server/src/geometry/featureState.ts`
  on the final shape, after `unifyTool`. `invalidPart` first rejects a slit
  face, whose boundary runs out along an edge and back, from topology alone;
  seam edges of periodic faces are exempt.
- Fillet and Chamfer check validity, shell count, cut-through, run-past ends
  and loose tolerances (`cutsThrough`, `looseBlend`).
- Shell stores an optional `body` (schema 24). With no open faces it hollows
  that body, else the first body; open faces must lie on the chosen body.
- Shell stores `direction` (schema 26): `inside` and `outside` use
  `thickness`; `both` uses `thickness` inside and `outsideThickness` outside,
  which exists only for `both`. Earlier shells migrate to `inside`.
- Shell builds each side alone and fuses inside with outside for `both`. A
  closed side cuts the body from its offset solid; an open side uses the
  kernel's thick solid with arc joins, so outer edges round at the wall
  thickness. An inside opening falls back to the inner offset joined to a slab
  over each opened inner face: a prism for a flat face, thickening for a
  rounded one.
- Every candidate qualifies before it replaces the body: valid, the same solid
  count, a hollow for inside walls, and a probe at half the wall depth behind
  each face, empty under an opened face and solid under a kept one. The
  filleted-cube cylinder opening that once kept its wall now reaches the
  fallback and qualifies. A refused, partial or unqualified result keeps the
  previous body and names the size and the reason.
- Tangent chains: `server/src/geometry/tangentEdges.ts`.

## Move

`evalMove` in `server/src/geometry/move.ts`.

- Move turns its bodies `angle` degrees about `axis`, then translates them.
  `axis` is an origin axis, a straight edge or a sketch line, as Revolve and
  Circular Pattern store it.
- Schema 29 adds `axis`, `angle` and `copy`. An earlier Move migrates to the Z
  axis, angle 0 and no copy, so it loads as translation only.
- Without `copy`, each body keeps its id and face names. Sketches drawn on
  it, or used by the feature that made it, move with it.
- With `copy`, the originals stay put and each moved body is a new body,
  named in `bodyMeta` like any other. One add is one undo step.
- An axis edge or line that no longer resolves errors the feature and keeps
  the bodies.

## Fillet and chamfer picks

`blendEdges` in `server/src/geometry/blendEdges.ts`.

- Schema 32 adds optional `faces` (face references) and `features` (feature
  ids) to Fillet and Chamfer, and `edges` may be empty when either has an
  entry. A blend with no pick is refused: "needs an edge, a face or a
  feature". An earlier document migrates unchanged.
- The picks are stored, never the edges they stand for. Each evaluation
  derives the edges: explicit edges, then each face's sharp boundary edges,
  then the sharp edges of every face a feature made (`faceMadeBy` in
  `shared/src/topoRefs.ts`: names starting `f:{id}:`, `m:{id}:` or
  `p{n}:{id}:`), each set in `compareNames` order. An edge picked twice
  blends once, at its first place. An upstream edit that adds edges to a
  picked face adds them to the blend.
- Sharp means the two faces fold by 1 degree or more; a seam or a tangent
  join is not sharp. `sharpEdgesByFace` in
  `server/src/geometry/tangentEdges.ts` owns the test, which the tangent
  chain shares. Tangent chain applies to derived edges.
- A face pick resolves, signs and repairs like any face reference. A feature
  pick is a feature input, so the blend blocks with that feature.
- A face or feature with no sharp edges errors the blend and keeps the body:
  "Fillet found no sharp edges on face {name}" or "Fillet found no sharp
  edges on the faces of feature {id}", with Chamfer for a chamfer.
- An edge-only blend passes its stored `edges` through unchanged. The size
  hint estimates from the derived edges.

## Fillet types

`moduleFillet` in `server/src/geometry/filletRoute.ts`.

- Schema 33 adds `filletType`: `equalDistance` or `twoDistances`. An earlier
  fillet migrates to `equalDistance` and builds as before.
- `twoDistances` stores `distance2` and `flip`. `radius` is distance 1 and
  lies on the measured face, chosen as Chamfer chooses it; `distance2` lies on
  the other face. Equal distances build today's fillet.
- Two distances build our own elliptical strip (`ellipticStrip.ts`), tangent
  to both faces: the image of today's round fillet under the shear that keeps
  each face and scales its tangent distance to distance 1 and distance 2. At
  90 degrees it is a quarter ellipse with semi-axes distance 1 and distance 2.
  The strip is an extruded exact ellipse, trimmed and sewn like KERN-034's
  round strips, with exact ellipse ends on end faces.
- Every picked or derived edge must be straight with flat faces at it and at
  its ends, else "two-distance fillet works on straight edges between flat
  faces". Two picked edges meeting at a corner mitre; three refuse. An edge
  with a collinear neighbour refuses, picked or not.

## Fillet sets

`evalFillet` in `server/src/geometry/blend.ts`; `filletSets` and
`withFilletSets` in `shared/src/features/fillet.ts`.

- Schema 34 adds optional `sets`: each holds `edges`, optional `faces` and
  `features`, and a `radius`. The fillet's own picks and `radius` are set 1,
  so an earlier fillet loads as one set and the migration only bumps the
  version. A binding on `/radius` stays on set 1; set 2 binds
  `/sets/0/radius`.
- Each set derives its edges as a blend does. An edge in two sets takes the
  radius of the first, and a tangent chain follows the radius of the set it
  grew from, again first set first.
- Sets of one radius build as one set holding every edge, through today's
  route. Different radii build in one kernel fillet with a radius per edge,
  so sets meeting at a vertex share a corner. It passes the same validity
  checks as any fillet.
- `sets` exists with any non-empty pick per set, and only for
  `equalDistance` once it has an entry. An empty list is one set; the dialog
  sends it to clear stored sets.
- The dialog keeps the active set in its params. The size hint sends the
  draft with the active set first, so the search sizes that set's radius on
  its edges while the others keep theirs.

## Rule fillet

`blendEdges` in `server/src/geometry/blendEdges.ts`.

- Schema 35 adds optional `betweenFaces` and `betweenFeatures` to a fillet
  and to each set: Fusion's Rule fillet, Between faces/features. Fusion's
  All edges is the plain face and feature pick.
- With either one holding an entry, the set's face and feature picks round
  only the sharp edges between one of their faces and one of the between
  faces, a feature's between faces being those it made. Picked edges still
  round as picked. A rule with no face or feature pick to start from errors,
  "a rule fillet needs a face or a feature to round from", and a rule that
  finds no such edge errors, "Fillet found no sharp edges between the picked
  faces". An earlier document migrates unchanged.
- Between picks resolve, sign and repair like the set's own picks, under
  `/betweenFaces` and `/betweenFeatures` of their set.

## Variable radius

`moduleFillet` in `server/src/geometry/filletRoute.ts`, else `nativeFillet`
in `server/src/geometry/nativeFillet.ts`.

- Schema 35 adds `filletType` `variableRadius` with `endRadius`. `radius`
  holds at the start of each edge's curve, or of the tangent chain it grows,
  and `endRadius` at its end. Swapping the two values reverses it. It takes
  one set and no size hint.
- Straight edges between flat faces, with flat faces at their ends, no
  collinear neighbour and no shared corner, build our own exact cone
  (`conicStrip.ts`): the envelope of balls tangent to both faces whose
  radius runs from `radius` to `endRadius`. The blend module gives the ball
  centre and contacts at each end; the cone's axis runs through both
  centres and its contact lines lie in the faces. Equal radii and every
  other edge build through OCCT's two-radius edge,
  `BRepFilletAPI_MakeFillet::Add(R1, R2, E)`, an approximation. The cone's
  radius is linear along the edge; OCCT's is not linear between the ends.
- Radii at more than two points need OCCT's radius-at-parameter form
  (`Add(UandR, E)`), whose array type the pinned build does not bind
  (KERN-045).

## Chamfer

`evalChamfer` in `server/src/geometry/blend.ts`.

- Schema 30 adds `chamferType`: `equalDistance`, `twoDistances` or
  `distanceAngle`. An earlier chamfer migrates to `equalDistance`.
- `equalDistance` sets `distance` on both faces and keeps its route: the
  kernel module for plane-plane and plane-cylinder edges, else OCCT, else the
  planar envelope.
- `twoDistances` stores `distance2` and `flip`; `distanceAngle` stores
  `angle` (above 0 and below 90 degrees) and `flip`. Both build only through
  `BRepFilletAPI_MakeChamfer`: `distance` lies on the measured face, and
  `distance2`, or `distance` times the tangent of `angle`, on the other.
- The measured face of an edge is a picked face when one of its two faces
  is; otherwise the one bounded by more of the selected edges; on a tie it
  is the first face in the edge name,
  `e[{faceA}|{faceB}]`. `flip` measures on the other face, so it flips every
  edge of a selection. Face names and the selection are stable, so the
  choice survives re-evaluation. A tangent chain follows the measured face of
  its first edge (`chamferContour.ts`).
- `shared/src/schema/chamferFields.ts` says which of `distance2`, `angle`
  and `flip` a fillet or chamfer type owns; an unknown type owns none. An
  edit that sets `filletType` or `chamferType` drops the fields the new type
  does not own (`dropUnownedBlendFields`).
  An edit that sends no bindings, a preview included, drops the feature's
  stored bindings whose path no longer holds a number (`bindingHolds`, used
  by `server/src/api/featureRoutes.ts`), so the staged document still
  evaluates; sent bindings are still refused when they do not resolve.
- A dialog reads the committed bindings, not the preview copy's
  (`committedLinks` in `client/src/previewBase.ts`). At OK the saved
  bindings are those plus the dialog's own edits, filtered by
  `bindingHolds`, so a type round trip inside one session restores a
  dropped binding.
- The size hint covers `equalDistance` only.

## Tolerances

`shared/src/tolerance.ts` owns `LINEAR_TOL`, `ANGULAR_TOL_DEG` and
`UNIT_DOT_TOL`, one constant per quantity even where values match.
`MIN_OFFSET_MM` in `shared/src/features/sketch.ts` is an
input bound, not a tolerance.

## Sketches

- The solver is `shared/src/solver.ts`: `shared/test/solver.test.ts`.
- An `external` point is projected or linked geometry: its position is driven,
  never solved. A dimension's `labelOffset` is a sketch UV offset from its
  default anchor, for display only; the solver ignores it. A `distance` with
  `axis: null` measures directly, and `"x"` or `"y"` measures along that axis.
- A profile id hashes its bounding entity ids. `findProfile` in
  `shared/src/profiles.ts` still finds ids saved before tangent splitting
  (DEC-101): `shared/test/profiles.test.ts`.
- Region detection drops every piece with a free end, repeatedly, before it
  traces loops, so a dangling line neither enters nor splits a profile. An id
  whose saved loop ran into a spur resolves only when exactly one pruned
  profile has the same area and directed curves that all lie on that loop. A
  sketch without spurs resolves every id as it did before pruning:
  `shared/src/profiles.test.ts`.
- A face extrude removes the regions of earlier sketches drawn on that face.
  `faceRegions` in `shared/src/faceRegions.ts` picks them for the kernel and
  the preview ghost alike: coplanar regions with area whose sampled outline
  lies strictly inside the face. Each removes its whole outline, so a region
  inside another, or a face hole inside one, adds nothing (`uncovered`). A
  subtraction the kernel cannot build, or one that splits the face, fails the
  feature and keeps the previous body.
- Create Sketch on a planar face copies its boundary into local curves: lines,
  circles, ellipses and arcs, and B-spline edges, rational, trimmed or periodic,
  as splines with exact poles, weights and knots. A copy has no projection or
  link: source changes move only the plane. Other curves refuse with
  `boundary-not-copied` unless the add sets `emptySketch`. Project links
  instead. Reference import never samples; DXF export does.
- Projections (`shared/src/projection.ts`) keep child ids `:a`, `:b` across
  regeneration. A missing source fails the sketch rather
  than keep stale points. A circle parallel to the sketch stays a circle or
  arc. A tilted circle or an ellipse projects to an exact ellipse with ids
  `:c`, `:m`, `:n`, plus `:a`, `:b` for an arc; an edge seen edge-on refuses.
  A B-spline edge projects to a spline whose poles `:p0` onward are the
  projected poles, with weights, knots and periodicity unchanged, since a
  parallel projection is affine. A curved one whose poles fall on a line
  refuses as edge-on; one whose poles meet at a point refuses as a point.
  Edge signatures still record an elliptical edge as `other`.
- Schema 38 lets a projection name a curve of an earlier sketch,
  `{ kind: "sketchEntity", sketchId, entityId }`, beside an edge.
  `sketchSpaceCurve` in `shared/src/projection.ts` carries the evaluated
  curve through its sketch frame into space, and `projectEdge` projects it as
  it does an edge, so child ids, curve types and refusals match. Evaluation
  sees only sketches before the projecting one. A later, own or cyclic
  source fails the sketch as a deleted or suppressed source or a removed
  curve does, with the error
  `Projected sketch entity <id> of <sketch> is missing`; stored positions
  never stand in. Coincident, midpoint and tangent relations on projected
  points and curves follow the source, since external points are driven; a
  point placed by a positional snap holds no relation and stays. Earlier
  documents read the same, so the step only bumps the version, which makes
  an older server refuse a newer file by version.
- Schema 39 lets a projection name a face, `{ kind: "face", bodyId,
faceName }`, or a body, `{ kind: "body", bodyId }`. Either is a group: the
  project call takes a colon-free root id, and every member curve
  `<root>:<key>` stores the same reference, so evaluation in
  `refreshProjections` (`server/src/geometry/projectSource.ts`) rebuilds the
  whole group and adds or drops members as the source gains or loses edges.
  A relation on a dropped member stays stored, leaves the solve, and the
  sketch reports a `warning`: `Relation <id> lost its projected curve
<member>; re-attach or delete it.` The project call refuses a root the
  sketch already holds. A member's key is the first 8 hex digits of the
  SHA-256 of its source, never its position, so it survives a resize and a
  neighbour's change; seam edges are skipped, and a face seen edge-on
  refuses. A face member's source is its edge name. A body projects its
  outline (`bodyOutline` in `server/src/geometry/bodyOutline.ts`): the union
  of the shadows of its planar faces and of its cylindrical faces split at
  their silhouettes, with holes kept as inner loops, as exact lines, circles
  and ellipses. An outline curve's source is the body edge it lies on, or
  for a silhouette the cylinder's face name and side (`<face>/+` or
  `<face>/-`); where several project onto it, the lowest key wins. Pieces of
  one source split by the union are `<key>-1` onward along the source. A
  body with any other surface refuses. A lost face or body blocks the
  sketch through the reference lifecycle, as an edge does. Projection onto a
  surface waits for surface modelling.
- Schema 40 adds a section, `{ kind: "section", of }`, where `of` is a face
  or body reference: the curves where that face or body crosses the sketch
  plane. It is a group like a face or body projection, with the same root,
  member keys, refresh and lost-relation warning. `bodySection`
  (`server/src/geometry/bodySection.ts`) cuts with the kernel's plane
  section, so curves are exact: lines, circles, ellipses, or B-splines on
  freeform faces. A curve's source is the face it lies on, the lowest name
  where it lies on two; pieces of one face are `<key>-1` onward by position
  in the sketch plane. A curve where the face only touches the plane
  (coplanar, or tangent as a cylinder side is) is left out. The project
  call refuses a section with no crossing curve: `The sketch plane misses
this body.` or `only touches this body.`, then `Choose a body the plane
crosses.` When an upstream change empties a stored section, the sketch
  keeps the reference and warns `Section <root> is empty: the sketch plane
misses body <id>.`; the curves return when the source crosses again. The
  Project selection list picks Face sections and Body sections. Earlier
  documents read the same, so the step only bumps the version. Slice
  (PAR-012) stays a view clip and stores nothing.
- A sketch arc runs counter-clockwise from `start` to `end` about `center`.
  The solver holds both ends at one radius.
- `editSketchOffset` in `shared/src/sketchOffsets.ts` keeps generated entity
  ids: `shared/test/sketchOffsets.test.ts`.
- Trim (`shared/src/sketchTrim.ts`) and extend (`extendSketch` in
  `shared/src/sketchModify.ts`) keep unchanged endpoints:
  `shared/test/sketchModify.test.ts`.
- `editedEntities` in `shared/src/solver.ts` refuses a write whose added or
  changed constraints stop a converging sketch from converging, and names the
  first such constraint. Client and server both call it. A sketch already in
  conflict is not refused.
- Schema 25 adds the sketch `ellipse`: `center`, `major` and `minor` point ids,
  with the longer axis taken as major. The solver keeps the axes perpendicular
  as it keeps arc radii equal. Validation in `shared/src/features/sketch.ts`
  refuses zero or non-perpendicular axes. On the ellipse curve it accepts only
  `pointOnCircle` and `tangent` to a line, solved by `ellipseLevel` and
  `ellipseLineGap` in `shared/src/sketchCurves.ts`; other constraints refuse.
  A solve weakly holds the points of every ellipse not being dragged, so a new
  constraint moves the other curve rather than resizing the ellipse:
  `shared/test/ellipseConstraints.test.ts`. Schema 28 adds optional `start`
  and `end` points: an elliptical arc runs counter-clockwise from start to
  end, and the solver holds each end on the curve. A line splits an ellipse
  or elliptical arc at their exact intersections. Contact with a circle, arc
  or other ellipse forms no region and the sketch warns; profile ids saved
  earlier still resolve. Trim, extend, offset and sweep paths refuse
  ellipses. `pieceEdge` in `server/src/geometry/sketchEdges.ts` builds the
  exact `gp_Elips` edge between snapped ends: `shared/test/ellipse.test.ts`,
  `shared/test/ellipticalArc.test.ts`.
- The solver skips a dimension with `driven: true`. The field is optional, so
  sketches saved without it load unchanged with no schema step. A driven
  dimension shows its measured value in parentheses and follows the geometry
  its driving dimensions set.
- `shared/src/solver.ts` minimises constraint residuals with
  Levenberg-Marquardt on a numeric Jacobian, the same code in the browser
  and on the server; degrees of freedom are variables minus Jacobian rank. A
  newly driving constraint whose rows raise no rank in their component is
  redundant and refused by name (`shared/src/solverRank.ts`); tools and trim
  drop such a relation they inferred.
- `shared/src/bspline.ts` holds B-spline data as the kernel's
  `Geom_BSplineCurve` does: degree, poles, optional weights, distinct knots,
  multiplicities and an optional periodic flag. `bsplineProblem` refuses what
  the kernel refuses, and an open spline must be clamped. A periodic curve
  repeats over its knot span, `last - first`, with its poles in the kernel's
  order. `dxfSplines` in `shared/src/importDxf.ts` reads SPLINE records
  into that form; a closed SPLINE whose last `degree` poles repeat its first
  becomes periodic. Fit-point-only, unclamped open and malformed records are
  skipped with a reason: `shared/test/spline.test.ts`.
- Schema 36 adds the sketch `spline`: `degree`, `poles` as point ids,
  optional `weights`, `knots`, `multiplicities` and optional `periodic`.
  Validation refuses what `bsplineProblem` refuses, and constraints on the
  curve itself other than an end tangent or smooth; constraints on its poles stay. `importDxf` builds one from a
  SPLINE whose normal is Z, passing scale only to `sketchBuilder`. An open
  spline is clamped, so its end poles are its ends and share the points of
  touching curves; a periodic one closes on itself. Dragging a pole moves the
  curve through the generic point paths. Open splines join other curves at
  their ends to form regions, and an end pole may cut a line or arc. A
  periodic spline, or a clamped one whose end poles meet, closes alone like a
  circle, with no ends. A curve touching a spline off its ends removes the
  spline from regions and the sketch warns (`regionWarning` in
  `shared/src/curveLimits.ts`); trim refuses both curves. That contact test
  samples each knot span and refines the nearest gap; it is not an exact
  intersection. `pieceEdge` builds the exact `Geom_BSplineCurve` edge, so
  sides name after the spline and solids keep its exact data. Trim, extend,
  offset, dimensions, relations other than an end tangent or smooth, and sweep paths
  refuse it. DXF export samples it, since the R12 writer has no SPLINE
  entity: `shared/test/spline.test.ts`.
- Schema 37 adds `fitSpline` and the spline's optional `rho`, storing
  defining points and deriving poles, so every stored point stays a solver
  unknown and the migration is version only. A `fitSpline` keeps `points`
  and two `handles`; `interpolateFit` in `shared/src/bspline.ts` builds the
  cubic through every fit point at chord-length parameters, with each handle
  as the second pole from its end, so the end tangent points at the handle.
  A conic is a `spline` of degree 2 over start, apex and end with `rho` in
  (0, 1); `conicSpline` derives the middle weight `rho / (1 - rho)`, putting
  the shoulder at `rho` of the way from the chord midpoint to the apex. The
  control point tool draws a clamped uniform `spline` of degree up to 3.
  A tangent on a spline needs an end shared with a line, arc or spline, by
  point or coincident; `splineTangent` in `shared/src/splineJoints.ts` finds
  it and the solver holds the end directions parallel, or perpendicular to
  the radius for an arc: `shared/test/splineConstraints.test.ts`.
- Schema 45 adds two relations; earlier documents read the same, so the step
  only bumps the version. `symmetric` holds `a` and `b`, two points, two lines
  or two circles or arcs, mirrored across the line `line`: points and centres
  mirror exactly, circles and arcs keep equal radii, and each line's mirror
  lies on the other line, as infinite lines. `smooth` is Fusion's curvature
  continuous (G2) join between a spline and the line, arc or spline at its
  end, found as for an end tangent: it holds the tangent and matches the
  curvature vectors at the join (zero for a line, towards the centre for an
  arc). `endDerivatives` in `shared/src/bspline.ts` gives the end derivatives
  of a clamped, possibly rational spline; `shared/src/solverRelations.ts`
  owns both relations' rows and the symmetric pairing rule that validation
  shares. The curvature row compares second derivatives scaled by speed, so a
  handle cannot cross its end, normalised by the stored geometry. Adding
  Smooth replaces a Tangent on the same pair. Both appear in the sketch
  selection's right-click menu; toolbar buttons wait for icons:
  `shared/test/sketchSymmetric.test.ts`, `shared/test/splineSmooth.test.ts`.

## Frame conventions

`server/src/geometry/frames.ts` owns sketch frames. Origin planes use
`ORIGIN_FRAMES`. A face frame's origin is the point on its plane closest to
the global origin, so a sketch rides its face. Construction plane methods:
`shared/src/features/constructionPlane.ts`. Placements:
`shared/src/placement.ts`, `shared/test/placement.test.ts`.

## Tessellation

`server/src/geometry/tessellate.ts`, `server/src/geometry/edgeCurve.ts` and
`server/src/geometry/mesh.ts`. Every face triangle range, edge polyline and
vertex carries its persistent name, so selection is topology, never a triangle
index. The viewport meshes through `meshShape`, which meshes only faces
without an exact triangle. Export meshes a copy through `meshCopy`, which
skips BRepMesh only when every face has one. Export formats:
`server/src/geometry/exporters.ts`.

Under naming version 2, a closed single-part mesh import stays a mesh body
(`server/src/geometry/meshBody.ts`). It draws from its triangles, one face
per triangle named `x{n}` as version 2 names unnamed faces, with no edges or
vertices, and sews into a solid only when a feature, an export or a
measurement reads its shape. The solid keeps each triangle's name. Version 1
documents and open or multi-part meshes sew on import. An import over 1,000,000 triangles is
refused before any meshing, and the import read budget bounds file bytes. A cut
through a mesh body over `MESH_LIMITS.cutTriangles` triangles, sized from the
measured kernel heap per triangle and the 4 GiB WASM heap, errors before it
runs the boolean and keeps the previous body.

## Naming upgrade

`server/src/store/namingUpgrade.ts` moves a version 1 document to version 2
only when the user asks, after a `naming1-{hash}` backup of the complete
project. A browser project first keeps its version 1 record in this browser
as `<name> (before naming upgrade)`, and nothing commits if that copy fails
(`client/src/browserProjects.ts`). `planNamingUpgrade` in `server/src/geometry/upgradeNaming.ts` proves
a mapping by provenance only, never by an `x{n}` or `~n` name. The commit
refuses while a `candidate` or `ambiguous` mapping lacks a choice or a
feature fails only under version 2, and writes one save. After the save it remaps each user's hidden body ids through the
final-body mappings; a remap failure after the save is a `kept` error. Vertex references are not mapped. A version 1 copy name compares
by its version 2 form, each `m:` or `p{i}:` prefix applied as a key from
the inside out.

## Reference signatures

Feature add and update fill each missing `sig` from the state before the
feature and keep one sent with the reference. A reference sent without `sig`
keeps the one its name already had, so reference repair signs an accepted or
re-picked reference first (`ROUTES.refSignature`) and sends that `sig`.
`collectTopoRefs` in `shared/src/topoRefs.ts` derives face and edge paths
from `FeatureSpec.refs`.
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

## Extrude

- `distance` is signed mm along the resolved direction and never zero; a
  negative value extrudes to the other side. `faces` are planar body faces
  used as profiles, each along its own outward normal. `startOffset` moves
  the start plane along the profile normal, signed, default 0.
- `extent` (schema 41) follows Fusion's Extent. Absent is Distance and
  evaluates as before. `{ kind: "all" }` runs through the farthest point of
  every body along the direction, measured exactly in the direction's frame;
  Symmetric runs through all on both sides, Two sided only on side 1.
  `{ kind: "toObject", object }` stops on a `PlaneRef` (origin, construction
  plane or planar face, extended as an infinite plane) or a `BodyRef`. The
  object picks the side, so `direction` and the distance sign are unused,
  and Symmetric or Two sided is refused. The new end face is
  `f:{featureId}:cap:end`. The spec registers the object at `/extent/object`
  or `/extent/object/bodyId`, so the reference lifecycle and repair reach it.
- `startObject` (schema 42) follows Fusion's Start Object: a `PlaneRef`,
  extended as an infinite plane, that the solid starts on instead of the
  profile plane. Absent is Profile plane, or Offset when `startOffset` is
  set, and evaluates as before. The profile is projected along its normal
  onto the plane, so on a slanted plane the start face lies on it and a
  Distance end face is the start plane moved by the distance. `startOffset`
  still moves the start along the profile normal. Every extent combines
  with it: Distance, Symmetric and Two sided measure from the plane; All
  runs from it through the farthest body (Symmetric All ignores it); To
  object runs between it and the target plane in whichever order they lie,
  or from it to a body. The new start face is `f:{featureId}:cap:start`.
  The spec registers it at `/startObject`, as for the extent object.
- `taper` and `taper2` (schema 43) follow Fusion's Taper Angle: degrees,
  strictly between -90 and 90, absent is 0 and evaluates as before. The
  sign is Fusion's: negative tapers inward, so the solid narrows away from
  its start, and positive tapers outward. `taper` is side 1 and both halves
  of Symmetric; `taper2` is side 2 of Two sided and unused otherwise. The
  taper is measured from the start: the profile plane, the offset start or
  a Start object parallel to the profile. Every extent takes it; To object
  and All trim the tapered solid with the same half-space or body cut, so a
  slanted end face still lies on its plane.
- The kernel build binds no draft or drafted prism, so each section is the
  profile's 2D offset by distance times tan angle (intersection joins), the
  sections of each profile loop are ruled, and the sides and end caps are
  sewn into one solid. A sketch line gives a side on its exact plane; a
  circle or arc gives a cone, so round corners stay concentric and tangent;
  other curves, such as splines, give a ruled B-spline side to the kernel's
  offset curve. Holes taper with the profile, widening as the outside
  narrows. Symmetric and Two sided give two side faces per sketch entity,
  named with the usual `~1` and `~2` suffixes. Construction:
  `server/src/geometry/taper.ts`.
- `thin` (schema 44) follows Fusion's Thin Extrude: `{ location, thickness }`
  with `location` `inside`, `outside` or `centre` and `thickness` in mm.
  Absent is a solid extrude and evaluates as before. Each profile becomes
  the region between two 2D offsets of its boundary, outward `0` and
  `-thickness` for `inside`, `thickness` and `0` for `outside`, and half
  the thickness each way for `centre`. The offset uses intersection joins,
  so outside corners stay sharp, as in Fusion. Every loop is walled, so a
  hole gets its own ring. The wall face then takes every Start and extent
  option unchanged: Distance, Symmetric, Two sided, To object and All trim
  it with their usual cuts. Disjoint rings give one body each, and a
  groove cut through a body frees its core as a body. Both sides of a wall
  take the sketch curve's side name, with `~1` and `~2` in centroid order.
- `curves` (schema 44) are `SketchEntityRef`s to open sketch curves, allowed
  only with `thin`. Picked curves join end to end into open chains in any
  pick order, and each chain is walled along its curves with square ends.
  A chain runs in its first picked curve's own direction (a line from `p1`
  to `p2`, an arc from start to end). Seen from the sketch normal,
  `inside` lies to the left of that direction, as the inside of a
  counterclockwise loop does, and `outside` to the right. The end faces
  take fallback names. The spec registers each curve at `/curves/{i}`.
  Construction: `server/src/geometry/thin.ts`, through the offset step of
  `taper.ts`.
- Refusals: a plane parallel to the direction, a plane crossing or touching
  the profile, a body level with the profile, a profile starting inside the
  body, a profile that does not fully meet the body, and All with no body
  ahead. With a start object: a start plane parallel to the direction, and
  a To object plane meeting it over the profile. With a taper: an offset
  that closes the profile or drops one of its edges before the far end of
  the built solid (for To object that end lies past the target), and a
  Start object not parallel to the profile. With thin: a wall the profile
  cannot hold (the offset closes it or drops an edge), picked curves that
  close a loop (pick its profile) or fork, a missing or construction
  curve, and any taper. Evaluation: `server/src/geometry/extrude.ts`.
- Not yet: a start or To object on a curved face, a taper from a slanted
  Start object, and a taper on a thin extrude.

## Tool targets

Extrude, revolve, sweep, loft and emboss store an explicit pick as `targets`.
Hidden bodies are never default participants, and evaluation never reads the
view.

An empty `targets` makes a join a new body. On a cut or intersect it fails
the feature with `{operation} has no target body` and keeps every body. With
no `targets` and no body, every tool operation makes a new body; only a join
reports `[]`, so a cut or intersect never pins an empty list
(`applyToolOperation` in `server/src/geometry/boolean.ts`).

Schema 47 adds the Auto form, `autoTargets: { exclude, features }`: the
bodies hidden at creation and the ids of the features whose bodies existed
then. A tool stores `targets` or `autoTargets`, never both. Earlier documents
read the same and the step changes only the version.

Add and update give a tool that stores neither form the default choice: the
Auto form in a version 2 document, the `targets` the default gave in a version
1 document (`DocumentEngine.defaultTargets` in
`server/src/geometry/engine.ts`). A tool whose evaluation reports no targets,
such as a new body, stores neither. The server owns the Auto form: a client's
`autoTargets` only asks for it, and an update keeps the stored one until a
pick replaces it. The edit dialog resends the stored form and lists the bodies
`autoTarget` admits: `client/src/toolTargets.ts`.

An Auto tool takes the default participants from the bodies a listed feature
made, less `exclude`, so a body inserted earlier in the timeline stays out and
a pattern stores one id however many copies it makes. A face join puts its
start body first so that body keeps its id. A tool with no eligible body acts
as a tool in a document with no body (`autoTarget` and `autoTargetsAt` in
`shared/src/topoRefs.ts`, `applyToolOperation`).

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

`ExpressionField` in `client/src/components/form/expressionField.tsx` owns
every numeric field: it evaluates text with the shared parser and the
document's parameters, keeps bounds and stepping, and shows errors on the
field. A feature field names its binding path; text that uses a parameter
links, a constant calculates once, and a handle that sets a new value unlinks.
In a non-mm display unit a unitless linked result is stored with that unit.
Quick Edit and the reference image scale, rotation and U/V fields link the
same way. `client/src/features/bindings.ts` owns the links a field edit
stages. Every feature dialog and Quick Edit preview and save of an edit sends
the whole bindings list with the feature patch, so the preview shows the
edited expression or typed constant instead of the stored link. While the
store shows a preview copy, `committedLinks` in `client/src/previewBase.ts`
answers the links from before that preview, even after its dialog closes and
another opens. OK compares against them, so a link-only change still saves
and a cancelled preview's links never reach another feature. The Parameters
panel and sketch edits read the same committed links. The edit and its links
save in one feature write and one undo step. Cancel aborts the preview and
restores the stored link. A new feature saves with its bindings as one staged
transaction. Staged links count as a staged field in
`client/src/previewSession.ts`: a save that sends no links, such as a rename,
suppress or reference repair, aborts a preview that staged links and writes
over the stored ones, so it never commits the previewed links.

A sketch dimension links through the same field. A binding path names an array
index, so `movedBindings` in `shared/src/parameters.ts` moves a binding with the
item id it names and drops it when the item goes. `commitDraftSketch` sends the
moved bindings with the sketch edit; a driven dimension keeps no link. A sketch
opened for editing shows resolved dimension values.

Core feature schemas live in `shared/src/schema/coreFeatures.ts`, below the
parameter resolver and document validation. `schema/features.ts` retains their
public exports alongside the document schemas. The cached parser lives in
`schema/validation.ts` without document or feature imports.
