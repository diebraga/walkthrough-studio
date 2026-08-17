import { strict as assert } from "node:assert";
import { DEFAULT_RADIUS, offsetForward } from "./portals";

// Facing +z (yaw 0) pushes forward along -z, per the walker's own
// forward-vector convention (see walk-demo.ts `movement`/`aimPoint`).
assert.deepEqual(offsetForward({ x: 0, y: 1, z: 0 }, 0, 2), { x: 0, y: 1, z: -2 });

// Facing +x (yaw -pi/2) pushes forward along +x.
const east = offsetForward({ x: 0, y: 0, z: 0 }, -Math.PI / 2, 2);
assert.ok(Math.abs(east.x - 2) < 1e-9 && Math.abs(east.z) < 1e-9);

// The offset clears the default trigger radius, so a portal placed with it
// can't immediately enclose the player who just placed it.
const placed = offsetForward({ x: 0, y: 0, z: 0 }, 0, DEFAULT_RADIUS + 1);
const distance = Math.hypot(placed.x, placed.z);
assert.ok(distance > DEFAULT_RADIUS, `expected clearance, got ${distance}`);
