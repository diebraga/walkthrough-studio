import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { app } from "../server/app.js";

/**
 * Dev-only bridge: routes /api/* through the same Hono app used by the
 * Vercel and AWS Lambda adapters, so `fetch("/api/...")` works under
 * `vite dev` with no provider-specific tooling. For the exact Vercel
 * runtime instead, use `vercel dev` (see docs/api.md).
 */
export function apiDevPlugin(): Plugin {
  return {
    name: "walkthrough-api-dev",
    apply: "serve",
    configureServer(server) {
      // Manual prefix check, not `use("/api", ...)`: connect strips the
      // matched prefix from req.url, which would hide it from the app's
      // basePath("/api") routes.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        const response = await app.fetch(await toWebRequest(req));
        await sendWebResponse(res, response);
      });
    },
  };
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const chunks: Buffer[] = [];
  if (hasBody) for await (const chunk of req) chunks.push(chunk as Buffer);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return new Request(new URL(req.url ?? "/", `http://${req.headers.host}`), {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
