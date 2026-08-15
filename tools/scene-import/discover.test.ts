import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSceneImport } from "./discover.js";

async function createFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "scene-import-"));
  for (const node of ["origin", "destination"]) {
    await mkdir(path.join(root, "sample_place", node), { recursive: true });
    await writeFile(
      path.join(root, "sample_place", node, "collision.json"),
      JSON.stringify({ version: 1, floorY: node === "origin" ? -1.5 : 0.5 }),
    );
    await writeFile(path.join(root, "sample_place", node, "index.ply"), "ply\n");
  }
  await writeFile(path.join(root, "sample_place", "destination", "index.spz"), "spz-data");
  await writeFile(
    path.join(root, "sample_place", "origin", "collision-report.json"),
    JSON.stringify({ warnings: ["check floor"] }),
  );
  await writeFile(
    path.join(root, "sample_place", "origin", "manual-collision.json"),
    JSON.stringify({ walls: [{ x: 1 }] }),
  );
  await writeFile(path.join(root, "sample_place", "origin", "notes.txt"), "keep me");
  await writeFile(
    path.join(root, "sample_place", "origin", "portals.json"),
    JSON.stringify({
      portals: [
        {
          name: "destination",
          position: { x: 1, y: 2, z: 3 },
          yaw: 4,
          radius: 0.8,
          to: "destination",
          spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 },
          label: "preserved",
        },
      ],
    }),
  );
  return root;
}

test("discovers nodes, structured JSON, assets, and directional portals", async () => {
  const root = await createFixture();
  const plan = await discoverSceneImport(root);

  assert.equal(plan.places.length, 1);
  assert.equal(plan.places[0].slug, "sample_place");
  assert.equal(plan.places[0].nodes.length, 2);

  const origin = plan.places[0].nodes.find((node) => node.slug === "origin");
  assert.ok(origin);
  assert.deepEqual(origin.collisionData, { version: 1, floorY: -1.5 });
  assert.deepEqual(
    origin.assets.map((asset) => [asset.type, asset.mimeType, asset.sizeBytes]),
    [
      ["COLLISION_REPORT", "application/json", 28],
      ["GAUSSIAN_SPLAT", "application/octet-stream", 4],
      ["MANUAL_COLLISION", "application/json", 19],
      ["OTHER", "text/plain", 7],
    ],
  );
  assert.deepEqual(origin.assets[0].metadata, { warnings: ["check floor"] });
  const destination = plan.places[0].nodes.find((node) => node.slug === "destination");
  assert.ok(destination);
  assert.deepEqual(
    destination.assets.filter((asset) => asset.type === "GAUSSIAN_SPLAT"),
    [{
      type: "GAUSSIAN_SPLAT",
      objectKey: "sample_place/destination/index.spz",
      originalPath: "sample_place/destination/index.spz",
      mimeType: "application/octet-stream",
      sizeBytes: 8,
      metadata: null,
    }],
  );
  assert.equal(
    origin.assets.find((asset) => asset.type === "GAUSSIAN_SPLAT")?.objectKey,
    "sample_place/origin/index.ply",
  );
  assert.equal(origin.portals[0].toNodeSlug, "destination");
  assert.equal(origin.portals[0].sourceKey, "sample_place/origin/portals.json#0");
  assert.deepEqual(origin.portals[0].metadata, { label: "preserved" });
  assert.deepEqual(origin.portals[0].spawn, { x: 5, y: 6, z: 7, yaw: 8, pitch: 9 });

  const reverse = destination.portals.find(
    (portal) => portal.sourceKey === "generated-reverse:sample_place/origin/portals.json#0",
  );
  assert.ok(reverse);
  assert.equal(reverse.toNodeSlug, "origin");
  assert.ok(
    Math.hypot(reverse.position.x - origin.portals[0].spawn.x, reverse.position.z - origin.portals[0].spawn.z)
      > reverse.radius,
  );
});

test("fails discovery on invalid JSON", async () => {
  const root = await createFixture();
  await writeFile(path.join(root, "sample_place", "origin", "collision.json"), "{");

  await assert.rejects(
    discoverSceneImport(root),
    /sample_place\/origin\/collision\.json contains invalid JSON/,
  );
});

test("discovers the current repository dataset completely", async () => {
  const plan = await discoverSceneImport(path.resolve("public"));
  assert.equal(plan.places.length, 1);
  assert.equal(plan.places[0].slug, "23_nashville_dr_tenessee");
  assert.equal(plan.places[0].nodes.length, 2);
  assert.equal(plan.places[0].nodes.flatMap((node) => node.assets).length, 5);
});
