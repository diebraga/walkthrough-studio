# Safe Floor-Circle Portals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place generated reciprocal portals and their return landings outside one another's trigger circles, and render portals solely as depth-independent circles on the floor.

**Architecture:** Keep reciprocal completion in the offline importer and add one pure behind-pose geometry helper there; Neon and the browser continue consuming directional portal records unchanged. Simplify the portal renderer to one radial floor disc per portal and remove the now-unused animation lifecycle from the upstream-derived walk demo.

**Tech Stack:** TypeScript, Node's built-in test runner/assertions, `@manycore/aholo-viewer`, Vite, Prisma/Hono conventions.

## Global Constraints

- Authored forward portal positions and destination spawns remain unchanged.
- Generated clearance is exactly the portal trigger radius plus `0.7` metres.
- Forward direction for yaw `theta` is `x = -sin(theta)`, `z = -cos(theta)`; generated points are offset in the opposite direction.
- Generated reverse portal Y comes from the destination spawn; generated return-spawn Y comes from the original forward portal.
- Generated return yaw remains normalized `forward.yaw + PI`; pitch remains `0`.
- Explicit reverse portals remain authoritative; generated keys, metadata, idempotence, and non-recursion remain unchanged.
- The floor circle keeps radius `1.7`, floor offset `0.12`, additive/double-sided rendering, `depthTest: false`, `depthWrite: false`, and render order `10000`.
- Correction tests use invented scene names and geometry; they do not name hall, balcony, a property slug, an asset file, a production database row, or a fixed production portal count.
- Do not modify `.mcp.json` or unrelated user changes.
- Keep edits to `src/walk-demo/walk-demo.ts` minimal and comment the lifecycle change so the upstream copy stays diffable.

---

### Task 1: Safe generated reciprocal geometry

**Files:**
- Modify: `tools/scene-import/reciprocal-portals.test.ts`
- Modify: `tools/scene-import/reciprocal-portals.ts`

**Interfaces:**
- Consumes: existing `PortalImport` position, yaw, radius, and spawn fields.
- Produces: `completeReciprocalPortals(place: PlaceImport): PlaceImport` with generated reverse position and return spawn offset by `radius + 0.7` behind their respective authored poses.

- [ ] **Step 1: Make the reciprocal fixtures generic and write the failing offset assertions**

Replace the fixture slugs/names/source keys with neutral values such as `origin`, `destination`, and `example/origin/portals.json#0`. In the first test, use a non-zero source yaw, a different non-zero destination yaw, and radius `1.3`. Assert the exact formulas:

```ts
const clearance = 1.3 + 0.7;
assert.deepEqual(reverse.position, {
  x: destinationSpawn.x + Math.sin(destinationSpawn.yaw) * clearance,
  y: destinationSpawn.y,
  z: destinationSpawn.z + Math.cos(destinationSpawn.yaw) * clearance,
});
assert.deepEqual(reverse.spawn, {
  x: sourcePosition.x + Math.sin(sourceYaw) * clearance,
  y: sourcePosition.y,
  z: sourcePosition.z + Math.cos(sourceYaw) * clearance,
  yaw: reverse.spawn.yaw,
  pitch: 0,
});
```

Also assert that the planar distance from `reverse.position` to the destination spawn and the planar distance from `reverse.spawn` to the source portal centre are both greater than `reverse.radius`. Preserve assertions for the stable key, source-node name/slug, generated metadata, radius, yaw normalization, and input non-mutation.

- [ ] **Step 2: Run the focused reciprocal test and verify RED**

Run: `npx tsx --test tools/scene-import/reciprocal-portals.test.ts`

Expected: FAIL because `reverse.position` still equals the destination spawn and `reverse.spawn` still equals the source portal centre.

- [ ] **Step 3: Add the minimal behind-pose helper and use it twice**

Add a constant and pure helper in `reciprocal-portals.ts`:

```ts
const PORTAL_CLEARANCE = 0.7;

function behindPose(
  pose: { x: number; y: number; z: number; yaw: number },
  radius: number,
): { x: number; y: number; z: number } {
  const clearance = radius + PORTAL_CLEARANCE;
  return {
    x: pose.x + Math.sin(pose.yaw) * clearance,
    y: pose.y,
    z: pose.z + Math.cos(pose.yaw) * clearance,
  };
}
```

Use `behindPose(forward.spawn, forward.radius)` for the generated reverse portal position. Use `behindPose({ ...forward.position, yaw: forward.yaw }, forward.radius)` for its return spawn position, while preserving normalized yaw and pitch.

- [ ] **Step 4: Run the focused reciprocal test and verify GREEN**

Run: `npx tsx --test tools/scene-import/reciprocal-portals.test.ts`

Expected: all reciprocal tests PASS with no warnings or leaked process.

- [ ] **Step 5: Commit the reciprocal placement fix**

```bash
git add tools/scene-import/reciprocal-portals.ts tools/scene-import/reciprocal-portals.test.ts
git commit -m "fix: separate reciprocal portal arrivals"
```

---

### Task 2: Floor-circle-only portal renderer

**Files:**
- Modify: `src/walk-demo/portal-renderer.test.ts`
- Modify: `src/walk-demo/portal-renderer.ts`
- Modify: `src/walk-demo/walk-demo.ts`

**Interfaces:**
- Consumes: existing `PortalRenderer.update(portals, activeName, floorY)`, visibility, and disposal calls.
- Produces: unchanged update/visibility/disposal API, but no `tick()` method; `buildPortalMarker()` returns only planar radial-disc triangles.

- [ ] **Step 1: Write failing renderer contract assertions**

Change the expected visual constants to:

```ts
assert.deepEqual(PORTAL_VISUAL, {
  glowRadius: 1.7,
  floorOffset: 0.12,
  renderOrder: 10_000,
});
```

Iterate every marker vertex and assert `y === 0`; assert both minimum and maximum Y are `0`, radial extent is exactly `glowRadius`, and the generated triangle count is `24`. Retain the exact material-options assertion. Add a source assertion that `walk-demo.ts` contains no `.portalRenderer?.tick(` call, so the lifecycle expectation fails before implementation.

- [ ] **Step 2: Run the focused renderer test and verify RED**

Run: `npx tsx src/walk-demo/portal-renderer.test.ts`

Expected: FAIL because beam constants/elevated vertices and the renderer tick call still exist.

- [ ] **Step 3: Remove beam geometry and animation state**

In `portal-renderer.ts`, retain only `glowRadius`, `floorOffset`, and `renderOrder` in `PORTAL_VISUAL`. Delete the crossed-beam vertex loop, `spin`, `spinSpeed`, and `tick()`. Keep the existing 24 radial triangles, centre colour, black edge colour, material options, mesh floor offset, render order, visibility, and disposal behavior.

- [ ] **Step 4: Remove the obsolete per-frame call from the upstream-derived demo**

Delete only `this.portalRenderer?.tick(deltaClamped);` from `walk-demo.ts` and add/adjust the nearby project-change comment to state that the portal renderer is static floor geometry. Do not change the portal update, scene creation, visibility, or disposal calls.

- [ ] **Step 5: Run the focused renderer test and verify GREEN**

Run: `npx tsx src/walk-demo/portal-renderer.test.ts`

Expected: PASS; all vertices are planar and no portal-renderer tick integration remains.

- [ ] **Step 6: Commit the renderer simplification**

```bash
git add src/walk-demo/portal-renderer.ts src/walk-demo/portal-renderer.test.ts src/walk-demo/walk-demo.ts
git commit -m "feat: render portals as floor circles"
```

---

### Task 3: Remove dataset-specific portal-count verification

**Files:**
- Modify: `tools/scene-import/discover.test.ts`

**Interfaces:**
- Consumes: `discoverSceneImportPlan()` completed graph output.
- Produces: generic discovery coverage that validates reciprocal direction and safe separation without encoding the current repository portal count.

- [ ] **Step 1: Replace production-shaped fixture labels and the fixed count assertion**

Rename only this test's portal fixture nodes from room-specific labels to `origin` and `destination`, updating paths and lookup variables consistently. Replace:

```ts
assert.equal(plan.places[0].nodes.flatMap((node) => node.portals).length, 2);
```

with relationship assertions that locate the generated reverse by its deterministic key, assert it targets `origin`, and assert its distance from the authored destination spawn exceeds its radius. Do not assert a total portal count.

- [ ] **Step 2: Run the discovery test**

Run: `npx tsx --test tools/scene-import/discover.test.ts`

Expected: all discovery tests PASS using temporary invented scenes and without a fixed portal-total assertion.

- [ ] **Step 3: Commit the generic discovery verification**

```bash
git add tools/scene-import/discover.test.ts
git commit -m "test: generalize reciprocal discovery coverage"
```

---

### Task 4: Full verification and documentation alignment

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-visible-reciprocal-portals-design.md`
- Modify: `docs/dev-settings.md` only if it still describes a vertical or rotating portal beam.

**Interfaces:**
- Consumes: completed implementation and existing project verification scripts.
- Produces: documentation that no longer contradicts the floor-circle geometry, plus fresh verification evidence.

- [ ] **Step 1: Remove stale beam and production-specific verification claims**

Update the earlier visible-reciprocal-portals design to point to the superseding safe-floor-circle spec for placement and presentation. Remove claims that the portal has a `2.4` metre rotating beam or that verification requires particular production scenes/database rows. If `docs/dev-settings.md` mentions the beam, replace that sentence with the static floor-circle behavior.

- [ ] **Step 2: Run every focused generic portal test together**

Run:

```bash
npx tsx --test tools/scene-import/reciprocal-portals.test.ts tools/scene-import/discover.test.ts
npx tsx src/walk-demo/portal-renderer.test.ts
npx tsx src/walk-demo/portal-activation.test.ts
```

Expected: every command exits `0`; no test depends on current production portal rows or assets.

- [ ] **Step 3: Run project-required verification**

Run:

```bash
pnpm test:conventions
pnpm build
git diff --check
```

Expected: every command exits `0`, with a successful Vite production build and no whitespace errors.

- [ ] **Step 4: Inspect final scope**

Run:

```bash
git status --short
git diff --stat HEAD~3
git diff -- . ':(exclude).mcp.json'
```

Expected: only the planned source/tests/docs are changed by this work; `.mcp.json` remains untouched as the user's pre-existing modification.

- [ ] **Step 5: Commit documentation alignment**

```bash
git add docs/superpowers/specs/2026-08-15-visible-reciprocal-portals-design.md docs/dev-settings.md
git commit -m "docs: describe safe floor circle portals"
```

