import type { CollisionGridData } from "./grid-collision";
import type { ManualCollisionData } from "./manual-collision";
import type { Portal } from "./portals";
import type { RuntimeScenePose, SceneCatalog } from "./scene-catalog";

export interface WalkDemoScheme {
    id: string;
    name: string;
    slug: string;
    source: "database" | "legacy";
    splatMode: "files" | "lod";
    splatCandidates?: readonly string[];
    staticSplatUrls?: readonly string[];
    lodMetaUrl?: string;
    voxelJson?: string;
    voxelBin?: string;
    collisionData?: CollisionGridData;
    manualCollision?: ManualCollisionData;
    portals?: Portal[];
    assetBase?: string;
    pose: RuntimeScenePose;
}

export function createDatabaseSceneSchemes(catalog: SceneCatalog): Record<string, WalkDemoScheme> {
    return Object.fromEntries(catalog.nodes.map((node) => [
        node.id,
        {
            id: node.id,
            name: node.name,
            slug: node.slug,
            source: "database" as const,
            splatMode: "files" as const,
            splatCandidates: [node.splatUrl],
            collisionData: node.collisionData,
            manualCollision: node.manualCollision,
            portals: node.portals.map((portal) => ({
                ...portal,
                to: null,
            })),
            assetBase: node.assetBase,
            pose: node.pose,
        },
    ]));
}
