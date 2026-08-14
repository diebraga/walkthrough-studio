import { Hono } from "hono";
import { getDb } from "../db.js";

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
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  spawnYaw: number;
  spawnPitch: number;
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
          spawnX: true,
          spawnY: true,
          spawnZ: true,
          spawnYaw: true,
          spawnPitch: true,
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
        spawn: {
          x: portal.spawnX,
          y: portal.spawnY,
          z: portal.spawnZ,
          yaw: portal.spawnYaw,
          pitch: portal.spawnPitch,
        },
        metadata: portal.metadata,
        toNodeId: portal.toNodeId,
        toNodeSlug: portal.toNode.slug,
        toNodeName: portal.toNode.name,
      })),
    })),
  };
}

export function createScenesRoute(readers: SceneReaders = {
  readAll: readSceneGraph,
  readBySlug: readPlaceSceneGraph,
}): Hono {
  const route = new Hono();
  route.get("/", async (c) => {
    const places = await readers.readAll();
    return c.json({ places: places.map(serializePlace) });
  });
  route.get("/:placeSlug", async (c) => {
    const place = await readers.readBySlug(c.req.param("placeSlug"));
    if (!place) {
      return c.json({ error: "Place not found" }, 404);
    }
    return c.json({ place: serializePlace(place) });
  });
  return route;
}

export const scenes = createScenesRoute();
