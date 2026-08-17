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
  const nodes = new Map<string, { id: string; data?: Record<string, unknown> }>();
  const assets = new Map<string, { id: string }>();
  const portals = new Map<string, {
    id: string;
    fromNodeId: string;
    sourceKey: string;
    data: Record<string, unknown>;
  }>();
  const sceneAssetDeleteCalls: Array<{ where: Record<string, unknown> }> = [];
  const portalDeleteCalls: Array<{ where: Record<string, unknown> }> = [];
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
      upsert: async ({ where, create }: { where: { placeId_slug: { placeId: string; slug: string } }; create: Record<string, unknown> }) => {
        const key = `${where.placeId_slug.placeId}:${where.placeId_slug.slug}`;
        if (!nodes.has(key)) nodes.set(key, { id: `node-${where.placeId_slug.placeId}-${where.placeId_slug.slug}` });
        nodes.get(key)!.data = create;
        return nodes.get(key)!;
      },
    },
    sceneAsset: {
      upsert: async ({ where }: { where: { sceneNodeId_originalPath: { sceneNodeId: string; originalPath: string } } }) => {
        const key = `${where.sceneNodeId_originalPath.sceneNodeId}:${where.sceneNodeId_originalPath.originalPath}`;
        if (!assets.has(key)) assets.set(key, { id: id() });
        return assets.get(key)!;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        sceneAssetDeleteCalls.push({ where });
        const sceneNodeId = String(where.sceneNodeId);
        const notIn = (where.originalPath as { notIn?: string[] } | undefined)?.notIn;
        for (const key of assets.keys()) {
          const [assetNodeId, originalPath] = key.split(":");
          if (assetNodeId !== sceneNodeId) continue;
          if (!notIn || !notIn.includes(originalPath)) assets.delete(key);
        }
      },
    },
    portal: {
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        portalDeleteCalls.push({ where });
        const fromNodeId = String(where.fromNodeId);
        const notIn = (where.sourceKey as { notIn?: string[] } | undefined)?.notIn;
        for (const [key, portal] of portals) {
          if (portal.fromNodeId !== fromNodeId) continue;
          if (!notIn || !notIn.includes(portal.sourceKey)) portals.delete(key);
        }
      },
      upsert: async ({ where, create }: { where: { fromNodeId_sourceKey: { fromNodeId: string; sourceKey: string } }; create: Record<string, unknown> }) => {
        const key = `${where.fromNodeId_sourceKey.fromNodeId}:${where.fromNodeId_sourceKey.sourceKey}`;
        if (!portals.has(key)) {
          portals.set(key, {
            id: id(),
            fromNodeId: where.fromNodeId_sourceKey.fromNodeId,
            sourceKey: where.fromNodeId_sourceKey.sourceKey,
            data: create,
          });
        } else {
          portals.get(key)!.data = create;
        }
        return portals.get(key)!;
      },
    },
  };
  const database = {
    $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
  } as unknown as DatabaseClient;
  return { database, places, nodes, assets, portals, sceneAssetDeleteCalls, portalDeleteCalls };
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
  assert.match(String(portal.fromNodeId), /^node-/);
  assert.match(String(portal.toNodeId), /^node-/);
  assert.notEqual(portal.fromNodeId, portal.toNodeId);
  assert.equal(portal.positionX, 1);
  assert.equal("spawnPitch" in portal, false, "portals no longer carry a spawn override");

  // The destination node's canonical pose is derived from the one portal
  // that lands there, since legacy portals.json still carries a spawn.
  const balconyNode = [...fake.nodes.entries()].find(([key]) => key.endsWith(":balcony"))![1];
  assert.equal(balconyNode.data?.posePitch, 9);
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

test("assigns distinct mock node IDs to same-slug nodes in different places", async () => {
  const fake = fakeDatabase();
  const node = (): SceneImportPlan["places"][number]["nodes"][number] => ({
    slug: "hall",
    name: "Hall",
    collisionData: null,
    metadata: null,
    assets: [],
    portals: [],
  });

  await persistSceneImport(fake.database, {
    places: ["first_place", "second_place"].map((slug) => ({
      slug,
      name: slug,
      description: null,
      metadata: null,
      nodes: [node()],
    })),
  });

  assert.equal(fake.nodes.size, 2);
  assert.equal(new Set([...fake.nodes.values()].map((record) => record.id)).size, 2);
});

test("deletes stale scene assets while retaining the planned originals", async () => {
  const fake = fakeDatabase();
  fake.assets.set("node-id-1-balcony:public/sample_place/balcony/stale.ply", { id: "stale" });
  const plan: SceneImportPlan = {
    places: [{
      slug: "sample_place",
      name: "Sample Place",
      description: null,
      metadata: null,
      nodes: [{
        slug: "balcony",
        name: "Balcony",
        collisionData: null,
        metadata: null,
        assets: [
          {
            type: "GAUSSIAN_SPLAT",
            objectKey: "sample_place/balcony/index.spz",
            originalPath: "public/sample_place/balcony/index.spz",
            mimeType: "application/octet-stream",
            sizeBytes: 8,
            metadata: null,
          },
          {
            type: "MANUAL_COLLISION",
            objectKey: null,
            originalPath: "public/sample_place/balcony/manual-collision.json",
            mimeType: "application/json",
            sizeBytes: 2,
            metadata: null,
          },
        ],
        portals: [],
      }],
    }],
  };

  await persistSceneImport(fake.database, plan);

  assert.deepEqual(fake.sceneAssetDeleteCalls, [{
    where: {
      sceneNodeId: "node-id-1-balcony",
      originalPath: {
        notIn: [
          "public/sample_place/balcony/index.spz",
          "public/sample_place/balcony/manual-collision.json",
        ],
      },
    },
  }]);
  assert.equal(fake.assets.has("node-id-1-balcony:public/sample_place/balcony/stale.ply"), false);
});

test("deletes all scene assets when the plan has no assets", async () => {
  const fake = fakeDatabase();
  await persistSceneImport(fake.database, {
    places: [{
      slug: "sample_place",
      name: "Sample Place",
      description: null,
      metadata: null,
      nodes: [{
        slug: "empty",
        name: "Empty",
        collisionData: null,
        metadata: null,
        assets: [],
        portals: [],
      }],
    }],
  });

  assert.deepEqual(fake.sceneAssetDeleteCalls, [{ where: { sceneNodeId: "node-id-1-empty" } }]);
});

test("reconciles stale outgoing portals against each node's planned keys", async () => {
  const fake = fakeDatabase();
  const plan = samplePlan();
  plan.places[0].nodes[1].portals = [{
    sourceKey: "sample/balcony/portals.json#0",
    name: "hall",
    toNodeSlug: "hall",
    position: { x: 5, y: 6, z: 7 },
    yaw: 8,
    radius: 0.8,
    spawn: { x: 1, y: 2, z: 3, yaw: 4, pitch: 5 },
    metadata: null,
  }];
  const generatedReverseKey = "node-id-1-balcony:generated-reverse:sample/hall/portals.json#0";
  fake.portals.set("node-id-1-hall:stale", {
    id: "stale-hall",
    fromNodeId: "node-id-1-hall",
    sourceKey: "stale",
    data: {},
  });
  fake.portals.set(generatedReverseKey, {
    id: "stale-generated-reverse",
    fromNodeId: "node-id-1-balcony",
    sourceKey: "generated-reverse:sample/hall/portals.json#0",
    data: {},
  });

  await persistSceneImport(fake.database, plan);

  assert.deepEqual(fake.portalDeleteCalls, [
    {
      where: {
        fromNodeId: "node-id-1-hall",
        sourceKey: { notIn: ["sample/hall/portals.json#0"] },
      },
    },
    {
      where: {
        fromNodeId: "node-id-1-balcony",
        sourceKey: { notIn: ["sample/balcony/portals.json#0"] },
      },
    },
  ]);
  assert.equal(fake.portals.has("node-id-1-hall:stale"), false);
  assert.equal(fake.portals.has(generatedReverseKey), false);
  assert.equal(fake.portals.has("node-id-1-balcony:sample/balcony/portals.json#0"), true);
});

test("deletes every outgoing portal when a node has an empty portal plan", async () => {
  const fake = fakeDatabase();
  fake.portals.set("node-id-1-balcony:stale", {
    id: "stale-balcony",
    fromNodeId: "node-id-1-balcony",
    sourceKey: "stale",
    data: {},
  });

  await persistSceneImport(fake.database, samplePlan());

  assert.deepEqual(fake.portalDeleteCalls, [
    {
      where: {
        fromNodeId: "node-id-1-hall",
        sourceKey: { notIn: ["sample/hall/portals.json#0"] },
      },
    },
    { where: { fromNodeId: "node-id-1-balcony" } },
  ]);
  assert.equal(fake.portals.has("node-id-1-balcony:stale"), false);
});
