/**
 * Debug overlay: draws the active collider as solid volumes rather than points,
 * so you can see exactly what is blocking you.
 *
 * Both colliders are drawn, because both are live:
 *   floor — one slab across the walkable region
 *   walls — the grid cells that are NOT walkable, extruded to wall height
 *
 * Only cells on the BOUNDARY of the walkable region are drawn. The non-walkable
 * set includes everything outside the room too, which would enclose the camera
 * in a solid pink shell.
 */
import {
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshPhongMaterial,
    Side,
    type Scene3D,
} from '@manycore/aholo-viewer';
import type { GridCollision } from './grid-collision';
import type { Portal } from './portals';

/** Drawn thickness of the floor slab. Purely visual; the collider is a half-space. */
const SLAB = 0.1;
/** How tall to draw wall cells. Shorter than the collider so the view stays open. */
const WALL_DRAW_HEIGHT = 1.6;
/** Half-size of the region drawn around the player, in metres. */
const EXTENT = 9;
/** Rebuild once the player has moved this far from the last centre. */
const REBUILD_DISTANCE = 2;
const PINK = 0xff3ea5;
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

export class CollisionDebugOverlay {
    private readonly scene: Scene3D;
    private mesh: InstanceType<typeof Mesh> | undefined;
    private portalMesh: InstanceType<typeof Mesh> | undefined;
    private portalKey = '';
    private portalsVisible = true;
    private lastCenter: { x: number; z: number } | undefined;
    private visible = false;

    constructor(scene: Scene3D) {
        this.scene = scene;
    }

    /** Rebuild the volumes when the player has moved far enough. */
    update(grid: GridCollision | undefined, x: number, z: number): void {
        if (!this.visible || !grid) {
            return;
        }
        const c = this.lastCenter;
        if (c && Math.hypot(x - c.x, z - c.z) < REBUILD_DISTANCE) {
            return;
        }
        this.lastCenter = { x, z };
        this.rebuild(grid, x, z);
    }

    private rebuild(grid: GridCollision, cx: number, cz: number): void {
        const { nx, nz } = grid.dims;
        const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, v));
        const x0 = clamp(grid.cellX(cx - EXTENT), nx);
        const x1 = clamp(grid.cellX(cx + EXTENT), nx);
        const z0 = clamp(grid.cellZ(cz - EXTENT), nz);
        const z1 = clamp(grid.cellZ(cz + EXTENT), nz);

        const positions: number[] = [];
        const normals: number[] = [];
        const floorY = grid.floorY;
        const wallTop = Math.min(grid.wallTop, floorY + WALL_DRAW_HEIGHT);

        for (let gx = x0; gx <= x1; gx++) {
            for (let gz = z0; gz <= z1; gz++) {
                const b = grid.cellBounds(gx, gz);
                if (grid.isWalkableCell(gx, gz)) {
                    // Floor tile under the walkable cell.
                    pushBox(positions, normals, b.x0, floorY - SLAB, b.z0, b.x1, floorY, b.z1);
                    continue;
                }
                // Wall, but only where it borders somewhere you can stand —
                // otherwise the whole outside of the room turns into solid pink.
                const border =
                    grid.isWalkableCell(gx - 1, gz) ||
                    grid.isWalkableCell(gx + 1, gz) ||
                    grid.isWalkableCell(gx, gz - 1) ||
                    grid.isWalkableCell(gx, gz + 1);
                if (border) {
                    pushBox(positions, normals, b.x0, floorY, b.z0, b.x1, wallTop, b.z1);
                }
            }
        }

        this.mesh?.removeFromParent?.();
        this.mesh?.freeAllGpuResourceOwned?.();
        this.mesh = undefined;
        if (positions.length === 0) {
            return;
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        const mesh = new Mesh(geometry as never, new MeshPhongMaterial({ color: PINK, side: Side.DoubleSide }));
        mesh.visible = this.visible;
        this.scene.add(mesh as never);
        this.mesh = mesh;
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
        if (this.mesh) {
            this.mesh.visible = visible;
        }
        // Portal markers are not touched: they belong to the 'portals' dev flag,
        // not the collision toggle.
        if (!visible) {
            // Force a rebuild next time it is switched on, so it re-centres.
            this.lastCenter = undefined;
        }
    }

    dispose(): void {
        this.mesh?.removeFromParent?.();
        this.mesh?.freeAllGpuResourceOwned?.();
        this.mesh = undefined;
        this.disposePortals();
        this.portalKey = '';
    }
}
