/**
 * Main toolbar. Two states: modelling toolbar (Sketch/Create/Modify/…) and the
 * sketch toolbar (drawing tools, constraints, finish sketch).
 */

import { useStore, type DialogType, type SketchTool } from "../store";
import { newId, type SketchConstraint } from "@rockett/shared";
import { viewportHandle, alignCameraToActiveSketch } from "../viewportRef";
import { filterSelectionFor } from "../dialogPicks";
import { StepImportButton } from "./StepImportButton";
import { SketchInsertButtons } from "./SketchInsertButtons";
import { withKey } from "../shortcuts";
import { ToolButton } from "./ToolButton";
import type { IconId } from "../icons";

type DialogButton = { id: DialogType & IconId; label: string; title: string };

const CREATE: DialogButton[] = [
  {
    id: "extrude",
    label: "Extrude",
    title: withKey("Extrude profiles", "extrude"),
  },
  { id: "revolve", label: "Revolve", title: "Revolve profiles around an axis" },
  { id: "sweep", label: "Sweep", title: "Sweep a profile along a path" },
  { id: "loft", label: "Loft", title: "Loft between profiles" },
  { id: "emboss", label: "Emboss", title: "Emboss/deboss sketch onto a face" },
];

const MODIFY: DialogButton[] = [
  { id: "fillet", label: "Fillet", title: withKey("Fillet edges", "fillet") },
  { id: "chamfer", label: "Chamfer", title: "Chamfer edges" },
  { id: "shell", label: "Shell", title: "Shell: hollow the body" },
  { id: "combine", label: "Combine", title: "Combine: join, cut or intersect" },
  { id: "splitBody", label: "Split", title: "Split a body with a plane" },
  { id: "offsetFace", label: "Press/Pull", title: "Press/Pull a planar face" },
  { id: "move", label: "Move", title: withKey("Move bodies", "move") },
];

const PATTERN: DialogButton[] = [
  { id: "mirror", label: "Mirror", title: "Mirror bodies across a plane" },
  {
    id: "linearPattern",
    label: "Rect Pattern",
    title: "Rect Pattern: repeat in rows and columns",
  },
  {
    id: "circularPattern",
    label: "Circ Pattern",
    title: "Circ Pattern: repeat around an axis",
  },
];

const SKETCH_TOOLS: Array<{ id: SketchTool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "line", label: "Line" },
  { id: "rect", label: "Rect" },
  { id: "centerRect", label: "C-Rect" },
  { id: "circle", label: "Circle" },
  { id: "arc3", label: "Arc" },
  { id: "polygon", label: "Polygon" },
  { id: "slot", label: "Slot" },
  { id: "point", label: "Point" },
  { id: "dimension", label: "Dimension" },
  { id: "project", label: "Project" },
  { id: "trim", label: "Trim" },
  { id: "extend", label: "Extend" },
  { id: "offset", label: "Offset" },
];

const CONSTRAINTS: Array<{ type: IconId; label: string; title: string }> = [
  { type: "horizontal", label: "Horizontal", title: "Horizontal" },
  { type: "vertical", label: "Vertical", title: "Vertical" },
  {
    type: "coincident",
    label: "Coincident",
    title: "Coincident (2 points, or a point on a line, circle or arc)",
  },
  { type: "parallel", label: "Parallel", title: "Parallel (2 lines)" },
  {
    type: "perpendicular",
    label: "Perpendicular",
    title: "Perpendicular (2 lines)",
  },
  { type: "tangent", label: "Tangent", title: "Tangent (line + circle)" },
  { type: "equal", label: "Equal", title: "Equal (2 lines / 2 circles)" },
  {
    type: "concentric",
    label: "Concentric",
    title: "Concentric (2 circles/arcs)",
  },
  { type: "midpoint", label: "Midpoint", title: "Midpoint (point + line)" },
  { type: "collinear", label: "Collinear", title: "Collinear (2 lines)" },
  { type: "fix", label: "Fix", title: "Fix point" },
];

/** Opens a feature dialog, keeping any pre-selected geometry it can use (select-then-command). */
export function openDialog(dialog: DialogType) {
  const s = useStore.getState();
  const kept = filterSelectionFor(dialog, s.selection);
  s.setMode({ name: "dialog", dialog });
  s.setSelection(kept);
}

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const busy = useStore((s) => s.busy);

  if (mode.name === "sketch") return <SketchToolbar />;

  // A pre-selected plane or planar face starts the sketch there directly;
  // otherwise fall back to pick-a-plane mode.
  const createSketch = async () => {
    const s = useStore.getState();
    const plane = s.selection.find((x) => x.kind === "plane") as any;
    if (plane) {
      await s.startSketchOnPlane(plane.ref);
      alignCameraToActiveSketch();
      return;
    }
    const face = s.selection.find((x) => x.kind === "face") as any;
    if (face) {
      const body = s.evaluation?.bodies.find((b) => b.bodyId === face.bodyId);
      const surf = body?.faces.find((f) => f.name === face.faceName)?.surface;
      if (surf?.type === "plane") {
        await s.startSketchOnPlane({
          kind: "face",
          face: { kind: "face", bodyId: face.bodyId, faceName: face.faceName },
        });
        alignCameraToActiveSketch();
        return;
      }
    }
    setMode({ name: "pickPlane", purpose: "sketch" });
  };

  return (
    <div className="toolbar">
      <ToolGroup title="SKETCH">
        <ToolButton
          icon="sketch"
          label="Create Sketch"
          className="primary"
          disabled={busy}
          onClick={() => void createSketch()}
          title={withKey("Create Sketch on a plane or planar face", "sketch")}
        />
      </ToolGroup>
      <DialogGroup title="CREATE" buttons={CREATE} busy={busy} />
      <DialogGroup title="MODIFY" buttons={MODIFY} busy={busy} />
      <ToolGroup title="CONSTRUCT">
        <ToolButton
          icon="constructionPlane"
          label="Plane"
          title="Construction plane (offset / midplane)"
          disabled={busy}
          onClick={() => openDialog("constructionPlane")}
        />
      </ToolGroup>
      <DialogGroup title="PATTERN" buttons={PATTERN} busy={busy} />
      <ToolGroup title="INSPECT">
        <ToolButton
          icon="measure"
          label="Measure"
          className={mode.name === "measure" ? "active" : ""}
          title={withKey("Measure", "measure")}
          onClick={() =>
            setMode({ name: mode.name === "measure" ? "idle" : "measure" })
          }
        />
      </ToolGroup>
      <ToolGroup title="INSERT">
        <StepImportButton />
        <ToolButton
          icon="referenceImage"
          label="Canvas"
          title="Canvas: insert a reference image"
          disabled={busy}
          onClick={() => openDialog("referenceImage")}
        />
      </ToolGroup>
      <ToolGroup title="EXPORT">
        <ToolButton
          icon="export"
          label="STL / 3MF"
          title="STL / 3MF export"
          disabled={busy}
          onClick={() => openDialog("export")}
        />
      </ToolGroup>
      <div className="tb-spacer" />
      <ViewButtons />
    </div>
  );
}

export const NAMED_VIEWS: Array<{
  label: string;
  dir: [number, number, number];
  up: [number, number, number];
}> = [
  { label: "Front", dir: [0, -1, 0], up: [0, 0, 1] },
  { label: "Back", dir: [0, 1, 0], up: [0, 0, 1] },
  { label: "Left", dir: [-1, 0, 0], up: [0, 0, 1] },
  { label: "Right", dir: [1, 0, 0], up: [0, 0, 1] },
  { label: "Top", dir: [0, 0, 1], up: [0, 1, 0] },
  { label: "Bottom", dir: [0, 0, -1], up: [0, -1, 0] },
  { label: "Iso", dir: [1, -1, 0.8], up: [0, 0, 1] },
];

export function toggleProjection() {
  const vp = viewportHandle.current;
  if (!vp) return;
  vp.setProjection(
    vp.projection === "orthographic" ? "perspective" : "orthographic",
  );
}

function ToolGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="tb-group">
      <span className="tb-title">{title}</span>
      <div className="tb-row">{children}</div>
    </div>
  );
}

function DialogGroup({
  title,
  buttons,
  busy,
}: {
  title: string;
  buttons: DialogButton[];
  busy: boolean;
}) {
  return (
    <ToolGroup title={title}>
      {buttons.map((b) => (
        <ToolButton
          key={b.id}
          icon={b.id}
          label={b.label}
          title={b.title}
          disabled={busy}
          onClick={() => openDialog(b.id)}
        />
      ))}
    </ToolGroup>
  );
}

function ViewButtons() {
  return (
    <div className="tb-group views">
      <select
        className="tb-select"
        title="Named views"
        value=""
        onChange={(e) => {
          const v = NAMED_VIEWS.find((x) => x.label === e.target.value);
          if (v) viewportHandle.current?.setView(v.dir, v.up);
        }}
      >
        <option value="" disabled>
          View
        </option>
        {NAMED_VIEWS.map((v) => (
          <option key={v.label}>{v.label}</option>
        ))}
      </select>
      <ToolButton
        icon="fit"
        label="Fit"
        title="Zoom to fit (Shift+F)"
        onClick={() => viewportHandle.current?.zoomToFit()}
      />
      <ToolButton
        icon="projection"
        label="Ortho/Persp"
        title="Ortho/Persp: toggle orthographic or perspective"
        onClick={toggleProjection}
      />
    </div>
  );
}

function SketchToolbar() {
  const mode = useStore((s) => s.mode);
  const setSketchTool = useStore((s) => s.setSketchTool);
  const finishSketch = useStore((s) => s.finishSketch);
  const setMode = useStore((s) => s.setMode);
  const selection = useStore((s) => s.selection);
  const draft = useStore((s) => s.draftSketch);
  const updateDraft = useStore((s) => s.updateDraftSketch);
  const commit = useStore((s) => s.commitDraftSketch);
  const setError = useStore((s) => s.setError);
  const dialogParams = useStore((s) => s.dialogParams);
  const setDialogParams = useStore((s) => s.setDialogParams);

  if (mode.name !== "sketch") return null;
  const tool = mode.tool;

  const applyConstraint = async (type: string) => {
    if (!draft) return;
    const entityIds = selection
      .filter((s) => s.kind === "sketchEntity" || s.kind === "sketchPoint")
      .map((s: any) => s.entityId);
    const find = (id: string) => draft.entities.find((e) => e.id === id);
    const points = entityIds.filter((id) => find(id)?.kind === "point");
    const lines = entityIds.filter((id) => find(id)?.kind === "line");
    const circleLikes = entityIds.filter((id) => {
      const k = find(id)?.kind;
      return k === "circle" || k === "arc";
    });

    let c: SketchConstraint | null = null;
    const id = newId("c");
    switch (type) {
      case "horizontal":
        if (lines.length >= 1) c = { id, type: "horizontal", line: lines[0] };
        break;
      case "vertical":
        if (lines.length >= 1) c = { id, type: "vertical", line: lines[0] };
        break;
      case "coincident": {
        const [point] = points;
        const [circle] = circleLikes;
        const [line] = lines;
        const own = (curve: string) => {
          const e = find(curve);
          if (e?.kind === "line") return [e.p1, e.p2];
          if (e?.kind === "circle") return [e.center];
          if (e?.kind === "arc") return [e.center, e.start, e.end];
          return [];
        };
        const at = (p: string) => {
          const e = find(p);
          return e?.kind === "point" ? e : { x: NaN, y: NaN };
        };
        const offCurve = (p: string) => {
          const e = find(circle);
          if (e?.kind !== "circle" && e?.kind !== "arc") return Infinity;
          const o = at(e.center);
          const r =
            e.kind === "circle"
              ? e.radius
              : Math.hypot(at(e.start).x - o.x, at(e.start).y - o.y);
          return Math.abs(Math.hypot(at(p).x - o.x, at(p).y - o.y) - r);
        };
        if (points.length >= 2)
          c = { id, type: "coincident", a: points[0], b: points[1] };
        else if (point && circle && !own(circle).includes(point))
          c = { id, type: "pointOnCircle", point, circle };
        else if (point && line && !own(line).includes(point))
          c = { id, type: "pointOnLine", point, line };
        else if (!point && line && circle)
          c = {
            id,
            type: "pointOnCircle",
            point: own(line).reduce((a, b) =>
              offCurve(b) < offCurve(a) ? b : a,
            ),
            circle,
          };
        break;
      }
      case "parallel":
        if (lines.length >= 2)
          c = { id, type: "parallel", a: lines[0], b: lines[1] };
        break;
      case "perpendicular":
        if (lines.length >= 2)
          c = { id, type: "perpendicular", a: lines[0], b: lines[1] };
        break;
      case "tangent":
        if (lines.length >= 1 && circleLikes.length >= 1)
          c = { id, type: "tangent", a: lines[0], b: circleLikes[0] };
        else if (circleLikes.length >= 2)
          c = { id, type: "tangent", a: circleLikes[0], b: circleLikes[1] };
        break;
      case "equal":
        if (lines.length >= 2)
          c = { id, type: "equal", a: lines[0], b: lines[1] };
        else if (circleLikes.length >= 2)
          c = { id, type: "equal", a: circleLikes[0], b: circleLikes[1] };
        break;
      case "concentric":
        if (circleLikes.length >= 2)
          c = { id, type: "concentric", a: circleLikes[0], b: circleLikes[1] };
        break;
      case "midpoint":
        if (points.length >= 1 && lines.length >= 1)
          c = { id, type: "midpoint", point: points[0], line: lines[0] };
        break;
      case "collinear":
        if (lines.length >= 2)
          c = { id, type: "collinear", a: lines[0], b: lines[1] };
        break;
      case "fix":
        if (points.length >= 1) c = { id, type: "fix", point: points[0] };
        break;
    }
    if (!c) {
      setError(
        `Selection doesn't match the ${type} constraint — check the tooltip`,
      );
      return;
    }
    updateDraft(draft.entities, [...draft.constraints, c]);
    await commit();
    useStore.getState().setSelection([]);
  };

  const deleteSelected = async () => {
    const ids = selection
      .filter((s) => s.kind === "sketchEntity" || s.kind === "sketchPoint")
      .map((s: any) => s.entityId);
    await useStore.getState().deleteSketchEntities(ids);
  };

  return (
    <div className="toolbar sketch">
      <ToolGroup title="SKETCH">
        {SKETCH_TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.id}
            label={t.label}
            className={tool === t.id ? "active" : ""}
            title={withKey(t.label, t.id)}
            onClick={() => setSketchTool(t.id)}
          />
        ))}
        {tool === "polygon" && (
          <input
            className="tb-input"
            type="number"
            min={3}
            max={24}
            value={dialogParams.polygonSides ?? 6}
            onChange={(e) =>
              setDialogParams({ polygonSides: Number(e.target.value) })
            }
            title="Polygon sides"
          />
        )}
        <ToolButton
          icon="construction"
          label="Construction"
          className={mode.constructionMode ? "active" : ""}
          title="Toggle construction geometry (X)"
          onClick={() =>
            setMode({ ...mode, constructionMode: !mode.constructionMode })
          }
        />
      </ToolGroup>
      <ToolGroup title="CONSTRAIN">
        {CONSTRAINTS.map((c) => (
          <ToolButton
            key={c.type}
            icon={c.type}
            label={c.label}
            iconOnly
            title={c.title}
            onClick={() => void applyConstraint(c.type)}
          />
        ))}
        <ToolButton
          icon="delete"
          label="Delete"
          title="Delete selected (Del)"
          onClick={() => void deleteSelected()}
        />
      </ToolGroup>
      <ToolGroup title="INSERT">
        <SketchInsertButtons />
      </ToolGroup>
      <div className="tb-spacer" />
      <div className="tb-group">
        <ToolButton
          icon="finishSketch"
          label="Finish Sketch"
          className="primary"
          onClick={() => void finishSketch()}
        />
      </div>
    </div>
  );
}
