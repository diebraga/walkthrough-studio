# Task 1: Remove `freeRoam` Field and Methods from ViewerWalkMode

**Project context:**  
Walkthrough-studio is a 3D Gaussian-splat scene viewer with a walk controller. Currently it has a dev-only toggle `freeRoam` that strips out all wall collision. We're making free roam the default (always-on), while keeping wall/floor collision active unconditionally. This task deletes the toggle mechanism itself.

**Global Constraints (from spec):**
- File to modify: `src/walk-demo/walk-demo.ts` only
- Must pass: `npx tsc -b` and `npx vite build` without errors
- Tests: Manual scene navigation (no unit test framework in use)
- Rollout: Single commit at the end covering all changes

**What this task does:**
Remove the `freeRoam` field from the `ViewerWalkMode` class, delete the `setFreeRoam(enabled: boolean)` method, and simplify the `applyCollisionSource()` method to remove the conditional logic that disabled collision. Character will always collide with walls and floor.

**Interfaces:**
- Consumes: Nothing (this task starts the sequence)
- Produces: `ViewerWalkMode` no longer has `freeRoam` field or `setFreeRoam()` method; `applyCollisionSource()` always applies real collision

**Steps (copy from plan, execute exactly):**

- [ ] **Step 1: Locate and delete the freeRoam field**
  - Find line ~573: `private freeRoam = false;`
  - Delete the entire line

- [ ] **Step 2: Locate and delete the setFreeRoam() method**
  - Find line ~687: `setFreeRoam(enabled: boolean) { ... }`
  - Delete the entire method (typically 3–4 lines)

- [ ] **Step 3: Simplify applyCollisionSource() to remove the freeRoam branch**
  - Find line ~693: `if (this.freeRoam) { ... }`
  - Delete the entire if block (lines ~693–700)
  - The else branch becomes the only path; verify it reads:
    ```ts
    this.collision = this.manualOverlay
        ? new CombinedCollision(this.baseCollision, new ManualCollision(this.manualOverlay))
        : this.baseCollision;
    ```

- [ ] **Step 4: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: Compiler reports errors about missing `setFreeRoam()` calls (we'll fix those in Task 2–3)
  - Verify: Errors reference `walk.setFreeRoam` at specific line numbers you'll fix next

**Report file path (write your report here):**
`.superpowers/sdd/free-roam-collision-redesign/task-1-report.md`

Include in your report:
- What you changed (deletions with line numbers or context)
- TypeScript compiler output (the errors you expect)
- Any concerns or observations
- Commit hash and message
