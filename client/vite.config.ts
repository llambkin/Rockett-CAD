import { defineConfig, runnerImport } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { DEFAULT_PORT } from "../shared/src/routes.ts";

const alias = {
  // Import shared TS source directly so Vite transpiles it.
  "@rockett/shared": path.resolve(
    import.meta.dirname,
    "../shared/src/index.ts",
  ),
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: "paint-bg0",
      async transformIndexHtml() {
        const { module } = await runnerImport<
          typeof import("./src/theme/tokens.ts")
        >(path.resolve(import.meta.dirname, "src/theme/tokens.ts"), {
          configFile: false,
          logLevel: "silent",
          resolve: { alias },
        });
        return [
          {
            tag: "style",
            children: `html{--bg0:${module.THEME_TOKENS.bg0};background:var(--bg0)}`,
            injectTo: "head",
          },
        ];
      },
    },
  ],
  resolve: { alias },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${DEFAULT_PORT}`,
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
