import { strict as assert } from "node:assert";
import { GridCollision, type CollisionGridData } from "./grid-collision";

// 3x3 grid, cell = 1m, only the center cell (1,1) walkable.
const bits = new Uint8Array(Math.ceil(9 / 8));
const centerIndex = 1 * 3 + 1;
bits[centerIndex >> 3]! |= 1 << (centerIndex & 7);
const data: CollisionGridData = {
    cell: 1,
    origin: [0, 0],
    size: [3, 3],
    floorY: 0,
    wallHeight: 2,
    walkable: Buffer.from(bits).toString("base64"),
};

const grid = new GridCollision(data);
assert.deepEqual(grid.walkableCenter(), { x: 1.5, z: 1.5 });

// An empty grid falls back to the origin rather than dividing by zero.
const empty = new GridCollision({ ...data, walkable: Buffer.from(new Uint8Array(2)).toString("base64") });
assert.deepEqual(empty.walkableCenter(), { x: 0, z: 0 });
