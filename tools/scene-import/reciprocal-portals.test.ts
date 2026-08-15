import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceImport, PortalImport } from "./discover.js";
import { completeReciprocalPortals } from "./reciprocal-portals.js";

function portal(overrides: Partial<PortalImport> = {}): PortalImport {
  return {
    sourceKey: "example/origin/portals.json#0",
    name: "Destination",
    toNodeSlug: "destination",
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
    slug: "example",
    name: "Example",
    description: null,
    metadata: null,
    nodes: [
      {
        slug: "origin",
        name: "Origin",
        collisionData: null,
        metadata: null,
        assets: [],
        portals: [forward],
      },
      {
        slug: "destination",
        name: "Destination",
        collisionData: null,
        metadata: null,
        assets: [],
        portals: [],
      },
    ],
  };
}

test("generates a reciprocal portal with the forward portal's return geometry", () => {
  const sourceYaw = Math.PI / 3;
  const sourcePosition = { x: 1, y: 2, z: 3 };
  const destinationSpawn = { x: 5, y: 6, z: 7, yaw: -Math.PI / 4, pitch: 0.2 };
  const input = place(portal({
    position: sourcePosition,
    yaw: sourceYaw,
    radius: 1.3,
    spawn: destinationSpawn,
  }));
  const completed = completeReciprocalPortals(input);
  const reverse = completed.nodes.find((node) => node.slug === "destination")?.portals[0];

  assert.ok(reverse);
  const clearance = 1.3 + 0.7;
  assert.equal(reverse.sourceKey, "generated-reverse:example/origin/portals.json#0");
  assert.equal(reverse.name, "Origin");
  assert.equal(reverse.toNodeSlug, "origin");
  assert.deepEqual(reverse.position, {
    x: destinationSpawn.x + Math.sin(destinationSpawn.yaw) * clearance,
    y: destinationSpawn.y,
    z: destinationSpawn.z + Math.cos(destinationSpawn.yaw) * clearance,
  });
  assert.equal(reverse.yaw, destinationSpawn.yaw);
  assert.equal(reverse.radius, 1.3);
  assert.deepEqual(reverse.spawn, {
    x: sourcePosition.x + Math.sin(sourceYaw) * clearance,
    y: sourcePosition.y,
    z: sourcePosition.z + Math.cos(sourceYaw) * clearance,
    yaw: reverse.spawn.yaw,
    pitch: 0,
  });
  assert.ok(Math.abs(reverse.spawn.yaw - -2 * Math.PI / 3) < 1e-12);
  assert.ok(Math.hypot(reverse.position.x - destinationSpawn.x, reverse.position.z - destinationSpawn.z) > reverse.radius);
  assert.ok(Math.hypot(reverse.spawn.x - sourcePosition.x, reverse.spawn.z - sourcePosition.z) > reverse.radius);
  assert.deepEqual(reverse.metadata, { generated: true, reverseOf: "example/origin/portals.json#0" });
  assert.deepEqual(input.nodes[1].portals, []);
});

test("keeps explicit reverse portals authoritative", () => {
  const input = place();
  const explicitReverse = portal({
    sourceKey: "example/destination/portals.json#0",
    name: "Origin",
    toNodeSlug: "origin",
    position: { x: -11, y: 4.5, z: 23 },
    yaw: -Math.PI / 7,
    radius: 2.4,
    spawn: { x: 31, y: -2, z: -17, yaw: Math.PI / 9, pitch: -0.3 },
  });
  input.nodes[1].portals.push(explicitReverse);
  const authoredGeometry = structuredClone({
    position: explicitReverse.position,
    yaw: explicitReverse.yaw,
    radius: explicitReverse.radius,
    spawn: explicitReverse.spawn,
  });

  const completed = completeReciprocalPortals(input);
  const completedReverse = completed.nodes.find((node) => node.slug === "destination")?.portals[0];

  assert.equal(completed.nodes.find((node) => node.slug === "destination")?.portals.length, 1);
  assert.ok(completedReverse);
  assert.equal(completedReverse.sourceKey, "example/destination/portals.json#0");
  assert.deepEqual(
    {
      position: completedReverse.position,
      yaw: completedReverse.yaw,
      radius: completedReverse.radius,
      spawn: completedReverse.spawn,
    },
    authoredGeometry,
  );
});

test("generates a stable return for every forward portal when no explicit reverse exists", () => {
  const input = place();
  input.nodes[0].portals.push(portal({
    sourceKey: "example/origin/portals.json#1",
    position: { x: 10, y: 11, z: 12 },
  }));

  const completed = completeReciprocalPortals(input);
  const reverse = completed.nodes.find((node) => node.slug === "destination")?.portals;

  assert.deepEqual(reverse?.map((portal) => portal.sourceKey), [
    "generated-reverse:example/origin/portals.json#0",
    "generated-reverse:example/origin/portals.json#1",
  ]);
});

test("is idempotent and never completes generated entries", () => {
  const once = completeReciprocalPortals(place());
  const twice = completeReciprocalPortals(once);
  const destination = twice.nodes.find((node) => node.slug === "destination");
  const origin = twice.nodes.find((node) => node.slug === "origin");

  assert.equal(destination?.portals.length, 1);
  assert.equal(origin?.portals.length, 1);

  const generatedOnly = place(portal({
    sourceKey: "generated-reverse:example/destination/portals.json#0",
    metadata: { generated: true, reverseOf: "example/destination/portals.json#0" },
  }));
  const withoutRecursion = completeReciprocalPortals(generatedOnly);
  assert.equal(withoutRecursion.nodes.find((node) => node.slug === "destination")?.portals.length, 0);
});

test("rejects a portal whose destination node does not exist", () => {
  assert.throws(
    () => completeReciprocalPortals(place(portal({ toNodeSlug: "missing" }))),
    /portal destination "missing" does not exist in place "example"/,
  );
});
