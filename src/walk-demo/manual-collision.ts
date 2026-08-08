export interface ManualFloorCollision {
    x: number;
    z: number;
    width: number;
    depth: number;
}

export interface ManualWallCollision extends ManualFloorCollision {
    yaw: number;
    height?: number;
}

export interface ManualCollisionData {
    floorY: number;
    wallHeight: number;
    floors: ManualFloorCollision[];
    walls: ManualWallCollision[];
}

export const EMPTY_MANUAL_COLLISION: ManualCollisionData = { floorY: 0, wallHeight: 2, floors: [], walls: [] };

export async function loadManualCollision(sceneBase: string, signal?: AbortSignal): Promise<ManualCollisionData> {
    try {
        const res = await fetch(`${sceneBase}manual-collision.json`, { signal });
        if (!res.ok) return { ...EMPTY_MANUAL_COLLISION, floors: [], walls: [] };
        const data = (await res.json()) as Partial<ManualCollisionData>;
        return {
            floorY: typeof data.floorY === 'number' ? data.floorY : 0,
            wallHeight: typeof data.wallHeight === 'number' ? data.wallHeight : 2,
            floors: Array.isArray(data.floors) ? data.floors : [],
            walls: Array.isArray(data.walls) ? data.walls : [],
        };
    } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        return { ...EMPTY_MANUAL_COLLISION, floors: [], walls: [] };
    }
}

export async function saveManualCollision(sceneBase: string, collision: ManualCollisionData): Promise<string | null> {
    const scenePath = sceneBase.replace(/^\/+/, '').replace(/\/+$/, '');
    try {
        const res = await fetch('/__dev/manual-collision', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scenePath, collision }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        return data.ok ? null : (data.error ?? `HTTP ${res.status}`);
    } catch (error) {
        return String((error as Error)?.message ?? error);
    }
}

function localPoint(x: number, z: number, box: { x: number; z: number; yaw?: number }) {
    const yaw = box.yaw ?? 0;
    const dx = x - box.x;
    const dz = z - box.z;
    const c = Math.cos(-yaw);
    const s = Math.sin(-yaw);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function worldVector(x: number, z: number, yaw = 0) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { x: x * c - z * s, z: x * s + z * c };
}

function containsRect(x: number, z: number, box: ManualFloorCollision | ManualWallCollision): boolean {
    const p = localPoint(x, z, box);
    return Math.abs(p.x) <= box.width / 2 && Math.abs(p.z) <= box.depth / 2;
}

function distanceToItem(x: number, z: number, box: ManualFloorCollision | ManualWallCollision): number {
    const p = localPoint(x, z, box);
    const dx = Math.max(Math.abs(p.x) - box.width / 2, 0);
    const dz = Math.max(Math.abs(p.z) - box.depth / 2, 0);
    return Math.hypot(dx, dz);
}

export function eraseManualCollisionAt(data: ManualCollisionData, x: number, z: number, radius = 0.5): ManualCollisionData {
    let best: { kind: 'floors' | 'walls'; index: number; distance: number } | undefined;
    for (const kind of ['walls', 'floors'] as const) {
        data[kind].forEach((item, index) => {
            const distance = distanceToItem(x, z, item);
            if (distance <= radius && (!best || distance < best.distance)) {
                best = { kind, index, distance };
            }
        });
    }
    if (!best) return data;
    const hit = best;
    return {
        ...data,
        floors: hit.kind === 'floors' ? data.floors.filter((_, i) => i !== hit.index) : data.floors,
        walls: hit.kind === 'walls' ? data.walls.filter((_, i) => i !== hit.index) : data.walls,
    };
}

export class ManualCollision {
    readonly floorY: number;
    readonly wallTop: number;

    constructor(readonly data: ManualCollisionData) {
        this.floorY = data.floorY;
        this.wallTop = data.floorY + data.wallHeight;
    }

    queryRay(...args: number[]): { x: number; y: number; z: number } | null {
        const [ox, oy, oz, dx, dy, dz, maxDistance] = args as [number, number, number, number, number, number, number];
        const limit = maxDistance === undefined || maxDistance <= 0 ? Infinity : maxDistance;
        if (dy >= 0 || oy <= this.floorY) return null;
        const t = (this.floorY - oy) / dy;
        if (t < 0 || t > limit) return null;
        const x = ox + dx * t;
        const z = oz + dz * t;
        return this.data.floors.some((floor) => containsRect(x, z, floor)) ? { x, y: this.floorY, z } : null;
    }

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
        if (bottom < this.floorY && this.data.floors.some((floor) => containsRect(cx, cz, floor))) {
            out.y = this.floorY - bottom;
            pushed = true;
        }
        if (cy - halfHeight - radius > this.wallTop) return pushed;

        let bestDepth = 0;
        let best = { x: 0, z: 0 };
        for (const wall of this.data.walls) {
            const p = localPoint(cx, cz, wall);
            const qx = Math.max(-wall.width / 2, Math.min(p.x, wall.width / 2));
            const qz = Math.max(-wall.depth / 2, Math.min(p.z, wall.depth / 2));
            let nx = p.x - qx;
            let nz = p.z - qz;
            let d = Math.hypot(nx, nz);
            if (d >= radius) continue;
            if (d < 1e-6) {
                const left = p.x + wall.width / 2;
                const right = wall.width / 2 - p.x;
                const near = p.z + wall.depth / 2;
                const far = wall.depth / 2 - p.z;
                const m = Math.min(left, right, near, far);
                nx = m === left ? -1 : m === right ? 1 : 0;
                nz = m === near ? -1 : m === far ? 1 : 0;
                d = 0;
            } else {
                nx /= d;
                nz /= d;
            }
            const depth = radius - d;
            if (depth > bestDepth) {
                bestDepth = depth;
                best = worldVector(nx * depth, nz * depth, wall.yaw);
            }
        }
        if (bestDepth > 0) {
            out.x += best.x;
            out.z += best.z;
            pushed = true;
        }
        return pushed;
    }
}

export class CombinedCollision {
    constructor(
        private readonly base: ManualCollision | {
            queryRay: (...args: number[]) => { x: number; y: number; z: number } | null;
            queryCapsule: (
                cx: number,
                cy: number,
                cz: number,
                halfHeight: number,
                radius: number,
                out: { x: number; y: number; z: number },
            ) => boolean;
        } | null,
        private readonly manual: ManualCollision,
    ) {}

    queryRay(...args: number[]): { x: number; y: number; z: number } | null {
        const hitA = this.base?.queryRay(...args) ?? null;
        const hitB = this.manual.queryRay(...args);
        if (!hitA) return hitB;
        if (!hitB) return hitA;
        const [ox, oy, oz] = args;
        const da = Math.hypot(hitA.x - ox, hitA.y - oy, hitA.z - oz);
        const db = Math.hypot(hitB.x - ox, hitB.y - oy, hitB.z - oz);
        return db < da ? hitB : hitA;
    }

    queryCapsule(
        cx: number,
        cy: number,
        cz: number,
        halfHeight: number,
        radius: number,
        out: { x: number; y: number; z: number },
    ): boolean {
        const a = { x: 0, y: 0, z: 0 };
        const b = { x: 0, y: 0, z: 0 };
        const hitA = this.base?.queryCapsule(cx, cy, cz, halfHeight, radius, a) ?? false;
        const hitB = this.manual.queryCapsule(cx + a.x, cy + a.y, cz + a.z, halfHeight, radius, b);
        out.x = a.x + b.x;
        out.y = a.y + b.y;
        out.z = a.z + b.z;
        return hitA || hitB;
    }
}
