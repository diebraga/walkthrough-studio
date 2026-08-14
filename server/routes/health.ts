import { Hono } from "hono";

// Mounted at /api/health by server/app.ts.
export const health = new Hono();

health.get("/", (c) => c.json({ ok: true }));
