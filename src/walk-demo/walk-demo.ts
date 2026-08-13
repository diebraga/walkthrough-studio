/**
 * @file Walk demo: splats + collision + ViewerWalkMode.
 *
 * Derived from SuperSplat Viewer (MIT) and adapted for Aholo Viewer, voxel collision, and the website runtime.
 *
 * Reading order for code display:
 * 1. Voxel collision data and queries.
 * 2. Capsule push-out and walk controller.
 * 3. Character presentation.
 * 4. Demo scene wiring, presets, and resource loading.
 *
 * Scene presets and spawn poses are defined near the bottom of the file.
 */
import type { FolderApi, Pane } from 'tweakpane';
import type { RenderRuntime, RuntimeIndexedDBStorage } from './render-runtime.js';
import {
    AmbientLight,
    Animation,
    BackgroundMode,
    DirectionalLight,
    createViewerContext,
    downloadTexture,
    SplatLoader,
    GLTFLoader,
    Object3D,
    PerspectiveCamera,
    Quaternion,
    setViewerConfig,
    SplatUtils,
    Vector3,
    Euler,
    Box3,
    Color,
} from '@manycore/aholo-viewer';
import type { Scene3D, Viewer } from '@manycore/aholo-viewer';
import { CollisionDebugOverlay } from './collision-debug';
import { activeDevFlags, devEnabled, envDevFlagsActive, readDevToggle, writeDevToggle } from './dev-settings';
import {
    ANNEAL_DURATION_MS,
    createMcmcAnnealModifier,
    measureSplatCloud,
    openingAnnealProgress,
} from '../anneal';
import {
    createPortal,
    loadPortals,
    nextPortalName,
    portalAt,
    savePortals,
    type Portal,
} from './portals';
import { resolvePortalTeleport, type TeleportPose } from './teleport';
import { flyVector } from './fly-mode';
import { mobileJoystickInput } from './mobile-joystick';
import { clampPitch, nextLookAngles } from './walk-look';
import { splatFileTypeUrl } from './splat-file-type';
import { formatDeveloperPose } from './dev-position';
import { splatUrl } from './asset-url';
import { FloorPlaneCollision, type FloorPlaneOptions } from './floor-plane';
import { GridCollision, type CollisionGridData } from './grid-collision';
import {
    CombinedCollision,
    EMPTY_MANUAL_COLLISION,
    ManualCollision,
    eraseManualCollisionAt,
    loadManualCollision,
    saveManualCollision,
    type ManualCollisionData,
} from './manual-collision';

/**
 * Synthetic floor for the local hall-3 scene, measured from the leveled splat:
 * plane fit to the floor gaussians gives y = -1.622 at 0.15 deg tilt (4.5 cm
 * rms), and the floor's own footprint bounds the rectangle to the interior
 * walls. Set to null to fall back to voxel-only collision.
 */
const WALK_FLOOR_PLANE: FloorPlaneOptions | null = {
    y: -1.622,
    minX: -6.5,
    maxX: 5.0,
    minZ: -4.0,
    maxZ: 4.0,
};

const AnimationPlugin = Animation.AnimationPlugin;
const AnimationMixer = Animation.AnimationMixer;
const Skeleton = Animation.Skeleton;

const { CompressedSplatData, parseSplatData, detectSplatFileType, SplatPackType } = SplatLoader;
type SerializedCompressedSplatData = Parameters<InstanceType<typeof CompressedSplatData>['deserialize']>[0];
const { createSplat, LodSplat } = SplatUtils;
const { loadGLTF } = GLTFLoader;

type AnimationClip = Animation.AnimationClip;

// -----------------------------------------------------------------------------
// Voxel collision data and queries
// -----------------------------------------------------------------------------

const SOLID_LEAF_MARKER = 0xff000000 >>> 0;
const PENETRATION_EPSILON = 1e-4;
const MAX_RESOLVE_ITERATIONS = 4;

/**
 * Sparse voxel collision field. The walk controller only needs point occupancy, raycast, and capsule push-out.
 */
export class VoxelCollision {
    private gridMinX: number;
    private gridMinY: number;
    private gridMinZ: number;
    private voxelCountX: number;
    private voxelCountY: number;
    private voxelCountZ: number;
    private voxelSize: number;
    private leafSize: number;
    private treeDepth: number;
    private nodes: Uint32Array;
    private leafData: Uint32Array;
    private scratchPush: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
    private contactNormals: { x: number; y: number; z: number }[] = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
    ];

    constructor(
        metadata: {
            gridBounds: { min: number[]; max: number[] };
            voxelResolution: number;
            leafSize: number;
            treeDepth: number;
        },
        nodes: Uint32Array,
        leafData: Uint32Array,
    ) {
        this.gridMinX = metadata.gridBounds.min[0];
        this.gridMinY = metadata.gridBounds.min[1];
        this.gridMinZ = metadata.gridBounds.min[2];
        const voxelSize = metadata.voxelResolution;
        this.voxelCountX = Math.round((metadata.gridBounds.max[0] - metadata.gridBounds.min[0]) / voxelSize);
        this.voxelCountY = Math.round((metadata.gridBounds.max[1] - metadata.gridBounds.min[1]) / voxelSize);
        this.voxelCountZ = Math.round((metadata.gridBounds.max[2] - metadata.gridBounds.min[2]) / voxelSize);
        this.voxelSize = voxelSize;
        this.leafSize = metadata.leafSize;
        this.treeDepth = metadata.treeDepth;
        this.nodes = nodes;
        this.leafData = leafData;
    }

    /** Grid layout, for the debug collision overlay in collision-debug.ts. */
    get gridInfo() {
        return {
            minX: this.gridMinX,
            minY: this.gridMinY,
            minZ: this.gridMinZ,
            countX: this.voxelCountX,
            countY: this.voxelCountY,
            countZ: this.voxelCountZ,
            size: this.voxelSize,
        };
    }

    /** Fast point occupancy lookup. */
    isVoxelSolid(ix: number, iy: number, iz: number): boolean {
        if (
            this.nodes.length === 0 ||
            ix < 0 ||
            iy < 0 ||
            iz < 0 ||
            ix >= this.voxelCountX ||
            iy >= this.voxelCountY ||
            iz >= this.voxelCountZ
        ) {
            return false;
        }
        const blockX = Math.floor(ix / this.leafSize);
        const blockY = Math.floor(iy / this.leafSize);
        const blockZ = Math.floor(iz / this.leafSize);
        let nodeIndex = 0;
        for (let level = this.treeDepth - 1; level >= 0; level--) {
            const node = this.nodes[nodeIndex] >>> 0;
            if (node === SOLID_LEAF_MARKER) {
                return true;
            }
            const childMask = (node >>> 24) & 0xff;
            if (childMask === 0) {
                return this.checkLeafByIndex(node, ix, iy, iz);
            }
            const bitX = (blockX >>> level) & 1;
            const bitY = (blockY >>> level) & 1;
            const bitZ = (blockZ >>> level) & 1;
            const octant = (bitZ << 2) | (bitY << 1) | bitX;
            if ((childMask & (1 << octant)) === 0) {
                return false;
            }
            const baseOffset = node & 0x00ffffff;
            const prefix = (1 << octant) - 1;
            nodeIndex = baseOffset + popcount(childMask & prefix);
        }
        const node = this.nodes[nodeIndex] >>> 0;
        if (node === SOLID_LEAF_MARKER) {
            return true;
        }
        return this.checkLeafByIndex(node, ix, iy, iz);
    }

    /** Raycast through voxels for ground snaps and camera blocking checks. */
    queryRay(
        ox: number,
        oy: number,
        oz: number,
        dx: number,
        dy: number,
        dz: number,
        maxDist: number,
    ): { x: number; y: number; z: number } | null {
        if (this.nodes.length === 0) {
            return null;
        }
        const voxelSize = this.voxelSize;
        const gMinX = this.gridMinX;
        const gMinY = this.gridMinY;
        const gMinZ = this.gridMinZ;
        const gMaxX = gMinX + this.voxelCountX * voxelSize;
        const gMaxY = gMinY + this.voxelCountY * voxelSize;
        const gMaxZ = gMinZ + this.voxelCountZ * voxelSize;
        const EPS = 1e-12;

        let tNear = 0;
        let tFar = maxDist;
        const slab = (o: number, d: number, min: number, max: number) => {
            if (Math.abs(d) <= EPS) {
                return o >= min && o < max;
            }
            let t1 = (min - o) / d;
            let t2 = (max - o) / d;
            if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
            }
            if (t1 > tNear) {
                tNear = t1;
            }
            tFar = Math.min(tFar, t2);
            return tNear <= tFar;
        };
        if (!slab(ox, dx, gMinX, gMaxX) || !slab(oy, dy, gMinY, gMaxY) || !slab(oz, dz, gMinZ, gMaxZ)) {
            return null;
        }
        const entryX = ox + dx * tNear;
        const entryY = oy + dy * tNear;
        const entryZ = oz + dz * tNear;
        let ix = Math.max(0, Math.min(Math.floor((entryX - gMinX) / voxelSize), this.voxelCountX - 1));
        let iy = Math.max(0, Math.min(Math.floor((entryY - gMinY) / voxelSize), this.voxelCountY - 1));
        let iz = Math.max(0, Math.min(Math.floor((entryZ - gMinZ) / voxelSize), this.voxelCountZ - 1));

        const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
        const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
        const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
        const invDx = Math.abs(dx) > EPS ? 1 / dx : 0;
        const invDy = Math.abs(dy) > EPS ? 1 / dy : 0;
        const invDz = Math.abs(dz) > EPS ? 1 / dz : 0;
        let tMaxX = Math.abs(dx) > EPS ? (gMinX + (ix + (dx > 0 ? 1 : 0)) * voxelSize - ox) * invDx : Infinity;
        let tMaxY = Math.abs(dy) > EPS ? (gMinY + (iy + (dy > 0 ? 1 : 0)) * voxelSize - oy) * invDy : Infinity;
        let tMaxZ = Math.abs(dz) > EPS ? (gMinZ + (iz + (dz > 0 ? 1 : 0)) * voxelSize - oz) * invDz : Infinity;
        const tDeltaX = Math.abs(dx) > EPS ? voxelSize * Math.abs(invDx) : Infinity;
        const tDeltaY = Math.abs(dy) > EPS ? voxelSize * Math.abs(invDy) : Infinity;
        const tDeltaZ = Math.abs(dz) > EPS ? voxelSize * Math.abs(invDz) : Infinity;
        let currentT = tNear;

        const maxSteps = this.voxelCountX + this.voxelCountY + this.voxelCountZ;
        for (let i = 0; i < maxSteps; i++) {
            if (this.isVoxelSolid(ix, iy, iz)) {
                return { x: ox + dx * currentT, y: oy + dy * currentT, z: oz + dz * currentT };
            }
            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    currentT = tMaxX;
                    ix += stepX;
                    tMaxX += tDeltaX;
                } else {
                    currentT = tMaxZ;
                    iz += stepZ;
                    tMaxZ += tDeltaZ;
                }
            } else if (tMaxY < tMaxZ) {
                currentT = tMaxY;
                iy += stepY;
                tMaxY += tDeltaY;
            } else {
                currentT = tMaxZ;
                iz += stepZ;
                tMaxZ += tDeltaZ;
            }
            if (
                ix < 0 ||
                iy < 0 ||
                iz < 0 ||
                ix >= this.voxelCountX ||
                iy >= this.voxelCountY ||
                iz >= this.voxelCountZ ||
                currentT > maxDist
            ) {
                return null;
            }
        }
        return null;
    }

    /** Resolve a vertical capsule out of solid voxels. */
    queryCapsule(
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ): boolean {
        return this.resolveIterative(
            cx,
            cy,
            cz,
            (rx, ry, rz, push) => this.resolveDeepestPenetrationCapsule(rx, ry, rz, halfHeight, radius, push),
            out,
        );
    }

    /** Read one packed leaf bit. */
    private checkLeafByIndex(node: number, ix: number, iy: number, iz: number) {
        const leafDataIndex = node & 0x00ffffff;
        const vx = ix & 3;
        const vy = iy & 3;
        const vz = iz & 3;
        const bitIndex = vz * 16 + vy * 4 + vx;
        if (bitIndex < 32) {
            const lo = this.leafData[leafDataIndex * 2] >>> 0;
            return ((lo >>> bitIndex) & 1) === 1;
        }
        const hi = this.leafData[leafDataIndex * 2 + 1] >>> 0;
        return ((hi >>> (bitIndex - 32)) & 1) === 1;
    }

    /** Find the strongest push needed to move a capsule out of nearby solid voxels. */
    private resolveDeepestPenetrationCapsule(
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ): boolean {
        const voxelSize = this.voxelSize;
        const radiusSq = radius * radius;
        const segBottomY = cy - halfHeight;
        const segTopY = cy + halfHeight;
        const ixMin = Math.floor((cx - radius - this.gridMinX) / voxelSize);
        const iyMin = Math.floor((segBottomY - radius - this.gridMinY) / voxelSize);
        const izMin = Math.floor((cz - radius - this.gridMinZ) / voxelSize);
        const ixMax = Math.floor((cx + radius - this.gridMinX) / voxelSize);
        const iyMax = Math.floor((segTopY + radius - this.gridMinY) / voxelSize);
        const izMax = Math.floor((cz + radius - this.gridMinZ) / voxelSize);
        let bestPushX = 0;
        let bestPushY = 0;
        let bestPushZ = 0;
        let bestPen = PENETRATION_EPSILON;
        let found = false;

        for (let iz = izMin; iz <= izMax; iz++) {
            for (let iy = iyMin; iy <= iyMax; iy++) {
                for (let ix = ixMin; ix <= ixMax; ix++) {
                    if (!this.isVoxelSolid(ix, iy, iz)) {
                        continue;
                    }
                    const vMinX = this.gridMinX + ix * voxelSize;
                    const vMinY = this.gridMinY + iy * voxelSize;
                    const vMinZ = this.gridMinZ + iz * voxelSize;
                    const vMaxX = vMinX + voxelSize;
                    const vMaxY = vMinY + voxelSize;
                    const vMaxZ = vMinZ + voxelSize;
                    let segY: number;
                    if (segTopY < vMinY) {
                        segY = segTopY;
                    } else if (segBottomY > vMaxY) {
                        segY = segBottomY;
                    } else {
                        segY = Math.max(segBottomY, Math.min(segTopY, (vMinY + vMaxY) * 0.5));
                    }
                    const nearX = Math.max(vMinX, Math.min(cx, vMaxX));
                    const nearY = Math.max(vMinY, Math.min(segY, vMaxY));
                    const nearZ = Math.max(vMinZ, Math.min(cz, vMaxZ));
                    const dx = cx - nearX;
                    const dy = segY - nearY;
                    const dz = cz - nearZ;
                    const distSq = dx * dx + dy * dy + dz * dz;
                    if (distSq >= radiusSq) {
                        continue;
                    }
                    let px = 0;
                    let py = 0;
                    let pz = 0;
                    let penetration: number;
                    if (distSq > 1e-12) {
                        const dist = Math.sqrt(distSq);
                        penetration = radius - dist;
                        const invDist = 1 / dist;
                        px = dx * invDist * penetration;
                        py = dy * invDist * penetration;
                        pz = dz * invDist * penetration;
                    } else {
                        const escapeX = Math.min(cx - vMinX, vMaxX - cx) + radius;
                        const escapeY = Math.min(segY - vMinY, vMaxY - segY) + radius;
                        const escapeZ = Math.min(cz - vMinZ, vMaxZ - cz) + radius;
                        if (escapeX <= escapeY && escapeX <= escapeZ) {
                            px = cx - vMinX < vMaxX - cx ? -escapeX : escapeX;
                            penetration = escapeX;
                        } else if (escapeY <= escapeZ) {
                            py = segY - vMinY < vMaxY - segY ? -escapeY : escapeY;
                            penetration = escapeY;
                        } else {
                            pz = cz - vMinZ < vMaxZ - cz ? -escapeZ : escapeZ;
                            penetration = escapeZ;
                        }
                    }
                    if (penetration > bestPen) {
                        bestPen = penetration;
                        bestPushX = px;
                        bestPushY = py;
                        bestPushZ = pz;
                        found = true;
                    }
                }
            }
        }
        if (found) {
            out.x = bestPushX;
            out.y = bestPushY;
            out.z = bestPushZ;
        }
        return found;
    }

    /** Apply a few push-out passes so corner collisions do not trap the capsule. */
    private resolveIterative(
        cx: number,
        cy: number,
        cz: number,
        findPenetration: (x: number, y: number, z: number, out: { x: number; y: number; z: number }) => boolean,
        out: { x: number; y: number; z: number },
    ): boolean {
        let resolvedX = cx;
        let resolvedY = cy;
        let resolvedZ = cz;
        let totalPushX = 0;
        let totalPushY = 0;
        let totalPushZ = 0;
        let hadCollision = false;
        let numNormals = 0;

        for (let iter = 0; iter < MAX_RESOLVE_ITERATIONS; iter++) {
            if (!findPenetration(resolvedX, resolvedY, resolvedZ, this.scratchPush)) {
                break;
            }
            hadCollision = true;
            let px = this.scratchPush.x;
            let py = this.scratchPush.y;
            let pz = this.scratchPush.z;

            for (let i = 0; i < numNormals; i++) {
                const n = this.contactNormals[i];
                const dot = px * n.x + py * n.y + pz * n.z;
                if (dot < 0) {
                    px -= dot * n.x;
                    py -= dot * n.y;
                    pz -= dot * n.z;
                }
            }

            const len = Math.sqrt(
                this.scratchPush.x * this.scratchPush.x +
                    this.scratchPush.y * this.scratchPush.y +
                    this.scratchPush.z * this.scratchPush.z,
            );
            if (len > PENETRATION_EPSILON && numNormals < 3) {
                const invLen = 1 / len;
                const n = this.contactNormals[numNormals];
                n.x = this.scratchPush.x * invLen;
                n.y = this.scratchPush.y * invLen;
                n.z = this.scratchPush.z * invLen;
                numNormals++;
            }

            resolvedX += px;
            resolvedY += py;
            resolvedZ += pz;
            totalPushX += px;
            totalPushY += py;
            totalPushZ += pz;
        }

        const totalPushSq = totalPushX * totalPushX + totalPushY * totalPushY + totalPushZ * totalPushZ;
        const hasSignificantPush = hadCollision && totalPushSq > PENETRATION_EPSILON * PENETRATION_EPSILON;
        if (hasSignificantPush) {
            out.x = totalPushX;
            out.y = totalPushY;
            out.z = totalPushZ;
        }
        return hasSignificantPush;
    }
}

const popcount = (n: number) => {
    n >>>= 0;
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

// -----------------------------------------------------------------------------
// Capsule collision and walk controller
// -----------------------------------------------------------------------------

const WALK_SIMULATION_STEP_SECONDS = 1 / 60;
const MAX_SUBSTEPS = 10;
const WALK_CAPSULE_HEIGHT = 1.5;
const WALK_CAPSULE_RADIUS = 0.12;
const WALK_HOVER_HEIGHT = 0.2;
const WALK_EYE_HEIGHT = WALK_CAPSULE_HEIGHT - 0.1 - WALK_HOVER_HEIGHT;
const WALK_GRAVITY = 9.8;
const THIRD_PERSON_MODEL_SCALE = 0.8;

export interface ViewerWalkCharacterState {
    position: InstanceType<typeof Vector3>;
    yaw: number;
    speed: number;
    walkSpeed: number;
    verticalVelocity: number;
    grounded: boolean;
}

/**
 * True when the event is going to a field the user is typing into. Key handling
 * listens on `document`, so without this the walk controller eats keystrokes
 * meant for a text input — and worse, it calls preventDefault() on WASD, so you
 * cannot type those letters at all.
 */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Walk controller: voxel collision in, camera and character state out. */
export class ViewerWalkMode {
    private collision: {
        queryRay: (...args: number[]) => { x: number; y: number; z: number } | null;
        queryCapsule: (
            cx: number,
            cy: number,
            cz: number,
            halfHeight: number,
            radius: number,
            out: { x: number; y: number; z: number },
        ) => boolean;
    } | null = null;
    private baseCollision: ViewerWalkMode['collision'] = null;
    private manualOverlay: ManualCollisionData | null = null;

    private enabled = false;
    private keys: Record<string, boolean> = {};
    private touchMove = { forward: 0, strafe: 0 };
    private touchLook: { pointerId: number; x: number; y: number } | undefined;
    private mouseLookDragging = false;

    private yaw = 0;
    private pitch = 0;
    private position = new Vector3();
    private velocity = new Vector3();
    private grounded = false;
    private groundYFiltered: number | null = null;
    private horizontalSpeed = 0;

    private cameraPosition = new Vector3();
    private cameraRotation = new Euler(0, 0, 0, 'YXZ');
    private cameraScale = new Vector3(1, 1, 1);
    private characterPosition = new Vector3();
    private cameraTarget = new Vector3();
    private cameraIdealPosition = new Vector3();
    private cameraCollisionPosition = new Vector3();
    private cameraRay = new Vector3();

    private accumulator = 0;
    moveSpeed = 7;

    thirdPersonEnabled = false;
    flyMode = false;
    /**
     * 0 = first-person, 1 = third-person. Eases between the two instead of
     * cutting, so toggling the camera dollies out/in. Read by the demo shell to
     * keep the avatar hidden until the camera has actually left the head.
     */
    viewBlend = 0;
    /** Seconds for a full first <-> third camera transition. */
    viewBlendSeconds = 0.45;
    private thirdPersonDistance = 3.2;
    private thirdPersonDistanceTarget = 3.2;
    private thirdPersonDistanceMin = 0.8;
    private thirdPersonDistanceMax = 4;
    private thirdPersonBounceOffset = 0;
    private thirdPersonBounceVelocity = 0;
    private thirdPersonTargetHeight = 1.25;
    private characterYaw = 0;
    private thirdPersonCollisionDistance = -1;
    private thirdPersonOcclusionReleaseTimer = 0;
    thirdPersonCameraPreset: 'indoor' | 'outdoor' = 'indoor';

    constructor(private container: HTMLElement) {
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('mousemove', this.onMouseMove);
        this.container.addEventListener('pointerdown', this.onTouchLookPointerDown);
        document.addEventListener('pointermove', this.onTouchLookPointerMove);
        document.addEventListener('pointerup', this.onTouchLookPointerUp);
        document.addEventListener('pointercancel', this.onTouchLookPointerUp);
        document.addEventListener('wheel', this.onWheel, { passive: false });
        // Prevent "stuck key" drift when keyup is lost (UI panel focus, pointer-lock, tab blur).
        document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
        document.addEventListener('focusin', this.onDocumentFocusIn, true);
        window.addEventListener('blur', this.onWindowBlur);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    /** Attach voxel collision data used by ground checks and capsule push-out. */
    loadVoxelCollision(
        metadata: {
            gridBounds: { min: number[]; max: number[] };
            voxelResolution: number;
            leafSize: number;
            treeDepth: number;
        },
        nodes: Uint32Array,
        leafData: Uint32Array,
    ) {
        // Voxel collision from the scan is disabled: the floor barely voxelizes
        // and the walls it does produce are not wanted right now. The synthetic
        // floor plane is the only collider. To bring the scan's geometry back,
        // pass `new VoxelCollision(metadata, nodes, leafData)` as the first
        // argument below — FloorPlaneCollision unions the two.
        void metadata;
        void nodes;
        void leafData;
        this.baseCollision = WALK_FLOOR_PLANE ? new FloorPlaneCollision(undefined, WALK_FLOOR_PLANE) : null;
        this.applyCollisionSource();
    }

    /**
     * Attach a baked walkable grid (tools/build-collision.mjs). This supplies
     * BOTH colliders: the floor plane and the wall cells, so it replaces the
     * voxel field entirely rather than being unioned with it.
     */
    loadCollisionGrid(data: CollisionGridData) {
        const grid = new GridCollision(data);
        this.grid = grid;
        this.baseCollision = grid;
        this.applyCollisionSource();
    }

    setManualCollision(data: ManualCollisionData) {
        this.manualOverlay = data.floors.length || data.walls.length ? data : null;
        this.applyCollisionSource();
    }


    private applyCollisionSource(): void {
        this.collision = this.manualOverlay
            ? new CombinedCollision(this.baseCollision, new ManualCollision(this.manualOverlay))
            : this.baseCollision;
    }

    private grid: GridCollision | undefined;

    /** The baked grid, for the debug overlay. */
    get collisionGrid(): GridCollision | undefined {
        return this.grid;
    }

    /** Place the walker at a known position and camera angle. */
    startAtPose(position: InstanceType<typeof Vector3>, yaw: number, pitch: number, options: { snapToGround?: boolean } = {}) {
        this.position.copy(position);
        this.velocity.set(0, 0, 0);
        this.yaw = yaw;
        this.pitch = clampPitch(pitch);
        this.activateAtCurrentPose(options.snapToGround !== false);
    }

    /** Reset runtime state, resolve spawn collision, and snap to the ground if one is below. */
    private activateAtCurrentPose(snapToGround: boolean) {
        this.enabled = true;
        this.keys = {};
        this.accumulator = 0;
        this.grounded = false;
        this.horizontalSpeed = 0;
        this.characterYaw = this.yaw;
        this.thirdPersonDistanceTarget = this.thirdPersonDistance;
        this.thirdPersonCollisionDistance = -1;
        this.thirdPersonOcclusionReleaseTimer = 0;
        this.groundYFiltered = null;
        if (snapToGround) {
            this.resolveSpawnCollision();
            const gy = this.probeGround(this.position);
            if (gy !== null) {
                this.grounded = true;
                this.velocity.y = 0;
                this.position.y = gy + WALK_HOVER_HEIGHT + WALK_EYE_HEIGHT;
                this.groundYFiltered = gy;
            }
        }
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    }

    /** Stop walk mode and clear held input. */
    disable() {
        this.enabled = false;
        this.clearInputState();
    }

    dispose() {
        this.disable();
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        this.container.removeEventListener('pointerdown', this.onTouchLookPointerDown);
        document.removeEventListener('pointermove', this.onTouchLookPointerMove);
        document.removeEventListener('pointerup', this.onTouchLookPointerUp);
        document.removeEventListener('pointercancel', this.onTouchLookPointerUp);
        document.removeEventListener('wheel', this.onWheel);
        document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
        document.removeEventListener('focusin', this.onDocumentFocusIn, true);
        window.removeEventListener('blur', this.onWindowBlur);
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }

    /** Mobile analog stick input, normalized to the same range as WASD. */
    setTouchMove(forward: number, strafe: number) {
        this.touchMove.forward = Math.max(-1, Math.min(1, forward));
        this.touchMove.strafe = Math.max(-1, Math.min(1, strafe));
    }

    /** Set third-person orbit distance and look height. */
    setThirdPersonCamera(distance: number, targetHeight: number, minDistance = 0.8, maxDistance = 4) {
        this.thirdPersonDistanceMin = Math.max(0.2, Math.min(4, minDistance));
        const maxCap = 1_000_000;
        this.thirdPersonDistanceMax = Math.max(this.thirdPersonDistanceMin + 0.1, Math.min(maxCap, maxDistance));
        const clampedDistance = Math.max(this.thirdPersonDistanceMin, Math.min(this.thirdPersonDistanceMax, distance));
        this.thirdPersonDistance = clampedDistance;
        this.thirdPersonDistanceTarget = clampedDistance;
        this.thirdPersonTargetHeight = Math.max(0.4, Math.min(maxCap, targetHeight));
    }
    /** Called once per frame; runs fixed physics steps and then updates the camera state. */
    update(dt: number) {
        if (!this.enabled) {
            return;
        }
        const dtClamped = Math.min(Math.max(0, dt), 1 / 20);
        this.accumulator = Math.min(this.accumulator + dtClamped, MAX_SUBSTEPS * WALK_SIMULATION_STEP_SECONDS);
        while (this.accumulator >= WALK_SIMULATION_STEP_SECONDS) {
            this.step(WALK_SIMULATION_STEP_SECONDS);
            this.accumulator -= WALK_SIMULATION_STEP_SECONDS;
        }
        this.updateCharacterPosition();
        this.updateViewBlend(dtClamped);

        if (this.viewBlend <= 0) {
            this.cameraPosition.set(this.position.x, this.position.y, this.position.z);
            this.cameraRotation.set(this.pitch, this.yaw, 0, 'YXZ');
            return;
        }

        // Fills cameraPosition/cameraRotation with the full third-person pose.
        this.updateThirdPersonCamera(dtClamped);
        if (this.viewBlend >= 1) {
            return;
        }

        // Mid-transition: ease that pose back toward the first-person one. Both
        // share yaw and have zero roll, so pitch is a plain scalar blend — no
        // quaternion handling needed.
        const t = this.viewBlend * this.viewBlend * (3 - 2 * this.viewBlend);
        this.cameraPosition.set(
            this.lerp(this.position.x, this.cameraPosition.x, t),
            this.lerp(this.position.y, this.cameraPosition.y, t),
            this.lerp(this.position.z, this.cameraPosition.z, t),
        );
        this.cameraRotation.set(this.lerp(this.pitch, this.cameraRotation.x, t), this.yaw, 0, 'YXZ');
    }

    /** Ease viewBlend toward whichever mode is selected. */
    private updateViewBlend(dt: number) {
        const target = this.thirdPersonEnabled ? 1 : 0;
        if (this.viewBlend === target) {
            return;
        }
        const step = dt / Math.max(1e-3, this.viewBlendSeconds);
        this.viewBlend =
            target > this.viewBlend
                ? Math.min(target, this.viewBlend + step)
                : Math.max(target, this.viewBlend - step);
    }

    /** Current camera transform for the render scene. */
    getCameraState() {
        return { position: this.cameraPosition, rotation: this.cameraRotation, scale: this.cameraScale };
    }

    /** Current controlled pose, used by developer capture tools. */
    getPose() {
        return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch };
    }

    /** Current avatar state for the third-person model. */
    getCharacterState(): ViewerWalkCharacterState {
        return {
            position: this.characterPosition,
            yaw: this.characterYaw,
            speed: this.horizontalSpeed,
            walkSpeed: this.moveSpeed,
            verticalVelocity: this.velocity.y,
            grounded: this.grounded,
        };
    }

    /** One fixed physics step: ground probe, gravity, horizontal movement, and voxel push-out. */
    private step(dt: number) {
        if (this.flyMode) {
            this.stepFly(dt);
            return;
        }
        const rawGroundY = this.probeGround(this.position);
        const hasGround = rawGroundY !== null;

        if (hasGround && rawGroundY !== null) {
            if (this.groundYFiltered === null) {
                this.groundYFiltered = rawGroundY;
            } else {
                const a = 1 - Math.exp(-20 * dt);
                this.groundYFiltered += (rawGroundY - this.groundYFiltered) * a;
            }
        } else if (!hasGround) {
            this.groundYFiltered = null;
        }

        const groundYStick = hasGround && this.groundYFiltered !== null ? this.groundYFiltered : rawGroundY;

        if (hasGround) {
            const groundYValue = groundYStick as number;
            const targetY = groundYValue + WALK_HOVER_HEIGHT + WALK_EYE_HEIGHT;
            const displacement = this.position.y - targetY;
            if (displacement > 0.1) {
                this.velocity.y -= WALK_GRAVITY * dt;
                const nextY = this.position.y + this.velocity.y * dt;
                if (nextY <= targetY) {
                    this.position.y = targetY;
                    this.velocity.y = 0;
                }
                this.grounded = false;
            } else {
                const spring = -800 * displacement - 57 * this.velocity.y;
                this.velocity.y += spring * dt;
                this.grounded = true;
            }
        } else {
            this.velocity.y -= WALK_GRAVITY * dt;
            this.grounded = false;
        }

        const forwardInput = Math.max(
            -1,
            Math.min(1, (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0) + this.touchMove.forward),
        );
        const strafeInput = Math.max(
            -1,
            Math.min(1, (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + this.touchMove.strafe),
        );
        const move = new Vector3();
        const hasMoveInput = forwardInput !== 0 || strafeInput !== 0;
        const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0));
        if (forwardInput !== 0) {
            move.addScaledVector(forward, forwardInput);
        }
        if (strafeInput !== 0) {
            move.addScaledVector(right, strafeInput);
        }
        if (hasMoveInput) {
            const maxSpeed = this.moveSpeed;
            move.normalize().multiplyScalar(maxSpeed);
            this.characterYaw = Math.atan2(-move.x, -move.z);
        } else {
            move.set(0, 0, 0);
        }
        const accel = this.grounded ? 24 : 6;
        const blend = Math.min(1, accel * dt);
        this.velocity.x = this.velocity.x + (move.x - this.velocity.x) * blend;
        this.velocity.z = this.velocity.z + (move.z - this.velocity.z) * blend;
        const dampFactor = this.grounded ? 0.99 : 0.998;
        const alpha = this.damp(dampFactor, dt);
        this.velocity.x = this.lerp(this.velocity.x, 0, alpha * 0.35);
        this.velocity.z = this.lerp(this.velocity.z, 0, alpha * 0.35);
        this.horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);

        this.position.addScaledVector(this.velocity, dt);
        this.resolveCollision();
    }

    /** Developer camera: fly through the scan without gravity or collision. */
    private stepFly(dt: number) {
        const input = {
            forward: Math.max(
                -1,
                Math.min(1, (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0) + this.touchMove.forward),
            ),
            strafe: Math.max(
                -1,
                Math.min(1, (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0) + this.touchMove.strafe),
            ),
            vertical: (this.keys.Space ? 1 : 0) - (this.keys.ShiftLeft || this.keys.ShiftRight ? 1 : 0),
        };
        const v = flyVector(input, this.yaw, this.pitch, this.moveSpeed);
        this.velocity.set(v.x, v.y, v.z);
        this.horizontalSpeed = Math.hypot(v.x, v.z);
        this.grounded = false;
        this.groundYFiltered = null;
        this.position.addScaledVector(this.velocity, dt);
    }

    /** Build a third-person camera from avatar position, pitch, zoom, and collision. */
    private updateThirdPersonCamera(dt: number) {
        this.updateThirdPersonDistance(dt);
        const cameraScale = THIRD_PERSON_MODEL_SCALE;
        const meshWorldH = CHARACTER_HEIGHT_METERS * cameraScale;
        const { pivotY, baseElevation } = this.computeThirdPersonCameraTarget(meshWorldH, cameraScale);

        this.cameraTarget.set(this.position.x, pivotY, this.position.z);

        const elevation = Math.max((-80 * Math.PI) / 180, Math.min((70 * Math.PI) / 180, baseElevation + this.pitch));
        const activeDistance = Math.max(0.1, (this.thirdPersonDistance + this.thirdPersonBounceOffset) * cameraScale);
        const horizontalDistance = Math.cos(elevation) * activeDistance;
        const verticalOffset = Math.sin(elevation) * activeDistance;
        this.cameraIdealPosition.set(
            this.cameraTarget.x + Math.sin(this.yaw) * horizontalDistance,
            this.cameraTarget.y + verticalOffset,
            this.cameraTarget.z + Math.cos(this.yaw) * horizontalDistance,
        );
        this.resolveCameraCollision(dt, activeDistance);
        this.cameraCollisionPosition.y = Math.max(this.cameraCollisionPosition.y, this.characterPosition.y + 0.12);

        this.cameraPosition.copy(this.cameraCollisionPosition);
        this.cameraRotation.set(-elevation, this.yaw, 0, 'YXZ');
    }

    /** Pick the vertical target point for indoor and outdoor third-person views. */
    private computeThirdPersonCameraTarget(meshWorldHeight: number, cameraScale: number) {
        if (this.thirdPersonCameraPreset === 'outdoor') {
            return {
                pivotY: this.characterPosition.y + meshWorldHeight * 0.92,
                baseElevation: 0.4,
            };
        }

        const pivotY =
            this.position.y -
            WALK_EYE_HEIGHT +
            WALK_HOVER_HEIGHT +
            this.thirdPersonTargetHeight * cameraScale -
            0.22 * meshWorldHeight;

        return {
            pivotY: Math.max(this.characterPosition.y + meshWorldHeight * 0.06, pivotY),
            baseElevation: 0.35,
        };
    }

    /** Smooth zoom changes and the small zoom bounce. */
    private updateThirdPersonDistance(dt: number) {
        const alpha = Math.min(1, Math.max(0, 12 * dt));
        this.thirdPersonDistance = this.lerp(this.thirdPersonDistance, this.thirdPersonDistanceTarget, alpha);
        const spring = -this.thirdPersonBounceOffset * 70;
        const damping = -this.thirdPersonBounceVelocity * 12;
        this.thirdPersonBounceVelocity += (spring + damping) * dt;
        this.thirdPersonBounceVelocity = Math.max(-6, Math.min(6, this.thirdPersonBounceVelocity));
        this.thirdPersonBounceOffset += this.thirdPersonBounceVelocity * dt;
        this.thirdPersonBounceOffset = Math.max(-0.5, Math.min(0.5, this.thirdPersonBounceOffset));
        if (Math.abs(this.thirdPersonBounceOffset) < 5e-4 && Math.abs(this.thirdPersonBounceVelocity) < 0.005) {
            this.thirdPersonBounceOffset = 0;
            this.thirdPersonBounceVelocity = 0;
        }
    }

    /** Pull the third-person camera forward when voxels block the view. */
    private resolveCameraCollision(dt: number, maxDistance: number) {
        this.cameraRay.subVectors(this.cameraIdealPosition, this.cameraTarget);
        const distance = this.cameraRay.length();
        if (distance < 1e-4) {
            this.cameraCollisionPosition.copy(this.cameraIdealPosition);
            this.thirdPersonCollisionDistance = distance;
            return;
        }
        this.cameraRay.multiplyScalar(1 / distance);
        let blockedDistance = maxDistance;
        let blocked = false;
        if (this.collision) {
            const hit = this.collision.queryRay(
                this.cameraTarget.x,
                this.cameraTarget.y,
                this.cameraTarget.z,
                this.cameraRay.x,
                this.cameraRay.y,
                this.cameraRay.z,
                distance,
            );
            if (hit) {
                blockedDistance = Math.max(0.1, this.cameraTarget.distanceTo(new Vector3(hit.x, hit.y, hit.z)) - 0.18);
                blocked = true;
                this.thirdPersonOcclusionReleaseTimer = 0.1;
            }
        }
        if (!blocked && this.thirdPersonOcclusionReleaseTimer > 0) {
            this.thirdPersonOcclusionReleaseTimer = Math.max(0, this.thirdPersonOcclusionReleaseTimer - dt);
            blocked = this.thirdPersonOcclusionReleaseTimer > 0;
        }
        const desiredDistance = blocked ? blockedDistance : maxDistance;
        if (this.thirdPersonCollisionDistance < 0) {
            this.thirdPersonCollisionDistance = desiredDistance;
        } else {
            const rate = desiredDistance < this.thirdPersonCollisionDistance ? 14 : 7;
            const alpha = 1 - Math.exp(-Math.max(0, dt) * rate);
            this.thirdPersonCollisionDistance = this.lerp(this.thirdPersonCollisionDistance, desiredDistance, alpha);
        }
        this.thirdPersonCollisionDistance = Math.max(0.1, Math.min(maxDistance, this.thirdPersonCollisionDistance));
        this.cameraCollisionPosition
            .copy(this.cameraTarget)
            .addScaledVector(this.cameraRay, this.thirdPersonCollisionDistance);
    }

    /** Place the avatar feet on the current ground height. */
    private updateCharacterPosition() {
        const groundY =
            this.grounded && this.groundYFiltered !== null
                ? this.groundYFiltered
                : this.grounded
                  ? this.probeGround(this.position)
                  : null;
        const footY = groundY !== null ? groundY : this.position.y - WALK_HOVER_HEIGHT - WALK_EYE_HEIGHT;
        this.characterPosition.set(this.position.x, footY, this.position.z);
    }

    /** Raycast below the capsule and return a stable ground height. */
    private probeGround(pos: InstanceType<typeof Vector3>): number | null {
        if (!this.collision) {
            return null;
        }
        const oy = pos.y - WALK_EYE_HEIGHT;
        const r = WALK_CAPSULE_RADIUS;
        const samples: Array<[number, number]> = [
            [0, 0],
            [-r, 0],
            [r, 0],
            [0, r],
            [0, -r],
        ];
        const ys: number[] = [];
        for (let i = 0; i < samples.length; i++) {
            const [ox, oz] = samples[i];
            const hit = this.collision.queryRay(pos.x + ox, oy, pos.z + oz, 0, -1, 0, 1.0);
            if (!hit) {
                continue;
            }
            ys.push(hit.y);
        }
        if (ys.length === 0) {
            return null;
        }
        ys.sort((a, b) => a - b);
        const mid = Math.floor(ys.length / 2);
        return ys.length % 2 === 1 ? ys[mid]! : (ys[mid - 1]! + ys[mid]!) * 0.5;
    }

    /** Push the moving capsule out of solid voxels. */
    private resolveCollision() {
        if (!this.collision) {
            return;
        }
        const centerY = this.position.y - WALK_EYE_HEIGHT + WALK_CAPSULE_HEIGHT * 0.5;
        const half = WALK_CAPSULE_HEIGHT * 0.5 - WALK_CAPSULE_RADIUS;
        const push = { x: 0, y: 0, z: 0 };
        if (this.collision.queryCapsule(this.position.x, centerY, this.position.z, half, WALK_CAPSULE_RADIUS, push)) {
            this.position.x += push.x;
            this.position.y += push.y;
            this.position.z += push.z;
            if (push.y < -PENETRATION_EPSILON && this.velocity.y > 0) {
                this.velocity.y = 0;
            }
            if (!this.grounded && push.y > PENETRATION_EPSILON && this.velocity.y < 0) {
                this.velocity.y = 0;
                this.grounded = true;
            }
        }
    }

    /** Lift the start pose until the capsule is outside solid voxels. */
    private resolveSpawnCollision() {
        if (!this.collision) {
            return;
        }
        const half = WALK_CAPSULE_HEIGHT * 0.5 - WALK_CAPSULE_RADIUS;
        const minStep = WALK_CAPSULE_RADIUS;
        const push = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < 100; i++) {
            const center = this.position.y - WALK_EYE_HEIGHT + WALK_CAPSULE_HEIGHT * 0.5;
            if (
                !this.collision.queryCapsule(this.position.x, center, this.position.z, half, WALK_CAPSULE_RADIUS, push)
            ) {
                break;
            }
            this.position.y += Math.max(push.y, minStep);
        }
    }

    private damp(damping: number, dt: number) {
        return 1 - Math.pow(damping, dt * 1000);
    }

    private lerp(a: number, b: number, t: number) {
        return a + (b - a) * t;
    }

    private onKeyDown = (e: KeyboardEvent) => {
        if (!this.enabled || isTypingTarget(e.target)) {
            return;
        }
        this.keys[e.code] = true;
        if (
            e.code === 'KeyW' ||
            e.code === 'KeyA' ||
            e.code === 'KeyS' ||
            e.code === 'KeyD' ||
            (this.flyMode && (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight'))
        ) {
            e.preventDefault();
        }
    };

    private onKeyUp = (e: KeyboardEvent) => {
        if (!this.enabled) {
            return;
        }
        // Deliberately NOT filtered by isTypingTarget: a release must always be
        // recorded. Pressing a key over the canvas and releasing it after focus
        // moved into a field would otherwise leave that key stuck down forever.
        this.keys[e.code] = false;
    };

    // Clear held keys when the user leaves the walk area or the page loses focus.
    private onDocumentPointerDown = (e: PointerEvent) => {
        // Clicking back into the scene has to hand keyboard control back to the
        // walker. A canvas is not focusable, so clicking it does not blur a text
        // field — focus would stay in the panel and isTypingTarget would keep
        // swallowing WASD even though the user is clearly done typing.
        if (e.target instanceof Node && this.container.contains(e.target) && isTypingTarget(document.activeElement)) {
            (document.activeElement as HTMLElement).blur();
        }
        this.clearInputWhenTargetLeavesContainer(e.target);
    };

    private onDocumentFocusIn = (e: FocusEvent) => {
        this.clearInputWhenTargetLeavesContainer(e.target);
    };

    private clearInputWhenTargetLeavesContainer(target: EventTarget | null) {
        if (!this.enabled) {
            return;
        }
        if (target instanceof Node && !this.container.contains(target)) {
            this.clearInputState();
        }
    }

    private onWindowBlur = () => {
        this.clearInputState();
    };

    private onVisibilityChange = () => {
        if (document.hidden) {
            this.clearInputState();
        }
    };

    private clearInputState() {
        this.keys = {};
        this.setTouchMove(0, 0);
        this.touchLook = undefined;
        this.mouseLookDragging = false;
    }

    private onMouseDown = (e: MouseEvent) => {
        if (!this.enabled) {
            return;
        }
        if (e.target instanceof Node && !this.container.contains(e.target)) {
            return;
        }
        if (e.button === 0) {
            this.mouseLookDragging = true;
            e.preventDefault();
        }
    };

    private onMouseUp = (e: MouseEvent) => {
        if (e.button === 0) {
            this.mouseLookDragging = false;
        }
    };

    private onMouseMove = (e: MouseEvent) => {
        if (!this.enabled) {
            return;
        }
        if (!this.mouseLookDragging || (e.buttons & 1) === 0) {
            this.mouseLookDragging = false;
            return;
        }
        this.applyLookDelta(e.movementX, e.movementY);
    };

    private onTouchLookPointerDown = (e: PointerEvent) => {
        if (!this.enabled || e.pointerType === 'mouse' || e.clientX < window.innerWidth * 0.35) {
            return;
        }
        this.touchLook = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
        this.container.setPointerCapture(e.pointerId);
        e.preventDefault();
    };

    private onTouchLookPointerMove = (e: PointerEvent) => {
        if (!this.enabled || this.touchLook?.pointerId !== e.pointerId) {
            return;
        }
        this.applyLookDelta(e.clientX - this.touchLook.x, e.clientY - this.touchLook.y);
        this.touchLook.x = e.clientX;
        this.touchLook.y = e.clientY;
        e.preventDefault();
    };

    private onTouchLookPointerUp = (e: PointerEvent) => {
        if (this.touchLook?.pointerId === e.pointerId) {
            this.touchLook = undefined;
        }
    };

    private applyLookDelta(dx: number, dy: number) {
        const look = nextLookAngles({
            yaw: this.yaw,
            pitch: this.pitch,
            dx,
            dy,
            thirdPerson: this.thirdPersonEnabled,
        });
        this.yaw = look.yaw;
        this.pitch = look.pitch;
    }

    private onWheel = (e: WheelEvent) => {
        if (!this.enabled || !this.thirdPersonEnabled) {
            return;
        }
        e.preventDefault();
        let next = this.thirdPersonDistanceTarget + e.deltaY * 0.002;
        if (next < this.thirdPersonDistanceMin) {
            this.thirdPersonBounceVelocity += (next - this.thirdPersonDistanceMin) * 0.9;
            next = this.thirdPersonDistanceMin;
        } else if (next > this.thirdPersonDistanceMax) {
            this.thirdPersonBounceVelocity += (next - this.thirdPersonDistanceMax) * 0.9;
            next = this.thirdPersonDistanceMax;
        }
        this.thirdPersonBounceVelocity = Math.max(-6, Math.min(6, this.thirdPersonBounceVelocity));
        this.thirdPersonDistanceTarget = next;
    };
}

// -----------------------------------------------------------------------------
// Demo assets and character presentation
// -----------------------------------------------------------------------------

/** Aholo OSS walk assets (`oss-res` -> `node uploader/index.mjs gs:aholo`); indoor `gs_file/room/`, outdoor `gs_file/juguo/`. */
/**
 * Scene assets. Layout mirrors the asset bucket (see docs/scene-assets.md):
 *   public/<property-slug>/<scene>/{index.ply, collision.json, collision-report.json}
 * The property slug is the key — an address, a warehouse, anything — and each
 * scene is one part of that place. Everything a scene needs is in one folder,
 * so adding a scene is dropping a folder in, not editing paths in several files.
 */
const SCENE_HALL = '/23_nashville_dr_tenessee/hall/';
const SCENE_BALCONY = '/23_nashville_dr_tenessee/balcony/';
const SPLAT_BASE_URL = String(import.meta.env.VITE_SPLAT_BASE_URL ?? '');

const AHOLO_OSS_GS_FILE_BASE = 'https://holo-cos.aholo3d.cn/aholo-opensource/gs_file';
/** Unused since indoor moved to the local hall-3 scene; kept for the upstream room assets. */
void `${AHOLO_OSS_GS_FILE_BASE}/room/`;
const WALK_OUTDOOR_URL_PREFIX = `${AHOLO_OSS_GS_FILE_BASE}/juguo/`;

/** Third-person GLB assets; tune with `scripts/tune-character-glb-to-walk.mjs`. */
const WALK_CHARACTER_MODEL_URL_MAN = `${AHOLO_OSS_GS_FILE_BASE}/misc/man-final.755ce8ea.glb`;
const WALK_CHARACTER_MODEL_URL_ROBOT = `${AHOLO_OSS_GS_FILE_BASE}/misc/robot.0765006a.glb`;

/** Normalized third-person GLB height. */
const CHARACTER_HEIGHT_METERS = 1.75;

const FADE_SECONDS = 0.18;
/** Idle/walk speed thresholds. */
const CHARACTER_LOCOMOTION_IDLE_ENTER_SPEED = 0.05;
const CHARACTER_LOCOMOTION_WALK_ENTER_SPEED = 0.12;
const CHARACTER_STAIR_FALL_VERTICAL_SPEED = -0.85;
type CharacterActionName = 'Idle' | 'Walk' | 'Fall';

interface ActionFade {
    action: InstanceType<typeof Animation.AnimationAction>;
    from: number;
    to: number;
    elapsed: number;
    duration: number;
    deactivateOnComplete: boolean;
}

/** Third-person avatar rendered in the same scene as the splats. */
export class WalkThirdPersonCharacter {
    private readonly scene: Scene3D;
    private readonly viewer: Viewer;
    private readonly animationPlugin: InstanceType<typeof Animation.AnimationPlugin>;

    private readonly characterRoot = new Object3D();
    private readonly lights = new Object3D();
    private mixer: InstanceType<typeof Animation.AnimationMixer> | null = null;
    private actions: Partial<Record<CharacterActionName, InstanceType<typeof Animation.AnimationAction>>> = {};
    private activeAction: InstanceType<typeof Animation.AnimationAction> | null = null;
    private activeActionName: CharacterActionName | null = null;
    private locomotionAnim: 'Idle' | 'Walk' = 'Idle';
    private actionFades: ActionFade[] = [];

    private enabled = false;
    private loaded = false;
    private loadError = false;
    private loadPromise: Promise<void> | undefined;
    /** Guards async character loading after disposal. */
    private readonly lifetime = new AbortController();

    private smoothedYaw = 0;

    private tmpPos = new Vector3();

    constructor(
        scene: Scene3D,
        viewer: Viewer,
        private readonly modelUrl: string,
    ) {
        this.scene = scene;
        this.viewer = viewer;
        this.animationPlugin = new AnimationPlugin();
        this.animationPlugin.registerToViewer({ viewer } as any);

        this.characterRoot.visible = false;
        this.characterRoot.scale.setScalar(THIRD_PERSON_MODEL_SCALE);
        this.lights.visible = false;

        const ambient = new AmbientLight(0xffffff, 0.72);
        const key = new DirectionalLight(0xffffff, 1.15);
        key.position.set(0.4, 1.0, 0.35);
        const fill = new DirectionalLight(0xffffff, 0.35);
        fill.position.set(-0.7, 0.6, -0.4);
        this.lights.add(ambient);
        this.lights.add(key);
        this.lights.add(fill);
    }

    /** Show the avatar and start loading it when needed. */
    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        this.characterRoot.visible = enabled && this.loaded && !this.loadError;
        this.lights.visible = enabled && this.loaded && !this.loadError;
        if (enabled) {
            this.ensureLoaded();
        }
    }

    /** Add avatar objects to the active scene. */
    private attachToScene(): void {
        if (this.lights.parent !== this.scene) {
            this.scene.add(this.lights);
        }
        if (this.characterRoot.parent !== this.scene) {
            this.scene.add(this.characterRoot);
        }
        this.scene.notifySceneChange();
    }

    /** Match the GLB position, yaw, and animation to walk state. */
    update(state: ViewerWalkCharacterState, _dt: number) {
        if (!this.enabled || !this.loaded || this.loadError) {
            return;
        }
        const p = state.position;
        this.tmpPos.set(p.x, p.y, p.z);
        this.characterRoot.position.copy(this.tmpPos);
        this.smoothCharacterYaw(state.yaw, _dt);
        this.characterRoot.rotation.y = this.smoothedYaw + Math.PI;
        this.characterRoot.updateMatrixWorld(true);

        if (this.mixer) {
            this.playAction(this.resolveActionName(state), state);
            this.updateActionFades(_dt);
        }
    }

    /** Start the GLB load once. */
    private ensureLoaded() {
        if (this.loaded || this.loadError || this.loadPromise) {
            return;
        }
        this.loadPromise = this.loadCharacter();
    }

    /** Resolves when the GLB is ready; rejects on load failure or `signal` abort. */
    waitUntilReady(signal: AbortSignal): Promise<void> {
        if (this.loaded) {
            return Promise.resolve();
        }
        if (this.loadError) {
            return Promise.reject(new Error('[walk] Third-person character failed to load.'));
        }
        this.ensureLoaded();
        if (!this.loadPromise) {
            return Promise.reject(new Error('[walk] Third-person character load did not start.'));
        }
        throwIfAborted(signal);
        return new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            this.loadPromise!.then(
                () => {
                    signal.removeEventListener('abort', onAbort);
                    if (this.lifetime.signal.aborted) {
                        reject(new DOMException('Aborted', 'AbortError'));
                        return;
                    }
                    if (this.loadError || !this.loaded) {
                        reject(new Error('[walk] Third-person character failed to load.'));
                        return;
                    }
                    resolve();
                },
                error => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                },
            );
        });
    }

    /** Load the GLB, bind animation, fit its size, and attach it to the scene. */
    private async loadCharacter() {
        const { signal } = this.lifetime;
        try {
            const response = await fetch(this.modelUrl, { signal });
            throwIfAborted(signal);
            const buffer = await response.arrayBuffer();
            throwIfAborted(signal);
            const result = await loadGLTF(buffer, {
                textureLoader: downloadTexture,
            });
            throwIfAborted(signal);

            // GLTF loader typings differ; scene graph objects are runtime-compatible with our Scene3D.
            const model = result.scene as any;
            this.characterRoot.removeAllChildren();
            this.mixer = new AnimationMixer(model);
            this.animationPlugin.add(this.mixer);

            const boundSkinnedMeshes = new WeakSet<object>();
            result.skeletons.forEach((skinnedMeshes: any, iSkeleton: any) => {
                const skeleton = new Skeleton(iSkeleton.bones as any, iSkeleton.inverseBindMatrices as any);
                skinnedMeshes.forEach((skinnedMesh: any) => {
                    if (boundSkinnedMeshes.has(skinnedMesh)) {
                        return;
                    }
                    boundSkinnedMeshes.add(skinnedMesh);
                    this.animationPlugin.bindSkinned(skinnedMesh as any, skeleton, this.mixer as any);
                });
            });
            // After `bindSkinned` -> `SkinnedMesh.bind`, `worldBoundingBox` uses bone matrices (not raw POSITION AABB).
            this.normalizeModel(model);
            this.characterRoot.add(model);
            this.setupActions((result.animations || []) as AnimationClip[]);

            throwIfAborted(signal);
            this.attachToScene();

            this.loaded = true;
            this.characterRoot.visible = this.enabled;
            this.lights.visible = this.enabled;
        } catch (e) {
            if (signal.aborted) {
                return;
            }
            console.error('[walk] Third-person character load failed:', e);
            this.loadError = true;
        }
    }

    /** Meshes used to fit character height and foot origin. */
    private pickBodyDrawableNodes(model: Object3D): Object3D[] {
        const surface: Object3D[] = [];
        const nonJoint: Object3D[] = [];
        model.traverse(node => {
            const o = node as { isMesh?: boolean; isSkinnedMesh?: boolean };
            if (!o.isMesh && !o.isSkinnedMesh) {
                return;
            }
            const name = (node.name || '').toLowerCase();
            if (name.includes('surface')) {
                surface.push(node);
            } else if (!name.includes('joint')) {
                nonJoint.push(node);
            }
        });
        return surface.length > 0 ? surface : nonJoint.length > 0 ? nonJoint : [];
    }

    /** Bounds used to fit the character model. */
    private unionCharacterNormalizeBounds(model: Object3D): InstanceType<typeof Box3> {
        const targets = this.pickBodyDrawableNodes(model);
        model.updateMatrixWorld(true);
        const box = new Box3();
        if (targets.length > 0) {
            let first = true;
            for (const n of targets) {
                const sm = n as {
                    isSkinnedMesh?: boolean;
                    update?: () => void;
                    worldBoundingBox?: InstanceType<typeof Box3>;
                };
                if (sm.isSkinnedMesh && typeof sm.update === 'function' && sm.worldBoundingBox) {
                    sm.update();
                    const wb = sm.worldBoundingBox;
                    if (!wb.isEmpty()) {
                        const dy = wb.max.y - wb.min.y;
                        if (Number.isFinite(dy) && dy > 1e-9) {
                            if (first) {
                                box.copy(wb);
                                first = false;
                            } else {
                                box.union(wb);
                            }
                            continue;
                        }
                    }
                }
                const b = new Box3().setFromObject(n);
                const dy = b.max.y - b.min.y;
                if (!Number.isFinite(dy) || dy <= 1e-9) {
                    continue;
                }
                if (first) {
                    box.copy(b);
                    first = false;
                } else {
                    box.union(b);
                }
            }
            if (!first && box.max.y - box.min.y > 1e-6) {
                return box;
            }
        }
        return new Box3().setFromObject(model);
    }

    /** Scale to CHARACTER_HEIGHT_METERS and move the feet to the origin. */
    private normalizeModel(model: Object3D) {
        model.updateMatrixWorld(true);
        const box = this.unionCharacterNormalizeBounds(model);
        const sourceHeight = Math.max(1e-6, box.max.y - box.min.y);
        const s = CHARACTER_HEIGHT_METERS / sourceHeight;
        model.scale.setScalar(s);
        model.updateMatrixWorld(true);
        const scaled = this.unionCharacterNormalizeBounds(model);
        const midX = (scaled.min.x + scaled.max.x) * 0.5;
        const midZ = (scaled.min.z + scaled.max.z) * 0.5;
        model.position.x -= midX;
        model.position.y -= scaled.min.y;
        model.position.z -= midZ;
    }

    /** Pick idle, walk, and fall clips from the GLB animation list. */
    private setupActions(clips: AnimationClip[]) {
        if (!this.mixer) {
            return;
        }
        const findClip = (name: string) => {
            const normalized = name.toLowerCase();
            return clips.find(c => c.name.toLowerCase().indexOf(normalized) >= 0) || null;
        };
        this.actions = {};
        const map: Partial<Record<CharacterActionName, AnimationClip | null>> = {
            Idle: findClip('idle'),
            Walk: findClip('walk') || findClip('run') || findClip('mixamo.com'),
            Fall: findClip('fall') || findClip('jump'),
        };

        (Object.keys(map) as CharacterActionName[]).forEach(name => {
            const clip = map[name];
            if (!clip) {
                return;
            }
            const action = this.mixer!.clipAction(clip);
            action.active = false;
            action.weight = 0;
            this.actions[name] = action;
        });

        const idle = this.actions.Idle || Object.values(this.actions)[0] || null;
        this.activateAction(idle, 0, 'Idle');
    }

    /** Choose the avatar animation from ground and speed state. */
    private resolveActionName(state: ViewerWalkCharacterState): CharacterActionName {
        if (!state.grounded) {
            // Small steps can briefly set grounded=false; keep idle/walk unless actually falling.
            if (state.speed >= CHARACTER_LOCOMOTION_WALK_ENTER_SPEED) {
                return this.resolveLocomotionAction(state);
            }
            if (state.verticalVelocity > CHARACTER_STAIR_FALL_VERTICAL_SPEED) {
                return this.resolveLocomotionAction(state);
            }
            return 'Fall';
        }
        return this.resolveLocomotionAction(state);
    }

    /** Switch between idle and walk with a small speed gap. */
    private resolveLocomotionAction(state: ViewerWalkCharacterState): 'Idle' | 'Walk' {
        if (this.locomotionAnim === 'Walk') {
            if (state.speed < CHARACTER_LOCOMOTION_IDLE_ENTER_SPEED) {
                this.locomotionAnim = 'Idle';
            }
        } else if (state.speed > CHARACTER_LOCOMOTION_WALK_ENTER_SPEED) {
            this.locomotionAnim = 'Walk';
        }
        return this.locomotionAnim;
    }

    /** Update speed and fade to the requested animation. */
    private playAction(name: CharacterActionName, state: ViewerWalkCharacterState) {
        const next = this.actions[name] || this.actions.Idle || null;
        this.updateActionSpeed(name, next, state);
        this.activateAction(next, FADE_SECONDS, name);
    }

    /** Fade from the current animation to the next one. */
    private activateAction(
        next: InstanceType<typeof Animation.AnimationAction> | null,
        fadeSeconds: number,
        nextName: CharacterActionName,
    ) {
        if (next === this.activeAction) {
            return;
        }
        const prevName = this.activeActionName;
        const softLocomotionHandoff =
            prevName !== null &&
            (prevName === 'Idle' || prevName === 'Walk') &&
            (nextName === 'Idle' || nextName === 'Walk');
        if (this.activeAction) {
            this.fadeAction(this.activeAction, 0, fadeSeconds, true);
        }
        this.activeAction = next;
        this.activeActionName = next !== null ? nextName : null;
        if (this.activeAction) {
            if (!softLocomotionHandoff || this.activeAction.weight < 0.02) {
                this.activeAction.reset();
            }
            this.activeAction.active = true;
            this.fadeAction(this.activeAction, 1, fadeSeconds, false);
        }
    }

    /** Queue a weight fade for one animation action. */
    private fadeAction(
        action: InstanceType<typeof Animation.AnimationAction>,
        targetWeight: number,
        duration: number,
        deactivateOnComplete: boolean,
    ) {
        this.actionFades = this.actionFades.filter(fade => fade.action !== action);
        if (duration <= 0) {
            action.weight = targetWeight;
            action.active = targetWeight > 0 || !deactivateOnComplete;
            return;
        }
        action.active = true;
        this.actionFades.push({
            action,
            from: action.weight,
            to: targetWeight,
            elapsed: 0,
            duration,
            deactivateOnComplete,
        });
    }

    /** Advance queued animation fades. */
    private updateActionFades(dt: number) {
        if (this.actionFades.length === 0) {
            return;
        }
        const remaining: ActionFade[] = [];
        for (const fade of this.actionFades) {
            fade.elapsed += Math.max(0, dt);
            const t = Math.min(1, fade.elapsed / fade.duration);
            fade.action.weight = fade.from + (fade.to - fade.from) * t;
            if (t < 1) {
                remaining.push(fade);
            } else if (fade.deactivateOnComplete) {
                fade.action.active = false;
            }
        }
        this.actionFades = remaining;
    }

    /** Match walk animation speed to movement speed. */
    private updateActionSpeed(
        name: CharacterActionName,
        action: InstanceType<typeof Animation.AnimationAction> | null,
        state: ViewerWalkCharacterState,
    ) {
        if (!action) {
            return;
        }
        if (name === 'Walk') {
            action.speed = Math.max(0.35, Math.min(0.8, state.speed / Math.max(0.001, state.walkSpeed)));
        } else {
            action.speed = 1;
        }
    }

    /** Smooth avatar turning so direction changes are not sharp. */
    private smoothCharacterYaw(targetYaw: number, dt: number) {
        const wrapped = Math.atan2(Math.sin(targetYaw - this.smoothedYaw), Math.cos(targetYaw - this.smoothedYaw));
        const alpha = 1 - Math.exp(-Math.max(0, dt) * 14);
        this.smoothedYaw += wrapped * alpha;
    }

    /** Remove avatar objects and stop animation resources. */
    dispose(): void {
        this.lifetime.abort();
        this.loadPromise = undefined;
        try {
            (this.viewer as any).unregisterPlugin(this.animationPlugin as never);
        } catch {
            /* ignore */
        }
        this.animationPlugin.destroy();
        this.characterRoot.removeFromParent();
        this.lights.removeFromParent();
        this.mixer = null;
        this.actions = {};
        this.activeAction = null;
        this.activeActionName = null;
        this.locomotionAnim = 'Idle';
        this.actionFades = [];
        this.loaded = false;
        this.loadError = false;
    }
}

// -----------------------------------------------------------------------------
// Demo scene resources and wiring
// -----------------------------------------------------------------------------

const WALK_CAMERA = {
    fov: 60,
    aspect: 1,
    near: 0.1,
    /** Large scans use world units much greater than 1e3; keep a generous perspective far plane. */
    far: 1_000_000,
} as const;

const LOD_MAGIC_CODE = 2500660;
/**
 * Rendering presets, ported from the original studio route's PRESETS and
 * matching the options in https://aholojs.dev/en-US/manual/3dgs-preset-config/
 *
 * Upstream's demo shipped Compressed + full SH with every culling mode off —
 * settings chosen to look good in a showcase, not to run on a viewer's laptop.
 * packType and maxShDegree are applied when the splat is PARSED, so changing
 * preset reloads the scene.
 */
type WalkPresetId = 'balanced' | 'performance' | 'quality' | 'extreme';

interface WalkPreset {
    label: string;
    packType: (typeof SplatPackType)[keyof typeof SplatPackType];
    maxShDegree: number;
    autoFreeResourceOnGpuPacked: boolean;
    config: object;
}

const WALK_PRESETS: Record<WalkPresetId, WalkPreset> = {
    balanced: {
        label: 'Balanced',
        packType: SplatPackType.SuperCompressed,
        maxShDegree: 3,
        autoFreeResourceOnGpuPacked: false,
        config: {
            pack: { precalculateEnabled: true, cameraRelativeEnabled: true },
            raster: { detailCullingThreshold: 1, maxStdDev: Math.sqrt(8) },
            sort: { minIntervalMs: 0 },
        },
    },
    performance: {
        label: 'Performance',
        packType: SplatPackType.SuperCompressed,
        maxShDegree: 3,
        autoFreeResourceOnGpuPacked: true,
        config: {
            pack: { precalculateEnabled: true, cameraRelativeEnabled: false },
            raster: { detailCullingThreshold: 1, maxStdDev: Math.sqrt(5) },
            sort: { minIntervalMs: 64 },
        },
    },
    quality: {
        label: 'Quality',
        packType: SplatPackType.Compressed,
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
        label: 'Extreme',
        packType: SplatPackType.SuperCompressed,
        // No spherical harmonics: 45 of the 59 floats per splat, and view-dependent
        // lighting adds little indoors.
        maxShDegree: 0,
        autoFreeResourceOnGpuPacked: true,
        config: {
            pack: { precalculateEnabled: false, cameraRelativeEnabled: false, sortedLayoutEnabled: true },
            raster: { detailCullingThreshold: 4, maxStdDev: Math.sqrt(5) },
            sort: { minIntervalMs: 160 },
        },
    },
};

/**
 * Defaults to 'quality' because that is the closest match to what this demo
 * shipped before presets existed (Compressed pack, full SH). The lighter presets
 * are UNVERIFIED here — switch with the Performance panel and compare fps rather
 * than assuming they are faster. Note no preset exactly reproduces the old
 * config: none of the raster/sort options were set at all previously.
 */
const WALK_DEFAULT_PRESET: WalkPresetId = 'quality';

type WalkLodMeta = SplatUtils.LodMeta;
type LodSplatInstance = InstanceType<typeof LodSplat>;

/** Reference third-person camera tuning. */
const REF_THIRD_PERSON = {
    modelScale: 0.3,
    cameraDistance: 3.2,
    targetHeight: 1.25,
} as const;

const THIRD_PERSON_CAMERA = {
    distance: (REF_THIRD_PERSON.cameraDistance * REF_THIRD_PERSON.modelScale) / THIRD_PERSON_MODEL_SCALE,
    targetHeight: (REF_THIRD_PERSON.targetHeight * REF_THIRD_PERSON.modelScale) / THIRD_PERSON_MODEL_SCALE,
} as const;

type WalkThirdPersonCharacterId = 'man' | 'robot';

const WALK_THIRD_PERSON_CHARACTER_URLS: Record<WalkThirdPersonCharacterId, string> = {
    man: WALK_CHARACTER_MODEL_URL_MAN,
    robot: WALK_CHARACTER_MODEL_URL_ROBOT,
};

/** Walk scene: splats or LOD stream on the shared preview viewer. */
class WalkDemoScene {
    private readonly viewer: Viewer;
    private readonly scene: Scene3D;
    private readonly splatLayer = new Object3D();
    private readonly camera: PerspectiveCamera;
    private lodSplat: LodSplatInstance | null = null;
    private thirdPerson: WalkThirdPersonCharacter | null = null;
    private thirdPersonModelUrl = WALK_CHARACTER_MODEL_URL_MAN;
    private preset: WalkPreset = WALK_PRESETS[WALK_DEFAULT_PRESET];
    private openingTransitionEnabled = true;

    constructor(viewer: Viewer) {
        this.viewer = viewer;
        this.scene = this.viewer.getScene() as Scene3D;
        this.applyViewerConfig();
        this.viewer.config.coordinateSystem.enabled.set(false);

        this.camera = new PerspectiveCamera(WALK_CAMERA.fov, WALK_CAMERA.aspect, WALK_CAMERA.near, WALK_CAMERA.far);
        this.camera.position.set(0, 0, 1);
        this.camera.rotation.set(0, 0, 0);
        this.camera.enableFrustumCulling = false;
        this.camera.enableDetailCulling = false;
        this.viewer.setCamera(this.camera);
        this.scene.add(this.splatLayer);

        // Every culling mode stays off, as upstream had it. Turning frustum
        // culling on FROZE the renderer: this demo drives the camera by writing
        // its transform directly and forcing a render each frame, and the culling
        // pass evidently cannot cope with that. Measured, not assumed — do not
        // "optimise" this back on without testing.
        const cul = (this.viewer as any).defaultViewport.drivenCullingConfig;
        cul.frustumCullingEnabled = false;
        cul.occlusionCullingEnabled = false;
        cul.detailCullingEnabled = false;
        cul.layersCullingEnabled = false;
        cul.triCullingEnabled = false;
    }

    /** Swap the rendering preset. Caller must reload the scene: packType and
     *  maxShDegree only take effect when the splat is parsed. */
    setPreset(preset: WalkPreset): void {
        this.preset = preset;
        this.applyViewerConfig();
    }

    /** Local edit: portal scene switches use a fade, not the first-load anneal. */
    setOpeningTransitionEnabled(enabled: boolean): void {
        this.openingTransitionEnabled = enabled;
    }

    /** Apply viewer settings needed by this demo, plus the active preset. */
    applyViewerConfig(): void {
        setViewerConfig(this.viewer, {
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
                    // The preset's pack/raster/sort options belong HERE, nested
                    // under Splatting — not at the top level of setViewerConfig.
                    // The original studio route used the same nesting.
                    ...(this.preset.config as object),
                },
                TAA: { enabled: false },
            },
        });
    }

    /** Replace current splats with static splat files. */
    async loadSplatUrls(urls: readonly string[], signal: AbortSignal): Promise<void> {
        if (urls.length === 0) {
            return;
        }
        this.clearSplats();
        await this.addSplatUrls(urls, signal);
    }

    /** Add static splats without clearing the active LOD stream. */
    async appendSplatUrls(urls: readonly string[], signal: AbortSignal): Promise<void> {
        if (urls.length === 0) {
            return;
        }
        await this.addSplatUrls(urls, signal);
    }

    /** Fetch, parse, and add static splat files. */
    private async addSplatUrls(urls: readonly string[], signal: AbortSignal): Promise<void> {
        for (const url of urls) {
            const response = await fetch(url, { signal });
            if (!response.ok) {
                throw new Error(`[walk] Splat URL failed: ${url} -> HTTP ${response.status}`);
            }
            const buffer = await response.arrayBuffer();
            throwIfAborted(signal);
            const u8 = new Uint8Array(buffer);
            const type = detectSplatFileType(splatFileTypeUrl(url), u8);
            if (type === undefined) {
                throw new Error(`[walk] Unknown splat file type: ${url}`);
            }

            const splatData = await parseSplatData(type, u8, this.preset.packType, {
                maxShDegree: this.preset.maxShDegree,
                maxTextureSize: 8192,
            });
            throwIfAborted(signal);
            const splat = await createSplat(splatData);
            splat.autoFreeResourceOnGpuPacked = this.preset.autoFreeResourceOnGpuPacked;
            throwIfAborted(signal);
            if (this.openingTransitionEnabled) {
                // Opening transition, same as the studio route at '/': the splats
                // anneal into place instead of popping in. The modifier is driven per
                // frame and removed once it finishes — see tickOpeningTransition.
                const modifier = createMcmcAnnealModifier(measureSplatCloud(splatData));
                splat.setModifiers([modifier]);
                this.opening.push({ splat, modifier });
                this.openingStartedAt = performance.now();
            }
            this.splatLayer.add(splat);
        }
    }

    /** Load the outdoor LOD stream and wait for the first chunk pass. */
    async loadLodStream(
        metaUrl: string,
        signal: AbortSignal,
        loadResource: (url: string) => ReturnType<typeof parseSplatData>,
    ): Promise<void> {
        this.clearSplats();
        const meta = await loadWalkLodMeta(metaUrl, signal);

        const lodSplat = new LodSplat(
            meta,
            {
                ...WALK_OUTDOOR_LOD_CONFIG,
                minLevel: Math.max(0, meta.levels - 1),
                schedulerParallelCounts: 99999,
                schedulerExistingTaskLimit: 99999,
                schedulerMinDuration: 0,
            },
            createViewerContext(this.viewer),
            loadResource,
        );
        this.scene.add(lodSplat.container);
        lodSplat.tick(this.camera);
        lodSplat.start();
        await lodSplat.onFinishSchedule();
        throwIfAborted(signal);

        lodSplat.setConfig(WALK_OUTDOOR_LOD_CONFIG);
        lodSplat.tick(this.camera);
        this.lodSplat = lodSplat;
    }

    /** Update LOD selection for the current camera. */
    tickLod(): void {
        this.lodSplat?.tick(this.camera);
    }

    /** Remove static splats and any active LOD stream. */
    private clearSplats(): void {
        this.opening.length = 0;
        while (this.splatLayer.children.length > 0) {
            const child = this.splatLayer.children[0]!;
            this.splatLayer.remove(child);
            if ('freeGPU' in child && typeof child.freeGPU === 'function') {
                child.freeGPU();
            }
            if ('destroy' in child && typeof child.destroy === 'function') {
                child.destroy();
            }
        }
        if (this.lodSplat) {
            this.lodSplat.destroy();
            this.lodSplat = null;
        }
    }

    /** Change the avatar GLB URL and reset the loaded avatar. */
    setThirdPersonModelUrl(url: string) {
        if (this.thirdPersonModelUrl === url) {
            return;
        }
        this.thirdPersonModelUrl = url;
        this.thirdPerson?.dispose();
        this.thirdPerson = null;
    }

    /** Create the avatar object when the view first needs it. */
    private ensureThirdPerson(): WalkThirdPersonCharacter {
        if (!this.thirdPerson) {
            this.thirdPerson = new WalkThirdPersonCharacter(this.scene, this.viewer, this.thirdPersonModelUrl);
        }
        return this.thirdPerson;
    }

    /** Show or hide the third-person avatar. */
    setThirdPersonEnabled(enabled: boolean): void {
        if (!enabled && !this.thirdPerson) {
            return;
        }
        this.ensureThirdPerson().setEnabled(enabled);
    }

    /** Wait until the avatar GLB is ready. */
    async waitForThirdPersonCharacter(signal: AbortSignal): Promise<void> {
        this.ensureThirdPerson();
        await this.thirdPerson!.waitUntilReady(signal);
    }

    /** Update avatar pose and animation. */
    updateThirdPersonCharacter(state: ViewerWalkCharacterState, dt: number): void {
        this.thirdPerson?.update(state, dt);
    }

    /**
     * Level the scan by rotating the splat layer, using the rotation reported by
     * the collision bake. This keeps the stored asset as the ORIGINAL capture —
     * nothing has to be pre-processed into the bucket, and the splat always
     * matches the collision grid because both come from the same measurement.
     */
    setLevellingRotation(m: number[][] | undefined): void {
        if (!m) {
            return;
        }
        // Matrix -> quaternion (Shepperd): pick the largest diagonal term for
        // numerical stability, which matters here because the rotation is ~180deg.
        const [m00, m01, m02] = m[0]!;
        const [m10, m11, m12] = m[1]!;
        const [m20, m21, m22] = m[2]!;
        const trace = m00! + m11! + m22!;
        let x: number, y: number, z: number, w: number;
        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (m21! - m12!) / s;
            y = (m02! - m20!) / s;
            z = (m10! - m01!) / s;
        } else if (m00! > m11! && m00! > m22!) {
            const s = Math.sqrt(1 + m00! - m11! - m22!) * 2;
            w = (m21! - m12!) / s;
            x = 0.25 * s;
            y = (m01! + m10!) / s;
            z = (m02! + m20!) / s;
        } else if (m11! > m22!) {
            const s = Math.sqrt(1 + m11! - m00! - m22!) * 2;
            w = (m02! - m20!) / s;
            x = (m01! + m10!) / s;
            y = 0.25 * s;
            z = (m12! + m21!) / s;
        } else {
            const s = Math.sqrt(1 + m22! - m00! - m11!) * 2;
            w = (m10! - m01!) / s;
            x = (m02! + m20!) / s;
            y = (m12! + m21!) / s;
            z = 0.25 * s;
        }
        this.splatLayer.quaternion = new Quaternion(x, y, z, w);
        this.splatLayer.updateMatrixWorld(true);
    }

    private opening: { splat: { setModifiers(m: unknown[]): void }; modifier: ReturnType<typeof createMcmcAnnealModifier> }[] = [];
    private openingStartedAt = 0;

    /**
     * Advance the opening anneal. Returns true while it is still running, so the
     * frame loop knows it must keep rendering even if nothing else moved.
     */
    tickOpeningTransition(now: number): boolean {
        if (!this.opening.length) {
            return false;
        }
        const elapsed = now - this.openingStartedAt;
        const progress = openingAnnealProgress(elapsed, ANNEAL_DURATION_MS);
        for (const entry of this.opening) {
            entry.modifier.update({ progress, time: elapsed / 1000 });
        }
        if (progress <= 0) {
            // Done: drop the modifier so the splats render at full speed.
            for (const entry of this.opening) {
                entry.splat.setModifiers([]);
            }
            this.opening.length = 0;
            return false;
        }
        return true;
    }

    /** Copy walk camera state to the viewer camera. */
    updateCamera(state: ReturnType<ViewerWalkMode['getCameraState']>): void {
        this.camera.scale.copy(state.scale);
        this.camera.rotation.copy(state.rotation);
        this.camera.position.copy(state.position);
        this.camera.updateMatrixWorld(true);
        // Splat sorting depends on the viewer seeing this manual camera move as a real frame update.
        (this.viewer as any).forceNextFrameRender = true;
    }

    /** Remove demo scene objects. */
    dispose(): void {
        this.thirdPerson?.dispose();
        this.thirdPerson = null;
        this.clearSplats();
        this.splatLayer.removeFromParent();
    }
}

// -----------------------------------------------------------------------------
// Demo presets and loading helpers
// -----------------------------------------------------------------------------

type WalkViewMode = 'first' | 'third' | 'fly';
type WalkDemoSchemeId = 'indoor' | 'balcony' | 'outdoor';

/** Initial capsule center and camera angles. */
interface WalkDemoInitialPose {
    px: number;
    py: number;
    pz: number;
    yaw: number;
    pitch: number;
    thirdPersonDistance?: number;
}

interface WalkDemoScheme {
    id: WalkDemoSchemeId;
    splatMode: 'files' | 'lod';
    splatCandidates?: readonly string[];
    staticSplatUrls?: readonly string[];
    lodMetaUrl?: string;
    voxelJson?: string;
    voxelBin?: string;
    /** Baked walkable grid; when set it supersedes voxelJson/voxelBin. */
    collisionGrid?: string;
    /** Folder holding this scene's assets; portals.json is read/written here. */
    assetBase?: string;
    pose: WalkDemoInitialPose;
}

// Spawn for the local hall-3 scene: floor sits near y = -1.25 and the ceiling
// near y = +2.0, so this drops the capsule into open space just above the floor.
const WALK_DEMO_INDOOR_POSE: WalkDemoInitialPose = {
    px: 0,
    py: -0.4,
    pz: 0,
    yaw: 0,
    pitch: 0,
    thirdPersonDistance: 3.4,
};

const WALK_DEMO_BALCONY_POSE: WalkDemoInitialPose = {
    px: 9.14,
    py: 0.17,
    pz: 3.09,
    yaw: 0,
    pitch: 0,
    thirdPersonDistance: 3.4,
};

const WALK_DEMO_OUTDOOR_POSE: WalkDemoInitialPose = {
    px: 20.398008,
    py: -0.15,
    pz: 62.773942,
    yaw: -0.384,
    pitch: -0.672,
    thirdPersonDistance: 3.6,
};

const WALK_DEMO_SCHEMES: Record<WalkDemoSchemeId, WalkDemoScheme> = {
    // Local hall-3 scene. The source Brush export is y-down ("OpenCV -Y", as
    // Brush exports are y-down ("OpenCV -Y") but ViewerWalkMode is y-up, so public/splat_hall_3.ply
    // is the source rotated 180 deg about X. Collision was voxelized from that
    // same rotated file, so splat and collision cannot drift apart. Regenerate with:
    //   npx @playcanvas/splat-transform -w -g 0 <src>.ply -N -r 180,0,0 rot.ply
    //   npx @playcanvas/splat-transform -w -g 0 rot.ply -B -30,-6,-30,30,8,30 \
    //     --voxel-size 0.06 --voxel-external-fill --seed-pos 0,-0.6,0 \
    //     public/voxel-hall-3/collision.voxel.json
    indoor: {
        id: 'indoor',
        splatMode: 'files',
        assetBase: SCENE_HALL,
        splatCandidates: [splatUrl(SCENE_HALL, SPLAT_BASE_URL)],
        // Baked by tools/build-collision.mjs; supplies floor AND walls, and is a
        // few KB so it lands long before the splat finishes downloading.
        collisionGrid: `${SCENE_HALL}collision.json`,
        pose: WALK_DEMO_INDOOR_POSE,
    },
    balcony: {
        id: 'balcony',
        splatMode: 'files',
        assetBase: SCENE_BALCONY,
        splatCandidates: [`${splatUrl(SCENE_BALCONY, SPLAT_BASE_URL)}?v=brush-balcony-20260806`],
        collisionGrid: `${SCENE_BALCONY}collision.json`,
        pose: WALK_DEMO_BALCONY_POSE,
    },
    outdoor: {
        id: 'outdoor',
        splatMode: 'lod',
        lodMetaUrl: `${WALK_OUTDOOR_URL_PREFIX}chunk-lod/0f9e3ae1/lod-meta.json`,
        staticSplatUrls: [`${WALK_OUTDOOR_URL_PREFIX}environment.d3e129aa.ply`],
        voxelJson: `${WALK_OUTDOOR_URL_PREFIX}voxel/309eccc1/collision.voxel-meta.json`,
        voxelBin: `${WALK_OUTDOOR_URL_PREFIX}voxel/309eccc1/collision.voxel.bin`,
        pose: WALK_DEMO_OUTDOOR_POSE,
    },
};

/** Outdoor juguo LOD stream cap (6M splats). */
const WALK_OUTDOOR_LOD_MAX_BUDGET = 6_000_000;

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

function getWalkDemoUiStrings() {
    const lang = (typeof document !== 'undefined' && document.documentElement.getAttribute('lang')) || '';
    const zh = lang.toLowerCase().startsWith('zh');
    return {
        paneTitle: zh ? '行走模式' : 'Walk mode',
        schemeLabel: zh ? '场景' : 'Scene',
        schemeIndoor: zh ? '室内' : 'Indoor',
        schemeBalcony: zh ? '阳台' : 'Balcony',
        schemeOutdoor: zh ? '室外' : 'Outdoor',
        viewLabel: zh ? '视角' : 'Camera',
        first: zh ? '第一人称' : 'First-person',
        third: zh ? '第三人称' : 'Third-person',
        fly: zh ? '飞行' : 'Fly',
        characterLabel: zh ? '第三人称模型' : 'Third-person model',
        characterMan: zh ? '男性' : 'Man',
        characterRobot: zh ? '机器人' : 'Robot',
    };
}

async function loadWalkLodMeta(metaUrl: string, signal: AbortSignal): Promise<WalkLodMeta> {
    const response = await fetch(metaUrl, { signal });
    if (!response.ok) {
        throw new Error(`[walk] LOD metadata failed (${response.status} ${response.statusText}).`);
    }
    const content: unknown = await response.json();
    if (!isWalkLodMeta(content)) {
        throw new Error('[walk] LOD metadata is not a supported lod-splat manifest.');
    }
    return content;
}

const WALK_OUTDOOR_LOD_CONFIG = {
    minLevel: 0,
    maxBudget: WALK_OUTDOOR_LOD_MAX_BUDGET,
    backgroundPenalty: 1,
    outsidePenalty: 1,
    behindPenalty: 1,
    behindTolerance: -0.2,
    behindDistanceTolerance: 2,
    hysteresisTicks: 4,
    schedulerParallelCounts: 4,
    schedulerExistingTaskLimit: 64,
    schedulerMinDuration: 160,
    debuggerEnabled: false,
    debuggerType: 0 as const,
};

function createWalkOutdoorLodResourceLoader(
    indexedDB: RuntimeIndexedDBStorage,
    metaBaseUrl: string,
    signal: AbortSignal,
) {
    return async (url: string) => {
        throwIfAborted(signal);
        const resourceUrl = new URL(url, metaBaseUrl).toString();
        const cached = await indexedDB.get<SerializedCompressedSplatData>(resourceUrl, { version: 0 });
        throwIfAborted(signal);
        if (cached) {
            const splatData = new CompressedSplatData();
            splatData.deserialize(cached);
            return splatData;
        }

        const fileType = detectSplatFileType(splatFileTypeUrl(resourceUrl), new Uint8Array());
        if (fileType === undefined) {
            throw new Error(`[walk] Unsupported LOD resource: ${resourceUrl}`);
        }
        const splatData = await parseSplatData(fileType, resourceUrl, SplatPackType.Compressed);
        throwIfAborted(signal);
        await indexedDB.set(resourceUrl, splatData.serialize(), { version: 0 });
        return splatData;
    };
}

function isReloadAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function isWalkLodMeta(value: unknown): value is WalkLodMeta {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const meta = value as Partial<WalkLodMeta>;
    return meta.magicCode === LOD_MAGIC_CODE && meta.type === 'lod-splat';
}

// -----------------------------------------------------------------------------
// Render runtime entry and demo shell
// -----------------------------------------------------------------------------

export default async function runner(ctx: RenderRuntime): Promise<() => void> {
    const app = new WalkDemoApp(ctx);
    await app.run();
    return () => {
        app.dispose();
    };
}

/** Wires splats/LOD, collision, and walk mode on the render runtime. */
class WalkDemoApp {
    private readonly ctx: RenderRuntime;
    private params: {
        scheme: WalkDemoSchemeId;
        viewMode: WalkViewMode;
        thirdPersonCharacter: WalkThirdPersonCharacterId;
        showCollision: boolean;
        freeRoam: boolean;
        preset: WalkPresetId;
        fps: string;
        showPortals: boolean;
        portalName: string;
        portalStatus: string;
        insidePortal: string;
        positionStatus: string;
        manualCollisionStatus: string;
    };
    private portals: Portal[] = [];
    private manualCollision: ManualCollisionData = { ...EMPTY_MANUAL_COLLISION, floors: [], walls: [] };
    private portalsFolder: FolderApi | undefined;
    private portalRows: FolderApi[] = [];
    private collisionDebug: CollisionDebugOverlay | undefined;
    private scene: WalkDemoScene | undefined;
    private walk: ViewerWalkMode | undefined;
    private running = false;
    private reloadGeneration = 0;
    private reloadAbort: AbortController | undefined;
    private reloadChain: Promise<void> = Promise.resolve();
    private hideLoadingOnFrame = false;
    private restoredCamera: ReturnType<Viewer['getCamera']> | undefined;
    private thirdPersonCharacterBinding: { refresh(): void } | undefined;
    private portalFade: HTMLDivElement | undefined;
    private mobileJoystick: HTMLDivElement | undefined;
    private teleporting = false;
    private firstSceneLoad = true;

    constructor(ctx: RenderRuntime) {
        this.ctx = ctx;
        this.params = {
            scheme: 'indoor',
            viewMode: 'third',
            // Changed from the upstream 'man' default.
            thirdPersonCharacter: 'robot',
            preset: WALK_DEFAULT_PRESET,
            fps: '-',
            // Debug views default OFF and remember their last state, so a reload
            // never drops you into a scene full of debug geometry.
            showCollision: readDevToggle('showCollision'),
            // Defaults ON (in dev builds only — see devEnabled below): an
            // unrestricted floor-only collider is what you want while
            // previewing a character/camera, not an opt-in extra. Gated by
            // devEnabled so a production visitor always gets real collision
            // even if this happens to be true in localStorage from dev use.
            freeRoam: devEnabled('collision') && readDevToggle('freeRoam', true),
            // Separate from showCollision on purpose: the common case while
            // authoring is markers on with the collision overlay off.
            showPortals: readDevToggle('showPortals'),
            portalName: '',
            portalStatus: '-',
            insidePortal: '-',
            positionStatus: '-',
            manualCollisionStatus: '-',
        };
    }

    /** Mount UI, start the frame loop, and load the first scene. */
    async run(): Promise<void> {
        const flags = activeDevFlags();
        if (flags.length) {
            console.log(`[walk] developer settings active: ${flags.join(', ')} (see docs/dev-settings.md)`);
        }
        this.mountConfigPanel();
        this.mountMobileJoystick();
        /** Frame callback returns whether the runtime should render. */
        this.ctx.renderer.frame(({ delta }) => this.onFrame(delta));
        await this.queueReloadScene();
    }

    /** Build the small runtime control panel. */
    private mountConfigPanel(): void {
        if (!this.ctx.configPanel.available) {
            return;
        }
        const ui = getWalkDemoUiStrings();
        const pane = this.ctx.configPanel.createPane({
            title: ui.paneTitle,
            expanded: !window.matchMedia('(max-width: 760px)').matches,
        });
        // Outdoor is intentionally left out; local property scenes stay listed.
        // The 'outdoor' scheme still exists, so re-adding it here is enough.
        pane.addBinding(this.params, 'scheme', {
            label: ui.schemeLabel,
            options: { [ui.schemeIndoor]: 'indoor', [ui.schemeBalcony]: 'balcony' },
        }).on('change', () => {
            // Upstream forced 'man' for indoor / 'robot' for outdoor here, which
            // would undo the robot default on the first scene switch. Keep
            // whatever character is selected instead.
            this.thirdPersonCharacterBinding?.refresh();
            void this.queueReloadScene();
        });
        this.thirdPersonCharacterBinding = pane
            .addBinding(this.params, 'thirdPersonCharacter', {
                label: ui.characterLabel,
                options: { [ui.characterMan]: 'man', [ui.characterRobot]: 'robot' },
            })
            .on('change', () => {
                void this.swapThirdPersonCharacter();
            });
        // Developer setting: hidden unless the collision flag is on. See
        // docs/dev-settings.md.
        if (devEnabled('collision')) {
            pane.addBinding(this.params, 'showCollision', { label: 'Show collision' }).on('change', () => {
                writeDevToggle('showCollision', this.params.showCollision);
                this.collisionDebug?.setVisible(this.params.showCollision);
            });
            pane.addBinding(this.params, 'freeRoam', { label: 'Free roam' }).on('change', () => {
                writeDevToggle('freeRoam', this.params.freeRoam);
                this.walk?.setFreeRoam(this.params.freeRoam);
            });
            pane.addButton({ title: 'Add floor collision' }).on('click', () => {
                this.addManualFloorCollision();
            });
            pane.addButton({ title: 'Add wall collision' }).on('click', () => {
                this.addManualWallCollision();
            });
            pane.addButton({ title: 'Erase collision' }).on('click', () => {
                this.eraseManualCollision();
            });
            pane.addButton({ title: 'Save collision' }).on('click', () => {
                void this.persistManualCollision();
            });
            pane.addBinding(this.params, 'manualCollisionStatus', { readonly: true, label: 'manual' });
        }
        // Developer setting: rendering preset and frame rate, for comparing the
        // 3dgs preset options. See docs/dev-settings.md.
        if (devEnabled('perf')) {
            const perf = pane.addFolder({ title: 'Performance' });
            perf.addBinding(this.params, 'preset', {
                label: 'Preset',
                options: Object.fromEntries(
                    (Object.keys(WALK_PRESETS) as WalkPresetId[]).map((id) => [WALK_PRESETS[id].label, id]),
                ),
            }).on('change', () => {
                // packType and maxShDegree apply at parse time, so this costs a
                // full scene reload — expected, not a bug.
                this.scene?.setPreset(WALK_PRESETS[this.params.preset]);
                void this.queueReloadScene();
            });
            perf.addBinding(this.params, 'fps', { readonly: true, label: 'fps' });
        }

        // Developer setting: portal capture. See docs/dev-settings.md.
        if (devEnabled('portals')) {
            this.mountPortalPanel(pane);
        }
        if (envDevFlagsActive()) {
            pane.addButton({ title: 'Copy position' }).on('click', () => {
                void this.copyCurrentPosition();
            });
            pane.addBinding(this.params, 'positionStatus', { readonly: true, label: 'position' });
        }
        const viewOptions: Record<string, WalkViewMode> = { [ui.first]: 'first', [ui.third]: 'third' };
        if (activeDevFlags().length) {
            viewOptions[ui.fly] = 'fly';
        }
        pane.addBinding(this.params, 'viewMode', {
            label: ui.viewLabel,
            options: viewOptions,
        }).on('change', () => {
            const walk = this.walk;
            const scene = this.scene;
            if (!walk || !scene) {
                return;
            }
            this.applyViewMode(walk, scene);
            if (this.params.viewMode === 'third') {
                void this.swapThirdPersonCharacter();
            }
        });
    }

    /** Capture UI plus the per-portal list. Developer setting only. */
    private mountPortalPanel(pane: Pane): void {
        const folder = pane.addFolder({ title: 'Portals' });
        folder.addBinding(this.params, 'showPortals', { label: 'Show portals' }).on('change', () => {
            writeDevToggle('showPortals', this.params.showPortals);
            this.collisionDebug?.setPortalsVisible(this.params.showPortals);
        });
        folder.addBinding(this.params, 'portalName', { label: 'Name' });
        folder.addButton({ title: 'Add portal here' }).on('click', () => {
            void this.capturePortal();
        });
        // Read-only feedback: whether the last save worked, and which portal you
        // are standing in right now.
        folder.addBinding(this.params, 'portalStatus', { readonly: true, label: 'saved' });
        folder.addBinding(this.params, 'insidePortal', { readonly: true, label: 'inside' });
        this.portalsFolder = folder;
        this.rebuildPortalList();
    }

    /** Record a portal where the walker is standing, then persist. */
    private async capturePortal(): Promise<void> {
        const walk = this.walk;
        const base = WALK_DEMO_SCHEMES[this.params.scheme].assetBase;
        if (!walk || !base) {
            return;
        }
        const state = walk.getCharacterState();
        const name = this.params.portalName.trim() || nextPortalName(this.portals);
        if (this.portals.some((p) => p.name === name)) {
            this.params.portalStatus = `name '${name}' already used`;
            return;
        }
        this.portals.push(createPortal(name, state.position.x, state.position.y, state.position.z, state.yaw));
        this.params.portalName = '';
        this.rebuildPortalList();
        await this.persistPortals(base);
    }

    private async persistPortals(base: string): Promise<void> {
        const error = await savePortals(base, this.portals);
        this.params.portalStatus = error
            ? `save failed: ${error}`
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    /**
     * Redraw the per-portal rows. The whole list is disposed and rebuilt rather
     * than patched: tweakpane does not handle incremental mutation well, and the
     * list is small enough that rebuilding costs nothing.
     */
    private rebuildPortalList(): void {
        const folder = this.portalsFolder;
        if (!folder) {
            return;
        }
        for (const row of this.portalRows.splice(0)) {
            row.dispose();
        }
        const base = WALK_DEMO_SCHEMES[this.params.scheme].assetBase;
        for (const portal of this.portals) {
            // Collapsed by default: deleting takes expand-then-click, so a stray
            // click on the list cannot remove the wrong portal.
            const row = folder.addFolder({ title: portal.name, expanded: false });
            const at = {
                x: +portal.position.x.toFixed(2),
                y: +portal.position.y.toFixed(2),
                z: +portal.position.z.toFixed(2),
            };
            row.addBinding(at, 'x', { readonly: true });
            row.addBinding(at, 'y', { readonly: true });
            row.addBinding(at, 'z', { readonly: true });
            row.addBinding(portal, 'radius', { min: 0.3, max: 3, step: 0.1 }).on('change', () => {
                if (base) void this.persistPortals(base);
            });
            row.addButton({ title: 'Delete' }).on('click', () => {
                this.portals = this.portals.filter((p) => p !== portal);
                this.rebuildPortalList();
                if (base) void this.persistPortals(base);
            });
            this.portalRows.push(row);
        }
    }

    /**
     * Edge-triggered portal enter/exit. Fires once per transition rather than
     * every frame, which is also how a real scene change will need to behave —
     * enter starts it, exit cancels a prefetch if you step back out.
     */
    private updatePortalTrigger(walk: ViewerWalkMode, x: number, z: number): void {
        const current = portalAt(this.portals, x, z);
        if (current?.name !== this.insidePortalName) {
            if (this.insidePortalName) {
                console.log(`[portal] exited ${this.insidePortalName}`);
            }
            if (current) {
                console.log(`[portal] entered ${current.name}`, current.to ? `-> ${current.to}` : '(no target yet)');
                void this.teleportThroughPortal(current);
            }
            this.insidePortalName = current?.name;
            this.params.insidePortal = current?.name ?? '-';
        }
        const floorY = walk.collisionGrid?.floorY;
        if (floorY !== undefined) {
            this.collisionDebug?.updatePortals(this.portals, this.insidePortalName, floorY);
        }
    }

    private async teleportThroughPortal(portal: Portal): Promise<void> {
        if (this.teleporting) {
            return;
        }
        const target = resolvePortalTeleport(portal, new Set(Object.keys(WALK_DEMO_SCHEMES) as WalkDemoSchemeId[]));
        if (!target) {
            return;
        }
        this.teleporting = true;
        try {
            await this.setPortalFade(1);
            await this.queueReloadScene(target);
            await this.setPortalFade(0);
        } finally {
            this.teleporting = false;
        }
    }

    private setPortalFade(opacity: 0 | 1): Promise<void> {
        const overlay = this.getPortalFade();
        overlay.style.pointerEvents = opacity ? 'auto' : 'none';
        return new Promise(resolve => {
            let fallback = 0;
            const done = () => {
                window.clearTimeout(fallback);
                overlay.removeEventListener('transitionend', done);
                resolve();
            };
            overlay.addEventListener('transitionend', done, { once: true });
            requestAnimationFrame(() => {
                overlay.style.opacity = String(opacity);
                fallback = window.setTimeout(done, 260);
            });
        });
    }

    private getPortalFade(): HTMLDivElement {
        if (this.portalFade) {
            return this.portalFade;
        }
        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'background:#000',
            'opacity:0',
            'pointer-events:none',
            'transition:opacity 220ms ease',
            'z-index:9999',
        ].join(';');
        document.body.append(overlay);
        this.portalFade = overlay;
        return overlay;
    }

    private mountMobileJoystick(): void {
        if (this.mobileJoystick) {
            return;
        }
        const joystick = document.createElement('div');
        joystick.className = 'walk-mobile-joystick';
        joystick.setAttribute('aria-hidden', 'true');
        joystick.style.cssText = [
            'position:fixed',
            'left:max(18px, env(safe-area-inset-left))',
            'bottom:max(22px, env(safe-area-inset-bottom))',
            'width:112px',
            'height:112px',
            'display:block',
            'border-radius:999px',
            'background:rgba(255,255,255,0.16)',
            'border:1px solid rgba(255,255,255,0.28)',
            'box-shadow:0 14px 44px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.35)',
            'backdrop-filter:blur(18px) saturate(1.6)',
            '-webkit-backdrop-filter:blur(18px) saturate(1.6)',
            'touch-action:none',
            'z-index:10000',
        ].join(';');
        const knob = document.createElement('div');
        knob.className = 'walk-mobile-joystick__knob';
        knob.style.cssText = [
            'position:absolute',
            'left:50%',
            'top:50%',
            'width:50px',
            'height:50px',
            'border-radius:999px',
            'background:rgba(255,255,255,0.34)',
            'border:1px solid rgba(255,255,255,0.42)',
            'box-shadow:0 8px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.55)',
            'transform:translate(-50%, -50%)',
        ].join(';');
        joystick.append(knob);

        let pointerId: number | undefined;
        const radius = 42;
        const reset = () => {
            pointerId = undefined;
            knob.style.transform = 'translate(-50%, -50%)';
            this.walk?.setTouchMove(0, 0);
        };
        const update = (e: PointerEvent) => {
            const rect = joystick.getBoundingClientRect();
            const input = mobileJoystickInput(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2, radius);
            knob.style.transform = `translate(-50%, -50%) translate(${input.knobX}px, ${input.knobY}px)`;
            this.walk?.setTouchMove(input.forward, input.strafe);
        };
        joystick.addEventListener('pointerdown', e => {
            pointerId = e.pointerId;
            joystick.setPointerCapture(e.pointerId);
            update(e);
            e.preventDefault();
        });
        joystick.addEventListener('pointermove', e => {
            if (pointerId !== e.pointerId) {
                return;
            }
            update(e);
            e.preventDefault();
        });
        joystick.addEventListener('pointerup', reset);
        joystick.addEventListener('pointercancel', reset);

        document.body.append(joystick);
        this.mobileJoystick = joystick;
    }

    private async copyCurrentPosition(): Promise<void> {
        const walk = this.walk;
        if (!walk) {
            return;
        }
        try {
            await navigator.clipboard.writeText(formatDeveloperPose(walk.getPose()));
            this.params.positionStatus = 'copied';
        } catch (error) {
            this.params.positionStatus = `copy failed: ${String((error as Error)?.message ?? error)}`;
        }
    }

    private currentFloorY(): number {
        const walk = this.walk;
        if (!walk) return this.manualCollision.floorY;
        const pose = walk.getPose();
        return this.manualCollision.floors.length || this.manualCollision.walls.length
            ? this.manualCollision.floorY
            : (walk.collisionGrid?.floorY ?? pose.y - WALK_HOVER_HEIGHT - WALK_EYE_HEIGHT);
    }

    private aimPoint(): { x: number; z: number; yaw: number } | null {
        const walk = this.walk;
        if (!walk) return null;
        const camera = walk.getCameraState();
        const yaw = camera.rotation.y;
        const pitch = camera.rotation.x;
        const cp = Math.cos(pitch);
        const dx = -Math.sin(yaw) * cp;
        const dy = Math.sin(pitch);
        const dz = -Math.cos(yaw) * cp;
        const floorY = this.currentFloorY();
        if (dy < -0.01 && camera.position.y > floorY) {
            const t = (floorY - camera.position.y) / dy;
            if (t > 0 && t < 12) {
                return { x: camera.position.x + dx * t, z: camera.position.z + dz * t, yaw };
            }
        }
        const pose = walk.getPose();
        return { x: pose.x - Math.sin(pose.yaw) * 1.5, z: pose.z - Math.cos(pose.yaw) * 1.5, yaw: pose.yaw };
    }

    private applyManualCollision(): void {
        this.walk?.setManualCollision(this.manualCollision);
        this.collisionDebug?.updateManualCollision(this.manualCollision);
    }

    private addManualFloorCollision(): void {
        const point = this.aimPoint();
        if (!point) return;
        this.manualCollision = {
            ...this.manualCollision,
            floorY: this.currentFloorY(),
            wallHeight: this.manualCollision.wallHeight || 2,
            floors: [...this.manualCollision.floors, { x: point.x, z: point.z, width: 3, depth: 3 }],
        };
        this.params.manualCollisionStatus = `${this.manualCollision.floors.length} floor, ${this.manualCollision.walls.length} wall`;
        this.applyManualCollision();
    }

    private addManualWallCollision(): void {
        const point = this.aimPoint();
        if (!point) return;
        this.manualCollision = {
            ...this.manualCollision,
            floorY: this.currentFloorY(),
            wallHeight: this.manualCollision.wallHeight || 2,
            walls: [...this.manualCollision.walls, { x: point.x, z: point.z, width: 1.4, depth: 0.24, yaw: point.yaw }],
        };
        this.params.manualCollisionStatus = `${this.manualCollision.floors.length} floor, ${this.manualCollision.walls.length} wall`;
        this.applyManualCollision();
    }

    private eraseManualCollision(): void {
        const point = this.aimPoint();
        if (!point) return;
        this.manualCollision = eraseManualCollisionAt(this.manualCollision, point.x, point.z, 0.7);
        this.params.manualCollisionStatus = `${this.manualCollision.floors.length} floor, ${this.manualCollision.walls.length} wall`;
        this.applyManualCollision();
    }

    private async persistManualCollision(): Promise<void> {
        const base = WALK_DEMO_SCHEMES[this.params.scheme].assetBase;
        if (!base) return;
        const error = await saveManualCollision(base, this.manualCollision);
        this.params.manualCollisionStatus = error
            ? `save failed: ${error}`
            : `saved ${this.manualCollision.floors.length}/${this.manualCollision.walls.length}`;
    }

    private insidePortalName: string | undefined;
    private frameCount = 0;
    private fpsSampledAt = performance.now();

    /** Apply third-person camera distance for the current scene. */
    private applyThirdPersonCameraToWalk(walk: ViewerWalkMode, scheme: WalkDemoScheme): void {
        let tpDistance = THIRD_PERSON_CAMERA.distance;
        if (this.params.viewMode === 'third' && scheme.pose.thirdPersonDistance != null) {
            tpDistance = scheme.pose.thirdPersonDistance;
        }
        walk.setThirdPersonCamera(tpDistance, THIRD_PERSON_CAMERA.targetHeight, 0.8, Math.max(4, tpDistance));
    }

    /** Swap the avatar GLB without reloading splats or collision. */
    private async swapThirdPersonCharacter(): Promise<void> {
        const scene = this.scene;
        if (!scene) {
            return;
        }

        const scheme = WALK_DEMO_SCHEMES[this.params.scheme];
        scene.setThirdPersonModelUrl(WALK_THIRD_PERSON_CHARACTER_URLS[this.params.thirdPersonCharacter]);
        const walk = this.walk;
        if (walk) {
            this.applyThirdPersonCameraToWalk(walk, scheme);
        }

        if (this.params.viewMode !== 'third') {
            this.ctx.renderer.render();
            return;
        }

        this.ctx.loading.show();
        try {
            const signal = this.reloadAbort?.signal ?? this.ctx.signal;
            await scene.waitForThirdPersonCharacter(signal);
            if (walk) {
                this.applyViewMode(walk, scene);
            }
            this.ctx.renderer.render();
        } catch (error) {
            if (!isReloadAbortError(error) && !(error instanceof DOMException && error.name === 'AbortError')) {
                console.error('[walk] Third-person character load failed:', error);
            }
        } finally {
            if (this.running) {
                this.ctx.loading.hide();
            }
        }
    }

    /** Apply first-person or third-person mode to walk and scene state. */
    private applyViewMode(walk: ViewerWalkMode, scene: WalkDemoScene): void {
        const third = this.params.viewMode === 'third';
        const fly = this.params.viewMode === 'fly' && activeDevFlags().length > 0;
        if (this.params.viewMode === 'fly' && !fly) {
            this.params.viewMode = 'first';
        }
        walk.flyMode = fly;
        walk.thirdPersonEnabled = third;
        walk.thirdPersonCameraPreset = this.params.scheme === 'outdoor' ? 'outdoor' : 'indoor';
        const indoorSpeed = third ? 1.35 : 2.7;
        walk.moveSpeed = fly ? 4.5 : this.params.scheme === 'outdoor' ? 2.15 : indoorSpeed;
        // Avatar visibility is owned by onFrame, which keeps it on until the
        // camera has blended away from the head — hiding it here would pop.
        void scene;
    }

    /** Serialize scene reloads so rapid UI changes do not overlap. */
    private queueReloadScene(options: { scheme?: WalkDemoSchemeId; pose?: TeleportPose; skipOpeningTransition?: boolean } = {}): Promise<void> {
        this.reloadChain = this.reloadChain
            .then(() => this.reloadScene(options))
            .catch(error => {
                if (!isReloadAbortError(error)) {
                    console.error('[walk] Scene reload failed:', error);
                }
            });
        return this.reloadChain;
    }

    /** Update walk, avatar, camera, and LOD once per frame. */
    private onFrame(delta: number): boolean {
        if (!this.running) {
            return false;
        }
        const sceneLoop = this.scene;
        const walkLoop = this.walk;
        if (!sceneLoop || !walkLoop) {
            return false;
        }
        const scheme = WALK_DEMO_SCHEMES[this.params.scheme];
        walkLoop.update(delta);
        // Keep the avatar alive for the whole transition, not just while
        // third-person is selected, so it animates as the camera pulls away and
        // only disappears once the camera is back inside the head.
        const showAvatar = walkLoop.viewBlend > 0.02;
        if (showAvatar) {
            sceneLoop.updateThirdPersonCharacter(walkLoop.getCharacterState(), delta);
        }
        sceneLoop.setThirdPersonEnabled(showAvatar);
        const walker = walkLoop.getCharacterState().position;
        this.collisionDebug?.update(walkLoop.collisionGrid, walker.x, walker.z);
        this.updatePortalTrigger(walkLoop, walker.x, walker.z);
        sceneLoop.updateCamera(walkLoop.getCameraState());
        if (scheme.splatMode === 'lod') {
            sceneLoop.tickLod();
        }

        // Keep rendering while the opening anneal runs, even if nothing else in
        // the scene changed this frame.
        const now = performance.now();
        sceneLoop.tickOpeningTransition(now);

        // Frame rate, sampled over ~half a second so the number is readable.
        this.frameCount++;
        if (now - this.fpsSampledAt > 500) {
            this.params.fps = String(Math.round((this.frameCount * 1000) / (now - this.fpsSampledAt)));
            this.frameCount = 0;
            this.fpsSampledAt = now;
        }

        if (this.hideLoadingOnFrame) {
            this.hideLoadingOnFrame = false;
            this.ctx.loading.hide();
        }
        return true;
    }

    /** Reload splats or LOD, avatar, walk mode, and voxel collision. */
    private async reloadScene(options: { scheme?: WalkDemoSchemeId; pose?: TeleportPose; skipOpeningTransition?: boolean } = {}): Promise<void> {
        this.reloadAbort?.abort();
        this.reloadAbort = new AbortController();
        const reloadSignal = this.reloadAbort.signal;
        const generation = ++this.reloadGeneration;
        if (options.scheme) {
            this.params.scheme = options.scheme;
        }
        const scheme = WALK_DEMO_SCHEMES[this.params.scheme];
        const useOpeningTransition = this.firstSceneLoad && !options.skipOpeningTransition;

        this.running = false;
        this.collisionDebug?.dispose();
        this.collisionDebug = undefined;
        this.walk?.dispose();
        this.walk = undefined;
        this.scene?.dispose();
        this.scene = undefined;

        throwIfAborted(this.ctx.signal);
        throwIfAborted(reloadSignal);
        this.ctx.control.setOptions({ enabled: false });
        this.ctx.loading.show();

        const viewer = this.ctx.renderer.viewer;
        if (!this.restoredCamera) {
            this.restoredCamera = viewer.getCamera();
        }

        const scene = new WalkDemoScene(viewer);
        scene.setOpeningTransitionEnabled(useOpeningTransition);
        scene.setThirdPersonModelUrl(WALK_THIRD_PERSON_CHARACTER_URLS[this.params.thirdPersonCharacter]);
        this.scene = scene;
        this.ctx.renderer.resize();

        try {
            if (scheme.splatMode === 'lod') {
                if (!scheme.lodMetaUrl) {
                    throw new Error('[walk] Outdoor scheme is missing lodMetaUrl.');
                }
                const metaUrl = scheme.lodMetaUrl;
                const metaBaseUrl = new URL(
                    '.',
                    new URL(metaUrl, typeof location !== 'undefined' ? location.href : 'http://localhost/'),
                ).href;
                await scene.loadLodStream(
                    metaUrl,
                    reloadSignal,
                    createWalkOutdoorLodResourceLoader(this.ctx.indexedDB!, metaBaseUrl, reloadSignal),
                );
                if (generation !== this.reloadGeneration) {
                    scene.dispose();
                    return;
                }
                await scene.appendSplatUrls(scheme.staticSplatUrls ?? [], reloadSignal);
                if (generation !== this.reloadGeneration) {
                    scene.dispose();
                    return;
                }
            } else {
                await scene.loadSplatUrls(scheme.splatCandidates ?? [], reloadSignal);
            }

            if (generation !== this.reloadGeneration) {
                scene.dispose();
                return;
            }

            this.ctx.renderer.render();

            this.walk = new ViewerWalkMode(viewer.canvasContainer);
            const walk = this.walk;
            this.applyThirdPersonCameraToWalk(walk, scheme);
            this.applyViewMode(walk, scene);
            if (this.params.viewMode === 'third') {
                await scene.waitForThirdPersonCharacter(reloadSignal);
            }
            if (generation !== this.reloadGeneration) {
                return;
            }
            const p = options.pose ?? scheme.pose;
            if (!options.pose) {
                walk.startAtPose(new Vector3(p.px, p.py, p.pz), p.yaw, p.pitch);
            }
            if (scheme.splatMode === 'lod') {
                scene.updateCamera(walk.getCameraState());
                scene.tickLod();
                this.ctx.renderer.render();
            }

            await this.tryLoadCollision(walk, scene, scheme, reloadSignal);
            this.manualCollision = scheme.assetBase
                ? await loadManualCollision(scheme.assetBase, reloadSignal)
                : { ...EMPTY_MANUAL_COLLISION, floors: [], walls: [] };
            walk.setManualCollision(this.manualCollision);
            walk.setFreeRoam(this.params.freeRoam);
            if (options.pose) {
                walk.startAtPose(new Vector3(p.px, p.py, p.pz), p.yaw, p.pitch, { snapToGround: false });
                walk.update(0);
                scene.updateCamera(walk.getCameraState());
                this.ctx.renderer.render();
            }

            this.portals = scheme.assetBase ? await loadPortals(scheme.assetBase, reloadSignal) : [];
            this.rebuildPortalList();

            if (generation !== this.reloadGeneration) {
                return;
            }

            // Already disposed at the top of this method.
            this.collisionDebug = new CollisionDebugOverlay(this.ctx.renderer.scene);
            this.collisionDebug.setVisible(this.params.showCollision);
            this.collisionDebug.setPortalsVisible(this.params.showPortals);
            this.collisionDebug.updateManualCollision(this.manualCollision);

            this.ctx.renderer.resize();
            this.running = true;
            this.firstSceneLoad = false;
            this.hideLoadingOnFrame = true;
            throwIfAborted(reloadSignal);
        } catch (error) {
            if (isReloadAbortError(error) || generation !== this.reloadGeneration) {
                return;
            }
            if (scheme.splatMode === 'lod') {
                this.scene?.dispose();
                this.scene = undefined;
                console.error('[walk] Outdoor LOD reload failed:', error);
                return;
            }
            this.ctx.loading.hide();
            throw error;
        }
    }

    /** Load voxel collision data if the scene provides it. */
    private async tryLoadCollision(
        walk: ViewerWalkMode,
        scene: WalkDemoScene,
        scheme: WalkDemoScheme,
        signal: AbortSignal,
    ): Promise<void> {
        // A baked walkable grid provides floor and walls together, so it wins
        // over the voxel pair when present.
        if (scheme.collisionGrid) {
            const res = await fetch(scheme.collisionGrid, { signal });
            if (!res.ok) {
                console.warn(`[walk] Collision grid not OK (${res.status}); walking without collision.`);
                return;
            }
            const text = await res.text();
            throwIfAborted(signal);
            const grid = JSON.parse(text) as CollisionGridData;
            walk.loadCollisionGrid(grid);
            scene.setLevellingRotation(grid.rotation);
            return;
        }

        const jsonUrl = scheme.voxelJson;
        const binUrl = scheme.voxelBin;
        if (jsonUrl && binUrl) {
            const [jsonRes, binRes] = await Promise.all([fetch(jsonUrl, { signal }), fetch(binUrl, { signal })]);
            if (!jsonRes.ok || !binRes.ok) {
                console.warn(
                    `[walk] Voxel pair not OK (json ${jsonRes.status}, bin ${binRes.status}); walking without collision.`,
                );
                return;
            }
            throwIfAborted(signal);
            const metadataText = await jsonRes.text();
            throwIfAborted(signal);
            const metadata = JSON.parse(metadataText) as {
                gridBounds: { min: number[]; max: number[] };
                voxelResolution: number;
                leafSize: number;
                treeDepth: number;
                nodeCount: number;
                leafDataCount: number;
            };
            const binBuffer = await binRes.arrayBuffer();
            throwIfAborted(signal);
            const binBytes = new Uint8Array(binBuffer);
            const allU32 = new Uint32Array(binBytes.buffer, binBytes.byteOffset, Math.floor(binBytes.byteLength / 4));
            const nodeCount = metadata.nodeCount >>> 0;
            const leafDataCount = metadata.leafDataCount >>> 0;
            if (nodeCount + leafDataCount > allU32.length) {
                console.warn('[walk] Voxel binary size mismatch; skipping voxel collision.');
                return;
            }
            const nodes = allU32.slice(0, nodeCount);
            const leafData = allU32.slice(nodeCount, nodeCount + leafDataCount);
            walk.loadVoxelCollision(metadata, nodes, leafData);
            return;
        }

        if (jsonUrl || binUrl) {
            console.warn('[walk] Voxel collision needs both voxelJson and voxelBin; walking without collision.');
            return;
        }

        console.warn('[walk] No voxel collision configured (set voxelJson+voxelBin); walking without collision.');
    }

    /** Stop walk mode and restore the original runtime camera. */
    dispose(): void {
        this.reloadAbort?.abort();
        this.reloadAbort = undefined;
        this.reloadGeneration += 1;
        this.running = false;
        this.collisionDebug?.dispose();
        this.collisionDebug = undefined;
        this.walk?.dispose();
        this.walk = undefined;
        this.scene?.dispose();
        this.scene = undefined;
        this.portalFade?.remove();
        this.portalFade = undefined;
        this.mobileJoystick?.remove();
        this.mobileJoystick = undefined;
        this.ctx.configPanel.clear();
        const cam = this.restoredCamera;
        this.restoredCamera = undefined;
        if (cam) {
            this.ctx.renderer.viewer.setCamera(cam);
        }
    }
}
