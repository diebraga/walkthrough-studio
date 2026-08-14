import { strict as assert } from "node:assert";
import { createDatabaseSceneSchemes } from "./runtime-scenes";
import type { SceneCatalog, RuntimeSceneNode } from "./scene-catalog";

const node: RuntimeSceneNode = {
  id: "node-hall",
  slug: "hall",
  name: "Hall",
  splatUrl: "https://assets.example/hall/index.ply",
  collisionData: { cell: 0.15, origin: [0, 0], size: [1, 1], floorY: -1.65, wallHeight: 3.8, rotation: [], walkable: "AA==" },
  manualCollision: { floorY: -1.65, wallHeight: 2, floors: [], walls: [] },
  portals: [{
    id: "portal-1",
    name: "balcony",
    position: { x: 1, y: 2, z: 3 },
    yaw: 4,
    radius: 0.8,
    toNodeId: "node-balcony",
    spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 },
  }],
  assetBase: "/place/hall/",
  pose: { px: 0, py: -0.4, pz: 0, yaw: 0, pitch: 0 },
};
const catalog: SceneCatalog = {
  place: { id: "place-1", slug: "place", name: "Place", description: null },
  initialNodeId: node.id,
  nodes: [node],
  nodeById: new Map([[node.id, node]]),
  nodeBySlug: new Map([[node.slug, node]]),
};

const schemes = createDatabaseSceneSchemes(catalog);
assert.deepEqual(Object.keys(schemes), ["node-hall"]);
assert.equal(schemes["node-hall"].splatCandidates[0], node.splatUrl);
assert.equal(schemes["node-hall"].collisionData, node.collisionData);
assert.equal(schemes["node-hall"].manualCollision, node.manualCollision);
assert.deepEqual(schemes["node-hall"].portals[0], {
  id: "portal-1",
  name: "balcony",
  position: { x: 1, y: 2, z: 3 },
  yaw: 4,
  radius: 0.8,
  toNodeId: "node-balcony",
  to: null,
  spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 },
});
assert.equal("collisionGrid" in schemes["node-hall"], false);
