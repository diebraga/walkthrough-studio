import { Hono } from "hono";
import { health } from "./routes/health.js";

/**
 * Shared, provider-independent API. Every deployment target (Vercel,
 * AWS Lambda, `vite dev`, future adapters) wraps this same app rather
 * than reimplementing routes — see api/, adapters/, tools/api-dev-plugin.ts.
 *
 * Keep this file and everything under routes/ free of provider-specific
 * APIs (no `req`/`res` from Node, no Vercel/AWS SDK types); stick to
 * Hono's Request/Response so new adapters are just a few lines.
 */
export const app = new Hono().basePath("/api");

app.route("/health", health);
