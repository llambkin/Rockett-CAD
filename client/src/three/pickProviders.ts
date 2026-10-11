import * as THREE from "three";
import {
  createRegistry,
  type MeshPayload,
  type OriginAxis,
} from "@rockett/shared";
import type { Selection } from "../store";
import type { LayerBody } from "./meshes";
import { faceAt } from "./pickLookup";

export interface PickResult {
  selection: Selection;
  distance: number;
  point: THREE.Vector3;
  area?: number | undefined;
}

export interface PickBody {
  group: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  edgeSegments: string[];
  vertices: THREE.Points;
  vertexNames: string[];
  payload: LayerBody;
  shape: MeshPayload;
}

export interface PickContext {
  bodies: ReadonlyMap<string, PickBody>;
  originRoot: THREE.Group;
  originPlaneMeshes: readonly THREE.Mesh[];
  originAxisLines: ReadonlyMap<OriginAxis, THREE.Line>;
  constructionPlanes: THREE.Group;
  sketches: THREE.Group;
  providerIds: readonly string[];
  hits(target: PickBody | "overlays"): THREE.Intersection[];
}

export interface PickProvider {
  id: string;
  kind: Selection["kind"];
  priority: number;
  pick(
    raycaster: THREE.Raycaster,
    tolerance: number,
    ctx: PickContext,
  ): PickResult[];
}

const registry = createRegistry<PickProvider>("pick provider", (p) => p.id);
export const pickProviders = registry.list;
export function registerPickProvider(provider: PickProvider): () => void {
  if (!provider.id || !Number.isFinite(provider.priority))
    throw new Error("pick provider requires an id and finite priority");
  return registry.register(provider);
}

export function pickThresholds(worldPerPixel: number, px: number) {
  const line = worldPerPixel * px;
  return { line, point: line * 1.4 };
}

export function pickWithProviders(
  raycaster: THREE.Raycaster,
  tolerance: number,
  scene: Omit<PickContext, "hits">,
  depth = 0,
): PickResult | null {
  raycaster.params.Line = { threshold: tolerance };
  raycaster.params.Points = { threshold: pickThresholds(tolerance, 1).point };
  const hits = new Map<PickBody | "overlays", THREE.Intersection[]>();
  const ctx: PickContext = {
    ...scene,
    hits(target) {
      const cached = hits.get(target);
      if (cached) return cached;
      let result: THREE.Intersection[];
      if (target === "overlays") {
        const groups: THREE.Object3D[] = [];
        if (scene.providerIds.includes("design.constructionPlane"))
          groups.push(scene.constructionPlanes);
        if (
          ["sketch.profile", "sketch.entity", "sketch.point"].some((id) =>
            scene.providerIds.includes(id),
          )
        )
          groups.push(scene.sketches);
        result = raycaster.intersectObjects(groups, true);
      } else {
        result = raycaster.intersectObject(target.mesh, false);
      }
      hits.set(target, result);
      return result;
    },
  };
  const results = registry.list().flatMap((provider) =>
    ctx.providerIds.includes(provider.id)
      ? provider.pick(raycaster, tolerance, ctx).map((result) =>
          Object.assign({}, result, {
            distance: result.distance - tolerance * provider.priority,
          }),
        )
      : [],
  );
  results.sort((a, b) => a.distance - b.distance);
  const chosen = results[Math.min(depth, results.length - 1)];
  if (!chosen) return null;
  if (chosen.selection.kind === "profile") {
    const tied = results.filter(
      (r) =>
        r.selection.kind === "profile" &&
        Math.abs(r.distance - chosen.distance) < tolerance * 0.1,
    );
    if (tied.length > 1) {
      tied.sort((a, b) => (a.area ?? Infinity) - (b.area ?? Infinity));
      return tied[0]!;
    }
  }
  return chosen;
}

registerPickProvider({
  id: "design.vertex",
  kind: "vertex",
  priority: 2.2,
  pick(raycaster, _tolerance, ctx) {
    return [...ctx.bodies.values()].flatMap((b) => {
      if (!b.group.visible) return [];
      b.vertices.visible = true;
      let hits: THREE.Intersection[];
      try {
        hits = raycaster.intersectObject(b.vertices, false);
      } finally {
        b.vertices.visible = false;
      }
      return hits.flatMap((h) => {
        const vertexName =
          h.index === undefined ? undefined : b.vertexNames[h.index];
        return vertexName === undefined
          ? []
          : [
              {
                selection: {
                  kind: "vertex" as const,
                  bodyId: b.payload.bodyId,
                  vertexName,
                },
                distance: h.distance,
                point: h.point,
              },
            ];
      });
    });
  },
});
registerPickProvider({
  id: "design.edge",
  kind: "edge",
  priority: 1.2,
  pick(raycaster, _tolerance, ctx) {
    return [...ctx.bodies.values()].flatMap((b) => {
      if (!b.group.visible) return [];
      return raycaster.intersectObject(b.edges, false).flatMap((h) => {
        const edgeName =
          h.index === undefined
            ? undefined
            : b.edgeSegments[Math.floor(h.index / 2)];
        return !edgeName
          ? []
          : [
              {
                selection: {
                  kind: "edge" as const,
                  bodyId: b.payload.bodyId,
                  edgeName,
                },
                distance: h.distance,
                point: h.point,
              },
            ];
      });
    });
  },
});

function surfacePicks(ctx: PickContext, kind: "face" | "body"): PickResult[] {
  if (kind === "body" && ctx.providerIds.includes("design.face")) return [];
  return [...ctx.bodies.values()].flatMap((b) => {
    if (!b.group.visible) return [];
    return ctx.hits(b).flatMap((h) => {
      if (h.faceIndex === undefined || h.faceIndex === null) return [];
      const indexPos = h.faceIndex * 3;
      const face = faceAt(b.shape.faces, indexPos);
      if (kind === "face" && !face && !ctx.providerIds.includes("design.body"))
        return [];
      return [
        {
          selection:
            kind === "face" && face
              ? { kind, bodyId: b.payload.bodyId, faceName: face.name }
              : { kind: "body" as const, bodyId: b.payload.bodyId },
          distance: h.distance,
          point: h.point,
        },
      ];
    });
  });
}
registerPickProvider({
  id: "design.face",
  kind: "face",
  priority: 0,
  pick: (_raycaster, _tolerance, ctx) => surfacePicks(ctx, "face"),
});
registerPickProvider({
  id: "design.body",
  kind: "body",
  priority: 0,
  pick: (_raycaster, _tolerance, ctx) => surfacePicks(ctx, "body"),
});
registerPickProvider({
  id: "design.feature",
  kind: "feature",
  priority: 0,
  pick: () => [],
});
registerPickProvider({
  id: "design.originPlane",
  kind: "plane",
  priority: -1,
  pick(raycaster, _tolerance, ctx) {
    if (!ctx.originRoot.visible) return [];
    return ctx.originPlaneMeshes.flatMap((mesh) =>
      raycaster.intersectObject(mesh, false).map((h) => ({
        selection: {
          kind: "plane" as const,
          ref: { kind: "origin" as const, plane: mesh.userData.originPlane },
          label: `${mesh.userData.originPlane} Plane`,
        },
        distance: h.distance,
        point: h.point,
      })),
    );
  },
});
registerPickProvider({
  id: "design.originAxis",
  kind: "axis",
  priority: 1.2,
  pick(raycaster, _tolerance, ctx) {
    if (!ctx.originRoot.visible) return [];
    return [...ctx.originAxisLines].flatMap(([axis, line]) =>
      raycaster.intersectObject(line, false).map((h) => ({
        selection: { kind: "axis" as const, axis },
        distance: h.distance,
        point: h.point,
      })),
    );
  },
});
registerPickProvider({
  id: "design.constructionPlane",
  kind: "plane",
  priority: -1,
  pick(_raycaster, _tolerance, ctx) {
    return ctx.hits("overlays").flatMap((h) => {
      const ud = h.object.userData;
      return !ud.constructionPlane
        ? []
        : [
            {
              selection: {
                kind: "plane" as const,
                ref: {
                  kind: "construction" as const,
                  featureId: ud.constructionPlane,
                },
                label: ud.label ?? "Plane",
              },
              distance: h.distance,
              point: h.point,
            },
          ];
    });
  },
});
registerPickProvider({
  id: "sketch.profile",
  kind: "profile",
  priority: 1.1,
  pick(_raycaster, _tolerance, ctx) {
    return ctx.hits("overlays").flatMap((h) => {
      const ud = h.object.userData;
      if (
        !ud.profileId ||
        (ctx.providerIds.includes("design.constructionPlane") &&
          ud.constructionPlane)
      )
        return [];
      return [
        {
          selection: {
            kind: "profile" as const,
            sketchId: ud.sketchId,
            profileId: ud.profileId,
          },
          distance: h.distance,
          point: h.point,
          area: ud.area as number | undefined,
        },
      ];
    });
  },
});
function sketchPicks(ctx: PickContext, point: boolean): PickResult[] {
  return ctx.hits("overlays").flatMap((h) => {
    const ud = h.object.userData;
    if (
      !ud.sketchEntityId ||
      !!ud.isPoint !== point ||
      (ctx.providerIds.includes("sketch.profile") && ud.profileId) ||
      (ctx.providerIds.includes("design.constructionPlane") &&
        ud.constructionPlane)
    )
      return [];
    return [
      {
        selection: {
          kind: point ? "sketchPoint" : "sketchEntity",
          sketchId: ud.sketchId,
          entityId: ud.sketchEntityId,
        },
        distance: h.distance,
        point: h.point,
      },
    ];
  });
}
registerPickProvider({
  id: "sketch.entity",
  kind: "sketchEntity",
  priority: 1.3,
  pick: (_raycaster, _tolerance, ctx) => sketchPicks(ctx, false),
});
registerPickProvider({
  id: "sketch.point",
  kind: "sketchPoint",
  priority: 2,
  pick: (_raycaster, _tolerance, ctx) => sketchPicks(ctx, true),
});
