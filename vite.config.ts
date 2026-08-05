import { defineConfig } from "vite";
import { portalWritePlugin } from "./tools/portal-write-plugin";

export default defineConfig({
  // Dev-only: lets the portal capture UI write into the scene folder.
  plugins: [portalWritePlugin()],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@manycore/aholo-viewer"],
  },
});
