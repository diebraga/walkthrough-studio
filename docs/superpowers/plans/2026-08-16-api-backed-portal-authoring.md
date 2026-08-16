# API-backed Portal Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers create, resize, and delete directional portals in Neon while selecting any other scene in the current place as the destination and reusing that scene's normal selector pose as the arrival pose.

**Architecture:** A gated Hono route at `/api/portals` validates mutations and writes them through an injected Prisma-backed store. A focused frontend API module owns request serialization and destination filtering; `WalkDemoApp` wires those functions into the existing developer-only Tweakpane controls and updates its runtime schemes only after confirmed writes. Existing always-visible floor-circle rendering and teleport activation remain unchanged.

**Tech Stack:** TypeScript, Hono, Prisma 7 with Neon Postgres, Tweakpane, Node test runner through `tsx`, Vite.

## Global Constraints

- Portal creation is directional; never synthesize a reverse portal.
- Destination options contain database scenes in the current place except the active scene.
- Arrival uses the selected destination's `scheme.pose`, matching the top Scene selector.
- Neon is runtime authority; do not write `public/**/portals.json`.
- Authoring UI stays behind `VITE_DEV_FLAGS=portals` and mutations require `PORTAL_AUTHORING_ENABLED=1` server-side.
- Mounted Hono route modules define only handlers at `/`; do not add nested handlers.
- Relative imports in `server/` use explicit `.js` extensions.
- Portal markers remain visible independently of developer flags.
- Run `pnpm test:conventions && pnpm build` before completion.

---

## File map

- Create `server/routes/portals.ts`: validation, Prisma-backed create/update/delete store, serialization, and gated Hono handlers.
- Create `server/routes/portals.test.ts`: route authorization, validation, directionality, and mutation contract tests with an injected store.
- Modify `server/app.ts`: mount the shared `/api/portals` route.
- Create `src/walk-demo/portal-authoring.ts`: destination filtering, portal request functions, response validation, and error normalization.
- Create `src/walk-demo/portal-authoring.test.ts`: pure option filtering and fetch-contract tests.
- Modify `src/walk-demo/portals.ts`: remove JSON persistence helpers and let `createPortal` accept database destination and spawn fields.
- Modify `src/walk-demo/walk-demo.ts`: destination control, confirmed-only mutations, current-scheme synchronization, and scene-change reset.
- Modify `src/walk-demo/portal-activation.test.ts`: integration assertions for destination reset and renderer independence.
- Modify `docs/api.md`, `docs/database.md`, and `docs/dev-settings.md`: document the gated mutation route and database authoring workflow.
- Modify `package.json`: include the portal route test in `test:database`.

---

### Task 1: Gated portal mutation API

**Files:**
- Create: `server/routes/portals.ts`
- Create: `server/routes/portals.test.ts`
- Modify: `server/app.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `createPortalsRoute(store?: PortalMutationStore, authoringEnabled?: () => boolean): Hono`.
- Produces `PortalMutationStore` with `create`, `updateRadius`, and `delete` methods.
- Accepts create JSON `{ fromNodeId, toNodeId, name, position, yaw, radius, spawn }`.
- Accepts patch JSON `{ id, fromNodeId, radius }` and delete JSON `{ id, fromNodeId }`.
- Returns `{ portal }` for create/update and `{ deletedId }` for delete.

- [ ] **Step 1: Write failing authorization and route-contract tests**

Create `server/routes/portals.test.ts` with an in-memory `PortalMutationStore`. Assert that the disabled route returns `404`, an enabled `POST /` passes exactly one directional create payload to the store, `PATCH /` passes the radius update, and `DELETE /` passes only the declared portal/source pair.

```ts
const disabled = createPortalsRoute(store, () => false);
assert.equal((await disabled.request("/", { method: "POST" })).status, 404);

const response = await enabled.request("/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(createInput),
});
assert.equal(response.status, 201);
assert.equal(createCalls.length, 1);
assert.equal(createCalls[0]?.fromNodeId, "hall-id");
assert.equal(createCalls[0]?.toNodeId, "balcony-id");
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `node --import tsx server/routes/portals.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./portals.js`.

- [ ] **Step 3: Implement validation, store, and handlers**

In `server/routes/portals.ts`, define exact DTO types, finite-number guards, non-empty UUID/name validation, and this server gate:

```ts
export function portalAuthoringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORTAL_AUTHORING_ENABLED === "1";
}
```

Implement a Prisma store whose create transaction fetches both nodes, rejects missing nodes, rejects `fromNodeId === toNodeId`, rejects nodes with different `placeId`, and calls `tx.portal.create` once. Generate `sourceKey` as `runtime:${crypto.randomUUID()}`. Do not create a reverse row. Update/delete must use `updateMany`/`deleteMany` constrained by both `id` and `fromNodeId`, returning `404` when count is zero.

Expose only root handlers:

```ts
route.post("/", async (c) => { /* validate, store.create, return 201 */ });
route.patch("/", async (c) => { /* validate, store.updateRadius */ });
route.delete("/", async (c) => { /* validate, store.delete */ });
```

Map known validation errors to `400` or `404`, conflicts to `409`, and unexpected errors to `{ error: "Portal mutation failed" }` with status `500`.

- [ ] **Step 4: Mount the route and add it to database tests**

In `server/app.ts`:

```ts
import { portals } from "./routes/portals.js";
app.route("/portals", portals);
```

Append `node --import tsx server/routes/portals.test.ts` to `test:database` in `package.json`.

- [ ] **Step 5: Run focused and database tests and verify GREEN**

Run: `node --import tsx server/routes/portals.test.ts && pnpm test:database`

Expected: all assertions pass with no database connection because route tests inject the fake store.

- [ ] **Step 6: Commit the API deliverable**

```bash
git add server/routes/portals.ts server/routes/portals.test.ts server/app.ts package.json
git commit -m "feat: add gated portal mutation API"
```

---

### Task 2: Frontend portal-authoring client

**Files:**
- Create: `src/walk-demo/portal-authoring.ts`
- Create: `src/walk-demo/portal-authoring.test.ts`
- Modify: `src/walk-demo/portals.ts`

**Interfaces:**
- Consumes `WalkDemoScheme` and `Portal`.
- Produces `portalDestinationOptions(schemes, activeNodeId): Record<string, string>`.
- Produces `createDatabasePortal(input, fetcher?)`, `updateDatabasePortalRadius(input, fetcher?)`, and `deleteDatabasePortal(input, fetcher?)`.
- Produces a linked `createPortal(name, position, yaw, destination, radius?)` that includes `toNodeId` and `spawn`.

- [ ] **Step 1: Write failing filtering and HTTP tests**

Create `src/walk-demo/portal-authoring.test.ts`. Use Hall, Balcony, and a legacy scheme fixture. Assert Hall is absent when active, Balcony maps to its node ID, legacy schemes are absent, create uses `POST /api/portals`, radius uses `PATCH`, delete uses `DELETE`, non-2xx JSON errors throw their server message, and a successful create returns the serialized portal.

```ts
assert.deepEqual(portalDestinationOptions(schemes, "hall-id"), {
  Balcony: "balcony-id",
});
assert.deepEqual(JSON.parse(requests[0]!.init.body as string).spawn, {
  x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0,
});
```

- [ ] **Step 2: Run the client test and verify RED**

Run: `node --import tsx src/walk-demo/portal-authoring.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./portal-authoring`.

- [ ] **Step 3: Implement the client and linked portal factory**

Implement destination filtering from `Object.values(schemes)`, requiring `source === "database"` and `scheme.id !== activeNodeId`. Add a shared request helper that calls `/api/portals`, parses JSON, and throws `Error(error || HTTP status)` for failure responses.

Replace the old unlinked factory with:

```ts
export function createPortal(
  name: string,
  position: { x: number; y: number; z: number },
  yaw: number,
  destination: { id: string; pose: RuntimeScenePose },
  radius = DEFAULT_RADIUS,
): Portal {
  return {
    name,
    position,
    yaw,
    radius,
    toNodeId: destination.id,
    to: null,
    spawn: {
      x: destination.pose.px,
      y: destination.pose.py,
      z: destination.pose.pz,
      yaw: destination.pose.yaw,
      pitch: destination.pose.pitch,
    },
  };
}
```

Remove `loadPortals` and `savePortals`; runtime loading already comes from the scene graph.

- [ ] **Step 4: Run focused portal tests and verify GREEN**

Run: `node --import tsx src/walk-demo/portal-authoring.test.ts && node --import tsx src/walk-demo/teleport.test.ts`

Expected: all assertions pass.

- [ ] **Step 5: Commit the frontend client**

```bash
git add src/walk-demo/portal-authoring.ts src/walk-demo/portal-authoring.test.ts src/walk-demo/portals.ts
git commit -m "feat: add database portal authoring client"
```

---

### Task 3: Wire destination-aware authoring into the walk demo

**Files:**
- Modify: `src/walk-demo/walk-demo.ts`
- Modify: `src/walk-demo/portal-activation.test.ts`

**Interfaces:**
- Consumes Task 2's destination filtering and mutation functions.
- Maintains `params.portalDestination: string` and a refreshable destination binding.
- Synchronizes `this.portals` and `this.schemes[this.params.scheme].portals` only after successful API responses.

- [ ] **Step 1: Write failing integration assertions**

Extend `portal-activation.test.ts` to assert the source includes a Destination binding whose options come from `portalDestinationOptions(this.schemes, this.params.scheme)`, scene selection clears `portalDestination`, capture rejects an empty destination, capture passes the destination scheme pose, and no code calls `savePortals` or `/__dev/portals`.

Also assert portal creation appends only the returned portal and that delete removes locally only after the awaited API call succeeds.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: FAIL because `portalDestination` and the database mutation calls are absent.

- [ ] **Step 3: Add the destination control and scene reset**

Add `portalDestination` to params, initialize it to `""`, and create the binding in `mountPortalPanel` before the Add button. Rebuild or refresh its options whenever the active scene changes. Clear the selection before `queueReloadScene()` so the current node can never remain selected indirectly.

If only one other scene exists, it may be the initial selected value; if there are no other scenes, keep the value empty and report `no destination scenes available` when Add is pressed.

- [ ] **Step 4: Replace file persistence with confirmed API mutations**

In `capturePortal`, resolve `destination = this.schemes[this.params.portalDestination]`, build the linked draft from walker state and `destination.pose`, await `createDatabasePortal`, then append the returned portal. Do not mutate before awaiting success.

For radius edits, retain the confirmed value, await `updateDatabasePortalRadius`, update both local collections on success, and restore/refresh the confirmed value on failure. For delete, await `deleteDatabasePortal` before filtering the portal from either collection.

Extract one small helper:

```ts
private replaceConfirmedPortals(portals: Portal[]): void {
  this.portals = portals;
  this.schemes[this.params.scheme].portals = portals.map((portal) => ({ ...portal }));
  this.rebuildPortalList();
}
```

Report errors through `params.portalStatus` and keep the renderer update path unchanged so successful mutations appear on the next frame.

- [ ] **Step 5: Run walk-demo tests and verify GREEN**

Run: `node --import tsx src/walk-demo/portal-activation.test.ts && node --import tsx src/walk-demo/portal-renderer.test.ts && node --import tsx src/walk-demo/teleport.test.ts`

Expected: all assertions pass; the renderer test confirms markers default visible and do not depend on authoring flags.

- [ ] **Step 6: Commit the UI integration**

```bash
git add src/walk-demo/walk-demo.ts src/walk-demo/portal-activation.test.ts
git commit -m "feat: author directional portals between scenes"
```

---

### Task 4: Documentation and complete verification

**Files:**
- Modify: `docs/api.md`
- Modify: `docs/database.md`
- Modify: `docs/dev-settings.md`

**Interfaces:**
- Documents `PORTAL_AUTHORING_ENABLED=1` and root-method `/api/portals` requests.
- Replaces claims that current authoring writes `portals.json` or automatically creates reciprocal portals.

- [ ] **Step 1: Update developer and API documentation**

Document that local authoring requires both `VITE_DEV_FLAGS=portals` and `PORTAL_AUTHORING_ENABLED=1`, destinations exclude the active scene, arrivals copy the destination's selector pose, and each direction is authored separately. Add the create/update/delete request shapes and status behavior to `docs/api.md`. Clarify in `docs/database.md` that reciprocal generation applies only to legacy file import, not API-authored rows.

- [ ] **Step 2: Scan for stale runtime-authoring claims**

Run:

```bash
rg -n "__dev/portals|savePortals|writes .*portals.json|generate.*reverse|reciprocal" docs src server
```

Expected: remaining `portals.json` references describe legacy import inputs only; no runtime authoring code uses the dev file endpoint.

- [ ] **Step 3: Run all focused tests**

Run:

```bash
node --import tsx server/routes/portals.test.ts
node --import tsx src/walk-demo/portal-authoring.test.ts
node --import tsx src/walk-demo/portal-activation.test.ts
node --import tsx src/walk-demo/portal-renderer.test.ts
node --import tsx src/walk-demo/teleport.test.ts
pnpm test:database
```

Expected: every command exits `0`.

- [ ] **Step 4: Run required repository verification**

Run: `pnpm test:conventions && pnpm build`

Expected: convention tests, TypeScript project build, and Vite production build all exit `0`.

- [ ] **Step 5: Review the final diff**

Run: `git status --short && git diff --check && git diff HEAD~3 --stat`

Expected: only scoped portal/API/docs changes, no whitespace errors, no credentials or generated database artifacts.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/api.md docs/database.md docs/dev-settings.md
git commit -m "docs: describe database portal authoring"
```
