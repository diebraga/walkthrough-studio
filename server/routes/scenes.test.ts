import { strict as assert } from "node:assert";
import type { NodePoseRecord, SceneMutationStore, UpdateNodePoseInput } from "./scenes.js";
import { createScenesRoute } from "./scenes.js";

const HALL_ID = "11111111-1111-4111-8111-111111111111";
const BALCONY_ID = "22222222-2222-4222-8222-222222222222";

const places = [
  {
    id: "place-1",
    slug: "sample",
    name: "Sample",
    description: null,
    metadata: { imported: true },
    sceneNodes: [
      {
        id: HALL_ID,
        slug: "hall",
        name: "Hall",
        collisionData: { floorY: -1 },
        metadata: null,
        poseX: 0,
        poseY: -0.4,
        poseZ: 0,
        poseYaw: 0,
        posePitch: 0,
        assets: [
          {
            id: "asset-1",
            type: "GAUSSIAN_SPLAT",
            objectKey: null,
            originalPath: "public/sample/hall/index.ply",
            mimeType: "application/octet-stream",
            sizeBytes: 163141743n,
            metadata: null,
          },
        ],
        outgoingPortals: [
          {
            id: "portal-1",
            name: "balcony",
            positionX: 1,
            positionY: 2,
            positionZ: 3,
            yaw: 4,
            radius: 0.8,
            metadata: null,
            toNodeId: BALCONY_ID,
            toNode: { slug: "balcony", name: "Balcony" },
          },
        ],
      },
    ],
  },
];

const readers = {
  readAll: async () => places,
  readBySlug: async (slug: string) => places.find((place) => place.slug === slug) ?? null,
};

const updatePoseCalls: UpdateNodePoseInput[] = [];
const mutationStore: SceneMutationStore = {
  async updatePose(input): Promise<NodePoseRecord> {
    updatePoseCalls.push(input);
    return { id: input.id, pose: input.pose };
  },
};

const route = createScenesRoute(readers, mutationStore, () => true);

const response = await route.request("/");
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "public, max-age=30, stale-while-revalidate=300");
const body = await response.json();
assert.equal(body.places[0].nodes[0].assets[0].sizeBytes, "163141743");
assert.deepEqual(body.places[0].nodes[0].pose, { x: 0, y: -0.4, z: 0, yaw: 0, pitch: 0 });
assert.deepEqual(body.places[0].nodes[0].portals[0], {
  id: "portal-1",
  name: "balcony",
  position: { x: 1, y: 2, z: 3 },
  yaw: 4,
  radius: 0.8,
  metadata: null,
  toNodeId: BALCONY_ID,
  toNodeSlug: "balcony",
  toNodeName: "Balcony",
});

const placeResponse = await route.request("/?place=sample");
assert.equal(placeResponse.status, 200);
assert.equal(placeResponse.headers.get("cache-control"), "public, max-age=30, stale-while-revalidate=300");
const placeBody = await placeResponse.json();
assert.equal(placeBody.place.slug, "sample");
assert.equal(placeBody.place.nodes[0].assets[0].sizeBytes, "163141743");

const missingResponse = await route.request("/?place=missing");
assert.equal(missingResponse.status, 404);
assert.deepEqual(await missingResponse.json(), { error: "Place not found" });

const newPose = { x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0 };
const patchResponse = await route.request("/", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: HALL_ID, pose: newPose }),
});
assert.equal(patchResponse.status, 200);
assert.deepEqual(updatePoseCalls, [{ id: HALL_ID, pose: newPose }]);
assert.deepEqual((await patchResponse.json()).node, { id: HALL_ID, pose: newPose });

const invalidPatchResponse = await route.request("/", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: HALL_ID, pose: { ...newPose, x: "bad" } }),
});
assert.equal(invalidPatchResponse.status, 400);
assert.equal(updatePoseCalls.length, 1, "an invalid pose never reaches the store");

const disabledRoute = createScenesRoute(readers, mutationStore, () => false);
const disabledPatchResponse = await disabledRoute.request("/", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: HALL_ID, pose: newPose }),
});
assert.equal(disabledPatchResponse.status, 404);
assert.equal(updatePoseCalls.length, 1, "authoring-gated PATCH never reaches the store when disabled");
// GET stays available regardless of the authoring gate.
assert.equal((await disabledRoute.request("/")).status, 200);
