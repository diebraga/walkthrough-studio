# Portal Landing Spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a confirmed “Set respawn here” save control the exact landing pose on the next traversal through that directional portal, with visible success and error feedback.

**Architecture:** Keep Neon as the authority and treat the PATCH response as the commit boundary. Extract the save-state formatting and confirmed-pose update behavior into testable portal-authoring helpers, while the walk app owns pose capture and scene reload. Portal traversal continues to resolve a `TeleportPose`, and reload must apply it after collision initialization without falling back to the destination default.

**Tech Stack:** TypeScript, Hono, Prisma/Neon, Node test/assert scripts, Vite, Tweakpane.

## Global Constraints

- Preserve all existing uncommitted work and avoid unrelated refactors.
- Runtime portal metadata remains sourced from Neon through Hono.
- Portal authoring remains gated by `VITE_DEV_FLAGS=portals` and `PORTAL_AUTHORING_ENABLED=1`.
- API handlers remain mounted at `/api/portals` with no nested Hono route.
- Backend relative imports retain `.js` extensions.
- A failed save must not mutate the last confirmed portal spawn.
- Run `pnpm test:conventions && pnpm build` before completion.

## File map

- `src/walk-demo/portal-authoring.ts`: request/commit helpers and deterministic landing-save status text.
- `src/walk-demo/portal-authoring.test.ts`: client request, confirmed mutation, failure preservation, and status regression coverage.
- `src/walk-demo/teleport.ts`: conversion from the confirmed portal spawn to reload options.
- `src/walk-demo/teleport.test.ts`: exact Hall-to-Balcony pose regression.
- `src/walk-demo/walk-demo.ts`: Tweakpane button state, pose capture, confirmed commit, and reload lifecycle.
- `src/walk-demo/portal-activation.test.ts`: structural checks that portal reload applies the explicit pose after collision setup.
- `server/routes/portals.ts`: PATCH validation and persisted spawn update.
- `server/routes/portals.test.ts`: backend routing, validation, and returned-spawn coverage.
- `docs/dev-settings.md`: author-facing save/error behavior.

---

### Task 1: Confirmed landing-save client contract

**Files:**
- Modify: `src/walk-demo/portal-authoring.test.ts`
- Modify: `src/walk-demo/portal-authoring.ts`

**Interfaces:**
- Consumes: `Portal`, `WalkDemoScheme`, `fetch`.
- Produces: `updateDatabasePortalSpawn(input, fetcher): Promise<Portal>`, `commitUpdatedPortal(...)`, and `formatPortalSpawnStatus(sourceName, portalName, spawn): string`.

- [ ] **Step 1: Write the failing tests**

Add assertions that the mocked PATCH response returns `spawn: newSpawn`, that `commitUpdatedPortal(schemes, 'hall-id', 'balcony-id', updated)` changes only `schemes['hall-id'].portals`, and that rejection leaves the previous portal unchanged. Add:

```ts
assert.equal(
    formatPortalSpawnStatus('Hall', 'portal_1', newSpawn),
    'saved Hall / portal_1 → (5.00, 0.00, -2.00)',
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --import tsx src/walk-demo/portal-authoring.test.ts`

Expected: FAIL because the response fixture does not return the requested spawn and `formatPortalSpawnStatus` is not exported.

- [ ] **Step 3: Implement the minimal client behavior**

Make the PATCH fixture echo `JSON.parse(init.body).spawn`, retain the existing server-confirmed `commitUpdatedPortal`, and add:

```ts
export function formatPortalSpawnStatus(
    sourceName: string,
    portalName: string,
    spawn: NonNullable<Portal['spawn']>,
): string {
    const point = [spawn.x, spawn.y, spawn.z].map((value) => value.toFixed(2)).join(', ');
    return `saved ${sourceName} / ${portalName} → (${point})`;
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --import tsx src/walk-demo/portal-authoring.test.ts`

Expected: exit 0 with no assertion output.

### Task 2: Visible transactional authoring state

**Files:**
- Modify: `src/walk-demo/portal-activation.test.ts`
- Modify: `src/walk-demo/walk-demo.ts`
- Modify: `docs/dev-settings.md`

**Interfaces:**
- Consumes: `walk.getPose()`, `updateDatabasePortalSpawn`, `commitUpdatedPortal`, `formatPortalSpawnStatus`.
- Produces: panel status transitions `saving …` → confirmed coordinates or `save failed <source> / <portal>: <error>`.

- [ ] **Step 1: Write failing structural assertions**

Require `updatePortalSpawn` to reject missing walk/portal identity visibly, set a `saving ${source.name} / ${portal.name}...` message before enqueueing, and set the success message only with `formatPortalSpawnStatus(..., updated.spawn)`. Require the catch path to include source and portal names.

```ts
assert.match(source, /this\.params\.portalStatus = `saving \$\{source\.name\} \/ \$\{portal\.name\}\.\.\.`/);
assert.match(source, /formatPortalSpawnStatus\(source\.name, portal\.name, updated\.spawn\)/);
assert.match(source, /save failed \$\{source\.name\} \/ \$\{portal\.name\}/);
```

- [ ] **Step 2: Run the structural test and verify RED**

Run: `node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: FAIL because the current code shows only a generic timestamp/error and silently returns when no walk exists.

- [ ] **Step 3: Implement status and confirmed commit flow**

Resolve `source = this.schemes[sourceNodeId]` before capture. On missing walk, source, portal ID, destination, or destination/current-scene mismatch, set a portal-specific failure message. Before queueing, set `saving …`. In the queued request, commit only `updated`, then set:

```ts
this.params.portalStatus = formatPortalSpawnStatus(source.name, portal.name, updated.spawn!);
```

In `catch`, preserve the confirmed portal and set:

```ts
this.params.portalStatus = `save failed ${source.name} / ${portal.name}: ${message}`;
```

Document the saving, coordinate success, and persistent error states in `docs/dev-settings.md`.

- [ ] **Step 4: Run focused client tests and verify GREEN**

Run: `node --import tsx src/walk-demo/portal-authoring.test.ts && node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: exit 0 with no assertion output.

### Task 3: Exact portal pose survives scene reload

**Files:**
- Modify: `src/walk-demo/teleport.test.ts`
- Modify: `src/walk-demo/portal-activation.test.ts`
- Modify: `src/walk-demo/walk-demo.ts` only if the regression exposes an overwrite.

**Interfaces:**
- Consumes: a confirmed `Portal.spawn` and `resolvePortalTeleport`.
- Produces: reload options `{ scheme, pose, skipOpeningTransition: true }` whose pose is applied after collision setup.

- [ ] **Step 1: Write the Hall-to-Balcony regression**

Use a Balcony default of `(9.14, 0.17, 3.09)` and a confirmed spawn of `(5, 0, -2)`; assert the resolved target equals the confirmed spawn. In the structural test, extract `reloadScene` and assert the explicit-pose `startAtPose(..., { snapToGround: false })` occurs after `await this.tryLoadCollision(...)`, while the default-pose call remains guarded by `if (!options.pose)`.

- [ ] **Step 2: Run regressions and verify their state**

Run: `node --import tsx src/walk-demo/teleport.test.ts && node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: the exact-pose test passes if the resolver is already correct; the lifecycle assertion must fail if any default-pose overwrite remains. Record which assertion is RED before editing production code.

- [ ] **Step 3: Make the minimal reload correction if required**

Keep the initial placement guarded:

```ts
if (!options.pose) {
    walk.startAtPose(new Vector3(p.px, p.py, p.pz), p.yaw, p.pitch);
}
```

After `tryLoadCollision` and `walk.setManualCollision`, apply portal arrivals exactly once:

```ts
if (options.pose) {
    walk.startAtPose(new Vector3(p.px, p.py, p.pz), p.yaw, p.pitch, { snapToGround: false });
    walk.update(0);
    scene.updateCamera(walk.getCameraState());
    this.ctx.renderer.render();
}
```

- [ ] **Step 4: Run focused traversal tests and verify GREEN**

Run: `node --import tsx src/walk-demo/teleport.test.ts && node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: exit 0; the explicit pose differs from and wins over the Balcony default.

### Task 4: Backend spawn update contract

**Files:**
- Modify: `server/routes/portals.test.ts`
- Modify: `server/routes/portals.ts`

**Interfaces:**
- Consumes: PATCH `{ id: string; fromNodeId: string; spawn: PortalPose }`.
- Produces: `{ portal: PortalRecord }` read back after the scoped database update.

- [ ] **Step 1: Add failing validation tests**

Assert a finite spawn reaches `store.updateSpawn`, an invalid `spawn.x` returns 400 without a store call, and a request containing both `spawn` and `radius` returns 400 rather than ambiguously selecting one mutation.

- [ ] **Step 2: Run the backend test and verify RED**

Run: `node --import tsx server/routes/portals.test.ts`

Expected: FAIL because the current parser accepts a body containing both mutation shapes.

- [ ] **Step 3: Make PATCH mutation shape exclusive**

In `parseUpdate`, derive `hasSpawn` and `hasRadius`; reject unless exactly one is true:

```ts
if (hasSpawn === hasRadius) {
  throw new PortalRequestError('provide exactly one of spawn or radius', 400);
}
```

Keep the scoped `updateMany({ where: { id, fromNodeId } })`, read back by ID, and return `serializePortal(portal)`.

- [ ] **Step 4: Run backend tests and verify GREEN**

Run: `node --import tsx server/routes/portals.test.ts && pnpm test:database`

Expected: exit 0 with all route and database tests passing.

### Task 5: Full verification

**Files:**
- Verify all modified files from Tasks 1–4.

**Interfaces:**
- Consumes: completed client, traversal, reload, and backend changes.
- Produces: repository-level evidence that the fix is safe to hand off.

- [ ] **Step 1: Run all focused regressions**

Run:

```bash
node --import tsx src/walk-demo/portal-authoring.test.ts
node --import tsx src/walk-demo/teleport.test.ts
node --import tsx src/walk-demo/portal-activation.test.ts
node --import tsx server/routes/portals.test.ts
```

Expected: every command exits 0.

- [ ] **Step 2: Run required repository verification**

Run: `pnpm test:conventions && pnpm build`

Expected: both commands exit 0 with no convention, TypeScript, or Vite build errors.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check && git status --short && git diff -- src/walk-demo/portal-authoring.ts src/walk-demo/portal-authoring.test.ts src/walk-demo/teleport.ts src/walk-demo/teleport.test.ts src/walk-demo/portal-activation.test.ts src/walk-demo/walk-demo.ts server/routes/portals.ts server/routes/portals.test.ts docs/dev-settings.md`

Expected: no whitespace errors; only scoped portal changes plus the pre-existing user changes are present.
