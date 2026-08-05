import { strict as assert } from "node:assert";
import { flyVector } from "./fly-mode";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

assert.deepEqual(flyVector({ forward: 0, strafe: 0, vertical: 0 }, 0, 0, 4), { x: 0, y: 0, z: 0 });

const forward = flyVector({ forward: 1, strafe: 0, vertical: 0 }, 0, 0, 4);
near(forward.x, 0);
near(forward.y, 0);
near(forward.z, -4);

const pitched = flyVector({ forward: 1, strafe: 0, vertical: 0 }, 0, Math.PI / 2, 4);
near(pitched.x, 0);
near(pitched.y, 4);
near(pitched.z, 0);

const diagonal = flyVector({ forward: 1, strafe: 1, vertical: 1 }, 0, 0, 6);
near(Math.hypot(diagonal.x, diagonal.y, diagonal.z), 6);
