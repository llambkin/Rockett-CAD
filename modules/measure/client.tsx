import { useSyncExternalStore } from "react";
import {
  defineClientModule,
  type ClientContext,
  type Dispose,
  type MeasureResult,
  type PickRef,
} from "@rockett/plugin-api";

const MEASURE = "rockett.measure.run";
const PANEL = "rockett.measure.panel";
const KINDS: PickRef["kind"][] = ["face", "edge", "vertex"];
const MAX_PICKS = 2;

export interface MeasureState {
  picks: readonly PickRef[];
  result: MeasureResult | null;
  pending: boolean;
}

const IDLE: MeasureState = { picks: [], result: null, pending: false };
const listeners = new Set<() => void>();
let state = IDLE;

export const measureState = () => state;

function set(next: MeasureState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const measurable = (ref: PickRef) => KINDS.includes(ref.kind);

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="measure-row">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

const measurePanel = ({ ui }: ClientContext, done: () => void) =>
  function MeasurePanel() {
    const { picks, result } = useSyncExternalStore(subscribe, measureState);
    const length = ui.useFormatLength();
    const fmt = (v: number | undefined) => (v === undefined ? "-" : length(v));
    return (
      <ui.DraggablePanel id={PANEL} title="Measure" className="measure">
        <div className="dialog-body">
          {picks.length === 0 && (
            <div className="sel-info">
              <span>Select</span>
              <b>faces, edges or vertices (max 2)</b>
            </div>
          )}
          {result?.items.map((item, i) => (
            <div key={i} className="measure-block">
              <div className="measure-head">
                Selection {i + 1}: {item.kind}
              </div>
              {item.length !== undefined && (
                <Row k="Length" v={fmt(item.length)} />
              )}
              {item.area !== undefined && (
                <Row k="Area" v={length(item.area, 2)} />
              )}
              {item.radius !== undefined && (
                <Row k="Radius" v={fmt(item.radius)} />
              )}
              {item.diameter !== undefined && (
                <Row k="Diameter" v={fmt(item.diameter)} />
              )}
              {item.position && (
                <Row
                  k="Position"
                  v={item.position.map((x) => fmt(x)).join(", ")}
                />
              )}
            </div>
          ))}
          {result?.distance !== undefined && (
            <div className="measure-block main">
              <Row k="Distance" v={fmt(result.distance)} />
              <Row k="ΔX" v={fmt(result.deltaX)} />
              <Row k="ΔY" v={fmt(result.deltaY)} />
              <Row k="ΔZ" v={fmt(result.deltaZ)} />
              {result.angleDeg !== undefined && (
                <Row k="Angle" v={ui.formatAngle(result.angleDeg, 4)} />
              )}
            </div>
          )}
        </div>
        <ui.DialogFooter onCancel={done} cancelLabel="Done" />
      </ui.DraggablePanel>
    );
  };

function measureTool({ project, ui }: ClientContext) {
  let end: Dispose | null = null;

  function adopt(force = false) {
    if (!end) return;
    const picks = project.picks();
    if (picks === state.picks && !force) return;
    const kept = picks.filter(measurable).slice(0, MAX_PICKS);
    if (kept.length < picks.length) project.select(kept);
    else set({ picks, result: null, pending: false });
  }

  async function measure() {
    const { picks } = state;
    if (!end || picks.length === 0) return;
    const asked: MeasureState = { picks, result: null, pending: true };
    set(asked);
    try {
      const result = await project.measure(picks);
      if (state === asked) set({ picks, result, pending: false });
    } catch (error) {
      if (state !== asked) return;
      set({ picks, result: null, pending: false });
      ui.showError(error instanceof Error ? error.message : String(error));
    }
  }

  function start() {
    end = project.pick({
      command: MEASURE,
      kinds: KINDS,
      hint: "Select up to two faces / edges / vertices",
      onPick(ref) {
        if (!ref) return project.select([]);
        const { picks } = state;
        project.select(picks.length >= MAX_PICKS ? [ref] : [...picks, ref]);
        void measure();
      },
      onEnd() {
        end = null;
        set(IDLE);
        ui.closePanel(PANEL);
      },
    });
    adopt(true);
    ui.openPanel(PANEL);
    void measure();
  }

  return {
    adopt: () => adopt(),
    toggle: () => (end ? end() : start()),
    done: () => end?.(),
  };
}

export default defineClientModule({
  activate(context) {
    const { register, project } = context;
    const tool = measureTool(context);
    project.subscribe(tool.adopt);
    register.command({
      id: MEASURE,
      label: "Measure",
      group: "design.group.inspect",
      icon: "measure.svg",
      keys: ["I"],
      keyContext: "design",
      run: tool.toggle,
    });
    register.panel({
      id: PANEL,
      title: "Measure",
      when: (_state, open) => open.includes(PANEL),
      component: measurePanel(context, tool.done),
    });
  },
});
