/**
 * Synthetic collision floor.
 *
 * The hall-3 scan's floor is captured at grazing angles, so it reconstructs as
 * a few large low-opacity gaussians that mostly fail the voxelizer's opacity
 * test. The result is a voxel field with walls and furniture but large holes
 * where the floor should be, and the walker drops through them.
 *
 * Rather than fight the capture, this asserts the floor: a solid half-space
 * below `y`, bounded to the room's interior footprint so it does not extend
 * through the walls. It wraps the voxel field rather than replacing it, so
 * walls and furniture still collide normally — a point is solid if EITHER
 * source says it is.
 *
 * Single level only. Stairs or a sunken area would need a plane per region.
 */

/** The subset of VoxelCollision that ViewerWalkMode actually calls. */
export interface CollisionSource {
    queryRay: (...args: number[]) => { x: number; y: number; z: number } | null;
    queryCapsule: (
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ) => boolean;
}

export interface FloorPlaneOptions {
    /** Floor height in world units. */
    y: number;
    /** Interior footprint; the plane is solid only inside this rectangle. */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export class FloorPlaneCollision implements CollisionSource {
    constructor(
        private readonly voxels: CollisionSource | undefined,
        private readonly floor: FloorPlaneOptions,
    ) {}

    private insideFootprint(x: number, z: number): boolean {
        const f = this.floor;
        return x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ;
    }

    /**
     * Nearest hit along the ray, taking whichever of the voxel field or the
     * floor plane is closer to the origin.
     */
    queryRay(...args: number[]): { x: number; y: number; z: number } | null {
        const [ox, oy, oz, dx, dy, dz, maxDistance] = args as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
        ];
        const voxelHit = this.voxels?.queryRay(...args) ?? null;

        let planeHit: { x: number; y: number; z: number } | null = null;
        // Only a downward ray starting above the plane can hit it.
        if (dy < 0 && oy > this.floor.y) {
            const t = (this.floor.y - oy) / dy;
            if (t >= 0 && (maxDistance === undefined || t <= maxDistance)) {
                const hx = ox + dx * t;
                const hz = oz + dz * t;
                if (this.insideFootprint(hx, hz)) {
                    planeHit = { x: hx, y: this.floor.y, z: hz };
                }
            }
        }

        if (!voxelHit) return planeHit;
        if (!planeHit) return voxelHit;
        const dv = (voxelHit.x - ox) ** 2 + (voxelHit.y - oy) ** 2 + (voxelHit.z - oz) ** 2;
        const dp = (planeHit.x - ox) ** 2 + (planeHit.y - oy) ** 2 + (planeHit.z - oz) ** 2;
        return dv <= dp ? voxelHit : planeHit;
    }

    /**
     * Depenetration. The voxel field is resolved first, then the plane pushes
     * the capsule up if its bottom is still below the floor — applied last so
     * the walker always ends up standing on the floor rather than inside it.
     */
    queryCapsule(
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ): boolean {
        const hitVoxels = this.voxels?.queryCapsule(cx, cy, cz, halfHeight, radius, out) ?? false;
        if (!hitVoxels) {
            out.x = 0;
            out.y = 0;
            out.z = 0;
        }

        // Capsule position after the voxel push-out.
        const py = cy + out.y;
        const bottom = py - halfHeight - radius;
        if (!this.insideFootprint(cx + out.x, cz + out.z) || bottom >= this.floor.y) {
            return hitVoxels;
        }
        out.y += this.floor.y - bottom;
        return true;
    }
}
