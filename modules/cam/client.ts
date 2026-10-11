import {
  defineClientModule,
  type ClientContext,
  type Panel,
} from "@rockett/plugin-api";
import { manufactureBrowser } from "./src/client/browser.js";
import {
  dialogPanel,
  LASER_GROUP,
  MILL_GROUP,
  OPERATION_DIALOGS,
  operationDialog,
} from "./src/client/opDialog.js";
import { holdDownDraft } from "./src/client/holdDowns.js";
import { NC_PANEL, ncDialog } from "./src/client/ncDialog.js";
import { registerPlan } from "./src/client/planDialog.js";
import { postsPage } from "./src/client/postLibrary.js";
import { SETUP_PANEL, setupDialog } from "./src/client/setupDialog.js";
import { stockLayer } from "./src/client/stockLayer.js";
import { machinesPage, toolsPage } from "./src/client/toolPanel.js";
import {
  toolpathBar,
  toolpathLayer,
  toolpathPreview,
} from "./src/client/toolpaths.js";
import { CAM_SETTINGS } from "./src/shared/settings.js";

const MANUFACTURE = "rockett.cam.manufacture";
const SETUP_GROUP = "rockett.cam.group.setup";
const PROGRAM_GROUP = "rockett.cam.group.program";
const MACHINES_PAGE = "rockett.cam.machines";

type Dialog = {
  id: string;
  label: string;
  panel: string;
  component: Panel["component"];
} & (
  { group: string; icon: `${string}.svg` } | { group?: never; icon?: never }
);

function dialog({ register, ui }: ClientContext, item: Dialog) {
  const { panel, component, ...command } = item;
  register.command({ ...command, run: () => ui.openPanel(panel) });
  register.panel({
    id: panel,
    title: command.label,
    when: (_state, open) => open.includes(panel),
    component,
  });
}

function settingsPages(context: ClientContext) {
  const { register } = context;
  for (const setting of CAM_SETTINGS) register.setting(setting);
  register.settingsPage({
    id: MACHINES_PAGE,
    title: "Machines",
    component: machinesPage(context),
  });
  register.settingsPage({
    id: "rockett.cam.posts",
    title: "Posts",
    component: postsPage(context),
  });
  register.settingsPage({
    id: "rockett.cam.tools",
    title: "Tools",
    component: toolsPage(context),
  });
}

export default defineClientModule({
  activate(context) {
    const { register, project, ui } = context;
    const preview = toolpathPreview(project);
    const draft = holdDownDraft();
    settingsPages(context);
    register.workbench({
      id: MANUFACTURE,
      label: "Manufacture",
      panels: [],
      selectionKinds: [],
      tree: manufactureBrowser(context, preview),
      bar: toolpathBar(preview),
    });
    register.toolbarGroup({
      id: SETUP_GROUP,
      label: "SETUP",
      context: MANUFACTURE,
    });
    dialog(context, {
      id: "rockett.cam.setup",
      label: "Setup",
      group: SETUP_GROUP,
      icon: "setup.svg",
      panel: SETUP_PANEL,
      component: setupDialog(context, draft),
    });
    register.command({
      id: "rockett.cam.library",
      label: "Library",
      group: SETUP_GROUP,
      icon: "library.svg",
      run: () => ui.openSettings(MACHINES_PAGE),
    });
    registerPlan(context, preview);
    register.toolbarGroup({
      id: MILL_GROUP,
      label: "MILL",
      context: MANUFACTURE,
      after: "rockett.cam.group.plan",
    });
    register.toolbarGroup({
      id: LASER_GROUP,
      label: "LASER",
      context: MANUFACTURE,
      after: "rockett.cam.group.surface",
    });
    for (const op of OPERATION_DIALOGS)
      dialog(context, {
        id: op.type,
        label: op.label,
        ...op.toolbar,
        panel: dialogPanel(op),
        component: operationDialog(context, op, preview),
      });
    register.toolbarGroup({
      id: PROGRAM_GROUP,
      label: "PROGRAM",
      context: MANUFACTURE,
      after: LASER_GROUP,
    });
    dialog(context, {
      id: "rockett.cam.nc",
      label: "NC Program",
      group: PROGRAM_GROUP,
      icon: "nc-program.svg",
      panel: NC_PANEL,
      component: ncDialog(context),
    });
    register.layer(stockLayer(project, preview, draft));
    register.layer(toolpathLayer(preview));
  },
});
