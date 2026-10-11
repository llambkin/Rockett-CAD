import { DEFAULT_RHO } from "./commands/sketch";
import * as tools from "./sketchTools";
import { asConstruction } from "./sketchTools";
import {
  createConic,
  createControlSpline,
  createFitSpline,
} from "./splineTools";
import { useStore } from "./store";

const sketchState = () => {
  const { active } = useStore.getState();
  return active?.id === "design.sketch" ? active.state : null;
};

export function polygonOptions(): tools.PolygonOptions {
  const sketch = sketchState();
  const angle = sketch?.polygonAngle ?? null;
  return {
    sides: sketch?.polygonSides || 6,
    type: sketch?.polygonType ?? "inscribed",
    angle: angle !== null && Number.isFinite(angle) ? angle : null,
  };
}

export const conicRho = () => sketchState()?.conicRho ?? DEFAULT_RHO;

export function finishClicks(
  tool: string,
  clicks: tools.UV[],
  construction: boolean,
): tools.Created | null {
  const created =
    tool === "fitSpline"
      ? createFitSpline(clicks)
      : tool === "controlSpline"
        ? createControlSpline(clicks)
        : null;
  return created && construction ? asConstruction(created) : created;
}

export function buildFromClicksRaw(
  tool: string,
  clicks: tools.UV[],
  construction: boolean,
): { created: tools.Created | null; chain: boolean } | null {
  switch (tool) {
    case "line":
      return clicks.length >= 2
        ? {
            created: tools.createLine(clicks[0]!, clicks[1]!, construction),
            chain: true,
          }
        : null;
    case "rect":
      return clicks.length >= 2
        ? { created: tools.createRect(clicks[0]!, clicks[1]!), chain: false }
        : null;
    case "centerRect":
      return clicks.length >= 2
        ? {
            created: tools.createCenterRect(clicks[0]!, clicks[1]!),
            chain: false,
          }
        : null;
    case "circle":
      return clicks.length >= 2
        ? {
            created: tools.createCircle(clicks[0]!, clicks[1]!),
            chain: false,
          }
        : null;
    case "arc3":
      return clicks.length >= 3
        ? {
            created: tools.createArc3(clicks[0]!, clicks[1]!, clicks[2]!),
            chain: false,
          }
        : null;
    case "ellipse":
      return clicks.length >= 3
        ? {
            created: tools.createEllipse(clicks[0]!, clicks[1]!, clicks[2]!),
            chain: false,
          }
        : null;
    case "polygon": {
      if (clicks.length < 2) return null;
      return {
        created: tools.createPolygon(clicks[0]!, clicks[1]!, polygonOptions()),
        chain: false,
      };
    }
    case "slot": {
      if (clicks.length < 3) return null;
      const r = Math.hypot(
        clicks[2]!.x - clicks[1]!.x,
        clicks[2]!.y - clicks[1]!.y,
      );
      return {
        created: tools.createSlot(clicks[0]!, clicks[1]!, Math.max(r, 0.5)),
        chain: false,
      };
    }
    case "conic": {
      if (clicks.length < 3) return null;
      const made = createConic(clicks[0]!, clicks[1]!, clicks[2]!, conicRho());
      if (typeof made === "object") return { created: made, chain: false };
      useStore.getState().setError(made);
      return { created: null, chain: false };
    }
    default:
      return null;
  }
}
