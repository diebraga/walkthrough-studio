import { strict as assert } from "node:assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabaseClient, loadDatabaseEnvironment, requireDatabaseUrl } from "./db.js";

assert.throws(
  () => requireDatabaseUrl({}),
  /DATABASE_URL is required to access the scene database/,
);
assert.equal(
  requireDatabaseUrl({ DATABASE_URL: "postgresql://example.invalid/database" }),
  "postgresql://example.invalid/database",
);

const environmentDirectory = await mkdtemp(path.join(tmpdir(), "database-env-"));
const environmentFile = path.join(environmentDirectory, ".env.local");
await writeFile(environmentFile, "WALKTHROUGH_DATABASE_TEST=value-from-file\n");
delete process.env.WALKTHROUGH_DATABASE_TEST;
loadDatabaseEnvironment(environmentFile);
assert.equal(process.env.WALKTHROUGH_DATABASE_TEST, "value-from-file");
delete process.env.WALKTHROUGH_DATABASE_TEST;

const client = createDatabaseClient("postgresql://example.invalid/database");
assert.equal(typeof client.place.findMany, "function");
await client.$disconnect();
