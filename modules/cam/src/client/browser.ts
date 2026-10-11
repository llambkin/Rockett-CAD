import {
  createElement as h,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  ClientContext,
  ContextMenuItem,
  OpenProject,
  ProjectView,
  UserDataEntry,
} from "@rockett/plugin-api";
import {
  generateRoute,
  generateStaleRoute,
  programRoute,
  statusRoute,
  type CamData,
  type OperationStatus,
} from "../shared/document.js";
import type { MachineProfile } from "../shared/machine.js";
import { defaultMachine } from "../shared/settings.js";
import {
  byAcceleration,
  estimateTime,
  type SectionTime,
} from "../shared/time.js";
import {
  banner,
  dimmed,
  empty,
  libraryOf,
  reason,
  row,
  tree,
} from "./libraryParts.js";
import { dialogPanel, OPERATION_DIALOGS } from "./opDialog.js";
import { PLAN_PANEL } from "./planDialog.js";
import { camRead, editCam, withOperations } from "./setup.js";
import type { Selection, ToolpathPreview } from "./toolpaths.js";

type Setup = CamData["setups"][number];
type Operation = NonNullable<Setup["operations"]>[number];
type Step = -1 | 1;
type Statuses = Record<string, Record<string, OperationStatus>>;
type OperationTime = { seconds: number; acceleration: boolean };
export type SetupTime = {
  seconds?: number;
  operations: Record<string, OperationTime>;
};
type Times = Record<string, SetupTime>;
type Read =
  | { projectId: string; statuses: Statuses; times: Times }
  | { projectId: string; error: string };

export const generateOperation = (
  view: ProjectView,
  setupId: string,
  operationId: string,
) => view.mutate(generateRoute, { setupId, operationId });

export const generateStale = (view: ProjectView) =>
  view.mutate(generateStaleRoute, {});

function moved<T extends { id: string }>(
  list: readonly T[],
  id: string,
  by: Step,
  what: string,
): T[] {
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) throw new Error(`${what} ${id} is not in this project`);
  const to = from + by;
  if (to < 0 || to >= list.length)
    throw new Error(`${what} ${id} cannot move ${by < 0 ? "up" : "down"}`);
  const next = list.filter((item) => item.id !== id);
  next.splice(to, 0, list[from]!);
  return next;
}

export const moveSetup = (view: ProjectView, setupId: string, by: Step) =>
  editCam(view, (data) => ({
    ...data,
    setups: moved(data.setups, setupId, by, "setup"),
  }));

export const moveOperation = (
  view: ProjectView,
  setupId: string,
  operationId: string,
  by: Step,
) =>
  editCam(view, (data) =>
    withOperations(data, setupId, (operations) =>
      moved(operations, operationId, by, "operation"),
    ),
  );

export const toggleSuppressed = (
  view: ProjectView,
  setupId: string,
  operationId: string,
) =>
  editCam(view, (data) =>
    withOperations(data, setupId, (operations) =>
      operations.map((op) => {
        if (op.id !== operationId) return op;
        const { suppressed, ...rest } = op;
        return suppressed ? rest : { ...rest, suppressed: true };
      }),
    ),
  );

const BADGES: Record<OperationStatus["status"], [string, string]> = {
  fresh: ["tl-chip", "fresh"],
  stale: ["tl-chip tl-warn", "stale"],
  never: ["tl-chip dimmed", "never"],
  error: ["tl-chip error", "error"],
  missingReference: ["tl-chip error", "missing reference"],
  suppressed: ["tl-chip suppressed", "suppressed"],
};

const ACCELERATION = "Acceleration, not feed, sets this time";

function timed(time: OperationTime | undefined) {
  if (!time) return null;
  const { seconds, acceleration } = time;
  return h(
    "span",
    { className: "dimmed", title: acceleration ? ACCELERATION : undefined },
    acceleration ? `${clock(seconds)} a` : clock(seconds),
  );
}

function badge(status: OperationStatus | undefined) {
  if (!status) return null;
  const [className, text] = BADGES[status.status];
  const title = "reason" in status ? status.reason : undefined;
  return h("span", { className, title }, text);
}

const readStatuses = async (
  project: ProjectView,
  setups: Setup[],
): Promise<Statuses> =>
  Object.fromEntries(
    await Promise.all(
      setups.map(
        async ({ id }) =>
          [id, await project.read(statusRoute, { setupId: id })] as const,
      ),
    ),
  );

export const clock = (seconds: number) => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const summed = (parts: SectionTime[]) =>
  parts.reduce(
    (sum, part) => ({
      seconds: sum.seconds + part.seconds,
      motion: sum.motion + part.motion,
      cruise: sum.cruise + part.cruise,
    }),
    { seconds: 0, motion: 0, cruise: 0 },
  );

async function setupTime(
  project: ProjectView,
  setup: Setup,
  statuses: Record<string, OperationStatus>,
  machine: MachineProfile,
): Promise<SetupTime> {
  const live = (setup.operations ?? []).filter((op) => !op.suppressed);
  const reads = await Promise.all(
    live
      .filter(({ id }) => statuses[id]?.status === "fresh")
      .map(async ({ id }) => ({
        id,
        read: await project.read(programRoute, {
          setupId: setup.id,
          operationId: id,
        }),
      })),
  );
  const programs = reads.flatMap(({ id, read }) =>
    "program" in read ? [{ id, sections: read.program.sections }] : [],
  );
  const estimate = estimateTime(
    { sections: programs.flatMap(({ sections }) => sections) },
    machine,
  );
  let next = 0;
  const operations = Object.fromEntries(
    programs.map(({ id, sections }) => {
      const sum = summed(
        estimate.sections.slice(next, (next += sections.length)),
      );
      return [id, { seconds: sum.seconds, acceleration: byAcceleration(sum) }];
    }),
  );
  const whole = live.length > 0 && programs.length === live.length;
  return whole ? { seconds: estimate.seconds, operations } : { operations };
}

export function setupTimes(
  project: ProjectView,
  { request, settings }: Pick<ClientContext, "request" | "settings">,
) {
  let kept = new Map<string, { key: string; time: SetupTime }>();
  return async (setups: Setup[], statuses: Statuses): Promise<Times> => {
    const machines = await request<UserDataEntry | null>("GET", "machines")
      .then(libraryOf<MachineProfile>)
      .catch(() => null);
    const machine = defaultMachine(settings, machines?.items ?? []);
    if (!machine) return {};
    const next = new Map<string, { key: string; time: SetupTime }>();
    await Promise.all(
      setups.map(async (setup) => {
        const key = JSON.stringify([
          machine,
          (setup.operations ?? []).map((op) => [
            op.id,
            op.suppressed ?? false,
            op.lastGenerated?.fingerprint ?? null,
            statuses[setup.id]?.[op.id]?.status ?? null,
          ]),
        ]);
        const old = kept.get(setup.id);
        const time =
          old?.key === key
            ? old.time
            : await setupTime(
                project,
                setup,
                statuses[setup.id] ?? {},
                machine,
              ).catch(() => null);
        if (time) next.set(setup.id, { key, time });
      }),
    );
    kept = next;
    return Object.fromEntries(
      [...next].map(([id, { time }]) => [id, time] as const),
    );
  };
}

type TimeReader = ReturnType<typeof setupTimes>;

function useStatuses(
  project: ProjectView,
  open: OpenProject,
  readTimes: TimeReader,
) {
  const [read, setRead] = useState<Read | null>(null);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    const { projectId } = open;
    const cam = camRead(open);
    if (!projectId || cam.status !== "ready") return;
    let live = true;
    const { setups } = cam.data;
    void readStatuses(project, setups).then(
      async (statuses) => {
        const times = await readTimes(setups, statuses);
        if (live) setRead({ projectId, statuses, times });
      },
      (e: unknown) => live && setRead({ projectId, error: reason(e) }),
    );
    return () => {
      live = false;
    };
  }, [project, open, readTimes, retries]);
  return {
    current: read?.projectId === open.projectId ? read : null,
    retry: () => setRetries((n) => n + 1),
  };
}

type Rows = {
  project: ProjectView;
  preview: ToolpathPreview;
  selection: Selection;
  statuses: Statuses;
  times: Times;
  staleItems: ContextMenuItem[];
  open(setupId: string, panel: string): void;
  act(action: () => Promise<void>): () => void;
  opener(items: ContextMenuItem[]): (e: MouseEvent) => void;
};

const moves = (
  { act }: Rows,
  count: number,
  index: number,
  move: (by: Step) => Promise<void>,
): ContextMenuItem[] => [
  ...(index > 0 ? [{ label: "Move up", action: act(() => move(-1)) }] : []),
  ...(index < count - 1
    ? [{ label: "Move down", action: act(() => move(1)) }]
    : []),
];

function operationItems(
  rows: Rows,
  setup: Setup,
  op: Operation,
  index: number,
) {
  const { project, act, staleItems } = rows;
  const generate: ContextMenuItem = {
    label: "Generate",
    action: act(() => generateOperation(project, setup.id, op.id)),
  };
  return [
    ...(op.suppressed ? [] : [generate]),
    ...staleItems,
    ...moves(rows, setup.operations?.length ?? 0, index, (by) =>
      moveOperation(project, setup.id, op.id, by),
    ),
    {
      label: op.suppressed ? "Unsuppress" : "Suppress",
      action: act(() => toggleSuppressed(project, setup.id, op.id)),
    },
  ];
}

const operationRow = (rows: Rows, setup: Setup, op: Operation, index: number) =>
  row(
    {
      key: op.id,
      name: `${index + 1} ${op.name ?? op.id}`,
      selected:
        rows.selection?.setupId === setup.id &&
        rows.selection.operationId === op.id,
      onClick: () =>
        void rows.preview.select({ setupId: setup.id, operationId: op.id }),
      onContextMenu: rows.opener(operationItems(rows, setup, op, index)),
    },
    badge(rows.statuses[setup.id]?.[op.id]),
    timed(rows.times[setup.id]?.operations[op.id]),
  );

function setupSection(rows: Rows, setup: Setup, index: number, count: number) {
  const operations = setup.operations ?? [];
  const items = [
    ...rows.staleItems,
    {
      label: "Plan operations",
      action: () => rows.open(setup.id, PLAN_PANEL),
    },
    ...OPERATION_DIALOGS.filter(({ toolbar }) => !toolbar).map((op) => ({
      label: `Add ${op.label.toLowerCase()}`,
      action: () => rows.open(setup.id, dialogPanel(op)),
    })),
    ...moves(rows, count, index, (by) => moveSetup(rows.project, setup.id, by)),
  ];
  const seconds = rows.times[setup.id]?.seconds;
  return tree(
    {
      title: setup.name ?? setup.id,
      key: setup.id,
      aside: seconds !== undefined && dimmed(clock(seconds)),
      selected:
        rows.selection?.setupId === setup.id && !rows.selection.operationId,
      onClick: () => void rows.preview.select({ setupId: setup.id }),
      onContextMenu: rows.opener(items),
    },
    operations.length
      ? operations.map((op, i) => operationRow(rows, setup, op, i))
      : empty("No operations yet."),
  );
}

export function manufactureBrowser(
  { project, ui, request, settings }: ClientContext,
  preview: ToolpathPreview,
) {
  const readTimes = setupTimes(project, { request, settings });
  return function ManufactureBrowser() {
    const open = useSyncExternalStore(project.subscribe, project.get);
    const { selection } = useSyncExternalStore(preview.subscribe, preview.get);
    const { current, retry } = useStatuses(project, open, readTimes);
    const [error, setError] = useState<string | null>(null);
    const [menu, setMenu] = useState<{
      x: number;
      y: number;
      items: ContextMenuItem[];
    } | null>(null);

    const act = (action: () => Promise<void>) => () => {
      setError(null);
      action().catch((e: unknown) => {
        setError(reason(e));
        retry();
      });
    };
    const statuses = current && "statuses" in current ? current.statuses : {};
    const times = current && "times" in current ? current.times : {};
    const anyStale = Object.values(statuses).some((ops) =>
      Object.values(ops).some(({ status }) => status === "stale"),
    );
    const rows: Rows = {
      project,
      preview,
      selection,
      statuses,
      times,
      act,
      staleItems: anyStale
        ? [
            {
              label: "Generate all stale",
              action: act(() => generateStale(project)),
            },
          ]
        : [],
      open(setupId, panel) {
        void preview.select({ setupId });
        ui.openPanel(panel);
      },
      opener: (items) => (e) => {
        e.preventDefault();
        if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
      },
    };

    const cam = camRead(open);
    const body = (): ReactNode => {
      if (!open.document) return empty("Loading setups...");
      if (cam.status === "kept")
        return banner(`Setups did not load: ${cam.reason}.`);
      if (current && "error" in current)
        return banner(`Setups did not load: ${current.error}.`);
      const { setups } = cam.data;
      if (!setups.length) return empty("No setups yet.");
      if (!current) return empty("Loading setups...");
      return setups.map((setup, i) =>
        setupSection(rows, setup, i, setups.length),
      );
    };

    return h(
      "div",
      { className: "model-tree" },
      h("div", { className: "tree-doc" }, "Manufacture"),
      banner(error),
      body(),
      menu && h(ui.ContextMenu, { ...menu, onClose: () => setMenu(null) }),
    );
  };
}
