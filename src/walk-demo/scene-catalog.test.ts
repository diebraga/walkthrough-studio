import { strict as assert } from "node:assert";
import {
  adaptSceneCatalog,
  fetchSceneCatalog,
  resolveSceneAssetUrl,
} from "./scene-catalog";

const collision = {
  cell: 0.15,
  origin: [0, 0] as [number, number],
  size: [1, 1] as [number, number],
  floorY: -1.65,
  wallHeight: 3.8,
  rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  walkable: "AA==",
};
const fixture = {
  place: {
    id: "place-1",
    slug: "23_nashville_dr_tenessee",
    name: "23 Nashville Dr Tennessee",
    description: null,
    metadata: null,
    nodes: [
      {
        id: "node-balcony",
        slug: "balcony",
        name: "Balcony",
        collisionData: { ...collision, floorY: -1.23 },
        metadata: null,
        pose: { x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0 },
        assets: [
          {
            id: "asset-balcony",
            type: "GAUSSIAN_SPLAT",
            objectKey: null,
            originalPath: "public/23_nashville_dr_tenessee/balcony/index.ply",
            mimeType: "application/octet-stream",
            sizeBytes: "309409303",
            metadata: null,
          },
          {
            id: "manual-balcony",
            type: "MANUAL_COLLISION",
            objectKey: null,
            originalPath: "public/23_nashville_dr_tenessee/balcony/manual-collision.json",
            mimeType: "application/json",
            sizeBytes: "224",
            metadata: { floorY: -1.23, wallHeight: 2, floors: [], walls: [{ x: 1, z: 2, width: 3, depth: 0.2, yaw: 0.5 }] },
          },
        ],
        portals: [],
      },
      {
        id: "node-hall",
        slug: "hall",
        name: "Hall",
        collisionData: collision,
        metadata: null,
        pose: { x: 0, y: -0.4, z: 0, yaw: 0, pitch: 0 },
        assets: [{
          id: "asset-hall",
          type: "GAUSSIAN_SPLAT",
          objectKey: null,
          originalPath: "public/23_nashville_dr_tenessee/hall/index.ply",
          mimeType: "application/octet-stream",
          sizeBytes: "163141743",
          metadata: null,
        }],
        portals: [{
          id: "portal-1",
          name: "balcony",
          position: { x: 5.460187628181378, y: -1.6575586062801138, z: 1.2482137278601433 },
          yaw: -3.112796326794897,
          radius: 0.8,
          metadata: null,
          toNodeId: "node-balcony",
          toNodeSlug: "balcony",
          toNodeName: "Balcony",
        }],
      },
    ],
  },
};

assert.equal(
  resolveSceneAssetUrl(fixture.place.nodes[1].assets[0], ""),
  "/23_nashville_dr_tenessee/hall/index.ply",
);
assert.equal(
  resolveSceneAssetUrl(fixture.place.nodes[1].assets[0], "https://assets.example/"),
  "https://assets.example/23_nashville_dr_tenessee/hall/index.ply",
);
assert.equal(
  resolveSceneAssetUrl({ ...fixture.place.nodes[1].assets[0], objectKey: "https://blob.example/hall.ply" }, ""),
  "https://blob.example/hall.ply",
);

const catalog = adaptSceneCatalog(fixture, { splatBaseUrl: "https://assets.example" });
assert.equal(catalog.place.slug, "23_nashville_dr_tenessee");
assert.equal(catalog.initialNodeId, "node-hall");
assert.equal(catalog.nodeBySlug.get("hall")?.id, "node-hall");
assert.equal(catalog.nodeById.get("node-hall")?.collisionData, collision);
assert.equal(catalog.nodeById.get("node-hall")?.splatUrl, "https://assets.example/23_nashville_dr_tenessee/hall/index.ply");
assert.deepEqual(catalog.nodeById.get("node-balcony")?.manualCollision.walls, fixture.place.nodes[0].assets[1].metadata.walls);
assert.deepEqual(catalog.nodeById.get("node-hall")?.portals[0], {
  id: "portal-1",
  name: "balcony",
  position: { x: 5.460187628181378, y: -1.6575586062801138, z: 1.2482137278601433 },
  yaw: -3.112796326794897,
  radius: 0.8,
  toNodeId: "node-balcony",
});
assert.deepEqual(catalog.nodeById.get("node-balcony")?.pose, {
  px: 9.14,
  py: 0.17,
  pz: 3.09,
  yaw: 0,
  pitch: 0,
  thirdPersonDistance: 3.4,
});

assert.throws(
  () => adaptSceneCatalog({ place: { ...fixture.place, nodes: [] } }),
  /has no scene nodes/,
);
assert.throws(
  () => adaptSceneCatalog({ place: { ...fixture.place, nodes: [{ ...fixture.place.nodes[1], assets: [] }] } }),
  /has no Gaussian splat asset/,
);
assert.throws(
  () => adaptSceneCatalog({ place: { ...fixture.place, nodes: [{ ...fixture.place.nodes[1], collisionData: null }] } }),
  /has invalid collision data/,
);
assert.throws(
  () => adaptSceneCatalog({ place: { ...fixture.place, nodes: [{ ...fixture.place.nodes[1], portals: [{ ...fixture.place.nodes[1].portals[0], toNodeId: "missing" }] }] } }),
  /targets missing node/,
);

await assert.rejects(
  fetchSceneCatalog("missing", {
    fetcher: async (input) => {
      assert.equal(input, "/api/scenes?place=missing");
      return new Response(JSON.stringify({ error: "Place not found" }), { status: 404 });
    },
  }),
  /Scene metadata request failed \(404\): Place not found/,
);
