import {
  featureCommand,
  type FeatureCommandState,
} from "../commands/featureCommand";
import { runCommand } from "../commands/registry";
import { useContext, useMemo } from "react";
import { useStore, type Selection } from "../store";
import {
  ViewportContext,
  alignCameraToActiveSketch,
  type ViewportRef,
} from "../viewportRef";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { NAMED_VIEWS } from "../three/camera";
import { addSketchConstraints } from "./Toolbar";
import { toggleProjection } from "../commands/design";
import { relationsFor, sketchSelectionIds } from "../sketchRelations";

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

function viewItems(viewport: ViewportRef): MenuItem[] {
  return [
    { label: "Fit", action: () => viewport.current?.zoomToFit() },
    ...NAMED_VIEWS.map((v) => ({
      label: v.label,
      action: () => viewport.current?.setView(v.dir, v.up),
    })),
    {
      label:
        viewport.current?.projection === "orthographic"
          ? "Perspective"
          : "Orthographic",
      action: () => toggleProjection({ ...useStore.getState(), viewport }),
    },
  ];
}

function useRelationItems(): MenuItem[] {
  const draft = useStore((s) =>
    s.mode.name === "sketch" ? s.draftSketch : null,
  );
  const selection = useStore((s) => s.selection);
  const relations = useMemo(
    () => (draft ? relationsFor(draft, sketchSelectionIds(selection)) : []),
    [draft, selection],
  );
  return relations.map((r) => ({
    label: r.label,
    action: () => void addSketchConstraints(r.constraints),
  }));
}

export function ViewportContextMenu({
  menu,
  onClose,
  isPlanarFace,
  onDimension,
}: {
  menu: { x: number; y: number; sel: Selection | null };
  onClose: () => void;
  isPlanarFace: (sel: Selection) => boolean;
  onDimension: (
    entityId: string,
    pos: { clientX: number; clientY: number },
  ) => void;
}) {
  const viewport = useContext(ViewportContext);
  const alignToSketch = () => alignCameraToActiveSketch(viewport);
  const { sel } = menu;
  const s = useStore.getState();
  const items = useRelationItems();
  const shown = () => (
    <ContextMenu x={menu.x} y={menu.y} items={items} onClose={onClose} />
  );

  if (!sel) {
    items.push(...viewItems(viewport));
    return shown();
  }

  const open = (type: FeatureCommandState["type"], selection = [sel]) =>
    featureCommand.enter(type, { selection });

  if (sel.kind === "sketchEntity" || sel.kind === "sketchPoint") {
    const selectedIds = sketchSelectionIds(s.selection);
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
        action: () => open("extrude"),
      });
      items.push({
        label: "Press / Pull",
        action: () => open("offsetFace"),
      });
      items.push({
        label: "Shell (open this face)",
        action: () => open("shell"),
      });
    }
    items.push({
      label: "Hide body",
      action: () =>
        void s.setVisible({ bodies: { [sel.bodyId]: false }, features: {} }),
    });
  } else if (sel.kind === "edge") {
    items.push({ label: "Fillet edge", action: () => open("fillet") });
    items.push({
      label: "Chamfer edge",
      action: () => open("chamfer"),
    });
  } else if (sel.kind === "profile") {
    const regions = s.selection.filter((x) => x.kind === "profile");
    const many = regions.length > 1;
    items.push({
      label: many ? `Extrude (${regions.length} regions)` : "Extrude region",
      action: () => open("extrude", regions),
    });
    items.push({
      label: many ? `Revolve (${regions.length} regions)` : "Revolve region",
      action: () => open("revolve", regions),
    });
  }

  if (sel.kind !== "profile") {
    items.push({
      label: "Measure",
      action: () => {
        s.setSelection([sel]);
        void runCommand("inspect.measure", viewport);
      },
    });
  }

  return shown();
}
