import type { DatabaseClient } from "../../server/db.js";
import { Prisma } from "@prisma/client";
import type { JsonValue, PortalImport, SceneImportPlan } from "./discover.js";

export interface ImportSummary {
  places: number;
  nodes: number;
  assets: number;
  portals: number;
}

export async function persistSceneImport(
  database: DatabaseClient,
  plan: SceneImportPlan,
): Promise<ImportSummary> {
  validatePortalDestinations(plan);
  const summary = summarize(plan);

  // Legacy portals.json still carries one spawn per portal; a scene's
  // canonical pose is the first one found among the portals that land there.
  const nodePoses = new Map<string, PortalImport["spawn"]>();
  for (const place of plan.places) {
    for (const node of place.nodes) {
      for (const portal of node.portals) {
        const key = nodeKey(place.slug, portal.toNodeSlug);
        if (!nodePoses.has(key)) nodePoses.set(key, portal.spawn);
      }
    }
  }

  await database.$transaction(async (tx) => {
    const nodeIds = new Map<string, string>();

    for (const place of plan.places) {
      const placeRecord = await tx.place.upsert({
        where: { slug: place.slug },
        create: {
          slug: place.slug,
          name: place.name,
          description: place.description,
          metadata: jsonInput(place.metadata),
        },
        update: {
          name: place.name,
          description: place.description,
          metadata: jsonInput(place.metadata),
        },
      });

      for (const node of place.nodes) {
        const pose = nodePoses.get(nodeKey(place.slug, node.slug));
        const poseFields = pose
          ? { poseX: pose.x, poseY: pose.y, poseZ: pose.z, poseYaw: pose.yaw, posePitch: pose.pitch }
          : {};
        const nodeRecord = await tx.sceneNode.upsert({
          where: { placeId_slug: { placeId: placeRecord.id, slug: node.slug } },
          create: {
            placeId: placeRecord.id,
            slug: node.slug,
            name: node.name,
            collisionData: jsonInput(node.collisionData),
            metadata: jsonInput(node.metadata),
            ...poseFields,
          },
          update: {
            name: node.name,
            collisionData: jsonInput(node.collisionData),
            metadata: jsonInput(node.metadata),
            ...poseFields,
          },
        });
        nodeIds.set(nodeKey(place.slug, node.slug), nodeRecord.id);

        const originalPaths = node.assets.map((asset) => asset.originalPath);
        await tx.sceneAsset.deleteMany({
          where: originalPaths.length
            ? {
                sceneNodeId: nodeRecord.id,
                originalPath: { notIn: originalPaths },
              }
            : { sceneNodeId: nodeRecord.id },
        });

        for (const asset of node.assets) {
          await tx.sceneAsset.upsert({
            where: {
              sceneNodeId_originalPath: {
                sceneNodeId: nodeRecord.id,
                originalPath: asset.originalPath,
              },
            },
            create: {
              sceneNodeId: nodeRecord.id,
              type: asset.type,
              objectKey: asset.objectKey,
              originalPath: asset.originalPath,
              mimeType: asset.mimeType,
              sizeBytes: BigInt(asset.sizeBytes),
              metadata: jsonInput(asset.metadata),
            },
            update: {
              type: asset.type,
              objectKey: asset.objectKey,
              mimeType: asset.mimeType,
              sizeBytes: BigInt(asset.sizeBytes),
              metadata: jsonInput(asset.metadata),
            },
          });
        }
      }
    }

    for (const place of plan.places) {
      for (const node of place.nodes) {
        const fromNodeId = requiredNodeId(nodeIds, place.slug, node.slug);
        const sourceKeys = node.portals.map((portal) => portal.sourceKey);
        await tx.portal.deleteMany({
          where: sourceKeys.length
            ? { fromNodeId, sourceKey: { notIn: sourceKeys } }
            : { fromNodeId },
        });
      }
    }

    for (const place of plan.places) {
      for (const node of place.nodes) {
        const fromNodeId = requiredNodeId(nodeIds, place.slug, node.slug);
        for (const portal of node.portals) {
          const toNodeId = requiredNodeId(nodeIds, place.slug, portal.toNodeSlug);
          const data = {
            toNodeId,
            name: portal.name,
            positionX: portal.position.x,
            positionY: portal.position.y,
            positionZ: portal.position.z,
            yaw: portal.yaw,
            radius: portal.radius,
            metadata: jsonInput(portal.metadata),
          };
          await tx.portal.upsert({
            where: { fromNodeId_sourceKey: { fromNodeId, sourceKey: portal.sourceKey } },
            create: { fromNodeId, sourceKey: portal.sourceKey, ...data },
            update: data,
          });
        }
      }
    }
  });

  return summary;
}

function validatePortalDestinations(plan: SceneImportPlan): void {
  for (const place of plan.places) {
    const nodeSlugs = new Set(place.nodes.map((node) => node.slug));
    for (const node of place.nodes) {
      for (const portal of node.portals) {
        if (!nodeSlugs.has(portal.toNodeSlug)) {
          throw new Error(
            `portal destination "${portal.toNodeSlug}" does not exist in place "${place.slug}"`,
          );
        }
      }
    }
  }
}

function summarize(plan: SceneImportPlan): ImportSummary {
  const nodes = plan.places.flatMap((place) => place.nodes);
  return {
    places: plan.places.length,
    nodes: nodes.length,
    assets: nodes.flatMap((node) => node.assets).length,
    portals: nodes.flatMap((node) => node.portals).length,
  };
}

function jsonInput(value: JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function requiredNodeId(nodeIds: Map<string, string>, placeSlug: string, nodeSlug: string): string {
  const id = nodeIds.get(nodeKey(placeSlug, nodeSlug));
  if (!id) throw new Error(`scene node "${placeSlug}/${nodeSlug}" was not persisted`);
  return id;
}

function nodeKey(placeSlug: string, nodeSlug: string): string {
  return `${placeSlug}/${nodeSlug}`;
}
