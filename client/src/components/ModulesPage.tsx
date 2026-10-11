import { useEffect, useState } from "react";
import { ROUTES, type ModuleInfo } from "@rockett/shared";
import { api, ApiError, send } from "../api";

type Load = "loading" | "ready" | "failed";

const failure = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

type Licence =
  | { kind: "loading" }
  | { kind: "text"; paragraphs: string[] }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

function LicenceText({ id, name }: { id: string; name: string }) {
  const [licence, setLicence] = useState<Licence>({ kind: "loading" });
  useEffect(() => {
    send(ROUTES.moduleLicence, { id }).then(
      ({ text }) =>
        setLicence({
          kind: "text",
          paragraphs: text
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean),
        }),
      (cause: unknown) =>
        setLicence(
          cause instanceof ApiError && cause.status === 404
            ? { kind: "missing" }
            : { kind: "failed", error: failure(cause, "Could not load.") },
        ),
    );
  }, [id]);
  if (licence.kind === "loading")
    return <div className="tree-empty">Loading licence…</div>;
  if (licence.kind === "failed")
    return <span className="settings-error">{licence.error}</span>;
  return (
    <>
      {licence.kind === "missing" ? (
        <p>{name} ships no LICENSE file.</p>
      ) : (
        licence.paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))
      )}
      <p>
        Third-party software in Rockett is listed in THIRD-PARTY-NOTICES.md.
      </p>
    </>
  );
}

function ModuleRow({ module }: { module: ModuleInfo }) {
  const [open, setOpen] = useState(false);
  const name = module.name || module.id;
  const facts = [
    module.version && `version ${module.version}`,
    module.author && `by ${module.author}`,
    module.licence && `licence ${module.licence}`,
    module.status,
  ].filter(Boolean);
  return (
    <div className="project-row">
      <div className="project-open">
        <strong>{name}</strong>
        <span>{facts.join(" · ")}</span>
        {module.error && <span className="settings-error">{module.error}</span>}
        <button className="btn" onClick={() => setOpen(!open)}>
          {open ? `Hide licence for ${name}` : `Licence for ${name}`}
        </button>
        {open && <LicenceText id={module.id} name={name} />}
      </div>
    </div>
  );
}

export function ModulesPage() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [error, setError] = useState("");
  const loadModules = async () => {
    setLoad("loading");
    setError("");
    try {
      setModules(await api.modules());
      setLoad("ready");
    } catch (cause) {
      setError(failure(cause, "Could not load modules."));
      setLoad("failed");
    }
  };
  useEffect(() => {
    void loadModules();
  }, []);
  return (
    <div className="projects">
      {load === "loading" && <div className="tree-empty">Loading modules…</div>}
      {load === "failed" && (
        <>
          <div className="error-banner" role="alert">
            {error}
          </div>
          <button className="btn" onClick={() => void loadModules()}>
            Retry modules
          </button>
        </>
      )}
      {load === "ready" && modules.length === 0 && (
        <div className="tree-empty">No modules installed.</div>
      )}
      {load === "ready" &&
        modules.map((module, index) => (
          <ModuleRow key={`${module.id}:${index}`} module={module} />
        ))}
    </div>
  );
}
