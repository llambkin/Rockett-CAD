import { pushKeyContext } from "../commands/keymap";
import {
  Fragment,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { create } from "zustand";
import {
  createRegistry,
  SETTINGS,
  resolveSettings,
  sectionName,
  validateSettingValue,
  type SettingDefinition,
  type SettingScope,
} from "@rockett/shared";
import {
  resetSettings,
  retrySettingsLoad,
  setSetting,
  useSettings,
} from "../settings";
import { useSession } from "../session";
import { useStore } from "../store";
import { SelectField } from "./form/fields";
import {
  FieldControl,
  fieldKind,
  numberInputError,
  type FieldSchema,
} from "./SettingControl";
import { SettingsTransfer } from "./SettingsTransfer";
import { confirm } from "./ConfirmPanel";
import { ModulesPage } from "./ModulesPage";

const scopes: SettingScope[] = ["app", "user", "project"];

export interface SettingsPageEntry {
  id: string;
  section: string;
  title: string;
  component: ComponentType;
}

const pages = createRegistry<SettingsPageEntry>("settings page", (p) => p.id);

export const registerSettingsPage = pages.register;

registerSettingsPage({
  id: "modules",
  section: "app",
  title: "Modules",
  component: ModulesPage,
});

type SettingsAt = { section: string; page: string | null; opened: number };

const useSettingsAt = create<{ at: SettingsAt | null }>(() => ({ at: null }));

let opened = 0;

export function openSettings(at: { section?: string; page?: string } = {}) {
  const page = at.page === undefined ? undefined : pages.get(at.page);
  if (at.page !== undefined && !page)
    throw new Error(`settings page ${at.page} is not registered`);
  useSettingsAt.setState({
    at: {
      section: page?.section ?? at.section ?? "app",
      page: page?.id ?? null,
      opened: ++opened,
    },
  });
}

const closeSettings = () => useSettingsAt.setState({ at: null });

function label(section: string): string {
  const name = sectionName(section);
  if (name) return name;
  return section.startsWith("plugin:")
    ? section.slice(7).replace(/^./, (first) => first.toUpperCase())
    : section.replace(/^./, (first) => first.toUpperCase());
}

function FieldMessages({
  definition,
  scope,
  override,
  value,
  schema,
  error,
}: {
  definition: SettingDefinition;
  scope: SettingScope;
  override: boolean;
  value: unknown;
  schema: FieldSchema;
  error: string | null;
}) {
  const storedErrors = useSettings((state) => state.errors);
  return (
    <>
      {!definition.scopes.includes(scope) && (
        <span className="field-hint">Not set at the {label(scope)} layer.</span>
      )}
      {override && (
        <span className="field-hint">
          Project sets this to {String(value)}.
        </span>
      )}
      {schema.minimum !== undefined && schema.maximum !== undefined && (
        <span className="field-hint">
          {schema.minimum} to {schema.maximum}
        </span>
      )}
      {error && <span className="settings-error">{error}</span>}
      {storedErrors
        .filter((stored) => stored.key === definition.key)
        .map((stored) => (
          <span className="settings-warning" key={stored.scope}>
            Stored value ignored: {stored.message}.
          </span>
        ))}
    </>
  );
}

function SettingField({
  definition,
  scope,
  writable,
}: {
  definition: SettingDefinition;
  scope: SettingScope;
  writable: boolean;
}) {
  const layers = useSettings((state) => state.layers);
  const [error, setError] = useState<string | null>(null);
  const inScope = definition.scopes.includes(scope);
  const own = inScope && Object.hasOwn(layers[scope], definition.key);
  const visible = resolveSettings({
    app: layers.app,
    ...(scope !== "app" && { user: layers.user }),
    ...(scope === "project" && { project: layers.project }),
  }).values[definition.key] ?? { value: definition.default, source: "default" };
  const full = useSettings((state) => state.resolved[definition.key]);
  const override = scope === "app" && full?.source === "project";
  const schema = definition.schema as FieldSchema;
  const set = (next: unknown) => {
    const invalid = validateSettingValue(definition.key, scope, next);
    if (invalid) {
      setError(invalid.message);
      return;
    }
    setError(null);
    void setSetting(definition.key, next, scope).catch((cause: Error) =>
      setError(cause.message),
    );
  };
  return (
    <div className={`settings-entry ${error ? "invalid" : ""}`}>
      <div className="settings-field-row">
        <fieldset
          disabled={!writable || !inScope}
          onInputCapture={(event) => {
            const invalid = numberInputError(schema, event.target);
            if (invalid) setError(invalid);
          }}
        >
          <FieldControl
            definition={definition}
            value={visible.value}
            schema={schema}
            onChange={set}
          />
        </fieldset>
        <span className={`settings-source ${own ? "active" : ""}`}>
          [{visible.source}]
        </span>
        {own && writable && (
          <button
            onClick={() =>
              void resetSettings([definition.key], scope).catch(
                (cause: Error) => setError(cause.message),
              )
            }
          >
            {scope === "project" ? "Clear override" : "Reset"}
          </button>
        )}
        {!own && writable && inScope && scope === "project" && (
          <button onClick={() => set(visible.value)}>
            Override for this project
          </button>
        )}
      </div>
      <FieldMessages
        definition={definition}
        scope={scope}
        override={override}
        value={full?.value}
        schema={schema}
        error={error}
      />
    </div>
  );
}

function ResetSection({
  section,
  scope,
}: {
  section: string;
  scope: SettingScope;
}) {
  const loaded = useSettings((state) => state.loaded);
  const keys = pageOf(section)
    .filter((definition) => definition.scopes.includes(scope))
    .map((definition) => definition.key);
  if (!loaded.app || !loaded[scope] || keys.length === 0) return null;
  const reset = async () => {
    if (
      !(await confirm(
        `Reset every ${label(section)} setting at the ${label(scope)} layer?`,
      ))
    )
      return;
    void resetSettings(keys, scope).catch((error: Error) =>
      useStore.getState().setError(error.message),
    );
  };
  return <button onClick={reset}>Reset section</button>;
}

function PageContent({
  section,
  selected,
  page,
  available,
  setScope,
}: {
  section: string;
  selected: SettingScope;
  page: SettingDefinition[];
  available: SettingScope[];
  setScope: (scope: SettingScope) => void;
}) {
  const session = useSession();
  const loaded = useSettings((state) => state.loaded);
  const loadError = useSettings((state) => state.loadError);
  const projectOpen = useSettings((state) => state.projectOpen);
  const failedScope = loadError[selected] ? selected : "app";
  const failed = loadError[failedScope];
  return (
    <div className="dialog-body settings-content">
      <div className="settings-heading">
        <h2>{label(section)}</h2>
        {available.length > 0 && (
          <SelectField
            label="Editing"
            value={selected}
            options={available.map((candidate) => [
              candidate,
              label(candidate),
            ])}
            onChange={(next) => setScope(next as SettingScope)}
          />
        )}
        {available.includes(selected) && (
          <ResetSection section={section} scope={selected} />
        )}
      </div>
      {section === "project" && !projectOpen ? (
        <p>Open a project to change its settings.</p>
      ) : failed ? (
        <p>
          Settings did not load: {failed}.{" "}
          <button
            onClick={() =>
              void retrySettingsLoad(failedScope).catch((error: Error) =>
                useStore.getState().setError(error.message),
              )
            }
          >
            Retry
          </button>
        </p>
      ) : !loaded.app || !loaded[selected] ? (
        <p>Loading settings...</p>
      ) : page.length === 0 ? (
        <p>No settings in this section.</p>
      ) : (
        <>
          {section === "app" &&
            session.kind === "signed-in" &&
            session.user.role !== "admin" && (
              <p>Only an administrator can change app settings.</p>
            )}
          {page.map((definition) => (
            <SettingField
              key={definition.key}
              definition={definition}
              scope={selected}
              writable={available.includes(selected)}
            />
          ))}
          {section === "user" && session.kind === "signed-in" && (
            <SettingsTransfer />
          )}
        </>
      )}
    </div>
  );
}

function pageOf(section: string): SettingDefinition[] {
  return [...SETTINGS.values()].filter((definition) =>
    section === "project"
      ? definition.scopes.includes("project")
      : definition.section === section,
  );
}

function writableScopes(
  section: string,
  projectOpen: boolean,
  admin: boolean,
): SettingScope[] {
  return scopes.filter(
    (scope) =>
      pageOf(section).some((definition) => definition.scopes.includes(scope)) &&
      (scope !== "project" || (section === "project" && projectOpen)) &&
      (scope !== "app" || admin) &&
      (section !== "project" || scope === "project"),
  );
}

function CustomPage({ entry }: { entry: SettingsPageEntry }) {
  return (
    <div className="dialog-body settings-content">
      <div className="settings-heading">
        <h2>{entry.title}</h2>
      </div>
      <entry.component />
    </div>
  );
}

function SettingsNav({
  custom,
  section,
  shown,
  choose,
}: {
  custom: readonly SettingsPageEntry[];
  section: string;
  shown: SettingsPageEntry | undefined;
  choose: (section: string, page?: string) => void;
}) {
  const sections = new Set([
    "app",
    "user",
    "project",
    ...[...SETTINGS.values()].map((definition) => definition.section),
    ...custom.map((entry) => entry.section),
  ]);
  return (
    <nav aria-label="Settings sections">
      {[...sections].map((item) => {
        const children = custom.filter((entry) => entry.section === item);
        return (
          <Fragment key={item}>
            <button
              className={item === section && !shown ? "active" : ""}
              onClick={() => choose(item)}
            >
              {label(item)}
            </button>
            {children.length > 0 && (
              <div className="settings-entry tree-children">
                {children.map((entry) => (
                  <button
                    key={entry.id}
                    className={entry === shown ? "active" : ""}
                    onClick={() => choose(item, entry.id)}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export function SettingsPanel({
  onClose,
  section: initialSection = "app",
  page: initialPage = null,
}: {
  onClose: () => void;
  section?: string;
  page?: string | null;
}) {
  const custom = useSyncExternalStore(
    pages.subscribe,
    pages.snapshot,
    pages.snapshot,
  );
  const [section, setSection] = useState(initialSection);
  const [pageId, setPageId] = useState(initialPage);
  const shown = custom.find((entry) => entry.id === pageId);
  const [scope, setScope] = useState<SettingScope>("app");
  const session = useSession();
  const projectOpen = useSettings((state) => state.projectOpen);
  const page = pageOf(section).filter((definition) =>
    fieldKind(definition.schema as FieldSchema),
  );
  const admin = session.kind === "signed-in" && session.user.role === "admin";
  const available = writableScopes(section, projectOpen, admin);
  const selected = available.includes(scope)
    ? scope
    : (available.at(-1) ?? "app");
  const choose = (next: string, nextPage?: string) => {
    setSection(next);
    setPageId(nextPage ?? null);
    setScope(writableScopes(next, projectOpen, admin).at(-1) ?? "app");
  };
  useEffect(() => {
    return pushKeyContext({
      kind: "overlay",
      handle: (event) => {
        if (event.key !== "Escape") return false;
        if (!event.repeat) onClose();
        return true;
      },
    });
  }, [onClose]);
  return (
    <div
      className="dialog-panel settings-panel"
      role="dialog"
      aria-label="Settings"
    >
      <div className="dialog-title">
        <span>Settings</span>
        <button aria-label="Close settings" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="settings-layout">
        <SettingsNav
          custom={custom}
          section={section}
          shown={shown}
          choose={choose}
        />
        {shown ? (
          <CustomPage entry={shown} />
        ) : (
          <PageContent
            section={section}
            selected={selected}
            page={page}
            available={available}
            setScope={setScope}
          />
        )}
      </div>
    </div>
  );
}

export function SettingsButton() {
  const at = useSettingsAt((state) => state.at);
  return (
    <>
      <button
        className="icon-btn"
        aria-expanded={at !== null}
        onClick={() => (at ? closeSettings() : openSettings())}
      >
        Settings
      </button>
      {at && (
        <SettingsPanel
          key={at.opened}
          section={at.section}
          page={at.page}
          onClose={closeSettings}
        />
      )}
    </>
  );
}
