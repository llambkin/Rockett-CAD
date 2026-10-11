import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { HOST_IMPORTS } from "../shared/src/moduleManifest.ts";
import { DEFAULT_PORT } from "../shared/src/routes.ts";
import { PALETTES } from "./src/theme/palette.ts";

const alias = {
  "@rockett/shared": path.resolve(
    import.meta.dirname,
    "../shared/src/index.ts",
  ),
};

const FACADE = "\0facade:";

function pluginImportMap(): Plugin {
  return {
    name: "plugin-import-map",
    apply: "build",
    options(options) {
      const facades = Object.fromEntries(
        HOST_IMPORTS.map((spec) => [spec.replace("/", "-"), FACADE + spec]),
      );
      return {
        ...options,
        input: {
          index: path.resolve(import.meta.dirname, "index.html"),
          ...facades,
        },
        preserveEntrySignatures: "exports-only",
      };
    },
    resolveId(id) {
      if (id.startsWith(FACADE)) return id;
    },
    async load(id) {
      if (!id.startsWith(FACADE)) return;
      const spec = id.slice(FACADE.length);
      const names = Object.keys(await import(spec)).filter(
        (name) => name !== "module.exports",
      );
      return `export { ${names.join(", ")} } from ${JSON.stringify(spec)};`;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, { bundle }) {
        const imports: Record<string, string> = {};
        for (const chunk of Object.values(bundle ?? {}))
          if (
            chunk.type === "chunk" &&
            chunk.facadeModuleId?.startsWith(FACADE)
          )
            imports[chunk.facadeModuleId.slice(FACADE.length)] =
              `/${chunk.fileName}`;
        return [
          {
            tag: "script",
            attrs: { type: "importmap" },
            children: JSON.stringify({ imports }),
            injectTo: "head-prepend",
          },
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    pluginImportMap(),
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
