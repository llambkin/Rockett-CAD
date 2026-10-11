import camManifest from "./cam/manifest.json";
import camServer from "./cam/server.js";
import elecManifest from "./elec/manifest.json";
import elecServer from "./elec/server.js";
import kicadManifest from "./kicad/manifest.json";
import kicadServer from "./kicad/server.js";
import measureManifest from "./measure/manifest.json";
import measureServer from "./measure/server.js";

export const serverModules = [
  {
    manifest: camManifest,
    server: camServer,
    folder: new URL("./cam/", import.meta.url),
  },
  {
    manifest: kicadManifest,
    server: kicadServer,
    folder: new URL("./kicad/", import.meta.url),
  },
  {
    manifest: elecManifest,
    server: elecServer,
    folder: new URL("./elec/", import.meta.url),
  },
  {
    manifest: measureManifest,
    server: measureServer,
    folder: new URL("./measure/", import.meta.url),
  },
];
