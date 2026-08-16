import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import type {
  CreatePortalInput,
  PortalMutationStore,
  PortalRecord,
  UpdatePortalRadiusInput,
} from "./portals.js";
import { createPortalsRoute } from "./portals.js";

const HALL_ID = "11111111-1111-4111-8111-111111111111";
const BALCONY_ID = "22222222-2222-4222-8222-222222222222";
const PORTAL_ID = "33333333-3333-4333-8333-333333333333";

const createInput: CreatePortalInput = {
  fromNodeId: HALL_ID,
  toNodeId: BALCONY_ID,
  name: "balcony-door",
  position: { x: 1, y: 2, z: 3 },
  yaw: 0.25,
  radius: 0.8,
  spawn: { x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0 },
};

const portal: PortalRecord = {
  id: PORTAL_ID,
  name: createInput.name,
  position: createInput.position,
  yaw: createInput.yaw,
  radius: createInput.radius,
  spawn: createInput.spawn,
  toNodeId: BALCONY_ID,
};

const createCalls: CreatePortalInput[] = [];
const updateCalls: UpdatePortalRadiusInput[] = [];
const deleteCalls: Array<{ id: string; fromNodeId: string }> = [];
const store: PortalMutationStore = {
  async create(input) {
    createCalls.push(input);
    return portal;
  },
  async updateRadius(input) {
    updateCalls.push(input);
    return { ...portal, radius: input.radius };
  },
  async delete(input) {
    deleteCalls.push(input);
  },
};

const disabled = createPortalsRoute(store, () => false);
const disabledResponse = await disabled.request("/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(createInput),
});
assert.equal(disabledResponse.status, 404);
assert.deepEqual(await disabledResponse.json(), { error: "Not found" });
assert.equal(createCalls.length, 0);

const enabled = createPortalsRoute(store, () => true);
const createResponse = await enabled.request("/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(createInput),
});
assert.equal(createResponse.status, 201);
assert.deepEqual(await createResponse.json(), { portal });
assert.deepEqual(createCalls, [createInput]);

const updateResponse = await enabled.request("/", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: PORTAL_ID, fromNodeId: HALL_ID, radius: 1.25 }),
});
assert.equal(updateResponse.status, 200);
assert.deepEqual(updateCalls, [{ id: PORTAL_ID, fromNodeId: HALL_ID, radius: 1.25 }]);
assert.equal((await updateResponse.json()).portal.radius, 1.25);

const deleteResponse = await enabled.request("/", {
  method: "DELETE",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: PORTAL_ID, fromNodeId: HALL_ID }),
});
assert.equal(deleteResponse.status, 200);
assert.deepEqual(deleteCalls, [{ id: PORTAL_ID, fromNodeId: HALL_ID }]);
assert.deepEqual(await deleteResponse.json(), { deletedId: PORTAL_ID });

for (const body of [
  { ...createInput, toNodeId: HALL_ID },
  { ...createInput, radius: Number.NaN },
  { ...createInput, spawn: { ...createInput.spawn, x: "bad" } },
]) {
  const response = await enabled.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 400);
}
assert.equal(createCalls.length, 1, "invalid creates never reach the store");

const malformedResponse = await enabled.request("/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});
assert.equal(malformedResponse.status, 400);

const migration = readFileSync(
  new URL("../../prisma/migrations/20260816183000_unique_portal_name_per_scene/migration.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /CREATE UNIQUE INDEX "Portal_runtime_fromNodeId_name_key"/);
assert.match(migration, /WHERE "sourceKey" LIKE 'runtime:%'/);
