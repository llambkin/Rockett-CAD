import { api } from "./api";
import { leaveBrowserProject } from "./browserSession";
import { BROWSER_PATH, folderPath, showPath } from "./paths";
import { folderOf } from "./projectTree";
import { useStore } from "./store";

export async function backToProjects(): Promise<void> {
  const { projectId, closeProject, notSaved, recovery } = useStore.getState();
  if (
    (notSaved || recovery) &&
    !window.confirm(
      notSaved
        ? "Changes not saved in this browser will be lost."
        : "Your unsaved change will be lost.",
    )
  )
    return;
  if (leaveBrowserProject()) showPath(BROWSER_PATH);
  else
    showPath(
      folderPath(
        await api.listFolders().then(
          (tree) => (projectId === null ? null : folderOf(tree, projectId)),
          () => null,
        ),
      ),
    );
  closeProject();
}
