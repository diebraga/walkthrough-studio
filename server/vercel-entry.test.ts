import { strict as assert } from "node:assert";
// Regression test for the Vercel export-shape bug: a bare `(req) => Response`
// function (what `handle(app)` from `hono/vercel` produces) hangs in
// production because Vercel's Node runtime doesn't recognize it as a
// Web-Fetch handler — it must be an object/instance exposing `.fetch`. See
// docs/api.md#how-each-provider-reaches-the-app. Deliberately placed outside
// `api/` so Vercel doesn't deploy this file itself as a function.
import vercelEntry from "../api/[[...route]].js";

assert.equal(typeof vercelEntry, "object", "Vercel entry must export an object, not a plain function");
assert.equal(typeof vercelEntry.fetch, "function", "Vercel entry must expose .fetch (Web-Fetch handler shape)");

const response = await vercelEntry.fetch(new Request("http://localhost/api/health"));
assert.equal(response.status, 200);
assert.deepEqual(await response.json(), { ok: true });
