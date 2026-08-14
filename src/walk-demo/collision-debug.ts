/**
 * Debug overlay: draws the manual collision (floors/walls placed via the dev
 * panel) as solid volumes, so you can see exactly what is blocking you. The
 * baked scene collision is no longer drawn — free roam ignores it, so a pink
 * overlay for it would be misleading about what actually blocks movement.
 */
import {
    Blending,
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshBasicMaterial,
    MeshPhongMaterial,
    Side,
    Vector3,
    type Scene3D,
} from '@manycore/aholo-viewer';
import type { ManualCollisionData, ManualFloorCollision, ManualWallCollision } from './manual-collision';
import type { Portal } from './portals';

/** Drawn thickness of the floor slab. Purely visual; the collider is a half-space. */
const SLAB = 0.1;
/** Portals get their own colours so they read as separate from the collider. */
const PORTAL = 0x33bbff;
const PORTAL_ACTIVE = 0xffd400;
/** Height of a portal's light beam. */
const PORTAL_BEAM_HEIGHT = 1.4;
const PORTAL_BEAM_WIDTH = 0.14;
/** Radians/second the beam's crossed quads spin at — reads as a subtle shimmer. */
const PORTAL_SPIN_SPEED = 0.6;

function hexToRgb(hex: number): [number, number, number] {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * Build one portal's marker in local space (glow disc on the ground + a
 * crossed-quad light beam), vertex-coloured from the portal's colour at the
 * base fading to black at the rim/top. No alpha channel is needed: combined
 * with additive blending, black is invisible and colour reads as glow.
 */
function pushPortalGlow(positions: number[], colors: number[], radius: number, colorHex: number): void {
    const [r, g, b] = hexToRgb(colorHex);
    const segments = 24;
    const discRadius = radius * 1.2;
    const y = 0.015;
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        positions.push(0, y, 0);
        colors.push(r, g, b);
        positions.push(Math.cos(a0) * discRadius, y, Math.sin(a0) * discRadius);
        colors.push(0, 0, 0);
        positions.push(Math.cos(a1) * discRadius, y, Math.sin(a1) * discRadius);
        colors.push(0, 0, 0);
    }
    const hw = PORTAL_BEAM_WIDTH / 2;
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const dx = Math.cos(a) * hw;
        const dz = Math.sin(a) * hw;
        const corners: [number, number, number][] = [
            [-dx, 0, -dz],
            [dx, 0, dz],
            [dx, PORTAL_BEAM_HEIGHT, dz],
            [-dx, PORTAL_BEAM_HEIGHT, -dz],
        ];
        const cols: [number, number, number][] = [
            [r, g, b],
            [r, g, b],
            [0, 0, 0],
            [0, 0, 0],
        ];
        for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push(...corners[idx]!);
            colors.push(...cols[idx]!);
        }
    }
}

function pushManualBox(
    positions: number[],
    normals: number[],
    box: ManualFloorCollision | ManualWallCollision,
    minY: number,
    maxY: number,
): void {
    const yaw = 'yaw' in box ? box.yaw : 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = box.width / 2;
    const hz = box.depth / 2;
    const corner = (x: number, y: number, z: number) => [box.x + x * c - z * s, y, box.z + x * s + z * c];
    const v = [
        corner(-hx, minY, -hz),
        corner(hx, minY, -hz),
        corner(hx, maxY, -hz),
        corner(-hx, maxY, -hz),
        corner(-hx, minY, hz),
        corner(hx, minY, hz),
        corner(hx, maxY, hz),
        corner(-hx, maxY, hz),
    ];
    const faces = [
        [4, 5, 6, 7],
        [1, 0, 3, 2],
        [3, 2, 6, 7],
        [0, 1, 5, 4],
        [1, 5, 6, 2],
        [4, 0, 3, 7],
    ] as const;
    for (const quad of faces) {
        const [a, b, c2, d] = quad;
        for (const i of [a, b, c2, a, c2, d]) {
            positions.push(v[i]![0]!, v[i]![1]!, v[i]![2]!);
            normals.push(0, 1, 0);
        }
    }
}

export class CollisionDebugOverlay {
    private readonly scene: Scene3D;
    private manualMesh: InstanceType<typeof Mesh> | undefined;
    private portalMeshes: InstanceType<typeof Mesh>[] = [];
    private portalSpin = 0;
    private portalKey = '';
    private portalsVisible = true;
    private visible = false;

    constructor(scene: Scene3D) {
        this.scene = scene;
    }

    /**
     * Draw a marker per portal: a glowing disc on the ground plus a crossed-quad
     * light beam, so the trigger area is visible without hiding the scene. The
     * one you are standing in turns yellow, which is faster to read than the
     * console.
     */
    setPortalsVisible(visible: boolean): void {
        this.portalsVisible = visible;
        for (const m of this.portalMeshes) {
            m.visible = visible;
        }
    }

    updatePortals(portals: readonly Portal[], activeName: string | undefined, floorY: number): void {
        const key = `${activeName ?? ''}|${portals.map((p) => `${p.name}:${p.position.x.toFixed(2)}:${p.position.z.toFixed(2)}:${p.radius}`).join('|')}`;
        if (key === this.portalKey) {
            return;
        }
        this.portalKey = key;
        this.disposePortals();
        for (const portal of portals) {
            const active = portal.name === activeName;
            const positions: number[] = [];
            const colors: number[] = [];
            pushPortalGlow(positions, colors, portal.radius, active ? PORTAL_ACTIVE : PORTAL);
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
            geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
            const material = new MeshBasicMaterial({
                enableVertexColor: true,
                transparent: true,
                blending: Blending.AdditiveBlending,
                depthWrite: false,
                side: Side.DoubleSide,
            });
            const mesh = new Mesh(geometry as never, material as never);
            mesh.position = new Vector3(portal.position.x, floorY, portal.position.z);
            mesh.visible = this.portalsVisible;
            this.scene.add(mesh as never);
            this.portalMeshes.push(mesh);
        }
    }

    /** Spin the beams' crossed quads a little every frame — purely cosmetic. */
    tick(dt: number): void {
        if (!this.portalMeshes.length) {
            return;
        }
        this.portalSpin += dt * PORTAL_SPIN_SPEED;
        for (const m of this.portalMeshes) {
            m.rotation.y = this.portalSpin;
        }
    }

    updateManualCollision(data: ManualCollisionData): void {
        this.manualMesh?.removeFromParent?.();
        this.manualMesh?.freeAllGpuResourceOwned?.();
        this.manualMesh = undefined;
        const positions: number[] = [];
        const normals: number[] = [];
        for (const floor of data.floors) {
            pushManualBox(positions, normals, floor, data.floorY - SLAB, data.floorY);
        }
        for (const wall of data.walls) {
            pushManualBox(positions, normals, wall, data.floorY, data.floorY + (wall.height ?? data.wallHeight));
        }
        if (!positions.length) return;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        const mesh = new Mesh(geometry as never, new MeshPhongMaterial({ color: 0x33ff99, side: Side.DoubleSide }));
        mesh.visible = this.visible;
        this.scene.add(mesh as never);
        this.manualMesh = mesh;
    }

    private disposePortals(): void {
        for (const m of this.portalMeshes) {
            m.removeFromParent?.();
            m.freeAllGpuResourceOwned?.();
        }
        this.portalMeshes = [];
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.manualMesh) {
            this.manualMesh.visible = visible;
        }
        // Portal markers are not touched: they belong to the 'portals' dev flag,
        // not the collision toggle.
    }

    dispose(): void {
        this.manualMesh?.removeFromParent?.();
        this.manualMesh?.freeAllGpuResourceOwned?.();
        this.manualMesh = undefined;
        this.disposePortals();
        this.portalKey = '';
    }
}
