/**
 * Host for the copied aholojs.dev walk-demo.
 *
 * `walk-demo.ts` is a verbatim copy of the playground example and expects the
 * playground's `RenderRuntime` context. The interfaces below are the
 * playground's own `src/client/render-runtime.d.ts`; `createRenderRuntime`
 * is our implementation of them on a plain page.
 */
import { createViewer, type PerspectiveCamera, type Scene3D, type Viewer } from "@manycore/aholo-viewer";
import { Pane } from "tweakpane";
import { CameraControl } from "../camera-control";

export interface RuntimeRenderer {
  readonly viewer: Viewer;
  readonly scene: Scene3D;
  frame(callback: (state: { time: number; delta: number }) => boolean): void;
  render(): void;
  resize(): void;
}

export interface RuntimeLoadingController {
  show(label?: string): void;
  hide(): void;
}

interface RuntimeConfigPaneOptions {
  expanded?: boolean;
  title?: string;
}

export interface RuntimeConfigPanel {
  readonly available: boolean;
  readonly container: HTMLElement;
  createPane(options?: RuntimeConfigPaneOptions): Pane;
  clear(): void;
  hide(): void;
  show(): void;
}

interface RuntimeIndexedDBSetOptions {
  version?: number;
}

interface RuntimeIndexedDBGetOptions {
  version?: number;
}

export interface RuntimeIndexedDBStorage {
  readonly available: boolean;
  get<T>(key: string, options?: RuntimeIndexedDBGetOptions): Promise<T | undefined>;
  set<T>(key: string, value: T, options?: RuntimeIndexedDBSetOptions): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface RenderRuntime {
  renderer: RuntimeRenderer;
  control: CameraControl;
  loading: RuntimeLoadingController;
  configPanel: RuntimeConfigPanel;
  indexedDB: RuntimeIndexedDBStorage;
  signal: AbortSignal;
}

const STORE = "resources";

/** Single-store IndexedDB cache for LOD splat chunks; falls back to a miss on any error. */
function createIndexedDBStorage(dbName: string): RuntimeIndexedDBStorage {
  const available = typeof indexedDB !== "undefined";
  let dbPromise: Promise<IDBDatabase> | undefined;

  function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
    if (!available) return undefined;
    try {
      const db = await open();
      return await new Promise<T | undefined>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      });
    } catch (error) {
      console.warn("[walk-demo] IndexedDB unavailable:", error);
      return undefined;
    }
  }

  // The playground versions entries so a format bump invalidates the cache.
  const versioned = (key: string, options?: { version?: number }) => `${options?.version ?? 0}:${key}`;

  return {
    available,
    get: (key, options) => tx("readonly", (s) => s.get(versioned(key, options))),
    set: async (key, value, options) => {
      await tx("readwrite", (s) => s.put(value, versioned(key, options)));
    },
    delete: async (key) => {
      await tx("readwrite", (s) => s.delete(versioned(key)));
    },
    clear: async () => {
      await tx("readwrite", (s) => s.clear());
    },
  };
}

/**
 * Overlays mount on document.body, never inside the viewer's canvas container.
 * ViewerWalkMode calls preventDefault() on any mousedown landing inside that
 * container (walk-demo.ts onMouseDown), which stops a native <select> from
 * opening — so the panel has to live outside it, as it does upstream.
 */
const OVERLAY_ROOT = document.body;

/** Loading overlay matching the playground's "show while a scene loads" behaviour. */
function createLoading(): RuntimeLoadingController & { el: HTMLElement } {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;inset:0;display:none;align-items:center;justify-content:center;" +
    "color:#eee;font:14px/1 system-ui,sans-serif;background:rgba(0,0,0,.6);z-index:1";
  el.textContent = "Loading…";
  OVERLAY_ROOT.append(el);
  return {
    el,
    show(label) {
      el.textContent = label ?? "Loading…";
      el.style.display = "flex";
    },
    hide() {
      el.style.display = "none";
    },
  };
}

function createConfigPanel(): RuntimeConfigPanel {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:12px;right:12px;width:260px;z-index:2";
  OVERLAY_ROOT.append(host);
  const panes: Pane[] = [];
  return {
    available: true,
    container: host,
    createPane(options) {
      const pane = new Pane({ container: host, ...options });
      panes.push(pane);
      return pane;
    },
    clear() {
      for (const pane of panes.splice(0)) pane.dispose();
    },
    hide() {
      host.style.display = "none";
    },
    show() {
      host.style.display = "";
    },
  };
}

/**
 * Build the runtime context the example expects. `container` hosts the canvas,
 * the loading overlay, and the tweakpane panel.
 */
export function createRenderRuntime(container: HTMLElement): RenderRuntime & { dispose(): void } {
  // The loading overlay and config panel are absolutely positioned inside it.
  container.style.position = "relative";
  const viewer = createViewer("walk-demo-viewer", container, { antialiasing: false });
  const scene = viewer.getScene() as Scene3D;
  const abort = new AbortController();

  let frameCallback: ((state: { time: number; delta: number }) => boolean) | undefined;
  let lastTime = performance.now();
  let rafId = 0;

  const renderer: RuntimeRenderer = {
    viewer,
    scene,
    frame(callback) {
      frameCallback = callback;
    },
    render() {
      syncCameraAspect();
      viewer.render();
    },
    resize() {
      viewer.resize();
    },
  };

  /**
   * Match the active camera's aspect to the canvas, or the scene renders
   * stretched. Done on every render rather than only on resize because the demo
   * swaps cameras at runtime (walk mode, and first/third-person), and a camera
   * created between resizes would otherwise keep its default aspect.
   */
  function syncCameraAspect() {
    const camera = viewer.getCamera() as PerspectiveCamera | undefined;
    if (!camera || typeof camera.aspect !== "number") return;
    const { width, height } = viewer.getSize();
    if (!(width > 0 && height > 0)) return;
    const aspect = width / height;
    if (Math.abs(camera.aspect - aspect) > 0.001) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix?.();
    }
  }

  function tick(time: number) {
    rafId = requestAnimationFrame(tick);
    const delta = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;
    if (frameCallback?.({ time: time / 1000, delta })) renderer.render();
  }
  rafId = requestAnimationFrame(tick);

  // The example drives the camera itself through ViewerWalkMode and only ever
  // disables this control, but it must be a real CameraControl instance.
  const control = new CameraControl(viewer.getCamera(), container, { enabled: false });

  const onResize = () => renderer.resize();
  window.addEventListener("resize", onResize);
  const resizeObserver = new ResizeObserver(onResize);
  resizeObserver.observe(container);

  const loading = createLoading();
  const configPanel = createConfigPanel();

  return {
    renderer,
    control,
    loading,
    configPanel,
    indexedDB: createIndexedDBStorage("walk-demo-cache"),
    signal: abort.signal,
    dispose() {
      abort.abort();
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      resizeObserver.disconnect();
      configPanel.clear();
      loading.el.remove();
      configPanel.container.remove();
    },
  };
}
