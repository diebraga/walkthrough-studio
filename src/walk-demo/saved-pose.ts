/**
 * Remembers where you were in each scene, so reloading the page lands you
 * back instead of at the scene's authored spawn point. Keyed by scheme id;
 * one entry per scene.
 */
import type { TeleportPose } from './teleport';

const STORAGE_KEY = 'walkthrough-studio:last-pose';

function readAll(): Record<string, TeleportPose> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, TeleportPose>) : {};
    } catch {
        return {};
    }
}

export function loadLastPose(scheme: string): TeleportPose | null {
    return readAll()[scheme] ?? null;
}

export function saveLastPose(scheme: string, pose: TeleportPose): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [scheme]: pose }));
    } catch {
        // Private browsing and similar; the pose just won't survive reload.
    }
}
