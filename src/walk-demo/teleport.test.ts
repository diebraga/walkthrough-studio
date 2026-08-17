import { strict as assert } from "node:assert";
import { resolvePortalTeleport } from "./teleport";
import type { Portal } from "./portals";

const base: Portal = {
    id: "portal-1",
    name: "balcony",
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    radius: 0.8,
    toNodeId: null,
    to: null,
};

const balconyPose = { px: 9.14, py: 0.17, pz: 3.09, yaw: 0, pitch: 0 };
const schemes = { "node-balcony": { pose: balconyPose } };

assert.equal(resolvePortalTeleport(base, schemes), null, "a portal with no destination never resolves");

assert.deepEqual(
    resolvePortalTeleport({ ...base, toNodeId: "node-balcony" }, schemes),
    {
        scheme: "node-balcony",
        pose: balconyPose,
        skipOpeningTransition: true,
    },
);

// The destination scene's own pose is used regardless of which portal led
// there — a scheme's canonical landing spot lives on the scheme, not on any
// one portal.
const otherPortal = { ...base, id: "portal-2", name: "back-door", toNodeId: "node-balcony" };
assert.deepEqual(
    resolvePortalTeleport(otherPortal, schemes)?.pose,
    balconyPose,
);

assert.equal(
    resolvePortalTeleport({ ...base, toNodeId: "missing" }, schemes),
    null,
    "a portal targeting a scheme that isn't loaded never resolves",
);
