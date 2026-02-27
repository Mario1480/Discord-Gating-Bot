import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "/admin/static/",
  build: {
    outDir: path.resolve(__dirname, "../dist/web-admin"),
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/admin/api": "http://localhost:3000",
      "/admin/login": "http://localhost:3000",
      "/admin/logout": "http://localhost:3000",
      "/auth/callback": "http://localhost:3000"
    }
  }
});
