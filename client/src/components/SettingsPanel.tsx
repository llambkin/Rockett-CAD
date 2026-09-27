import { useEffect, useState } from "react";
import {
  SETTINGS,
  resolveSettings,
  validateSettingValue,
  type SettingDefinition,
  type SettingScope,
} from "@rockett/shared";
import {
  resetSetting,
  retrySettingsLoad,
  setSetting,
  useSettings,
} from "../settings";
import { useSession } from "../session";
import { useStore } from "../store";
import { CheckField, NumField, SelectField } from "./form/fields";

const scopes: SettingScope[] = ["app", "user", "project"];

function label(section: string): string {
  return section.startsWith("plugin:")
    ? section.slice(7).replace(/^./, (first) => first.toUpperCase())
    : section.replace(/^./, (first) => first.toUpperCase());
}

type FieldSchema = {
  type?: string;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
};

function numberInputError(
  schema: FieldSchema,
  target: EventTarget,
): string | null {
  if (
    !(target instanceof HTMLInputElement) ||
    target.type !== "number" ||
    (target.validity.valid && target.value !== "")
  )
    return null;
  return `Enter a number from ${schema.minimum ?? "-∞"} to ${schema.maximum ?? "∞"}.`;
}

function FieldControl({
  definition,
  value,
  schema,
  onChange,
}: {
  definition: SettingDefinition;
  value: unknown;
  schema: FieldSchema;
  onChange: (value: unknown) => void;
}) {
  const choices = schema.enum?.filter(
    (item): item is string => typeof item === "string",
  );
  if (choices)
    return (
      <SelectField
        label={definition.label}
        value={String(value)}
        options={choices.map((choice) => [choice, choice])}
        onChange={onChange}
      />
    );
  if (schema.type === "boolean")
    return (
      <CheckField
        label={definition.label}
        value={Boolean(value)}
        onChange={onChange}
      />
    );
  if (schema.type === "number" || schema.type === "integer")
    return (
      <NumField
        label={definition.label}
        value={Number(value)}
        onChange={onChange}
        min={schema.minimum}
        max={schema.maximum}
        int={schema.type === "integer"}
      />
    );
  return (
    <label className="field">
      <span>{definition.label}</span>
      {schema.pattern?.includes("#") && (
        <input
          type="color"
          value={String(value)}
          aria-label={`${definition.label} swatch`}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <input
        type="text"
        value={String(value)}
        aria-label={definition.label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
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
  const own =
    inScope &&
    scope !== "user" &&
    Object.hasOwn(
      layers[scope === "project" ? "project" : "app"],
      definition.key,
    );
  const visible = resolveSettings({
    app: layers.app,
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
              void resetSetting(definition.key, scope).catch((cause: Error) =>
                setError(cause.message),
              )
            }
          >
            Reset
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
  const failed = selected === "project" ? loadError.project : loadError.app;
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
      </div>
      {section === "project" && !projectOpen ? (
        <p>Open a project to change its settings.</p>
      ) : failed ? (
        <p>
          Settings did not load: {failed}.{" "}
          <button
            onClick={() =>
              void retrySettingsLoad(
                selected === "project" ? "project" : "app",
              ).catch((error: Error) =>
                useStore.getState().setError(error.message),
              )
            }
          >
            Retry
          </button>
        </p>
      ) : !loaded.app || (selected === "project" && !loaded.project) ? (
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
        </>
      )}
    </div>
  );
}

function writableScopes(
  definitions: SettingDefinition[],
  projectOpen: boolean,
  admin: boolean,
): SettingScope[] {
  return scopes.filter(
    (scope) =>
      definitions.some((definition) => definition.scopes.includes(scope)) &&
      (scope !== "project" || projectOpen) &&
      (scope !== "app" || admin) &&
      scope !== "user",
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const definitions = [...SETTINGS.values()];
  const sections = [
    ...new Set([
      "app",
      "user",
      "project",
      ...definitions.map((definition) => definition.section),
    ]),
  ];
  const [section, setSection] = useState("app");
  const [scope, setScope] = useState<SettingScope>("app");
  const session = useSession();
  const projectOpen = useSettings((state) => state.projectOpen);
  const page = definitions.filter(
    (definition) => definition.section === section,
  );
  const admin = session.kind === "signed-in" && session.user.role === "admin";
  const available = writableScopes(page, projectOpen, admin);
  const selected = available.includes(scope)
    ? scope
    : (available.at(-1) ?? "app");
  const choose = (next: string) => {
    setSection(next);
    const nextPage = definitions.filter(
      (definition) => definition.section === next,
    );
    setScope(writableScopes(nextPage, projectOpen, admin).at(-1) ?? "app");
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
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
        <nav aria-label="Settings sections">
          {sections.map((item) => (
            <button
              key={item}
              className={item === section ? "active" : ""}
              onClick={() => choose(item)}
            >
              {label(item)}
            </button>
          ))}
        </nav>
        <PageContent
          section={section}
          selected={selected}
          page={page}
          available={available}
          setScope={setScope}
        />
      </div>
    </div>
  );
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="icon-btn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Settings
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}
