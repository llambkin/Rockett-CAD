import { defineServerModule } from "@rockett/plugin-api";
import { board } from "./src/kernel/boardFeature.js";
import { outlineModule } from "./src/outline.js";
import { BOARD_NETS, boardNets } from "./src/server/boardNets.js";
import { BOARD, boardSnapshot } from "./src/server/boardSnapshot.js";
import { uploadModule } from "./src/server/upload.js";

export default defineServerModule({
  async activate({ register, services, dxf }) {
    await register.timelineFeature(
      board,
      new URL("./kernel.ts", import.meta.url),
    );
    register.routeModule(uploadModule);
    register.routeModule(outlineModule(dxf));
    services.provide(BOARD_NETS, boardNets);
    services.provide(BOARD, boardSnapshot);
  },
});
