# CAD model

How Rockett CAD represents, regenerates, names, tessellates, measures and
exports geometry. This is the most load-bearing document in the repo.

## B-Rep representation

The authoritative model is OpenCascade B-Rep: each **body** is a
`TopoDS_Solid` (occasionally several solids when an operation splits a body).
The document (`shared/src/model.ts`) stores the _recipe_: sketches with
constraints, features with parameters and references, and embedded source
data for imported geometry.
Geometry exists only inside the evaluation state and its caches, and is
rebuilt from the recipe on demand. Saved projects are JSON, and the modelling
history survives close/reopen; embedded imports increase document size.

### STEP, IGES and BREP imports

Schema version 3 adds `importStep` features containing `filename` and the
original STEP text in `data`. OCCT reads this source during regeneration,
normalizes lengths to millimetres, and registers each solid as a body. The
source travels with document snapshots and duplicates. Imports can be
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

### STL and OBJ imports

An `importMesh` feature holds `filename`, `format` (`stl` or `obj`) and the
original file as base64 in `data`, so binary STL survives JSON. Regeneration
reads it with `RWStl` or `RWObj`, which merge coincident nodes. Each triangle
becomes a planar face over shared vertices and edges, and
`BRepBuilderAPI_Sewing` joins them. With no free edges each shell becomes a
solid, reversed if its volume is negative. Otherwise the sewn shell is the body
and the feature status is `warning`, naming the open edge count. Meshes over
200,000 triangles fail with their count. Faces stay triangles, so a mesh body
is not parametric and has one face per triangle.

OCCT's STL reader takes a file as ASCII when its first 134 bytes are all
printable, which misreads a binary cube with small coordinates. When the size
is exactly 84 bytes plus 50 per declared facet, the reader's copy gets a
non-ASCII first header byte, forcing the binary path. The stored data is not
changed.

The feature needs no schema step: no saved document changes meaning, so
schema 5 stands. A build older than this one loads such a project, reports the
`importMesh` feature as an unknown type error and refuses to save a full
document containing it, so nothing is lost.

## Body identity

Bodies get stable ids derived from the feature that created them:

- `b:{featureId}`: a `newBody` extrude/revolve/sweep/loft. A `newBody`
  extrude/revolve of several sketch regions makes one body per region, in
  selection order (`b:x`, `b:x:2`, …); `join` is what merges regions into a
  single solid (with no existing body to join, the merged solid becomes the new
  body).
- Boolean join/cut keep the _target_ body's id.
- An operation that leaves multiple solids appends ordinal suffixes ordered
  by volume (`b:x`, `b:x:2`, …); `splitBody` orders along the split-plane
  normal (`b:x`, `b:x:s2`).

Display metadata (name, visibility) lives in `document.bodyMeta[bodyId]` and
is assigned server-side the first time a body id appears (`Body1`, `Body2`, …).

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
| Fillet/chamfer face generated from an edge              | `f:{featureId}:fe:{n}`                                             |
| Mirrored / patterned copy                               | `m:{featureId}:{originalName}` / `p{i}:{featureId}:{originalName}` |
| Anything the history cannot attribute                   | `f:{featureId}:x{n}` (deterministic centroid order)                |

Propagation uses the kernel's own history API. For every boolean, fillet,
chamfer, shell, or offset operation we walk the input faces and ask OCCT
`IsDeleted` / `Modified` / `Generated`:

- deleted → the name dies with the face;
- modified → each resulting face inherits the input face's name;
- untouched → the face (same TShape) keeps its name;
- new faces → named by their generating entity where the operation reports it
  (e.g. `MakePrism.Generated(edge)`, `MakeFillet.Generated(edge)`), otherwise
  the deterministic fallback.

When one input face yields several result faces (e.g. a boolean splits a
face) the copies are disambiguated with a `~n` suffix in centroid order.

An extrude's `distance` is signed: a negative value builds the prism on the
opposite side of the sketch plane (after `direction` is applied; `symmetric`
ignores the sign). An optional `startOffset` moves the start plane along the
profile's (or face's) own normal before the distance is applied (Fusion's
"Start → Offset"), so a boss or cut can begin above or below the sketch. The dialog treats a typed negative value as "into the part"
and switches Join to Cut, previewing the tool in red.

Extrude and revolve tools built from several sketch regions pass through
`ShapeUpgrade_UnifySameDomain` before the boolean, so adjacent regions become
one face instead of showing the sketch's internal boundaries as edges. Names
follow the unify history: a face merged from several inputs takes their shared
base name (the `~n` suffix dropped), or the first distinct base name in sorted
order when they differ. This runs on the tool only. A later join whose cap is
coplanar with an existing face keeps that edge, so downstream references to
existing faces never move.

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

### Known limitations

- Centroid-ordered `~n` disambiguation can swap if an upstream edit moves
  duplicates past each other; the reference then attaches to the sibling
  subshape. This is rare in practice and fails loudly (wrong-edge fillet or a
  reported error), never silently.
- A reference whose face genuinely disappears (e.g. the filleted edge is
  consumed) marks the downstream feature as **error** in the timeline with an
  actionable message; the model up to that feature is preserved. A repair UI
  (re-pick reference) is on the roadmap.

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
(`shared/src/profiles.ts`): minimal enclosed cycles become selectable regions;
full circles form disc regions; containment builds an even-odd region tree so
inner loops become holes. A profile's id is a hash of the entity ids bounding
it, stable across regeneration while the same entities enclose the region.

**Sketch planes** resolve to a frame (origin, x-axis, y-axis, normal):

- Origin planes have canonical frames (XY: +Z, XZ: x=(1,0,0),y=(0,0,1),
  YZ: x=(0,1,0),y=(0,0,1)).
- Face planes: normal = outward face normal; origin = the point on the plane
  closest to the global origin (stable under lateral model edits: the sketch
  rides the face if it moves along its normal); axes derived deterministically
  from the global axes.
- Construction planes: base frame offset along its normal / averaged for
  midplanes.

## Regeneration engine

`server/src/geometry/engine.ts`:

1. Features evaluate strictly in timeline order against an evaluation state
   (bodies + solved sketches + construction frames). Each evaluator sees only
   the features before it, so a later feature cannot change an earlier result
   behind its cache key.
2. After each feature a **snapshot** is stored, keyed by the feature's JSON.
3. On the next evaluation the longest prefix whose feature JSON is unchanged
   is reused; evaluation restarts from the first changed feature, so editing
   feature _k_ re-evaluates only _k..end_ ("retain valid cached state,
   invalidate downstream").
4. The timeline marker simply truncates evaluation; rolled-back features are
   reported as `rolledBack`.
5. A failing feature records `error` with the kernel's message; evaluation
   continues from the pre-failure state so independent downstream features
   still build. Nothing is silently discarded.

Suppressed features skip evaluation but still occupy a snapshot slot, so
toggling suppression invalidates exactly the right suffix.

## Tolerances

`shared/src/tolerance.ts` owns the modelling tolerances. Each quantity has its
own constant, even where two numbers match.

- `LINEAR_TOL = 1e-6` mm: coincidence, sewing, loft, thick solid, face
  classification, zero length and the smallest positive fillet, chamfer, shell,
  emboss and extrude size.
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

## Tessellation

`BRepMesh_IncrementalMesh` (0.08 mm / 0.35 rad for the viewport) produces per
face triangulations. The payload keeps the CAD structure: each face's triangle
range is tagged with its persistent name, each edge is a sampled polyline
tagged with its name, each vertex a named point. The client raycasts
triangles/segments/points and resolves hits to persistent CAD references, so
selection is CAD topology, never "triangle 512". Face normals come from the
kernel (`ComputeNormals`), respecting face orientation. Tessellations are
cached per body-shape hash; export re-tessellates at user-selected quality.

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
  as separate named objects.

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
line projections are rejected. Direct face snapping remains position-only; use
Project first when a persistent geometric relationship is required. Deleting a
projection releases surviving shared endpoints as ordinary editable points.

Trim and extend calculate analytic intersections of lines, arcs and circles.
They retain unchanged endpoints, detach replaced endpoints, remove affected
curve constraints with a user notice, and preserve unrelated geometry.

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

## Tangent edge chains

Fillet/Chamfer store optional tangentChain metadata (absent preserves prior
behaviour). New dialogs enable it. Exact OCCT endpoint derivatives find unique
smooth continuations within 1 degree and `LINEAR_TOL`; branching matches stop traversal.
The chain is resolved again at the feature position during regeneration. Native
OCCT contours are added only once to prevent duplicate contour definitions when
several selected edges already belong to the same contour. The selection toggle
controls explicit chain expansion, not native kernel propagation.
