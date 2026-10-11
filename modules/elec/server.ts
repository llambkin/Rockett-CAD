import { defineServerModule } from "@rockett/plugin-api";
import { netsModule } from "./src/boardNets.js";
import { padsModule } from "./src/server/boardPads.js";
import { pinsModule } from "./src/server/pinTable.js";

export default defineServerModule({
  activate({ register }) {
    register.routeModule(netsModule);
    register.routeModule(pinsModule);
    register.routeModule(padsModule);
  },
});
