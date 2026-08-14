/**
 * Portals: named points inside a scene, captured while walking it.
 *
 * Right now they only log when you walk in and out. Later a portal grows a
 * target scene and an arrival pose and becomes a doorway between scans — the
 * `to` and `spawn` fields are already in the file so the shape does not change
 * when that happens.
 *
 * Stored next to the splat as public/<property>/<scene>/portals.json, written by
 * the dev-only Vite endpoint in tools/portal-write-plugin.ts.
 */

export interface Portal {
    /** Persistent database identity when this portal came from Neon. */
    id?: string;
    name: string;
    position: { x: number; y: number; z: number };
    /** Facing at capture time; becomes the arrival direction when linked. */
    yaw: number;
    /** Trigger radius in metres, measured on the ground plane. */
    radius: number;
    /** Immutable destination identity for database-backed portals. */
    toNodeId?: string | null;
    /** Target scene. Null until scenes are linked. */
    to: string | null;
    /** Arrival pose in the target scene. Null until scenes are linked. */
    spawn: { x: number; y: number; z: number; yaw: number; pitch?: number } | null;
}

const DEFAULT_RADIUS = 0.8;

/** Load a scene's portals. A missing file is normal — most scenes have none. */
export async function loadPortals(sceneBase: string, signal?: AbortSignal): Promise<Portal[]> {
    try {
        const res = await fetch(`${sceneBase}portals.json`, { signal });
        if (!res.ok) {
            return [];
        }
        const data = (await res.json()) as { portals?: Portal[] };
        return Array.isArray(data.portals) ? data.portals : [];
    } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
            throw error;
        }
        return [];
    }
}

/**
 * Persist via the dev endpoint. Returns an error string rather than throwing:
 * the caller shows it in the panel, so a failed save is visible instead of
 * silently losing a capture.
 */
export async function savePortals(sceneBase: string, portals: Portal[]): Promise<string | null> {
    // '/23_nashville_dr_tenessee/hall/' -> '23_nashville_dr_tenessee/hall'
    const scenePath = sceneBase.replace(/^\/+/, '').replace(/\/+$/, '');
    try {
        const res = await fetch('/__dev/portals', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scenePath, portals }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        return data.ok ? null : (data.error ?? `HTTP ${res.status}`);
    } catch (error) {
        return String((error as Error)?.message ?? error);
    }
}

/** `portal_1`, `portal_2`, ... skipping names already taken. */
export function nextPortalName(portals: readonly Portal[]): string {
    const taken = new Set(portals.map((p) => p.name));
    for (let i = 1; ; i++) {
        const name = `portal_${i}`;
        if (!taken.has(name)) {
            return name;
        }
    }
}

export function createPortal(
    name: string,
    x: number,
    y: number,
    z: number,
    yaw: number,
    radius = DEFAULT_RADIUS,
): Portal {
    return { name, position: { x, y, z }, yaw, radius, toNodeId: null, to: null, spawn: null };
}

/**
 * Which portal contains this point, by ground distance — height is ignored so a
 * portal still triggers whether you walk or jump through it.
 */
export function portalAt(portals: readonly Portal[], x: number, z: number): Portal | undefined {
    for (const p of portals) {
        if (Math.hypot(x - p.position.x, z - p.position.z) <= p.radius) {
            return p;
        }
    }
    return undefined;
}
