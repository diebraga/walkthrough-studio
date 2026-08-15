import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceImport, PortalImport } from "./discover.js";
import { completeReciprocalPortals } from "./reciprocal-portals.js";

function portal(overrides: Partial<PortalImport> = {}): PortalImport {
  return {
    sourceKey: "sample/hall/portals.json#0",
    name: "Balcony",
    toNodeSlug: "balcony",
    position: { x: 1, y: 2, z: 3 },
    yaw: Math.PI,
    radius: 0.8,
    spawn: { x: 5, y: 6, z: 7, yaw: 8, pitch: 0.2 },
    metadata: null,
    ...overrides,
  };
}

function place(forward = portal()): PlaceImport {
  return {
    slug: "sample",
    name: "Sample",
    description: null,
    metadata: null,
    nodes: [
      {
        slug: "hall",
        name: "Hall",
        collisionData: null,
        metadata: null,
        assets: [],
        portals: [forward],
      },
      {
        slug: "balcony",
        name: "Balcony",
        collisionData: null,
        metadata: null,
        assets: [],
        portals: [],
      },
    ],
  };
}

test("generates a reciprocal portal with the forward portal's return geometry", () => {
  const input = place(portal({ yaw: 3 * Math.PI / 4, spawn: { x: 5, y: 6, z: 7, yaw: -Math.PI / 2, pitch: 0.2 } }));
  const completed = completeReciprocalPortals(input);
  const reverse = completed.nodes.find((node) => node.slug === "balcony")?.portals[0];

  assert.ok(reverse);
  assert.equal(reverse.sourceKey, "generated-reverse:sample/hall/portals.json#0");
  assert.equal(reverse.name, "Hall");
  assert.equal(reverse.toNodeSlug, "hall");
  assert.deepEqual(reverse.position, { x: 5, y: 6, z: 7 });
  assert.equal(reverse.yaw, -Math.PI / 2);
  assert.equal(reverse.radius, 0.8);
  assert.deepEqual(reverse.spawn, { x: 1, y: 2, z: 3, yaw: reverse.spawn.yaw, pitch: 0 });
  assert.ok(Math.abs(reverse.spawn.yaw - -Math.PI / 4) < 1e-12);
  assert.deepEqual(reverse.metadata, { generated: true, reverseOf: "sample/hall/portals.json#0" });
  assert.deepEqual(input.nodes[1].portals, []);
});

test("keeps explicit reverse portals authoritative", () => {
  const input = place();
  input.nodes[1].portals.push(portal({
    sourceKey: "sample/balcony/portals.json#0",
    name: "Hall",
    toNodeSlug: "hall",
  }));

  const completed = completeReciprocalPortals(input);

  assert.equal(completed.nodes.find((node) => node.slug === "balcony")?.portals.length, 1);
  assert.equal(completed.nodes.find((node) => node.slug === "balcony")?.portals[0].sourceKey, "sample/balcony/portals.json#0");
});

test("generates a stable return for every forward portal when no explicit reverse exists", () => {
  const input = place();
  input.nodes[0].portals.push(portal({
    sourceKey: "sample/hall/portals.json#1",
    position: { x: 10, y: 11, z: 12 },
  }));

  const completed = completeReciprocalPortals(input);
  const reverse = completed.nodes.find((node) => node.slug === "balcony")?.portals;

  assert.deepEqual(reverse?.map((portal) => portal.sourceKey), [
    "generated-reverse:sample/hall/portals.json#0",
    "generated-reverse:sample/hall/portals.json#1",
  ]);
});

test("is idempotent and never completes generated entries", () => {
  const once = completeReciprocalPortals(place());
  const twice = completeReciprocalPortals(once);
  const balcony = twice.nodes.find((node) => node.slug === "balcony");
  const hall = twice.nodes.find((node) => node.slug === "hall");

  assert.equal(balcony?.portals.length, 1);
  assert.equal(hall?.portals.length, 1);

  const generatedOnly = place(portal({
    sourceKey: "generated-reverse:sample/balcony/portals.json#0",
    metadata: { generated: true, reverseOf: "sample/balcony/portals.json#0" },
  }));
  const withoutRecursion = completeReciprocalPortals(generatedOnly);
  assert.equal(withoutRecursion.nodes.find((node) => node.slug === "balcony")?.portals.length, 0);
});

test("rejects a portal whose destination node does not exist", () => {
  assert.throws(
    () => completeReciprocalPortals(place(portal({ toNodeSlug: "missing" }))),
    /portal destination "missing" does not exist in place "sample"/,
  );
});
