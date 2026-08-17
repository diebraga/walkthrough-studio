/**
 * Portals: named points inside a scene, captured while walking it.
 *
 * Linked portals are directional traversable doorways between scans. Runtime
 * authoring creates one direction at a time; `toNodeId` names the
 * destination. Arrival pose is the destination scene's own canonical pose
 * (see `RuntimeSceneNode.pose`), not something a portal carries.
 *
 * Runtime portals are loaded from Neon through the scene graph API. Legacy
 * portals.json files remain importer inputs rather than runtime authority.
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
}

export const DEFAULT_RADIUS = 0.8;

/**
 * Push a captured position forward along facing `yaw` so a newly authored
 * portal doesn't enclose the player who just placed it — otherwise the very
 * next trigger check finds them already standing inside it and teleports
 * them immediately. `distance` should clear the portal's own radius plus the
 * player's body.
 */
export function offsetForward(
    position: { x: number; y: number; z: number },
    yaw: number,
    distance: number,
): { x: number; y: number; z: number } {
    return {
        x: position.x - Math.sin(yaw) * distance,
        y: position.y,
        z: position.z - Math.cos(yaw) * distance,
    };
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
    position: { x: number; y: number; z: number },
    yaw: number,
    toNodeId: string,
    radius = DEFAULT_RADIUS,
): Portal {
    return {
        name,
        position,
        yaw,
        radius,
        toNodeId,
        to: null,
    };
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
