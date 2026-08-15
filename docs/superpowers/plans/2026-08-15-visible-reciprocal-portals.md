# Visible Reciprocal Portals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render portals as large, depth-independent runtime landmarks and complete every linked portal with a safe return direction that cannot immediately ping-pong between scenes.

**Architecture:** Separate portal presentation from collision debug rendering, complete missing reverse directions in the import plan before Prisma persistence, and add a small traversal gate that remains disarmed from teleport until the walker exits all destination portal radii. Neon continues serving the complete directional graph without runtime synthesis.

**Tech Stack:** TypeScript, `@manycore/aholo-viewer`, Node.js test runner, Prisma 7, Neon Postgres, Vite

## Global Constraints

- Portal visuals are always enabled in development and production; only capture/edit controls remain developer-gated.
- Beam height is exactly `2.4` metres and ground-glow radius exactly `1.7` metres.
- Portal material is additive and double-sided, with `depthTest: false`, `depthWrite: false`, and explicit high render order.
- Preserve blue normal and yellow active colours plus subtle rotation.
- The `Portal` schema remains directional; no Prisma schema migration.
- Explicit reverse portals suppress generated defaults.
- Generated reverse keys are deterministic and idempotent.
- Arrival traversal stays disarmed until the walker is outside every portal radius.
- Neon remains canonical; the browser never invents reverse portal records.
- Preserve the unrelated `.mcp.json` modification.

---

### Task 1: Extract and enlarge the runtime portal renderer

**Files:**
- Create: `src/walk-demo/portal-renderer.ts`
- Create: `src/walk-demo/portal-renderer.test.ts`
- Modify: `src/walk-demo/collision-debug.ts`

**Interfaces:**
- Produces: `PortalRenderer` with `update(portals, activeName, floorY)`, `tick(dt)`, and `dispose()`.
- Produces: exported `PORTAL_VISUAL` constants and `buildPortalMarker(radius, colorHex)` geometry data for direct tests.

- [ ] **Step 1: Write failing visual-contract tests**

Assert `PORTAL_VISUAL` contains:

```ts
assert.deepEqual(PORTAL_VISUAL, {
  beamHeight: 2.4,
  beamWidth: 0.22,
  glowRadius: 1.7,
  floorOffset: 0.12,
  spinSpeed: 0.6,
  renderOrder: 10_000,
});
```

Build a marker and assert its radial extent is `1.7`, maximum Y is `2.4`, and minimum Y is `0`. Assert the material options exported/used by `PortalRenderer` include additive blending, double-sided rendering, transparency, `depthTest: false`, and `depthWrite: false`.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --import tsx src/walk-demo/portal-renderer.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused renderer**

Move portal-only geometry, colours, meshes, keying, spin, and disposal from `CollisionDebugOverlay` into `portal-renderer.ts`. Set each mesh to:

```ts
mesh.position = new Vector3(portal.position.x, floorY + PORTAL_VISUAL.floorOffset, portal.position.z);
mesh.renderOrder = PORTAL_VISUAL.renderOrder;
```

Create its `MeshBasicMaterial` with:

```ts
{
  enableVertexColor: true,
  transparent: true,
  blending: Blending.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
  side: Side.DoubleSide,
}
```

Remove portal state and methods from `CollisionDebugOverlay`; leave manual collision rendering unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `node --import tsx src/walk-demo/portal-renderer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/walk-demo/portal-renderer.ts src/walk-demo/portal-renderer.test.ts src/walk-demo/collision-debug.ts
git commit -m "feat: add always-visible portal renderer"
```

---

### Task 2: Make portal presentation unconditional

**Files:**
- Modify: `src/walk-demo/walk-demo.ts`
- Create: `src/walk-demo/dev-settings.test.ts`
- Modify: `docs/dev-settings.md`

**Interfaces:**
- Consumes: `PortalRenderer` from Task 1.
- Produces: one renderer per loaded scene, updated every frame regardless of developer flags.

- [ ] **Step 1: Write a failing runtime-source assertion**

Add a focused source-level convention test asserting that portal renderer construction and update are outside `devEnabled('portals')`, and that the developer panel no longer owns a `Show portals` binding. Keep the test narrow to the portal initialization/update snippets.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx src/walk-demo/dev-settings.test.ts`

Expected: FAIL while rendering remains tied to `showPortals` state.

- [ ] **Step 3: Wire unconditional lifecycle**

Add `private portalRenderer` to the application. Construct it after each scene loads, call `update` with current portals/floor height from the frame loop, call `tick`, and dispose it during scene reload/application disposal. Remove `showPortals` from params, local-storage toggle reads/writes, and the portal developer panel. Keep the panel's capture, name, status, radius, and deletion controls gated by `devEnabled('portals')`.

- [ ] **Step 4: Update developer documentation**

State that portal landmarks are always shown to visitors and the `portals` flag enables only authoring controls.

- [ ] **Step 5: Verify and commit**

Run:

```bash
node --import tsx src/walk-demo/dev-settings.test.ts
node --import tsx src/walk-demo/portal-renderer.test.ts
pnpm build
```

Expected: all exit zero.

```bash
git add src/walk-demo/walk-demo.ts src/walk-demo/dev-settings.test.ts docs/dev-settings.md
git commit -m "feat: show portals outside developer mode"
```

---

### Task 3: Complete missing reverse directions in the import plan

**Files:**
- Create: `tools/scene-import/reciprocal-portals.ts`
- Create: `tools/scene-import/reciprocal-portals.test.ts`
- Modify: `tools/scene-import/discover.ts`

**Interfaces:**
- Consumes: `PlaceImport` containing explicit directional `PortalImport` entries.
- Produces: `completeReciprocalPortals(place: PlaceImport): PlaceImport`.

- [ ] **Step 1: Write failing graph-completion tests**

Cover:

- one explicit `hall -> balcony` generates one `balcony -> hall`;
- generated position equals forward spawn position;
- generated return spawn equals forward source position;
- generated yaw equals forward spawn yaw;
- return spawn yaw equals normalized `forward.yaw + Math.PI`;
- radius is preserved;
- source key is `generated-reverse:${forward.sourceKey}`;
- metadata is `{ generated: true, reverseOf: forward.sourceKey }`;
- a pre-existing explicit `balcony -> hall` suppresses generation;
- repeated completion does not duplicate;
- generated entries are not recursively completed.

- [ ] **Step 2: Run and verify RED**

Run: `node --import tsx --test tools/scene-import/reciprocal-portals.test.ts`

Expected: FAIL because the completion module does not exist.

- [ ] **Step 3: Implement graph completion**

Take a snapshot of explicit portals before generation. Resolve source and target nodes by slug, fail with a descriptive error when a destination is absent, and append only missing reverse directions. Normalize yaw into `[-Math.PI, Math.PI)`.

Call completion once per discovered place after all nodes are loaded. Keep portal parsing and JSON authoring files unchanged.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --import tsx --test tools/scene-import/reciprocal-portals.test.ts
node --import tsx --test tools/scene-import/discover.test.ts
```

Expected: PASS; repository discovery reports two portals instead of one.

```bash
git add tools/scene-import/reciprocal-portals.ts tools/scene-import/reciprocal-portals.test.ts tools/scene-import/discover.ts tools/scene-import/discover.test.ts
git commit -m "feat: generate reciprocal scene portals"
```

---

### Task 4: Reconcile canonical portal rows in Neon imports

**Files:**
- Modify: `tools/scene-import/import.ts`
- Modify: `tools/scene-import/import.test.ts`

**Interfaces:**
- Consumes: each node's complete explicit-plus-generated portal plan.
- Produces: stored outgoing portal rows exactly matching that plan.

- [ ] **Step 1: Write failing reconciliation tests**

Extend the fake transaction with `portal.deleteMany`. Assert each imported node deletes rows whose `sourceKey` is absent from its planned outgoing portals, and deletes every outgoing row for an empty plan. Seed a stale `generated-reverse:` row and prove it is removed when an explicit reverse replaces it.

- [ ] **Step 2: Run and verify RED**

Run: `node --import tsx --test tools/scene-import/import.test.ts`

Expected: FAIL because portal reconciliation is absent.

- [ ] **Step 3: Reconcile inside the existing transaction**

After all node IDs are known and before portal upserts, call node-scoped `portal.deleteMany` with `sourceKey: { notIn: plannedKeys }`, or only `fromNodeId` for an empty plan. Retain existing stable portal upserts.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --import tsx --test tools/scene-import/import.test.ts
pnpm test:database
```

Expected: PASS.

```bash
git add tools/scene-import/import.ts tools/scene-import/import.test.ts
git commit -m "fix: reconcile imported portal directions"
```

---

### Task 5: Prevent arrival ping-pong until portal exit

**Files:**
- Create: `src/walk-demo/portal-activation.ts`
- Create: `src/walk-demo/portal-activation.test.ts`
- Modify: `src/walk-demo/walk-demo.ts`

**Interfaces:**
- Produces: `PortalActivationGate` with `disarmForArrival()`, `observe(portalKey: string | null): { activate: boolean; armed: boolean }`, and `reset()`.

- [ ] **Step 1: Write failing state-machine tests**

Assert:

- a gate starts armed and activates on entry;
- `disarmForArrival()` suppresses a destination portal while inside it;
- observing another overlapping portal while disarmed also remains suppressed;
- observing `null` rearms but does not activate;
- entering after rearm activates once;
- remaining inside the same portal does not repeatedly activate;
- `reset()` restores normal startup behavior.

- [ ] **Step 2: Run and verify RED**

Run: `node --import tsx src/walk-demo/portal-activation.test.ts`

Expected: FAIL because the gate does not exist.

- [ ] **Step 3: Implement and integrate the gate**

Use portal ID when present, otherwise a stable current-scene/name key. In `updatePortalTrigger`, feed the current portal key to the gate, update visual/diagnostic active state regardless of arming, and call teleport only when `activate` is true. Immediately before portal-driven reload, call `disarmForArrival()`. Do not reset the gate during that reload; reset only on normal startup or non-portal scene selection.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --import tsx src/walk-demo/portal-activation.test.ts
node --import tsx src/walk-demo/teleport.test.ts
pnpm build
```

Expected: PASS.

```bash
git add src/walk-demo/portal-activation.ts src/walk-demo/portal-activation.test.ts src/walk-demo/walk-demo.ts
git commit -m "fix: prevent reciprocal portal ping-pong"
```

---

### Task 6: Import, inspect, and smoke-test the reciprocal graph

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/dev-settings.md`
- Runtime mutation: configured Neon database

**Interfaces:**
- Consumes: completed importer and the existing explicit hall-to-balcony portal.
- Produces: canonical hall-to-balcony and generated balcony-to-hall rows plus verified traversal.

- [ ] **Step 1: Run complete local verification**

Run:

```bash
pnpm test:conventions
pnpm test:database
node --import tsx src/walk-demo/portal-renderer.test.ts
node --import tsx src/walk-demo/portal-activation.test.ts
pnpm build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Import and inspect Neon**

Run `pnpm db:inspect`, then `pnpm db:import`, then `pnpm db:inspect` again. Expected after import: one place, two nodes, five assets, two directional portals. Hall targets balcony; balcony targets hall. The generated balcony portal position equals the existing forward spawn and its return spawn equals the hall portal position.

- [ ] **Step 3: Verify the local API**

Request `GET /api/scenes?place=23_nashville_dr_tenessee` and assert both nodes expose one outgoing portal targeting the other immutable node ID.

- [ ] **Step 4: Browser smoke test**

With no `?dev=` flags, verify the portal is visible and unobscured. Traverse hall to balcony and remain there while standing inside the arrival portal. Walk outside its radius, re-enter, and verify return to hall. Record absence of repeated reloads, CORS errors, and runtime exceptions.

- [ ] **Step 5: Document and commit**

Document import-generated reciprocal directions, explicit reverse precedence, and exit-to-rearm semantics. Keep authoring instructions clear that authors provide a forward destination spawn; the importer supplies the default return direction.

```bash
git add docs/database.md docs/dev-settings.md
git commit -m "docs: describe reciprocal portal behavior"
```
