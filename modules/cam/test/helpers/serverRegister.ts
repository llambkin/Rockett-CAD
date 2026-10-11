import { registerExtensionSpec } from "@rockett/shared";
import type { ServerRegister } from "@rockett/plugin-api";

export const serverRegister = (
  routeModule: ServerRegister["routeModule"],
): ServerRegister => ({
  routeModule,
  extensionSpec: registerExtensionSpec,
  kernelJob: () => () => {},
  timelineFeature: async () => () => {},
  setting: () => () => {},
});
