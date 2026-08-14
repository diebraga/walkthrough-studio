# API architecture

Index: [../AGENTS.md](../AGENTS.md).

One Hono app (`server/app.ts`) is the entire API. Every deployment target
wraps it; none of them re-implement routes.

```
server/
  app.ts            shared Hono app, basePath("/api"), routes mounted here
  routes/
    health.ts        GET /api/health -> { ok: true }
api/
  [[...route]].ts    Vercel catch-all, delegates to server/app.ts via hono/vercel
adapters/
  aws-lambda.ts       thin Lambda handler around server/app.ts via hono/aws-lambda
tools/
  api-dev-plugin.ts   dev-only: routes /api/* through server/app.ts under `vite dev`
```

**Add new routes under `server/routes/` and mount them in `server/app.ts`.**
Never add a route only under `api/` or `adapters/` — those two exist purely
to translate one platform's request/response shape into the Web-standard
`Request`/`Response` Hono uses, and are meant to stay a few lines each.
Keep `server/` itself free of provider APIs (no Node `req`/`res`, no AWS/Vercel
SDK types) so it stays portable.

## Relative imports need a `.js` extension

`server/`, `api/`, and `adapters/` all use explicit extensions on relative
imports, e.g. `import { app } from "../server/app.js"`, even though the
file on disk is `app.ts`. `tsconfig.json` resolves that fine (`bundler`
mode supports the `.js`-for-`.ts` convention), and it's what Vite already
does.

This isn't stylistic. `package.json` has `"type": "module"`, so anything
that runs under real Node ESM — Vercel's production function — requires
the exact, extension-complete specifier for a relative import; unlike
CommonJS `require()`, there's no fallback resolution. Vercel builds this
project's API with no `vercel.json`, so it has no bundler config telling
it to bundle the function into one file: it transpiles each traced `.ts`
file to a same-named `.js` file and imports between them at runtime like
any other Node ESM code. Drop the extension and the entry point compiles
and type-checks fine, works under `vite dev` (Vite's resolver fills in
extensions itself) and in a bundled AWS Lambda build (esbuild `--bundle`
inlines everything, so there's no import statement left to resolve) — and
then crashes only in the deployed Vercel function with
`ERR_MODULE_NOT_FOUND`, because that's the one place code actually runs
unbundled under Node's own ESM loader.

**Any new relative import inside `server/`, `api/`, or `adapters/` needs
the `.js` extension.** `src/` is unaffected — Vite bundles it, so its
`moduleResolution: "bundler"` extensionless imports stay as they are.

## How each provider reaches the app

- **Vercel**: `api/[[...route]].ts` is Vercel's file-based catch-all for
  everything under `/api`. It calls `handle(app)` from `hono/vercel`, which
  is just `(req: Request) => Response`, Vercel's Node runtime supports that
  signature directly, no `@vercel/node` types needed.
- **AWS Lambda**: `adapters/aws-lambda.ts` exports `handler`, built with
  `handle(app)` from `hono/aws-lambda`. Works behind API Gateway (v1/v2),
  an ALB, or a Lambda Function URL — point whichever one you set up at this
  file's `handler` export. No infra is provisioned here; wiring up API
  Gateway/Function URL is the remaining step when you actually deploy to AWS.
- **`vite dev`**: `tools/api-dev-plugin.ts` is a Vite dev-only middleware
  (same pattern as `tools/portal-write-plugin.ts`) that converts the
  incoming Node request to a `Request`, calls `app.fetch()`, and writes the
  `Response` back. It's `apply: "serve"`, so it's absent from production
  builds — the built frontend only ever calls relative `/api/...` URLs.

## Adding a provider later (Azure, Cloudflare Workers, Node/Bun, ...)

Add one file under `adapters/` (or `api/` if the platform needs a specific
location) that converts that platform's request into a call to
`app.fetch()`. Cloudflare Workers and Bun can call `app.fetch` almost
directly since both speak Web-standard `Request`/`Response` already.

## Local development

```
pnpm dev              # Vite + /api/* via tools/api-dev-plugin.ts
curl localhost:5173/api/health
```

For the exact Vercel runtime (env vars, edge/node routing, etc.):

```
npx vercel dev
```

There's no local Lambda emulation script here — the handler is plain code,
`import { handler } from "./adapters/aws-lambda"` and call it with a
synthetic API Gateway event if you need to sanity-check it outside a real
deploy.

## Health endpoint

`GET /api/health` → `{ "ok": true }`. Exists to prove the wiring, not as a
real feature — don't build on it.
