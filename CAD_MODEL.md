# CAD model

How Rockett CAD represents, regenerates, names, tessellates, measures and
exports geometry. This is the most load-bearing document in the repo.

## B-Rep representation

The authoritative model is OpenCascade B-Rep: each **body** is a
`TopoDS_Solid` (occasionally several solids when an operation splits a body).
The document (`shared/src/model.ts`) stores the _recipe_: sketches with
constraints, features with parameters and references, and imported
geometry: an STL, OBJ or 3MF file inline, and a STEP, IGES or BREP file by
the sha256 of its blob.
Geometry exists only inside the evaluation state and its caches, and is
rebuilt from the recipe on demand. Saved projects are JSON, and the modelling
history survives close/reopen; embedded mesh imports increase document size.

### STEP, IGES and BREP imports

Schema version 3 adds `importStep` features containing `filename` and the
original STEP text in `data`. Schema 8 moves that text to the project's blob
store: the feature holds `blob`, the sha256 of the UTF-8 bytes, and
`projects/<id>/blobs/<sha256>` holds the bytes the kernel reads. Routes load
the blobs a document names before they evaluate it, so the engine's cache key
for the feature is its small JSON, not the file. The 7 to 8 migration hashes
each inline `data`, and the next save writes the blob before the document
that drops `data`; until then a read serves the bytes from the stored
document. OCCT reads this source during regeneration,
normalizes lengths to millimetres, and registers each solid as a body. A
document snapshot carries the hash, and the blob stays in the project, so undo
restores the import; duplicates and project files copy the bytes. Imports can be
suppressed, deleted, or rolled back, and downstream features reference their
named faces and edges. Assembly hierarchy, appearance, and source design
history are not retained. Surface-only files are rejected; solid bodies are
retained from mixed files. Each upload is limited to 10 MB.

An `importStep` feature may also hold an IGES or BREP file, marked by an
optional `format` of `iges` or `brep`; absent means STEP. IGES reads through
`IGESControl_Reader`, converting to millimetres, and BREP through
`BRepTools::Read` (the ASCII format that `BRepTools::Write` produces).
`server/src/geometry/importers.ts` owns all three readers. A file that yields
no solid is rejected as `No solid found in the IGES file.`, naming its format,
so an IGES file written as trimmed faces only is rejected rather than sewn.
The field needs no schema step: documents saved before it have no `format`
and still read as STEP, so schema 5 stands. A build older than this one reads
an IGES or BREP import as STEP and reports that feature as failed.

### STL, OBJ and 3MF imports

An `importMesh` feature holds `filename`, `format` (`stl`, `obj` or `3mf`) and
the original file as base64 in `data`, so binary STL survives JSON.
Regeneration reads STL and OBJ with `RWStl` or `RWObj`, which merge coincident
nodes. Each triangle becomes a planar face over shared vertices and edges, and
`BRepBuilderAPI_Sewing` joins them. With no free edges each shell becomes a
solid, reversed if its volume is negative. Otherwise the sewn shell is the body
and the feature status is `warning`, naming the open edge count. Meshes over
200,000 triangles fail with their count. Faces stay triangles, so a mesh body
is not parametric and has one face per triangle. Each face also carries its
triangle as an exact triangulation, which the viewport and export read
instead of running `BRepMesh` (see Tessellation).

OCCT's STL reader takes a file as ASCII when its first 134 bytes are all
printable, which misreads a binary cube with small coordinates. When the size
is exactly 84 bytes plus 50 per declared facet, the reader's copy gets a
non-ASCII first header byte, forcing the binary path. The stored data is not
changed.

A 3MF is read in TypeScript: a central-directory zip reader over `node:zlib`
finds the model part named by `_rels/.rels` (else `3D/3dmodel.model`) and
inflates it with a 256 MB output cap. Each build item's mesh object is scaled
from the model `unit` to millimetres, moved by the item transform and sewn on
its own, so touching objects stay separate bodies. If any object is open, the
whole file is one shell body with the warning. Objects built from `components`
are rejected.

The feature needs no schema step: no saved document changes meaning, so
schema 5 stands. A build older than this one loads such a project, reports the
`importMesh` feature as an unknown type error and refuses to save a full
document containing it, so nothing is lost.

## Body identity

Bodies get stable ids derived from the feature that created them:

- `b:{featureId}`: a `newBody` extrude/revolve/sweep/loft. A `newBody`
  extrude/revolve/sweep of several sketch regions makes one body per region
  (`b:x`, `b:x:2`, …), in selection order under `namingVersion` 1 and in
  face name order under version 2; `join` is what merges regions into a
  single solid (with no existing body to join, the merged solid becomes the new
  body).
- Boolean join/cut keep the _target_ body's id.
- Under `namingVersion` 1 a join fuses its whole tool into the first body its
  bounding box overlaps, so tool solids over other bodies become `b:{body}:n`.
  Under version 2 each tool solid fuses into every body it touches or
  overlaps, found by bounding box, then by kernel distance, then by a fuse
  that must give one solid, so a tool solid meeting a body only along an edge
  or at a vertex stays a new body. Each result is unified. Bodies one tool
  solid bridges become one body under the id that comes first in stored
  `targets`. Without them the first id wins, digit runs compared as
  numbers, so `b:x:2` wins over `b:x:10`.
  Tool solids that touch no body become `b:{featureId}`,
  `b:{featureId}:2`, … in face name order. Stored `targets` choose the
  bodies instead; see Tool targets.
- An operation that leaves multiple solids appends ordinal suffixes
  (`b:x`, `b:x:2`, …). Under version 1 they follow volume. Under version 2
  `assignBodyIds` sorts the pieces by their smallest face name that no other
  piece bears, comparing digit runs as numbers, so a pattern's original keeps
  `b:x` and `~2` sorts before `~10`. A new body built from a sketch region
  also bears `r:{profileId}`, so halves of a split circle, whose faces share
  every name, still differ. A piece with no name of its own is an identity
  conflict and fails the feature. `splitBody` orders along the
  split-plane normal (`b:x`, `b:x:s2`).

A body's display name lives in `document.bodyMeta[bodyId]` and is assigned
server-side the first time a body id appears (`Body1`, `Body2`, …). Which
bodies, sketches and reference images are hidden lives outside the document,
in `view.json` (see [API.md](API.md), View state). The 10 to 11 migration
moves every `visible` flag there, unless the project already has a
`view.json`, and drops the unused `camera`.

`document.groups` holds model tree folders: `{ id, name, kind, members }`,
where `kind` is `body` or `sketch` and `members` are body ids or sketch feature
ids, each in at most one group. Groups never reach evaluation or export. After
an evaluation the server drops sketch members whose feature is gone and, when
the evaluation reaches the end of the timeline, body members it did not
produce. A rolled back timeline keeps them; an empty group stays until
ungrouped. Components with their own coordinate systems belong to assemblies.

## Topological naming (persistent references)

The classic CAD problem: "Fillet the third face" breaks the moment an
upstream edit renumbers faces. Rockett CAD never references topology by
index. Instead:

### Face names

Every face of every body carries a persistent string name assigned when it is
created and _propagated_ through later operations:

| Origin                                                  | Name                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Extrude/revolve side face generated from a sketch curve | `f:{featureId}:s:{sketchEntityId}`                                 |
| Extrude/revolve cap                                     | `f:{featureId}:cap:start` / `f:{featureId}:cap:end`                |
| Sweep side face and cap, under `namingVersion` 2        | as extrude, from the profile curve and the pipe's ends             |
| Loft side face and cap, under `namingVersion` 2         | as extrude, from the first section's curve and the end sections    |
| Fillet/chamfer face generated from an edge              | `f:{featureId}:fe:{n}`                                             |
| Press/pull moved face, under `namingVersion` 2          | the source face's name                                             |
| Mirrored / patterned copy                               | `m:{featureId}:{originalName}` / `p{i}:{featureId}:{originalName}` |
| STEP, IGES or BREP import face, under `namingVersion` 2 | `f:{featureId}:g:{surface}:{key}` (see Signatures)                 |
| Anything the history cannot attribute                   | `f:{featureId}:x{n}` (deterministic centroid order)                |

Propagation uses the kernel's own history API. For every boolean, fillet,
chamfer, shell, or offset operation we walk the input faces and ask OCCT
`IsDeleted` / `Modified` / `Generated`:

- deleted → the name dies with the face;
- modified → each resulting face inherits the input face's name;
- untouched → the face (same TShape) keeps its name;
- new faces → named by their generating entity where the operation reports it
  (e.g. `MakePrism.Generated(edge)`, `MakeFillet.Generated(edge)`). Revolve
  and, under `namingVersion` 2, sweep and loft share `sweptNames` in
  `server/src/geometry/naming.ts`. Under version 2 it then names a face the
  history misses, such as the end annulus of a full revolve, from the profile
  edge whose midpoint lies on it (`nameFromEdges`). Anything left gets the
  deterministic fallback. Under version 1 a sweep or loft has only fallback
  names.

A name map is a `ShapeMap` (`server/src/geometry/shapeMap.ts`): the shape hash
only picks a bucket, and a lookup matches with OCCT's `IsSame` (same TShape
and location), so two faces whose hashes collide keep their own names.

When one input face yields several result faces (e.g. a boolean splits a
face) the copies are disambiguated with a `~n` suffix in centroid order: by
x, then y, then z. `suffixDuplicates` in `server/src/geometry/naming.ts` owns
that order for faces, edges and vertices; a vertex sorts by its point. The
document's `namingVersion` picks the comparison. Version 1 compares exact
coordinates, so kernel noise of 1e-12 mm in x can decide between two faces
10 mm apart in y. Version 2 first rounds each coordinate to a multiple of
`LINEAR_TOL`, so noise below that tolerance decides nothing unless it
crosses a rounding threshold. Under version 2, candidates whose rounded
centroids are equal get `~?n` instead of `~n`: the `?` reports that their
order is not persistent. A merge drops `~?n` as it drops `~n`. The fallback
`x{n}` numbers use the same comparison, but fallback faces whose rounded
centroids are equal get no `?` and keep kernel order.

An extrude's `distance` is signed: a negative value builds the prism on the
opposite side of the sketch plane (after `direction` is applied; `symmetric`
ignores the sign). An optional `startOffset` moves the start plane along the
profile's (or face's) own normal before the distance is applied (Fusion's
"Start → Offset"), so a boss or cut can begin above or below the sketch.
A new extrude picks its operation from the bounding box of its tool against
the bodies that exist before the feature (`extrudeOperation` in
`client/src/extrudeReach.ts`): Cut, previewed in red, when the tool goes into
the part (a negative distance, Reversed, or the arrow dragged below the
plane) and overlaps a body; Join when it touches or overlaps a body; New body
when it meets none. The choice follows the selection, distance, direction and
start offset until the user picks an operation, which then stays. Editing an
extrude keeps its stored operation. The kernel makes a Join that meets no
body a new body `b:<featureId>`, so the geometry matches New body, but the
stored Join fuses once an earlier edit puts a body in its path.

Extrude, revolve and sweep tools built from several sketch regions pass
through `ShapeUpgrade_UnifySameDomain` before the boolean, so adjacent regions
become one face instead of showing the sketch's internal boundaries as edges.
A sweep of one region keeps its tool as the pipe made it, as before BUG-075
swept every region. Names follow the unify history: a face merged from several
inputs takes their shared base name (the `~n` suffix dropped), or the first
distinct base name in sorted order when they differ. An extrude, revolve,
sweep or loft join also unifies the fused result. Under `namingVersion` 1 the
other joins keep their seams:
Combine join, Mirror and both patterns with combine, and an outward press/pull,
so saved references to a merged half still resolve. Under version 2 those
joins unify their result as well. Under version 2 two planar faces count as
one surface when they stay within `LINEAR_TOL` of each other across the
shape: the unify takes `LINEAR_TOL` as its linear tolerance and `LINEAR_TOL`
over the shape's bounding box diagonal, at least 1 mm, as its angular one.
The sketch solver stops with constrained lines up to about 1e-10 mm off, so a
mirror of a constrained sketch met its original at about 3e-12 rad, above the
kernel's default 1e-12 rad, and kept a seam no fillet can take (BUG-073).
Version 1 keeps the kernel defaults, so saved names stay. The pinned OCCT fork
accepts explicitly selected planar folds down to the tested 1 degree for
Fillet and Chamfer; its contour check still rejects a nearly tangent 0.001
degree fold. Nonplanar faces retain the 0.1 rad G1 continuity check. Two
cylinder faces merge only when their
surfaces share the same X and Y axes. OCCT 7.6 never returned from merging a
fillet's cylinder with a coaxial prism cylinder whose angle starts a quarter
turn away, so cylinders whose axes differ keep the edge between them
(BUG-041). The guard stays on OCCT 8.0.1, where this case has not been
retried.

Chamfers go through the kernel's `BRepFilletAPI_MakeChamfer` first. That
algorithm cannot remove a face the chamfer consumes entirely (two 3.5 mm
chamfers meeting mid-wall on a 7 mm plate), so when it fails and the selected
edges are the complete outline of a planar cap ringed by perpendicular planar
walls at least `distance` deep, the chamfer is built as a boolean instead: the
body is intersected with an envelope made of exact planar quads between each
outline edge (moved `distance` deeper) and its inward-offset counterpart, plus
a generous prism beyond. Holes in the cap are left alone (only the outer
outline is offset), so a through-hole survives untouched. The new faces are
named `f:{featureId}:fe:{n}` per source edge, exactly as the kernel path names
them.

A fillet or chamfer whose edges lie on several bodies blends each body on its
own, in the order of its first picked edge, and keeps each body's id. The tangent
chain runs within each body, `n` counts that body's source edges, and an error
names the body when there is more than one.

Fillet, Chamfer and Shell run the kernel validity check, `BRepCheck_Analyzer`,
on their result, since the kernel can report success and still leave an invalid
shape.
A 0.8 mm shell of a 5 or 10 degree wedge with 1 mm top fillets leaves an
invalid face near the rim. An invalid result is a feature error that names the
kind of part the check rejects and keeps the previous body. When the body was
already invalid before the feature, the error says the fault comes from an
earlier feature.

`BRepCheck_Analyzer` does not report faces crossing each other, so a fillet or
chamfer that is too large can cut through the body and still pass it. Fillet
and Chamfer also reject such a result with an error that it cuts through the
body, and keep the previous body. The faces the blend generated go through a
general fuse, `BRepAlgoAPI_BuilderAlgo`, against every face that shares no edge
with them. Any section edge means a crossing. Neighbours are left out because a
blend meets them along its own edges, and intersecting tangent faces is slow.
A blend also must not change the number of shells: a fillet into the cavity of
a closed shell can return the box with the cavity filled in. The pinned kernel
binds neither `BOPAlgo_ArgumentAnalyzer` nor `BRepAlgoAPI_Check`. On the
many-body fillet drag benchmark the check adds about 3 ms to a 19 ms median.
A blend also must not run past the end of its edges. Where a contour ends at
a vertex that no other blended edge reaches, and the faces there give the
blend nothing to stop on, the kernel prolongs it to the next face it meets and
generates a face from that vertex. On a stepped block with a chamfered corner
this hangs a spike past the edge end at every radius, sometimes inside the
body's bounding box, and the fuse finds no crossing in it after seconds of
work. Fillet and Chamfer error when an open contour end that no other
blended edge reaches generated a face, and keep the previous body. This runs
before the fuse. Corner patches where several blended edges meet are allowed.
Chamfer's envelope fallback is a boolean, so its faces cannot cross, but it can
open a cavity: it gets the shell count check only. Shell gets no cut-through
check: on the pinned kernel its offset fails rather than build a wall that
crosses another face, and a closed shell's hollow is a boolean cut. Size hints
build each trial through the feature, so they never offer a size that cuts
through or runs past its edges.

A shell must also leave a hollow. When the wall reaches half the body, or a
fillet radius, the kernel can return the solid unshelled and report success.
Shell errors when the result keeps no volume, or removes no more than a
skin of `LINEAR_TOL` times the body area, and keeps the previous body.

A cut can also pass `BRepCheck_Analyzer` and be inside out. On a body with a
fillet between a face and a curved wall, a face extrude cut whose straight
side crosses the fillet came back removing the whole tool, air included. Faces
of the tool were kept in the air, so the viewport culled them and showed what
lay behind. Neither a fuzzy value nor a longer tool gave a sound result. Every
face a cut takes from its tool bounds removed material, so it must lie inside
the body before the cut. The cut classifies one interior point of each such
face against that body, and a point outside it is a feature error that keeps
the previous body.

Sketch-curve attribution deserves a note: wire construction can rebuild edge
shapes (vertex merging), so after building a profile face we re-derive the
edge→sketch-entity map _geometrically_ (each face edge's midpoint is matched
against the sketch curves) rather than trusting construction-time handles.

### Edge and vertex names

Edges and vertices are named from their adjacent faces, inheriting face-name
stability:

```
e[{faceA}|{faceB}]          edge bounded by two faces (names sorted)
e[{faceA}|seam]             seam edge (cylinder seam etc.)
v[{faceA}|{faceB}|{faceC}]  vertex named by its adjacent faces
```

Multiple edges sharing the same face pair (e.g. the two circles bounding a
cylindrical hole wall meet the same faces in some topologies) get `~n`
suffixes in deterministic centroid order.

### Signatures

`server/src/geometry/signature.ts` describes a face or edge by geometry, not
name: a `RefSignature` of type, point and direction. A face gives its surface
type, its centroid and the normal at its UV midpoint, flipped with a reversed
face. An edge gives its curve type, the point at its middle parameter and the
unit tangent there, in the curve's own direction. A stored face or edge
reference may carry one as `sig` (schema 14). Evaluation reads it to
propose repair candidates and, under version 2, to catch a name that now
sits on a renumbered sibling; see Resolution.

An import has no history, so under `namingVersion` 2 `geometryNames` names
each imported face from its signature: `{surface}` is the signature type and
`{key}` the first 16 hex digits of the sha256 of its point and direction,
each coordinate rounded to a multiple of `LINEAR_TOL` as the `~n` sort does.
The same file imported twice, or with another solid added, names a solid's
faces the same. Only faces with equal keys get a suffix, and since equal keys
mean equal rounded centroids, that suffix is always `~?n`: coincident faces
of coincident solids stay visibly ambiguous. The names do not include the
blob hash, which the feature already holds, and no STEP entity id feeds them:
the kernel build binds no transfer map from shapes back to source entities.
Under version 1 an import keeps `x{n}` names. Mesh imports keep `x{n}` names
under both versions.

### Resolution

`resolveRefs` in `server/src/geometry/resolve.ts` sorts face and edge
references against a state's bodies into `resolved`, `candidate`,
`ambiguous` or `missing`.

- A reference whose body still bears its name is `resolved`, however far the
  face or edge moved since its `sig` was taken. A `~?n` name never resolves.
- Under version 2 a named face or edge that no longer matches its stored
  `sig` (same type, direction within `UNIT_DOT_TOL`, point within
  `LINEAR_TOL`) is checked against its name family: the faces or edges on any
  body whose names read the same with every `~n` and `~?n` suffix removed.
  Family members that match the `sig` make it a `candidate`, or `ambiguous`
  for several, so a renumbered split piece or duplicate is reported, not
  followed. With no match it stays `resolved`, since only its own geometry
  moved.
- Otherwise lineage decides: names on the referenced body that descend from
  the reference or that it descends from, read through `~n` suffixes, `~?n`
  ties and, for edges, each adjacent face name. One is a `candidate`, several
  are `ambiguous`, so a split face or a tied name is reported, not chosen.
- With no lineage, the stored `sig` proposes faces or edges of the referenced
  body with the same type and a direction within `UNIT_DOT_TOL`; the nearest
  point wins, and matches equally near within `LINEAR_TOL` are `ambiguous`.
- Other bodies are searched by signature only for that name family. Lineage
  names on them are returned as `suggestions`, which only a user repair may
  accept.

Candidates are ordered by body id and name with `compareNames`, never by
kernel order.

Under `namingVersion` 2 every feature passes through the resolver before it
evaluates, against the state before it. A feature with a face or edge
reference that is not `resolved` does not evaluate: it fails, and its
`FeatureStatus.refs` lists each such reference with its status, candidates
and suggestions. A candidate is shown for repair and never used; only a
feature update that names it, the repair mutation, changes the stored
reference. The bodies the feature names, through its references, `targets`,
`bodies`, `toolBodies`, `targetBody` or `body`, become blocked. A later
feature that names a blocked body is blocked too and fails without
evaluating, so its bodies join the set. A feature whose default `targets`
include a blocked body fails the same way once it has picked them. Other
bodies build as usual. Export refuses a blocked body; see [API.md](API.md),
Inspection & output. Measurement refuses a face or edge reference that is not
`resolved`, under either version.

Under version 1 evaluation is unchanged. No version 1 name carries `~?`, so
a reference resolves exactly when its body still bears its name, as the
evaluators already require. A feature that fails still reports its
unresolved references in `FeatureStatus.refs`, but nothing is blocked, the
features after it evaluate against the state before it, and export is
unchanged.

### Known limitations

- Centroid-ordered `~n` disambiguation can swap if an upstream edit moves
  duplicates past each other; the reference then attaches to the sibling
  subshape, which can fail with a reported error or build on the wrong face
  or edge without one. Version 2 rounding still swaps two duplicates when a
  coordinate moves across a rounding threshold.
- Split pieces renumber too. Under version 2, when the first of three
  identical pieces of a cut disappears, the survivors become `b:x` and
  `b:x:2` and their `~n` suffixes shift, so a fillet saved on `b:x:2` names
  the piece that was `b:x:3`. Its `sig` still matches the piece that is now
  `b:x`, so it is a `candidate` for that piece (see Resolution). A reference
  without a `sig`, or whose `sig` was taken before an upstream edit moved
  the piece, has nothing to match and still moves silently, under version 1
  always.
- A feature fails without blocking the features after it when its failure
  is not a reference: a fillet whose radius is too large leaves its body as
  it was, and later features build on that body.
- A reference whose face genuinely disappears (e.g. the filleted edge is
  consumed) marks the downstream feature as **error** in the timeline with an
  actionable message; the model up to that feature is preserved. Its edit
  dialog accepts a candidate or a suggestion, or re-picks the reference in
  the viewport; see [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md).

## Sketches

A sketch stores entities (points, lines, circles, center+endpoints arcs) and
constraints. Points are first-class entities referenced by id, so endpoint
sharing is exact. The solver (`shared/src/solver.ts`) builds residual
functions per constraint and minimises with Levenberg-Marquardt over the free
variables (point coordinates, circle radii); degrees of freedom are computed
from the Jacobian rank at the solution, driving the
unconstrained / partially / fully / over-constrained badge.

**Drawing inference** (client, `client/src/sketchTools.ts`): while a line is
being drawn, the cursor snaps first to existing points, the origin and line
midpoints. Otherwise a _direction lock_ may engage from the start point: axis
alignment, or a right angle to any line that ends there when within 4°
(`perpendicularSnap`). Curve snapping then runs on the steered cursor: a
hit on a line is placed exactly where the locked direction crosses it
(`rayLineIntersection`), so a shape can be closed onto another line while
staying square. Snaps that imply geometry become constraints on the created
entities (coincident via shared point ids, `pointOnLine`, `pointOnCircle`,
`midpoint`, `horizontal`/`vertical`, `perpendicular`, in combination when
several engage); a typed angle overrides all direction snapping, a typed
length keeps it.

**Profiles** (closed regions) are detected by planar half-edge traversal
(`shared/src/profiles.ts`): non-construction curves split where they cross,
where one ends on another, and where they touch tangentially within
`1e-6` mm; minimal enclosed cycles become selectable regions; an unsplit
circle forms a disc region; containment builds an even-odd region tree so
inner loops become holes. A profile's id is a hash of the entity ids bounding
it, stable across regeneration while the same entities enclose the region.
Regions bounded by the same entities, such as the lens and crescents of two
overlapping circles, add a hash of each boundary's orientation to that id.
`findProfile` resolves a saved id missing from this split through the
detection before tangent splitting and those suffixes, so projects saved
earlier keep their regions (DEC-101). `curveHits` reports where each curve
meets the others by line fraction or arc and circle angle.

**Sketch planes** resolve to a frame (origin, x-axis, y-axis, normal):

- Origin planes have canonical frames (XY: +Z, XZ: x=(1,0,0),y=(0,0,1),
  YZ: x=(0,1,0),y=(0,0,1)).
- Face planes: normal = outward face normal; origin = the point on the plane
  closest to the global origin (stable under lateral model edits: the sketch
  rides the face if it moves along its normal); axes derived deterministically
  from the global axes.
- Construction planes: base frame offset along its normal. A midplane of
  parallel refs lies halfway between them with the first ref's normal. Refs
  at an angle give the plane of equal signed distance to both: it contains
  their intersection line and, with outward face normals, lies between the
  faces. The other methods are in Construction plane methods (schema 18).

## Regeneration engine

`server/src/geometry/engine.ts`:

1. Features evaluate strictly in timeline order against an evaluation state
   (bodies + solved sketches + construction frames). Each evaluator sees only
   the features before it, so a later feature cannot change an earlier result
   behind its cache key.
2. After each feature a **snapshot** is stored, keyed by the feature's JSON,
   and also by that JSON with the reported `targets` for a feature evaluated
   without them (see Tool targets).
3. On the next evaluation the longest prefix whose feature JSON is unchanged
   is reused; evaluation restarts from the first changed feature, so editing
   feature _k_ re-evaluates only _k..end_ ("retain valid cached state,
   invalidate downstream").
4. The timeline marker simply truncates evaluation; rolled-back features are
   reported as `rolledBack`. A caller may pass `onFeatureStart` and
   `onProgress`, called before and after each evaluated feature, and
   `shouldStop`, read at each feature boundary and, through an OCCT progress
   indicator, inside the kernel calls of a feature. A stop keeps the
   snapshots made so far and reports the features left before the marker as
   `cancelled`, including a feature the kernel abandoned mid-call; no
   snapshot holds that status, so the next evaluation resumes at the first
   cancelled feature.
5. A failing feature records `error` with the kernel's message; evaluation
   continues from the pre-failure state so independent downstream features
   still build. Nothing is silently discarded. Under `namingVersion` 2 a
   feature whose references do not resolve also blocks the features that
   name its bodies; see Resolution.

Suppressed features skip evaluation but still occupy a snapshot slot, so
toggling suppression invalidates exactly the right suffix.

## Tolerances

`shared/src/tolerance.ts` owns the modelling tolerances. Each quantity has its
own constant, even where two numbers match.

- `LINEAR_TOL = 1e-6` mm: coincidence, sewing, loft, thick solid, face
  classification, zero length, the rounding step of naming version 2 and the
  smallest positive fillet, chamfer, shell, emboss and extrude size.
- `ANGULAR_TOL_DEG = 1e-9` degrees: full-turn tests in revolve and circular
  pattern.
- `UNIT_DOT_TOL = 1e-6`, no unit: the dot product of unit normals in parallel
  and perpendicular face tests.
- `MIN_OFFSET_MM = 1e-7` mm, in `server/src/api/validate.ts`: the smallest
  sketch offset distance the API accepts. It is an input bound, not a
  tolerance.

Areas in mm2 are squared lengths and never compare against `LINEAR_TOL`.
Solver convergence and pivot guards stay in `shared/src/solver.ts`, sketch
region merging in `shared/src/profiles.ts`. No fingerprint quantisation exists
yet; it gets its own constant when it does.

## Placements

`shared/src/placement.ts` defines `Placement`: a unit quaternion `rotation`
`[x, y, z, w]` and a `translation` in mm. Its functions compose, invert and
apply placements to points, directions and sketch frames.
`placementToTrsf` in `server/src/geometry/kernel.ts` turns one into an OCCT
transform. Move, linear pattern and circular pattern build their transforms
this way, and a move carries its bodies' sketch frames with `applyToFrame`.
The document is unchanged: `MoveFeature` still stores a `translation`.

## Tessellation

`BRepMesh_IncrementalMesh` produces per face triangulations. The viewport uses
0.35 rad and a linear deflection of 0.0005 times the body's bounding-box
diagonal, clamped to 0.005 to 0.5 mm. The payload keeps the CAD structure:
each face's triangle range is tagged with its persistent name, each edge is a
sampled polyline tagged with its name, each vertex a named point. The client
raycasts triangles/segments/points and resolves hits to persistent CAD
references, so selection is CAD topology, never "triangle 512". Face normals
come from the kernel (`ComputeNormals`), respecting face orientation.
Tessellations are cached per body id and shape hash, and a hit must be the
same live shape (`IsSame`); export meshes a copy of each
body at user-selected quality, so neither mesh reuses the other. Both go
through `server/src/geometry/mesh.ts`, the one owner that reads face
triangulations. A body whose every face carries an exact triangulation, as
mesh imports do, skips `BRepMesh` and the copy: its triangles are read as
they are, at any deflection.

## Measurement

`BRepExtrema_DistShapeShape` between resolved references gives minimum
distance and the closest-point pair (→ ΔX/ΔY/ΔZ); per-selection properties
use `BRepGProp` (edge length, face area) and surface/curve adaptors (radius,
diameter); angles come from plane normals / line directions.

## Export

- **STL**: binary, written directly from the export-quality tessellation
  (selected bodies merged), units mm.
- **3MF**: OPC container written directly (`fflate` zip +
  `3D/3dmodel.model` XML), `unit="millimeter"`, one `<object>` per body with
  the body's display name preserved, so multi-body prints arrive in the slicer
  as separate named objects. Vertices on a 1e-6 mm grid (`LINEAR_TOL`) are
  welded across faces and triangles that collapse are dropped, so each object
  is a closed mesh with every edge shared by two outward triangles.

## Associative sketch projection (schema 2)

A projected line, circle, or arc stores an optional EdgeRef in its projection field.
Its external flag and its generated child points are solver-driven references.
Child IDs derive from the curve ID (:a, :b, :c) and persist across regeneration.
Each sketch resolves these edges from the preceding evaluation state, projects
exact analytic geometry into its plane, then solves local constraints. Source
changes invalidate the cached timeline suffix. Missing sources and curve-type
changes fail the sketch explicitly instead of retaining stale coordinates.
The preparation endpoint resolves before the sketch and rejects downstream
references. Schema 1 migrates to schema 2 without changing existing features.

Projected curves default to construction geometry. Users can toggle construction
to include them in profiles. Tilted circles (ellipses), splines and degenerate
line projections are rejected. A new sketch started on a planar face stores
that face's analytic boundary edges as linked, non-construction projections.
The existing profile detector uses those edges to close regions. A missing
source fails the sketch through the same reference path. Existing saved sketches
are unchanged because the boundary is added only when a new sketch is created.
Face snapping outside those stored boundary curves remains position-only.
Deleting a projection releases surviving shared endpoints as ordinary editable points.

Trim cuts at `curveHits` (`shared/src/profiles.ts`), the crossings, tangent
contacts and T-junctions the region split uses, so construction curves never
cut. Each hit names the curves through it: a new end gets `coincident` with a
cutter's endpoint there, or `pointOnLine` or `pointOnCircle` on the cutter. A
circle becomes an arc with the same id, the first kept piece of a line or arc
keeps the id, and a second piece is tied back by `collinear` (line) or `equal`
(arc, same centre). Hits are cached per entity array, so hovering does only a
lookup. Extend calculates analytic intersections of lines, arcs and circles.
Both retain unchanged endpoints, drop constraints on removed geometry with a
user notice, and preserve unrelated geometry.

## Sketch offsets (schema 4)

Schema version 4 adds an optional `offsets` list to a sketch. Each
`SketchOffset` stores its signed `distance`, the `sourceIds` it offsets, the
`entityIds` it generated and the `joinTolerance` for small gaps. The 3 to 4
migration only bumps the version. Offset curves drawn before schema 4 have no
record and stay plain geometry.

An offset takes one line, circle or arc, or a connected chain of lines and
arcs. Auto-chaining from one curve stops at branches and is resolved once, when
the offset is created. Adjacent offset curves meet at their intersection.
Collapsed and self-crossing results are rejected. Generated curves are marked
`external`, so the solver holds them and trim and extend refuse them.

Editing a distance (`editSketchOffset` in `shared/src/sketchOffsets.ts`)
rebuilds that offset and every later one from the stored sources. It keeps the
generated entity IDs, so profiles and downstream features keep their
references. The edit fails if generated geometry was deleted or trimmed, or if
the rebuild yields a different number or kind of curves. Editing a source curve
does not rebuild its offsets: they keep their positions until the next
distance edit.

## Line angles (schema 5)

Schema version 5 adds the `lineAngle` constraint `{ line, value }`: the
direction of a line from its start to its end, in degrees counter-clockwise
from the sketch +X axis, stored in (-180, 180]. The 4 to 5 migration only
bumps the version. The API rejects a `lineAngle` outside that range.

The solver adds one residual, the signed angle from the target direction to
the line, wrapped to (-pi, pi] with `atan2`, so it stays continuous as the
line turns through 180 degrees. It removes one degree of freedom and counts
toward the badge and conflict report like `length` and `angle`.

A typed ∠ while drawing a line stores a `lineAngle` next to a typed L.
Double-clicking a line edits its L and ∠ together, first adding either one
at its current value when missing. A `lineAngle` replaces any `horizontal`
or `vertical` constraint on the same line, which it implies.

## Revision (schema 7)

Schema version 7 adds `revision` and `savedWith` to the document. The store
sets `revision` to the stored value plus one on every write, whatever the
caller sent, so a new project saves as 1 and a read never changes it.
`savedWith` is the `version` and `commit` that `GET /health` reports for the
build that wrote the file. The 6 to 7 migration adds `revision: 0` and
`savedWith: null`.

Schema version 21 adds `modifiedBy` beside `modifiedAt`. A save records the
signed-in actor's user ID; the 20 to 21 migration sets it to `null` for older
projects, after backing up the complete project generation.

## Extensions (schema 10)

`extensions` holds data that modules keep in the document, keyed by a dotted
module id such as `acme.gears` that matches
`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$`. Each value is `{ version, data }`.
The server checks that envelope and never reads `data`, so it survives load,
migration, feature edits and `PUT /document` as an equal JSON value. The 9 to
10 migration adds `extensions: {}`. A server older than schema 10 refuses the
file instead of saving it without the extension data.

## Naming version (schema 12)

`namingVersion` records the naming rules a document evaluates under; see
Face names. The engine names every body under it and keeps it on the body's
name map, so edge and vertex names computed later for tessellation,
measurement or projection follow the same rules. The 11 to 12 migration sets
`namingVersion: 1` on every existing document, backed up with the rest of
the project before its first save, so saved references keep resolving as
before. New projects get 2. Only the naming upgrade below changes a stored
`namingVersion`; `PUT /document` answers 409 to a different value unless the
project holds a naming upgrade backup. The engine drops its cached timeline
when the version changes.

### Naming upgrade

`server/src/store/namingUpgrade.ts` moves a version 1 document to version
2 when the user asks, never on load or at boot, with the plan from
`planNamingUpgrade` in `server/src/geometry/upgradeNaming.ts` through the
`KernelClient`. Each call first backs up the
complete project directory through the migration backup path, as
`backups/projects/{id}/naming1-{hash}`; the same files give the same backup.
`planNamingUpgrade` then pins the document with `pinRefs` under version 1 and
walks the timeline. For each feature it compares the version 1 state before
it with the version 2 state before its translated copy, and maps each body id
field (`targets`, `bodies`, `toolBodies`, `targetBody`, `body`) and each face
and edge reference. After the last feature it maps the final bodies, which
carry `bodyMeta` names and body group members to their new ids.

A mapping is `proven` only by provenance: history names with every `~n` and
`~?n` suffix removed, and never a fallback `x{n}` name, since both are
positional.

- A body is proven when the names only it bears in version 1 lie on exactly
  one version 2 body, and that body's own names lead back only to it. A body
  with no such names is proven only when neither state holds another body of
  its id family (`b:x`, `b:x:2`, `b:x:2:2`).
- A face or edge is proven when its body is proven, its name is the only one
  with its base on the version 1 body, and exactly one name on the version 2
  body has that base.

Everything else is a `candidate`, `ambiguous` or `missing`, with candidates
the user may accept. Body candidates are the bodies sharing its names or its
id family, ordered by volume and then centroid distance; volume and centroid
only order them. Reference candidates are names with the same base on the
candidate bodies, else the stored `sig` proposes by Resolution's signature
rule; names with that base on other bodies come back as `suggestions`. So a
face split into mirror-image halves on one body is `ambiguous`, and a split
body keeps its fillet on the piece it was on, whatever its version 2 id.

A proven or accepted reference gets its new body and name and a `sig` taken
from the version 2 state. The commit refuses while any `candidate` or
`ambiguous` mapping has no accepted choice. A `missing` one without a choice
stays as it was and reports as unresolved under version 2; if its old name
exists on its old body id in version 2, it is a `candidate` instead, so it
never binds by coincidence. The commit writes the upgraded document in one
save, so an interruption leaves the old or the new document, never a
mixture, and the backup restores the complete old project. The view's
hidden body ids are not remapped.

## No visible flags (schema 13)

Some schema 11 and 12 documents still carry `visible` on a sketch, a
reference image or a body's metadata: project uploads stored the flag every
response carries. `view.json` owns visibility, so these copies are stale, and
a feature edit would copy one back into the view. The 12 to 13 migration
drops every `visible` from features and `bodyMeta` without moving it, backed
up with the rest of the project before its first save.

## Reference signatures (schema 14)

A `FaceRef` or `EdgeRef` may carry an optional `sig`, the `RefSignature` of the
face or edge it named when it was picked. `collectTopoRefs` in
`shared/src/topoRefs.ts` finds every face and edge reference in a feature. When
a feature is added or updated, the server fills each missing `sig` from the
state before that feature. An updated reference keeps the `sig` it had when
the patch names the same body and face or edge without one, and a `sig` sent
with a reference is kept. A reference that does not resolve there, or whose
signature is not finite, stays without one. A `sig` only proposes candidates
or turns a renumbered name into one (see Resolution), so a reference without
one evaluates as before. The 13 to 14 migration changes nothing but the
version, and the project is backed up before its first save.

## Tool targets (schema 15)

Extrude, revolve, sweep, loft and emboss may carry `targets`, the ids of the
bodies their join, cut or intersect acts on. Join under `namingVersion` 1 and
intersect use `targets[0]`. Join under version 2 fuses into every body in
`targets`, grouped as in Body identity, and a tool solid that meets no target
becomes a new body. Cut cuts exactly `targets`. A target that no longer exists
or that the tool does not overlap fails the feature with an error naming it:
by bounding box for cut, intersect and join under version 1, and by the
version 2 contact rule for join under version 2. Empty `targets` make the tool
a new body, as every operation does when no body exists. `newBody` ignores
`targets`.

Without `targets` the old rules pick them: join under version 1 and intersect
take the first body in `state.bodies` order whose bounding box overlaps the
tool, join under version 2 takes every body the tool touches, and cut takes
every body whose bounding box overlaps the tool. `FeatureStatus.targets`
reports the ids used, in `targets` order, else sorted as bridged bodies are
under version 2. Stored, they give the same result. Feature add and update
write them into the stored feature; see [API.md](API.md), Validation. Loading
never writes them, and a feature without `targets` evaluates as before. The 14
to 15 migration changes nothing but the version, and the project is backed up
before its first save.

The ids written follow Fusion (schema 20). Hidden bodies, from the project
view, are never default participants: when the old rules pick a hidden body,
the feature is tried again with hidden bodies left out, and the ids from that
try are written. When that try fails, such as a cut that meets only hidden
bodies, the edit fails without saving. A rename or suppress that fills `targets` for
a feature saved without them writes the ids it evaluated, hidden or not, so its
result stays. A hidden body the user names in `targets` still takes part. An
extrude or revolve Join from a face writes that face's body first when it is
among the targets, so the joined body keeps the id, name and visibility of the
body the tool starts from; otherwise the first target the user picked leads.
Evaluation never reads the view, so hiding a body changes no result. The 19 to
20 migration sorts the `targets` of every version 2 join, including an emboss,
by `compareNames`, so a saved project keeps its body ids, and the project is
backed up before its first save.

`pinRefs` in `server/src/geometry/pinRefs.ts` gives a loaded document the pins
a save would write, in memory: each missing `targets` from the evaluation and
each missing `sig` from the state before its feature, by the rules above and in
Reference signatures. It returns a copy that evaluates as the stored document
does and never saves it, so loading a project never writes its file. Pins
persist only when a feature add or update saves that feature, or when the
naming upgrade commits the pinned document; see Naming upgrade.

## Revolve faces (schema 16)

Revolve may carry `faces`, planar body faces used as profiles as Extrude uses
its `faces`: sketch regions drawn strictly inside a face are cut out of it, and
each face revolves about the axis beside any `profiles`. `profiles` may then be
empty; together they hold at least one source. A face that is gone or not planar
fails the feature with an error naming it. A revolve without `faces` evaluates
as before. The 15 to 16 migration changes nothing but the version, and the
project is backed up before its first save.

## Sketch distances and axis angles (schema 17)

Two dimension constraints join the sketch. `pointLineDistance { point, line,
value }` holds a point at `value` mm from the infinite line through `line`, on
either side; it removes one degree of freedom. `lineDistance { a, b, value }`
holds both ends of `b` at the same signed distance from line `a`, so `b` stays
parallel to `a` at `value` mm; it removes two. A `lineAngle` may carry
`axis: "y"`, measuring from the sketch +Y axis instead of +X, in the same
(-180, 180] range; without `axis` it measures from +X as before.

The Dimension tool picks one line for its length, one circle or arc for its
diameter, two points for their distance, a point and a line for their
distance, and two lines for their angle or, when parallel, their distance.
Ctrl-click holds a line as the first pick. Right-clicking a placed dimension
lists the other kinds for the same geometry: aligned, horizontal or vertical
distance; radius or diameter; length or the angle to the X or Y axis. The
choice keeps the constraint id, drops its label offset, and like a typed angle
removes a `horizontal` or `vertical` constraint on that line. The 16 to 17
migration changes nothing but the version, and the project is backed up
before its first save.

## Construction plane methods (schema 18)

A construction plane's `method` is one of five kinds. Refs keep pick order: the
first ref picked is `a` or `base`.

- `offset { base, distance, flip? }`: `flip` reverses the base normal first, so
  the plane lies `distance` mm on the other side and faces the other way.
- `midplane { a, b, offset?, flip? }`: the midplane above, then `flip` reverses
  its normal and `offset` moves it that many mm along the resulting normal.
- `angle { axis, base, angle }`: the plane through the axis (an origin axis,
  sketch line or straight edge) whose normal is the base normal turned `angle`
  degrees about the axis direction, right-handed. At 0 it is parallel to the
  base. An axis that is not parallel to the base fails the feature.
- `threePoints { points }`: the plane through three points, each a body vertex
  `{ kind: "vertex", bodyId, vertexName }` or a sketch point
  `{ kind: "sketchPoint", sketchId, entityId }`. Its normal is
  (p2 - p1) x (p3 - p1). Points on one line fail the feature.
- `twoEdges { a, b }`: the plane holding two straight lines, each given like
  the angle axis. Crossing lines take the normal a x b; parallel lines take a x
  (b origin - a origin). Lines on one line, or not in one plane, fail the
  feature.

Vertex references carry no signature and the naming upgrade does not map them.
A vertex name is built from its face names, so a plane whose vertex name
changes fails and needs its points picked again. The 17 to 18 migration
changes nothing but the version, and the project is backed up before its first
save.

## Display units (schema 19)

The document no longer carries `units`. The `units.length` setting owns the
display unit, resolved from its default `mm` through the app, user and
project layers. The 18 to 19 migration drops the field. A value other than
`mm` moves to the project layer, `projects/{id}/settings.json`, keeping the
layer's other keys. The settings file and the document commit as one
generation through the migration backup path, so a crash leaves both old or
both new, and the `v18-{hash}` backup holds the complete old project.
Restoring a history checkpoint from before schema 19 drops the field, since
the project layer already holds its value.

## Tangent edge chains

Fillet/Chamfer store optional tangentChain metadata (absent preserves prior
behaviour). New dialogs enable it. Exact OCCT endpoint derivatives find unique
smooth continuations within 1 degree and `LINEAR_TOL`; branching matches stop traversal.
The chain is resolved again at the feature position during regeneration. Native
OCCT contours are added only once to prevent duplicate contour definitions when
several selected edges already belong to the same contour. The selection toggle
controls explicit chain expansion, not native kernel propagation.
