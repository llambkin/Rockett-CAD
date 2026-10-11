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
import { useSetting } from "../settings";
import { storedTargets } from "../toolTargets";
import { AngleField, LengthField, NumField } from "./form/fields";
import type { FieldLink } from "./form/expressionField";
import {
  previewLinked,
  resolvedFeature,
  saveEdit,
  storedExpression,
  type FieldExpressions,
} from "../features/bindings";

interface QuickValue {
  label: string;
  kind: "length" | "angle" | "count";
  path: string;
}

const key = (
  name: string,
  label: string,
  kind: QuickValue["kind"] = "length",
): QuickValue => ({ label, kind, path: `/${name}` });

const offset = (i: number, label: string): QuickValue => ({
  label,
  kind: "length",
  path: `/translation/${i}`,
});

function read(f: Feature, path: string): number {
  let at: any = f;
  for (const part of path.slice(1).split("/")) at = at[part];
  return at;
}

function write(f: Feature, path: string, v: number): Partial<Feature> {
  const [top, ...rest] = path.slice(1).split("/") as [string, ...string[]];
  const set = (at: any, parts: string[]): any => {
    if (!parts.length) return v;
    const [part, ...more] = parts as [string, ...string[]];
    const copy = Array.isArray(at) ? [...at] : { ...at };
    copy[part] = set(at[part], more);
    return copy;
  };
  return { [top]: set((f as any)[top], rest) } as Partial<Feature>;
}

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
      return [
        key("radius", (f.sets ?? []).length > 0 ? "Radius 1" : "Radius"),
        ...(f.sets ?? []).map((_, i) =>
          key(`sets/${i}/radius`, `Radius ${i + 2}`),
        ),
      ];
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
        ? [{ label: "Offset", kind: "length", path: "/method/distance" }]
        : [];
    case "move":
      return [offset(0, "X"), offset(1, "Y"), offset(2, "Z")];
    default:
      return [];
  }
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
  bind,
  onChange,
}: {
  value: QuickValue;
  draft: Feature;
  autoFocus: boolean;
  bind: FieldLink;
  onChange: (v: number) => void;
}) {
  const units = useSetting("units.length");
  if (value.kind === "length")
    return (
      <LengthField
        label={value.label}
        units={units}
        value={read(draft, value.path)}
        autoFocus={autoFocus}
        bind={bind}
        onChange={onChange}
      />
    );
  if (value.kind === "angle")
    return (
      <AngleField
        label={value.label}
        value={read(draft, value.path)}
        autoFocus={autoFocus}
        bind={bind}
        onChange={onChange}
      />
    );
  return (
    <NumField
      label={value.label}
      int
      min={2}
      value={read(draft, value.path)}
      autoFocus={autoFocus}
      bind={bind}
      onChange={onChange}
    />
  );
}

function useLinks(featureId: string) {
  const links = useRef<FieldExpressions>({});
  const [invalid, setInvalid] = useState<string[]>([]);
  const link = (path: string): FieldLink => ({
    text: Object.hasOwn(links.current, path)
      ? (links.current[path] ?? undefined)
      : storedExpression(useStore.getState().document, featureId, path),
    set: (expression) => {
      setInvalid((all) => [
        ...all.filter((p) => p !== path),
        ...(expression === false ? [path] : []),
      ]);
      if (expression !== false)
        links.current = { ...links.current, [path]: expression };
    },
  });
  return { links, invalid, link };
}

const linkedPreview = (links: RefObject<FieldExpressions>) =>
  createLivePreview({
    send: (fid, next) => previewLinked(fid, next, links.current),
  });

export function QuickEdit({
  feature,
  anchor,
  onClose,
}: {
  feature: Feature;
  anchor: { left: number; top: number };
  onClose: () => void;
}) {
  const [patch, setPatch] = useState(() => storedTargets(feature));
  const [shown] = useState(() => resolvedFeature(feature));
  const { links, invalid, link } = useLinks(feature.id);
  const ref = useRef<HTMLDivElement>(null);
  const at = useAbove(ref, anchor);
  const committed = useRef(false);
  const [live] = useState(() => linkedPreview(links));
  const draft = { ...shown, ...patch } as Feature;
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
    const next = {
      ...patch,
      ...write(draft, value.path, v),
    } as Partial<Feature>;
    setPatch(next);
    live.dwell(feature.id, next);
  };

  const commit = async () => {
    live.cancel();
    if (invalid.length) return;
    const saving = saveEdit(feature.id, feature, patch, links.current);
    if (!saving) return onClose();
    committed.current = await saving.then(
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
          bind={link(value.path)}
          onChange={(v) => change(value, v)}
        />
      ))}
      <button className="btn primary" onClick={() => void commit()}>
        OK
      </button>
    </div>
  );
}
