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

/** Drawn thickness of the floor slab. Purely visual; the collider is a half-space. */
const SLAB = 0.1;
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
    private visible = false;

    constructor(scene: Scene3D) {
        this.scene = scene;
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

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.manualMesh) {
            this.manualMesh.visible = visible;
        }
    }

    dispose(): void {
        this.manualMesh?.removeFromParent?.();
        this.manualMesh?.freeAllGpuResourceOwned?.();
        this.manualMesh = undefined;
    }
}
