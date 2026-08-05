import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@manycore/aholo-viewer"],
  },
  build: {
    rollupOptions: {
      input: {
        // index.html is the SPA shell for src/router.ts. test-main.html is the
        // older standalone walk-demo experiment; it was renamed off "test.html"
        // because Vite resolves /test to test.html before the SPA fallback,
        // which would shadow the /test route.
        main: "index.html",
        "test-main": "test-main.html",
      },
    },
  },
});
