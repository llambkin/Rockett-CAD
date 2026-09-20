import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Import shared TS source directly so Vite transpiles it.
      "@rockett/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
