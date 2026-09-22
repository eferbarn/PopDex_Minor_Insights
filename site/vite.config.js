import { defineConfig } from "vite";

// Same proxies as vercel.json so `npm run dev` behaves like production.
export default defineConfig({
  server: {
    proxy: {
      "/px/api": { target: "https://api.popdex.xyz", changeOrigin: true, rewrite: (p) => p.replace(/^\/px\/api/, "/api/v1") },
      "/px/explorer": { target: "https://app.popdex.xyz", changeOrigin: true, rewrite: (p) => p.replace(/^\/px\/explorer/, "/web/v1/explorer") },
      "/px/app": { target: "https://app.popdex.xyz", changeOrigin: true, rewrite: (p) => p.replace(/^\/px\/app/, "/web/v1") },
    },
  },
});
