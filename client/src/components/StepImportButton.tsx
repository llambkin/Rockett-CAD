import { useContext, useEffect, useRef, useState } from "react";
import { importLabels, type ImportFormat } from "@rockett/shared";
import { api } from "../api";
import { useStore } from "../store";
import { ViewportContext } from "../viewportRef";
import { ToolButton } from "./ToolButton";

export function StepImportButton({
  newProject = false,
  onError,
}: {
  newProject?: boolean;
  onError?: (message: string) => void;
}) {
  const viewport = useContext(ViewportContext);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [formats, setFormats] = useState<ImportFormat[]>([]);
  const report = (message: string) =>
    onError ? onError(message) : useStore.getState().setError(message);
  useEffect(() => {
    api.formats().then(
      (all) => setFormats(all.importers),
      (error: Error) => report(error.message),
    );
  }, []);
  const labels = importLabels(formats);
  const busy = useStore((s) => s.busy);
  const load = async (file?: File) => {
    if (!file || pending || busy) return;
    setPending(true);
    try {
      const s = useStore.getState();
      if (newProject) {
        const result = await api.importStep(file);
        await s.openProject(result.document.id);
      } else if (s.projectId) {
        await s.mutate(() => api.importStep(file, s.projectId!));
        s.clearActive();
        s.setSelection([]);
        requestAnimationFrame(() => viewport.current?.zoomToFit());
      }
    } catch (error) {
      report((error as Error).message);
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  const button = {
    disabled: pending || busy,
    title: `Import ${labels || "STEP"} bodies`,
    onClick: () => input.current?.click(),
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={formats.flatMap((f) => f.extensions).join(",")}
        hidden
        aria-label="File to import"
        onChange={(e) => void load(e.target.files?.[0])}
      />
      {newProject ? (
        <button className="btn" {...button}>
          {pending ? "Importing STEP…" : "New project from STEP"}
        </button>
      ) : (
        <ToolButton
          icon="importStep"
          label={pending ? "Importing STEP…" : "Import STEP"}
          {...button}
        />
      )}
    </>
  );
}
