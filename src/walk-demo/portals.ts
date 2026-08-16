/**
 * Portals: named points inside a scene, captured while walking it.
 *
 * Linked portals are traversable doorways between scans. The importer completes
 * a forward link with a reciprocal return direction unless an explicit reverse
 * portal already exists; `to` and `spawn` describe the forward destination.
 *
 * Runtime portals are loaded from Neon through the scene graph API. Legacy
 * portals.json files remain importer inputs rather than runtime authority.
 */

import type { RuntimeScenePose } from './scene-catalog';

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
    destination: { id: string; pose: RuntimeScenePose },
    radius = DEFAULT_RADIUS,
): Portal {
    return {
        name,
        position,
        yaw,
        radius,
        toNodeId: destination.id,
        to: null,
        spawn: {
            x: destination.pose.px,
            y: destination.pose.py,
            z: destination.pose.pz,
            yaw: destination.pose.yaw,
            pitch: destination.pose.pitch,
        },
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
