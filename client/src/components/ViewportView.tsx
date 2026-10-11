import { refsOf } from "../selection/kinds";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import type {
  PlaneFrame,
  SketchConstraint,
  SketchEntity,
  TrimPiece,
  ViewCamera,
} from "@rockett/shared";
import {
  formatAngle,
  formatLength,
  roundedLength,
  extendSketch,
  refusal,
  unsupported,
  trimPiece,
  trimPieces,
  trimmable,
  type Units,
} from "@rockett/shared";
import { getSetting, useSetting } from "../settings";
import { CadViewport, uv3 } from "../three/CadViewport";
import { ViewCube } from "../three/ViewCube";
import type { LayerHandle } from "../three/sceneLayers";
import { worldToClient } from "../three/screen";
import { syncReferenceImages } from "../three/referenceImages";
import { syncConstructionPlanes } from "../constructionPlaneView";
import { renderSketches, styleSketches } from "../three/sketchRender";
import { hoverPiece } from "../three/sketchStyle";
import { sketchRenderInputs } from "../sketchInputs";
import { ExtrudeGizmo } from "../three/ExtrudeGizmo";
import { meshOf } from "../three/meshes";
import { useBodySync } from "../three/useBodySync";
import { themeColor } from "../theme/tokens";
import { SKETCH_APPEARANCE } from "../tunables";
import { RevolveGizmo, ringThrough, featureAxis } from "../three/RevolveGizmo";
import {
  featureHandle,
  frameAlong,
  type FeatureHandle,
} from "../three/featureHandles";
import { FeatureGizmos } from "../three/featureGizmos";
import { GizmoSlot } from "../three/gizmoSlot";
import { clearToolPreview, updateToolPreview } from "../three/toolPreview";
import { listenWheel } from "../three/wheel";
import {
  previewBodies,
  selectionKey,
  useStore,
  isIdle,
  type Selection,
} from "../store";
import { loadPreviewBase, usePreviewBase } from "../previewBase";
import { projectionPick, projectPicked } from "../sketchProject";
import { ViewportContext, alignCameraToActiveSketch } from "../viewportRef";
import { activeCommand } from "../commands/active";
import {
  registerHoldKey,
  pushKeyContext,
  type KeyEvent,
} from "../commands/keymap";
import { watchSnapshots } from "../snapshot";
import * as tools from "../sketchTools";
import {
  buildFromClicksRaw,
  finishClicks,
  polygonOptions,
} from "../sketchClicks";
import { ANGLE_LOCK_KEY } from "../commands/sketch";

import {
  isPlanarFace,
  takes,
  featureParams,
  setFeatureParams,
} from "../commands/featureCommand";
import { dimensionLayout, dimensionMaps } from "../dimensionLayout";
import { SketchOffsetIndicators } from "./SketchOffsetIndicators";
import { ViewportContextMenu } from "./ViewportContextMenu";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { previewEdit } from "../toolTargets";
import { peekHighlight, usePeekedFeature } from "../timelinePeek";
import { ViewportHud } from "./ViewportHud";
import { IDLE_PICKS, primaryDrag, SKETCH_PICKS } from "./primaryDrag";
import {
  DimensionEdit,
  updateOfferingDriven,
  type DimEdit,
  type DimEditField,
} from "./DimensionEdit";

interface DimLabel {
  id: string;
  text: string;
  driven: boolean;
  world: THREE.Vector3;
  anchorWorld: THREE.Vector3;
  reference?: [THREE.Vector3, THREE.Vector3];
}

const NUDGE_EVENTS = ["pointerdown", "pointerup", "wheel"];

const DRAW_TOOLS = new Set([
  "line",
  "rect",
  "centerRect",
  "circle",
  "arc3",
  "ellipse",
  "polygon",
  "slot",
  "fitSpline",
  "controlSpline",
  "conic",
]);
const TWO_POINT_TOOLS = new Set([
  "line",
  "rect",
  "centerRect",
  "circle",
  "polygon",
]);

function activeSketchFrame(): PlaneFrame | null {
  const s = useStore.getState();
  if (s.active?.id !== "design.sketch") return null;
  const sketchId = s.active.state.sketchId;
  const sk = s.evaluation?.sketches.find((x) => x.featureId === sketchId);
  return sk?.frame ?? null;
}

function planarFace(sel: Selection): boolean {
  return isPlanarFace(sel, useStore.getState());
}

function buildFromClicks(
  tool: string,
  clicks: tools.UV[],
  construction: boolean,
): { created: tools.Created | null; chain: boolean } | null {
  const r = buildFromClicksRaw(tool, clicks, construction);
  if (r?.created && construction) r.created = tools.asConstruction(r.created);
  return r;
}

function selectionRefs(sel: Selection[]) {
  return { profiles: refsOf(sel, "profile"), faces: refsOf(sel, "face") };
}

export function ViewportView({
  children,
}: {
  children?: (viewport: ReactNode) => ReactNode;
}) {
  const units = useSetting("units.length");
  const containerRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<CadViewport | null>(null);
  const viewCubeRef = useRef<ViewCube | null>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  const evaluation = useStore((s) => s.evaluation);
  const document_ = useStore((s) => s.document);
  const hiddenFeatures = useStore((s) => s.view.hidden.features);
  const projectId = useStore((s) => s.projectId);
  const savedCamera = useStore((s) => s.view.camera);
  const shownCamera = useRef({ key: "", camera: null as ViewCamera | null });
  const active = useStore((s) => s.active);
  const idle = useStore(isIdle);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const peeked = usePeekedFeature();
  const draftSketch = useStore((s) => s.draftSketch);
  const params = useStore(featureParams);
  const activeFeature = useStore((s) =>
    s.active?.id === "design.feature" ? s.active.state : undefined,
  );
  const dialogOpen = !!activeFeature;
  const editFeatureId = activeFeature?.editFeatureId;
  const held = usePreviewBase();

  const [dimEdit, setDimEdit] = useState<DimEdit | null>(null);

  const [dimMenu, setDimMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    sel: Selection | null;
  } | null>(null);

  const commandGizmo = useRef<FeatureGizmos | null>(null);
  const [featureSlot] = useState(
    () => new GizmoSlot<ExtrudeGizmo | RevolveGizmo>(),
  );
  const featureHandleRef = useRef<FeatureHandle | null>(null);
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
  const [toolLabel, setToolLabel] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  type DimField = tools.DimField;
  const { fmt2, dimFieldsFor, liveDimValues, resolveDimCursor, pinTypedDims } =
    tools;
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
  const [snapMarker, setSnapMarker] = useState<{
    x: number;
    y: number;
    kind: NonNullable<tools.UV["snapKind"]>;
  } | null>(null);

  const toolState = useRef<{
    clicks: tools.UV[];
    dragPointId: string | null;
    chainPointId: string | null;
    dimTargets: tools.DimTarget[];
    pickDepth: number;
    lastPickPos: { x: number; y: number };
    downUV: tools.UV | null;
    lastCursor: tools.UV | null;
    trimDrag: { pieces: TrimPiece[]; x: number; y: number } | null;
  }>({
    clicks: [],
    dragPointId: null,
    chainPointId: null,
    dimTargets: [],
    pickDepth: 0,
    lastPickPos: { x: -1, y: -1 },
    downUV: null,
    lastCursor: null,
    trimDrag: null,
  });
  const trimLayerRef = useRef<LayerHandle | null>(null);

  const dimLabelsRef = useRef<DimLabel[]>([]);
  const leaderLayerRef = useRef<LayerHandle | null>(null);

  function updateDimLeaders() {
    const vp = viewportRef.current;
    if (!vp) return;
    if (leaderLayerRef.current?.group.parent !== vp.scene) {
      leaderLayerRef.current = vp.addLayer("dimLeaders");
    }
    const layer = leaderLayerRef.current;
    layer.clear();
    const wpp = vp.worldPerPixel();
    const dashed = (from: THREE.Vector3, to: THREE.Vector3) => {
      const geom = new THREE.BufferGeometry().setFromPoints([from, to]);
      const line = new THREE.Line(
        geom,
        new THREE.LineDashedMaterial({
          color: themeColor("dim-leader"),
          dashSize: wpp * SKETCH_APPEARANCE.dimLeaderDashPx,
          gapSize: wpp * SKETCH_APPEARANCE.dimLeaderGapPx,
          transparent: true,
          opacity: SKETCH_APPEARANCE.dimLeaderOpacity,
          depthTest: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 7;
      layer.group.add(line);
    };
    for (const l of dimLabelsRef.current) {
      if (l.reference) dashed(...l.reference);
      if (l.world.distanceTo(l.anchorWorld) < wpp * 14) continue;
      dashed(l.anchorWorld, l.world);
    }
    vp.requestRender();
  }

  useEffect(() => {
    const container = containerRef.current!;
    let vp: CadViewport;
    try {
      vp = new CadViewport(container);
    } catch {
      setUnavailable(true);
      return;
    }
    viewportRef.current = vp;
    commandGizmo.current = new FeatureGizmos(vp, setGizmoLabel);
    if ((import.meta as any).env?.DEV) {
      (window as any).__rockett = { vp, store: useStore };
    }
    const stopSnapshots = watchSnapshots(vp);
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
      const nodes = layer.children;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i] as HTMLElement;
        const label = dimLabelsRef.current[i];
        if (!label) continue;
        const p = worldToClient(rect, cam, label.world);
        el.style.transform = `translate(${p.x - rect.left}px, ${p.y - rect.top}px) translate(-50%, -50%)`;
        el.style.display = p.inFront ? "block" : "none";
      }
    });

    vp.onRender(() => {
      const camera = vp.cameraState();
      const key = JSON.stringify(camera);
      if (key === shownCamera.current.key) return;
      shownCamera.current = { key, camera };
      useStore.getState().moveCamera(camera);
    });

    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      unsubscribe();
      stopSnapshots();
      for (const type of NUDGE_EVENTS) {
        container.removeEventListener(type, nudge);
      }
      cube.dispose();
      commandGizmo.current?.dispose();
      commandGizmo.current = null;
      featureSlot.release();
      vp.dispose();
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!editFeatureId) return;
    void loadPreviewBase(editFeatureId, useStore.getState);
  }, [editFeatureId]);

  const meshVersion = useBodySync(viewportRef, dialogOpen, editFeatureId);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !evaluation) return;
    const hidden = new Set(hiddenFeatures);
    syncConstructionPlanes(vp, document_, evaluation, hidden);
    syncReferenceImages(vp, document_, evaluation, hidden);
  }, [evaluation, document_, hiddenFeatures]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !evaluation || !document_) return;
    const editingId =
      active?.id === "design.sketch" ? active.state.sketchId : null;
    const inputs = sketchRenderInputs({
      document: document_,
      sketches: evaluation.sketches,
      hidden: hiddenFeatures,
      editingId,
      draft: draftSketch,
      showProfiles:
        (!!activeFeature && takes(activeFeature.type, "profile")) || idle,
      peeked,
    });
    const shown = useStore.getState();
    renderSketches(vp, inputs, shown.selection, shown.hover);

    const labels: DimLabel[] = [];
    if (editingId && draftSketch) {
      const sk = evaluation.sketches.find((s) => s.featureId === editingId);
      if (sk) {
        const { points, lines, circles } = dimensionMaps(draftSketch.entities);
        for (const c of draftSketch.constraints) {
          const layout = dimensionLayout(c, points, lines, circles);
          if (layout) {
            const anchor = layout.label;
            const off = c.labelOffset;
            const driven = "driven" in c && c.driven === true;
            const text = dimensionText(
              driven
                ? {
                    ...c,
                    value: tools.measureDimension(c, draftSketch.entities),
                  }
                : c,
              units,
            );
            labels.push({
              id: c.id,
              text: driven ? `(${text})` : text,
              driven,
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
    setLabelTick((t) => t + 1);
  }, [
    evaluation,
    document_,
    hiddenFeatures,
    active,
    activeFeature,
    idle,
    peeked,
    draftSketch,
    held,
    units,
  ]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !evaluation || !document_) return;
    styleSketches(vp, selection, hover);
    vp.clearHighlights();
    for (const s of selection) vp.addHighlight(s, "select");
    if (hover) vp.addHighlight(hover, "hover");
    if (peeked) vp.addHighlights(peekHighlight(evaluation, peeked), "hover");
  }, [evaluation, document_, held, selection, hover, peeked, meshVersion]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || (savedCamera && savedCamera === shownCamera.current.camera))
      return;
    if (savedCamera) vp.setCamera(savedCamera);
    else vp.zoomToFit(false);
    shownCamera.current = {
      key: JSON.stringify(vp.cameraState()),
      camera: savedCamera,
    };
  }, [projectId, savedCamera]);

  const [, setLabelTick] = useState(0);
  useEffect(() => {
    viewportRef.current?.requestRender();
  });

  useEffect(() => {
    commandGizmo.current?.refresh(true);
  }, [held]);

  useEffect(() => {
    featureSlot.rebuild(buildFeatureHandle);
  }, [activeFeature, selection, evaluation, params, held]);

  function buildFeatureHandle(): ExtrudeGizmo | RevolveGizmo | null {
    const vp = viewportRef.current;
    const s = useStore.getState();
    const handle =
      vp && s.active?.id === "design.feature"
        ? featureHandle({
            dialog: s.active.state.type,
            params: featureParams(s),
            selection: s.selection,
            bodies: previewBodies(s),
            evaluation: s.evaluation,
          })
        : null;
    featureHandleRef.current = handle;
    if (!vp || !handle) return null;
    if (handle.kind === "arrow") {
      const frame = frameAlong(handle.origin, handle.axis);
      return new ExtrudeGizmo(vp, { frame, anchorUV: [0, 0] }, handle.value);
    }
    const axis = featureAxis(featureParams(s));
    if (!axis) return null;
    const ring = ringThrough(
      handle.through,
      axis.origin,
      axis.dir,
      vp.worldPerPixel(),
    );
    return new RevolveGizmo(
      vp,
      ring.center,
      ring.dir,
      ring.zeroDir,
      ring.radius,
      handle.value,
    );
  }

  function dragFeatureHandle(
    g: ExtrudeGizmo | RevolveGizmo,
    handle: FeatureHandle,
    e: PointerEvent,
  ) {
    const arc = g instanceof RevolveGizmo;
    const value = arc
      ? g.dragAngle(e.clientX, e.clientY)
      : g.dragValue(e.clientX, e.clientY);
    if (handle.signed ? value === 0 : value <= 0) return;
    g.update(value);
    setFeatureParams({ [handle.param]: value });
    const at = arc ? g.handleScreenPosition() : g.tipScreenPosition();
    const text = arc ? formatAngle(value, 3) : formatLength(value, units);
    setGizmoLabel({ ...at, text });
  }

  const sketchTool = active?.id === "design.sketch" ? active.state.tool : null;
  useEffect(() => {
    toolState.current.clicks = [];
    toolState.current.downUV = null;
    toolState.current.dimTargets = [];
    clearToolPreview(viewportRef.current);
    setToolLabel(null);
    clearDimEntry();
    setSnapMarker(null);
  }, [sketchTool, active?.id]);

  useEffect(() => {
    const vp = viewportRef.current;
    const container = containerRef.current;
    if (!vp || !container) return;
    const el = vp.renderer.domElement;
    const drag = primaryDrag(vp, container, planeUV);
    let button = -1;
    let lastX = 0,
      lastY = 0;
    let orbiting = false;
    let pivot: THREE.Vector3 | undefined;
    let panning = false;
    let dragMoved = false;

    const startOrbit = (e: PointerEvent) => {
      orbiting = true;
      pivot = vp.pick(e.clientX, e.clientY, ["design.body"])?.point;
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
        if (commandGizmo.current?.down(e)) {
          e.preventDefault();
          return;
        }
        const handle = featureSlot.current;
        if (handle?.hitTest(e.clientX, e.clientY)) {
          if (handle instanceof RevolveGizmo)
            handle.beginDrag(e.clientX, e.clientY);
          featureSlot.beginDrag();
          e.preventDefault();
          return;
        }
        if (!drag.down(e)) handlePrimaryDown(e);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      if (featureSlot.isDragging && featureSlot.current) {
        dragFeatureHandle(featureSlot.current, featureHandleRef.current!, e);
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      if (commandGizmo.current?.move(e)) {
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      } else if (orbiting) {
        vp.orbit(dx, dy, pivot);
      } else if (panning) {
        vp.pan(dx, dy);
      } else if (button === 0) {
        if (!drag.move(e)) handlePrimaryDrag(e);
      } else {
        vp.queueHover(() => handleHover(e));
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      el.releasePointerCapture(e.pointerId);
      if (featureSlot.isDragging) {
        featureSlot.endDrag();
        setGizmoLabel(null);
        button = -1;
        return;
      }
      if (commandGizmo.current?.up()) {
        button = -1;
        return;
      }
      const viewMoved = orbiting || panning;
      orbiting = panning = false;
      const b = button;
      button = -1;
      if (viewMoved) {
        if (b === 2 && !dragMoved) handleContextClick(e);
        else vp.queueHover(() => handleHover(e));
        return;
      }
      if (b === 0) drag.up(e, dragMoved, handlePrimaryUp);
    };

    const onPointerCancel = () => {
      drag.cancel();
      if (commandGizmo.current?.cancel()) button = -1;
    };

    const onContext = (e: Event) => e.preventDefault();

    const onDblClick = (e: MouseEvent) => {
      handleDoubleClick(e);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    const unlistenWheel = listenWheel(el, vp);
    el.addEventListener("contextmenu", onContext);
    el.addEventListener("dblclick", onDblClick);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      unlistenWheel();
      el.removeEventListener("contextmenu", onContext);
      el.removeEventListener("dblclick", onDblClick);
      drag.cancel();
    };
  }, []);

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
    if (s.active?.id !== "design.sketch") return null;
    const sketchId = s.active.state.sketchId as string;
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
      const shape = body && meshOf(body);
      if (!shape) return body && undefined;
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
      for (const ed of shape.edges) {
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
    if (data === undefined) return null;
    faceSnapCache.current = { key: sketchId, eval: s.evaluation, data };
    return data;
  }

  function planeUV(e: {
    clientX: number;
    clientY: number;
  }): { x: number; y: number } | null {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    if (!vp || !frame) return null;
    const hit = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
    if (!hit) return null;
    const d = hit.clone().sub(new THREE.Vector3(...frame.origin));
    return {
      x: d.dot(new THREE.Vector3(...frame.xAxis)),
      y: d.dot(new THREE.Vector3(...frame.yAxis)),
    };
  }

  function trimTarget(e: { clientX: number; clientY: number }) {
    const draft = useStore.getState().draftSketch;
    const picked = viewportRef.current?.pick(e.clientX, e.clientY, [
      "sketch.entity",
    ])?.selection;
    const at = planeUV(e);
    if (picked?.kind !== "sketchEntity" || picked.sketchId !== draft?.id)
      return null;
    const curve = draft.entities.find((x) => x.id === picked.entityId);
    if (!at || !curve || curve.kind === "point") return null;
    return { selection: picked, entities: draft.entities, at, curve };
  }

  function trimAlong(e: PointerEvent) {
    const drag = toolState.current.trimDrag;
    const draft = useStore.getState().draftSketch;
    if (!drag || !draft) return;
    const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(dx, dy) / getSetting("viewport.pickTolerancePx")),
    );
    const crossed = Array.from({ length: steps }, (_, i) =>
      trimTarget({
        clientX: drag.x + (dx * (i + 1)) / steps,
        clientY: drag.y + (dy * (i + 1)) / steps,
      }),
    ).flatMap((t) =>
      t && trimmable(t.entities, t.curve)
        ? [{ entityId: t.selection.entityId, at: t.at }]
        : [],
    );
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.pieces = trimPieces(draft.entities, [...drag.pieces, ...crossed]);
    showTrimPieces(drag.pieces);
  }

  async function finishTrimDrag(e: PointerEvent) {
    const drag = toolState.current.trimDrag!;
    trimAlong(e);
    toolState.current.trimDrag = null;
    showTrimPieces([]);
    const clicked = trimTarget(e);
    const s = useStore.getState();
    try {
      await s.trimSketchPieces(
        drag.pieces.length || !clicked
          ? drag.pieces
          : [{ entityId: clicked.curve.id, at: clicked.at }],
      );
    } catch (error) {
      s.setError((error as Error).message);
    }
  }

  function showTrimPieces(pieces: TrimPiece[]) {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    if (!vp) return;
    if (trimLayerRef.current?.group.parent !== vp.scene)
      trimLayerRef.current = vp.addLayer("trimPieces");
    const layer = trimLayerRef.current;
    layer.clear();
    if (frame)
      for (const piece of pieces)
        layer.group.add(hoverPiece(frame, piece.samples));
    vp.requestRender();
  }

  function pointerToSketchUV(
    e: { clientX: number; clientY: number },
    alignFrom?: { x: number; y: number; pointId?: string | undefined },
  ): tools.UV | null {
    const vp = viewportRef.current;
    const raw = planeUV(e);
    if (!vp || !raw) return null;
    let u = raw.x;
    let v = raw.y;
    const s = useStore.getState();
    const tol = vp.worldPerPixel() * 10;
    const entities = s.draftSketch?.entities ?? [];
    const pts = new Map<string, { x: number; y: number }>();
    for (const ent of entities) {
      if (ent.kind === "point") pts.set(ent.id, ent);
    }

    const faceSnap = faceSnapGeometry();

    let snapPointId: string | undefined;
    let best = tol;
    for (const ent of entities) {
      if (ent.kind !== "point" || ent.id === toolState.current.dragPointId)
        continue;
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
    if (Math.hypot(u, v) < tol) return { x: 0, y: 0, snapKind: "origin" };

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
    commandGizmo.current?.hover(e);
    featureSlot.current?.setHover(
      featureSlot.current.hitTest(e.clientX, e.clientY),
    );
    const s = useStore.getState();
    let picked: Selection | null = null;
    const command = activeCommand();
    if (command) {
      const r = vp.pick(e.clientX, e.clientY, command.pickFilter(e));
      picked = command.onHover(r?.selection ?? null, e);
    } else if (s.active?.id === "design.sketch") {
      const tool = s.active.state.tool as string;
      if (tool === "project") {
        picked = projectionPick(vp, e, s.draftSketch?.id) ?? null;
      } else if (tool === "trim") {
        const target = trimTarget(e);
        if (target && trimmable(target.entities, target.curve))
          picked = {
            ...target.selection,
            piece: trimPiece(
              target.entities,
              target.selection.entityId,
              target.at,
            ).samples,
          };
      } else if (["select", "dimension", "extend", "offset"].includes(tool)) {
        const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
        picked = r?.selection ?? null;
      } else if (DRAW_TOOLS.has(tool) || tool === "point") {
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
            polygonOptions(),
          );
          showToolLabel(e, tool, ts.clicks, uv);
        } else {
          clearToolPreview(vp);
          setToolLabel(null);
          clearDimEntry();
        }
        const sketchId = s.active.state.sketchId as string;
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
    } else {
      const r = vp.pick(e.clientX, e.clientY, IDLE_PICKS);
      picked = r?.selection ?? null;
    }
    const prevKey = s.hover ? JSON.stringify(s.hover) : null;
    const newKey = picked ? JSON.stringify(picked) : null;
    if (prevKey !== newKey) s.setHover(picked);
  }

  function handlePrimaryDown(e: PointerEvent) {
    const s = useStore.getState();
    if (s.active?.id === "design.sketch") {
      const t = s.active.state.tool as string;
      if (t === "select") {
        const vp = viewportRef.current!;
        const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
        if (r?.selection.kind === "sketchPoint") {
          toolState.current.dragPointId = (r.selection as any).entityId;
        }
      } else if (DRAW_TOOLS.has(t) && toolState.current.clicks.length === 0) {
        toolState.current.downUV = pointerToSketchUV(e);
      } else if (t === "trim") {
        toolState.current.trimDrag = {
          pieces: [],
          x: e.clientX,
          y: e.clientY,
        };
        trimAlong(e);
      }
    }
  }

  function handlePrimaryDrag(e: PointerEvent) {
    const s = useStore.getState();
    if (s.active?.id !== "design.sketch") return;
    if (toolState.current.trimDrag) {
      trimAlong(e);
      return;
    }
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
    const tool = s.active.state.tool as string;
    if (down && DRAW_TOOLS.has(tool)) {
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
        updateToolPreview(vp, frame, tool as any, [down], uv, polygonOptions());
        showToolLabel(e, tool, [down], uv);
        updateSnapMarker(uv);
      }
    }
  }

  function sketchUVToScreen(
    u: number,
    v: number,
  ): { x: number; y: number } | null {
    const vp = viewportRef.current;
    const frame = activeSketchFrame();
    if (!vp || !frame) return null;
    return worldToClient(vp.canvasRect(), vp.camera, uv3(frame, u, v));
  }

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

  function toolSizeText(
    tool: string,
    clicks: tools.UV[],
    cursor: tools.UV,
  ): string | null {
    const f = (v: number) => formatLength(v, units);
    const first = clicks[0];
    if (!first) return null;
    const last = clicks[clicks.length - 1]!;
    const dx = cursor.x - last.x;
    const dy = cursor.y - last.y;
    switch (tool) {
      case "line":
        return f(Math.hypot(dx, dy));
      case "rect":
        return `${f(Math.abs(cursor.x - first.x))} × ${f(Math.abs(cursor.y - first.y))}`;
      case "centerRect":
        return `${f(Math.abs(cursor.x - first.x) * 2)} × ${f(Math.abs(cursor.y - first.y) * 2)}`;
      case "circle":
        return `⌀${f(Math.hypot(cursor.x - first.x, cursor.y - first.y) * 2)}`;
      case "polygon":
        return `R${f(Math.hypot(cursor.x - first.x, cursor.y - first.y))}`;
      case "arc3":
        return clicks.length === 1 ? f(Math.hypot(dx, dy)) : null;
      case "slot":
        return clicks.length === 1
          ? f(Math.hypot(dx, dy))
          : `R${f(Math.hypot(dx, dy))}`;
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
    const fields = dimFieldsFor(tool, units);
    if (fields && clicks.length === 1) {
      let d = dimRef.current;
      if (!d || d.tool !== tool) {
        d = { tool, fields, active: 0, x: 0, y: 0 };
        dimRef.current = d;
      }
      d.x = e.clientX;
      d.y = e.clientY;
      const live = liveDimValues(tool, clicks[0]!, cursor);
      for (const f of d.fields)
        if (!f.locked)
          f.text =
            f.unit === "°"
              ? fmt2(live[f.key] ?? 0)
              : String(roundedLength(live[f.key] ?? 0, units));
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
      polygonOptions(),
    );
  }

  async function placeWithDims(cursor: tools.UV) {
    const s = useStore.getState();
    if (s.active?.id !== "design.sketch") return;
    const tool = s.active.state.tool as string;
    const ts = toolState.current;
    const d = dimRef.current;
    if (ts.clicks.length !== 1 || !d) return;
    const first = ts.clicks[0]!;
    const second = resolveDimCursor(tool, first, cursor, d.fields);
    const size = liveDimValues(tool, first, second);
    const unset = d.fields.find((f) =>
      f.locked
        ? tools.lockedValue(d.fields, f.key) === null
        : f.unit !== "°" && !((size[f.key] ?? 0) > 0),
    );
    if (unset) {
      refreshDim();
      s.setError(
        unset.unit === "°"
          ? `Type a number for ${unset.label}; nothing was placed.`
          : `${unset.label} needs a size above zero; nothing was placed.`,
      );
      return;
    }
    const result = buildFromClicks(
      tool,
      [first, second],
      s.active.state.constructionMode,
    );
    if (!result?.created) return;
    clearDimEntry();
    await applyCreated(
      pinTypedDims(tool, result.created, d.fields),
      result.chain,
    );
  }

  async function applyCreated(created: tools.Created, keepChaining: boolean) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) return;

    s.inferDraftSketch(
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
    if (!keepChaining) {
      const st = useStore.getState();
      if (
        st.active?.id === "design.sketch" &&
        st.active.state.tool !== "select" &&
        st.active.state.tool !== "dimension"
      ) {
        st.setSketchTool("select");
      }
    }
  }

  async function handlePrimaryUp(e: PointerEvent, dragMoved: boolean) {
    const s = useStore.getState();
    const vp = viewportRef.current!;

    if (toolState.current.trimDrag) return finishTrimDrag(e);

    if (s.active?.id === "design.sketch" && toolState.current.dragPointId) {
      const wasDrag = dragMoved;
      toolState.current.dragPointId = null;
      if (wasDrag) {
        await s.commitDraftSketch();
        return;
      }
    }

    if (dragMoved && s.active?.id === "design.sketch") {
      const ts = toolState.current;
      const down = ts.downUV;
      ts.downUV = null;
      const tool = s.active.state.tool as string;
      if (down && DRAW_TOOLS.has(tool) && ts.clicks.length === 0) {
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
          if (TWO_POINT_TOOLS.has(tool)) {
            const result = buildFromClicks(
              tool,
              [down, upUV],
              s.active.state.constructionMode,
            );
            if (result?.created) {
              await applyCreated(result.created, false);
            }
          } else {
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

    const samePos =
      Math.abs(e.clientX - toolState.current.lastPickPos.x) < 4 &&
      Math.abs(e.clientY - toolState.current.lastPickPos.y) < 4;
    toolState.current.pickDepth =
      e.altKey && samePos ? toolState.current.pickDepth + 1 : 0;
    toolState.current.lastPickPos = { x: e.clientX, y: e.clientY };

    const command = activeCommand();
    if (command) {
      const r = vp.pick(
        e.clientX,
        e.clientY,
        command.pickFilter(e),
        toolState.current.pickDepth,
      );
      await command.onClick(r?.selection ?? null, e, viewportRef);
      return;
    }

    if (s.active?.id === "design.sketch") {
      await handleSketchClick(e);
      return;
    }

    const r = vp.pick(
      e.clientX,
      e.clientY,
      IDLE_PICKS,
      toolState.current.pickDepth,
    );
    if (r) s.toggleSelection(r.selection, e.ctrlKey || e.metaKey || e.shiftKey);
    else if (!e.ctrlKey && !e.metaKey) s.setSelection([]);
  }

  async function handleSketchClick(e: PointerEvent) {
    const s = useStore.getState();
    const vp = viewportRef.current!;
    if (s.active?.id !== "design.sketch") return;
    const tool = s.active.state.tool;
    const construction = s.active.state.constructionMode;
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
      if (activeSketchFrame()) await projectPicked(vp, e, draft);
      return;
    }
    if (tool === "extend" || tool === "offset") {
      const picked = vp.pick(e.clientX, e.clientY, SKETCH_PICKS)?.selection;
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
        s.setSketchState({ offsetManualSelection: additive });
        s.toggleSelection(
          { kind: "sketchEntity", sketchId: draft.id, entityId },
          additive,
        );
        return;
      }
      try {
        const result = extendSketch(
          draft.entities,
          draft.constraints,
          entityId,
          uv,
        );
        s.inferDraftSketch(result.entities, result.constraints);
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

    if (DRAW_TOOLS.has(tool)) {
      const d = dimRef.current;
      if (ts.clicks.length === 1 && d && d.fields.some((f) => f.locked)) {
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
      } else if (ts.clicks.length === 1 && dimFieldsFor(tool, units))
        handleHover(e);
      return;
    }

    switch (tool) {
      case "select": {
        const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
        if (r)
          s.toggleSelection(r.selection, e.ctrlKey || e.metaKey || e.shiftKey);
        else if (!e.ctrlKey && !e.metaKey) s.setSelection([]);
        return;
      }
      case "point":
        await applyCreated(tools.createPoint(uv, construction), false);
        return;
      case "dimension": {
        const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
        if (!r) {
          ts.dimTargets = [];
          return;
        }
        const sel = r.selection as any;
        const ent = draft.entities.find((x) => x.id === sel.entityId);
        if (!ent || unsupported(ent)) return ent && s.setError(refusal(ent));
        const target: tools.DimTarget = { kind: ent.kind, id: ent.id };
        if (ent.kind === "line" && (e.ctrlKey || e.metaKey)) {
          ts.dimTargets = [target];
          return;
        }
        const pending = ts.dimTargets.at(-1);
        const targets =
          ent.kind === "circle" || ent.kind === "arc" || !pending
            ? [target]
            : [pending, target];
        ts.dimTargets = ent.kind === "point" && !pending ? [target] : [];
        const constraint =
          targets.length === 2 || ent.kind !== "point"
            ? tools.dimensionFor(targets, draft.entities)
            : null;
        if (constraint) {
          const existing = tools.findExistingDimension(
            draft.constraints,
            constraint,
          );
          if (existing) {
            const angle =
              existing.type === "angle" || existing.type === "lineAngle";
            setDimEdit({
              fields: [
                {
                  constraintId: existing.id,
                  value: String(
                    angle
                      ? (existing as any).value
                      : roundedLength((existing as any).value, units),
                  ),
                  unit: angle ? "°" : units,
                },
              ],
              x: e.clientX,
              y: e.clientY,
            });
            return;
          }
          const at = { x: e.clientX, y: e.clientY };
          await commitDimension((cs) => [...cs, constraint], constraint, at);
        }
        return;
      }
    }
  }

  function handleContextClick(e: PointerEvent) {
    const s = useStore.getState();
    const vp = viewportRef.current;
    if (!vp) return;
    const command = activeCommand();
    if (command) {
      const r = vp.pick(e.clientX, e.clientY, command.pickFilter(e));
      command.onContextMenu(r?.selection ?? null, e);
      return;
    }
    if (s.active?.id === "design.sketch") {
      const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
      if (
        r &&
        (r.selection.kind === "sketchEntity" ||
          r.selection.kind === "sketchPoint")
      ) {
        const key = selectionKey(r.selection);
        const already = s.selection.some((x) => selectionKey(x) === key);
        if (!already) s.setSelection([r.selection]);
        setCtxMenu({ x: e.clientX, y: e.clientY, sel: r.selection });
      } else {
        setCtxMenu({ x: e.clientX, y: e.clientY, sel: null });
      }
      return;
    }
    const r = vp.pick(e.clientX, e.clientY, IDLE_PICKS);
    if (r) {
      const key = selectionKey(r.selection);
      if (!s.selection.some((x) => selectionKey(x) === key))
        s.setSelection([r.selection]);
      setCtxMenu({ x: e.clientX, y: e.clientY, sel: r.selection });
    } else {
      setCtxMenu({ x: e.clientX, y: e.clientY, sel: null });
    }
  }

  async function openDimensionEditor(
    entityId: string,
    e: { clientX: number; clientY: number },
  ) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) return;
    const ent = draft.entities.find((x) => x.id === entityId);
    if (unsupported(ent)) return s.setError(refusal(ent));
    if (!ent || ent.kind === "point") return;
    if (ent.kind === "line") {
      const dims = tools.lineDimensions(
        entityId,
        draft.entities,
        draft.constraints,
      );
      const refused = await updateOfferingDriven(dims.constraints);
      await s.commitDraftSketch();
      if (refused) return;
      const labels = dimFieldsFor("line", units) ?? [];
      const fields: DimEditField[] = [];
      for (const [i, id] of [dims.lengthId, dims.angleId].entries()) {
        const c = dims.constraints.find((x) => x.id === id) as any;
        const stored = draft.constraints.some((x) => x.id === id);
        fields.push({
          constraintId: id,
          value: String(
            i === 1
              ? stored
                ? c.value
                : round3(c.value)
              : roundedLength(c.value, units),
          ),
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
            value: String(roundedLength((existing as any).value, units)),
            unit: units,
          },
        ],
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    const constraint = tools.dimensionFor(
      [{ kind: ent.kind, id: entityId }],
      draft.entities,
    );
    if (!constraint) return;
    await commitDimension((cs) => [...cs, constraint], constraint, {
      x: e.clientX,
      y: e.clientY,
    });
  }

  function handleDoubleClick(e: MouseEvent) {
    const s = useStore.getState();
    if (s.active && s.active.id !== "design.sketch") return;
    if (!s.active) {
      const vp = viewportRef.current!;
      const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
      if (
        r &&
        (r.selection.kind === "sketchEntity" ||
          r.selection.kind === "sketchPoint")
      ) {
        void s
          .editSketch((r.selection as any).sketchId)
          .then(() => alignCameraToActiveSketch(viewportRef));
      }
    } else if (s.active?.id === "design.sketch") {
      const { tool, constructionMode } = s.active.state;
      const open = finishClicks(
        tool,
        toolState.current.clicks,
        constructionMode,
      );
      if (open) return void applyCreated(open, false);
      const vp = viewportRef.current!;
      const r = vp.pick(e.clientX, e.clientY, SKETCH_PICKS);
      if (r && r.selection.kind === "sketchEntity") {
        void openDimensionEditor((r.selection as any).entityId, e);
        return;
      }
      toolState.current.clicks = [];
      toolState.current.chainPointId = null;
      clearToolPreview(viewportRef.current);
      setToolLabel(null);
      clearDimEntry();
      if (s.active.state.tool === "line") s.setSketchTool("select");
    }
  }

  const drawingDimensions = dimEntry !== null;
  useLayoutEffect(() => {
    if (!drawingDimensions) return;
    const onKey = (e: KeyEvent) => {
      const s = useStore.getState();
      if (s.active?.id !== "design.sketch") return false;
      const d = dimRef.current;
      const ts = toolState.current;
      if (!d || ts.clicks.length !== 1) return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const f = d.fields[d.active];
      if (!f) return false;
      if (e.key === "Tab") {
        const n = d.fields.length;
        d.active = (d.active + (e.shiftKey ? n - 1 : 1)) % n;
        refreshDim();
      } else if (e.key === "Enter") {
        void placeWithDims(ts.lastCursor ?? ts.clicks[0]!);
      } else if (
        d.tool === "line" &&
        !e.repeat &&
        e.key.toUpperCase() === ANGLE_LOCK_KEY
      ) {
        const live = liveDimValues(
          d.tool,
          ts.clicks[0]!,
          ts.lastCursor ?? ts.clicks[0]!,
        );
        tools.toggleAngleLock(d.fields, live.angle ?? 0);
        refreshDim();
        refreshGhost();
      } else if (e.key === "Backspace" && f.locked) {
        f.text = f.text.slice(0, -1);
        if (!f.text) {
          f.locked = false;
          const live = liveDimValues(
            d.tool,
            ts.clicks[0]!,
            ts.lastCursor ?? ts.clicks[0]!,
          );
          f.text =
            f.unit === "°"
              ? fmt2(live[f.key] ?? 0)
              : String(roundedLength(live[f.key] ?? 0, units));
        }
        refreshDim();
        refreshGhost();
      } else if (
        (f.unit === "°" && /^[0-9.+\-eE]$/.test(e.key)) ||
        (f.unit !== "°" && /^[0-9.+\-mMcCiInNeE]$/.test(e.key))
      ) {
        if (!f.locked) {
          f.text = "";
          f.locked = true;
        }
        f.text += e.key;
        refreshDim();
        refreshGhost();
      } else return false;
      return true;
    };
    return pushKeyContext({ kind: "text-entry", handle: onKey });
  }, [units, drawingDimensions]);

  const peekRef = useRef(false);
  const editingProfiles =
    !!activeFeature &&
    !!activeFeature.editFeatureId &&
    (activeFeature.type === "extrude" || activeFeature.type === "revolve");

  useEffect(() => {
    if (!editingProfiles || !activeFeature || peekRef.current) return;
    const editId = activeFeature.editFeatureId!;
    const refs = selectionRefs(selection);
    if (refs.profiles.length + (refs.faces?.length ?? 0) === 0) return;
    const current = document_?.features.find((f) => f.id === editId);
    if (!current?.suppressed) return;
    void previewEdit(editId, { ...refs, suppressed: false });
  }, [selection, editingProfiles]);

  useEffect(() => {
    if (!editingProfiles) return;
    const dispose = registerHoldKey({
      id: "design.editPeek",
      keys: ["Control", "Meta"],
      press: (s) => {
        if (s.active?.id !== "design.feature" || !s.active.state.editFeatureId)
          return;
        peekRef.current = true;
        void s.updateFeaturePreview(s.active.state.editFeatureId, {
          suppressed: true,
        } as any);
      },
      release: (s) => {
        if (!peekRef.current) return;
        peekRef.current = false;
        if (s.active?.id !== "design.feature" || !s.active.state.editFeatureId)
          return;
        const refs = selectionRefs(s.selection);
        if (refs.profiles.length + (refs.faces?.length ?? 0) === 0) return;
        void previewEdit(s.active.state.editFeatureId, {
          ...refs,
          suppressed: false,
        });
      },
    });
    return () => {
      dispose();
      peekRef.current = false;
    };
  }, [editingProfiles]);

  function openDimensionChoices(
    id: string,
    e: { clientX: number; clientY: number },
  ) {
    const draft = useStore.getState().draftSketch;
    const c = draft?.constraints.find((x) => x.id === id);
    const choices = c && draft ? tools.dimensionChoices(c, draft.entities) : [];
    if (!choices.length) return;
    const at = { x: e.clientX, y: e.clientY };
    dimDragRef.current = null;
    setDimEdit(null);
    setDimMenu({
      ...at,
      items: choices.map((choice) => ({
        label: choice.label,
        action: () =>
          void commitDimension(
            (cs) => tools.chooseDimension(cs, choice.constraint),
            choice.constraint,
            at,
          ),
      })),
    });
  }

  async function commitDimension(
    edit: (constraints: SketchConstraint[]) => SketchConstraint[],
    placed: SketchConstraint,
    at: { x: number; y: number },
  ) {
    const s = useStore.getState();
    const draft = s.draftSketch;
    if (!draft) return;
    const refused = await updateOfferingDriven(edit(draft.constraints));
    await s.commitDraftSketch();
    if (refused) return;
    const angle = placed.type === "angle" || placed.type === "lineAngle";
    const measured = tools.measureDimension(placed, draft.entities);
    const value = angle ? round3(measured) : roundedLength(measured, units);
    setDimEdit({
      fields: [
        {
          constraintId: placed.id,
          value: String(value),
          unit: angle ? "°" : units,
        },
      ],
      ...at,
    });
  }

  const viewport = unavailable ? (
    <div className="viewport-container">
      <div className="tree-empty">3D view unavailable</div>
    </div>
  ) : (
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
            style={l.driven ? { color: "var(--text-dim)" } : undefined}
            onContextMenu={(e) => openDimensionChoices(l.id, e)}
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
              const frame = activeSketchFrame();
              const draft = useStore.getState().draftSketch;
              const at = planeUV(e);
              if (!frame || !draft || !at) return;
              const { x: u, y: v } = at;
              const c = draft.constraints.find((x) => x.id === l.id);
              if (!c) return;
              const base = dimAnchorFor(c, draft.entities);
              if (!base) return;
              d.pendingOffset = [u - base.x, v - base.y];
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
                      value: l.text.replace(/[^\d.e-]/g, ""),
                      unit: l.text.endsWith("°") ? "°" : units,
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
        <DimensionEdit
          key={`${dimEdit.x},${dimEdit.y},${dimEdit.fields.map((f) => f.constraintId)}`}
          edit={dimEdit}
          units={units}
          onClose={() => setDimEdit(null)}
        />
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
              aria-invalid={
                f.locked && tools.lockedValue(dimEntry.fields, f.key) === null
              }
            >
              <span className="dim-key">{f.label}</span>
              <span className="dim-val">{f.text}</span>
              <span className="dim-unit">
                {f.locked && /[a-z]$/i.test(f.text.trim()) ? "" : f.unit}
              </span>
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
      {dimMenu && (
        <ContextMenu
          x={dimMenu.x}
          y={dimMenu.y}
          items={dimMenu.items}
          onClose={() => setDimMenu(null)}
        />
      )}
      {ctxMenu && (
        <ViewportContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          isPlanarFace={planarFace}
          onDimension={(entityId, pos) =>
            void openDimensionEditor(entityId, pos)
          }
        />
      )}
      <ViewportHud />
    </div>
  );
  return (
    <ViewportContext value={viewportRef}>
      {children ? children(viewport) : viewport}
    </ViewportContext>
  );
}

function dimAnchorFor(
  c: SketchConstraint,
  entities: SketchEntity[],
): { x: number; y: number } | null {
  const { points, lines, circles } = dimensionMaps(entities);
  return dimensionLayout(c, points, lines, circles)?.label ?? null;
}

export function dimensionText(c: SketchConstraint, units: Units): string {
  switch (c.type) {
    case "length":
    case "distance":
    case "pointLineDistance":
    case "lineDistance":
      return formatLength((c as any).value, units);
    case "radius":
      return `R${formatLength((c as any).value, units)}`;
    case "diameter":
      return `⌀${formatLength((c as any).value, units)}`;
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
  const free =
    tool === "line" || (tool === "polygon" && polygonOptions().angle === null);
  return uv && from && free && e.shiftKey
    ? tools.snapLineEnd(
        from,
        uv,
        getSetting("sketch.angleStep"),
        getSetting("sketch.angles"),
      )
    : uv;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
