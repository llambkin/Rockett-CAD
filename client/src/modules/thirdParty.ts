import { pathFor, ROUTES, type ModuleInfo } from "@rockett/shared";
import { API } from "../api";
import type { HostModule } from "./host";

type Client = HostModule["client"];

export const thirdPartyModules = (
  reports: readonly ModuleInfo[],
): HostModule[] =>
  reports.flatMap(({ id, name, client }) =>
    client
      ? [
          {
            manifest: { id, name },
            client: {
              async activate(context) {
                const url = API + pathFor(ROUTES.pluginClient, { id });
                const { default: plugin } = (await import(url)) as {
                  default?: Client;
                };
                if (typeof plugin?.activate !== "function")
                  throw new Error(
                    "client.mjs has no default export with activate",
                  );
                await plugin.activate(context);
              },
            },
          },
        ]
      : [],
  );
