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

export function resolvePortalTeleport<T extends string>(
    portal: Portal,
    schemes: Readonly<Record<T, { pose: TeleportPose }>>,
): PortalTeleport<T> | null {
    const destination = portal.toNodeId as T | undefined;
    if (!destination || !(destination in schemes)) {
        return null;
    }
    return {
        scheme: destination,
        pose: schemes[destination].pose,
        skipOpeningTransition: true,
    };
}
