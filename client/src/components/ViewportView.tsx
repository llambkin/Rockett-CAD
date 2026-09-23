/**
 * The 3D viewport: wires the CadViewport engine to application state.
 * Handles CAD-style camera input, topology picking, plane picking,
 * sketch tool interaction (with live constraint solving), and dimensions.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type {
  PlaneFrame,
  SketchConstraint,
  SketchEntity,
  SketchSolveStatus,
} from "@rockett/shared";
import {
  formatAngle,
  formatLength,
  newId,
  modifySketch,
} from "@rockett/shared";
import { CadViewport, uv3 } from "../three/CadViewport";
import { ViewCube } from "../three/ViewCube";
import { clearGroup, disposeGroup } from "../three/dispose";
import { worldToClient } from "../three/screen";
import { syncReferenceImages } from "../three/referenceImages";
import { renderSketches, type SketchRenderInput } from "../three/sketchRender";
import { ExtrudeGizmo, type GizmoSource } from "../three/ExtrudeGizmo";
import { MoveGizmo } from "../three/MoveGizmo";
import { buildRevolveGhost } from "../three/revolveGhost";
import { RevolveGizmo } from "../three/RevolveGizmo";
import { GizmoSlot } from "../three/gizmoSlot";
import { clearToolPreview, updateToolPreview } from "../three/toolPreview";
import { listenWheel } from "../three/wheel";
import { isProfileUsed, sketchUsage } from "../sketchUsage";
import {
  previewBodyTints,
  previewedFeature,
  useStore,
  type Selection,
} from "../store";
import { api } from "../api";
import { viewportHandle, alignCameraToActiveSketch } from "../viewportRef";
import * as tools from "../sketchTools";
import { ANGLE_LOCK_KEY } from "../shortcuts";

import { DIALOG_PICKS } from "../dialogPicks";
import { dimensionLayout } from "../dimensionLayout";
import { SketchOffsetIndicators } from "./SketchOffsetIndicators";
import { ViewportContextMenu } from "./ViewportContextMenu";
import { createLivePreview } from "../livePreview";

interface DimEditField {
  constraintId: string;
  value: string;
  label?: string;
  unit?: string;
}

interface DimLabel {
  id: string;
  text: string;
  world: THREE.Vector3;
  /** Attachment on the measured geometry, independent of label placement. */
  anchorWorld: THREE.Vector3;
  reference?: [THREE.Vector3, THREE.Vector3];
}

const NUDGE_EVENTS = ["pointerdown", "pointermove", "pointerup", "wheel"];

const livePreview = createLivePreview({
  intervalMs: 250,
  send: (featureId, patch) =>
    useStore.getState().updateFeaturePreview(featureId, patch),
  now: () => performance.now(),
});

export function ViewportView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<CadViewport | null>(null);
  const viewCubeRef = useRef<ViewCube | null>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);

  const evaluation = useStore((s) => s.evaluation);
  const document_ = useStore((s) => s.document);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const draftSketch = useStore((s) => s.draftSketch);
  const dialogParams = useStore((s) => s.dialogParams);
  const previewBaseline = useStore((s) => s.previewBaseline);

  const [dimEdit, setDimEdit] = useState<{
    fields: DimEditField[];
    x: number;
    y: number;
  } | null>(null);

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    sel: Selection | null;
  } | null>(null);

  const [extrudeSlot] = useState(() => new GizmoSlot<ExtrudeGizmo>());
  const [moveSlot] = useState(() => new GizmoSlot<MoveGizmo>());
  const [revolveSlot] = useState(() => new GizmoSlot<RevolveGizmo>());
  /** in-progress dimension-label drag (repositioning the label) */
  const dimDragRef = useRef<{
    id: string;
    moved: boolean;
    startX: number;
    startY: number;
    pendingOffset: [number, number] | null;
  } | null>(null);
  const [gizmoLabel, setGizmoLabel] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  /** live size readout while drawing shapes (length / W×H / Ø) */
  const [toolLabel, setToolLabel] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  /**
   * Typed sizes while drawing (Fusion-style): fields follow the cursor until
   * a value is typed, which locks it; Tab moves between fields and Enter (or
   * the second click) places the shape honouring the locked values.
   * `dimRef` is the working copy for the key handler, `dimEntry` its render
   * snapshot.
   */
  type DimField = tools.DimField;
  const {
    fmt2,
    dimFieldsFor,
    liveDimValues,
    lockedValue,
    resolveDimCursor,
    pinTypedDims,
  } = tools;
  const dimRef = useRef<{
    tool: string;
    fields: DimField[];
    active: number;
    x: number;
    y: number;
  } | null>(null);
  const [dimEntry, setDimEntry] = useState<{
    x: number;
    y: number;
    fields: DimField[];
    active: number;
  } | null>(null);
  /** snap glyph at the snapped cursor position (triangle = midpoint, …) */
  const [snapMarker, setSnapMarker] = useState<{
    x: number;
    y: number;
    kind: NonNullable<tools.UV["snapKind"]>;
  } | null>(null);

  // Tool interaction state (kept in refs — no re-render churn)
  const toolState = useRef<{
    clicks: tools.UV[];
    dragPointId: string | null;
    chainPointId: string | null;
    dimTargets: Array<{
      kind: "point" | "line" | "circle" | "arc";
      id: string;
    }>;
    pickDepth: number;
    lastPickPos: { x: number; y: number };
    /** press position for drag-to-draw */
    downUV: tools.UV | null;
    /** last sketch-plane cursor position (Enter places typed sizes here) */
    lastCursor: tools.UV | null;
  }>({
    clicks: [],
    dragPointId: null,
    chainPointId: null,
    dimTargets: [],
    pickDepth: 0,
    lastPickPos: { x: -1, y: -1 },
    downUV: null,
    lastCursor: null,
  });

  const DRAW_TOOLS = [
    "line",
    "rect",
    "centerRect",
    "circle",
    "arc3",
    "polygon",
    "slot",
  ];
  /** tools completed by exactly two inputs — eligible for drag-to-draw */
  const TWO_POINT_TOOLS = ["line", "rect", "centerRect", "circle", "polygon"];

  const dimLabelsRef = useRef<DimLabel[]>([]);
  const leaderGroupRef = useRef<THREE.Group | null>(null);

  /**
   * Faint dashed leader lines from repositioned dimension labels back to the
   * geometry they measure. Rebuilt whenever labels change or one is dragged.
   */
  function updateDimLeaders() {
    const vp = viewportRef.current;
    if (!vp) return;
    if (!leaderGroupRef.current || leaderGroupRef.current.parent !== vp.scene) {
      leaderGroupRef.current = new THREE.Group();
      vp.scene.add(leaderGroupRef.current);
    }
    const g = leaderGroupRef.current;
    clearGroup(g);
    const wpp = vp.worldPerPixel();
    const dashed = (from: THREE.Vector3, to: THREE.Vector3) => {
      const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(
        geom,
        new THREE.LineDashedMaterial({
          color: 0x9aa2ab,
          dashSize: wpp * 5,
          gapSize: wpp * 4,
          transparent: true,
          opacity: 0.4,
          depthTest: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 7;
      g.add(line);
    };
    for (const l of dimLabelsRef.current) {
      if (l.reference) dashed(...l.reference);
      // only when the label sits away from its geometry (dragged, or far zoom)
      if (l.world.distanceTo(l.anchorWorld) < wpp * 14) continue;
      dashed(l.anchorWorld, l.world);
    }
    vp.requestRender();
  }

  // ---- engine lifecycle ----
  useEffect(() => {
    const container = containerRef.current!;
    const vp = new CadViewport(container);
    viewportRef.current = vp;
    viewportHandle.current = vp;
    if ((import.meta as any).env?.DEV) {
      // console debugging handle (dev only)
      (window as any).__rockett = { vp, store: useStore };
    }
    const cube = new ViewCube(cubeRef.current!, vp);
    viewCubeRef.current = cube;
    const onResize = () => vp.resize();
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    const nudge = () => vp.requestRender();
    const unsubscribe = useStore.subscribe(nudge);
    for (const type of NUDGE_EVENTS) {
      container.addEventListener(type, nudge, { passive: true });
    }

    vp.onRender(() => {
      const layer = labelLayerRef.current;
      if (!layer) return;
      const rect = vp.canvasRect();
      const cam = vp.camera;
      const children = layer.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        const label = dimLabelsRef.current[i];
        if (!label) continue;
        const p = worldToClient(rect, cam, label.world);
        el.style.transform = `translate(${p.x - rect.left}px, ${p.y - rect.top}px) translate(-50%, -50%)`;
        el.style.display = p.inFront ? "block" : "none";
      }
    });

    vp.zoomToFit(false);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      unsubscribe();
      for (const type of NUDGE_EVENTS) {
        container.removeEventListener(type, nudge);
      }
      cube.dispose();
      extrudeSlot.release();
      moveSlot.release();
      revolveSlot.release();
      vp.dispose();
      viewportRef.current = null;
      viewportHandle.current = null;
    };
  }, []);

  // ---- sync bodies ----
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !evaluation) return;
    vp.syncBodies(evaluation.bodies);
    const names = new Map<string, string>();
    const visible = new Set<string>();
    for (const f of document_?.features ?? []) {
      names.set(f.id, f.name);
      if (f.type === "constructionPlane" && !f.suppressed) visible.add(f.id);
    }
    vp.syncConstructionPlanes(evaluation.planes, names, visible);
    syncReferenceImages(vp, document_, evaluation);
  }, [evaluation, document_]);

  useEffect(() => {
    viewportRef.current?.setBodyTints(previewBodyTints(useStore.getState()));
  }, [evaluation, previewBaseline]);

  // ---- sync sketches / profiles / highlights ----
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !evaluation || !document_) return;

    // A sketch stays visible after a feature uses it, so its other regions can
    // still be extruded or cut. Used regions shade faintly but stay pickable
    // (the body over them may be hidden); free ones shade normally.
    const usage = sketchUsage(document_);
    const hiddenSketches = new Set(
      document_.features
        .filter((f) => f.type === "sketch" && f.visible === false)
        .map((f) => f.id),
    );

    const activeSketchId = mode.name === "sketch" ? mode.sketchId : null;
    const needProfiles =
      mode.name === "dialog" && DIALOG_PICKS[mode.dialog]?.profiles;
    // Fusion-style select-then-command: in idle, unused sketch regions shade
    // and are selectable before any tool is chosen.
    const idleProfiles = mode.name === "idle";

    const inputs: SketchRenderInput[] = [];
    for (const sk of evaluation.sketches) {
      const isActive = sk.featureId === activeSketchId;
      if (isActive && draftSketch) {
        inputs.push({
          sketchId: sk.featureId,
          frame: sk.frame,
          entities: draftSketch.entities,
          showProfiles: true,
          active: true,
        });
        continue;
      }
      if (hiddenSketches.has(sk.featureId)) continue;
      const usedHere = new Set(
        sk.profiles
          .filter((p) => isProfileUsed(usage, sk.featureId, p.id))
          .map((p) => p.id),
      );
      const used = usedHere.size > 0;
      inputs.push({
        sketchId: sk.featureId,
        frame: sk.frame,
        entities: sk.entities,
        showProfiles: !!needProfiles || idleProfiles,
        profiles: sk.profiles,
        usedProfileIds: usedHere,
        active: false,
        // used sketches draw dimmer; hide the sketch (eye) to get at body
        // edges underneath its curves
        dim: used,
      });
    }
    renderSketches(vp, inputs, selection, hover);

    // dimension labels for the active sketch
    const labels: DimLabel[] = [];
    if (activeSketchId && draftSketch) {
      const sk = evaluation.sketches.find(
        (s) => s.featureId === activeSketchId,
      );
      if (sk) {
        const pts = new Map<string, { x: number; y: number }>();
        for (const e of draftSketch.entities) {
          if (e.kind === "point") pts.set(e.id, e);
        }
        const lines = new Map<string, { p1: string; p2: string }>();
        const circles = new Map<string, { center: string; radius: number }>();
        for (const e of draftSketch.entities) {
          if (e.kind === "line") lines.set(e.id, e);
          if (e.kind === "circle") circles.set(e.id, e);
        }
        for (const c of draftSketch.constraints) {
          const layout = dimensionLayout(c, pts, lines, circles);
          if (layout) {
            const anchor = layout.label;
            const off = c.labelOffset;
            labels.push({
              id: c.id,
              text: dimensionText(c),
              world: uv3(
                sk.frame,
                anchor.x + (off?.[0] ?? 0),
                anchor.y + (off?.[1] ?? 0),
              ),
              anchorWorld: uv3(
                sk.frame,
                layout.attachment.x,
                layout.attachment.y,
              ),
              ...(layout.reference && {
                reference: [
                  uv3(sk.frame, layout.reference[0].x, layout.reference[0].y),
                  uv3(sk.frame, layout.reference[1].x, layout.reference[1].y),
                ],
              }),
            });
          }
        }
      }
    }
    dimLabelsRef.current = labels;
    updateDimLeaders();
    // force label layer re-render
    setLabelTick((t) => t + 1);

    // highlights for solid topology
    vp.clearHighlights();
    for (const s of selection) vp.addHighlight(s, "select");
    if (hover) vp.addHighlight(hover, "hover");
  }, [evaluation, document_, mode, selection, hover, draftSketch]);

  const [, setLabelTick] = useState(0);
  useEffect(() => {
    viewportRef.current?.requestRender();
  });

  // ---- extrude drag gizmo ----

  function computeGizmoSource(): GizmoSource | null {
    const s = useStore.getState();
    if (s.mode.name !== "dialog" || s.mode.dialog !== "extrude") return null;
    const profSel = s.selection.find((x) => x.kind === "profile") as any;
    if (profSel) {
      const sk = s.evaluation?.sketches.find(
        (x) => x.featureId === profSel.sketchId,
      );
      const p = sk?.profiles.find((x) => x.id === profSel.profileId);
      if (sk && p && p.polygon.length >= 6) {
        let cx = 0,
          cy = 0;
        const n = p.polygon.length / 2;
        for (let i = 0; i + 1 < p.polygon.length; i += 2) {
          cx += p.polygon[i]!;
          cy += p.polygon[i + 1]!;
        }
        return { frame: sk.frame, anchorUV: [cx / n, cy / n], profile: p };
      }
    }
    const faceSel = s.selection.find((x) => x.kind === "face") as any;
    if (faceSel) {
      const body = s.evaluation?.bodies.find(
        (b) => b.bodyId === faceSel.bodyId,
      );
      const face = body?.faces.find((f) => f.name === faceSel.faceName);
      if (body && face && face.surface.type === "plane") {
        let cx = 0,
          cy = 0,
          cz = 0,
          count = 0;
        const vertexAt = (i: number) => {
          const vi = body.indices[i];
          if (vi === undefined) return null;
          const x = body.positions[vi * 3];
          const y = body.positions[vi * 3 + 1];
          const z = body.positions[vi * 3 + 2];
          if (x === undefined || y === undefined || z === undefined)
            return null;
          return { vi, x, y, z };
        };
        const seen = new Set<number>();
        for (let i = face.start; i < face.start + face.count; i++) {
          const v = vertexAt(i);
          if (!v) return null;
          if (seen.has(v.vi)) continue;
          seen.add(v.vi);
          cx += v.x;
          cy += v.y;
          cz += v.z;
          count++;
        }
        if (count === 0) return null;
        const centroid: [number, number, number] = [
          cx / count,
          cy / count,
          cz / count,
        ];
        const normal = face.surface.normal;
        const seed: [number, number, number] =
          Math.abs(normal[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
        const nx = new THREE.Vector3(...normal).normalize();
        let xAxis = new THREE.Vector3(...seed)
          .sub(nx.clone().multiplyScalar(nx.dot(new THREE.Vector3(...seed))))
          .normalize();
        const yAxis = nx.clone().cross(xAxis).normalize();
        // ghost data: the face's triangles + its boundary edge polylines
        const remap = new Map<number, number>();
        const ghostPositions: number[] = [];
        const ghostIndices: number[] = [];
        for (let i = face.start; i < face.start + face.count; i++) {
          const v = vertexAt(i);
          if (!v) return null;
          let ni = remap.get(v.vi);
          if (ni === undefined) {
            ni = ghostPositions.length / 3;
            remap.set(v.vi, ni);
            ghostPositions.push(v.x, v.y, v.z);
          }
          ghostIndices.push(ni);
        }
        const boundary = body.edges
          .filter((ed) => ed.name.includes(faceSel.faceName))
          .map((ed) => ed.polyline);
        return {
          frame: {
            origin: centroid,
            xAxis: [xAxis.x, xAxis.y, xAxis.z],
            yAxis: [yAxis.x, yAxis.y, yAxis.z],
            normal: [nx.x, nx.y, nx.z],
          },
          anchorUV: [0, 0],
          faceGhost: {
            positions: ghostPositions,
            indices: ghostIndices,
            boundary,
          },
        };
      }
    }
    return null;
  }

  // build / rebuild the gizmo when the extrude dialog selection changes
  useEffect(() => {
    extrudeSlot.rebuild(buildExtrudeGizmo);
  }, [mode, selection, evaluation]);

  function buildExtrudeGizmo(): ExtrudeGizmo | null {
    setGizmoLabel(null);
    const vp = viewportRef.current;
    if (!vp) return null;
    const src = computeGizmoSource();
    if (!src) return null;
    const s = useStore.getState();
    // when editing, the real geometry live-updates — skip the ghost preview
    if (previewedFeature(s)) {
      src.profile = undefined;
      src.faceGhost = undefined;
    }
    const distRaw = Number(s.dialogParams.distance);
    // 0 is a valid (Ctrl-zeroed) state — only fall back to 10 when unset.
    // The distance is signed (typed negative = other side), as is "Reversed".
    const dist = Number.isFinite(distRaw) ? distRaw : 10;
    const sign = s.dialogParams.direction === "reverse" ? -1 : 1;
    const startRaw = Number(s.dialogParams.startOffset);
    return new ExtrudeGizmo(
      vp,
      src,
      sign * dist,
      (s.dialogParams.operation ?? "join") === "cut",
      Number.isFinite(startRaw) ? startRaw : 0,
    );
  }

  // typing in the dialog moves the arrow too; Cut tints the preview red
  useEffect(() => {
    const g = extrudeSlot.current;
    if (!g || extrudeSlot.isDragging) return;
    g.setCut((dialogParams.operation ?? "join") === "cut");
    const startRaw = Number(dialogParams.startOffset);
    g.setStartOffset(Number.isFinite(startRaw) ? startRaw : 0);
    const dist = Number(dialogParams.distance);
    if (!Number.isFinite(dist)) return;
    const sign = dialogParams.direction === "reverse" ? -1 : 1;
    g.update(sign * dist);
  }, [dialogParams]);

  // build / rebuild the MOVE gizmo (three axis arrows) for the move dialog
  useEffect(() => {
    moveSlot.rebuild(buildMoveGizmo);
  }, [mode, selection, evaluation]);

  function buildMoveGizmo(): MoveGizmo | null {
    const vp = viewportRef.current;
    if (!vp) return null;
    const s = useStore.getState();
    if (s.mode.name !== "dialog" || s.mode.dialog !== "move") return null;
    const bodyIds = s.selection
      .filter((x) => x.kind === "body")
      .map((x: any) => x.bodyId);
    if (bodyIds.length === 0) return null;
    const bodies = (s.evaluation?.bodies ?? []).filter((b) =>
      bodyIds.includes(b.bodyId),
    );
    if (bodies.length === 0) return null;
    const t: [number, number, number] = [
      Number(s.dialogParams.tx) || 0,
      Number(s.dialogParams.ty) || 0,
      Number(s.dialogParams.tz) || 0,
    ];
    // bodies already sit at +t when editing (feature applied) — the gizmo
    // base is the pre-move position
    const shown = previewedFeature(s);
    const center = new THREE.Vector3();
    for (const b of bodies) {
      center.add(
        new THREE.Vector3(
          (b.bbox.min[0] + b.bbox.max[0]) / 2,
          (b.bbox.min[1] + b.bbox.max[1]) / 2,
          (b.bbox.min[2] + b.bbox.max[2]) / 2,
        ),
      );
    }
    center.divideScalar(bodies.length);
    if (shown?.type === "move")
      center.sub(new THREE.Vector3(...shown.translation));
    // ghost meshes only for NEW moves; edits live-update the real geometry
    const ghosts = shown
      ? []
      : bodies.map((b) => ({ positions: b.positions, indices: b.indices }));
    return new MoveGizmo(vp, center, t, ghosts);
  }

  // typing in the move dialog updates the arrows/ghost too
  useEffect(() => {
    const g = moveSlot.current;
    if (!g || moveSlot.isDragging) return;
    g.update([
      Number(dialogParams.tx) || 0,
      Number(dialogParams.ty) || 0,
      Number(dialogParams.tz) || 0,
    ]);
  }, [dialogParams]);

  /** Resolve the revolve axis (origin + direction) exactly as the feature
   * will, from the current dialog params + selection. */
  function resolveRevolveAxis(): {
    origin: THREE.Vector3;
    dir: THREE.Vector3;
  } | null {
    const s = useStore.getState();
    let axisOrigin: THREE.Vector3 | null = null;
    let axisDir: THREE.Vector3 | null = null;
    if ((s.dialogParams.axisSource ?? "origin") === "edge") {
      const lineSel = s.selection.find((x) => x.kind === "sketchEntity") as any;
      const edgeSel = s.selection.find((x) => x.kind === "edge") as any;
      if (lineSel) {
        const axSk = s.evaluation?.sketches.find(
          (x) => x.featureId === lineSel.sketchId,
        );
        const line = axSk?.entities.find(
          (e: any) => e.id === lineSel.entityId && e.kind === "line",
        ) as any;
        const p1 = axSk?.entities.find((e: any) => e.id === line?.p1) as any;
        const p2 = axSk?.entities.find((e: any) => e.id === line?.p2) as any;
        if (axSk && p1 && p2) {
          const f = axSk.frame;
          const to3 = (u: number, v: number) =>
            new THREE.Vector3(
              f.origin[0] + u * f.xAxis[0] + v * f.yAxis[0],
              f.origin[1] + u * f.xAxis[1] + v * f.yAxis[1],
              f.origin[2] + u * f.xAxis[2] + v * f.yAxis[2],
            );
          axisOrigin = to3(p1.x, p1.y);
          axisDir = to3(p2.x, p2.y).sub(axisOrigin);
        }
      } else if (edgeSel) {
        const body = s.evaluation?.bodies.find(
          (b) => b.bodyId === edgeSel.bodyId,
        );
        const ed = body?.edges.find((x) => x.name === edgeSel.edgeName);
        if (ed && ed.polyline.length >= 6) {
          const pl = ed.polyline;
          axisOrigin = new THREE.Vector3(pl[0], pl[1], pl[2]);
          axisDir = new THREE.Vector3(
            pl[pl.length - 3]! - pl[0]!,
            pl[pl.length - 2]! - pl[1]!,
            pl[pl.length - 1]! - pl[2]!,
          );
        }
      }
    } else {
      const dirs: Record<string, [number, number, number]> = {
        X: [1, 0, 0],
        Y: [0, 1, 0],
        Z: [0, 0, 1],
      };
      const d = dirs[s.dialogParams.axis ?? "Z"] ?? dirs.Z!;
      axisOrigin = new THREE.Vector3(0, 0, 0);
      axisDir = new THREE.Vector3(...d);
    }
    if (!axisOrigin || !axisDir || axisDir.lengthSq() < 1e-12) return null;
    return { origin: axisOrigin, dir: axisDir };
  }

  /** First selected profile + its sketch (for the revolve ghost/gizmo). */
  function selectedRevolveProfile() {
    const s = useStore.getState();
    const profSel = s.selection.find((x) => x.kind === "profile") as any;
    if (!profSel) return null;
    const sk = s.evaluation?.sketches.find(
      (x) => x.featureId === profSel.sketchId,
    );
    const profile = sk?.profiles.find((p) => p.id === profSel.profileId);
    if (!sk || !profile) return null;
    return { sk, profile };
  }

  // translucent ghost of a NEW revolve (profile swept around the chosen axis)
  const revolveGhostRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const vp = viewportRef.current;
    if (revolveGhostRef.current && vp) {
      vp.scene.remove(revolveGhostRef.current);
      disposeGroup(revolveGhostRef.current);
      revolveGhostRef.current = null;
      vp.requestRender();
    }
    if (!vp) return;
    const s = useStore.getState();
    if (
      s.mode.name !== "dialog" ||
      s.mode.dialog !== "revolve" ||
      previewedFeature(s) // the previewed body is already real
    ) {
      return;
    }
    const sel = selectedRevolveProfile();
    const axis = resolveRevolveAxis();
    if (!sel || !axis) return;
    const { sk, profile } = sel;

    const angle = Number(s.dialogParams.angle);
    const ghost = buildRevolveGhost(
      sk.frame,
      profile.polygon,
      profile.holePolygons,
      axis.origin,
      axis.dir,
      Number.isFinite(angle) ? angle : 360,
    );
    vp.scene.add(ghost);
    vp.requestRender();
    revolveGhostRef.current = ghost;
    return () => {
      if (revolveGhostRef.current && viewportRef.current) {
        viewportRef.current.scene.remove(revolveGhostRef.current);
        disposeGroup(revolveGhostRef.current);
        revolveGhostRef.current = null;
        viewportRef.current.requestRender();
      }
    };
  }, [mode, selection, evaluation, dialogParams]);

  // rotational drag handle for the revolve angle (ring around the axis)
  useEffect(() => {
    revolveSlot.rebuild(buildRevolveGizmo);
    // axisSource/axis in deps: the axis dropdown may switch AFTER mount
    // (auto-switch on edge pick) — the ring must follow. Angle deliberately
    // excluded so drags don't rebuild the ring under the pointer.
  }, [mode, selection, evaluation, dialogParams.axisSource, dialogParams.axis]);

  function buildRevolveGizmo(): RevolveGizmo | null {
    const vp = viewportRef.current;
    if (!vp) return null;
    const s = useStore.getState();
    if (s.mode.name !== "dialog" || s.mode.dialog !== "revolve") return null;
    const sel = selectedRevolveProfile();
    const axis = resolveRevolveAxis();
    if (!sel || !axis) return null;
    const { sk, profile } = sel;

    // ring through the profile centroid, perpendicular to the axis
    const f = sk.frame;
    let cu = 0,
      cv = 0;
    const n = profile.polygon.length / 2;
    for (let i = 0; i * 2 + 1 < profile.polygon.length; i++) {
      cu += profile.polygon[i * 2]!;
      cv += profile.polygon[i * 2 + 1]!;
    }
    cu /= n || 1;
    cv /= n || 1;
    const centroid = new THREE.Vector3(
      f.origin[0] + cu * f.xAxis[0] + cv * f.yAxis[0],
      f.origin[1] + cu * f.xAxis[1] + cv * f.yAxis[1],
      f.origin[2] + cu * f.xAxis[2] + cv * f.yAxis[2],
    );
    const d = axis.dir.clone().normalize();
    const along = centroid.clone().sub(axis.origin).dot(d);
    const center = axis.origin.clone().add(d.clone().multiplyScalar(along));
    let zeroDir = centroid.clone().sub(center);
    let radius = zeroDir.length();
    const wpp = vp.worldPerPixel();
    if (radius < wpp * 10) {
      // profile centered on the axis — pick any perpendicular
      zeroDir =
        Math.abs(d.z) < 0.9
          ? new THREE.Vector3(0, 0, 1).cross(d)
          : new THREE.Vector3(1, 0, 0).cross(d);
      radius = wpp * 50;
    }
    const angle = Number(s.dialogParams.angle);
    return new RevolveGizmo(
      vp,
      center,
      d,
      zeroDir,
      radius,
      Number.isFinite(angle) ? angle : 360,
    );
  }

  // typing an angle moves the handle too
  useEffect(() => {
    const g = revolveSlot.current;
    if (!g || revolveSlot.isDragging) return;
    const a = Number(dialogParams.angle);
    if (Number.isFinite(a)) g.update(a);
  }, [dialogParams]);

  // switching sketch tools resets pending clicks + previews
  const sketchTool = mode.name === "sketch" ? mode.tool : null;
  useEffect(() => {
    toolState.current.clicks = [];
    toolState.current.downUV = null;
    toolState.current.dimTargets = [];
    clearToolPreview(viewportRef.current);
    setToolLabel(null);
    setSnapMarker(null);
  }, [sketchTool, mode.name]);

  // ---- camera + pointer input ----
  useEffect(() => {
    const vp = viewportRef.current;
    const container = containerRef.current;
    if (!vp || !container) return;
    const el = vp.renderer.domElement;

    let button = -1;
    let lastX = 0,
      lastY = 0;
    let orbiting = false;
    let pivot: THREE.Vector3 | undefined;
    let panning = false;
    let dragMoved = false;

    const startOrbit = (e: PointerEvent) => {
      orbiting = true;
      pivot = vp.pick(e.clientX, e.clientY, { bodies: true })?.point;
    };

    const onPointerDown = (e: PointerEvent) => {
      button = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      dragMoved = false;
      el.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        if (e.shiftKey) startOrbit(e);
        else panning = true;
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        startOrbit(e);
        return;
      }
      if (e.button === 0) {
        // gizmo drags take priority over everything else
        if (extrudeSlot.current?.hitTest(e.clientX, e.clientY)) {
          extrudeSlot.beginDrag();
          e.preventDefault();
          return;
        }
        const moveAxis = moveSlot.current?.hitTest(e.clientX, e.clientY) ?? -1;
        if (moveAxis >= 0 && moveSlot.current) {
          moveSlot.current.beginDrag(moveAxis, e.clientX, e.clientY);
          moveSlot.beginDrag();
          e.preventDefault();
          return;
        }
        if (revolveSlot.current?.hitTest(e.clientX, e.clientY)) {
          revolveSlot.current.beginDrag(e.clientX, e.clientY);
          revolveSlot.beginDrag();
          e.preventDefault();
          return;
        }
        handlePrimaryDown(e);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      if (revolveSlot.isDragging && revolveSlot.current) {
        const g = revolveSlot.current;
        const a = g.dragAngle(e.clientX, e.clientY);
        g.update(a);
        const s = useStore.getState();
        s.setDialogParams({ angle: a });
        const tip = g.handleScreenPosition();
        setGizmoLabel({ x: tip.x, y: tip.y, text: formatAngle(a, 3) });
        // editing an existing revolve: live-update the real geometry
        const modeNow = s.mode;
        if (
          modeNow.name === "dialog" &&
          modeNow.dialog === "revolve" &&
          modeNow.editFeatureId &&
          a !== 0
        ) {
          livePreview.during(modeNow.editFeatureId, { angle: a } as any);
        }
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (moveSlot.isDragging && moveSlot.current) {
        const g = moveSlot.current;
        const t = g.dragOffset(e.clientX, e.clientY);
        g.update(t);
        const s = useStore.getState();
        s.setDialogParams({ tx: t[0], ty: t[1], tz: t[2] });
        const tip = g.tipScreenPosition();
        if (tip) {
          const axisName = ["X", "Y", "Z"][g.draggingAxis] ?? "";
          const v = t[g.draggingAxis] ?? 0;
          setGizmoLabel({
            x: tip.x,
            y: tip.y,
            text: `${axisName}: ${formatLength(v, "mm", 3)}`,
          });
        }
        // editing an existing move: live-update the real geometry
        const modeNow = s.mode;
        if (
          modeNow.name === "dialog" &&
          modeNow.dialog === "move" &&
          modeNow.editFeatureId
        ) {
          livePreview.during(modeNow.editFeatureId, {
            translation: t,
          } as any);
        }
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (extrudeSlot.isDragging && extrudeSlot.current) {
        const g = extrudeSlot.current;
        // Ctrl while dragging: collapse the extrude to zero so the sketch
        // profiles reappear and can be re-picked.
        const zeroed = e.ctrlKey || e.metaKey;
        const v = zeroed ? 0 : g.dragValue(e.clientX, e.clientY);
        if (zeroed || Math.abs(v) > 1e-9) {
          g.update(v);
          const s = useStore.getState();
          const curDir = s.dialogParams.direction ?? "normal";
          const patch: Record<string, any> = { distance: Math.abs(v) };
          if (!zeroed && (curDir === "normal" || curDir === "reverse")) {
            patch.direction = v < 0 ? "reverse" : "normal";
          }
          s.setDialogParams(patch);
          const tip = g.tipScreenPosition();
          setGizmoLabel({
            x: tip.x,
            y: tip.y,
            text: formatLength(zeroed ? 0 : Math.abs(v), "mm", 3),
          });
          // editing an existing extrude: live-update the real geometry.
          // At zero the feature is previewed as suppressed (a real zero
          // extrude is invalid) so the body vanishes and profiles show.
          const modeNow = s.mode;
          if (
            modeNow.name === "dialog" &&
            modeNow.dialog === "extrude" &&
            modeNow.editFeatureId
          ) {
            livePreview.during(
              modeNow.editFeatureId,
              (zeroed
                ? { suppressed: true }
                : {
                    suppressed: false,
                    distance: Math.abs(v),
                    direction:
                      patch.direction ?? s.dialogParams.direction ?? "normal",
                  }) as any,
            );
          }
        }
      } else if (orbiting) {
        vp.orbitTrackball(dx, dy, pivot);
      } else if (panning) {
        vp.pan(dx, dy);
      } else if (button === 0) {
        handlePrimaryDrag(e);
      } else {
        handleHover(e);
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      if (revolveSlot.isDragging && revolveSlot.current) {
        revolveSlot.endDrag();
        setGizmoLabel(null);
        button = -1;
        const s = useStore.getState();
        const a = Number(s.dialogParams.angle);
        if (
          s.mode.name === "dialog" &&
          s.mode.dialog === "revolve" &&
          s.mode.editFeatureId &&
          Number.isFinite(a) &&
          a !== 0
        ) {
          livePreview.commit(s.mode.editFeatureId, { angle: a } as any);
        }
        return;
      }
      if (moveSlot.isDragging && moveSlot.current) {
        moveSlot.endDrag();
        setGizmoLabel(null);
        button = -1;
        const s = useStore.getState();
        if (
          s.mode.name === "dialog" &&
          s.mode.dialog === "move" &&
          s.mode.editFeatureId
        ) {
          livePreview.commit(s.mode.editFeatureId, {
            translation: [
              Number(s.dialogParams.tx) || 0,
              Number(s.dialogParams.ty) || 0,
              Number(s.dialogParams.tz) || 0,
            ],
          } as any);
        }
        return;
      }
      if (extrudeSlot.isDragging) {
        extrudeSlot.endDrag();
        setGizmoLabel(null);
        button = -1;
        // editing: make sure the final dragged value is applied
        const s = useStore.getState();
        if (
          s.mode.name === "dialog" &&
          s.mode.dialog === "extrude" &&
          s.mode.editFeatureId
        ) {
          const dist = Number(s.dialogParams.distance);
          if (Number.isFinite(dist) && dist !== 0) {
            livePreview.commit(s.mode.editFeatureId, {
              suppressed: false,
              distance: dist,
              direction: s.dialogParams.direction ?? "normal",
            } as any);
          } else if (dist === 0) {
            // Ctrl-zeroed: leave the feature suppressed so profiles stay
            // pickable; dragging the arrow (or OK) brings it back.
            livePreview.commit(s.mode.editFeatureId, {
              suppressed: true,
            } as any);
          }
        }
        return;
      }
      const wasOrbit = orbiting,
        wasPan = panning;
      orbiting = panning = false;
      const b = button;
      button = -1;
      if (wasOrbit || wasPan) {
        // right-click without dragging → context menu on picked topology
        if (b === 2 && !dragMoved) handleContextClick(e);
        return;
      }
      if (b === 0) handlePrimaryUp(e, dragMoved);
    };

    const onContext = (e: Event) => e.preventDefault();

    const onDblClick = (e: MouseEvent) => {
      handleDoubleClick(e);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    const unlistenWheel = listenWheel(el, vp);
    el.addEventListener("contextmenu", onContext);
    el.addEventListener("dblclick", onDblClick);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      unlistenWheel();
      el.removeEventListener("contextmenu", onContext);
      el.removeEventListener("dblclick", onDblClick);
    };
    // handlers read latest state via zustand getState
  }, []);

  // ------ mode-aware handlers (read state fresh from the store) ------

  function activeSketchFrame(): PlaneFrame | null {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return null;
    const sk = s.evaluation?.sketches.find(
      (x) => x.featureId === (s.mode as any).sketchId,
    );
    return sk?.frame ?? null;
  }

  /**
   * Snap targets projected from the body face the active sketch sits on
   * (corner vertices, edge midpoints, and the edges themselves), so sketch
   * geometry can snap to the face outline Fusion-style.
   */
  const faceSnapCache = useRef<{
    key: string;
    eval: unknown;
    data: {
      corners: { x: number; y: number }[];
      mids: { x: number; y: number }[];
      segs: number[][];
    } | null;
  } | null>(null);

  function faceSnapGeometry() {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return null;
    const sketchId = (s.mode as any).sketchId as string;
    const cached = faceSnapCache.current;
    if (cached && cached.key === sketchId && cached.eval === s.evaluation) {
      return cached.data;
    }
    const compute = () => {
      const frame = activeSketchFrame();
      if (!frame) return null;
      const feat = s.document?.features.find((f) => f.id === sketchId) as any;
      if (feat?.plane?.kind !== "face") return null;
      const body = s.evaluation?.bodies.find(
        (b) => b.bodyId === feat.plane.face.bodyId,
      );
      if (!body) return null;
      const faceName: string = feat.plane.face.faceName;
      const o = frame.origin,
        xa = frame.xAxis,
        ya = frame.yAxis;
      const corners: { x: number; y: number }[] = [];
      const mids: { x: number; y: number }[] = [];
      const segs: number[][] = [];
      const addCorner = (x: number, y: number) => {
        if (!corners.some((c) => Math.hypot(c.x - x, c.y - y) < 1e-6)) {
          corners.push({ x, y });
        }
      };
      for (const ed of body.edges) {
        if (!ed.name.includes(faceName)) continue;
        const pl = ed.polyline;
        if (pl.length < 6) continue;
        const uv: number[] = [];
        for (let i = 0; i + 2 < pl.length; i += 3) {
          const dx = pl[i]! - o[0],
            dy = pl[i + 1]! - o[1],
            dz = pl[i + 2]! - o[2];
          uv.push(
            dx * xa[0] + dy * xa[1] + dz * xa[2],
            dx * ya[0] + dy * ya[1] + dz * ya[2],
          );
        }
        segs.push(uv);
        addCorner(uv[0]!, uv[1]!);
        addCorner(uv[uv.length - 2]!, uv[uv.length - 1]!);
        // midpoint by arc length
        let total = 0;
        for (let i = 0; i + 3 < uv.length; i += 2) {
          total += Math.hypot(uv[i + 2]! - uv[i]!, uv[i + 3]! - uv[i + 1]!);
        }
        let acc = 0;
        for (let i = 0; i + 3 < uv.length; i += 2) {
          const d = Math.hypot(uv[i + 2]! - uv[i]!, uv[i + 3]! - uv[i + 1]!);
          if (acc + d >= total / 2 && d > 0) {
            const t = (total / 2 - acc) / d;
            mids.push({
              x: uv[i]! + t * (uv[i + 2]! - uv[i]!),
              y: uv[i + 1]! + t * (uv[i + 3]! - uv[i + 1]!),
            });
            break;
          }
          acc += d;
        }
      }
      return segs.length > 0 ? { corners, mids, segs } : null;
    };
    const data = compute();
    faceSnapCache.current = { key: sketchId, eval: s.evaluation, data };
    return data;
  }

  function pointerToSketchUV(
    e: { clientX: number; clientY: number },
    alignFrom?: { x: number; y: number; pointId?: string | undefined },
  ): tools.UV | null {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    if (!vp || !frame) return null;
    const hit = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
    if (!hit) return null;
    const d = hit.clone().sub(new THREE.Vector3(...frame.origin));
    let u = d.dot(new THREE.Vector3(...frame.xAxis));
    let v = d.dot(new THREE.Vector3(...frame.yAxis));
    const s = useStore.getState();
    const tol = vp.worldPerPixel() * 10;
    const entities = s.draftSketch?.entities ?? [];
    const pts = new Map<string, { x: number; y: number }>();
    for (const ent of entities) {
      if (ent.kind === "point") pts.set(ent.id, ent);
    }

    const faceSnap = faceSnapGeometry();

    // 1) snap to existing points (strongest); face corners join this tier
    let snapPointId: string | undefined;
    let best = tol;
    for (const ent of entities) {
      if (ent.kind !== "point") continue;
      const dd = Math.hypot(ent.x - u, ent.y - v);
      if (dd < best) {
        best = dd;
        snapPointId = ent.id;
      }
    }
    if (snapPointId) {
      const p = pts.get(snapPointId)!;
      return { x: p.x, y: p.y, snapPointId, snapKind: "point" };
    }
    if (faceSnap) {
      let corner: { x: number; y: number } | null = null;
      for (const c of faceSnap.corners) {
        const dd = Math.hypot(c.x - u, c.y - v);
        if (dd < best) {
          best = dd;
          corner = c;
        }
      }
      if (corner) return { x: corner.x, y: corner.y, snapKind: "point" };
    }
    // 2) snap to sketch origin
    if (Math.hypot(u, v) < tol) return { x: 0, y: 0, snapKind: "origin" };

    // 2b) snap to line midpoints (tight radius, adds a midpoint constraint);
    // Face-edge midpoints join this tier; the builder fixes their sketch
    // position, while sketch-line midpoints get a relational constraint.
    let midBest = vp.worldPerPixel() * 6;
    let mid: { lineId?: string; x: number; y: number } | null = null;
    for (const ent of entities) {
      if (ent.kind !== "line") continue;
      const a = pts.get(ent.p1);
      const b = pts.get(ent.p2);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dd = Math.hypot(u - mx, v - my);
      if (dd < midBest) {
        midBest = dd;
        mid = { lineId: ent.id, x: mx, y: my };
      }
    }
    if (faceSnap) {
      for (const m of faceSnap.mids) {
        const dd = Math.hypot(u - m.x, v - m.y);
        if (dd < midBest) {
          midBest = dd;
          mid = { x: m.x, y: m.y };
        }
      }
    }
    if (mid) {
      return {
        x: mid.x,
        y: mid.y,
        snapMidLineId: mid.lineId,
        snapKind: "midpoint",
      };
    }

    // 3) direction locks from the previous point (line chaining): axis
    // alignment, else within a few degrees of 90° to a line ending there.
    // These only steer the cursor — curve snapping below still runs, and a
    // line hit is placed exactly where the locked direction meets that line,
    // so a shape can be closed onto another line while staying square.
    let ray: { x: number; y: number } | null = null;
    let perp: tools.UV | null = null;
    if (alignFrom) {
      if (Math.abs(u - alignFrom.x) < tol && Math.abs(v - alignFrom.y) >= tol) {
        u = alignFrom.x;
        ray = { x: 0, y: v > alignFrom.y ? 1 : -1 };
      } else if (
        Math.abs(v - alignFrom.y) < tol &&
        Math.abs(u - alignFrom.x) >= tol
      ) {
        v = alignFrom.y;
        ray = { x: u > alignFrom.x ? 1 : -1, y: 0 };
      } else {
        perp = tools.perpendicularSnap(
          { x: alignFrom.x, y: alignFrom.y, snapPointId: alignFrom.pointId },
          { x: u, y: v },
          entities,
          tol, // a line shorter than the snap radius (10 px) has no reliable direction
        );
        if (perp) {
          u = perp.x;
          v = perp.y;
          const len = Math.hypot(u - alignFrom.x, v - alignFrom.y);
          ray = { x: (u - alignFrom.x) / len, y: (v - alignFrom.y) / len };
        }
      }
    }

    // 4) snap onto existing curves (adds pointOnLine / pointOnCircle)
    let snapLineId: string | undefined;
    let snapCircleId: string | undefined;
    let curveBest = tol;
    let snapped: { x: number; y: number } | null = null;
    for (const ent of entities) {
      if (ent.kind === "line") {
        const a = pts.get(ent.p1);
        const b = pts.get(ent.p2);
        if (!a || !b) continue;
        const abx = b.x - a.x,
          aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        let t = ((u - a.x) * abx + (v - a.y) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        let px = a.x + t * abx,
          py = a.y + t * aby;
        const dd = Math.hypot(u - px, v - py);
        if (dd < curveBest) {
          if (ray && alignFrom) {
            // keep the locked direction: land where the ray crosses this line
            const hit = tools.rayLineIntersection(alignFrom, ray, a, b, tol);
            if (hit && Math.hypot(hit.x - u, hit.y - v) < tol * 2) {
              px = ray.x === 0 ? alignFrom.x : hit.x;
              py = ray.y === 0 ? alignFrom.y : hit.y;
            }
          }
          curveBest = dd;
          snapLineId = ent.id;
          snapCircleId = undefined;
          snapped = { x: px, y: py };
        }
      } else if (ent.kind === "circle") {
        const c = pts.get(ent.center);
        if (!c || ent.radius <= 0) continue;
        const dc = Math.hypot(u - c.x, v - c.y) || 1;
        const dd = Math.abs(dc - ent.radius);
        if (dd < curveBest) {
          curveBest = dd;
          snapCircleId = ent.id;
          snapLineId = undefined;
          snapped = {
            x: c.x + ((u - c.x) / dc) * ent.radius,
            y: c.y + ((v - c.y) / dc) * ent.radius,
          };
        }
      } else if (ent.kind === "arc") {
        const c = pts.get(ent.center);
        const st = pts.get(ent.start);
        if (!c || !st) continue;
        const r = Math.hypot(st.x - c.x, st.y - c.y);
        const dc = Math.hypot(u - c.x, v - c.y) || 1;
        const dd = Math.abs(dc - r);
        if (dd < curveBest) {
          curveBest = dd;
          snapCircleId = ent.id;
          snapLineId = undefined;
          snapped = {
            x: c.x + ((u - c.x) / dc) * r,
            y: c.y + ((v - c.y) / dc) * r,
          };
        }
      }
    }
    // face boundary edges join the curve tier (position only, no constraint)
    if (faceSnap) {
      for (const seg of faceSnap.segs) {
        for (let i = 0; i + 3 < seg.length; i += 2) {
          const ax = seg[i]!,
            ay = seg[i + 1]!;
          const bx = seg[i + 2]!,
            by = seg[i + 3]!;
          const abx = bx - ax,
            aby = by - ay;
          const len2 = abx * abx + aby * aby || 1;
          let t = ((u - ax) * abx + (v - ay) * aby) / len2;
          t = Math.max(0, Math.min(1, t));
          const px = ax + t * abx,
            py = ay + t * aby;
          const dd = Math.hypot(u - px, v - py);
          if (dd < curveBest) {
            curveBest = dd;
            snapLineId = undefined;
            snapCircleId = undefined;
            snapped = { x: px, y: py };
          }
        }
      }
    }
    if (snapped) {
      return {
        x: snapped.x,
        y: snapped.y,
        snapLineId,
        snapCircleId,
        // a perpendicular lock survives a LINE hit (the point is at the exact
        // crossing); on a circle/arc only the on-curve position is kept
        snapPerpLineId: snapLineId ? perp?.snapPerpLineId : undefined,
        snapKind: "curve",
      };
    }
    if (perp) return perp;
    return { x: u, y: v };
  }

  function handleHover(e: PointerEvent) {
    const vp = viewportRef.current;
    if (!vp) return;
    if (extrudeSlot.current) {
      extrudeSlot.current.setHover(
        extrudeSlot.current.hitTest(e.clientX, e.clientY),
      );
    }
    if (moveSlot.current && !moveSlot.isDragging) {
      moveSlot.current.setHover(moveSlot.current.hitTest(e.clientX, e.clientY));
    }
    if (revolveSlot.current && !revolveSlot.isDragging) {
      revolveSlot.current.setHover(
        revolveSlot.current.hitTest(e.clientX, e.clientY),
      );
    }
    const s = useStore.getState();
    let picked: Selection | null = null;
    if (s.mode.name === "pickPlane") {
      const r = vp.pick(e.clientX, e.clientY, {
        originPlanes: true,
        constructionPlanes: true,
        faces: true,
      });
      if (r && (r.selection.kind === "plane" || isPlanarFace(r.selection))) {
        picked = r.selection;
      }
    } else if (s.mode.name === "sketch") {
      const tool = (s.mode as any).tool as string;
      if (tool === "project") {
        picked =
          vp.pick(e.clientX, e.clientY, { edges: true })?.selection ?? null;
      } else if (
        ["select", "dimension", "trim", "extend", "offset"].includes(tool)
      ) {
        const r = vp.pick(e.clientX, e.clientY, {
          sketchEntities: true,
          profiles: false,
        });
        picked = r?.selection ?? null;
      } else if (DRAW_TOOLS.includes(tool) || tool === "point") {
        // rubber-band preview + snap glyph while drawing
        const ts = toolState.current;
        const last =
          ts.clicks.length > 0 ? ts.clicks[ts.clicks.length - 1] : undefined;
        const uv = angleSnapped(
          e,
          tool,
          last,
          pointerToSketchUV(
            e,
            tool === "line" && last
              ? { x: last.x, y: last.y, pointId: last.snapPointId }
              : undefined,
          ),
        );
        updateSnapMarker(uv);
        const frame = activeSketchFrame();
        if (uv) ts.lastCursor = uv;
        if (uv && frame && ts.clicks.length > 0) {
          // the ghost honours typed (locked) sizes, exactly as the placed shape will
          const ghostCursor =
            dimRef.current && ts.clicks.length === 1
              ? resolveDimCursor(tool, ts.clicks[0]!, uv, dimRef.current.fields)
              : uv;
          updateToolPreview(
            vp,
            frame,
            tool as any,
            ts.clicks,
            ghostCursor,
            Number(s.dialogParams.polygonSides ?? 6) || 6,
          );
          showToolLabel(e, tool, ts.clicks, uv);
        } else {
          clearToolPreview(vp);
          setToolLabel(null);
          clearDimEntry();
        }
        // highlight snap target
        const sketchId = (s.mode as any).sketchId as string;
        if (uv?.snapPointId) {
          picked = { kind: "sketchPoint", sketchId, entityId: uv.snapPointId };
        } else if (
          uv?.snapLineId ||
          uv?.snapCircleId ||
          uv?.snapMidLineId ||
          uv?.snapPerpLineId
        ) {
          picked = {
            kind: "sketchEntity",
            sketchId,
            entityId: (uv.snapLineId ??
              uv.snapCircleId ??
              uv.snapMidLineId ??
              uv.snapPerpLineId)!,
          };
        }
      } else {
        setSnapMarker(null);
      }
    } else if (s.mode.name === "dialog") {
      const picks = DIALOG_PICKS[s.mode.dialog] ?? {};
      const r = vp.pick(e.clientX, e.clientY, {
        profiles: picks.profiles,
        edges: picks.edges,
        faces: picks.faces || picks.bodies,
        bodies: picks.bodies && !picks.faces,
        originPlanes: picks.planes,
        constructionPlanes: picks.planes,
        sketchEntities: picks.sketchLines,
      });
      picked = filterDialogPick(r?.selection ?? null, s.mode.dialog);
    } else if (s.mode.name === "measure") {
      const r = vp.pick(e.clientX, e.clientY, {
        faces: true,
        edges: true,
        vertices: true,
      });
      picked = r?.selection ?? null;
    } else {
      // idle: hover also previews sketch regions/curves (selectable now)
      const r = vp.pick(e.clientX, e.clientY, {
        faces: true,
        edges: true,
        vertices: true,
        profiles: true,
        sketchEntities: true,
      });
      picked = r?.selection ?? null;
    }
    const prevKey = s.hover ? JSON.stringify(s.hover) : null;
    const newKey = picked ? JSON.stringify(picked) : null;
    if (prevKey !== newKey) s.setHover(picked);
  }

  function isPlanarFace(sel: Selection): boolean {
    if (sel.kind !== "face") return false;
    const s = useStore.getState();
    const body = s.evaluation?.bodies.find((b) => b.bodyId === sel.bodyId);
    const face = body?.faces.find((f) => f.name === sel.faceName);
    return face?.surface.type === "plane";
  }

  function filterDialogPick(
    sel: Selection | null,
    dialog: keyof typeof DIALOG_PICKS,
  ): Selection | null {
    if (!sel) return null;
    const picks = DIALOG_PICKS[dialog] ?? {};
    if (sel.kind === "face" && picks.faces) return sel;
    if (sel.kind === "face" && picks.bodies) {
      return { kind: "body", bodyId: sel.bodyId };
    }
    if (sel.kind === "edge" && picks.edges) return sel;
    if (sel.kind === "body" && picks.bodies) return sel;
    if (sel.kind === "plane" && picks.planes) return sel;
    if (sel.kind === "profile" && picks.profiles) return sel;
    if (sel.kind === "sketchEntity" && picks.sketchLines) {
      // only LINES can serve as an axis
      const doc = useStore.getState().document;
      const sk = doc?.features.find(
        (f) => f.id === (sel as any).sketchId && f.type === "sketch",
      ) as any;
      const ent = sk?.entities.find((x: any) => x.id === (sel as any).entityId);
      return ent?.kind === "line" ? sel : null;
    }
    return null;
  }

  function handlePrimaryDown(e: PointerEvent) {
    const s = useStore.getState();
    if (s.mode.name === "sketch") {
      const t = (s.mode as any).tool as string;
      if (t === "select") {
        // start dragging a point?
        const vp = viewportRef.current!;
        const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
        if (r?.selection.kind === "sketchPoint") {
          toolState.current.dragPointId = (r.selection as any).entityId;
        }
      } else if (
        DRAW_TOOLS.includes(t) &&
        toolState.current.clicks.length === 0
      ) {
        // press-drag-release drawing
        toolState.current.downUV = pointerToSketchUV(e);
      }
    }
  }

  function handlePrimaryDrag(e: PointerEvent) {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return;
    if (toolState.current.dragPointId) {
      const uv = pointerToSketchUV(e);
      if (uv) {
        s.solveDraft({
          pointId: toolState.current.dragPointId,
          x: uv.x,
          y: uv.y,
        });
      }
      return;
    }
    const down = toolState.current.downUV;
    const tool = (s.mode as any).tool as string;
    if (down && DRAW_TOOLS.includes(tool)) {
      const vp = viewportRef.current;
      const frame = activeSketchFrame();
      const uv = angleSnapped(
        e,
        tool,
        down,
        pointerToSketchUV(
          e,
          tool === "line"
            ? { x: down.x, y: down.y, pointId: down.snapPointId }
            : undefined,
        ),
      );
      if (vp && frame && uv) {
        updateToolPreview(
          vp,
          frame,
          tool as any,
          [down],
          uv,
          Number(s.dialogParams.polygonSides ?? 6) || 6,
        );
        showToolLabel(e, tool, [down], uv);
        updateSnapMarker(uv);
      }
    }
  }

  /** Screen position (fixed coords) of a sketch (u,v) point. */
  function sketchUVToScreen(
    u: number,
    v: number,
  ): { x: number; y: number } | null {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    if (!vp || !frame) return null;
    return worldToClient(vp.canvasRect(), vp.camera, uv3(frame, u, v));
  }

  /** Show/hide the snap glyph for the current pointer result. */
  function updateSnapMarker(uv: tools.UV | null) {
    if (uv?.snapKind) {
      const pos = sketchUVToScreen(uv.x, uv.y);
      if (pos) {
        setSnapMarker({ x: pos.x, y: pos.y, kind: uv.snapKind });
        return;
      }
    }
    setSnapMarker(null);
  }

  /** Text for the live size readout while pulling a shape out. */
  function toolSizeText(
    tool: string,
    clicks: tools.UV[],
    cursor: tools.UV,
  ): string | null {
    const r1 = (v: number) => Math.round(v * 100) / 100;
    const first = clicks[0];
    if (!first) return null;
    const last = clicks[clicks.length - 1]!;
    const dx = cursor.x - last.x;
    const dy = cursor.y - last.y;
    switch (tool) {
      case "line":
        return `${r1(Math.hypot(dx, dy))} mm`;
      case "rect":
        return `${r1(Math.abs(cursor.x - first.x))} × ${r1(Math.abs(cursor.y - first.y))} mm`;
      case "centerRect":
        return `${r1(Math.abs(cursor.x - first.x) * 2)} × ${r1(Math.abs(cursor.y - first.y) * 2)} mm`;
      case "circle":
        return `⌀${r1(Math.hypot(cursor.x - first.x, cursor.y - first.y) * 2)} mm`;
      case "polygon":
        return `R${r1(Math.hypot(cursor.x - first.x, cursor.y - first.y))} mm`;
      case "arc3":
        return clicks.length === 1 ? `${r1(Math.hypot(dx, dy))} mm` : null;
      case "slot":
        return clicks.length === 1
          ? `${r1(Math.hypot(dx, dy))} mm`
          : `R${r1(Math.hypot(dx, dy))} mm`;
      default:
        return null;
    }
  }

  function showToolLabel(
    e: { clientX: number; clientY: number },
    tool: string,
    clicks: tools.UV[],
    cursor: tools.UV,
  ) {
    // tools with typed sizes get the editable entry instead of the readout
    const fields = dimFieldsFor(tool);
    if (fields && clicks.length === 1) {
      let d = dimRef.current;
      if (!d || d.tool !== tool) {
        d = { tool, fields, active: 0, x: 0, y: 0 };
        dimRef.current = d;
      }
      d.x = e.clientX;
      d.y = e.clientY;
      const live = liveDimValues(tool, clicks[0]!, cursor);
      for (const f of d.fields) if (!f.locked) f.text = fmt2(live[f.key] ?? 0);
      refreshDim();
      setToolLabel(null);
      return;
    }
    clearDimEntry();
    const text = toolSizeText(tool, clicks, cursor);
    if (text) {
      setToolLabel({ x: e.clientX, y: e.clientY, text });
    } else {
      setToolLabel(null);
    }
  }

  // ----- typed sizes while drawing (pure helpers live in sketchTools) -----

  function refreshDim() {
    const d = dimRef.current;
    setDimEntry(
      d
        ? {
            x: d.x,
            y: d.y,
            active: d.active,
            fields: d.fields.map((f) => ({ ...f })),
          }
        : null,
    );
  }

  function clearDimEntry() {
    dimRef.current = null;
    setDimEntry(null);
  }

  /** Redraw the rubber-band ghost for the current typed sizes without
   * waiting for the mouse to move. */
  function refreshGhost() {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    const ts = toolState.current;
    const d = dimRef.current;
    if (!vp || !frame || !d || ts.clicks.length !== 1 || !ts.lastCursor) return;
    updateToolPreview(
      vp,
      frame,
      d.tool as any,
      ts.clicks,
      resolveDimCursor(d.tool, ts.clicks[0]!, ts.lastCursor, d.fields),
      Number(useStore.getState().dialogParams.polygonSides ?? 6) || 6,
    );
  }

  /** Place the two-input shape using typed sizes, with the cursor filling the rest. */
  async function placeWithDims(cursor: tools.UV) {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return;
    const tool = s.mode.tool as string;
    const ts = toolState.current;
    const d = dimRef.current;
    if (ts.clicks.length !== 1 || !d) return;
    const first = ts.clicks[0]!;
    const second = resolveDimCursor(tool, first, cursor, d.fields);
    const result = buildFromClicks(
      tool,
      [first, second],
      s.mode.constructionMode,
    );
    if (!result?.created) return;
    clearDimEntry();
    await applyCreated(
      pinTypedDims(tool, result.created, d.fields),
      result.chain,
    );
  }

  /** Build geometry once a tool has enough clicks; null = needs more clicks.
   * Construction mode applies to every tool's output, not just lines. */
  function buildFromClicks(
    tool: string,
    clicks: tools.UV[],
    construction: boolean,
  ): { created: tools.Created | null; chain: boolean } | null {
    const r = buildFromClicksRaw(tool, clicks, construction);
    if (r?.created && construction) r.created = tools.asConstruction(r.created);
    return r;
  }

  function buildFromClicksRaw(
    tool: string,
    clicks: tools.UV[],
    construction: boolean,
  ): { created: tools.Created | null; chain: boolean } | null {
    const s = useStore.getState();
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
      case "polygon": {
        if (clicks.length < 2) return null;
        const sides = Number(s.dialogParams.polygonSides ?? 6) || 6;
        return {
          created: tools.createPolygon(clicks[0]!, clicks[1]!, sides),
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
      default:
        return null;
    }
  }

  async function applyCreated(created: tools.Created, keepChaining: boolean) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) return;

    s.updateDraftSketch(
      [...draft.entities, ...created.entities],
      [...draft.constraints, ...created.constraints],
    );
    await s.commitDraftSketch();
    const ts = toolState.current;
    if (keepChaining && created.chainPointId) {
      const st = useStore.getState();
      const p = st.draftSketch?.entities.find(
        (x) => x.id === created.chainPointId,
      ) as any;
      ts.clicks = [
        { x: p?.x ?? 0, y: p?.y ?? 0, snapPointId: created.chainPointId },
      ];
    } else {
      ts.clicks = [];
    }
    clearToolPreview(viewportRef.current);
    setToolLabel(null);
    setSnapMarker(null);
    // One-shot tools: return to Select once the shape is done. Line keeps
    // chaining until the chain is ended (double-click / Esc).
    if (!keepChaining) {
      const st = useStore.getState();
      if (
        st.mode.name === "sketch" &&
        st.mode.tool !== "select" &&
        st.mode.tool !== "dimension"
      ) {
        st.setSketchTool("select");
      }
    }
  }

  async function handlePrimaryUp(e: PointerEvent, dragMoved: boolean) {
    const s = useStore.getState();
    const vp = viewportRef.current!;

    if (s.mode.name === "sketch" && toolState.current.dragPointId) {
      const wasDrag = dragMoved;
      toolState.current.dragPointId = null;
      if (wasDrag) {
        await s.commitDraftSketch();
        return;
      }
    }

    // drag-to-draw completion
    if (dragMoved && s.mode.name === "sketch") {
      const ts = toolState.current;
      const down = ts.downUV;
      ts.downUV = null;
      const tool = (s.mode as any).tool as string;
      if (down && DRAW_TOOLS.includes(tool) && ts.clicks.length === 0) {
        const upUV = angleSnapped(
          e,
          tool,
          down,
          pointerToSketchUV(
            e,
            tool === "line"
              ? { x: down.x, y: down.y, pointId: down.snapPointId }
              : undefined,
          ),
        );
        if (
          upUV &&
          Math.hypot(upUV.x - down.x, upUV.y - down.y) > vp.worldPerPixel() * 4
        ) {
          if (TWO_POINT_TOOLS.includes(tool)) {
            const result = buildFromClicks(
              tool,
              [down, upUV],
              (s.mode as any).constructionMode,
            );
            if (result?.created) {
              await applyCreated(result.created, false);
            }
          } else {
            // arc3 / slot: the drag supplies the first two inputs
            ts.clicks = [down, upUV];
          }
        } else {
          clearToolPreview(viewportRef.current);
        }
      }
      return;
    }
    toolState.current.downUV = null;
    if (dragMoved) return;

    // pick-depth cycling with Alt at the same position
    const samePos =
      Math.abs(e.clientX - toolState.current.lastPickPos.x) < 4 &&
      Math.abs(e.clientY - toolState.current.lastPickPos.y) < 4;
    toolState.current.pickDepth =
      e.altKey && samePos ? toolState.current.pickDepth + 1 : 0;
    toolState.current.lastPickPos = { x: e.clientX, y: e.clientY };

    if (s.mode.name === "pickPlane") {
      const r = vp.pick(e.clientX, e.clientY, {
        originPlanes: true,
        constructionPlanes: true,
        faces: true,
      });
      if (!r) return;
      if (r.selection.kind === "plane") {
        await s.startSketchOnPlane(r.selection.ref);
        alignCameraToActiveSketch();
      } else if (r.selection.kind === "face" && isPlanarFace(r.selection)) {
        await s.startSketchOnPlane({
          kind: "face",
          face: {
            kind: "face",
            bodyId: r.selection.bodyId,
            faceName: r.selection.faceName,
          },
        });
        alignCameraToActiveSketch();
      }
      return;
    }

    if (s.mode.name === "sketch") {
      await handleSketchClick(e);
      return;
    }

    if (s.mode.name === "dialog") {
      const picks = DIALOG_PICKS[s.mode.dialog] ?? {};
      // When a dialog takes both profiles and faces (extrude), clicks pick
      // profiles; Shift picks faces instead (Ctrl/⌘ is reserved for multi-select).
      const both = !!picks.profiles && !!(picks.faces || picks.bodies);
      const wantFace = both && e.shiftKey;
      const r = vp.pick(e.clientX, e.clientY, {
        profiles: picks.profiles && !wantFace,
        edges: picks.edges,
        faces: (picks.faces || picks.bodies) && (!both || wantFace),
        bodies: picks.bodies && !picks.faces,
        originPlanes: picks.planes,
        constructionPlanes: picks.planes,
        sketchEntities: picks.sketchLines,
        depth: toolState.current.pickDepth,
      });
      const sel = filterDialogPick(r?.selection ?? null, s.mode.dialog);
      if (
        sel?.kind === "edge" &&
        ["fillet", "chamfer"].includes(s.mode.dialog) &&
        s.dialogParams.tangentChain !== false &&
        s.projectId
      ) {
        try {
          const response = await api.tangentEdges(
            s.projectId,
            sel,
            s.mode.editFeatureId,
          );
          const current = useStore.getState();
          if (
            current.mode !== s.mode ||
            current.selection !== s.selection ||
            current.dialogParams.tangentChain === false
          )
            return;
          const names = new Set(response.edges.map((e) => e.edgeName));
          const remove = response.edges.every((edge) =>
            s.selection.some(
              (selected) =>
                selected.kind === "edge" &&
                selected.bodyId === edge.bodyId &&
                selected.edgeName === edge.edgeName,
            ),
          );
          const remaining = s.selection.filter(
            (selected) =>
              selected.kind !== "edge" ||
              selected.bodyId !== sel.bodyId ||
              !names.has(selected.edgeName),
          );
          s.setSelection(
            remove ? remaining : [...remaining, ...response.edges],
          );
        } catch (error) {
          s.setError((error as Error).message);
        }
        return;
      }
      // profiles: plain click replaces, Ctrl/⌘/Shift adds or removes (as in
      // idle mode); edges/faces/bodies keep accumulating without a modifier
      const multi = e.ctrlKey || e.metaKey || e.shiftKey;
      if (sel) s.toggleSelection(sel, sel.kind !== "profile" || multi);
      return;
    }

    if (s.mode.name === "measure") {
      const r = vp.pick(e.clientX, e.clientY, {
        faces: true,
        edges: true,
        vertices: true,
        depth: toolState.current.pickDepth,
      });
      if (r) {
        const cur = s.selection;
        const next = cur.length >= 2 ? [r.selection] : [...cur, r.selection];
        s.setSelection(next);
        await s.runMeasure();
      } else {
        s.setSelection([]);
      }
      return;
    }

    // idle: topology selection + unconsumed sketch regions/curves
    // (select-then-command: pick a profile or axis line before the tool)
    const r = vp.pick(e.clientX, e.clientY, {
      faces: true,
      edges: true,
      vertices: true,
      profiles: true,
      sketchEntities: true,
      depth: toolState.current.pickDepth,
    });
    if (r) s.toggleSelection(r.selection, e.ctrlKey || e.metaKey || e.shiftKey);
    else if (!e.ctrlKey && !e.metaKey) s.setSelection([]);
  }

  async function handleSketchClick(e: PointerEvent) {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return;
    const tool = s.mode.tool;
    const construction = s.mode.constructionMode;
    const ts = toolState.current;
    const last = ts.clicks[ts.clicks.length - 1];
    const uv = angleSnapped(
      e,
      tool,
      last,
      pointerToSketchUV(
        e,
        tool === "line" && last
          ? { x: last.x, y: last.y, pointId: last.snapPointId }
          : undefined,
      ),
    );
    if (!uv) return;
    const draft = s.draftSketch;
    if (!draft) return;

    if (s.busy) return;
    if (tool === "project") {
      const picked = viewportRef.current!.pick(e.clientX, e.clientY, {
        edges: true,
      })?.selection;
      if (picked?.kind !== "edge") return;
      const edge = s.evaluation?.bodies
        .find((b) => b.bodyId === picked.bodyId)
        ?.edges.find((ed) => ed.name === picked.edgeName);
      const frame = activeSketchFrame();
      if (!edge || !frame) return;
      try {
        if (
          draft.entities.some(
            (en) =>
              en.kind !== "point" &&
              en.projection?.bodyId === picked.bodyId &&
              en.projection.edgeName === picked.edgeName,
          )
        )
          throw new Error("This edge is already projected into the sketch.");
        if (!s.projectId) return;
        const { entities: added } = await api.projectEdge(
          s.projectId,
          draft.id,
          { kind: "edge", bodyId: picked.bodyId, edgeName: picked.edgeName },
          newId("proj"),
        );
        const current = useStore.getState();
        if (
          current.draftSketch !== draft ||
          current.mode.name !== "sketch" ||
          current.mode.tool !== "project"
        )
          return;
        s.updateDraftSketch([...draft.entities, ...added], draft.constraints);
        await s.commitDraftSketch();
        useStore.getState().setSketchTool("select");
      } catch (error) {
        if (useStore.getState().draftSketch?.id === draft.id)
          useStore.setState({ draftSketch: draft });
        s.setError((error as Error).message);
      }
      return;
    }
    if (tool === "trim" || tool === "extend" || tool === "offset") {
      const picked = viewportRef.current!.pick(e.clientX, e.clientY, {
        sketchEntities: true,
      })?.selection;
      if (
        !picked ||
        (picked.kind !== "sketchEntity" && picked.kind !== "sketchPoint") ||
        picked.sketchId !== draft.id
      )
        return;
      let entityId = picked.entityId;
      if (picked.kind === "sketchPoint") {
        const connected = draft.entities.filter((en) =>
          en.kind === "line"
            ? [en.p1, en.p2].includes(entityId)
            : en.kind === "arc"
              ? [en.start, en.end].includes(entityId)
              : false,
        );
        if (connected.length !== 1) {
          s.setError("Click along the curve to choose which one to modify.");
          return;
        }
        entityId = connected[0]!.id;
      }
      if (tool === "offset") {
        const additive = e.ctrlKey || e.metaKey;
        s.setDialogParams({ offsetManualSelection: additive });
        s.toggleSelection(
          { kind: "sketchEntity", sketchId: draft.id, entityId },
          additive,
        );
        return;
      }
      try {
        const result = modifySketch(
          draft.entities,
          draft.constraints,
          entityId,
          uv,
          tool,
        );
        s.updateDraftSketch(result.entities, result.constraints);
        await s.commitDraftSketch();
        useStore.getState().setSketchTool("select");
        if (result.removedConstraints)
          s.setError(
            `${result.removedConstraints} constraint(s) on the modified curve were removed. Undo restores them.`,
          );
      } catch (error) {
        if (useStore.getState().draftSketch?.id === draft.id)
          useStore.setState({ draftSketch: draft });
        s.setError((error as Error).message);
      }
      return;
    }

    if (DRAW_TOOLS.includes(tool)) {
      // a typed (locked) size wins over where the second click landed
      const d = dimRef.current;
      if (
        ts.clicks.length === 1 &&
        d &&
        d.fields.some((f) => lockedValue(d.fields, f.key) !== null)
      ) {
        await placeWithDims(uv);
        return;
      }
      ts.clicks.push(uv);
      const result = buildFromClicks(tool, ts.clicks, construction);
      if (result) {
        clearDimEntry();
        if (result.created) {
          await applyCreated(result.created, result.chain);
        } else {
          ts.clicks = [];
          clearToolPreview(viewportRef.current);
        }
      }
      return;
    }

    switch (tool) {
      case "select": {
        const vp = viewportRef.current!;
        const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
        if (r)
          s.toggleSelection(r.selection, e.ctrlKey || e.metaKey || e.shiftKey);
        else if (!e.ctrlKey && !e.metaKey) s.setSelection([]);
        return;
      }
      case "point":
        await applyCreated(tools.createPoint(uv, construction), false);
        return;
      case "dimension": {
        const vp = viewportRef.current!;
        const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
        if (!r) {
          ts.dimTargets = [];
          return;
        }
        const sel = r.selection as any;
        const ent = draft.entities.find((x) => x.id === sel.entityId);
        if (!ent) return;
        const kind =
          ent.kind === "point"
            ? "point"
            : ent.kind === "line"
              ? "line"
              : ent.kind === "circle"
                ? "circle"
                : "arc";
        ts.dimTargets.push({ kind, id: ent.id } as any);

        const tryDim = (
          targets: typeof ts.dimTargets,
        ): SketchConstraint | null => tools.dimensionFor(targets as any, 0);

        // single-target dimensions apply immediately; two points/lines need 2 clicks
        let constraint: SketchConstraint | null = null;
        if (kind === "line" || kind === "circle" || kind === "arc") {
          constraint = tryDim([ts.dimTargets[ts.dimTargets.length - 1]!]);
          ts.dimTargets = [];
        } else if (ts.dimTargets.length >= 2) {
          constraint = tryDim(ts.dimTargets.slice(-2));
          ts.dimTargets = [];
        }
        if (constraint) {
          // already dimensioned? edit that one instead of stacking another
          const existing = tools.findExistingDimension(
            draft.constraints,
            constraint,
          );
          if (existing) {
            setDimEdit({
              fields: [
                {
                  constraintId: existing.id,
                  value: String((existing as any).value),
                },
              ],
              x: e.clientX,
              y: e.clientY,
            });
            return;
          }
          const currentValue = measureCurrent(constraint, draft.entities);
          (constraint as any).value = currentValue;
          s.updateDraftSketch(draft.entities, [
            ...draft.constraints,
            constraint,
          ]);
          await s.commitDraftSketch();
          // open the label editor immediately
          setDimEdit({
            fields: [
              {
                constraintId: constraint.id,
                value: String(round3(currentValue)),
              },
            ],
            x: e.clientX,
            y: e.clientY,
          });
        }
        return;
      }
    }
  }

  function handleContextClick(e: PointerEvent) {
    const s = useStore.getState();
    const vp = viewportRef.current;
    if (!vp) return;
    if (s.mode.name === "sketch") {
      // right-click sketch geometry → delete / construction / dimension
      const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
      if (
        r &&
        (r.selection.kind === "sketchEntity" ||
          r.selection.kind === "sketchPoint")
      ) {
        const key = JSON.stringify(r.selection);
        const already = s.selection.some((x) => JSON.stringify(x) === key);
        // keep an existing multi-selection when right-clicking inside it
        if (!already) s.setSelection([r.selection]);
        setCtxMenu({ x: e.clientX, y: e.clientY, sel: r.selection });
      } else {
        setCtxMenu({ x: e.clientX, y: e.clientY, sel: null });
      }
      return;
    }
    if (s.mode.name !== "idle") return;
    const r = vp.pick(e.clientX, e.clientY, {
      faces: true,
      edges: true,
      vertices: true,
      profiles: true,
      sketchEntities: true,
    });
    if (r) {
      // keep an existing multi-selection when right-clicking inside it
      const key = JSON.stringify(r.selection);
      if (!s.selection.some((x) => JSON.stringify(x) === key))
        s.setSelection([r.selection]);
      setCtxMenu({ x: e.clientX, y: e.clientY, sel: r.selection });
    } else {
      setCtxMenu({ x: e.clientX, y: e.clientY, sel: null });
    }
  }

  /**
   * Double-click on a sketch curve: edit its size. Opens the entity's
   * dimension editor, creating the dimension at the current value first if
   * the entity isn't dimensioned yet.
   */
  async function openDimensionEditor(
    entityId: string,
    e: { clientX: number; clientY: number },
  ) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) return;
    const ent = draft.entities.find((x) => x.id === entityId);
    if (!ent || ent.kind === "point") return;
    if (ent.kind === "line") {
      const dims = tools.lineDimensions(
        entityId,
        draft.entities,
        draft.constraints,
      );
      s.updateDraftSketch(draft.entities, dims.constraints);
      await s.commitDraftSketch();
      const labels = dimFieldsFor("line") ?? [];
      const fields: DimEditField[] = [];
      for (const [i, id] of [dims.lengthId, dims.angleId].entries()) {
        const c = dims.constraints.find((x) => x.id === id) as any;
        const stored = draft.constraints.some((x) => x.id === id);
        fields.push({
          constraintId: id,
          value: String(stored ? c.value : round3(c.value)),
          label: labels[i]?.label ?? "",
          unit: labels[i]?.unit ?? "",
        });
      }
      setDimEdit({ fields, x: e.clientX, y: e.clientY });
      return;
    }
    const existing = draft.constraints.find(
      (c) =>
        (c.type === "radius" || c.type === "diameter") && c.entity === entityId,
    );
    if (existing) {
      setDimEdit({
        fields: [
          {
            constraintId: existing.id,
            value: String((existing as any).value),
          },
        ],
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    const constraint = tools.dimensionFor(
      [{ kind: ent.kind, id: entityId }],
      0,
    );
    if (!constraint) return;
    (constraint as any).value = measureCurrent(constraint, draft.entities);
    s.updateDraftSketch(draft.entities, [...draft.constraints, constraint]);
    await s.commitDraftSketch();
    setDimEdit({
      fields: [
        {
          constraintId: constraint.id,
          value: String(round3((constraint as any).value)),
        },
      ],
      x: e.clientX,
      y: e.clientY,
    });
  }

  function handleDoubleClick(e: MouseEvent) {
    const s = useStore.getState();
    if (s.mode.name === "idle") {
      // double-click a sketch curve → edit that sketch
      const vp = viewportRef.current!;
      const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
      if (
        r &&
        (r.selection.kind === "sketchEntity" ||
          r.selection.kind === "sketchPoint")
      ) {
        void s
          .editSketch((r.selection as any).sketchId)
          .then(alignCameraToActiveSketch);
      }
    } else if (s.mode.name === "sketch") {
      // double-click a curve → edit its size
      const vp = viewportRef.current!;
      const r = vp.pick(e.clientX, e.clientY, { sketchEntities: true });
      if (r && r.selection.kind === "sketchEntity") {
        void openDimensionEditor((r.selection as any).entityId, e);
        return;
      }
      // otherwise: finish the current line chain and return to Select
      toolState.current.clicks = [];
      toolState.current.chainPointId = null;
      clearToolPreview(viewportRef.current);
      setToolLabel(null);
      clearDimEntry();
      if ((s.mode as any).tool === "line") s.setSketchTool("select");
    }
  }

  // typed sizes while drawing: digits lock the active field, Tab cycles,
  // Enter places. Capture phase, so App's shortcut/delete handlers never
  // see these keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.mode.name !== "sketch") return;
      const d = dimRef.current;
      const ts = toolState.current;
      if (!d || ts.clicks.length !== 1) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const f = d.fields[d.active];
      if (!f) return;
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === "Tab") {
        swallow();
        const n = d.fields.length;
        d.active = (d.active + (e.shiftKey ? n - 1 : 1)) % n;
        refreshDim();
      } else if (e.key === "Enter") {
        swallow();
        void placeWithDims(ts.lastCursor ?? ts.clicks[0]!);
      } else if (
        d.tool === "line" &&
        !e.repeat &&
        e.key.toUpperCase() === ANGLE_LOCK_KEY
      ) {
        swallow();
        const live = liveDimValues(
          d.tool,
          ts.clicks[0]!,
          ts.lastCursor ?? ts.clicks[0]!,
        );
        tools.toggleAngleLock(d.fields, live.angle ?? 0);
        refreshDim();
        refreshGhost();
      } else if (e.key === "Backspace" && f.locked) {
        swallow();
        f.text = f.text.slice(0, -1);
        if (!f.text) {
          // emptied: back to following the cursor
          f.locked = false;
          const live = liveDimValues(
            d.tool,
            ts.clicks[0]!,
            ts.lastCursor ?? ts.clicks[0]!,
          );
          f.text = fmt2(live[f.key] ?? 0);
        }
        refreshDim();
        refreshGhost();
      } else if (/^[0-9.-]$/.test(e.key)) {
        swallow();
        if (!f.locked) {
          f.text = "";
          f.locked = true;
        }
        f.text += e.key;
        refreshDim();
        refreshGhost();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ----- editing an extrude/revolve: live selection preview + Ctrl/⌘ peek -----

  /** Feature refs implied by a selection, for an extrude/revolve patch. */
  function selectionRefs(dialog: string, sel: Selection[]) {
    const profiles = sel
      .filter((x) => x.kind === "profile")
      .map((x: any) => ({ sketchId: x.sketchId, profileId: x.profileId }));
    if (dialog !== "extrude") return { profiles };
    const faces = sel
      .filter((x) => x.kind === "face")
      .map((x: any) => ({
        kind: "face",
        bodyId: x.bodyId,
        faceName: x.faceName,
      }));
    return { profiles, faces };
  }
  const peekRef = useRef(false);
  const editingProfiles =
    mode.name === "dialog" &&
    !!mode.editFeatureId &&
    (mode.dialog === "extrude" || mode.dialog === "revolve");

  useEffect(() => {
    if (!editingProfiles || mode.name !== "dialog" || peekRef.current) return;
    const editId = mode.editFeatureId!;
    const refs = selectionRefs(mode.dialog, selection);
    if (refs.profiles.length + (refs.faces?.length ?? 0) === 0) return;
    const current = document_?.features.find((f) => f.id === editId);
    if (!current?.suppressed) return;
    void useStore.getState().updateFeaturePreview(editId, {
      ...refs,
      suppressed: false,
    } as any);
  }, [selection, editingProfiles]);

  // Hold Ctrl/⌘ while editing to see the model WITHOUT this feature — its
  // regions come back into view for picking — and release to see it with the
  // current selection. `suppressed` rides the preview channel, so Cancel still
  // restores the baseline and OK writes suppressed:false explicitly.
  useEffect(() => {
    if (!editingProfiles) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || peekRef.current) return;
      if (e.key !== "Control" && e.key !== "Meta") return;
      const s = useStore.getState();
      if (s.mode.name !== "dialog" || !s.mode.editFeatureId) return;
      peekRef.current = true;
      void s.updateFeaturePreview(s.mode.editFeatureId, {
        suppressed: true,
      } as any);
    };
    const release = (e?: KeyboardEvent) => {
      if (e && e.key !== "Control" && e.key !== "Meta") return;
      if (!peekRef.current) return;
      peekRef.current = false;
      const s = useStore.getState();
      if (s.mode.name !== "dialog" || !s.mode.editFeatureId) return;
      const refs = selectionRefs(s.mode.dialog, s.selection);
      // nothing selected: stays hidden until a region is picked
      if (refs.profiles.length + (refs.faces?.length ?? 0) === 0) return;
      void s.updateFeaturePreview(s.mode.editFeatureId, {
        ...refs,
        suppressed: false,
      } as any);
    };
    const onBlur = () => release();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", onBlur);
      peekRef.current = false;
    };
  }, [editingProfiles]);

  // escape key handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.key === "Escape") {
        toolState.current.clicks = [];
        toolState.current.dimTargets = [];
        toolState.current.downUV = null;
        clearToolPreview(viewportRef.current);
        setToolLabel(null);
        clearDimEntry();
        setSnapMarker(null);
        if (s.mode.name === "sketch" && (s.mode as any).tool !== "select") {
          s.setSketchTool("select");
        } else if (s.mode.name === "pickPlane") {
          s.setMode({ name: "idle" });
        } else {
          s.setSelection([]);
        }
        setDimEdit(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // dimension label click → edit
  async function commitDimEdit() {
    if (!dimEdit) return;
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) {
      setDimEdit(null);
      return;
    }
    let constraints = draft.constraints;
    for (const f of dimEdit.fields) {
      const edited = constraints.find((c) => c.id === f.constraintId);
      const v = edited ? tools.dimensionValue(edited, f.value) : null;
      if (v === null) continue;
      // the edited value wins; any other dimension on the same target is a
      // stale duplicate (older sketches could stack them) and goes away
      constraints = tools.dedupeDimensions(
        constraints.map((c) =>
          c.id === f.constraintId ? { ...c, value: v } : c,
        ) as SketchConstraint[],
        f.constraintId,
      );
    }
    if (constraints !== draft.constraints) {
      s.updateDraftSketch(draft.entities, constraints);
      await s.commitDraftSketch();
    }
    setDimEdit(null);
  }

  /** Remove the dimension whose label is being edited. */
  async function deleteDimEdit(ids: string[]) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (draft) {
      s.updateDraftSketch(
        draft.entities,
        draft.constraints.filter((c) => !ids.includes(c.id)),
      );
      await s.commitDraftSketch();
    }
    setDimEdit(null);
  }

  return (
    // suppress the browser context menu everywhere in the viewport — the
    // canvas listener alone missed overlays (our own ctx-menu backdrop mounts
    // before the native contextmenu event fires, so both menus appeared)
    <div
      className="viewport-container"
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="dim-label-layer" ref={labelLayerRef}>
        {dimLabelsRef.current.map((l) => (
          <div
            key={l.id}
            className="dim-label"
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              dimDragRef.current = {
                id: l.id,
                moved: false,
                startX: e.clientX,
                startY: e.clientY,
                pendingOffset: null,
              };
            }}
            onPointerMove={(e) => {
              const d = dimDragRef.current;
              if (!d || d.id !== l.id || e.buttons === 0) return;
              if (
                Math.abs(e.clientX - d.startX) +
                  Math.abs(e.clientY - d.startY) >
                4
              ) {
                d.moved = true;
              }
              if (!d.moved) return;
              const vp = viewportRef.current;
              const frame = activeSketchFrame();
              const s = useStore.getState();
              const draft = s.draftSketch;
              if (!vp || !frame || !draft) return;
              const hit = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
              if (!hit) return;
              const dv = hit.clone().sub(new THREE.Vector3(...frame.origin));
              const u = dv.dot(new THREE.Vector3(...frame.xAxis));
              const v = dv.dot(new THREE.Vector3(...frame.yAxis));
              const c = draft.constraints.find((x) => x.id === l.id);
              if (!c) return;
              const base = dimAnchorFor(c, draft.entities);
              if (!base) return;
              d.pendingOffset = [u - base.x, v - base.y];
              // live-follow the cursor (onRender projects `world` each frame)
              const entry = dimLabelsRef.current.find((x) => x.id === l.id);
              if (entry) {
                entry.world = uv3(frame, u, v);
                updateDimLeaders();
              }
            }}
            onPointerUp={(e) => {
              const d = dimDragRef.current;
              dimDragRef.current = null;
              if (!d || d.id !== l.id) return;
              e.stopPropagation();
              if (d.moved && d.pendingOffset) {
                const s = useStore.getState();
                const draft = s.draftSketch;
                if (!draft) return;
                const constraints = draft.constraints.map((c) =>
                  c.id === l.id ? { ...c, labelOffset: d.pendingOffset! } : c,
                );
                s.updateDraftSketch(draft.entities, constraints as any);
                void s.commitDraftSketch();
              } else {
                setDimEdit({
                  fields: [
                    {
                      constraintId: l.id,
                      value: l.text.replace(/[^\d.-]/g, ""),
                    },
                  ],
                  x: e.clientX,
                  y: e.clientY,
                });
              }
            }}
          >
            {l.text}
          </div>
        ))}
      </div>
      <SketchOffsetIndicators />
      {dimEdit && (
        <div
          className="dim-edit"
          style={{ left: dimEdit.x, top: dimEdit.y }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              void commitDimEdit();
          }}
        >
          {dimEdit.fields.map((f, i) => (
            <Fragment key={f.constraintId}>
              {f.label && <span className="dim-key">{f.label}</span>}
              <input
                autoFocus={i === 0}
                aria-label={
                  f.label ? `Dimension ${f.label}` : "Dimension value"
                }
                value={f.value}
                onChange={(e) =>
                  setDimEdit({
                    ...dimEdit,
                    fields: dimEdit.fields.map((x) =>
                      x === f ? { ...x, value: e.target.value } : x,
                    ),
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Return")
                    void commitDimEdit();
                  if (e.key === "Escape") setDimEdit(null);
                  // Delete on an emptied box removes the dimension altogether
                  if (
                    (e.key === "Delete" || e.key === "Backspace") &&
                    f.value === ""
                  ) {
                    e.preventDefault();
                    void deleteDimEdit([f.constraintId]);
                  }
                }}
              />
              {f.unit && <span className="dim-unit">{f.unit}</span>}
            </Fragment>
          ))}
          <button
            className="dim-edit-delete"
            title="Delete this dimension"
            aria-label="Delete dimension"
            onPointerDown={(e) => e.preventDefault()} // keep the input's blur from committing first
            onClick={() =>
              void deleteDimEdit(dimEdit.fields.map((f) => f.constraintId))
            }
          >
            ✕
          </button>
        </div>
      )}
      <div className="viewcube" ref={cubeRef} />
      {gizmoLabel && (
        <div
          className="dim-label gizmo-label"
          style={{
            position: "fixed",
            left: gizmoLabel.x + 14,
            top: gizmoLabel.y - 14,
            transform: "none",
          }}
        >
          {gizmoLabel.text}
        </div>
      )}
      {toolLabel && (
        <div
          className="dim-label gizmo-label"
          style={{
            position: "fixed",
            left: toolLabel.x + 16,
            top: toolLabel.y + 16,
            transform: "none",
            pointerEvents: "none",
          }}
        >
          {toolLabel.text}
        </div>
      )}
      {dimEntry && (
        <div
          className="dim-entry"
          style={{ left: dimEntry.x + 16, top: dimEntry.y + 16 }}
        >
          {dimEntry.fields.map((f, i) => (
            <span
              key={f.key}
              className={`dim-field${i === dimEntry.active ? " active" : ""}${f.locked ? " locked" : ""}`}
            >
              <span className="dim-key">{f.label}</span>
              <span className="dim-val">{f.text}</span>
              <span className="dim-unit">{f.unit}</span>
            </span>
          ))}
          <span className="dim-hint">Tab ↹ · Enter ↵</span>
        </div>
      )}
      {snapMarker && (
        <div
          className={`snap-marker ${snapMarker.kind}`}
          style={{ left: snapMarker.x, top: snapMarker.y }}
        />
      )}
      <button
        className="home-btn"
        title="Home view"
        onClick={() => viewCubeRef.current?.goHome()}
      >
        ⌂
      </button>
      {ctxMenu && (
        <ViewportContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          isPlanarFace={isPlanarFace}
          alignToSketch={alignCameraToActiveSketch}
          onDimension={(entityId, pos) =>
            void openDimensionEditor(entityId, pos)
          }
        />
      )}
      <ViewportHud />
    </div>
  );
}

function ViewportHud() {
  const mode = useStore((s) => s.mode);
  const evaluation = useStore((s) => s.evaluation);
  const draftSketch = useStore((s) => s.draftSketch);

  let hint = "";
  if (mode.name === "pickPlane")
    hint = "Select a plane or planar face to sketch on";
  else if (mode.name === "sketch") {
    const toolHints: Record<string, string> = {
      select: "Drag points to adjust · click to select",
      line: "Click points to chain lines · double-click / Esc to end",
      rect: "Click two corners",
      centerRect: "Click centre, then a corner",
      circle: "Click centre, then a point on the circle",
      arc3: "Click start, end, then a point on the arc",
      polygon: "Click centre, then a vertex",
      slot: "Click two centres, then the radius",
      point: "Click to place points",
      dimension:
        "Click an entity (or two points / two lines), then type the value",
      project:
        "Click a model edge to create a linked purple reference · source must precede this sketch",
      trim: "Click the section between intersections to remove · Esc cancels",
      extend:
        "Click near the endpoint to extend to the next boundary · Esc cancels",
      offset:
        "Ctrl-click to add/remove curves · select a connected chain · preview then Create offset",
    };
    hint = toolHints[(mode as any).tool] ?? "";
  } else if (mode.name === "measure")
    hint = "Select up to two faces / edges / vertices";

  let sketchBadge: { label: string; cls: string } | null = null;
  if (mode.name === "sketch" && draftSketch && evaluation) {
    const solved = evaluation.sketches.find(
      (s) => s.featureId === draftSketch.id,
    );
    const status = solved?.solveStatus ?? "unconstrained";
    const dof = solved?.dof ?? 0;
    const map: Record<SketchSolveStatus, { label: string; cls: string }> = {
      unconstrained: { label: `Unconstrained (${dof} DOF)`, cls: "warn" },
      partially_constrained: {
        label: `Partially constrained (${dof} DOF)`,
        cls: "warn",
      },
      fully_constrained: { label: "Fully constrained", cls: "ok" },
      over_constrained: { label: "Over-constrained!", cls: "err" },
    };
    sketchBadge = map[status];
  }

  return (
    <>
      {hint && <div className="viewport-hint">{hint}</div>}
      {sketchBadge && (
        <div className={`sketch-status ${sketchBadge.cls}`}>
          {sketchBadge.label}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/** Default label anchor for a dimension, building the lookup maps itself. */
function dimAnchorFor(
  c: SketchConstraint,
  entities: SketchEntity[],
): { x: number; y: number } | null {
  const pts = new Map<string, { x: number; y: number }>();
  const lines = new Map<string, { p1: string; p2: string }>();
  const circles = new Map<string, { center: string; radius: number }>();
  for (const e of entities) {
    if (e.kind === "point") pts.set(e.id, e);
    else if (e.kind === "line") lines.set(e.id, e);
    else if (e.kind === "circle") circles.set(e.id, e);
  }
  return dimensionLayout(c, pts, lines, circles)?.label ?? null;
}

function dimensionText(c: SketchConstraint): string {
  switch (c.type) {
    case "length":
    case "distance":
      return `${round3((c as any).value)}`;
    case "radius":
      return `R${round3((c as any).value)}`;
    case "diameter":
      return `⌀${round3((c as any).value)}`;
    case "angle":
    case "lineAngle":
      return `${round3((c as any).value)}°`;
    default:
      return "";
  }
}

function angleSnapped(
  e: { shiftKey: boolean },
  tool: string,
  from: tools.UV | undefined,
  uv: tools.UV | null,
): tools.UV | null {
  return uv && from && tool === "line" && e.shiftKey
    ? tools.snapLineEnd(from, uv)
    : uv;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function measureCurrent(c: SketchConstraint, entities: SketchEntity[]): number {
  const pts = new Map<string, { x: number; y: number }>();
  for (const e of entities) if (e.kind === "point") pts.set(e.id, e);
  if (c.type === "length") {
    const l = entities.find((e) => e.id === c.line) as any;
    const a = pts.get(l.p1)!,
      b = pts.get(l.p2)!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (c.type === "distance") {
    const a = pts.get(c.a)!,
      b = pts.get(c.b)!;
    if (c.axis === "x") return Math.abs(b.x - a.x);
    if (c.axis === "y") return Math.abs(b.y - a.y);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (c.type === "radius" || c.type === "diameter") {
    const ent = entities.find((e) => e.id === (c as any).entity) as any;
    if (ent?.kind === "circle") {
      return c.type === "radius" ? ent.radius : ent.radius * 2;
    }
    if (ent?.kind === "arc") {
      const cc = pts.get(ent.center)!;
      const s = pts.get(ent.start)!;
      const r = Math.hypot(s.x - cc.x, s.y - cc.y);
      return c.type === "radius" ? r : r * 2;
    }
  }
  if (c.type === "angle") {
    const la = entities.find((e) => e.id === c.a) as any;
    const lb = entities.find((e) => e.id === c.b) as any;
    const a1 = pts.get(la.p1)!,
      a2 = pts.get(la.p2)!;
    const b1 = pts.get(lb.p1)!,
      b2 = pts.get(lb.p2)!;
    const va = { x: a2.x - a1.x, y: a2.y - a1.y };
    const vb = { x: b2.x - b1.x, y: b2.y - b1.y };
    const dot = va.x * vb.x + va.y * vb.y;
    const cross = va.x * vb.y - va.y * vb.x;
    return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI;
  }
  return 0;
}
