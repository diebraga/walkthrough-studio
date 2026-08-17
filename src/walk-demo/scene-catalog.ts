import { EMPTY_MANUAL_COLLISION, type ManualCollisionData } from "./manual-collision";
import type { CollisionGridData } from "./grid-collision";

export interface SceneAssetDto {
    id: string;
    type: string;
    objectKey: string | null;
    originalPath: string;
    mimeType: string;
    sizeBytes: string;
    metadata: unknown;
}

interface ScenePortalDto {
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    yaw: number;
    radius: number;
    metadata: unknown;
    toNodeId: string;
    toNodeSlug: string;
    toNodeName: string;
}

interface ScenePoseDto {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
}

interface SceneNodeDto {
    id: string;
    slug: string;
    name: string;
    collisionData: unknown;
    metadata: unknown;
    pose: ScenePoseDto;
    assets: SceneAssetDto[];
    portals: ScenePortalDto[];
}

interface ScenePlaceDto {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    metadata: unknown;
    nodes: SceneNodeDto[];
}

export interface SceneGraphResponse {
    place: ScenePlaceDto;
}

export interface RuntimeScenePose {
    px: number;
    py: number;
    pz: number;
    yaw: number;
    pitch: number;
    thirdPersonDistance?: number;
}

export interface RuntimeScenePortal {
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    yaw: number;
    radius: number;
    toNodeId: string;
}

export interface RuntimeSceneNode {
    id: string;
    slug: string;
    name: string;
    splatUrl: string;
    collisionData: CollisionGridData;
    manualCollision: ManualCollisionData;
    portals: RuntimeScenePortal[];
    assetBase: string;
    pose: RuntimeScenePose;
}

export interface SceneCatalog {
    place: Pick<ScenePlaceDto, "id" | "slug" | "name" | "description">;
    initialNodeId: string;
    nodes: RuntimeSceneNode[];
    nodeById: Map<string, RuntimeSceneNode>;
    nodeBySlug: Map<string, RuntimeSceneNode>;
}

// Cosmetic default for the third-person camera; not part of the authored
// pose (which only covers where the walker lands, not the camera rig).
const DEFAULT_THIRD_PERSON_DISTANCE = 3.4;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCollisionGridData(value: unknown): value is CollisionGridData {
    if (!isRecord(value)) return false;
    return typeof value.cell === "number"
        && Array.isArray(value.origin) && value.origin.length === 2 && value.origin.every((item) => typeof item === "number")
        && Array.isArray(value.size) && value.size.length === 2 && value.size.every((item) => typeof item === "number")
        && typeof value.floorY === "number"
        && typeof value.wallHeight === "number"
        && typeof value.walkable === "string"
        && (value.rotation === undefined || Array.isArray(value.rotation));
}

function staticPath(originalPath: string): string {
    const withoutPublic = originalPath.replace(/^public\//, "").replace(/^\/+/, "");
    return `/${withoutPublic}`;
}

export function resolveSceneAssetUrl(asset: Pick<SceneAssetDto, "objectKey" | "originalPath">, splatBaseUrl = ""): string {
    if (asset.objectKey && /^https?:\/\//i.test(asset.objectKey)) {
        return asset.objectKey;
    }
    const path = staticPath(asset.objectKey || asset.originalPath);
    if (!splatBaseUrl) {
        return path;
    }
    const base = splatBaseUrl.endsWith("/") ? splatBaseUrl : `${splatBaseUrl}/`;
    return new URL(path.replace(/^\/+/, ""), base).href;
}

function assetBase(originalPath: string): string {
    const path = staticPath(originalPath);
    return path.slice(0, path.lastIndexOf("/") + 1);
}

function manualCollisionFrom(asset: SceneAssetDto | undefined): ManualCollisionData {
    const data = asset?.metadata;
    if (!isRecord(data)) {
        return { ...EMPTY_MANUAL_COLLISION, floors: [], walls: [] };
    }
    return {
        floorY: typeof data.floorY === "number" ? data.floorY : 0,
        wallHeight: typeof data.wallHeight === "number" ? data.wallHeight : 2,
        floors: Array.isArray(data.floors) ? data.floors as ManualCollisionData["floors"] : [],
        walls: Array.isArray(data.walls) ? data.walls as ManualCollisionData["walls"] : [],
    };
}

export function adaptSceneCatalog(
    response: SceneGraphResponse,
    options: { splatBaseUrl?: string } = {},
): SceneCatalog {
    if (!response?.place || !Array.isArray(response.place.nodes)) {
        throw new Error("Scene metadata response is invalid.");
    }
    const place = response.place;
    if (place.nodes.length === 0) {
        throw new Error(`Place '${place.slug}' has no scene nodes.`);
    }

    const nodeIds = new Set(place.nodes.map((node) => node.id));
    const nodes = place.nodes.map((node): RuntimeSceneNode => {
        const splat = node.assets.find((asset) => asset.type === "GAUSSIAN_SPLAT");
        if (!splat) {
            throw new Error(`Scene node '${node.slug}' has no Gaussian splat asset.`);
        }
        if (!isCollisionGridData(node.collisionData)) {
            throw new Error(`Scene node '${node.slug}' has invalid collision data.`);
        }
        const portals = node.portals.map((portal): RuntimeScenePortal => {
            if (!nodeIds.has(portal.toNodeId)) {
                throw new Error(`Portal '${portal.name}' targets missing node '${portal.toNodeId}'.`);
            }
            return {
                id: portal.id,
                name: portal.name,
                position: portal.position,
                yaw: portal.yaw,
                radius: portal.radius,
                toNodeId: portal.toNodeId,
            };
        });
        return {
            id: node.id,
            slug: node.slug,
            name: node.name,
            splatUrl: resolveSceneAssetUrl(splat, options.splatBaseUrl),
            collisionData: node.collisionData,
            manualCollision: manualCollisionFrom(node.assets.find((asset) => asset.type === "MANUAL_COLLISION")),
            portals,
            assetBase: assetBase(splat.originalPath),
            pose: {
                px: node.pose.x,
                py: node.pose.y,
                pz: node.pose.z,
                yaw: node.pose.yaw,
                pitch: node.pose.pitch,
                thirdPersonDistance: DEFAULT_THIRD_PERSON_DISTANCE,
            },
        };
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeBySlug = new Map(nodes.map((node) => [node.slug, node]));
    return {
        place: {
            id: place.id,
            slug: place.slug,
            name: place.name,
            description: place.description,
        },
        initialNodeId: nodeBySlug.get("hall")?.id ?? nodes[0].id,
        nodes,
        nodeById,
        nodeBySlug,
    };
}

interface FetchSceneCatalogOptions {
    fetcher?: typeof fetch;
    splatBaseUrl?: string;
    signal?: AbortSignal;
}

export async function fetchSceneCatalog(placeSlug: string, options: FetchSceneCatalogOptions = {}): Promise<SceneCatalog> {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(`/api/scenes?place=${encodeURIComponent(placeSlug)}`, { signal: options.signal });
    if (!response.ok) {
        let detail = response.statusText || "Request failed";
        try {
            const body = await response.json() as { error?: string };
            detail = body.error ?? detail;
        } catch {
            // Keep the HTTP status text when an intermediary returns a non-JSON body.
        }
        throw new Error(`Scene metadata request failed (${response.status}): ${detail}`);
    }
    return adaptSceneCatalog(await response.json() as SceneGraphResponse, {
        splatBaseUrl: options.splatBaseUrl,
    });
}
