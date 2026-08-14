import { strict as assert } from "node:assert";
import { createManualWall, eraseManualCollisionAt, ManualCollision } from "./manual-collision";

const data = {
  floorY: 0,
  wallHeight: 2,
  floors: [{ x: 0, z: 0, width: 4, depth: 4 }],
  walls: [{ x: 1, z: 0, width: 0.2, depth: 2, yaw: 0 }],
};

const collision = new ManualCollision(data);
const out = { x: 0, y: 0, z: 0 };

assert.equal(collision.queryCapsule(0, 0.2, 0, 0.5, 0.2, out), true);
assert.equal(out.y > 0, true);

assert.equal(collision.queryCapsule(1, 1, 0, 0.5, 0.3, out), true);
assert.equal(Math.abs(out.x) > 0 || Math.abs(out.z) > 0, true);

const erased = eraseManualCollisionAt(data, 1, 0, 0.5);
assert.equal(erased.walls.length, 0);
assert.equal(erased.floors.length, 1);

for (const yaw of [0, Math.PI / 4, Math.PI / 2]) {
  const wall = createManualWall({ x: 2, z: 3, yaw });
  assert.deepEqual(wall, { x: 2, z: 3, width: 3, depth: 0.24, yaw: -yaw });

  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const widthAxis = { x: Math.cos(wall.yaw), z: Math.sin(wall.yaw) };
  assert.ok(Math.abs(forward.x * widthAxis.x + forward.z * widthAxis.z) < 1e-10);
}

const existing = createManualWall({ x: 0, z: 0, yaw: 0 });
const next = createManualWall({ x: 1, z: 1, yaw: 1 });
assert.deepEqual([... [existing], next], [existing, next]);
