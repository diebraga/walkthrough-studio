import { strict as assert } from "node:assert";
import { formatDeveloperPose } from "./dev-position";

assert.equal(
    formatDeveloperPose({ x: 1.23456, y: -2, z: 3.9999, yaw: -0.12345, pitch: 0.98765 }),
    '{\n  "x": 1.235,\n  "y": -2,\n  "z": 4,\n  "yaw": -0.123,\n  "pitch": 0.988\n}',
);
