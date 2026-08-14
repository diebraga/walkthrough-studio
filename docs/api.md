# API architecture

Index: [../AGENTS.md](../AGENTS.md).

One Hono app (`server/app.ts`) is the entire API. Every deployment target
wraps it; none of them re-implement routes.

```
server/
  app.ts            shared Hono app, basePath("/api"), routes mounted here
  routes/
    health.ts        GET /api/health -> { ok: true }
    scenes.ts        GET /api/scenes[?place=<slug>] -> scene graph
api/
  [[...route]].ts    Vercel catch-all, exports server/app.ts's Hono app directly
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
CommonJS `require()`, there's no fallback resolution. Vercel transpiles each
traced `.ts` file to a same-named `.js` file and imports between them at
runtime like any other Node ESM code. Drop the extension and the entry point
compiles and type-checks fine, works under `vite dev` (Vite's resolver fills in
extensions itself) and in a bundled AWS Lambda build (esbuild `--bundle`
inlines everything, so there's no import statement left to resolve) — and
then crashes only in the deployed Vercel function with
`ERR_MODULE_NOT_FOUND`, because that's the one place code actually runs
unbundled under Node's own ESM loader.

**Any new relative import inside `server/`, `api/`, or `adapters/` needs
the `.js` extension.** `src/` is unaffected — Vite bundles it, so its
`moduleResolution: "bundler"` extensionless imports stay as they are.
`pnpm check:conventions` parses these directories and rejects unsafe imports;
it runs automatically at the start of every production build.

## Browser routes need Vercel SPA rewrites

Vite's development server falls back to `index.html` for client-side browser
routes, but Vercel only does so when configured explicitly. When adding an
absolute React Router path such as `<Route path="/example">` to `src/App.tsx`,
add the exact matching rewrite to `vercel.json`:

```json
{ "source": "/example", "destination": "/index.html" }
```

Do not add SPA rewrites for `/api/*`; Vercel maps those paths to the
`api/[[...route]].ts` serverless function. `pnpm check:conventions` verifies
browser-route/rewrite parity and fails the build before an incomplete route can
be deployed.

## How each provider reaches the app

- **Vercel**: `api/[[...route]].ts` is Vercel's file-based catch-all for
  everything under `/api`. It does `export default app` — the Hono app
  instance itself, unwrapped. Vercel's Node runtime detects the exported
  object's `.fetch` method (its documented "fetch Web Standard" convention)
  and calls it directly.

  **Do not change this to `handle(app)` from `hono/vercel`.** That wrapper
  produces a plain `(req: Request) => Response` function, which the runtime
  does *not* recognize as a Web-Fetch handler — it silently falls back to
  the legacy Node `(req, res)` calling convention instead. Since nothing
  then calls `res.end()`, every request hangs until it times out. This
  shipped to production once already; see git history around the
  `[[...route]].ts` comment for the incident. Any future change to this
  file's export shape must be verified against a real Vercel deployment
  (`vercel --prod` + `curl`), not just local dev — see the note below.
- **AWS Lambda**: `adapters/aws-lambda.ts` exports `handler`, built with
  `handle(app)` from `hono/aws-lambda`. This is a *different*, correct use
  of `handle()` — the AWS adapter converts Lambda events, not a Vercel
  `Request`, so don't conflate the two. Works behind API Gateway (v1/v2),
  an ALB, or a Lambda Function URL — point whichever one you set up at this
  file's `handler` export. No infra is provisioned here; wiring up API
  Gateway/Function URL is the remaining step when you actually deploy to AWS.
- **`vite dev`**: `tools/api-dev-plugin.ts` is a Vite dev-only middleware
  (same pattern as `tools/portal-write-plugin.ts`) that converts the
  incoming Node request to a `Request`, calls `app.fetch()`, and writes the
  `Response` back. It's `apply: "serve"`, so it's absent from production
  builds — the built frontend only ever calls relative `/api/...` URLs.

  **This does not validate the Vercel export shape.** It calls
  `app.fetch()` directly, bypassing Vercel's own runtime introspection
  entirely — that's exactly the check that missed the `handle(app)` bug
  above. A route working under `pnpm dev` or even `npx vercel dev` proves
  the route logic is correct; it doesn't prove `api/[[...route]].ts`'s
  export shape is what production actually needs. `server/vercel-entry.test.ts`
  guards the export shape itself; a real `vercel --prod` deploy + `curl`
  is still the only way to confirm production end-to-end.

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

## Scene graph endpoint

`GET /api/scenes` reads the imported scene graph from Neon through the shared
Prisma client. It returns places with nodes, asset references, structured
collision data, and directional portals. Asset byte sizes are decimal strings
because JavaScript JSON cannot encode `bigint` values.

`GET /api/scenes?place=<slug>` returns one frontend-ready place graph as
`{ place }`, or `404 { "error": "Place not found" }`. The renderer calls this
once at startup rather than requesting collision, assets, and portals
separately. Both endpoints share the same nested Prisma selection and
serializer.

Use a query parameter rather than a nested Hono path here. Vercel currently
generates `^/api/([^/]+)$` for this project's `api/[[...route]].ts`, so a nested
path such as `/api/scenes/<slug>` is rejected by Vercel before Hono runs.
`pnpm check:conventions` rejects nested handlers in mounted `server/routes/`
modules to prevent a local-only route from shipping again.
