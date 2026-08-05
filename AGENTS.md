# walkthrough-studio — agent index

Walkable 3D Gaussian-splat scenes, rendered with `@manycore/aholo-viewer`.

**This file is an index.** Keep it short and point to the detailed docs rather than
growing it. When you add a document, add a line here.

## Documents

| Doc | Read it when |
|---|---|
| [docs/scene-assets.md](docs/scene-assets.md) | Adding a scene or property, or wondering where an asset lives |
| [docs/collision-pipeline.md](docs/collision-pipeline.md) | Collision is wrong, or a new scan needs collision built |

## Routes

Single-page app; `src/router.ts` maps paths to lazily imported modules.

| Route | Entry | What it is |
|---|---|---|
| `/` | `src/main.ts` | The original studio app |
| `/test` | `src/walk-demo/entry.ts` | Walk demo — the active development target |

Vite serves any root-level `.html` as its own entry, and falls back to
`index.html` for unknown paths, which is what makes `/test` work. A file named
`test.html` would shadow the `/test` route, because static files resolve before
the SPA fallback.

## Layout

```
src/walk-demo/     the walk demo: a near-verbatim copy of the aholojs.dev
                   walk-demo example plus a runtime host and collision
tools/             offline asset pipeline (node, not bundled)
public/<slug>/     scene assets — see docs/scene-assets.md
```

`src/walk-demo/walk-demo.ts` is a **copy of upstream** (aholojs.dev playground,
`?example=walk-demo`). Keep edits few and comment each one, so it stays diffable
against the original.

## Conventions worth knowing before you change anything

- **Y is up** in the walk controller (`velocity.y -= WALK_GRAVITY`). Scans out of
  Brush are y-down (`OpenCV -Y`) — the collision bake reports the rotation needed
  to correct that. Do not assume an axis; measure it.
- **Splats are gitignored** (`public/**/*.ply`). They are 100 MB+, over GitHub's
  hard limit. Only the small derived files are committed.
- **Scene scale is metric.** Eye height, capsule size and collision all assume
  metres.
- `npx tsc -b` and `npx vite build` should both pass before committing.
