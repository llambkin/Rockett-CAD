import { useRef, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { ToolButton } from "./ToolButton";

export function StepImportButton({
  newProject = false,
  onError,
}: {
  newProject?: boolean;
  onError?: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const busy = useStore((s) => s.busy);
  const load = async (file?: File) => {
    if (!file || pending || busy) return;
    setPending(true);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error(
          "Choose a STEP, IGES, BREP, STL, OBJ or 3MF file up to 10 MB.",
        );
      const s = useStore.getState();
      if (newProject) {
        const result = await api.importStep(file);
        await s.openProject(result.document.id);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => viewportHandle.current?.zoomToFit()),
        );
      } else if (s.projectId) {
        await s.mutate(() => api.importStep(file, s.projectId!));
        s.setMode({ name: "idle" });
        s.setSelection([]);
        requestAnimationFrame(() => viewportHandle.current?.zoomToFit());
      }
    } catch (error) {
      const message = (error as Error).message;
      if (onError) onError(message);
      else useStore.getState().setError(message);
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  };
  const button = {
    disabled: pending || busy,
    title: "Import STEP, IGES, BREP, STL, OBJ or 3MF bodies, up to 10 MB",
    onClick: () => input.current?.click(),
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".step,.stp,.igs,.iges,.brep,.stl,.obj,.3mf"
        hidden
        aria-label="STEP, IGES, BREP, STL, OBJ or 3MF file"
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
