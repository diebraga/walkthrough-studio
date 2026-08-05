import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshPhongMaterial,
  PerspectiveCamera,
  Side,
  Vector3,
} from "@manycore/aholo-viewer";
import runner from "./walk-demo";
import { createRenderRuntime, type RenderRuntime } from "./render-runtime";

/**
 * Placeholder when the demo scene can't load (Aholo's splat/GLB CDN is
 * unreachable, etc.) — a unit square so the viewer proves it is alive
 * instead of showing black.
 */
function mountFallbackSquare({ renderer, loading }: RenderRuntime): void {
  loading.hide();
  const { scene, viewer } = renderer;
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(3, 3, 3);
  camera.lookAt(new Vector3(0, 0, 0));
  camera.updateMatrixWorld(true);
  viewer.setCamera(camera);
  renderer.resize();
  scene.add(new AmbientLight(0xffffff, 1));

  // Two triangles, one unit square on the XY plane.
  const positions = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0,
    -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const normals = new Float32Array(18);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1;

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  const square = new Mesh(geometry, new MeshPhongMaterial({ side: Side.DoubleSide }));
  scene.add(square);

  renderer.frame(({ time }) => {
    square.rotation.z = time / 4;
    return true;
  });
}

/** Mount the walk demo into `container`. Returns a disposer. */
export function start(container: HTMLElement): () => void {
  const runtime = createRenderRuntime(container);
  let stopDemo: (() => void) | undefined;

  // ?fallback=1 forces the placeholder, so it can be checked without
  // having to break the network.
  if (new URLSearchParams(location.search).has("fallback")) {
    mountFallbackSquare(runtime);
    return () => runtime.dispose();
  }

  runner(runtime)
    .then((stop) => {
      stopDemo = stop;
    })
    .catch((error) => {
      console.error("[walk-demo] scene failed to load, showing placeholder:", error);
      mountFallbackSquare(runtime);
    });

  return () => {
    stopDemo?.();
    runtime.dispose();
  };
}
