import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { DEFAULT_PORT } from "../shared/src/routes.ts";
import { PALETTES } from "./src/theme/palette.ts";

const alias = {
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
      transformIndexHtml() {
        return [
          {
            tag: "style",
            children: `html{--bg0:${PALETTES.grey.bg0};background:var(--bg0)}`,
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
