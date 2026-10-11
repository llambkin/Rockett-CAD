import { useRef, useState } from "react";
import {
  ROUTES,
  SETTINGS_IMPORT_MAX_BYTES,
  type LayerValues,
} from "@rockett/shared";
import { saveDownload, send } from "../api";
import { readTextFile } from "../download";
import { loadUserSettings, useSettings } from "../settings";
import { useStore } from "../store";
import { confirm } from "./ConfirmPanel";

const FORMAT = "rockett-settings";
const VERSION = 1;
const NOT_SETTINGS = "This is not a Rockett settings file.";

type Outcome =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "unchanged" }
  | { kind: "failed"; message: string }
  | {
      kind: "imported";
      applied: string[];
      rejected: { key: string; reason: string }[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readSettingsFile(file: File): Promise<LayerValues> {
  const text = await readTextFile(
    file,
    SETTINGS_IMPORT_MAX_BYTES,
    "settings file",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not JSON.");
  }
  if (!isRecord(parsed) || parsed.format !== FORMAT)
    throw new Error(NOT_SETTINGS);
  if (parsed.version !== VERSION)
    throw new Error(
      `Settings file version ${String(parsed.version)} is not supported; this app reads version ${VERSION}.`,
    );
  if (!isRecord(parsed.settings)) throw new Error(NOT_SETTINGS);
  return parsed.settings;
}

function exportSettings(): void {
  const file = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    settings: useSettings.getState().layers.user,
  };
  saveDownload({
    blob: new Blob([JSON.stringify(file, null, 2)], {
      type: "application/json",
    }),
    fileName: "rockett-settings.json",
  });
}

const changedCount = (settings: LayerValues) => {
  const current = useSettings.getState().layers.user;
  return Object.keys(settings).filter(
    (key) => JSON.stringify(settings[key]) !== JSON.stringify(current[key]),
  ).length;
};

function OutcomeLines({ outcome }: { outcome: Outcome }) {
  return (
    <>
      {outcome.kind === "unchanged" && (
        <span className="field-hint">
          This file changes none of your settings.
        </span>
      )}
      {outcome.kind === "failed" && (
        <span className="settings-error">{outcome.message}</span>
      )}
      {outcome.kind === "imported" && (
        <>
          <span className="field-hint">
            {outcome.applied.length
              ? `Applied: ${outcome.applied.join(", ")}`
              : "No settings applied."}
          </span>
          {outcome.rejected.length === 0 ? (
            <span className="field-hint">No settings rejected.</span>
          ) : (
            outcome.rejected.map((entry) => (
              <span className="settings-error" key={entry.key}>
                Rejected {entry.key}: {entry.reason}
              </span>
            ))
          )}
        </>
      )}
    </>
  );
}

export function SettingsTransfer() {
  const input = useRef<HTMLInputElement>(null);
  const at = useRef<Parameters<typeof confirm>[1]>(undefined);
  const loaded = useSettings((state) => state.loaded.user);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const importing = outcome.kind === "importing";
  const load = async (file?: File) => {
    if (!file || importing) return;
    setOutcome({ kind: "importing" });
    try {
      const settings = await readSettingsFile(file);
      const changes = changedCount(settings);
      if (!changes) {
        setOutcome({ kind: "unchanged" });
        return;
      }
      if (
        !(await confirm(
          `This import changes ${changes} of your settings and cannot be undone.`,
          at.current,
        ))
      ) {
        setOutcome({ kind: "idle" });
        return;
      }
      const result = await send(
        ROUTES.importUserSettings,
        {},
        {
          body: settings,
        },
      );
      setOutcome({ kind: "imported", ...result });
      await loadUserSettings().catch((error: Error) =>
        useStore.getState().setError(error.message),
      );
    } catch (error) {
      setOutcome({ kind: "failed", message: (error as Error).message });
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="settings-entry">
      <div className="settings-field-row">
        <button disabled={!loaded} onClick={exportSettings}>
          Export
        </button>
        <button
          disabled={!loaded || importing}
          onClick={(event) => {
            at.current = { x: event.clientX, y: event.clientY };
            input.current?.click();
          }}
        >
          {importing ? "Importing..." : "Import"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Settings file to import"
          onChange={(event) => void load(event.target.files?.[0])}
        />
      </div>
      <span className="field-hint">
        Export and Import carry your user settings from every section.
      </span>
      <OutcomeLines outcome={outcome} />
    </div>
  );
}
