import react from "@vitejs/plugin-react";
import { dirname, resolve } from "path";
import { existsSync } from "fs";
import { defineConfig, type Plugin } from "vite";

// Windows Vite 8 doesn't resolve .js imports to .ts source files reliably.
function jsToTs(): Plugin {
  return {
    name: "js-to-ts",
    enforce: "pre",
    resolveId(source, importer) {
      if (!source.endsWith(".js") || !importer || source.includes("node_modules")) return null;
      const dir = dirname(importer);
      for (const ext of [".ts", ".tsx"]) {
        const candidate = resolve(dir, source.replace(/\.js$/, ext));
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [jsToTs(), react()],
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
