import type { Portal } from "./portals";

export interface TeleportPose {
    px: number;
    py: number;
    pz: number;
    yaw: number;
    pitch: number;
}

export interface PortalTeleport<T extends string = string> {
    scheme: T;
    pose: TeleportPose;
    skipOpeningTransition: true;
}

export function resolvePortalTeleport<T extends string>(portal: Portal, schemes: ReadonlySet<T>): PortalTeleport<T> | null {
    if (!portal.toNodeId || !portal.spawn || !schemes.has(portal.toNodeId as T)) {
        return null;
    }
    return {
        scheme: portal.toNodeId as T,
        pose: {
            px: portal.spawn.x,
            py: portal.spawn.y,
            pz: portal.spawn.z,
            yaw: portal.spawn.yaw,
            pitch: portal.spawn.pitch ?? 0,
        },
        skipOpeningTransition: true,
    };
}
