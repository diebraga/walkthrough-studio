/**
 * Debug overlay: draws the manual collision (floors/walls placed via the dev
 * panel) as solid volumes, so you can see exactly what is blocking you. The
 * baked scene collision is no longer drawn — free roam ignores it, so a pink
 * overlay for it would be misleading about what actually blocks movement.
 */
import {
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshPhongMaterial,
    Side,
    type Scene3D,
} from '@manycore/aholo-viewer';
import type { ManualCollisionData, ManualFloorCollision, ManualWallCollision } from './manual-collision';
import type { Portal } from './portals';

/** Drawn thickness of the floor slab. Purely visual; the collider is a half-space. */
const SLAB = 0.1;
/** Portals get their own colours so they read as separate from the collider. */
const PORTAL = 0x33bbff;
const PORTAL_ACTIVE = 0xffd400;
/** Drawn height of a portal marker. */
const PORTAL_HEIGHT = 1.8;

/** Append one axis-aligned box (12 triangles, outward normals) to the buffers. */
function pushBox(
    positions: number[],
    normals: number[],
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
): void {
    const v = [
        [minX, minY, minZ],
        [maxX, minY, minZ],
        [maxX, maxY, minZ],
        [minX, maxY, minZ],
        [minX, minY, maxZ],
        [maxX, minY, maxZ],
        [maxX, maxY, maxZ],
        [minX, maxY, maxZ],
    ];
    const faces: [number[], number[]][] = [
        [[4, 5, 6, 7], [0, 0, 1]],
        [[1, 0, 3, 2], [0, 0, -1]],
        [[3, 2, 6, 7], [0, 1, 0]],
        [[0, 1, 5, 4], [0, -1, 0]],
        [[1, 5, 6, 2], [1, 0, 0]],
        [[4, 0, 3, 7], [-1, 0, 0]],
    ];
    for (const [quad, n] of faces) {
        const [a, b, c, d] = quad as [number, number, number, number];
        for (const i of [a, b, c, a, c, d]) {
            positions.push(v[i]![0]!, v[i]![1]!, v[i]![2]!);
            normals.push(n[0]!, n[1]!, n[2]!);
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
    private portalMesh: InstanceType<typeof Mesh> | undefined;
    private portalKey = '';
    private portalsVisible = true;
    private visible = false;

    constructor(scene: Scene3D) {
        this.scene = scene;
    }

    /**
     * Draw a marker per portal: a low ring of blocks around its radius, so the
     * trigger area is visible on the floor without hiding the scene. The one you
     * are standing in turns yellow, which is faster to read than the console.
     */
    setPortalsVisible(visible: boolean): void {
        this.portalsVisible = visible;
        for (const m of [this.portalMesh, this.portalExtra]) {
            if (m) m.visible = visible;
        }
    }

    updatePortals(portals: readonly Portal[], activeName: string | undefined, floorY: number): void {
        const key = `${activeName ?? ''}|${portals.map((p) => `${p.name}:${p.position.x.toFixed(2)}:${p.position.z.toFixed(2)}:${p.radius}`).join('|')}`;
        if (key === this.portalKey) {
            return;
        }
        this.portalKey = key;
        this.disposePortals();
        if (!portals.length) {
            return;
        }

        const positions: number[] = [];
        const normals: number[] = [];
        const activePositions: number[] = [];
        const activeNormals: number[] = [];
        for (const portal of portals) {
            const target = portal.name === activeName ? activePositions : positions;
            const targetN = portal.name === activeName ? activeNormals : normals;
            const segments = 16;
            const post = 0.06;
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const px = portal.position.x + Math.cos(a) * portal.radius;
                const pz = portal.position.z + Math.sin(a) * portal.radius;
                pushBox(target, targetN, px - post, floorY, pz - post, px + post, floorY + PORTAL_HEIGHT * 0.25, pz + post);
            }
            // Centre pole, so a portal is findable from across the room.
            pushBox(
                target,
                targetN,
                portal.position.x - post,
                floorY,
                portal.position.z - post,
                portal.position.x + post,
                floorY + PORTAL_HEIGHT,
                portal.position.z + post,
            );
        }

        const build = (pos: number[], nrm: number[], colour: number) => {
            if (!pos.length) return undefined;
            const g = new BufferGeometry();
            g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
            g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
            const m = new Mesh(g as never, new MeshPhongMaterial({ color: colour, side: Side.DoubleSide }));
            m.visible = this.portalsVisible;
            this.scene.add(m as never);
            return m;
        };
        // Merge both colours into one mesh slot by drawing inactive first; the
        // active one is a separate mesh so it can use its own material.
        this.portalMesh = build(positions, normals, PORTAL);
        const activeMesh = build(activePositions, activeNormals, PORTAL_ACTIVE);
        if (activeMesh) {
            if (this.portalMesh) {
                // Keep a single handle: parent the active mesh under the scene and
                // track it for disposal via the same key-based rebuild.
                this.portalExtra = activeMesh;
            } else {
                this.portalMesh = activeMesh;
            }
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

    private portalExtra: InstanceType<typeof Mesh> | undefined;

    private disposePortals(): void {
        for (const m of [this.portalMesh, this.portalExtra]) {
            m?.removeFromParent?.();
            m?.freeAllGpuResourceOwned?.();
        }
        this.portalMesh = undefined;
        this.portalExtra = undefined;
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
