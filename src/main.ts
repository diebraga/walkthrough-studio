import {
  AmbientLight,
  Animation,
  BackgroundMode,
  Color,
  DirectionalLight,
  GLTFLoader,
  Object3D,
  PerspectiveCamera,
  SplatLoader,
  SplatModifier,
  SplatUtils,
  Vector3,
  createViewer,
  downloadTexture,
  setViewerConfig,
  type Scene3D,
} from "@manycore/aholo-viewer";
import { ANNEAL_DURATION_MS, createMcmcAnnealModifier, measureSplatCloud, openingAnnealProgress } from "./anneal";
import { CameraControl } from "./camera-control";

const { loadGLTF } = GLTFLoader;
const AnimationPlugin = Animation.AnimationPlugin;
const AnimationMixer = Animation.AnimationMixer;
const Skeleton = Animation.Skeleton;
type AnimationClip = Animation.AnimationClip;

const SPLAT_URL = new URLSearchParams(location.search).get("splat") || "/splat_hall_2.ply";
const VOXEL_META_URL = "/voxel-hall-2/voxel-meta.json";
const VOXEL_BIN_URL = "/voxel-hall-2/voxel.bin";

// Aholo OSS open-source demo assets — see the walk-demo example these were
// ported from (https://aholojs.dev/en-US/playground/?example=walk-demo).
// External fetch, not bundled. Same "misc/" export pipeline as the robot
// (Mixamo-rigged, per the "mixamo.com" clip fallback in setupActions below),
// so it shares the robot's scale/upright constants below.
const ROBOT_MODEL_URL = "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/misc/robot.0765006a.glb";
// KNOWN BROKEN: this GLB downloads fine (HTTP 200) but aholo-viewer's GLTF
// texture loader never resolves its 9 texture promises, so the model never
// appears. Bug is in the library, not here — kept selectable so it starts
// working the day aholo-viewer is fixed.
const MAN_MODEL_URL = "https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/misc/man-final.755ce8ea.glb";
const THIRD_PERSON_DISTANCE = 3.2;
const THIRD_PERSON_HEIGHT = 0.35;

type ThirdPersonCharacterId = "robot" | "man";
const THIRD_PERSON_CHARACTERS: Record<ThirdPersonCharacterId, { label: string; url: string }> = {
  robot: { label: "Robot", url: ROBOT_MODEL_URL },
  man: { label: "Man", url: MAN_MODEL_URL },
};

type PresetId = "balanced" | "performance" | "quality" | "extreme";
type Vec3Tuple = [number, number, number];
type SplatObject = Awaited<ReturnType<typeof SplatUtils.createSplat>>;

type VoxelMeta = {
  gridBounds: { min: Vec3Tuple; max: Vec3Tuple };
  voxelResolution: number;
  leafSize: number;
  treeDepth: number;
  nodeCount: number;
  leafDataCount: number;
};

type VoxelCollision = {
  meta: VoxelMeta;
  nodes: Uint32Array;
  leafData: Uint32Array;
  isOccupied(position: Vector3): boolean;
  /** Horizontal push-out for a vertical capsule centered at (cx, cy, cz); null if not penetrating. */
  queryCapsulePush(cx: number, cy: number, cz: number, halfHeight: number, radius: number): { x: number; z: number } | null;
};

// Capsule dimensions in the same (COLMAP-scale, not literal meters) units as
// FEET_OFFSET below.
// ponytail: tuned by eye against this scene's scale, like FEET_OFFSET already
// was — revisit if walking feels too wide/narrow against doorways.
const CAPSULE_HALF_HEIGHT = 0.25;
const CAPSULE_RADIUS = 0.16;
const CAPSULE_PENETRATION_EPSILON = 1e-4;
const MAX_RESOLVE_ITERATIONS = 4;


const PRESETS: Record<
  PresetId,
  {
    label: string;
    packType: (typeof SplatLoader.SplatPackType)[keyof typeof SplatLoader.SplatPackType];
    maxShDegree: number;
    config: object;
    autoFreeResourceOnGpuPacked: boolean;
  }
> = {
  balanced: {
    label: "Balanced",
    packType: SplatLoader.SplatPackType.SuperCompressed,
    maxShDegree: 3,
    autoFreeResourceOnGpuPacked: false,
    config: {
      pack: { precalculateEnabled: true, cameraRelativeEnabled: true },
      raster: { detailCullingThreshold: 1, maxStdDev: Math.sqrt(8) },
      sort: { minIntervalMs: 0 },
    },
  },
  performance: {
    label: "Performance",
    packType: SplatLoader.SplatPackType.SuperCompressed,
    maxShDegree: 3,
    autoFreeResourceOnGpuPacked: true,
    config: {
      pack: { precalculateEnabled: true, cameraRelativeEnabled: false },
      raster: { detailCullingThreshold: 1, maxStdDev: Math.sqrt(5) },
      sort: { minIntervalMs: 64 },
    },
  },
  quality: {
    label: "Quality",
    packType: SplatLoader.SplatPackType.Compressed,
    maxShDegree: 3,
    autoFreeResourceOnGpuPacked: true,
    config: {
      pack: { highPrecisionEnabled: true, precalculateEnabled: true, cameraRelativeEnabled: false },
      raster: { detailCullingThreshold: 0, normalizedFalloff: false, maxStdDev: Math.sqrt(8) },
      sort: { highPrecisionEnabled: false, minIntervalMs: 0 },
      composite: { highPrecisionEnabled: false },
    },
  },
  extreme: {
    label: "Extreme",
    packType: SplatLoader.SplatPackType.SuperCompressed,
    maxShDegree: 0,
    autoFreeResourceOnGpuPacked: true,
    config: {
      pack: {
        precalculateEnabled: false,
        cameraRelativeEnabled: false,
        sortedLayoutEnabled: true,
      },
      raster: { detailCullingThreshold: 4, maxStdDev: Math.sqrt(5) },
      sort: { minIntervalMs: 160 },
    },
  },
};

const CAMERA_UP: Vec3Tuple = [0, -1, 0];
const COORDINATE_LABEL = "OpenCV -Y";

// Scene up is -Y (OpenCV convention), so "down" is +Y.
const GRAVITY = 9; // units/s^2
const JUMP_SPEED = 3.2; // initial upward (i.e. -Y) velocity
const GROUND_PROBE = 0.05;
// ponytail: derived from the default eye height (0.45) vs. the nearest floor
// voxel surface (~1.1) at the reset spawn point; collision data is point-only
// (no capsule), so this offset stands in for a feet position under the eye.
const FEET_OFFSET = 0.65;

function popcount(value: number) {
  let count = 0;
  while (value) {
    value &= value - 1;
    count++;
  }
  return count;
}

async function loadVoxelCollision(): Promise<VoxelCollision | null> {
  const [metaResp, binResp] = await Promise.all([
    fetch(VOXEL_META_URL),
    fetch(VOXEL_BIN_URL),
  ]);
  if (!metaResp.ok || !binResp.ok) return null;

  const meta = (await metaResp.json()) as VoxelMeta;
  const buffer = await binResp.arrayBuffer();
  const all = new Uint32Array(buffer);
  const nodes = all.slice(0, meta.nodeCount);
  const leafData = all.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);

  function isOccupied(position: Vector3) {
    const { min, max } = meta.gridBounds;
    const resolution = meta.voxelResolution;
    if (
      position.x < min[0] ||
      position.y < min[1] ||
      position.z < min[2] ||
      position.x >= max[0] ||
      position.y >= max[1] ||
      position.z >= max[2]
    ) {
      return false;
    }

    const ix = Math.floor((position.x - min[0]) / resolution);
    const iy = Math.floor((position.y - min[1]) / resolution);
    const iz = Math.floor((position.z - min[2]) / resolution);
    const bx = Math.floor(ix / meta.leafSize);
    const by = Math.floor(iy / meta.leafSize);
    const bz = Math.floor(iz / meta.leafSize);

    function checkNode(nodeIndex: number): boolean {
      const node = nodes[nodeIndex];
      if (node === 0xff000000) return true;
      const childMask = node >>> 24;
      if (childMask !== 0) return false;
      const offset = node & 0x00ffffff;
      const bit = (ix & 3) + (iy & 3) * 4 + (iz & 3) * 16;
      const word = leafData[offset * 2 + (bit >= 32 ? 1 : 0)] ?? 0;
      return (word & (1 << (bit & 31))) !== 0;
    }

    let nodeIndex = 0;
    for (let level = meta.treeDepth - 1; level >= 0; level--) {
      const node = nodes[nodeIndex];
      if (node === 0xff000000) return true;

      const childMask = node >>> 24;
      const offset = node & 0x00ffffff;
      if (childMask === 0) return checkNode(nodeIndex);

      const octant =
        (((bx >> level) & 1) << 0) |
        (((by >> level) & 1) << 1) |
        (((bz >> level) & 1) << 2);
      const bit = 1 << octant;
      if ((childMask & bit) === 0) return false;
      nodeIndex = offset + popcount(childMask & (bit - 1));
      if (nodeIndex < 0 || nodeIndex >= nodes.length) return false;
    }
    return checkNode(nodeIndex);
  }

  // Same octree traversal as isOccupied above, but taking integer voxel
  // indices directly (needed to scan a range of voxels around a capsule).
  function isVoxelSolidByIndex(ix: number, iy: number, iz: number): boolean {
    const { min, max } = meta.gridBounds;
    const resolution = meta.voxelResolution;
    const countX = Math.round((max[0] - min[0]) / resolution);
    const countY = Math.round((max[1] - min[1]) / resolution);
    const countZ = Math.round((max[2] - min[2]) / resolution);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= countX || iy >= countY || iz >= countZ) return false;

    const bx = Math.floor(ix / meta.leafSize);
    const by = Math.floor(iy / meta.leafSize);
    const bz = Math.floor(iz / meta.leafSize);

    function checkNode(nodeIndex: number): boolean {
      const node = nodes[nodeIndex];
      if (node === 0xff000000) return true;
      const childMask = node >>> 24;
      if (childMask !== 0) return false;
      const offset = node & 0x00ffffff;
      const bit = (ix & 3) + (iy & 3) * 4 + (iz & 3) * 16;
      const word = leafData[offset * 2 + (bit >= 32 ? 1 : 0)] ?? 0;
      return (word & (1 << (bit & 31))) !== 0;
    }

    let nodeIndex = 0;
    for (let level = meta.treeDepth - 1; level >= 0; level--) {
      const node = nodes[nodeIndex];
      if (node === 0xff000000) return true;
      const childMask = node >>> 24;
      const offset = node & 0x00ffffff;
      if (childMask === 0) return checkNode(nodeIndex);
      const octant = (((bx >> level) & 1) << 0) | (((by >> level) & 1) << 1) | (((bz >> level) & 1) << 2);
      const bit = 1 << octant;
      if ((childMask & bit) === 0) return false;
      nodeIndex = offset + popcount(childMask & (bit - 1));
      if (nodeIndex < 0 || nodeIndex >= nodes.length) return false;
    }
    return checkNode(nodeIndex);
  }

  // Horizontal-only capsule push-out (ported from the Aholo walk-demo's
  // resolveDeepestPenetrationCapsule/resolveIterative, restricted to x/z so
  // it composes cleanly with the existing vertical gravity/ground code above
  // instead of fighting it). Finds the strongest push out of nearby solid
  // voxels, iterating a few times so corners don't trap the capsule.
  function queryCapsulePush(cx: number, cy: number, cz: number, halfHeight: number, radius: number) {
    const resolution = meta.voxelResolution;
    const { min } = meta.gridBounds;
    const segMinY = cy - halfHeight;
    const segMaxY = cy + halfHeight;

    function deepestPush(rx: number, rz: number): { x: number; z: number } | null {
      const ixMin = Math.floor((rx - radius - min[0]) / resolution);
      const ixMax = Math.floor((rx + radius - min[0]) / resolution);
      const iyMin = Math.floor((segMinY - min[1]) / resolution);
      const iyMax = Math.floor((segMaxY - min[1]) / resolution);
      const izMin = Math.floor((rz - radius - min[2]) / resolution);
      const izMax = Math.floor((rz + radius - min[2]) / resolution);
      let bestPushX = 0;
      let bestPushZ = 0;
      let bestPen = CAPSULE_PENETRATION_EPSILON;
      let found = false;

      for (let iz = izMin; iz <= izMax; iz++) {
        for (let iy = iyMin; iy <= iyMax; iy++) {
          for (let ix = ixMin; ix <= ixMax; ix++) {
            if (!isVoxelSolidByIndex(ix, iy, iz)) continue;
            const vMinX = min[0] + ix * resolution;
            const vMinZ = min[2] + iz * resolution;
            const vMaxX = vMinX + resolution;
            const vMaxZ = vMinZ + resolution;
            const nearX = Math.max(vMinX, Math.min(rx, vMaxX));
            const nearZ = Math.max(vMinZ, Math.min(rz, vMaxZ));
            const dx = rx - nearX;
            const dz = rz - nearZ;
            const distSq = dx * dx + dz * dz;
            if (distSq >= radius * radius) continue;

            let px = 0;
            let pz = 0;
            let penetration: number;
            if (distSq > 1e-12) {
              const dist = Math.sqrt(distSq);
              penetration = radius - dist;
              px = (dx / dist) * penetration;
              pz = (dz / dist) * penetration;
            } else {
              const escapeX = Math.min(rx - vMinX, vMaxX - rx) + radius;
              const escapeZ = Math.min(rz - vMinZ, vMaxZ - rz) + radius;
              if (escapeX <= escapeZ) {
                px = rx - vMinX < vMaxX - rx ? -escapeX : escapeX;
                penetration = escapeX;
              } else {
                pz = rz - vMinZ < vMaxZ - rz ? -escapeZ : escapeZ;
                penetration = escapeZ;
              }
            }
            if (penetration > bestPen) {
              bestPen = penetration;
              bestPushX = px;
              bestPushZ = pz;
              found = true;
            }
          }
        }
      }
      return found ? { x: bestPushX, z: bestPushZ } : null;
    }

    let rx = cx;
    let rz = cz;
    let totalX = 0;
    let totalZ = 0;
    let hadCollision = false;
    const normals: { x: number; z: number }[] = [];
    for (let iter = 0; iter < MAX_RESOLVE_ITERATIONS; iter++) {
      const push = deepestPush(rx, rz);
      if (!push) break;
      hadCollision = true;
      let { x: px, z: pz } = push;
      for (const n of normals) {
        const dot = px * n.x + pz * n.z;
        if (dot < 0) {
          px -= dot * n.x;
          pz -= dot * n.z;
        }
      }
      const len = Math.hypot(push.x, push.z);
      if (len > CAPSULE_PENETRATION_EPSILON && normals.length < 2) {
        normals.push({ x: push.x / len, z: push.z / len });
      }
      rx += px;
      rz += pz;
      totalX += px;
      totalZ += pz;
    }
    const totalLenSq = totalX * totalX + totalZ * totalZ;
    return hadCollision && totalLenSq > CAPSULE_PENETRATION_EPSILON * CAPSULE_PENETRATION_EPSILON
      ? { x: totalX, z: totalZ }
      : null;
  }

  return { meta, nodes, leafData, isOccupied, queryCapsulePush };
}

function createPanel() {
  const panel = document.createElement("section");
  panel.className = "viewer-panel";
  panel.innerHTML = `
    <div class="viewer-row">
      <label>Preset <select data-preset></select></label>
    </div>
    <div class="viewer-row">
      <button type="button" data-reset>Reset View</button>
      <button type="button" data-copy>Copy State</button>
      <button type="button" data-paste>Paste State</button>
    </div>
    <div class="viewer-row">
      <label>Character <select data-character></select></label>
    </div>
    <pre data-status>Loading...</pre>
  `;
  document.body.append(panel);

  const preset = panel.querySelector<HTMLSelectElement>("[data-preset]")!;
  for (const [id, value] of Object.entries(PRESETS)) {
    preset.add(new Option(value.label, id));
  }
  preset.value = "performance";

  const character = panel.querySelector<HTMLSelectElement>("[data-character]")!;
  character.add(new Option("First person", "off"));
  for (const [id, value] of Object.entries(THIRD_PERSON_CHARACTERS)) {
    character.add(new Option(`Third person: ${value.label}`, id));
  }
  character.value = "off";

  return {
    panel,
    preset,
    reset: panel.querySelector<HTMLButtonElement>("[data-reset]")!,
    copy: panel.querySelector<HTMLButtonElement>("[data-copy]")!,
    paste: panel.querySelector<HTMLButtonElement>("[data-paste]")!,
    status: panel.querySelector<HTMLPreElement>("[data-status]")!,
    character,
  };
}

function applyBaseStyles() {
  const style = document.createElement("style");
  style.textContent = `
    html, body, #app {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #000;
    }
    canvas {
      display: block;
    }
    .viewer-panel {
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 10;
      display: grid;
      gap: 8px;
      width: min(360px, calc(100vw - 24px));
      padding: 10px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      background: rgba(4, 7, 10, 0.78);
      color: #e7f6ef;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      backdrop-filter: blur(12px);
    }
    .viewer-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .viewer-row label { display: grid; gap: 4px; min-width: 112px; }
    .viewer-panel select,
    .viewer-panel button {
      min-height: 30px;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      color: inherit;
      font: inherit;
    }
    .viewer-panel button { padding: 0 10px; cursor: pointer; }
    .viewer-panel pre { margin: 0; white-space: pre-wrap; color: #c7ffdc; }
    .viewer-instructions {
      position: fixed;
      top: 12px;
      left: 12px;
      z-index: 10;
      display: grid;
      gap: 6px;
      padding: 10px 14px;
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 8px;
      background: rgba(4, 7, 10, 0.78);
      color: #e7f6ef;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      backdrop-filter: blur(12px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease;
    }
    .viewer-instructions.visible { opacity: 1; }
    .viewer-instructions .row { display: flex; gap: 8px; align-items: center; }
    .viewer-instructions kbd {
      display: inline-block;
      min-width: 16px;
      padding: 1px 5px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.28);
      border-radius: 4px;
      background: rgba(255,255,255,0.08);
      font: inherit;
    }
  `;
  document.head.append(style);
}

/** Control legend shown while the pointer is over the canvas — same keys CameraControl (WASD/QE/RF/wheel/drag) and the jump/reset UI actually respond to. */
function createInstructionsOverlay() {
  const el = document.createElement("section");
  el.className = "viewer-instructions";
  el.innerHTML = `
    <div class="row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</div>
    <div class="row"><kbd>Q</kbd><kbd>E</kbd> Rise / Descend</div>
    <div class="row"><kbd>R</kbd><kbd>F</kbd> Roll</div>
    <div class="row"><kbd>Space</kbd> Jump</div>
    <div class="row">Drag Look</div>
    <div class="row">Scroll Zoom</div>
  `;
  document.body.append(el);
  return el;
}

function syncCameraAspect(camera: PerspectiveCamera, viewer: ReturnType<typeof createViewer>) {
  const { width, height } = viewer.getSize();
  const aspect = width > 0 && height > 0 ? width / height : 1;
  if (Number.isFinite(aspect) && Math.abs(camera.aspect - aspect) > 0.001) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix?.();
  }
}

function setCameraCoordinate(camera: PerspectiveCamera) {
  camera.up.set(CAMERA_UP[0], CAMERA_UP[1], CAMERA_UP[2]);
}

function resetCamera(camera: PerspectiveCamera, control: CameraControl) {
  setCameraCoordinate(camera);
  camera.position.set(-2, 0.45, 4);
  camera.lookAt(new Vector3(-2, 0.45, 0));
  control.setOrbitCenter({ x: -2, y: 0.45, z: 0 });
  control.stop();
}

function snapshotCamera(camera: PerspectiveCamera) {
  return JSON.stringify(
    {
      position: camera.position,
      rotation: camera.rotation,
      up: camera.up,
    },
    null,
    2,
  );
}

function restoreCamera(camera: PerspectiveCamera, text: string) {
  const state = JSON.parse(text) as {
    position?: Partial<Vector3>;
    rotation?: { x?: number; y?: number; z?: number; order?: string };
    up?: Partial<Vector3>;
  };
  if (state.position) {
    camera.position.set(state.position.x ?? 0, state.position.y ?? 0, state.position.z ?? 0);
  }
  if (state.up) {
    camera.up.set(state.up.x ?? 0, state.up.y ?? 1, state.up.z ?? 0);
  }
  if (state.rotation) {
    camera.rotation.set(
      state.rotation.x ?? 0,
      state.rotation.y ?? 0,
      state.rotation.z ?? 0,
      state.rotation.order,
    );
  }
}

function disposeSceneObject(object: Object3D) {
  object.freeAllGpuResourceOwned?.();
}

// Brush occasionally emits a handful of oversized, mis-optimized gaussians
// (orders of magnitude bigger than the p99 splat) that render as dark
// floating blobs. Zero their alpha so they stay in the buffer but draw
// nothing.
// ponytail: flat scale cap tuned by eye for this scene; a percentile-relative
// cap would generalize better if other scenes need this.
const FLOATER_SCALE_CAP = 3;

function removeFloaters(data: SplatLoader.SplatData) {
  const single = {} as SplatLoader.ISingleSplat;
  let removed = 0;
  for (let i = 0; i < data.counts; i++) {
    data.getScale(i, single);
    if (Math.max(single.sx, single.sy, single.sz) > FLOATER_SCALE_CAP) {
      data.setAlpha(i, 0);
      removed++;
    }
  }
  if (removed > 0) console.log(`[walkthrough] removed ${removed} floater splat(s)`);
}

// -----------------------------------------------------------------------------
// Third-person avatar (ported/trimmed from Aholo's walk-demo example: dropped
// scheme switching, LOD streaming, and camera-occlusion raycasting — this
// project only needs "load one GLB, animate idle/walk, follow the player").
// -----------------------------------------------------------------------------

const THIRD_PERSON_MODEL_SCALE = 0.5;
// Mixamo-style rigs are typically authored at ~1 unit = 1cm.
const MODEL_UNIT_TO_METERS = 0.01;
const CHARACTER_LOCOMOTION_IDLE_ENTER_SPEED = 0.05;
const CHARACTER_LOCOMOTION_WALK_ENTER_SPEED = 0.12;
const FADE_SECONDS = 0.18;
type CharacterActionName = "Idle" | "Walk";

interface ActionFade {
  action: InstanceType<typeof Animation.AnimationAction>;
  from: number;
  to: number;
  elapsed: number;
  duration: number;
}

class WalkThirdPersonCharacter {
  private readonly characterRoot = new Object3D();
  // Kept as a pass-through node (no rotation) rather than removed outright —
  // confirmed via the test-main.ts walk-demo port that this GLB renders
  // right-side up with zero correction; an earlier "Y-down world needs a
  // 180° upright flip" theory here was wrong and was the actual cause of the
  // character appearing upside down, not a fix for it.
  private readonly uprightFix = new Object3D();
  private readonly lights = new Object3D();
  private mixer: InstanceType<typeof Animation.AnimationMixer> | null = null;
  private actions: Partial<Record<CharacterActionName, InstanceType<typeof Animation.AnimationAction>>> = {};
  private activeAction: InstanceType<typeof Animation.AnimationAction> | null = null;
  private locomotionAnim: CharacterActionName = "Idle";
  private actionFades: ActionFade[] = [];
  private animationPlugin: InstanceType<typeof Animation.AnimationPlugin> | null = null;
  private boundMeshes: object[] = [];

  loaded = false;
  loadError = false;
  private enabled = false;
  private loadPromise: Promise<void> | undefined;
  private readonly abort = new AbortController();
  private smoothedYaw = 0;

  static readonly FACING_OFFSET = Math.PI;

  constructor(
    private readonly scene: Scene3D,
    private readonly viewer: ReturnType<typeof createViewer>,
    private modelUrl: string,
  ) {
    this.characterRoot.visible = false;
    this.characterRoot.scale.setScalar(THIRD_PERSON_MODEL_SCALE);
    // Reverted to the confirmed-rendering baseline (character shows up,
    // upside down) rather than the "no flip needed" version — that version
    // couldn't be re-verified as actually rendering. Fix orientation from
    // here without touching the rendering path itself.
    this.uprightFix.rotation.z = Math.PI;
    this.characterRoot.add(this.uprightFix);
    this.lights.visible = false;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.characterRoot.visible = enabled && this.loaded && !this.loadError;
    this.lights.visible = enabled && this.loaded && !this.loadError;
    if (enabled) this.ensureLoaded();
  }

  /** Swap to a different character GLB, discarding the currently loaded model. */
  switchModel(url: string) {
    if (this.modelUrl === url) return;
    this.modelUrl = url;
    this.teardownAnimation();
    disposeSceneObject(this.uprightFix);
    this.uprightFix.removeAllChildren();
    this.loaded = false;
    this.loadError = false;
    this.loadPromise = undefined;
    this.characterRoot.visible = false;
    this.lights.visible = false;
    if (this.enabled) this.ensureLoaded();
  }

  /**
   * Release the previous model's skeleton bindings and mixer. Without this the
   * plugin keeps updating the discarded model's skeletons every frame and its
   * skeletonMap grows with every character switch.
   */
  private teardownAnimation() {
    for (const mesh of this.boundMeshes) this.animationPlugin?.unbindSkinned(mesh as never);
    this.boundMeshes = [];
    if (this.mixer) this.animationPlugin?.remove(this.mixer as never);
    this.mixer = null;
    this.actions = {};
    this.activeAction = null;
    this.actionFades = [];
  }

  private ensureLoaded() {
    if (this.loaded || this.loadError || this.loadPromise) return;
    this.loadPromise = this.load();
  }

  private async load() {
    const { signal } = this.abort;
    // A switch away mid-load must not have its model land in the scene when the
    // slow load finally resolves — switchModel() clears loadPromise, so the two
    // loads would otherwise both complete and both add a character.
    const url = this.modelUrl;
    const stale = () => signal.aborted || this.modelUrl !== url;
    try {
      const response = await fetch(url, { signal });
      const buffer = await response.arrayBuffer();
      if (stale()) return;
      const result = await loadGLTF(buffer, { textureLoader: downloadTexture });
      if (stale()) return;

      const model = result.scene as unknown as Object3D;
      // One plugin for the character's lifetime — registering a fresh one per
      // model switch would leave the old one running in the viewer forever.
      if (!this.animationPlugin) {
        this.animationPlugin = new AnimationPlugin();
        this.animationPlugin.registerToViewer({ viewer: this.viewer } as never);
      }
      this.mixer = new AnimationMixer(model as never);
      this.animationPlugin.add(this.mixer);

      const bound = new WeakSet<object>();
      (result.skeletons as Map<unknown, unknown[]>).forEach((skinnedMeshes, iSkeleton) => {
        const sk = iSkeleton as { bones: unknown; inverseBindMatrices: unknown };
        const skeleton = new Skeleton(sk.bones as never, sk.inverseBindMatrices as never);
        (skinnedMeshes as object[]).forEach((skinnedMesh) => {
          if (bound.has(skinnedMesh)) return;
          bound.add(skinnedMesh);
          this.animationPlugin!.bindSkinned(skinnedMesh as never, skeleton, this.mixer as never);
          this.boundMeshes.push(skinnedMesh);
        });
      });

      // Bounding-box-based auto-scale (normalizeModel, below) measures
      // correctly in the standalone walk-demo test route (test-main.ts) but
      // has not reproduced that in this app despite matching timing/ordering
      // as closely as I can tell — some other difference between the two
      // entry points is still unaccounted for. Using the fixed-scale
      // constant here instead, which is the confirmed-rendering baseline —
      // don't swap this for the bounding-box version again without
      // re-verifying end to end.
      model.scale.setScalar(MODEL_UNIT_TO_METERS);
      this.uprightFix.add(model);
      this.setupActions((result.animations ?? []) as AnimationClip[]);

      if (this.lights.children.length === 0) {
        const ambient = new AmbientLight(0xffffff, 0.75);
        const key = new DirectionalLight(0xffffff, 1.1);
        key.position.set(0.4, 1.0, 0.35);
        this.lights.add(ambient as never);
        this.lights.add(key as never);
      }
      if (this.lights.parent !== this.scene) this.scene.add(this.lights as never);
      if (this.characterRoot.parent !== this.scene) this.scene.add(this.characterRoot as never);
      (this.scene as { notifySceneChange?: () => void }).notifySceneChange?.();

      this.loaded = true;
      this.characterRoot.visible = this.enabled;
      this.lights.visible = this.enabled;
      this.viewer.render();
    } catch (error) {
      if (stale()) return;
      console.error("[walkthrough] character avatar load failed:", error);
      this.loadError = true;
    }
  }

  // A bounding-box-based auto-scale/center (normalizeModel + its helpers)
  // was tried here and reverted — see the comment in load() above. The
  // working version of that logic lives in test-main.ts if this is
  // revisited; don't rebuild it from scratch.

  private setupActions(clips: AnimationClip[]) {
    if (!this.mixer) return;
    const find = (name: string) => clips.find((c) => c.name.toLowerCase().includes(name)) ?? null;
    const map: Partial<Record<CharacterActionName, AnimationClip | null>> = {
      Idle: find("idle"),
      Walk: find("walk") || find("run") || find("mixamo.com"),
    };
    for (const name of Object.keys(map) as CharacterActionName[]) {
      const clip = map[name];
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.active = false;
      action.weight = 0;
      this.actions[name] = action;
    }
    const idle = this.actions.Idle ?? Object.values(this.actions)[0] ?? null;
    this.activate(idle, 0);
  }

  private activate(next: InstanceType<typeof Animation.AnimationAction> | null, fadeSeconds: number) {
    if (next === this.activeAction) return;
    if (this.activeAction) this.fade(this.activeAction, 0, fadeSeconds);
    this.activeAction = next;
    if (next) {
      next.reset();
      next.active = true;
      this.fade(next, 1, fadeSeconds);
    }
  }

  private fade(action: InstanceType<typeof Animation.AnimationAction>, to: number, duration: number) {
    this.actionFades = this.actionFades.filter((f) => f.action !== action);
    if (duration <= 0) {
      action.weight = to;
      action.active = to > 0;
      return;
    }
    this.actionFades.push({ action, from: action.weight, to, elapsed: 0, duration });
  }

  private updateFades(dt: number) {
    if (this.actionFades.length === 0) return;
    const remaining: ActionFade[] = [];
    for (const f of this.actionFades) {
      f.elapsed += Math.max(0, dt);
      const t = Math.min(1, f.elapsed / f.duration);
      f.action.weight = f.from + (f.to - f.from) * t;
      if (t < 1) remaining.push(f);
      else if (f.to === 0) f.action.active = false;
    }
    this.actionFades = remaining;
  }

  /** Position the avatar at world (feetX, feetY, feetZ) facing `yaw` (radians, same convention as camera.rotation.y). */
  update(feetX: number, feetY: number, feetZ: number, yaw: number, speed: number, dt: number) {
    if (!this.loaded || this.loadError) return;
    this.characterRoot.position.set(feetX, feetY, feetZ);
    const wrapped = Math.atan2(Math.sin(yaw - this.smoothedYaw), Math.cos(yaw - this.smoothedYaw));
    this.smoothedYaw += wrapped * Math.min(1, 14 * Math.max(0, dt));
    this.characterRoot.rotation.y = this.smoothedYaw + WalkThirdPersonCharacter.FACING_OFFSET;
    this.characterRoot.updateMatrixWorld(true);

    if (this.locomotionAnim === "Walk") {
      if (speed < CHARACTER_LOCOMOTION_IDLE_ENTER_SPEED) this.locomotionAnim = "Idle";
    } else if (speed > CHARACTER_LOCOMOTION_WALK_ENTER_SPEED) {
      this.locomotionAnim = "Walk";
    }
    const next = this.actions[this.locomotionAnim] ?? this.actions.Idle ?? null;
    this.activate(next, FADE_SECONDS);
    this.updateFades(dt);
  }

  dispose() {
    this.abort.abort();
    this.teardownAnimation();
    try {
      (this.viewer as { unregisterPlugin?: (p: unknown) => void }).unregisterPlugin?.(this.animationPlugin);
    } catch {
      /* ignore */
    }
    this.characterRoot.removeFromParent?.();
    this.lights.removeFromParent?.();
    this.loaded = false;
  }
}

type AnnealState = {
  modifier: SplatModifier;
  startedAt: number;
  done: boolean;
};

async function main() {
  applyBaseStyles();

  const container = document.getElementById("app");
  if (!container) throw new Error("#app container not found");
  container.style.width = "100vw";
  container.style.height = "100vh";
  container.style.display = "block";

  const controls = createPanel();
  const viewer = createViewer("walkthrough-viewer", container, { antialiasing: false });
  const camera = new PerspectiveCamera(60, 1, 0.1, 2000);
  // Third-person is a separate camera that only *reads* `camera`'s
  // position/orientation each frame (see updateThirdPersonCamera below) —
  // it never writes back to it, so the first-person camera stays the single
  // source of truth for movement/collision/gravity, unchanged either way.
  const thirdPersonCamera = new PerspectiveCamera(60, 1, 0.1, 2000);
  thirdPersonCamera.up.set(CAMERA_UP[0], CAMERA_UP[1], CAMERA_UP[2]);
  let thirdPersonEnabled = false;
  const thirdPersonCharacter = new WalkThirdPersonCharacter(viewer.getScene(), viewer, ROBOT_MODEL_URL);
  const instructions = createInstructionsOverlay();
  container.addEventListener("mouseenter", () => instructions.classList.add("visible"));
  container.addEventListener("mouseleave", () => instructions.classList.remove("visible"));
  const worldDirScratch = new Vector3();
  const control = new CameraControl(camera, container, {
    enabled: true,
    moveSpeed: 2.2,
    lookSpeed: 0.004,
    wheelSpeed: 0.006,
  });

  let currentPreset: PresetId = "performance";
  let collision: VoxelCollision | null = null;
  let currentSplat: SplatObject | null = null;
  let currentAnneal: AnnealState | null = null;
  let loadVersion = 0;
  let renderRequested = true;
  let lastTime = 0;
  let frameCount = 0;
  let fps = 0;
  let fpsLastTime = performance.now();
  let statusPrefix = "Loading";
  let verticalVelocity = 0;
  let lastPlayerX = camera.position.x;
  let lastPlayerZ = camera.position.z;
  let spacePressed = false;
  let grounded = false;

  container.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      spacePressed = true;
      event.preventDefault();
    }
  });
  container.addEventListener("keyup", (event) => {
    if (event.code === "Space") spacePressed = false;
  });

  const requestRender = () => {
    renderRequested = true;
  };

  viewer.requestRenderHandler = requestRender;
  viewer.setCamera(camera);
  resetCamera(camera, control);

  // Debug hook for scripted camera placement (e.g. checking a specific
  // reconstruction-hole pose) from the browser console.
  (window as unknown as { __wtCamera: unknown; __wtControl: unknown }).__wtCamera = camera;
  (window as unknown as { __wtCamera: unknown; __wtControl: unknown }).__wtControl = control;
  (window as unknown as { __wtRobot: unknown }).__wtRobot = thirdPersonCharacter;

  function applyViewerConfig() {
    setViewerConfig(viewer, {
      pixelRatio: 1 / window.devicePixelRatio,
      pipeline: {
        Background: {
          background: {
            active: BackgroundMode.BasicBackground,
            basic: { color: new Color(0, 0, 0), alpha: 1 },
          },
          ground: { enabled: false },
        },
        Splatting: {
          enabled: true,
          ...(PRESETS[currentPreset].config as object),
        },
        TAA: { enabled: false },
      },
    });
    requestRender();
  }

  function clearScene() {
    currentAnneal = null;
    currentSplat?.setModifiers([]);
    currentSplat?.freeAllGpuResourceOwned?.();
    currentSplat = null;
    for (const child of viewer.getScene().removeAllChildren()) {
      disposeSceneObject(child);
    }
  }

  async function loadSplat() {
    const version = ++loadVersion;
    const preset = PRESETS[currentPreset];
    statusPrefix = `Importing ${preset.label}`;
    controls.status.textContent = `${statusPrefix}...`;
    clearScene();
    applyViewerConfig();
    requestRender();

    const fileType = SplatLoader.detectSplatFileType(SPLAT_URL, new Uint8Array());
    if (fileType === undefined) {
      throw new Error(`Unsupported splat resource: ${SPLAT_URL}`);
    }

    const data = await SplatLoader.parseSplatData(fileType, SPLAT_URL, preset.packType, {
      maxShDegree: preset.maxShDegree,
      maxTextureSize: 8192,
    });
    if (version !== loadVersion) return;
    removeFloaters(data);
    const modifier = createMcmcAnnealModifier(measureSplatCloud(data));

    const splat = await SplatUtils.createSplat(data);
    if (version !== loadVersion) {
      splat.freeAllGpuResourceOwned?.();
      return;
    }

    splat.autoFreeResourceOnGpuPacked = preset.autoFreeResourceOnGpuPacked;
    splat.setModifiers([modifier]);
    currentSplat = splat;
    currentAnneal = { modifier, startedAt: performance.now(), done: false };
    statusPrefix = `Annealing ${preset.label}`;
    viewer.getScene().add(splat as Object3D);
    requestRender();
  }

  controls.preset.addEventListener("change", async () => {
    currentPreset = controls.preset.value as PresetId;
    await loadSplat();
  });
  controls.reset.addEventListener("click", () => {
    resetCamera(camera, control);
    verticalVelocity = 0;
    requestRender();
  });
  controls.copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(snapshotCamera(camera));
  });
  controls.paste.addEventListener("click", async () => {
    restoreCamera(camera, await navigator.clipboard.readText());
    requestRender();
  });
  controls.character.addEventListener("change", () => {
    const id = controls.character.value as ThirdPersonCharacterId | "off";
    thirdPersonEnabled = id !== "off";
    if (id === "off") {
      thirdPersonCharacter.setEnabled(false);
    } else {
      thirdPersonCharacter.switchModel(THIRD_PERSON_CHARACTERS[id].url);
      thirdPersonCharacter.setEnabled(true);
    }
    viewer.setCamera(thirdPersonEnabled ? thirdPersonCamera : camera);
    requestRender();
  });

  /** Third-person camera sits behind+above `camera` (the real, physics-driven
   * position) and only reads it — see the comment where thirdPersonCamera is
   * created. Avatar is placed at `camera`'s feet position each frame too. */
  function updateThirdPersonCamera(delta: number) {
    thirdPersonCamera.aspect = camera.aspect;
    camera.getWorldDirection(worldDirScratch);
    const yaw = Math.atan2(worldDirScratch.x, worldDirScratch.z);

    thirdPersonCamera.position.set(
      camera.position.x - worldDirScratch.x * THIRD_PERSON_DISTANCE,
      camera.position.y - THIRD_PERSON_HEIGHT,
      camera.position.z - worldDirScratch.z * THIRD_PERSON_DISTANCE,
    );
    thirdPersonCamera.lookAt(new Vector3(camera.position.x, camera.position.y - THIRD_PERSON_HEIGHT * 0.4, camera.position.z));
    thirdPersonCamera.updateMatrixWorld(true);

    const feetY = camera.position.y + FEET_OFFSET;
    const speed = Math.hypot(camera.position.x - lastPlayerX, camera.position.z - lastPlayerZ) / Math.max(delta, 1 / 240);
    thirdPersonCharacter.update(camera.position.x, feetY, camera.position.z, yaw, speed, delta);
    lastPlayerX = camera.position.x;
    lastPlayerZ = camera.position.z;
  }

  function handleViewportResize() {
    viewer.resize();
    syncCameraAspect(camera, viewer);
    syncCameraAspect(thirdPersonCamera, viewer);
    requestRender();
  }

  window.addEventListener("resize", handleViewportResize);
  document.addEventListener("fullscreenchange", handleViewportResize);
  const resizeObserver = new ResizeObserver(handleViewportResize);
  resizeObserver.observe(container);

  collision = await loadVoxelCollision();
  resetCamera(camera, control);
  applyViewerConfig();
  await loadSplat();

  function tick(time: number) {
    const delta = lastTime > 0 ? Math.min((time - lastTime) / 1000, 0.1) : 0;
    lastTime = time;

    const cameraChanged = control.update(delta);
    if (cameraChanged) {
      if (collision) {
        // Horizontal wall push-out only; vertical stays fully owned by the
        // gravity/ground block below so the two don't fight each other.
        const capsuleCenterY = camera.position.y + FEET_OFFSET - CAPSULE_HALF_HEIGHT;
        const push = collision.queryCapsulePush(
          camera.position.x,
          capsuleCenterY,
          camera.position.z,
          CAPSULE_HALF_HEIGHT,
          CAPSULE_RADIUS,
        );
        if (push) {
          camera.position.x += push.x;
          camera.position.z += push.z;
        }
      }
      requestRender();
    }

    if (collision) {
      const feetY = camera.position.y + FEET_OFFSET;
      grounded = collision.isOccupied(new Vector3(camera.position.x, feetY + GROUND_PROBE, camera.position.z));

      if (grounded && verticalVelocity >= 0) {
        verticalVelocity = spacePressed ? -JUMP_SPEED : 0;
      } else {
        verticalVelocity += GRAVITY * delta;
      }

      // No floor data everywhere in this scene (~63% of the room has none) —
      // fall back to the grid's own boundary as a safety floor so falls stay
      // bounded instead of dropping forever through undefined space.
      const maxY = collision.meta.gridBounds.max[1] - FEET_OFFSET - GROUND_PROBE;
      let nextY = camera.position.y + verticalVelocity * delta;
      if (nextY > maxY) {
        nextY = maxY;
        verticalVelocity = 0;
      }

      if (nextY !== camera.position.y) {
        const nextFeetY = nextY + FEET_OFFSET;
        if (verticalVelocity > 0 && collision.isOccupied(new Vector3(camera.position.x, nextFeetY, camera.position.z))) {
          verticalVelocity = 0;
        } else {
          camera.position.y = nextY;
          requestRender();
        }
      }
    }

    if (thirdPersonEnabled) {
      updateThirdPersonCamera(delta);
      requestRender(); // keep idle/walk animation playing even while stationary
    }

    if (currentAnneal && currentSplat) {
      const elapsed = time - currentAnneal.startedAt;
      const progress = openingAnnealProgress(elapsed, ANNEAL_DURATION_MS);
      currentAnneal.modifier.update({ progress, time: elapsed / 1000 });
      requestRender();
      if (progress <= 0) {
        currentSplat.setModifiers([]);
        currentAnneal.done = true;
        currentAnneal = null;
        statusPrefix = PRESETS[currentPreset].label;
      }
    }

    if (renderRequested || currentAnneal) {
      renderRequested = false;
      syncCameraAspect(thirdPersonEnabled ? thirdPersonCamera : camera, viewer);
      viewer.render();
    }

    frameCount++;
    if (time - fpsLastTime > 250) {
      fps = Math.round((frameCount * 1000) / (time - fpsLastTime));
      frameCount = 0;
      fpsLastTime = time;
    }

    const occupied = collision?.isOccupied(camera.position) ?? false;
    controls.status.textContent =
      `${statusPrefix} / ${COORDINATE_LABEL}\n` +
      `fps: ${fps}  collision: ${occupied ? "inside solid" : "free"}  grounded: ${grounded}\n` +
      `pos: ${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}`;

    requestAnimationFrame(tick);
  }

  handleViewportResize();
  requestAnimationFrame(tick);
}

main().catch((error) => {
  console.error(error);
  const pre = document.createElement("pre");
  pre.textContent = String(error?.stack ?? error);
  document.body.append(pre);
});
