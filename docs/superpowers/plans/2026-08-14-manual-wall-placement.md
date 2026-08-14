# Manual Wall Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make newly added manual walls 3 metres wide and consistently oriented across the walker's view without changing any other collision behavior.

**Architecture:** Add a pure helper in the existing manual-collision module that converts an aim point into a `ManualWallCollision`. The UI handler appends that result exactly as it appends its inline object today, leaving persistence, rendering, and collision resolution unchanged.

**Tech Stack:** TypeScript, Node.js test runner, existing manual-collision model

## Global Constraints

- Change only walls created by **Add wall collision**.
- Width is exactly `3`; depth remains exactly `0.24`; height behavior remains unchanged.
- Store the negated walker yaw so the width axis spans across the view.
- Existing saved walls are not migrated or modified.
- Repeated presses append walls; they never replace existing entries.
- Preserve the unrelated `.mcp.json` modification.

---

### Task 1: Test and implement corrected manual-wall creation

**Files:**
- Modify: `src/walk-demo/manual-collision.ts`
- Modify: `src/walk-demo/manual-collision.test.ts`
- Modify: `src/walk-demo/walk-demo.ts`

**Interfaces:**
- Consumes: `point: { x: number; z: number; yaw: number }` from `aimPoint()`.
- Produces: `createManualWall(point): ManualWallCollision` with `{ x, z, width: 3, depth: 0.24, yaw: -point.yaw }`.

- [ ] **Step 1: Write failing placement tests**

Import `createManualWall` and assert exact dimensions and yaw conversion:

```ts
for (const yaw of [0, Math.PI / 4, Math.PI / 2]) {
  const wall = createManualWall({ x: 2, z: 3, yaw });
  assert.deepEqual(wall, { x: 2, z: 3, width: 3, depth: 0.24, yaw: -yaw });

  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const widthAxis = { x: Math.cos(wall.yaw), z: Math.sin(wall.yaw) };
  assert.ok(Math.abs(forward.x * widthAxis.x + forward.z * widthAxis.z) < 1e-10);
}
```

Add an append assertion using the returned wall:

```ts
const existing = createManualWall({ x: 0, z: 0, yaw: 0 });
const next = createManualWall({ x: 1, z: 1, yaw: 1 });
assert.deepEqual([... [existing], next], [existing, next]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx src/walk-demo/manual-collision.test.ts`

Expected: FAIL because `createManualWall` is not exported.

- [ ] **Step 3: Implement the pure helper**

Add to `manual-collision.ts`:

```ts
export function createManualWall(point: { x: number; z: number; yaw: number }): ManualWallCollision {
    return { x: point.x, z: point.z, width: 3, depth: 0.24, yaw: -point.yaw };
}
```

- [ ] **Step 4: Wire only the add-wall handler**

Import `createManualWall` in `walk-demo.ts` and replace the inline wall object with:

```ts
walls: [...this.manualCollision.walls, createManualWall(point)],
```

Do not change `aimPoint`, erasing, saving, rendering, or collision queries.

- [ ] **Step 5: Verify GREEN and regressions**

Run:

```bash
node --import tsx src/walk-demo/manual-collision.test.ts
pnpm test:database
pnpm test:conventions
pnpm build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 6: Commit**

```bash
git add src/walk-demo/manual-collision.ts src/walk-demo/manual-collision.test.ts src/walk-demo/walk-demo.ts
git commit -m "fix: orient wider manual walls across view"
```
