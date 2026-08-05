import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { portalWritePlugin } from "./tools/portal-write-plugin";

export default defineConfig({
  // Dev-only: lets the portal capture UI write into the scene folder.
  plugins: [react(), portalWritePlugin()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@manycore/aholo-viewer"],
  },
});
