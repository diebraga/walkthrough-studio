/**
 * Collision from a walkable-grid bake (see tools/build-collision.mjs).
 *
 * Two colliders in one, because the scan supports each differently:
 *   floor — a plane at `floorY`. The floor is captured at grazing angles and
 *           barely voxelizes, so it is asserted rather than detected.
 *   walls — every grid cell outside the walkable region, solid from the floor up
 *           to `wallHeight`. These follow the room's true shape (alcoves, the
 *           doorway) because the region came from a flood fill, not a rectangle.
 *
 * The grid is axis-aligned in the LEVELLED frame the bake reports, which is not
 * the frame the stored .ply is in — a raw y-down capture needs ~180 deg. The
 * scene applies `rotation` to the splat layer on load so the two line up, which
 * is what lets the bucket hold the original scan with no pre-processing.
 */

export interface CollisionGridData {
    /**
     * 3x3 rotation that levels the scan (row-major). The grid below is expressed
     * in the resulting frame, so the splat must be rotated by this to match.
     * A raw y-down capture yields roughly 180 degrees here.
     */
    rotation?: number[][];
    cell: number;
    origin: [number, number];
    size: [number, number];
    floorY: number;
    wallHeight: number;
    /** Base64 bitmask, one bit per cell, row-major over (x, z). */
    walkable: string;
}

export class GridCollision {
    private readonly bits: Uint8Array;
    private readonly cell: number;
    private readonly minX: number;
    private readonly minZ: number;
    private readonly nx: number;
    private readonly nz: number;
    readonly floorY: number;
    readonly wallTop: number;

    constructor(data: CollisionGridData) {
        this.cell = data.cell;
        [this.minX, this.minZ] = data.origin;
        [this.nx, this.nz] = data.size;
        this.floorY = data.floorY;
        this.wallTop = data.floorY + data.wallHeight;
        const raw = atob(data.walkable);
        this.bits = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) this.bits[i] = raw.charCodeAt(i);
    }

    /** Cells outside the grid count as solid, so you cannot leave the bake. */
    isWalkableCell(gx: number, gz: number): boolean {
        if (gx < 0 || gz < 0 || gx >= this.nx || gz >= this.nz) return false;
        const i = gz * this.nx + gx;
        return (this.bits[i >> 3]! & (1 << (i & 7))) !== 0;
    }

    isWalkable(x: number, z: number): boolean {
        return this.isWalkableCell(this.cellX(x), this.cellZ(z));
    }

    cellX(x: number): number {
        return Math.floor((x - this.minX) / this.cell);
    }

    cellZ(z: number): number {
        return Math.floor((z - this.minZ) / this.cell);
    }

    /** World-space bounds of a cell, for collision maths and the debug draw. */
    cellBounds(gx: number, gz: number): { x0: number; z0: number; x1: number; z1: number } {
        const x0 = this.minX + gx * this.cell;
        const z0 = this.minZ + gz * this.cell;
        return { x0, z0, x1: x0 + this.cell, z1: z0 + this.cell };
    }

    get dims(): { nx: number; nz: number; cell: number } {
        return { nx: this.nx, nz: this.nz, cell: this.cell };
    }

    /**
     * Centroid of all walkable cells — a "middle of the room" point that is
     * usable for placing a spawn, unlike the raw grid bounding-box center
     * (walkableAreaM2 is often a small fraction of that box, so its center
     * can land in a wall or a void outside the scan).
     *
     * ponytail: centroid, not guaranteed walkable itself in a concave or
     * doughnut-shaped room. Upgrade: snap to the nearest walkable cell if a
     * real floor plan ever needs it.
     */
    walkableCenter(): { x: number; z: number } {
        let sumX = 0;
        let sumZ = 0;
        let count = 0;
        for (let gz = 0; gz < this.nz; gz++) {
            for (let gx = 0; gx < this.nx; gx++) {
                if (!this.isWalkableCell(gx, gz)) continue;
                const bounds = this.cellBounds(gx, gz);
                sumX += (bounds.x0 + bounds.x1) / 2;
                sumZ += (bounds.z0 + bounds.z1) / 2;
                count++;
            }
        }
        return count > 0 ? { x: sumX / count, z: sumZ / count } : { x: this.minX, z: this.minZ };
    }

    /** Nearest hit against the floor plane and the wall cells. */
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
        const limit = maxDistance === undefined || maxDistance <= 0 ? Infinity : maxDistance;
        let bestT = limit;
        let best: { x: number; y: number; z: number } | null = null;

        // Floor: only a downward ray starting above it can hit.
        if (dy < 0 && oy > this.floorY) {
            const t = (this.floorY - oy) / dy;
            if (t >= 0 && t <= bestT) {
                const hx = ox + dx * t;
                const hz = oz + dz * t;
                if (this.isWalkable(hx, hz)) {
                    bestT = t;
                    best = { x: hx, y: this.floorY, z: hz };
                }
            }
        }

        // Walls: 2D DDA across the grid, stopping at the first non-walkable cell
        // whose height band the ray is inside.
        if (dx !== 0 || dz !== 0) {
            let gx = this.cellX(ox);
            let gz = this.cellZ(oz);
            const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
            const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
            const invX = dx !== 0 ? 1 / dx : Infinity;
            const invZ = dz !== 0 ? 1 / dz : Infinity;
            const b = this.cellBounds(gx, gz);
            let tMaxX = dx !== 0 ? ((stepX > 0 ? b.x1 : b.x0) - ox) * invX : Infinity;
            let tMaxZ = dz !== 0 ? ((stepZ > 0 ? b.z1 : b.z0) - oz) * invZ : Infinity;
            const tDeltaX = dx !== 0 ? Math.abs(this.cell * invX) : Infinity;
            const tDeltaZ = dz !== 0 ? Math.abs(this.cell * invZ) : Infinity;

            let t = 0;
            // Bounded so a ray parallel to the grid cannot spin forever.
            for (let guard = 0; guard < 4096 && t <= bestT; guard++) {
                if (!this.isWalkableCell(gx, gz) && t > 0) {
                    const hy = oy + dy * t;
                    if (hy >= this.floorY && hy <= this.wallTop) {
                        bestT = t;
                        best = { x: ox + dx * t, y: hy, z: oz + dz * t };
                        break;
                    }
                }
                if (tMaxX < tMaxZ) {
                    t = tMaxX;
                    gx += stepX;
                    tMaxX += tDeltaX;
                } else {
                    t = tMaxZ;
                    gz += stepZ;
                    tMaxZ += tDeltaZ;
                }
                if (!Number.isFinite(t) || t > limit) break;
            }
        }

        return best;
    }

    /**
     * Depenetration: lift out of the floor, then push out of any wall cell the
     * capsule's disc overlaps. Uses the largest single push rather than the sum,
     * so sliding along a flat wall does not get double-counted per cell.
     */
    queryCapsule(
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ): boolean {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        let pushed = false;

        const bottom = cy - halfHeight - radius;
        if (bottom < this.floorY) {
            out.y = this.floorY - bottom;
            pushed = true;
        }

        // Skip the horizontal pass if the capsule is entirely above the walls.
        if (cy - halfHeight - radius > this.wallTop) return pushed;

        const gx0 = this.cellX(cx - radius);
        const gx1 = this.cellX(cx + radius);
        const gz0 = this.cellZ(cz - radius);
        const gz1 = this.cellZ(cz + radius);
        let bestLen = 0;
        let bestX = 0;
        let bestZ = 0;
        for (let gx = gx0; gx <= gx1; gx++) {
            for (let gz = gz0; gz <= gz1; gz++) {
                if (this.isWalkableCell(gx, gz)) continue;
                const b = this.cellBounds(gx, gz);
                // Closest point on the cell to the capsule axis.
                const qx = Math.max(b.x0, Math.min(cx, b.x1));
                const qz = Math.max(b.z0, Math.min(cz, b.z1));
                let nx = cx - qx;
                let nz = cz - qz;
                let d = Math.hypot(nx, nz);
                if (d >= radius) continue;
                if (d < 1e-6) {
                    // Centre is inside the cell: escape along the shallowest face.
                    const left = cx - b.x0;
                    const right = b.x1 - cx;
                    const near = cz - b.z0;
                    const far = b.z1 - cz;
                    const m = Math.min(left, right, near, far);
                    nx = m === left ? -1 : m === right ? 1 : 0;
                    nz = m === near ? -1 : m === far ? 1 : 0;
                    d = 0;
                } else {
                    nx /= d;
                    nz /= d;
                }
                const depth = radius - d;
                if (depth > bestLen) {
                    bestLen = depth;
                    bestX = nx * depth;
                    bestZ = nz * depth;
                }
            }
        }
        if (bestLen > 0) {
            out.x += bestX;
            out.z += bestZ;
            pushed = true;
        }
        return pushed;
    }
}
