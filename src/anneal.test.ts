import { strict as assert } from "node:assert";
import { ANNEAL_DURATION_MS, easeInOutCubic, openingAnnealProgress } from "./anneal-timing";

assert.equal(easeInOutCubic(-1), 0);
assert.equal(easeInOutCubic(0), 0);
assert.equal(easeInOutCubic(1), 1);
assert.equal(easeInOutCubic(2), 1);
assert.equal(openingAnnealProgress(0), 1);
assert.equal(openingAnnealProgress(ANNEAL_DURATION_MS), 0);
assert.ok(openingAnnealProgress(ANNEAL_DURATION_MS * 0.5) < 0.51);
assert.ok(openingAnnealProgress(ANNEAL_DURATION_MS * 0.5) > 0.49);
