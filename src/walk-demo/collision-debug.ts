/**
 * Debug overlay: draws the active collider as a solid volume so you can see
 * where it actually is, and how it sits relative to the splat's floor.
 *
 * Only the synthetic floor plane is drawn, because it is the only collider in
 * use — the scan's voxel field is disabled (see walk-demo.ts loadVoxelCollision).
 */
import {
    BufferAttribute,
    BufferGeometry,
    Mesh,
    MeshPhongMaterial,
    Side,
    type Scene3D,
} from '@manycore/aholo-viewer';
import type { FloorPlaneOptions } from './floor-plane';

/** Drawn thickness of the floor slab. Purely visual; the collider is a half-space. */
const SLAB_THICKNESS = 0.12;

/** Two triangles per face, 6 faces, with outward normals. */
function boxGeometry(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
): InstanceType<typeof BufferGeometry> {
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
        [[4, 5, 6, 7], [0, 0, 1]], // +Z
        [[1, 0, 3, 2], [0, 0, -1]], // -Z
        [[3, 2, 6, 7], [0, 1, 0]], // +Y (top — the walkable surface)
        [[0, 1, 5, 4], [0, -1, 0]], // -Y
        [[1, 5, 6, 2], [1, 0, 0]], // +X
        [[4, 0, 3, 7], [-1, 0, 0]], // -X
    ];

    const positions: number[] = [];
    const normals: number[] = [];
    for (const [quad, n] of faces) {
        const [a, b, c, d] = quad as [number, number, number, number];
        for (const i of [a, b, c, a, c, d]) {
            positions.push(v[i]![0]!, v[i]![1]!, v[i]![2]!);
            normals.push(n[0]!, n[1]!, n[2]!);
        }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    return geometry;
}

export class CollisionDebugOverlay {
    private readonly scene: Scene3D;
    private mesh: InstanceType<typeof Mesh> | undefined;
    private visible = false;

    constructor(scene: Scene3D, floor: FloorPlaneOptions | null) {
        this.scene = scene;
        if (floor) {
            this.build(floor);
        }
    }

    private build(floor: FloorPlaneOptions): void {
        const geometry = boxGeometry(
            floor.minX,
            floor.y - SLAB_THICKNESS,
            floor.minZ,
            floor.maxX,
            floor.y,
            floor.maxZ,
        );
        const material = new MeshPhongMaterial({ color: 0x00ff66, side: Side.DoubleSide });
        this.mesh = new Mesh(geometry as never, material);
        this.mesh.visible = this.visible;
        this.scene.add(this.mesh as never);
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.mesh) {
            this.mesh.visible = visible;
        }
    }

    dispose(): void {
        if (!this.mesh) {
            return;
        }
        this.mesh.removeFromParent?.();
        this.mesh.freeAllGpuResourceOwned?.();
        this.mesh = undefined;
    }
}
