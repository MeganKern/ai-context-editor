import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 3711,
    strictPort: true,
    // On macOS the native watcher lost files that were saved by replacement (how editors and tools
    // write), so edits stopped being served until a restart. Polling sees every save.
    watch: { usePolling: true, interval: 300 },
    // The server answers only to its own address, so the proxy speaks as it.
    proxy: {
      "/api": { target: "http://localhost:3710", changeOrigin: true },
    },
  },
});
