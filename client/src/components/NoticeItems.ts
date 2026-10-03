import { useCallback, useEffect, useRef, useState } from "react";
import type { Notice } from "@rockett/shared";
import { noticesApi } from "../noticesApi";
import { useStore } from "../store";
import { folderPath, showPath } from "../paths";
import { backToProjects } from "../projectNavigation";
import type { MenuItem } from "./ContextMenu";

type State = "loading" | "ready" | "error";

export function useNoticeItems(
  userId: string | null,
  onError: (error: string) => void,
) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [state, setState] = useState<State>("loading");
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (!userId) return;
    const version = ++requestVersion.current;
    try {
      const { items } = await noticesApi.list();
      if (version !== requestVersion.current) return;
      if (!Array.isArray(items)) throw new Error("Invalid notices");
      setNotices(items);
      setState("ready");
    } catch {
      if (version !== requestVersion.current) return;
      setState("error");
    }
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    requestVersion.current++;
    setNotices([]);
    setState("loading");
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      requestVersion.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [userId, refresh]);
  const answer = async (id: string, accept: boolean) => {
    try {
      await noticesApi.answer(id, accept);
      await refresh();
    } catch (error) {
      onError((error as Error).message);
    }
  };
  const open = async (
    notice: Extract<Notice, { kind: "project" | "folder" }>,
  ) => {
    try {
      if (notice.kind === "folder") {
        if (useStore.getState().projectId !== null) {
          await backToProjects();
          if (useStore.getState().projectId !== null) return;
        }
        await noticesApi.openFolder(notice.id);
        showPath(folderPath(notice.id));
        window.dispatchEvent(new PopStateEvent("popstate"));
        await refresh();
        return;
      }
      await useStore.getState().openProject(notice.id);
      if (useStore.getState().projectId !== notice.id) return;
      await noticesApi.openProject(notice.id);
      await refresh();
    } catch (error) {
      onError((error as Error).message);
    }
  };
  return {
    count: notices.length,
    items: noticeItems(state, notices, refresh, answer, open),
  };
}

function noticeItems(
  state: State,
  notices: Notice[],
  refresh: () => Promise<void>,
  answer: (id: string, accept: boolean) => Promise<void>,
  open: (
    notice: Extract<Notice, { kind: "project" | "folder" }>,
  ) => Promise<void>,
): MenuItem[] {
  if (state === "loading")
    return [{ label: "Loading notices…", disabled: true }];
  if (state === "error")
    return [
      { label: "Could not load notices", disabled: true },
      { label: "Retry notices", action: () => void refresh() },
    ];
  if (notices.length === 0) return [{ label: "No notices", disabled: true }];
  return notices.flatMap((notice): MenuItem[] =>
    notice.kind === "friend"
      ? [
          {
            label: `${notice.from.displayName} sent a friend request`,
            disabled: true,
          },
          {
            label: `Accept ${notice.from.displayName}`,
            action: () => void answer(notice.id, true),
          },
          {
            label: `Reject ${notice.from.displayName}`,
            action: () => void answer(notice.id, false),
          },
        ]
      : [{ label: `Open ${notice.name}`, action: () => void open(notice) }],
  );
}
