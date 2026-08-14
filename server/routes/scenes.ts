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

interface SceneGraphPlace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  metadata: unknown;
  sceneNodes: SceneGraphNode[];
}

export type SceneReader = () => Promise<SceneGraphPlace[]>;

export async function readSceneGraph(): Promise<SceneGraphPlace[]> {
  return getDb().place.findMany({
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      metadata: true,
      sceneNodes: {
        orderBy: { slug: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          collisionData: true,
          metadata: true,
          assets: {
            orderBy: { originalPath: "asc" },
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
            orderBy: { sourceKey: "asc" },
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
    },
  });
}

export function createScenesRoute(reader: SceneReader = readSceneGraph): Hono {
  const route = new Hono();
  route.get("/", async (c) => {
    const places = await reader();
    return c.json({
      places: places.map((place) => ({
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
      })),
    });
  });
  return route;
}

export const scenes = createScenesRoute();
