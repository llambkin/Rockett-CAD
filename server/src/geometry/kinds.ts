import { evalCombine, evalOffsetFace, evalSplitBody } from "./boolean.js";
import type { Feature, FeatureType } from "@rockett/shared";
import {
  registerFeatureKind,
  type EvalContext,
  type FeatureKind,
} from "./featureKinds.js";
import {
  evalCircularPattern,
  evalConstructionPlane,
  evalImportMesh,
  evalImportStep,
  evalLinearPattern,
  evalMirror,
  evalReferenceImage,
  evalRevolve,
  evalSketch,
  evalSweep,
  type FeatureOutcome,
} from "./features.js";
import { evalChamfer, evalFillet } from "./blend.js";
import { evalEmboss, evalExtrude } from "./extrude.js";
import { evalLoft } from "./loft.js";
import { evalMove } from "./move.js";
import { evalShell } from "./shell.js";

const kind = <T extends FeatureType>(
  type: T,
  evaluate: (
    ctx: EvalContext,
    f: Extract<Feature, { type: T }>,
  ) => FeatureOutcome | void,
): FeatureKind => ({ type, evaluate });

const kinds = [
  kind("shell", evalShell),
  kind("extrude", (ctx, f) => evalExtrude(ctx.state, f)),
  kind("revolve", (ctx, f) => evalRevolve(ctx.state, f)),
  kind("emboss", (ctx, f) => evalEmboss(ctx.state, f)),
  kind("sweep", (ctx, f) => evalSweep(ctx.state, f)),
  kind("loft", (ctx, f) => evalLoft(ctx.state, f)),
  kind("fillet", (ctx, f) => evalFillet(ctx.state, f)),
  kind("chamfer", (ctx, f) => evalChamfer(ctx.state, f)),
  kind("offsetFace", (ctx, f) => evalOffsetFace(ctx.state, f)),
  kind("combine", (ctx, f) => evalCombine(ctx.state, f)),
  kind("splitBody", (ctx, f) => evalSplitBody(ctx.state, f)),
  kind("move", evalMove),
  kind("mirror", (ctx, f) => evalMirror(ctx.state, f)),
  kind("linearPattern", (ctx, f) => evalLinearPattern(ctx.state, f)),
  kind("circularPattern", (ctx, f) => evalCircularPattern(ctx.state, f)),
  kind("constructionPlane", (ctx, f) => evalConstructionPlane(ctx.state, f)),
  kind("referenceImage", (ctx, f) => evalReferenceImage(ctx.state, f)),
  kind("sketch", (ctx, f) => evalSketch(ctx.state, f)),
  kind("importStep", evalImportStep),
  kind("importMesh", evalImportMesh),
];

for (const k of kinds) registerFeatureKind(k);
