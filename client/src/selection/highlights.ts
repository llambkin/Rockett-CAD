import * as THREE from "three";
import type { MeshPayload, OriginAxis, PlaneRef, Vec3 } from "@rockett/shared";
import { HIGHLIGHT_APPEARANCE } from "../tunables";
import { themeColor } from "../theme/tokens";

export type HighlightStyle = "select" | "hover";

interface HighlightSources {
  bodies: ReadonlyMap<string, { shape: MeshPayload; mesh: THREE.Mesh }>;
  originAxisLines: ReadonlyMap<OriginAxis, THREE.Line>;
  originPlaneMeshes: readonly THREE.Mesh[];
  constructionPlanes: THREE.Group;
}

export class HighlightContext {
  private faces = new Map<
    string,
    { bodyId: string; names: Set<string>; style: HighlightStyle }
  >();

  constructor(
    readonly root: THREE.Group,
    readonly sources: HighlightSources,
  ) {}

  face(bodyId: string, name: string, style: HighlightStyle) {
    const key = `${style}:${bodyId}`;
    const pending = this.faces.get(key) ?? {
      bodyId,
      names: new Set<string>(),
      style,
    };
    pending.names.add(name);
    this.faces.set(key, pending);
  }

  mesh(bodyId: string) {
    const body = this.sources.bodies.get(bodyId);
    return body?.shape;
  }

  flush() {
    for (const { bodyId, names, style } of this.faces.values())
      this.body(bodyId, names, style);
    this.faces.clear();
  }

  body(
    bodyId: string,
    names: ReadonlySet<string> | null,
    style: HighlightStyle,
  ) {
    const body = this.sources.bodies.get(bodyId);
    const src = this.mesh(bodyId);
    if (!body || !src) return;
    const index = names
      ? src.faces
          .filter((f) => names.has(f.name))
          .flatMap((f) => src.indices.slice(f.start, f.start + f.count))
      : src.indices;
    if (index.length === 0) return;
    const token = style === "select" ? "selection" : "hover";
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", body.mesh.geometry.getAttribute("position"));
    geom.setAttribute("normal", body.mesh.geometry.getAttribute("normal"));
    geom.setIndex(index);
    geom.addEventListener("dispose", () => {
      geom.deleteAttribute("position");
      geom.deleteAttribute("normal");
    });
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        color: themeColor(token),
        transparent: true,
        opacity: HIGHLIGHT_APPEARANCE.faceOpacity[style],
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.renderOrder = 5;
    mesh.userData.themeToken = token;
    this.root.add(mesh);
  }

  line(points: ArrayLike<number> | undefined, style: HighlightStyle) {
    const token = style === "select" ? "selection" : "hover";
    if (!points) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3),
      ),
      new THREE.LineBasicMaterial({
        color: themeColor(token),
        linewidth: HIGHLIGHT_APPEARANCE.edgeLinewidth,
        depthTest: false,
      }),
    );
    line.renderOrder = 10;
    line.userData.themeToken = token;
    this.root.add(line);
  }

  point(position: Vec3 | undefined, style: HighlightStyle) {
    if (!position) return;
    const token = style === "select" ? "selection" : "hover";
    const pt = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...position),
      ]),
      new THREE.PointsMaterial({
        color: themeColor(token),
        size: HIGHLIGHT_APPEARANCE.vertexSizePx,
        sizeAttenuation: false,
        depthTest: false,
      }),
    );
    pt.renderOrder = 11;
    pt.userData.themeToken = token;
    this.root.add(pt);
  }

  plane(ref: PlaneRef, style: HighlightStyle) {
    if (ref.kind === "face") return;
    const token = style === "select" ? "selection" : "hover";
    const mesh =
      ref.kind === "origin"
        ? this.sources.originPlaneMeshes.find(
            (m) => m.userData.originPlane === ref.plane,
          )
        : (this.sources.constructionPlanes.children.find(
            (m) => m.userData.constructionPlane === ref.featureId,
          ) as THREE.Mesh | undefined);
    if (mesh) {
      mesh.updateWorldMatrix(true, false);
      const clone = new THREE.Mesh(
        (mesh.geometry as THREE.BufferGeometry).clone(),
        new THREE.MeshBasicMaterial({
          color: themeColor(token),
          transparent: true,
          opacity: HIGHLIGHT_APPEARANCE.originPlaneOpacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      clone.applyMatrix4(mesh.matrixWorld);
      clone.userData.themeToken = token;
      this.root.add(clone);
    }
  }
}
