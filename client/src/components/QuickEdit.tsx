import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Feature } from "@rockett/shared";
import { createLivePreview } from "../livePreview";
import { panelPlacement } from "../panelPlacement";
import { useStore } from "../store";
import { LengthField, NumField } from "./form/fields";

interface QuickValue {
  label: string;
  kind: "length" | "angle" | "count";
  read: (f: any) => number;
  write: (f: any, v: number) => Partial<Feature>;
}

const key = (
  name: string,
  label: string,
  kind: QuickValue["kind"] = "length",
): QuickValue => ({
  label,
  kind,
  read: (f) => f[name],
  write: (_f, v) => ({ [name]: v }) as Partial<Feature>,
});

const offset = (i: number, label: string): QuickValue => ({
  label,
  kind: "length",
  read: (f) => f.translation[i],
  write: (f, v) =>
    ({
      translation: f.translation.map((x: number, j: number) =>
        j === i ? v : x,
      ),
    }) as Partial<Feature>,
});

export function quickValues(f: Feature): QuickValue[] {
  const anyF = f as any;
  switch (f.type) {
    case "extrude":
      return [
        key("distance", "Distance"),
        ...(anyF.direction === "twoSided"
          ? [key("distance2", "Distance 2")]
          : []),
      ];
    case "revolve":
      return [key("angle", "Angle", "angle")];
    case "fillet":
      return [key("radius", "Radius")];
    case "chamfer":
    case "offsetFace":
      return [key("distance", "Distance")];
    case "shell":
      return [key("thickness", "Thickness")];
    case "emboss":
      return [key("depth", "Depth")];
    case "linearPattern":
      return [key("spacing", "Spacing"), key("count", "Quantity", "count")];
    case "circularPattern":
      return [
        key("count", "Quantity", "count"),
        key("totalAngle", "Total angle", "angle"),
      ];
    case "constructionPlane":
      return anyF.method?.kind === "offset"
        ? [
            {
              label: "Offset",
              kind: "length",
              read: (f) => f.method.distance,
              write: (f, v) =>
                ({ method: { ...f.method, distance: v } }) as Partial<Feature>,
            },
          ]
        : [];
    case "move":
      return [offset(0, "X"), offset(1, "Y"), offset(2, "Z")];
    default:
      return [];
  }
}

const differs = (f: Feature | undefined, patch: Partial<Feature>) =>
  Object.entries(patch).some(
    ([k, v]) => JSON.stringify((f as any)?.[k]) !== JSON.stringify(v),
  );

async function sendPreview(fid: string, patch: Partial<Feature>) {
  const s = useStore.getState();
  if (
    differs(
      s.document?.features.find((f) => f.id === fid),
      patch,
    )
  )
    return s.updateFeaturePreview(fid, patch);
}

function useAbove(
  ref: RefObject<HTMLDivElement | null>,
  anchor: { left: number; top: number },
) {
  const [at, setAt] = useState({ x: anchor.left, y: anchor.top });
  useLayoutEffect(() => {
    const size = ref.current!.getBoundingClientRect();
    setAt(
      panelPlacement(
        { x: anchor.left, y: anchor.top - size.height - 4 },
        size,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);
  return at;
}

function QuickField({
  value,
  draft,
  autoFocus,
  onChange,
}: {
  value: QuickValue;
  draft: Feature;
  autoFocus: boolean;
  onChange: (v: number) => void;
}) {
  if (value.kind === "length")
    return (
      <LengthField
        label={value.label}
        units="mm"
        value={value.read(draft)}
        autoFocus={autoFocus}
        onChange={onChange}
      />
    );
  const count = value.kind === "count";
  return (
    <NumField
      label={count ? value.label : `${value.label} (°)`}
      int={count}
      min={count ? 2 : undefined}
      max={count ? 500 : undefined}
      value={value.read(draft)}
      autoFocus={autoFocus}
      onChange={onChange}
    />
  );
}

export function QuickEdit({
  feature,
  anchor,
  onClose,
}: {
  feature: Feature;
  anchor: { left: number; top: number };
  onClose: () => void;
}) {
  const [patch, setPatch] = useState<Partial<Feature>>({});
  const ref = useRef<HTMLDivElement>(null);
  const at = useAbove(ref, anchor);
  const committed = useRef(false);
  const [live] = useState(() => createLivePreview({ send: sendPreview }));
  const draft = { ...feature, ...patch } as Feature;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      live.cancel();
      if (!committed.current) void useStore.getState().cancelPreview();
    };
  }, [live]);

  const change = (value: QuickValue, v: number) => {
    const next = { ...patch, ...value.write(draft, v) } as Partial<Feature>;
    setPatch(next);
    live.dwell(feature.id, next);
  };

  const commit = async () => {
    live.cancel();
    if (!differs(feature, patch)) return onClose();
    committed.current = await useStore
      .getState()
      .updateFeature(feature.id, patch)
      .then(
        () => true,
        () => false,
      );
    if (committed.current) onClose();
  };

  return (
    <div
      ref={ref}
      className="dim-edit quick-edit"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") onClose();
      }}
    >
      {quickValues(feature).map((value, i) => (
        <QuickField
          key={value.label}
          value={value}
          draft={draft}
          autoFocus={i === 0}
          onChange={(v) => change(value, v)}
        />
      ))}
      <button className="btn primary" onClick={() => void commit()}>
        OK
      </button>
    </div>
  );
}
