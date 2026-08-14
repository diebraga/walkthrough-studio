# walkthrough-studio — agent index

Walkable 3D Gaussian-splat scenes, rendered with `@manycore/aholo-viewer`.

**This file is an index.** Keep it short and point to the detailed docs rather than
growing it. When you add a document, add a line here.

## Documents

| Doc | Read it when |
|---|---|
| [docs/scene-assets.md](docs/scene-assets.md) | Adding a scene or property, or wondering where an asset lives |
| [docs/collision-pipeline.md](docs/collision-pipeline.md) | Generating floor + wall collision for a scan, or collision is wrong |
| [docs/dev-settings.md](docs/dev-settings.md) | Turning on the collision overlay or portal capture |
| [docs/api.md](docs/api.md) | Adding an API route, or wiring up a new deployment provider |
| [docs/design.md](docs/design.md) | Writing or styling any UI — colors, type, spacing, components |

## Routes

Single-page React app; `src/main.tsx` mounts `src/App.tsx`.

| Route | Entry | What it is |
|---|---|---|
| `/` | `src/App.tsx` → `src/walk-demo/entry.ts` | Walk demo — the active development target |
| `/health` | `src/health/HealthPage.tsx` | Status page, polls `/api/health` |

Vite serves any root-level `.html` as its own entry, and falls back to
`index.html` for unknown paths; React Router handles the in-app route.

## Layout

```
src/walk-demo/     the walk demo: a near-verbatim copy of the aholojs.dev
                   walk-demo example plus a runtime host and collision
src/health/        health/status page (Tailwind + shadcn/ui)
src/components/ui/ shadcn/ui components — add more via `npx shadcn@latest add <name>`
server/            shared Hono API — see docs/api.md
api/               Vercel entry point, delegates to server/
adapters/          thin per-provider handlers (AWS Lambda, ...), delegate to server/
tools/             offline asset pipeline + dev-only Vite plugins (node, not bundled)
public/<slug>/     scene assets — see docs/scene-assets.md
```

`src/walk-demo/walk-demo.ts` is a **copy of upstream** (aholojs.dev playground,
`?example=walk-demo`). Keep edits few and comment each one, so it stays diffable
against the original.

## Temporary by design

Configuration currently lives in files because nothing in `server/` reads or
writes scene data yet. These are stand-ins, and code should not assume they
are permanent — nothing should hard-code a scene, and nothing should depend
on a database either.

| Today | Later |
|---|---|
| `public/<property-slug>/<scene>/` folders | object storage, addressed the same way |
| the property slug | key of a properties table |
| each scene folder | a row in a scenes table |
| `SCENE_HALL` constant in `walk-demo.ts` | the scene record for whatever is being viewed |
| `collision.json` baked by hand | generated automatically on upload, stored as columns on the scene row |
| `portals.json` per scene | portal rows, linking scenes to each other |
| `VITE_DEV_FLAGS` in `.env` | per-user or per-environment settings |

The paths were chosen so the move costs little: a scene is one folder with
everything it needs, which becomes one row with a prefix. See
[docs/scene-assets.md](docs/scene-assets.md).

## Conventions worth knowing before you change anything

- **Y is up** in the walk controller (`velocity.y -= WALK_GRAVITY`). Scans out of
  Brush are y-down (`OpenCV -Y`) — the collision bake reports the rotation needed
  to correct that. Do not assume an axis; measure it.
- **Splats are gitignored** (`public/**/*.ply`). They are 100 MB+, over GitHub's
  hard limit. Only the small derived files are committed.
- **Scene scale is metric.** Eye height, capsule size and collision all assume
  metres.
- **UI follows [docs/design.md](docs/design.md)** (Apple's public site as a design
  reference — colors, type scale, spacing, component shapes) instead of ad-hoc
  choices. It's a starting point to adapt, not a pixel-exact spec to copy.
  Style with **Tailwind** (`src/index.css` maps design.md's tokens to Tailwind
  theme vars/shadcn CSS variables — extend that mapping, don't hardcode hex
  elsewhere). Build UI out of **shadcn/ui** (`src/components/ui/`,
  `components.json`) rather than one-off components; use the **shadcn MCP**
  server (configured in `.mcp.json`) to browse/search components before
  adding one, and `npx shadcn@latest add <name>` to install it.
- **Developer tooling is behind flags**, off by default even in dev, and inert
  in production. Never wire a debug UI in unguarded — see
  [docs/dev-settings.md](docs/dev-settings.md).
- **API routes go in `server/`, not in `api/` or `adapters/`.** Those two are
  thin per-provider translators around the one shared Hono app; a route added
  only under one of them exists for that provider alone. See
  [docs/api.md](docs/api.md).
- **Relative imports in `server/`, `api/`, `adapters/` need a `.js` extension**
  (`"../server/app.js"`, even though the file is `app.ts`) — Vercel's deployed
  function runs unbundled under real Node ESM, which has no extension
  fallback. Omitting it type-checks and works locally, then crashes only in
  production. See [docs/api.md](docs/api.md#relative-imports-need-a-js-extension).
- **Every absolute React Router browser path needs an exact Vercel SPA rewrite.**
  When adding `<Route path="/example">` in `src/App.tsx`, also add
  `{ "source": "/example", "destination": "/index.html" }` to
  `vercel.json`. Vite supplies this history fallback in development; Vercel
  does not. API paths are file-based functions and are not SPA rewrites.
- **`api/[[...route]].ts` must export the Hono app directly** (`export default
  app`), never `handle(app)` from `hono/vercel` — that wrapper hangs every
  request in production (verified against a real deployment; local dev can't
  catch it). `adapters/aws-lambda.ts` intentionally uses `handle(app)` from
  `hono/aws-lambda` instead — a different, correct adapter for a different
  platform, not the same bug. Any change to the Vercel entry's export shape
  needs a real `vercel --prod` deploy + `curl` to confirm, not just `pnpm dev`.
  See [docs/api.md](docs/api.md#how-each-provider-reaches-the-app).
- **Production conventions are executable, not optional.** Run
  `pnpm test:conventions && pnpm build` before committing. The build fails when
  a backend relative import lacks its runtime extension or a browser route
  lacks its exact Vercel SPA rewrite.
