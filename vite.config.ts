import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { portalWritePlugin } from "./tools/portal-write-plugin";
import { apiDevPlugin } from "./tools/api-dev-plugin";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Dev-only: lets the portal capture UI write into the scene folder.
    portalWritePlugin(),
    // Dev-only: serves /api/* via the shared Hono app (server/app.ts).
    apiDevPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@manycore/aholo-viewer"],
  },
});
