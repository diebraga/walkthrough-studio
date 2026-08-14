import { app } from "../server/app.js";

// Vercel's catch-all convention routes every /api/* request here.
// Vercel's Node.js runtime detects the exported Hono app's `.fetch` method
// and calls it directly (Hono's current zero-config Vercel pattern) — no
// hono/vercel `handle()` wrapper needed. That wrapper produces a plain
// `(req) => Response` function, which the runtime doesn't recognize as a
// Web-Fetch handler; it falls back to the legacy `(req, res)` signature,
// the function returns without ever calling `res.end()`, and the request
// hangs until it times out. All logic lives in the shared app — this file
// only wires it up.
export default app;
