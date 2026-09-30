import { useStore, type SketchTool } from "../store";
import type { SketchConstraint } from "@rockett/shared";
import { openDialog } from "../commands/design";
import {
  runCommand,
  toolbarFor,
  tooltipOf,
  useRegistrations,
  type CommandContext,
  type ToolbarCommand,
  type ToolbarGroup,
} from "../commands/registry";
import { SketchInsertButtons } from "./SketchInsertButtons";
import { SKETCH_SHORTCUTS } from "../shortcuts";
import { ToolButton } from "./ToolButton";
import { HorizontalScroll } from "./HorizontalScroll";
import { NumField } from "./form/fields";
import {
  CONSTRAINTS,
  constraintFor,
  sketchSelectionIds,
  type RelationType,
} from "../sketchRelations";

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

const sketchTitle = (t: (typeof SKETCH_TOOLS)[number]) =>
  tooltipOf({
    label: t.label,
    keys: SKETCH_SHORTCUTS.filter((k) => k.tool === t.id).map((k) => k.key),
  });

export async function addSketchConstraints(constraints: SketchConstraint[]) {
  const s = useStore.getState();
  if (!s.draftSketch) return;
  s.updateDraftSketch(s.draftSketch.entities, [
    ...s.draftSketch.constraints,
    ...constraints,
  ]);
  await s.commitDraftSketch();
  useStore.getState().setSelection([]);
}

export function Toolbar() {
  const mode = useStore((s) => s.mode);
  useStore((s) => s.busy);
  useStore((s) => s.active?.id);
  useRegistrations();

  if (mode.name === "sketch") return <SketchToolbar />;

  const ctx = useStore.getState();
  const rows = toolbarFor("design", ctx);
  const group = ({ group: g, commands }: (typeof rows)[number]) => (
    <DesignGroup key={g.id} group={g} commands={commands} ctx={ctx} />
  );
  return (
    <HorizontalScroll className="toolbar">
      {rows.filter((r) => !r.group.end).map(group)}
      <div className="tb-spacer" />
      {rows.filter((r) => r.group.end).map(group)}
    </HorizontalScroll>
  );
}

function DesignGroup({
  group,
  commands,
  ctx,
}: {
  group: ToolbarGroup;
  commands: ToolbarCommand[];
  ctx: CommandContext;
}) {
  return (
    <ToolGroup title={group.label}>
      {commands.map((c) =>
        c.Control ? (
          <c.Control key={c.id} />
        ) : (
          <ToolButton
            key={c.id}
            icon={c.icon}
            label={c.label}
            title={tooltipOf(c)}
            {...(c.primary && { className: "primary" })}
            {...(c.active && { className: c.active(ctx) ? "active" : "" })}
            disabled={(c.enabled?.(ctx) ?? true) !== true}
            onClick={() => void runCommand(c.id)}
          />
        ),
      )}
    </ToolGroup>
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
      {title && <span className="tb-title">{title}</span>}
      <div className="tb-row">{children}</div>
    </div>
  );
}

function PolygonFields() {
  const dialogParams = useStore((s) => s.dialogParams);
  const setDialogParams = useStore((s) => s.setDialogParams);
  return (
    <>
      <NumField
        className="tb-input"
        title="Polygon sides"
        ariaLabel="Polygon sides"
        int
        min={3}
        max={24}
        value={Number(dialogParams.polygonSides ?? 6)}
        onChange={(v) => setDialogParams({ polygonSides: v })}
      />
      <select
        className="tb-select"
        title="Polygon type: Inscribed puts the vertices on the circle, Circumscribed puts the flats on it"
        aria-label="Polygon type"
        value={dialogParams.polygonType ?? "inscribed"}
        onChange={(e) => setDialogParams({ polygonType: e.target.value })}
      >
        <option value="inscribed">Inscribed</option>
        <option value="circumscribed">Circumscribed</option>
      </select>
      <NumField
        className="tb-input"
        title="Polygon angle: the first vertex's angle from sketch X in degrees. Empty follows the cursor; Shift snaps"
        ariaLabel="Polygon angle"
        label="∠"
        value={dialogParams.polygonAngle ?? Number.NaN}
        onChange={(v) => setDialogParams({ polygonAngle: v })}
        onClear={() => setDialogParams({ polygonAngle: undefined })}
      />
    </>
  );
}

function SketchToolbar() {
  const mode = useStore((s) => s.mode);
  const busy = useStore((s) => s.busy);
  const setSketchTool = useStore((s) => s.setSketchTool);
  const finishSketch = useStore((s) => s.finishSketch);
  const setMode = useStore((s) => s.setMode);
  const selection = useStore((s) => s.selection);
  const draft = useStore((s) => s.draftSketch);
  const setError = useStore((s) => s.setError);

  if (mode.name !== "sketch") return null;
  const tool = mode.tool;

  const applyConstraint = async (type: RelationType) => {
    if (!draft) return;
    const c = constraintFor(draft, sketchSelectionIds(selection), type);
    if (!c) {
      setError(
        `Selection doesn't match the ${type} constraint: check the tooltip`,
      );
      return;
    }
    await addSketchConstraints([c]);
  };

  const extrudeSketch = async () => {
    const s = useStore.getState();
    const selected = s.selection.filter(
      (item) => item.kind === "profile" && item.sketchId === mode.sketchId,
    );
    await s.finishSketch();
    if (useStore.getState().mode.name !== "idle") return;
    useStore.getState().setSelection(selected);
    openDialog("extrude");
  };

  return (
    <HorizontalScroll className="toolbar sketch">
      <ToolGroup title="SKETCH">
        {SKETCH_TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            icon={t.id}
            label={t.label}
            className={tool === t.id ? "active" : ""}
            title={sketchTitle(t)}
            onClick={() => setSketchTool(t.id)}
          />
        ))}
        {tool === "polygon" && <PolygonFields />}
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
          onClick={() =>
            void useStore
              .getState()
              .deleteSketchEntities(sketchSelectionIds(selection))
          }
        />
      </ToolGroup>
      <ToolGroup title="INSERT">
        <SketchInsertButtons />
      </ToolGroup>
      <div className="tb-spacer" />
      <div className="tb-group">
        <ToolButton
          icon="extrude"
          label="Extrude"
          title="Finish Sketch and extrude a profile"
          disabled={busy}
          onClick={() => void extrudeSketch()}
        />
        <ToolButton
          icon="finishSketch"
          label="Finish Sketch"
          className="primary"
          onClick={() => void finishSketch()}
        />
      </div>
    </HorizontalScroll>
  );
}
