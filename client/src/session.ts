import { create } from "zustand";
import type { User } from "@rockett/shared";
import { api, UnauthorizedError, watchUnauthorized } from "./api";
import { projectIdFromPath, showPath } from "./paths";
import { leaveBrowserProject } from "./browserSession";
import { useStore } from "./store";
import { clearSettings } from "./settings";

type Setup = Awaited<ReturnType<typeof api.authStatus>>["setup"];

export type Session =
  | { kind: "loading" }
  | { kind: "signed-out"; setup: Setup; returnProjectId: string | null }
  | { kind: "signed-in"; user: User };

export const useSession = create<Session>(() => ({ kind: "loading" }));

function returnProjectId(): string | null {
  const state = useSession.getState();
  return state.kind === "signed-out"
    ? state.returnProjectId
    : (useStore.getState().projectId ??
        projectIdFromPath(window.location.pathname));
}

watchUnauthorized(() => {
  clearSettings();
  useSession.setState(
    {
      kind: "signed-out",
      setup: "done",
      returnProjectId: returnProjectId(),
    },
    true,
  );
});

export async function bootSession(): Promise<void> {
  useSession.setState({ kind: "loading" }, true);
  try {
    const user = await api.me();
    useSession.setState({ kind: "signed-in", user }, true);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const { setup } = await api.authStatus();
    useSession.setState(
      {
        kind: "signed-out",
        setup,
        returnProjectId: returnProjectId(),
      },
      true,
    );
  }
}

export async function signIn(
  username: string,
  password: string,
): Promise<void> {
  const user = await api.login(username, password);
  if ("step" in user)
    throw new Error("This account needs a TOTP step this app cannot show yet.");
  const id = returnProjectId();
  useSession.setState({ kind: "signed-in", user }, true);
  if (id !== null) await useStore.getState().openProject(id);
}

export async function completeSetup(
  token: string,
  username: string,
  displayName: string,
  password: string,
): Promise<void> {
  await api.setup(token, username, displayName, password);
  await signIn(username, password);
}

export function confirmSignOut(): boolean {
  const { notSaved, recovery } = useStore.getState();
  return (
    (!notSaved && !recovery) ||
    window.confirm("Your unsaved change will be lost. Sign out?")
  );
}

export function endSession(): void {
  leaveBrowserProject();
  useStore.getState().closeProject();
  useStore.setState(useStore.getInitialState(), true);
  clearSettings();
  showPath("/");
  useSession.setState(
    { kind: "signed-out", setup: "done", returnProjectId: null },
    true,
  );
}

export async function signOut(): Promise<void> {
  if (!confirmSignOut()) return;
  try {
    await api.logout();
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
  }
  endSession();
}
