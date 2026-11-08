import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 3711,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3710",
    },
  },
});
