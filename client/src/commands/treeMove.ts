import { runCommand } from "./registry";
import { setFeatureParams } from "./featureCommand";
import { useStore } from "../store";

export function moveBodies(ids: string[]) {
  runCommand("design.move");
  useStore
    .getState()
    .setSelection(ids.map((bodyId) => ({ kind: "body", bodyId })));
  setFeatureParams({ tx: 0, ty: 0, tz: 0 });
}
