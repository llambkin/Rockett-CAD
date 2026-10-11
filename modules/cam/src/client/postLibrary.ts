import { createElement as h, Fragment, useState } from "react";
import type { ClientContext, UserDataEntry } from "@rockett/plugin-api";
import { POST_KIT_FILE, postKit } from "../post/kit.js";
import type { Post } from "../post/schema.js";
import { POSTS } from "../server/posts.js";
import { POST_MAX_BYTES } from "../shared/document.js";
import type { MachineProfile } from "../shared/machine.js";
import { defaultMachine } from "../shared/settings.js";
import {
  banner,
  button,
  deleteQuestion,
  dimmed,
  empty,
  libraryOf,
  reason,
  row,
  tree,
  unqualified,
  useStored,
} from "./libraryParts.js";
import { MACHINE_TEXTS } from "./ncDialog.js";
import { chosen, picker, type List } from "./opDialog.js";
import { machineSection, saved, useSection } from "./toolPanel.js";

const MACHINES_HERE = {
  ...MACHINE_TEXTS,
  empty: "No machines yet. Add one on the Machines page.",
};

const yesNo = (on: boolean, text: string) => (on ? [text] : []);

function capabilities({ capabilities: c, laser }: Post) {
  const list = [
    ...yesNo(c.arcs === true, "Arcs"),
    ...yesNo(c.arcs === "xy", "Arcs in XY only"),
    ...yesNo(c.cycles, "Drill cycles"),
    ...yesNo(c.toolChange, "Tool change"),
    ...yesNo(laser !== undefined, "Laser"),
  ];
  return list.length ? list.join(", ") : "None";
}

function units({ words }: Post) {
  const list = [
    ...yesNo(words.includes("G21"), "mm"),
    ...yesNo(words.includes("G20"), "inch"),
  ];
  return list.length ? list.join(", ") : "Not written";
}

const detail = (name: string, value: string) =>
  row({ key: name, name }, h("span", null, value));

function usedBy(post: Post, machines: MachineProfile[]) {
  const names = machines.filter((m) => m.post === post.id).map((m) => m.name);
  const list = new Intl.ListFormat("en-GB").format(names);
  if (names.length > 1) return ` ${list} use it as their default post.`;
  return names.length ? ` ${list} uses it as its default post.` : "";
}

function usePosts({ ui, request }: ClientContext) {
  const stored = useStored<Post>(request, "posts", "Posts");
  const { library, setLibrary, setError } = stored;
  const [pending, setPending] = useState(false);
  const save = async (
    failed: string,
    send: () => Promise<UserDataEntry | null>,
  ) => {
    setPending(true);
    try {
      const entry = await send();
      if (!entry) return;
      setLibrary(libraryOf<Post>(entry));
      setError(null);
    } catch (e) {
      setError(`${failed}: ${reason(e)}.`);
    } finally {
      setPending(false);
    }
  };
  const pick = () =>
    save("Post did not import", async () => {
      const file = await ui.pickFile({
        accept: ".json,application/json",
        maxBytes: POST_MAX_BYTES,
      });
      return (
        file &&
        request<UserDataEntry>("POST", "posts", {
          post: file.text,
          etag: library!.etag,
        })
      );
    });
  const remove = async (post: Post, machines: MachineProfile[]) => {
    if (await ui.confirm(deleteQuestion(post.label) + usedBy(post, machines)))
      await save("Post did not delete", () =>
        request<UserDataEntry>("PUT", "posts", {
          data: library!.items.filter((p) => p.id !== post.id),
          etag: library!.etag,
        }),
      );
  };
  return { stored, pending, pick, remove };
}

export function postsPage(context: ClientContext) {
  const { ui, settings } = context;
  return function PostsPage() {
    const posts = usePosts(context);
    const machines = useSection(context, machineSection([]));
    const [machineId, setMachineId] = useState("");
    const { library, error } = posts.stored;
    const items = machines.library?.items ?? [];
    const list: List<MachineProfile> = machines.library
      ? { status: "ready", items }
      : { status: "loading" };
    const machine = chosen(
      list,
      machineId || defaultMachine(settings, items)?.id || "",
    );
    const busy = posts.pending || machines.pending;
    const makeDefault = (target: MachineProfile, post: Post) =>
      void machines.write(saved(items, { ...target, post: post.id }));
    const card = (post: Post, own: boolean) => {
      const name = own ? unqualified(post.label) : post.label;
      const mark =
        machine &&
        (machine.post === post.id
          ? dimmed(`Default for ${machine.name}`)
          : button(
              "Make default",
              `Make ${post.label} the default post for ${machine.name}`,
              busy,
              () => makeDefault(machine, post),
            ));
      const remove =
        own &&
        button(
          "Delete",
          `Delete ${post.label}`,
          busy,
          () => void posts.remove(post, items),
        );
      return tree(
        {
          title: name,
          key: post.id,
          aside: h(Fragment, null, mark, remove),
        },
        detail("Id", post.id),
        detail("Units", units(post)),
        detail("Capabilities", capabilities(post)),
      );
    };
    const own = library?.items ?? [];
    return h(
      Fragment,
      null,
      banner(machines.error),
      (machines.library || !machines.error) &&
        picker(ui, "Machine", list, machine, setMachineId, MACHINES_HERE),
      [...POSTS.values()].map((post) => card(post, false)),
      banner(error),
      !library && !error && empty("Loading your posts..."),
      library && !own.length && empty("No posts of your own yet."),
      own.map((post) => card(post, true)),
      library &&
        button("Import post", "Import post", busy, () => void posts.pick()),
      button("Download post kit", "Download post kit", false, () =>
        ui.download({
          fileName: POST_KIT_FILE,
          data: postKit(),
          type: "text/markdown",
        }),
      ),
    );
  };
}
