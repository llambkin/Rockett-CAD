import type { SweepFeature, SketchEntity, Vec3 } from "@rockett/shared";
import type { EvalState, EvaluatedSketch, ToolResult } from "./featureState.js";
import {
  acquire,
  getKernel,
  kernelCall,
  pnt,
  progress,
  scoped,
  type Shape,
} from "./kernel.js";
import { finalizeNames, namingVersion, sweptNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { arcEdge, snapper, sideEdgeNames } from "./sketchGeom.js";
import { uvTo3d } from "./frames.js";
import { applyToolOperation } from "./boolean.js";
import { resolveProfiles, applyProfileTools } from "./profileTools.js";

export function evalSweep(state: EvalState, f: SweepFeature) {
  const { faces: profileFaces } = resolveProfiles(state, f.profiles);
  const pathSketch = state.sketches.get(f.pathSketchId);
  if (!pathSketch) throw new Error(`path sketch ${f.pathSketchId} not found`);
  const k = getKernel();
  const points = new Map<string, { x: number; y: number }>();
  for (const e of pathSketch.entities) {
    if (e.kind === "point") points.set(e.id, { x: e.x, y: e.y });
  }
  const chain = orderOpenChain(pathSketch.entities, points);
  const wire = acquire(
    kernelCall("sweep path", () =>
      scoped((own) => {
        if (chain.length === 0)
          throw new Error("path sketch contains no usable curves");
        const wireMaker = own(new k.BRepBuilderAPI_MakeWire_1());
        for (const seg of chain) {
          const edge = sketchEntityToEdge(seg, pathSketch, points);
          if (edge) wireMaker.Add_1(own(edge));
          if (!wireMaker.IsDone())
            throw new Error("sweep path is not a connected chain");
        }
        return own.keep(own(wireMaker.Wire()));
      }),
    ),
  );

  const tools = profileFaces.map((pf) =>
    kernelCall("sweep", (): ToolResult => {
      const pipe = acquire(new k.BRepOffsetAPI_MakePipe_1(wire, pf.face));
      pipe.Build(progress());
      if (!pipe.IsDone()) {
        throw new Error(
          "sweep failed: check that the profile lies on the path start",
        );
      }
      const shape = acquire(pipe.Shape());
      const names =
        namingVersion() === 1
          ? finalizeNames(shape, new ShapeMap(), f.id)
          : sweptNames(
              shape,
              f.id,
              sideEdgeNames(f.id, pf),
              (e) => pipe.Generated_1(e),
              [acquire(pipe.FirstShape()), acquire(pipe.LastShape())],
            );
      return { shape, names };
    }),
  );

  if (tools.length > 1)
    return applyProfileTools(
      state,
      f.id,
      tools,
      profileFaces,
      f.operation,
      f.targets,
    );

  return applyToolOperation(state, f.id, tools[0]!, f.operation, f.targets);
}

function orderOpenChain(
  entities: SketchEntity[],
  points: Map<string, { x: number; y: number }>,
): SketchEntity[] {
  const snap = snapper();
  const ends = new Map<SketchEntity, [number, number][]>();
  const at = new Map<[number, number], SketchEntity[]>();
  for (const e of entities) {
    if ((e.kind !== "line" && e.kind !== "arc") || e.construction) continue;
    const ids = e.kind === "line" ? [e.p1, e.p2] : [e.start, e.end];
    const keys = ids.map((id) => {
      const p = points.get(id)!;
      return snap(p.x, p.y);
    });
    ends.set(e, keys);
    for (const key of keys) at.set(key, [...(at.get(key) ?? []), e]);
  }
  const notChain = new Error("sweep path is not a connected chain");
  if ([...at.values()].some((es) => es.length > 2)) throw notChain;
  const isEnd = (key: [number, number]) => at.get(key)!.length === 1;
  const curves = [...ends.keys()];
  const first = curves.find((e) => ends.get(e)!.some(isEnd)) ?? curves[0];
  if (!first) return [];
  const chain: SketchEntity[] = [];
  let cur: SketchEntity | undefined = first;
  let from = ends.get(first)!.find(isEnd) ?? ends.get(first)![0]!;
  while (cur) {
    chain.push(cur);
    const [a, b] = ends.get(cur)!;
    from = from === a ? b! : a!;
    cur = at.get(from)!.find((e) => !chain.includes(e));
  }
  if (chain.length !== curves.length) throw notChain;
  return chain;
}

function sketchEntityToEdge(
  e: SketchEntity,
  sketch: EvaluatedSketch,
  points: Map<string, { x: number; y: number }>,
): Shape | null {
  const k = getKernel();
  const to3d = (u: number, v: number): Vec3 => uvTo3d(sketch.frame, u, v);
  if (e.kind === "line") {
    const a = points.get(e.p1)!;
    const b = points.get(e.p2)!;
    const p1 = to3d(a.x, a.y);
    const p2 = to3d(b.x, b.y);
    return acquire(
      scoped((own) =>
        own.keep(
          own(
            own(
              new k.BRepBuilderAPI_MakeEdge_3(own(pnt(...p1)), own(pnt(...p2))),
            ).Edge(),
          ),
        ),
      ),
    );
  }
  if (e.kind === "arc") {
    const s = points.get(e.start)!;
    const en = points.get(e.end)!;
    return arcEdge(
      sketch.frame,
      points.get(e.center)!,
      [s.x, s.y],
      [en.x, en.y],
    );
  }
  return null;
}
