import { strict as assert } from "node:assert";
import { createScenesRoute } from "./scenes.js";

const route = createScenesRoute(async () => [
  {
    id: "place-1",
    slug: "sample",
    name: "Sample",
    description: null,
    metadata: { imported: true },
    sceneNodes: [
      {
        id: "node-1",
        slug: "hall",
        name: "Hall",
        collisionData: { floorY: -1 },
        metadata: null,
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
            spawnX: 5,
            spawnY: 6,
            spawnZ: 7,
            spawnYaw: 8,
            spawnPitch: 9,
            metadata: null,
            toNodeId: "node-2",
            toNode: { slug: "balcony", name: "Balcony" },
          },
        ],
      },
    ],
  },
]);

const response = await route.request("/");
assert.equal(response.status, 200);
const body = await response.json();
assert.equal(body.places[0].nodes[0].assets[0].sizeBytes, "163141743");
assert.deepEqual(body.places[0].nodes[0].portals[0], {
  id: "portal-1",
  name: "balcony",
  position: { x: 1, y: 2, z: 3 },
  yaw: 4,
  radius: 0.8,
  spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 },
  metadata: null,
  toNodeId: "node-2",
  toNodeSlug: "balcony",
  toNodeName: "Balcony",
});
