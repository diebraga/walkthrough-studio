import { strict as assert } from "node:assert";
import { resolvePortalTeleport } from "./teleport";
import type { Portal } from "./portals";

const base: Portal = {
    name: "balcony",
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    radius: 0.8,
    to: null,
    spawn: null,
};

assert.equal(resolvePortalTeleport(base, new Set(["balcony"])), null);

assert.deepEqual(
    resolvePortalTeleport(
        {
            ...base,
            to: "balcony",
            spawn: { x: 1, y: 2, z: 3, yaw: 4, pitch: 5 },
        },
        new Set(["balcony"]),
    ),
    {
        scheme: "balcony",
        pose: { px: 1, py: 2, pz: 3, yaw: 4, pitch: 5 },
        skipOpeningTransition: true,
    },
);

assert.equal(
    resolvePortalTeleport(
        {
            ...base,
            to: "missing",
            spawn: { x: 1, y: 2, z: 3, yaw: 4 },
        },
        new Set(["balcony"]),
    ),
    null,
);
