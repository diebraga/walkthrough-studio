import { strict as assert } from "node:assert";
import { createDatabaseClient, requireDatabaseUrl } from "./db.js";

assert.throws(
  () => requireDatabaseUrl({}),
  /DATABASE_URL is required to access the scene database/,
);
assert.equal(
  requireDatabaseUrl({ DATABASE_URL: "postgresql://example.invalid/database" }),
  "postgresql://example.invalid/database",
);

const client = createDatabaseClient("postgresql://example.invalid/database");
assert.equal(typeof client.place.findMany, "function");
await client.$disconnect();
