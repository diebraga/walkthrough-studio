# Database-Backed Scene Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the Nashville scene graph, collision, assets, and portal relationships from Neon through Hono while retaining external `.ply` delivery and the existing renderer.

**Architecture:** Refactor the existing Hono scene route around a shared place-graph query/serializer and add a single-place endpoint. Add a typed frontend catalog adapter that validates the response and converts database nodes into the renderer's existing scene configuration, then inject that catalog into the walk demo and resolve portal navigation by node UUID.

**Tech Stack:** TypeScript 5, React 19, Vite 7, Hono 4, Prisma 7, Neon Postgres, Node test runner, `@manycore/aholo-viewer`, Vercel.

## Global Constraints

- Neon/Postgres is canonical for migrated scene metadata; do not silently fall back to static metadata.
- Prisma remains server-only and is accessed through the shared `server/db.ts` client.
- All backend relative imports retain explicit `.js` extensions.
- `.ply` binaries remain external/static and never enter Postgres or the Hono response body.
- Preserve the current renderer, developer-only authoring tools, source files under `public/`, and the non-migrated outdoor scheme.
- Portal runtime navigation resolves destinations with immutable node IDs.
- Follow red-green-refactor for every behavior change.

---

### Task 1: Runtime Place API

**Files:**
- Modify: `server/routes/scenes.ts`
- Modify: `server/routes/scenes.test.ts`

**Interfaces:**
- Produces: `readPlaceSceneGraph(slug: string): Promise<SceneGraphPlace | null>`
- Produces: `GET /api/scenes?place=<slug>` returning `{ place: SerializedSceneGraphPlace }` or `{ error: "Place not found" }`
- Retains: `GET /api/scenes` returning `{ places: SerializedSceneGraphPlace[] }`

- [ ] **Step 1: Write failing API tests**

Add reader injection that can serve both list and slug lookups. Assert the place endpoint returns one serialized graph with BigInt sizes converted to strings, and assert an unknown slug returns status `404` with `{ error: "Place not found" }`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx server/routes/scenes.test.ts`

Expected: failure because the slug route/reader does not exist.

- [ ] **Step 3: Implement the shared query and serializer**

Extract the nested Prisma selection and serialization into shared functions. Query a place with `findUnique({ where: { slug }, select: sceneGraphSelect })`; preserve the existing list query and response shape. Select one place when the root handler receives `?place=<slug>` and return the explicit `404` body. Nested Hono paths are forbidden because Vercel rejects them before invoking this function.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --import tsx server/routes/scenes.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add server/routes/scenes.ts server/routes/scenes.test.ts
git commit -m "feat: add place scene graph endpoint"
```

### Task 2: Typed Frontend Scene Catalog

**Files:**
- Create: `src/walk-demo/scene-catalog.ts`
- Create: `src/walk-demo/scene-catalog.test.ts`
- Modify: `src/walk-demo/asset-url.ts`
- Modify: `src/walk-demo/asset-url.test.ts`

**Interfaces:**
- Produces: `fetchSceneCatalog(placeSlug: string, options?): Promise<SceneCatalog>`
- Produces: `SceneCatalog` with `place`, `initialNodeId`, `nodes`, `nodeById`, and `nodeBySlug`
- Produces: `RuntimeSceneNode` with `id`, `slug`, `name`, `splatUrl`, `collisionData`, `manualCollision`, `portals`, `assetBase`, and `pose`
- Produces: `resolveSceneAssetUrl(asset, splatBaseUrl): string`

- [ ] **Step 1: Write failing catalog and URL tests**

Use a small hall/balcony API fixture. Assert collision remains an object, `public/.../index.ply` becomes the correct relative or Blob URL, manual collision comes from the `MANUAL_COLLISION` asset metadata, the hall portal retains `toNodeId` and exact spawn values, hall is selected initially, malformed collision/missing splat/missing node throw descriptive errors, and a failed HTTP response includes its status.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --import tsx src/walk-demo/scene-catalog.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement validation and adaptation**

Define minimal API DTO guards rather than importing server types. Validate the requested place and every node required by the catalog, select `GAUSSIAN_SPLAT`, convert paths without assuming that every future object is under `public/`, parse `MANUAL_COLLISION` metadata through the existing manual-collision shape, and retain portal node UUIDs. Keep the Nashville initial pose defaults in one map keyed by node slug; choose `hall` first when present and otherwise the first node.

- [ ] **Step 4: Run catalog and URL tests and verify GREEN**

Run: `node --import tsx src/walk-demo/scene-catalog.test.ts && node --import tsx src/walk-demo/asset-url.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/walk-demo/scene-catalog.ts src/walk-demo/scene-catalog.test.ts src/walk-demo/asset-url.ts src/walk-demo/asset-url.test.ts
git commit -m "feat: adapt database scene graph for renderer"
```

### Task 3: Database-Driven Renderer and ID-Based Portals

**Files:**
- Modify: `src/walk-demo/entry.ts`
- Modify: `src/walk-demo/walk-demo.ts`
- Modify: `src/walk-demo/portals.ts`
- Modify: `src/walk-demo/teleport.ts`
- Modify: `src/walk-demo/teleport.test.ts`
- Create: `src/walk-demo/runtime-scene.test.ts`

**Interfaces:**
- Changes: `runner(ctx, catalog): Promise<() => void>`
- Changes: `resolvePortalTeleport(portal, nodesById)` returns destination node ID plus the existing `TeleportPose`
- Consumes: in-memory `collisionData`, `manualCollision`, and `portals` from `RuntimeSceneNode`

- [ ] **Step 1: Write failing teleport and renderer-boundary tests**

Assert a portal with a valid `toNodeId` resolves to that node and exact spawn pose, while an unknown ID returns `null`. Assert the renderer scene conversion exposes database collision/portals and does not produce `collisionGrid` or portal JSON URLs.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --import tsx src/walk-demo/teleport.test.ts && node --import tsx src/walk-demo/runtime-scene.test.ts`

Expected: failure because teleport still uses `portal.to` and runtime schemes are static.

- [ ] **Step 3: Inject the catalog into startup and renderer**

Fetch `/api/scenes?place=23_nashville_dr_tenessee` in `entry.ts` before calling `runner`. Build runtime schemes from catalog nodes and append the isolated outdoor legacy scheme. Replace fixed union keys with string node IDs, render database node names in the control panel, select hall initially, and preserve node poses through the existing pose persistence.

- [ ] **Step 4: Use database metadata in reload**

For database schemes, call `walk.loadCollisionGrid(scheme.collisionData)` and apply its rotation directly. Assign manual collision and portals from the descriptor. Retain URL fetches only for the legacy outdoor collision pair. Preserve `assetBase` solely for dev-only save actions.

- [ ] **Step 5: Resolve portal transitions by UUID**

Add `toNodeId` to the frontend portal type, update database portal adaptation, and resolve destinations against the runtime scheme map by UUID. Log and ignore invalid destinations without reloading. Preserve the existing fade and exact spawn pose.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --import tsx src/walk-demo/teleport.test.ts && node --import tsx src/walk-demo/runtime-scene.test.ts && node --import tsx src/walk-demo/scene-catalog.test.ts`

Expected: pass.

- [ ] **Step 7: Commit**

```sh
git add src/walk-demo/entry.ts src/walk-demo/walk-demo.ts src/walk-demo/portals.ts src/walk-demo/teleport.ts src/walk-demo/teleport.test.ts src/walk-demo/runtime-scene.test.ts
git commit -m "feat: load renderer scenes from Neon graph"
```

### Task 4: Documentation and Local End-to-End Validation

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/api.md`
- Modify: `docs/database.md`
- Modify: `docs/scene-assets.md`

**Interfaces:**
- Documents: canonical metadata path `Neon -> Prisma -> Hono -> scene catalog -> renderer`
- Documents: external asset path `SceneAsset reference -> public/Blob -> renderer`

- [ ] **Step 1: Update focused documentation**

Replace statements that folders are the source of truth. State that collision and portals are runtime database data, source JSON remains import/authoring input, splats remain external, and new runtime code must not derive graph relationships from folders.

- [ ] **Step 2: Run all automated verification**

Run:

```sh
pnpm db:validate
pnpm db:generate
node --import tsx --test src/**/*.test.ts server/**/*.test.ts adapters/*.test.ts tools/**/*.test.ts
pnpm test:conventions
npx tsc -b
pnpm build
npx vercel build --prod --yes
```

Expected: all tests and builds pass; only the existing large Vite chunk warning is acceptable.

- [ ] **Step 3: Run and inspect the local app**

Start `pnpm dev`, call the successful and missing-place APIs, and use browser automation to confirm Nashville hall and balcony are offered, `.ply` requests use static/Blob URLs, no `collision.json` or `portals.json` runtime requests occur, and the hall portal reloads balcony at the imported pose. Record browser console/network failures.

- [ ] **Step 4: Commit**

```sh
git add AGENTS.md docs/api.md docs/database.md docs/scene-assets.md
git commit -m "docs: make Neon canonical for scene metadata"
```

### Task 5: Production Deployment and Verification

**Files:**
- No expected source changes unless production evidence reveals a defect.

**Interfaces:**
- Verifies: `https://walkthrough-studio-kohl.vercel.app/api/scenes?place=23_nashville_dr_tenessee`
- Verifies: deployed `/` renderer and hall-to-balcony transition

- [ ] **Step 1: Push the verified commit**

Push `main` using the repository's current Vercel/GitHub workflow and wait for the exact commit deployment to become Ready.

- [ ] **Step 2: Verify production API**

Call the successful place endpoint and an unknown-place endpoint. Assert status `200`/`404`, structured collision objects, external splat references, and hall portal `toNodeId` resolving to balcony.

- [ ] **Step 3: Verify the deployed renderer**

Use browser/network inspection against the production alias. Confirm the metadata endpoint, hall and balcony splat requests, absence of static collision/portal metadata requests, and successful portal destination/spawn behavior.

- [ ] **Step 4: Inspect production logs**

Correlate the HTTP/browser requests with Vercel build and runtime logs. If any failure occurs, diagnose, add a failing regression test, make the minimum fix, rebuild, redeploy, and repeat.

- [ ] **Step 5: Record exact deployment evidence**

Capture the Git commit, Vercel deployment ID/URL, final statuses and response summaries, runtime log cleanliness, and final working-tree state for the final report.
