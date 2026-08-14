import { strict as assert } from "node:assert";
import { handler } from "./aws-lambda.js";

assert.equal(typeof handler, "function", "AWS Lambda adapter must export a callable handler");

// Synthetic API Gateway v2 (HTTP API) event.
const event = {
  version: "2.0",
  routeKey: "GET /api/health",
  rawPath: "/api/health",
  rawQueryString: "",
  headers: { host: "example.com" },
  requestContext: { http: { method: "GET", path: "/api/health" } },
  isBase64Encoded: false,
};

const result = (await handler(event as never, {} as never, undefined as never)) as {
  statusCode: number;
  body: string;
};

assert.equal(result.statusCode, 200);
assert.deepEqual(JSON.parse(result.body), { ok: true });
