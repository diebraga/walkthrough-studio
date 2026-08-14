import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "../../server/db.js";
import type { SceneImportPlan } from "./discover.js";
import { persistSceneImport } from "./import.js";

function samplePlan(destination = "balcony"): SceneImportPlan {
  return {
    places: [
      {
        slug: "sample",
        name: "Sample",
        description: null,
        metadata: { importPath: "sample" },
        nodes: [
          {
            slug: "hall",
            name: "Hall",
            collisionData: { floorY: -1 },
            metadata: { importPath: "sample/hall" },
            assets: [
              {
                type: "GAUSSIAN_SPLAT",
                objectKey: null,
                originalPath: "public/sample/hall/index.ply",
                mimeType: "application/octet-stream",
                sizeBytes: 10,
                metadata: null,
              },
            ],
            portals: [
              {
                sourceKey: "sample/hall/portals.json#0",
                name: "balcony",
                toNodeSlug: destination,
                position: { x: 1, y: 2, z: 3 },
                yaw: 4,
                radius: 0.8,
                spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 },
                metadata: null,
              },
            ],
          },
          {
            slug: "balcony",
            name: "Balcony",
            collisionData: null,
            metadata: { importPath: "sample/balcony" },
            assets: [],
            portals: [],
          },
        ],
      },
    ],
  };
}

function fakeDatabase() {
  const places = new Map<string, { id: string }>();
  const nodes = new Map<string, { id: string }>();
  const assets = new Map<string, { id: string }>();
  const portals = new Map<string, { id: string; data: Record<string, unknown> }>();
  let sequence = 0;
  const id = () => `id-${++sequence}`;
  const transaction = {
    place: {
      upsert: async ({ where }: { where: { slug: string } }) => {
        if (!places.has(where.slug)) places.set(where.slug, { id: id() });
        return places.get(where.slug)!;
      },
    },
    sceneNode: {
      upsert: async ({ where }: { where: { placeId_slug: { placeId: string; slug: string } } }) => {
        const key = `${where.placeId_slug.placeId}:${where.placeId_slug.slug}`;
        if (!nodes.has(key)) nodes.set(key, { id: id() });
        return nodes.get(key)!;
      },
    },
    sceneAsset: {
      upsert: async ({ where }: { where: { sceneNodeId_originalPath: { sceneNodeId: string; originalPath: string } } }) => {
        const key = `${where.sceneNodeId_originalPath.sceneNodeId}:${where.sceneNodeId_originalPath.originalPath}`;
        if (!assets.has(key)) assets.set(key, { id: id() });
        return assets.get(key)!;
      },
    },
    portal: {
      upsert: async ({ where, create }: { where: { fromNodeId_sourceKey: { fromNodeId: string; sourceKey: string } }; create: Record<string, unknown> }) => {
        const key = `${where.fromNodeId_sourceKey.fromNodeId}:${where.fromNodeId_sourceKey.sourceKey}`;
        if (!portals.has(key)) portals.set(key, { id: id(), data: create });
        else portals.get(key)!.data = create;
        return portals.get(key)!;
      },
    },
  };
  const database = {
    $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
  } as unknown as DatabaseClient;
  return { database, places, nodes, assets, portals };
}

test("upserts the graph idempotently and resolves portal node IDs", async () => {
  const fake = fakeDatabase();
  const first = await persistSceneImport(fake.database, samplePlan());
  const firstPortalId = [...fake.portals.values()][0].id;
  const second = await persistSceneImport(fake.database, samplePlan());

  assert.deepEqual(first, { places: 1, nodes: 2, assets: 1, portals: 1 });
  assert.deepEqual(second, first);
  assert.equal(fake.places.size, 1);
  assert.equal(fake.nodes.size, 2);
  assert.equal(fake.assets.size, 1);
  assert.equal(fake.portals.size, 1);
  assert.equal([...fake.portals.values()][0].id, firstPortalId);

  const portal = [...fake.portals.values()][0].data;
  assert.match(String(portal.fromNodeId), /^id-/);
  assert.match(String(portal.toNodeId), /^id-/);
  assert.notEqual(portal.fromNodeId, portal.toNodeId);
  assert.equal(portal.positionX, 1);
  assert.equal(portal.spawnPitch, 9);
});

test("rejects unresolved portal destinations before opening a transaction", async () => {
  let transactions = 0;
  const database = {
    $transaction: async () => {
      transactions += 1;
    },
  } as unknown as DatabaseClient;

  await assert.rejects(
    persistSceneImport(database, samplePlan("missing")),
    /portal destination "missing" does not exist in place "sample"/,
  );
  assert.equal(transactions, 0);
});
