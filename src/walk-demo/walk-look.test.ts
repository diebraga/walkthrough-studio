import { strict as assert } from "node:assert";
import { nextLookAngles } from "./walk-look";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

const first = nextLookAngles({ yaw: 1, pitch: 0, dx: 10, dy: 20, thirdPerson: false });
near(first.yaw, 0.98);
near(first.pitch, -0.04);

const third = nextLookAngles({ yaw: 1, pitch: 0, dx: 10, dy: 20, thirdPerson: true });
near(third.yaw, 0.98);
near(third.pitch, 0.04);

const clamped = nextLookAngles({ yaw: 0, pitch: 0, dx: 0, dy: -10_000, thirdPerson: false });
assert.ok(clamped.pitch < Math.PI / 2);
