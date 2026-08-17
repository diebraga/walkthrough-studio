import { Hono, type Context } from "hono";
import { getDb } from "../db.js";
import { portalAuthoringEnabled } from "./portals.js";

export interface ScenePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface SceneGraphAsset {
  id: string;
  type: string;
  objectKey: string | null;
  originalPath: string;
  mimeType: string;
  sizeBytes: bigint;
  metadata: unknown;
}

interface SceneGraphPortal {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  yaw: number;
  radius: number;
  metadata: unknown;
  toNodeId: string;
  toNode: { slug: string; name: string };
}

interface SceneGraphNode {
  id: string;
  slug: string;
  name: string;
  collisionData: unknown;
  metadata: unknown;
  poseX: number;
  poseY: number;
  poseZ: number;
  poseYaw: number;
  posePitch: number;
  assets: SceneGraphAsset[];
  outgoingPortals: SceneGraphPortal[];
}

export interface SceneGraphPlace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  metadata: unknown;
  sceneNodes: SceneGraphNode[];
}

export interface SceneReaders {
  readAll: () => Promise<SceneGraphPlace[]>;
  readBySlug: (slug: string) => Promise<SceneGraphPlace | null>;
}

const sceneGraphSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  metadata: true,
  sceneNodes: {
    orderBy: { slug: "asc" as const },
    select: {
      id: true,
      slug: true,
      name: true,
      collisionData: true,
      metadata: true,
      poseX: true,
      poseY: true,
      poseZ: true,
      poseYaw: true,
      posePitch: true,
      assets: {
        orderBy: { originalPath: "asc" as const },
        select: {
          id: true,
          type: true,
          objectKey: true,
          originalPath: true,
          mimeType: true,
          sizeBytes: true,
          metadata: true,
        },
      },
      outgoingPortals: {
        orderBy: { sourceKey: "asc" as const },
        select: {
          id: true,
          name: true,
          positionX: true,
          positionY: true,
          positionZ: true,
          yaw: true,
          radius: true,
          metadata: true,
          toNodeId: true,
          toNode: { select: { slug: true, name: true } },
        },
      },
    },
  },
} as const;

export async function readSceneGraph(): Promise<SceneGraphPlace[]> {
  return getDb().place.findMany({
    orderBy: { slug: "asc" },
    select: sceneGraphSelect,
  });
}

export async function readPlaceSceneGraph(slug: string): Promise<SceneGraphPlace | null> {
  return getDb().place.findUnique({ where: { slug }, select: sceneGraphSelect });
}

function serializePlace(place: SceneGraphPlace) {
  return {
    id: place.id,
    slug: place.slug,
    name: place.name,
    description: place.description,
    metadata: place.metadata,
    nodes: place.sceneNodes.map((node) => ({
      id: node.id,
      slug: node.slug,
      name: node.name,
      collisionData: node.collisionData,
      metadata: node.metadata,
      pose: {
        x: node.poseX,
        y: node.poseY,
        z: node.poseZ,
        yaw: node.poseYaw,
        pitch: node.posePitch,
      },
      assets: node.assets.map((asset) => ({
        ...asset,
        sizeBytes: asset.sizeBytes.toString(),
      })),
      portals: node.outgoingPortals.map((portal) => ({
        id: portal.id,
        name: portal.name,
        position: { x: portal.positionX, y: portal.positionY, z: portal.positionZ },
        yaw: portal.yaw,
        radius: portal.radius,
        metadata: portal.metadata,
        toNodeId: portal.toNodeId,
        toNodeSlug: portal.toNode.slug,
        toNodeName: portal.toNode.name,
      })),
    })),
  };
}

// --- Scene pose authoring ---------------------------------------------
//
// One canonical arrival pose per scene, used no matter which portal (or
// direct load) brought the walker there. See docs/database.md.

export interface UpdateNodePoseInput {
  id: string;
  pose: ScenePose;
}

export interface NodePoseRecord {
  id: string;
  pose: ScenePose;
}

export interface SceneMutationStore {
  updatePose(input: UpdateNodePoseInput): Promise<NodePoseRecord>;
}

class SceneRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new SceneRequestError(`${field} must be a UUID`, 400);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SceneRequestError(`${field} must be a finite number`, 400);
  }
  return value;
}

function parsePose(value: unknown): ScenePose {
  if (!isRecord(value)) throw new SceneRequestError("pose must be an object", 400);
  return {
    x: requiredNumber(value.x, "pose.x"),
    y: requiredNumber(value.y, "pose.y"),
    z: requiredNumber(value.z, "pose.z"),
    yaw: requiredNumber(value.yaw, "pose.yaw"),
    pitch: requiredNumber(value.pitch, "pose.pitch"),
  };
}

function parseUpdatePose(value: unknown): UpdateNodePoseInput {
  if (!isRecord(value)) throw new SceneRequestError("request body must be an object", 400);
  return {
    id: requiredUuid(value.id, "id"),
    pose: parsePose(value.pose),
  };
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new SceneRequestError("request body must be valid JSON", 400);
  }
}

export const databaseSceneMutationStore: SceneMutationStore = {
  async updatePose(input) {
    const result = await getDb().sceneNode.updateMany({
      where: { id: input.id },
      data: {
        poseX: input.pose.x,
        poseY: input.pose.y,
        poseZ: input.pose.z,
        poseYaw: input.pose.yaw,
        posePitch: input.pose.pitch,
      },
    });
    if (result.count === 0) throw new SceneRequestError("scene not found", 404);
    return { id: input.id, pose: input.pose };
  },
};

function errorResponse(c: Context, error: unknown) {
  if (error instanceof SceneRequestError) return c.json({ error: error.message }, error.status);
  console.error("[scene] mutation failed", error);
  return c.json({ error: "Scene mutation failed" }, 500);
}

export function createScenesRoute(
  readers: SceneReaders = { readAll: readSceneGraph, readBySlug: readPlaceSceneGraph },
  mutationStore: SceneMutationStore = databaseSceneMutationStore,
  authoringEnabled: () => boolean = portalAuthoringEnabled,
): Hono {
  const route = new Hono();
  route.get("/", async (c) => {
    // Scene metadata changes during authoring, but not on every request. Let
    // the browser/CDN reuse a property graph briefly while still revalidating
    // often enough for portal and spawn edits to become visible.
    c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
    const placeSlug = c.req.query("place");
    if (placeSlug) {
      const place = await readers.readBySlug(placeSlug);
      if (!place) {
        return c.json({ error: "Place not found" }, 404);
      }
      return c.json({ place: serializePlace(place) });
    }
    const places = await readers.readAll();
    return c.json({ places: places.map(serializePlace) });
  });
  route.patch("/", async (c) => {
    if (!authoringEnabled()) return c.json({ error: "Not found" }, 404);
    try {
      const node = await mutationStore.updatePose(parseUpdatePose(await readJson(c)));
      return c.json({ node });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  return route;
}

export const scenes = createScenesRoute();
