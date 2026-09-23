import { useStore, type Selection } from "../store";
import { viewportHandle } from "../viewportRef";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { NAMED_VIEWS } from "../three/camera";
import { toggleProjection } from "./Toolbar";

async function toggleSketchConstruction(sketchId: string, entityIds: string[]) {
  const s = useStore.getState();
  const sk = s.document?.features.find(
    (f) => f.id === sketchId && f.type === "sketch",
  ) as any;
  if (!sk) return;
  const ids = new Set(entityIds);
  const entities = sk.entities.map((e: any) =>
    ids.has(e.id) && e.kind !== "point"
      ? { ...e, construction: !e.construction }
      : e,
  );
  await s.updateFeature(sketchId, { entities } as any);
}

function viewItems(): MenuItem[] {
  return [
    { label: "Fit", action: () => viewportHandle.current?.zoomToFit() },
    ...NAMED_VIEWS.map((v) => ({
      label: v.label,
      action: () => viewportHandle.current?.setView(v.dir, v.up),
    })),
    {
      label:
        viewportHandle.current?.projection === "orthographic"
          ? "Perspective"
          : "Orthographic",
      action: toggleProjection,
    },
  ];
}

export function ViewportContextMenu({
  menu,
  onClose,
  isPlanarFace,
  alignToSketch,
  onDimension,
}: {
  menu: { x: number; y: number; sel: Selection | null };
  onClose: () => void;
  isPlanarFace: (sel: Selection) => boolean;
  alignToSketch: () => void;
  onDimension: (
    entityId: string,
    pos: { clientX: number; clientY: number },
  ) => void;
}) {
  const { sel } = menu;
  const s = useStore.getState();
  const items: MenuItem[] = [];
  const shown = () => (
    <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />
  );

  if (!sel) {
    items.push(...viewItems());
    return shown();
  }

  const openDialog = (dialog: any, selection: Selection[] = [sel]) => {
    s.setMode({ name: "dialog", dialog });
    s.setSelection(selection);
  };

  if (sel.kind === "sketchEntity" || sel.kind === "sketchPoint") {
    const selectedIds = s.selection
      .filter((x) => x.kind === "sketchEntity" || x.kind === "sketchPoint")
      .map((x: any) => x.entityId);
    const many = selectedIds.length > 1;
    if (s.mode.name !== "sketch") {
      if (sel.kind === "sketchEntity") {
        items.push({
          label: many
            ? `Toggle construction (${selectedIds.length})`
            : "Toggle construction",
          action: () =>
            void toggleSketchConstruction(sel.sketchId, selectedIds),
        });
      }
      items.push({
        label: "Edit sketch",
        action: () => void s.editSketch(sel.sketchId).then(alignToSketch),
      });
      return shown();
    }
    items.push({
      label: many ? `Delete (${selectedIds.length})` : "Delete",
      action: () => void s.deleteSketchEntities(selectedIds),
    });
    if (sel.kind === "sketchEntity") {
      items.push({
        label: many ? "Toggle construction (selection)" : "Toggle construction",
        action: () => void s.toggleSketchConstruction(selectedIds),
      });
      const kind = s.draftSketch?.entities.find(
        (x) => x.id === sel.entityId,
      )?.kind;
      if (kind)
        items.push({
          label: kind === "line" ? "Length and angle…" : "Dimension…",
          action: () =>
            onDimension(sel.entityId, { clientX: menu.x, clientY: menu.y }),
        });
    }
    return shown();
  }

  if (sel.kind === "face") {
    if (isPlanarFace(sel)) {
      items.push({
        label: "Create Sketch on face",
        action: () =>
          void s
            .startSketchOnPlane({
              kind: "face",
              face: {
                kind: "face",
                bodyId: sel.bodyId,
                faceName: sel.faceName,
              },
            })
            .then(alignToSketch),
      });
      items.push({
        label: "Extrude face",
        action: () => openDialog("extrude"),
      });
      items.push({
        label: "Press / Pull",
        action: () => openDialog("offsetFace"),
      });
      items.push({
        label: "Shell (open this face)",
        action: () => openDialog("shell"),
      });
    }
    items.push({
      label: "Hide body",
      action: () => void s.setBodyMeta(sel.bodyId, { visible: false }),
    });
  } else if (sel.kind === "edge") {
    items.push({ label: "Fillet edge", action: () => openDialog("fillet") });
    items.push({ label: "Chamfer edge", action: () => openDialog("chamfer") });
  } else if (sel.kind === "profile") {
    const regions = s.selection.filter((x) => x.kind === "profile");
    const many = regions.length > 1;
    items.push({
      label: many ? `Extrude (${regions.length} regions)` : "Extrude region",
      action: () => openDialog("extrude", regions),
    });
    items.push({
      label: many ? `Revolve (${regions.length} regions)` : "Revolve region",
      action: () => openDialog("revolve", regions),
    });
  }

  if (sel.kind !== "profile") {
    items.push({
      label: "Measure",
      action: () => {
        s.setMode({ name: "measure" });
        s.setSelection([sel]);
        void s.runMeasure();
      },
    });
  }

  return shown();
}
