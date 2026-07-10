import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5177,
    proxy: { "/api": "http://localhost:8077" },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
});
