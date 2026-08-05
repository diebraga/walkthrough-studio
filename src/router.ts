/**
 * Single-entry client router. Vite's dev server and `vite preview` fall back to
 * index.html for unknown paths, so every route below is served by this one page.
 *
 * Routes are loaded lazily — importing a route module is what starts it, so the
 * walk demo never boots on "/" and the studio never boots on "/test".
 */
type Route = (container: HTMLElement) => unknown;

const ROUTES: Record<string, () => Promise<Route>> = {
  // The original studio app self-starts on import.
  "/": () => import("./main").then(() => () => {}),
  // Verbatim copy of https://aholojs.dev/en-US/playground/?example=walk-demo
  "/test": () => import("./walk-demo/entry").then((m) => m.start),
};

function notFound(container: HTMLElement, path: string) {
  container.innerHTML = "";
  const pre = document.createElement("pre");
  pre.style.cssText = "color:#eee;font:13px/1.6 monospace;padding:24px";
  pre.textContent = `No route for ${path}\n\nAvailable:\n${Object.keys(ROUTES).map((r) => `  ${r}`).join("\n")}`;
  container.append(pre);
}

async function resolve() {
  const container = document.getElementById("app");
  if (!container) throw new Error("#app container not found");
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const load = ROUTES[path];
  if (!load) return notFound(container, path);
  (await load())(container);
}

window.addEventListener("popstate", () => location.reload());

resolve().catch((error) => {
  console.error(error);
  const pre = document.createElement("pre");
  pre.style.cssText = "color:#f66;font:12px/1.5 monospace;white-space:pre-wrap;padding:16px";
  pre.textContent = String(error?.stack ?? error);
  document.body.append(pre);
});
