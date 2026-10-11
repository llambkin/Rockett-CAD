import {
  createElement as h,
  Fragment,
  useState,
  useSyncExternalStore,
} from "react";
import { Type } from "typebox";
import type { ClientContext, UserDataEntry } from "@rockett/plugin-api";
import type { Post } from "../post/schema.js";
import { POSTS } from "../server/posts.js";
import {
  ncRoute,
  type Blocker,
  type NcExport,
  type PostCopy,
} from "../shared/document.js";
import { machineSchema, type MachineProfile } from "../shared/machine.js";
import { defaultMachine } from "../shared/settings.js";
import { generateOperation } from "./browser.js";
import {
  banner,
  button,
  libraryOf,
  reason,
  row,
  tree,
  unqualified,
} from "./libraryParts.js";
import {
  chosen,
  picker,
  SETUP_TEXTS,
  setupList,
  useLibrary,
  type List,
} from "./opDialog.js";
import { schemaFields } from "./schemaForm.js";
import { editCam } from "./setup.js";

export const NC_PANEL = "rockett.cam.nc.dialog";

export const MACHINE_TEXTS = {
  loading: "Loading machines...",
  empty: "No machines yet. Add one in Settings, CAM, Machines.",
  failed: "Machines did not load",
};

const POST_CHOICES = [...POSTS.values()].map(
  ({ id, label }): [string, string] => [id, label],
);

const postOptions = Type.Pick(machineSchema, ["toolChange"]);

type Ui = ClientContext["ui"];
type ToolChange = MachineProfile["toolChange"];
type Choice = { postId?: string; toolChange?: ToolChange; off: string[] };
type Run = { pending: boolean; error: string; blocked: Blocker[] };
type Blocked = Extract<Blocker, { kind: "operation" }>;
type File = Extract<NcExport, { fileName: string }>;
type Setups = ReturnType<typeof setupList>;
type Setup = Extract<Setups, { status: "ready" }>["items"][number];

function save(ui: Ui, out: File) {
  if ("nc" in out)
    return ui.download({
      fileName: out.fileName,
      data: out.nc,
      type: "text/plain",
    });
  const bytes = Uint8Array.from(atob(out.zip), (c) => c.charCodeAt(0));
  ui.download({ fileName: out.fileName, data: bytes, type: "application/zip" });
}

const blockerText = (blocker: Blocker) =>
  blocker.kind === "check"
    ? blocker.reason
    : `${blocker.name}: ${blocker.reason ?? blocker.status}`;

function blockedList(
  blocked: Blocker[],
  pending: boolean,
  generate: (blocker: Blocked) => void,
) {
  if (!blocked.length) return null;
  return tree(
    { title: "Export blocked" },
    ...blocked.map((blocker, i) =>
      row(
        { key: `${i}`, name: blockerText(blocker) },
        blocker.kind === "operation" &&
          button("Generate first", `Generate ${blocker.name}`, pending, () =>
            generate(blocker),
          ),
      ),
    ),
  );
}

function setupChecks(
  ui: Ui,
  setups: Setups,
  off: string[],
  turn: (id: string, on: boolean) => void,
) {
  if (setups.status === "failed")
    return banner(`${SETUP_TEXTS.failed}: ${setups.reason}.`);
  if (setups.status === "loading") return null;
  if (!setups.items.length)
    return h("span", { className: "field-hint" }, SETUP_TEXTS.empty);
  return setups.items.map(({ id, name }) =>
    h(ui.CheckField, {
      key: id,
      label: name ?? id,
      value: !off.includes(id),
      onChange: (on: boolean) => turn(id, on),
    }),
  );
}

export function postChoices(own: Post[], picked: Setup[], postId: string) {
  const copies = picked.flatMap(({ post }) => (post ? [post as PostCopy] : []));
  const others = [...own, ...copies].filter(
    ({ id }, i, all) =>
      !POSTS.has(id) && all.findIndex((each) => each.id === id) === i,
  );
  const options: [string, string][] = [
    ...POST_CHOICES,
    ...others.map(({ id, label }): [string, string] => [
      id,
      unqualified(label),
    ]),
  ];
  const mine = (each: Post) => each.id === postId;
  return {
    options,
    post: POSTS.get(postId) ?? others.find(mine),
    library: POSTS.has(postId) ? undefined : own.find(mine),
  };
}

async function copyPost(
  { project, request }: Pick<ClientContext, "project" | "request">,
  postId: string,
  picked: Setup[],
) {
  const stored = await request<UserDataEntry | null>("GET", "posts");
  const post = libraryOf<Post>(stored).items.find(({ id }) => id === postId);
  if (!post) return;
  const copy = { ...post, libraryRef: { id: post.id } };
  const text = JSON.stringify(copy);
  const stale = new Set(
    picked
      .filter((setup) => JSON.stringify(setup.post) !== text)
      .map(({ id }) => id),
  );
  if (!stale.size) return;
  await editCam(project, (data) => ({
    ...data,
    setups: data.setups.map((setup) =>
      stale.has(setup.id) ? { ...setup, post: copy } : setup,
    ),
  }));
}

function postFields(
  ui: Ui,
  options: [string, string][],
  postId: string,
  post: Post | undefined,
  toolChange: ToolChange,
  setChoice: (change: (now: Choice) => Choice) => void,
) {
  return h(
    Fragment,
    null,
    h(ui.SelectField<string>, {
      label: "Post",
      value: postId,
      options,
      onChange: (id: string) => setChoice((now) => ({ ...now, postId: id })),
    }),
    post?.capabilities.toolChange &&
      schemaFields(ui, postOptions, { toolChange }, (next) =>
        setChoice((now) => ({ ...now, toolChange: next.toolChange })),
      ),
  );
}

export const lostPost = (machine: MachineProfile | undefined, lost: boolean) =>
  machine &&
  lost &&
  h(
    "span",
    { className: "field-hint" },
    `${machine.name}'s default post is gone. Pick a post.`,
  );

function machineList(
  library: List<MachineProfile>,
  picked: Setup[],
): List<MachineProfile> {
  if (library.status !== "ready") return library;
  const items = new Map(library.items.map((item) => [item.id, item]));
  for (const { machine } of picked) if (machine) items.set(machine.id, machine);
  return { status: "ready", items: [...items.values()] };
}

function starting(
  settings: ClientContext["settings"],
  ours: List<MachineProfile>,
  picked: Setup[],
  machineId: string,
) {
  const stored = picked.find(({ machine, postId }) => machine || postId);
  const fallback =
    ours.status === "ready" ? defaultMachine(settings, ours.items)?.id : "";
  const machines = machineList(ours, picked);
  const machine = chosen(
    machines,
    machineId || stored?.machine?.id || fallback || "",
  );
  const postId = (machineId ? undefined : stored?.postId) ?? machine?.post;
  return { machines, machine, postId: postId ?? "" };
}

function useRun() {
  const [run, setRun] = useState<Run>({
    pending: false,
    error: "",
    blocked: [],
  });
  const act = async (
    work: () => Promise<Blocker[] | undefined>,
    failed: string,
  ) => {
    setRun((now) => ({ ...now, pending: true, error: "" }));
    try {
      const blocked = await work();
      setRun((now) => ({
        pending: false,
        error: "",
        blocked: blocked ?? now.blocked,
      }));
    } catch (e) {
      setRun((now) => ({
        ...now,
        pending: false,
        error: `${failed}: ${reason(e)}.`,
      }));
    }
  };
  return { run, act };
}

export function ncDialog({ ui, project, request, settings }: ClientContext) {
  const close = () => ui.closePanel(NC_PANEL);
  return function NcDialog() {
    const open = useSyncExternalStore(project.subscribe, project.get);
    const ours = useLibrary<MachineProfile>(request, "machines");
    const posts = useLibrary<Post>(request, "posts");
    const [machineId, setMachineId] = useState("");
    const [choice, setChoice] = useState<Choice>({ off: [] });
    const { run, act } = useRun();
    const setups = setupList(open);
    const picked =
      setups.status === "ready"
        ? setups.items.filter(({ id }) => !choice.off.includes(id))
        : [];
    const start = starting(settings, ours, picked, machineId);
    const { machines, machine } = start;
    const postId = choice.postId ?? start.postId;
    const own = posts.status === "ready" ? posts.items : [];
    const { options, post, library } = postChoices(own, picked, postId);
    const toolChange = post?.capabilities.toolChange
      ? (choice.toolChange ?? machine?.toolChange ?? "perFile")
      : "perFile";
    const exportNc = () =>
      act(async () => {
        if (!machine) return undefined;
        if (library) await copyPost({ project, request }, postId, picked);
        const out = await project.read(ncRoute, {
          machineId: machine.id,
          postId,
          toolChange,
          setupIds: picked.map(({ id }) => id).join(","),
        });
        if ("reason" in out) throw new Error(out.reason);
        if ("blocked" in out) return out.blocked;
        save(ui, out);
        close();
        return [];
      }, "NC program did not export");
    const generate = (blocker: Blocked) =>
      act(async () => {
        await generateOperation(project, blocker.setupId, blocker.operationId);
        return run.blocked.filter((each) => each !== blocker);
      }, `${blocker.name} did not generate`);
    const pickMachine = (id: string) => {
      setMachineId(id);
      setChoice(({ postId: _post, ...now }) => now);
    };
    const turn = (id: string, on: boolean) =>
      setChoice((now) => ({
        ...now,
        off: on ? now.off.filter((each) => each !== id) : [...now.off, id],
      }));
    const body = h(
      "div",
      { className: "dialog-body" },
      banner(run.error || null),
      setupChecks(ui, setups, choice.off, turn),
      picker(ui, "Machine", machines, machine, pickMachine, MACHINE_TEXTS),
      machine && postFields(ui, options, postId, post, toolChange, setChoice),
      blockedList(
        run.blocked,
        run.pending,
        (blocker) => void generate(blocker),
      ),
      lostPost(machine, !post && posts.status === "ready"),
    );
    const footer = h(ui.DialogFooter, {
      onOk: () => void exportNc(),
      onCancel: close,
      pending: run.pending,
      okLabel: "Export",
      okDisabled: !(machine && post && picked.length) || run.pending,
    });
    return h(ui.DraggablePanel, {
      title: "NC Program",
      children: h(Fragment, null, body, footer),
    });
  };
}
