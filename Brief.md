Project Brief: Self-Hosted Parametric CAD Application



You are a senior software architect and CAD/CAM application engineer. Your task is to design and build a self-hosted, browser-based parametric CAD application intended primarily for designing objects for 3D printing.



The application should take workflow inspiration from Autodesk Fusion 360, but it is not intended to reproduce Fusion 360 in full. The focus is a clean, reliable, feature-history-based parametric solid modelling workflow.



The application must run entirely on infrastructure controlled by the user and must be deployable as a Docker container on an Unraid server.



Do not build this as a toy mesh editor. The application must use a proper B-Rep / solid-modelling architecture capable of robust parametric operations.



1\. Core Product Goal



Create a browser-based parametric CAD system where a user can:



Create sketches.



Fully or partially constrain sketch geometry.



Turn sketches into solid geometry.



Perform subsequent parametric operations on those solids.



Maintain all modelling operations in a chronological feature timeline.



Edit earlier features and automatically regenerate downstream geometry.



Create sketches and construction geometry against faces produced at earlier points in the feature history.



Organise the resulting geometry into bodies.



Inspect and measure geometry.



Export finished bodies for 3D printing.



The user experience should be recognisably similar to a simplified Fusion 360 "Design" workspace.



The application is primarily intended for mechanical and functional 3D-printable parts rather than artistic mesh modelling.



2\. Deployment Requirements



The entire application must be self-hosted.



Required deployment target:



Docker



Docker Compose-compatible configuration



Unraid



Linux host



Browser-based client



No mandatory cloud services



No dependency on Autodesk, Onshape, Fusion 360, or proprietary cloud CAD APIs



Project files and databases must live in persistent Docker volumes



Application must survive container recreation without data loss



Provide an Unraid-friendly Docker configuration.



Persistent paths should include, at minimum:



application configuration



database



user/project data



imported reference images



generated thumbnails



exported STL/3MF files



Do not require Kubernetes.



3\. Architectural Principles



Use a proper CAD geometry kernel.



Strongly consider OpenCascade / OCCT or a comparable B-Rep solid-modelling kernel for operations such as:



extrude



revolve



Boolean operations



fillet



chamfer



loft



sweep



shell



split



face operations



topology interrogation



The rendering layer and CAD kernel should remain conceptually separate.



A reasonable architecture would consist of:



Browser UI

↓

3D viewport / interaction layer

↓

Parametric document/model representation

↓

Geometry service

↓

CAD kernel

↓

B-Rep model



The rendered triangle mesh is a visualisation of the CAD model, not the authoritative geometry.



Do not make STL or triangle meshes the underlying representation of editable parts.



4\. Parametric Feature Timeline



The application must use a Fusion-like feature history/timeline.



Every modelling operation should create a feature in the timeline.



Examples:



Sketch001



Extrude001



Sketch002



Fillet001



Mirror001



Hole001



Chamfer001



The timeline must appear along the bottom of the workspace.



Users must be able to:



select a timeline feature



rename a feature



edit a feature



suppress/unsuppress a feature



delete a feature



move backward through modelling history



insert new features at an earlier point in history



return to the end of the timeline



regenerate downstream geometry



Editing an earlier feature must rebuild the model from that point forward.



The application must therefore implement a dependency graph in addition to the visual chronological timeline.



Features must retain references to their input geometry wherever practical.



Design the system with CAD's "topological naming problem" in mind. Do not rely only on transient face indexes such as Face3 because those identifiers can change after upstream modifications.



Implement or design a persistent reference strategy for edges, faces, vertices, sketches and features.



5\. Timeline Rollback Behaviour



The user must be able to move the timeline marker backwards.



For example:



Sketch1

→ Extrude1

→ Fillet1

→ Sketch2

→ Extrude2

→ Mirror1



If the user rolls back to immediately after Extrude1, the viewport should display the model as it existed at that point.



The user must then be able to:



select a face existing at that point in history



create a sketch on that face



add dimensions/constraints



create another feature



insert those operations into the timeline



The later features should then rebuild against the modified model.



This behaviour is a fundamental product requirement.



6\. Sketching Environment



Implement a dedicated parametric sketch environment.



A sketch can exist on:



XY origin plane



XZ origin plane



YZ origin plane



planar body face



user-created construction plane



Sketch tools should include:



line



connected line/polyline



rectangle



centre rectangle



circle



centre-point circle



arc



3-point arc



polygon



slot



point



construction line



trim



extend



offset



mirror



sketch pattern



project geometry



intersect geometry



Users should be able to click existing edges or vertices to reference them while sketching.



7\. Sketch Constraints



Sketches must support parametric constraints.



At minimum:



Geometric constraints:



horizontal



vertical



parallel



perpendicular



tangent



coincident



concentric



equal



midpoint



collinear



fix/lock



Dimensional constraints:



horizontal distance



vertical distance



point-to-point distance



line length



radius



diameter



angle



Dimensions must be editable numerically.



Changing a dimension should cause:



Sketch

→ feature

→ dependent features

→ body



to regenerate.



Display sketch state where possible:



unconstrained



partially constrained



fully constrained



over-constrained/conflicting



Use a real constraint solving strategy rather than manually modifying coordinates for each dimension.



8\. Primary Solid Creation Features



Implement the following parametric modelling tools.



Extrude



Extrude one or more closed sketch profiles.



Options should include:



distance



symmetric



two-sided



to object where practical



new body



join



cut



intersect



Revolve



Revolve a sketch profile around:



sketch line



construction line



model edge



origin axis



Parameters:



angle



full revolution



symmetric where appropriate



Operations:



new body



join



cut



intersect



Loft



Create a solid between multiple profiles.



Support:



multiple profile sections



optional guide rails as a later enhancement



join/new body/cut where geometrically meaningful



Sweep



Sweep a profile along a path.



Support:



sketch profile



sketch/model path



join



new body



cut



Emboss



Allow sketch geometry to be embossed or debossed onto an appropriate model surface.



It should support common workflows such as putting:



text



logos



symbols



simple sketch geometry



onto a body.



9\. Replication Tools



Implement:



Mirror



Mirror:



bodies



features



faces where appropriate



Across:



origin plane



construction plane



planar face



Pattern



Support:



Rectangular pattern



Pattern:



feature



body



face where practical



Parameters:



quantity



spacing



direction



Circular pattern



Parameters:



axis



quantity



angular extent



Pattern operations must remain editable in the timeline.



10\. Modification Tools



The modeller must support common mechanical CAD modification tools.



Implement:



Fillet



Select one or multiple edges.



Parameters:



radius



Feature must remain editable.



Chamfer



Select one or multiple edges.



Support initially:



equal distance



Design architecture so other chamfer modes can be added later.



Combine / Boolean



Operations:



join/union



cut/subtract



intersect



Allow selection of:



target body



one or more tool bodies



Where possible provide:



Keep Tools



option.



Split Body



Allow a body to be split using:



plane



planar face



sketch/profile



another suitable body or surface



The result should create separate selectable bodies.



Split Face



Allow faces to be divided using projected/intersecting geometry.



Shell



Strongly consider shell as a core modelling feature.



Parameters:



wall thickness



faces to remove



Offset Face / Press-Pull



Allow a selected planar or compatible face to move parametrically.



11\. Construction Geometry



Support dedicated construction features.



At minimum:



Construction Plane



Allow creation using:



offset from plane



offset from planar face



mid-plane between two planar faces



angle to plane/edge where possible



through three points as a future extension



Construction planes should appear in the browser tree.



They must be selectable as sketch planes.



Axes



Provide origin axes automatically.



Design the data model to support user-created construction axes later.



Points



Provide origin point automatically.



Allow construction points to be added later without requiring major architectural changes.



12\. Reference / Canvas Images



Users must be able to insert an image as a modelling reference.



Image can be attached to:



origin plane



construction plane



planar face



Supported formats should include:



PNG



JPEG



WebP where convenient



The user must be able to:



upload image



position image



move image



rotate image



scale image



change opacity



hide/show image



rename image



Provide a calibration tool.



Example:



User selects two points on the image and enters:



100 mm



The application scales the image so the selected points are exactly 100 mm apart.



Reference images should be stored as project assets.



13\. Model / Browser Tree



Provide a Fusion-style model browser, normally positioned on the left.



Suggested structure:



Project

├── Document Settings

│   └── Units: mm

├── Origin

│   ├── XY Plane

│   ├── XZ Plane

│   ├── YZ Plane

│   ├── X Axis

│   ├── Y Axis

│   ├── Z Axis

│   └── Origin Point

├── Construction

│   └── Plane1

├── Canvases

│   └── ReferenceImage1

├── Sketches

│   ├── Sketch1

│   └── Sketch2

└── Bodies

├── Body1

├── Body2

└── Body3



The Bodies folder is particularly important.



Any solid body generated through:



extrude



revolve



loft



sweep



mirror



pattern



split body



Boolean operations



must be represented appropriately in the Bodies list.



Users must be able to:



rename body



hide/show body



select body



isolate body



delete where valid



export body



Selecting a body in the tree should highlight it in the viewport.



Selecting geometry in the viewport should identify its owning body in the tree.



14\. 3D Viewport



Create a high-quality interactive 3D viewport.



Required camera controls:



orbit



pan



zoom



zoom to fit



frame selection



Mouse interaction should feel similar to mainstream mechanical CAD software.



Provide sensible configurable mouse controls eventually, but initially choose a consistent CAD-style navigation model.



15\. ViewCube



A draggable navigation cube must appear in the top-right corner of the viewport.



The cube should visibly represent:



FRONT



BACK



LEFT



RIGHT



TOP



BOTTOM



Clicking a cube face should animate the camera to that orthographic orientation.



Clicking cube edges/corners should move to common isometric orientations.



The user must also be able to drag the cube to orbit the camera freely.



Provide a Home/Isometric action near the cube.



Camera transitions should be smooth but quick.



16\. Projection Modes



Support:



perspective



orthographic



Mechanical CAD work should default to whichever mode provides the most intuitive Fusion-like experience.



Provide named views:



Front



Back



Left



Right



Top



Bottom



Isometric



17\. Selection System



The selection engine must recognise CAD topology rather than only rendered triangles.



Users must be able to select:



body



face



edge



vertex



sketch



sketch entity



plane



Selections should highlight clearly.



Where multiple selectable objects overlap, provide a "Select Other" mechanism or equivalent.



Selection filters should eventually be possible.



18\. Inspect / Measurement



Provide an Inspect workspace/tool.



The most important initial feature is Measure.



The user should be able to select combinations such as:



point → point



vertex → vertex



edge → edge



face → face



point → face



body → body where meaningful



Display applicable information including:



direct distance



X distance



Y distance



Z distance



angle



radius



diameter



edge length



face area where practical



Point-to-point measurement is mandatory.



Measurement should update interactively as geometry selections change.



19\. Units



Initial primary unit:



millimetres



Architecture should support:



mm



cm



metres



inches



internally without geometry corruption.



Do not mix display units with internal geometry units without explicit conversion.



20\. Export



At the end of the modelling workflow, the user must be able to export geometry.



Mandatory formats:



STL



3MF



Export should be available for:



selected body



multiple selected bodies



entire model



STL export options should eventually include mesh quality/tessellation settings.



3MF is particularly important because it supports a richer additive manufacturing workflow.



Where technically feasible, preserve separate bodies as separate objects inside a multi-body 3MF export.



Downloading the exported file should happen through the browser.



Also consider optional server-side retention of exported files.



21\. Native Project Format



Create a native project/document format that preserves the parametric model.



It must retain:



sketches



constraints



dimensions



feature timeline



feature parameters



body relationships



construction planes



reference images



names



visibility



units



camera state where useful



Do not save only the final B-Rep.



The modelling history must survive closing and reopening the project.



Prefer a human-inspectable structured representation such as JSON for feature/document metadata, with separate geometry/cache files where required.



Project schemas must be versioned to allow migrations as the application evolves.



22\. Undo / Redo



Implement application-level:



undo



redo



Changes such as:



dimension edits



feature creation



feature deletion



rename



sketch changes



body operations



should participate in undo/redo.



Do not confuse undo history with the CAD feature timeline. They are separate concepts.



23\. Saving



Implement:



automatic save



explicit Save



Save As / duplicate project



Avoid losing modelling work if the browser closes unexpectedly.



Server-side project revisions/checkpoints would be useful later.



24\. User Interface Layout



Use a professional mechanical CAD layout.



Recommended layout:



Top:

Main toolbar



Left:

Model browser/tree



Centre:

3D viewport



Top-right of viewport:

ViewCube



Bottom:

Feature timeline



Right or floating contextual panel:

Feature parameters



Example:



┌──────────────────────────────────────────────────────────────┐

│ Sketch | Create | Modify | Construct | Inspect | Export      │

├───────────────┬──────────────────────────────────────────────┤

│ MODEL TREE    │                                  VIEW CUBE   │

│               │                                              │

│ Origin        │                                              │

│ Sketches      │                3D VIEWPORT                   │

│ Bodies        │                                              │

│ Construction  │                                              │

│               │                                              │

├───────────────┴──────────────────────────────────────────────┤

│ Sketch1 | Extrude1 | Fillet1 | Sketch2 | Extrude2 | Mirror1 │

└──────────────────────────────────────────────────────────────┘



Do not create a visually cluttered interface.



Prioritise maximum viewport area.



25\. Toolbar Organisation



Suggested toolbar categories:



SKETCH



Create Sketch



Line



Rectangle



Circle



Arc



Trim



Offset



Dimension



Constraints



CREATE



Extrude



Revolve



Sweep



Loft



Emboss



MODIFY



Fillet



Chamfer



Shell



Combine



Split Body



Split Face



Offset Face



CONSTRUCT



Offset Plane



Midplane



PATTERN



Mirror



Rectangular Pattern



Circular Pattern



INSPECT



Measure



INSERT



Reference Image



EXPORT



STL



3MF



26\. Parametric Feature Definition



Each feature should use a structured representation.



For example:



{

&#x20; "id": "feature-0017",

&#x20; "type": "extrude",

&#x20; "name": "Extrude1",

&#x20; "enabled": true,

&#x20; "inputs": {

&#x20;   "profile": {

&#x20;     "sketchId": "sketch-0004",

&#x20;     "profileId": "profile-2"

&#x20;   }

&#x20; },

&#x20; "parameters": {

&#x20;   "distance": 25,

&#x20;   "direction": "positive",

&#x20;   "operation": "newBody"

&#x20; },

&#x20; "dependencies": \[

&#x20;   "sketch-0004"

&#x20; ]

}



A fillet might look conceptually like:



{

&#x20; "type": "fillet",

&#x20; "parameters": {

&#x20;   "radius": 3

&#x20; },

&#x20; "selectionReferences": \[

&#x20;   {

&#x20;     "body": "body-001",

&#x20;     "persistentEdgeReference": "..."

&#x20;   }

&#x20; ]

}



Do not treat these examples as an immutable schema. Design the schema properly before implementation.



27\. Regeneration Engine



The parametric regeneration engine is one of the most important pieces of the system.



Conceptually:



Load document.



Start from document origin.



Evaluate Feature 1.



Store output geometry.



Evaluate Feature 2.



Store output geometry.



Continue until active timeline position.



Tessellate resulting B-Rep for viewport rendering.



If Feature 3 changes:



retain valid cached state before Feature 3 where possible



invalidate Feature 3+



regenerate Feature 3 onward



If a downstream feature becomes invalid because upstream geometry disappears, do not silently corrupt the model.



Mark the failed feature clearly in the timeline.



Example:



⚠ Fillet4: referenced edge no longer exists



Provide a future mechanism to repair broken references.



28\. Performance



The viewport must remain responsive.



Do not continuously invoke expensive CAD-kernel operations during every mouse movement unless necessary.



Separate:



interactive preview



committed CAD operation



Where useful.



Cache:



evaluated feature geometry



tessellation



body bounding boxes



selection metadata



Regenerate only the invalidated portion of the timeline.



Use web workers/server workers or equivalent mechanisms where appropriate so expensive operations do not freeze the browser UI.



29\. Backend Job Handling



Some geometry operations may be computationally expensive.



The backend should expose controlled modelling operations instead of arbitrary command execution.



Examples:



evaluate document



evaluate feature



tessellate body



export STL



export 3MF



calculate mass properties



If jobs become asynchronous internally, return progress/state to the frontend.



Failures must include actionable error information.



30\. Security



This is a self-hosted application but should still be engineered safely.



Do not allow browser clients to execute arbitrary shell commands.



Validate:



uploaded files



modelling parameters



filenames



project identifiers



Avoid path traversal vulnerabilities.



Run containers as non-root where practical.



Do not expose internal geometry worker services directly to the internet.



Store user data under persistent application-controlled paths.



31\. Authentication



Architect the system so authentication can be enabled.



For the first version, a single-user deployment is acceptable.



However, do not design the project structure in a way that makes future multi-user support impossible.



Potential future authentication:



local username/password



reverse proxy authentication



Microsoft Entra ID / OIDC



Cloudflare Access



Authentication should be separable from CAD modelling logic.



32\. API



Create a clean internal API.



Likely operations include:



create project



open project



save project



duplicate project



add feature



edit feature



remove feature



reorder/insert feature



regenerate model



retrieve body list



retrieve tessellation



upload reference image



export body



measure geometry



Prefer a well-defined REST API unless a different interface provides a clear technical advantage.



WebSockets may be used for:



regeneration progress



interactive geometry state



future collaboration



but are not mandatory for ordinary CRUD operations.



33\. Testing Requirements



CAD software requires considerably more testing than ordinary CRUD applications.



Implement tests at several layers.



Geometry tests



Examples:



20 mm × 20 mm rectangle extruded 10 mm produces correct bounding dimensions.



Ø20 profile revolved appropriately produces correct cylindrical geometry.



Boolean cut removes expected volume.



2 mm fillet modifies intended edge.



Mirrored feature appears at correct location.



Parametric tests



Example:



Rectangle width = 20.



Extrude = 10.



Fillet = 2.



Change rectangle width to 40.



Verify downstream solid regenerates correctly.



Timeline tests



Example:



Create sketch.



Extrude.



Fillet.



Roll timeline backwards.



Insert sketch.



Add cut.



Roll forward.



Verify later feature regeneration.



Persistence tests



Save and reload a project.



Verify:



geometry



timeline



parameters



sketches



body names



visibility



images



remain intact.



Export tests



Verify generated:



STL



3MF



can be opened by common slicers.



34\. Development Method



Do not attempt to implement the entire product in one giant code generation pass.



Build incrementally.



Before major implementation:



Inspect the existing repository.



Document the architecture.



Identify existing components that can be reused.



Design the data model.



Design feature evaluation.



Design persistent topology references.



Build automated tests around geometry operations.



Then build UI features.



Maintain a working application throughout development.



35\. Recommended Development Phases



Phase 1: CAD Foundation



Implement:



Docker environment



frontend shell



backend



CAD kernel



simple viewport



cube primitive generated by kernel



B-Rep → tessellation → browser rendering



orbit/pan/zoom



project persistence



This validates the core architecture.



Phase 2: Sketching



Implement:



origin planes



create sketch



line



rectangle



circle



dimensions



basic constraints



sketch solver



sketch editing



Phase 3: Parametric Solid Creation



Implement:



extrude



revolve



body tree



timeline



timeline editing



regeneration



This milestone should establish the real CAD workflow.



Phase 4: Modification



Implement:



fillet



chamfer



Boolean combine



split body



shell



Phase 5: Construction \& References



Implement:



construction plane



sketch on face



offset plane



image canvas



canvas calibration



projected geometry



Phase 6: Advanced Creation



Implement:



sweep



loft



mirror



rectangular pattern



circular pattern



emboss



Phase 7: Inspection \& Export



Implement:



measurement



STL



3MF



tessellation controls



Phase 8: UX Refinement



Implement:



ViewCube



shortcuts



improved selections



context menus



timeline error states



body visibility



renaming



better camera controls



36\. MVP Definition



The first genuinely usable MVP should allow this workflow:



Create new project.



Select XY plane.



Create sketch.



Draw rectangle.



Dimension rectangle to 100 × 50 mm.



Finish sketch.



Extrude 20 mm.



Select top face.



Create sketch.



Draw Ø10 mm circle.



Dimension its location.



Extrude Cut through body.



Apply 3 mm fillet.



Roll timeline back before the hole.



Modify original rectangle to 120 mm.



Return to end of timeline.



Verify hole and fillet regenerate correctly.



Select body.



Measure geometry.



Export body to STL.



Export body to 3MF.



Save project.



Restart application.



Open project.



Confirm full parametric history remains editable.



Do not describe the application as having achieved an MVP until this workflow operates reliably.



37\. Important Engineering Rules



Do not fake CAD functionality.



Do not:



implement extrude by manipulating Three.js meshes



perform core modelling through triangle Boolean libraries



store only exported meshes



make timeline entries cosmetic



create sketches that cannot be edited later



permanently bake dimensions into geometry



assign face references only using temporary array indexes



silently discard broken features



regenerate the entire document unnecessarily after every minor UI event



Every CAD feature must be represented as an editable parametric operation.



38\. UX Philosophy



The intended interaction model is:



Select geometry → choose operation → enter parameters → preview → commit



For example:



Select face

→ Sketch



Select profile

→ Extrude

→ 20 mm

→ Cut

→ OK



Select edges

→ Fillet

→ 3 mm

→ OK



Keep repetitive workflows fast.



Right-click contextual actions should eventually expose operations relevant to the current selection.



Keyboard shortcuts should be added for common tools once the primary workflow is stable.



39\. Visual Design



Use a clean professional engineering interface.



Avoid:



consumer-style oversized UI controls



excessive animation



unnecessary gradients



dashboard-style card layouts



wasted viewport space



Prioritise:



dense but readable controls



clear selection highlighting



strong hierarchy



responsive viewport



high information density



predictable CAD conventions



Dark and light themes can eventually be supported.



40\. Future Expansion



Architect for, but do not initially prioritise:



STEP import/export



IGES



DXF import/export



assemblies



joints



drawings



sheet metal



threads



hole tool



parametric text



configurations



variables/expressions



equation-driven dimensions



version history



multi-user collaboration



project sharing



CAM



cloud sync



mass/material properties



STEP support is especially valuable because it provides interoperability with conventional CAD systems.



41\. Expressions and Parameters



Design the feature parameter system so named parameters can be supported.



Example:



wallThickness = 2.4 mm

caseWidth = 120 mm

caseHeight = 80 mm

lidClearance = 0.25 mm



Future dimensions should be capable of using:



caseWidth / 2

wallThickness \* 3

lidClearance + 0.1 mm



Even if expression evaluation is not part of the first release, do not choose a schema that prevents it later.



42\. Project Documentation



Maintain documentation during development.



Create and maintain:



README.md



ARCHITECTURE.md



CAD\_MODEL.md



FEATURE\_TIMELINE.md



API.md



DOCKER.md



DEVELOPMENT.md



ROADMAP.md



CAD\_MODEL.md should specifically document:



B-Rep representation



feature evaluation



body identity



topology references



dependency graph



regeneration



tessellation



measurement



export



Do not let important architectural decisions live only in source-code comments.



43\. Coding Agent Behaviour



When implementing this project:



Do not blindly generate large amounts of code.



For each significant feature:



Inspect existing architecture.



Explain internally how the feature should integrate.



Modify the smallest appropriate subsystem.



Add tests.



Run tests.



Start the actual application.



Verify the application behaves correctly.



Inspect browser console/server logs for errors.



Fix regressions before continuing.



When working on UI functionality, verify the actual rendered UI instead of assuming that successful compilation means the feature works.



When working on geometry, create reproducible numeric test models rather than relying solely on visual confirmation.



Never replace a robust architectural implementation with a temporary hack merely to make a UI button appear functional.



Final Objective



The finished application should feel like a deliberately simplified, self-hosted alternative to the parametric solid-modelling portion of Fusion 360.



The core concept is:



Sketch → constrain → feature → body → timeline → modify → regenerate → export



Everything in the architecture should support that model.



Parametric history, persistent geometry references, robust B-Rep modelling and timeline regeneration are more important than adding a large quantity of superficial modelling tools.



Build the CAD engine correctly first. Add breadth after the underlying parametric system is reliable.

