import { defineClientModule } from "@rockett/plugin-api";
import {
  NET_PANEL,
  netPanel,
  reason,
  selectedBoard,
} from "./src/client/netPanel.js";
import { pinsRoute } from "./src/server/pinTable.js";

const NO_BOARD = "Select a face of one KiCad board";

export default defineClientModule({
  activate(context) {
    const { register, project, ui } = context;
    const board = () => selectedBoard(project);
    const panel = netPanel(context);
    register.command({
      id: "rockett.elec.exportPins",
      label: "Export connector pin table CSV",
      enabled: () => (board() ? true : NO_BOARD),
      async run() {
        const picked = board();
        if (!picked) return;
        const name =
          project.get().bodies.find(({ id }) => id === picked.bodyId)?.name ??
          picked.bodyId;
        try {
          const csv = await project.read(pinsRoute, { linkId: picked.linkId });
          ui.download({
            fileName: `${name} pins.csv`,
            data: csv,
            type: "text/csv",
          });
        } catch (error) {
          ui.showError(reason(error));
        }
      },
    });
    register.menuItem({
      id: "rockett.elec.exportPins",
      menu: "design.viewport.face",
      after: "rockett.kicad.exportOutline",
      command: "rockett.elec.exportPins",
    });
    register.command({
      id: "rockett.elec.openPanel",
      label: "Nets and connectors",
      enabled: () => (board() ? true : NO_BOARD),
      async run() {
        const picked = board();
        if (picked) await panel.show(picked);
      },
    });
    register.menuItem({
      id: "rockett.elec.openPanel",
      menu: "design.viewport.face",
      after: "rockett.elec.exportPins",
      command: "rockett.elec.openPanel",
    });
    register.panel({
      id: NET_PANEL,
      title: "Electrical",
      when: (_state, open) => open.includes(NET_PANEL),
      component: panel.NetPanel,
    });
    register.layer(panel.layer);
  },
});
