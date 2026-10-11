import { defineClientModule } from "@rockett/plugin-api";
import { faceOutlineRoute } from "./src/outline.js";

export default defineClientModule({
  activate({ register, project, ui }) {
    const face = () => {
      const picked = project.selection();
      return picked.length === 1 ? picked[0] : undefined;
    };
    register.command({
      id: "rockett.kicad.exportOutline",
      label: "Export board outline DXF",
      enabled: () => (face() ? true : "Select one planar face"),
      async run() {
        const picked = face();
        if (!picked) return;
        const { bodyId, faceName } = picked;
        const name =
          project.get().bodies.find(({ id }) => id === bodyId)?.name ?? bodyId;
        try {
          const dxf = await project.read(faceOutlineRoute, {
            bodyId,
            faceName,
          });
          ui.download({
            fileName: `${name}.dxf`,
            data: dxf,
            type: "image/vnd.dxf",
          });
        } catch (error) {
          ui.showError(error instanceof Error ? error.message : String(error));
        }
      },
    });
    register.menuItem({
      id: "rockett.kicad.exportOutline",
      menu: "design.viewport.face",
      after: "design.viewport.face.exportDxf",
      command: "rockett.kicad.exportOutline",
    });
  },
});
