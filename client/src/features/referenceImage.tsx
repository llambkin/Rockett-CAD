import { useContext } from "react";
import { useState, useRef } from "react";
import {
  newId,
  parseLength,
  roundedLength,
  type ReferenceImageFeature,
} from "@rockett/shared";
import { api } from "../api";
import { RefRepair } from "../components/RefRepair";
import { DraggablePanel } from "../components/DraggablePanel";
import { DialogFooter } from "../components/form/DialogFooter";
import { AngleField, LengthField, SelInfo } from "../components/form/fields";
import { featureParams, planar } from "../commands/featureCommand";
import { useStore, type Selection } from "../store";
import { useSetting } from "../settings";
import { ViewportContext } from "../viewportRef";
import { selectedPlane, num } from "./inputs";
import { saveNew } from "./bindings";
import {
  registerFeatureUI,
  type InputParams,
  type FeaturePanelProps,
  type FeatureUI,
} from "./registry";

export type ReferenceImageParams = InputParams<
  Pick<
    ReferenceImageFeature,
    | "id"
    | "name"
    | "plane"
    | "assetId"
    | "fileName"
    | "opacity"
    | "width"
    | "height"
  > &
    ReferenceImageFeature["transform"]
>;

function build(
  params: ReferenceImageParams,
  selection: Selection[],
): ReferenceImageFeature | { error: string } {
  if (!params.assetId)
    return { error: "Choose an image file (PNG, JPEG, WebP)" };
  return {
    id: params.id ?? newId("canvas"),
    type: "referenceImage",
    name: params.name ?? "",
    suppressed: false,
    plane: params.plane ??
      selectedPlane(selection) ?? { kind: "origin", plane: "XY" },
    assetId: params.assetId,
    fileName: params.fileName ?? "",
    transform: {
      u: num(params, "u", 0),
      v: num(params, "v", 0),
      rotation: num(params, "rotation", 0),
      scale: num(params, "scale", 0.5),
    },
    opacity: num(params, "opacity", 0.6),
    width: num(params, "width", 0),
    height: num(params, "height", 0),
  };
}

function prefill(f: ReferenceImageFeature) {
  return {
    params: {
      id: f.id,
      name: f.name,
      plane: f.plane,
      assetId: f.assetId,
      fileName: f.fileName,
      ...f.transform,
      opacity: f.opacity,
      width: f.width,
      height: f.height,
    },
    selection: [],
  };
}

function imageDimensions(file: File): Promise<{ w: number; h: number }> {
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.addEventListener("load", () =>
      resolve({ w: img.naturalWidth, h: img.naturalHeight }),
    );
    img.addEventListener("error", reject);
    img.src = URL.createObjectURL(file);
  });
}

function ReferenceImagePanel({
  editId,
  onClose,
  cancelPreview,
  update,
  params,
  setParams,
}: FeaturePanelProps<ReferenceImageParams>) {
  const viewport = useContext(ViewportContext);
  const doc = useStore((s) => s.document);
  const latestParams = useRef(params);
  latestParams.current = params;
  const setError = useStore((s) => s.setError);
  const cancel = useStore((s) => s.cancelDialog);
  const invalid = useStore((s) => featureParams(s).invalid);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const units = useSetting("units.length");

  const existing = editId
    ? doc?.features.find((f) => f.id === editId)
    : undefined;
  const seed: ReferenceImageParams =
    existing?.type === "referenceImage" ? prefill(existing).params : {};
  const value = (
    key: "opacity" | "scale" | "rotation" | "u" | "v",
    dflt: number,
  ): number => num(params[key] !== undefined ? params : seed, key, dflt);
  const opacity = value("opacity", 0.6);
  const scale = value("scale", 0.5);
  const rotation = value("rotation", 0);
  const u = value("u", 0);
  const v = value("v", 0);

  const onOk = async () => {
    cancelPreview();
    setPending(true);
    try {
      if (existing) {
        await update({ opacity, transform: { u, v, rotation, scale } });
        onClose();
        return;
      }
      if (!file) {
        setError("Choose an image file (PNG, JPEG, WebP)");
        return;
      }
      const { selection } = useStore.getState();
      const { assetId } = await api.uploadImage(doc!.id, file);
      const dims = await imageDimensions(file);
      const built = build(
        {
          ...params,
          assetId,
          fileName: file.name,
          width: dims.w,
          height: dims.h,
        },
        selection,
      );
      if ("error" in built) throw new Error(built.error);
      await saveNew(built, featureParams().expressions);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const calibrate = async () => {
    setCalibrating(true);
    const vp = viewport.current;
    const { evaluation } = useStore.getState();
    const frame = evaluation?.planes.find((p) => p.featureId === editId)?.frame;
    if (!vp || !existing || !frame) {
      setCalibrating(false);
      return;
    }
    const clicks: { x: number; y: number; z: number }[] = [];
    const el = vp.renderer.domElement;
    const handler = (e: PointerEvent) => {
      const pt = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
      if (!pt) return;
      clicks.push({ x: pt.x, y: pt.y, z: pt.z });
      if (clicks.length === 2) {
        el.removeEventListener("pointerdown", handler, true);
        const a = clicks[0]!;
        const b = clicks[1]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const entry = window.prompt(
          `Real distance between the two points (${units}):`,
          String(roundedLength(100, units)),
        );
        const desired = entry === null ? null : parseLength(entry, units);
        setCalibrating(false);
        if (entry !== null && (desired === null || desired <= 0))
          useStore.getState().setError("Enter a valid distance");
        if (desired !== null && desired > 0 && d > 1e-9) {
          const now = num(latestParams.current, "scale", scale);
          setParams({ scale: now * (desired / d) });
        }
      }
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", handler, true);
  };

  return (
    <DraggablePanel id="design.referenceImage" title="Reference Image">
      <div className="dialog-body">
        <RefRepair />
        {!existing && (
          <>
            <SelInfo
              label="Plane"
              input="plane"
              hint="click a plane/face (default XY)"
            />
            <label className="field">
              <span>Image file</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        )}
        <LengthField
          label="Scale per pixel"
          units={units}
          autoFocus
          bind="/transform/scale"
          value={scale}
          onChange={(x) => setParams({ scale: x })}
        />
        <AngleField
          label="Rotation"
          bind="/transform/rotation"
          value={rotation}
          onChange={(x) => setParams({ rotation: x })}
        />
        <LengthField
          label="Position U"
          units={units}
          bind="/transform/u"
          value={u}
          onChange={(x) => setParams({ u: x })}
        />
        <LengthField
          label="Position V"
          units={units}
          bind="/transform/v"
          value={v}
          onChange={(x) => setParams({ v: x })}
        />
        <label className="field">
          <span>Opacity</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setParams({ opacity: Number(e.target.value) })}
          />
        </label>
        {existing && (
          <button
            className="btn"
            disabled={calibrating}
            onClick={() => void calibrate()}
          >
            {calibrating
              ? "Click two points on the image…"
              : "Calibrate (2 points)"}
          </button>
        )}
      </div>
      <DialogFooter
        onOk={() => void onOk()}
        onCancel={cancel}
        pending={pending}
        okDisabled={!!invalid?.length}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}

export const referenceImage: FeatureUI<
  ReferenceImageFeature,
  ReferenceImageParams
> = {
  type: "referenceImage",
  icon: "🖼",
  title: "Reference Image",
  group: "insert",
  picks: [planar("plane", true)],
  initialParams: {},
  Panel: ReferenceImagePanel,
  build,
  prefill,
};

registerFeatureUI(referenceImage);
