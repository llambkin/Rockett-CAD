import { useStore, type Selection } from "../store";
import { SurfaceMenu } from "./ContextMenu";

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
  const sketching = useStore((s) => s.active?.id === "design.sketch");
  const { x, y, sel } = menu;
  const at = { x, y, onClose };
  if (!sel)
    return <SurfaceMenu {...at} surface="design.viewport.empty" target={{}} />;
  if (sel.kind === "sketchEntity" || sel.kind === "sketchPoint") {
    const pick = {
      id: sel.sketchId,
      entityId: sel.entityId,
      curve: sel.kind === "sketchEntity",
    };
    if (!sketching)
      return (
        <SurfaceMenu
          {...at}
          surface="design.viewport.sketchCurve"
          target={pick}
        />
      );
    const dimension = () =>
      onDimension(sel.entityId, { clientX: x, clientY: y });
    return (
      <SurfaceMenu
        {...at}
        surface="design.viewport.draftCurve"
        target={{ ...pick, dimension }}
      />
    );
  }
  if (sel.kind === "face")
    return (
      <SurfaceMenu
        {...at}
        surface="design.viewport.face"
        target={{ sel, planar: isPlanarFace(sel) }}
      />
    );
  const surface =
    sel.kind === "edge"
      ? "design.viewport.edge"
      : sel.kind === "profile"
        ? "design.viewport.region"
        : "design.viewport.pick";
  return <SurfaceMenu {...at} surface={surface} target={{ sel }} />;
}
