import {
  createElement as h,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  ClientContext,
  ModuleSettings,
  UserDataEntry,
} from "@rockett/plugin-api";

export type Library<T> = { items: T[]; etag: string | null };

export function libraryOf<T>(entry: UserDataEntry | null): Library<T> {
  if (entry?.readOnly)
    throw new Error("it was saved by a newer version of Rockett");
  return {
    items: (entry?.data as T[] | undefined) ?? [],
    etag: entry?.etag ?? null,
  };
}

type Menu = {
  onContextMenu?: (e: MouseEvent) => void;
  onClick?: () => void;
  selected?: boolean;
};

const marked = (className: string, selected?: boolean) =>
  selected ? `${className} selected` : className;

export const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const unqualified = (label: string) => `${label} (unqualified)`;

export const deleteQuestion = (name: string) =>
  `Delete ${name} from your library? Projects that use it keep their copy.`;

export const button = (
  text: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
) =>
  h(
    "button",
    { className: "btn", "aria-label": label, disabled, onClick },
    text,
  );

export const banner = (error: string | null) =>
  error && h("div", { className: "error-banner", role: "alert" }, error);

export const dimmed = (text: string) =>
  h("span", { className: "dimmed" }, text);

export const empty = (text: string) =>
  h("div", { className: "tree-empty" }, text);

export const row = (
  { key, name, selected, ...handlers }: { key: string; name: string } & Menu,
  ...rest: ReactNode[]
) =>
  h(
    "div",
    {
      key,
      className: marked("tree-item", selected),
      role: "listitem",
      ...handlers,
    },
    h("span", null, name),
    ...rest,
  );

export const tree = (
  {
    title,
    key = title,
    aside,
    selected,
    ...handlers
  }: { title: string; key?: string; aside?: ReactNode } & Menu,
  ...children: ReactNode[]
) =>
  h(
    "div",
    { key, className: "tree-section" },
    h(
      "div",
      { className: marked("tree-header", selected), ...handlers },
      title,
      aside && " ",
      aside,
    ),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": title },
      ...children,
    ),
  );

export function useStored<T>(
  request: ClientContext["request"],
  path: string,
  title: string,
) {
  const [library, setLibrary] = useState<Library<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    request<UserDataEntry | null>("GET", path)
      .then(libraryOf<T>)
      .then(setLibrary, (e) =>
        setError(`${title} did not load: ${reason(e)}.`),
      );
  }, []);
  return { library, setLibrary, error, setError };
}

export const placeholder = (
  plural: string,
  {
    library,
    error,
  }: { library: Library<unknown> | null; error: string | null },
  count = 0,
) =>
  !library
    ? !error && empty(`Loading ${plural}...`)
    : !count && empty(`No ${plural} yet.`);

export function useModuleSetting(settings: ModuleSettings, key: string) {
  const subscribe = useCallback(
    (onChange: () => void) => settings.subscribe(key, onChange),
    [settings, key],
  );
  return useSyncExternalStore(subscribe, () => settings.get(key));
}
