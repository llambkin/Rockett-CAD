import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { THUMBNAIL_LIMITS } from "@rockett/shared";
import { api } from "../api";
import { panelPlacement } from "../panelPlacement";
import { TIMING_MS } from "../tunables";

export const editedAt = (at: string) => new Date(at).toLocaleString();

export interface SnapshotTarget {
  id: string;
  modifiedAt: string;
}

type Point = { x: number; y: number };

type Shot = "loading" | "none" | "failed" | { url: string };

const SHOT_TEXT = {
  loading: "Loading snapshot…",
  none: "No snapshot yet",
  failed: "Snapshot did not load.",
};

function SnapshotPopover({
  target,
  at,
}: {
  target: SnapshotTarget;
  at: Point;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<Shot>("loading");
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    api.getThumbnail(target.id).then(
      (png) => {
        if (!live) return;
        url = URL.createObjectURL(png);
        setShot({ url });
      },
      (e: { status?: number }) => {
        if (live) setShot(e.status === 404 ? "none" : "failed");
      },
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target.id]);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    const { x, y } = panelPlacement(
      at,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  }, [at, shot]);
  return (
    <div
      ref={ref}
      className="snapshot-popover"
      role="tooltip"
      style={{ left: at.x, top: at.y }}
    >
      {typeof shot === "object" ? (
        <img
          src={shot.url}
          width={THUMBNAIL_LIMITS.width / 2}
          height={THUMBNAIL_LIMITS.height / 2}
          alt="Model snapshot"
        />
      ) : (
        <div className="snapshot-empty">{SHOT_TEXT[shot]}</div>
      )}
      <span>Edited {editedAt(target.modifiedAt)}</span>
    </div>
  );
}

export function useSnapshotPeek(target: SnapshotTarget | undefined) {
  const [at, setAt] = useState<Point | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!target) return { handlers: {}, popover: null };
  const show = (e: SyntheticEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const row = (el.parentElement ?? el).getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setAt({ x: row.right + 8, y: row.top }),
      TIMING_MS.snapshotHoverDelay,
    );
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAt(null);
  };
  return {
    handlers: {
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
    },
    popover: at && <SnapshotPopover target={target} at={at} />,
  };
}
