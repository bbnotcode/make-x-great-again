import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The React/shadcn console + public pages build into ./static/app, which the
// Worker's [assets] binding serves at /app/*. The Worker (src/index.ts) keeps
// owning /v1/* (API) and returns the SPA shell for page routes. `base:'/app/'`
// makes the emitted asset URLs absolute under /app/ so the shell works no
// matter which path (/admin, /, /list) it's served at.
export default defineConfig({
  root: "app",
  base: "/app/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  build: {
    outDir: "../static/app",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:app` proxies the API to the deployed Worker so the React
    // app can run against real data without a local backend.
    proxy: {
      "/v1": { target: "https://x.zuoluo.tv", changeOrigin: true, secure: true },
    },
  },
});
