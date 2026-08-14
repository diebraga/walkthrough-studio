# Free Roam with Full Collision — Implementation Plan

**Goal:** Remove the free-roam dev toggle, decouple third-person camera from wall collision, fix collision placement to anchor to character position instead of camera, and remove the floor-collision button from the dev panel.

**Architecture:** All changes are localized to `src/walk-demo/walk-demo.ts`. The work proceeds in logical order: delete the toggle system, fix the camera raycast, fix placement logic, remove the button, then verify with manual testing in the scene.

**Tech Stack:** TypeScript, Three.js (Vector3, Euler), existing walk controller and collision systems.

## Global Constraints

- File to modify: `src/walk-demo/walk-demo.ts` only
- Must pass: `npx tsc -b` and `npx vite build` without errors
- Tests: Manual scene navigation (no unit test framework in use for this subsystem)
- Rollout: Single commit at the end covering all changes

---

## Task 1: Remove `freeRoam` Field and Methods from ViewerWalkMode

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:573`, `687–690`, `693–700`

**Interfaces:**
- Consumes: Nothing
- Produces: ViewerWalkMode no longer has `freeRoam` field or `setFreeRoam()` method

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

---

## Task 2: Remove freeRoam from WalkDemoApp Initialization

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:2457`, `2503`

**Interfaces:**
- Consumes: Task 1 deleted `setFreeRoam()`
- Produces: WalkDemoApp.params no longer has `freeRoam` field

- [ ] **Step 1: Delete freeRoam from params type**
  - Find line ~2457: `freeRoam: boolean;` in the `params` type definition
  - Delete the entire line

- [ ] **Step 2: Delete freeRoam initialization**
  - Find line ~2503: `freeRoam: devEnabled('collision') && readDevToggle('freeRoam', true),`
  - Delete the entire line

- [ ] **Step 3: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: Compiler still reports errors about missing `setFreeRoam()` calls (from scene load in Task 3)

---

## Task 3: Remove freeRoam Call During Scene Load

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:3180`

**Interfaces:**
- Consumes: Task 2 removed `params.freeRoam` field
- Produces: Scene load no longer sets free roam

- [ ] **Step 1: Locate and delete the setFreeRoam call**
  - Find line ~3180: `walk.setFreeRoam(this.params.freeRoam);`
  - Delete the entire line

- [ ] **Step 2: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: All errors resolved. Build succeeds.

---

## Task 4: Remove Wall-Collision Raycast from resolveCameraCollision()

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:1045–1063`

**Interfaces:**
- Consumes: Nothing
- Produces: Third-person camera boom no longer raycasts for wall collision; camera can pass through walls

- [ ] **Step 1: Locate the raycast block in resolveCameraCollision()**
  - Find method `resolveCameraCollision()` starting around line ~1034
  - Inside it, find the block:
    ```ts
    if (this.collision) {
        const hit = this.collision.queryRay(
            this.cameraTarget.x,
            this.cameraTarget.y,
            this.cameraTarget.z,
            this.cameraRay.x,
            this.cameraRay.y,
            this.cameraRay.z,
            distance,
        );
        if (hit) {
            blockedDistance = Math.max(0.1, this.cameraTarget.distanceTo(new Vector3(hit.x, hit.y, hit.z)) - 0.18);
            blocked = true;
            this.thirdPersonOcclusionReleaseTimer = 0.1;
        }
    }
    ```
  - This is the raycast that needs deletion (approximately line ~1045–1063)

- [ ] **Step 2: Understand the surrounding context**
  - The method calculates `desiredDistance` based on whether the boom is blocked
  - After your deletion, `blocked` will never be true (initialized to false, never set true)
  - The method will always use `maxDistance` as the desired distance
  - This is correct behavior (camera always sits at ideal distance, walls don't pull it closer)

- [ ] **Step 3: Delete the raycast block**
  - Remove the entire `if (this.collision) { ... }` block that contains the `queryRay` call
  - Keep the surrounding code:
    ```ts
    let blockedDistance = maxDistance;
    let blocked = false;
    // <-- DELETE THE RAYCAST BLOCK ABOVE THIS LINE
    if (!blocked && this.thirdPersonOcclusionReleaseTimer > 0) {
        // This code stays (handles timer for smooth transitions)
    }
    ```

- [ ] **Step 4: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: Build still succeeds

- [ ] **Step 5: Verify the method still makes sense**
  - Read the full `resolveCameraCollision()` method start to finish
  - Verify the logic now computes `desiredDistance` as always `maxDistance` (no wall blocking)
  - The code should be:
    1. Normalize `cameraRay`
    2. Set `blockedDistance = maxDistance`, `blocked = false`
    3. Skip the raycast block (deleted)
    4. Check occlusion timer (keeps smooth transitions)
    5. Set `desiredDistance = maxDistance` (since `blocked` is false)
    6. Smooth-blend `thirdPersonCollisionDistance` toward desired distance
    7. Compute final `cameraCollisionPosition`

---

## Task 5: Fix aimPoint() to Use Character Pose Instead of Camera

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:2887–2906`

**Interfaces:**
- Consumes: `walk.getPose()` (already exists)
- Produces: Collision placement anchors to character position/yaw instead of camera position/yaw

- [ ] **Step 1: Locate the aimPoint() method**
  - Find method `aimPoint()` around line ~2887

- [ ] **Step 2: Understand current behavior**
  - Current code:
    ```ts
    const camera = walk.getCameraState();
    const yaw = camera.rotation.y;
    const pitch = camera.rotation.x;
    const cp = Math.cos(pitch);
    const dx = -Math.sin(yaw) * cp;
    const dy = Math.sin(pitch);
    const dz = -Math.cos(yaw) * cp;
    // Then raycast from camera.position in (dx, dy, dz) direction
    ```
  - In third person, `camera` is the boom camera (pulled back), not the character
  - We want to raycast from the character instead

- [ ] **Step 3: Replace camera with pose**
  - Replace the first line:
    ```ts
    // OLD:
    const camera = walk.getCameraState();
    
    // NEW:
    const pose = walk.getPose();
    ```

- [ ] **Step 4: Replace yaw reference**
  - Replace `const yaw = camera.rotation.y;` with:
    ```ts
    const yaw = pose.yaw;
    ```

- [ ] **Step 5: Replace pitch with fixed 0**
  - Replace `const pitch = camera.rotation.x;` with:
    ```ts
    const pitch = 0;
    ```

- [ ] **Step 6: Update raycast origin to use pose + eye height**
  - Find the line that checks: `if (dy < -0.01 && camera.position.y > floorY) {`
  - Change it to:
    ```ts
    const rayOriginY = pose.y + WALK_EYE_HEIGHT;
    if (dy < -0.01 && rayOriginY > floorY) {
    ```
  - Find the line that does: `const t = (floorY - camera.position.y) / dy;`
  - Change it to:
    ```ts
    const t = (floorY - rayOriginY) / dy;
    ```
  - Find the line that returns: `return { x: camera.position.x + dx * t, z: camera.position.z + dz * t, yaw };`
  - Change it to:
    ```ts
    return { x: pose.x + dx * t, z: pose.z + dz * t, yaw };
    ```

- [ ] **Step 7: Verify the fallback path**
  - After the raycast block, the method returns:
    ```ts
    const pose = walk.getPose();
    return { x: pose.x - Math.sin(pose.yaw) * 1.5, z: pose.z - Math.cos(pose.yaw) * 1.5, yaw: pose.yaw };
    ```
  - This is already using `pose`, so no change needed (but verify it's still there)

- [ ] **Step 8: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: Build succeeds

---

## Task 6: Remove "Add Floor Collision" Button from Dev Panel

**Files:**
- Modify: `src/walk-demo/walk-demo.ts:2569–2570`

**Interfaces:**
- Consumes: Nothing
- Produces: Dev panel no longer has "Add floor collision" button

- [ ] **Step 1: Locate the button definition**
  - Find the section around line ~2569 inside the dev panel setup:
    ```ts
    pane.addButton({ title: 'Add floor collision' }).on('click', () => {
        this.addManualFloorCollision();
    });
    ```

- [ ] **Step 2: Delete the button**
  - Remove both lines (or whatever spans the button definition)

- [ ] **Step 3: Verify neighboring buttons remain**
  - The following buttons should still be there:
    ```ts
    pane.addButton({ title: 'Add wall collision' }).on('click', () => {
        this.addManualWallCollision();
    });
    pane.addButton({ title: 'Erase collision' }).on('click', () => {
        this.eraseManualCollision();
    });
    pane.addButton({ title: 'Save collision' }).on('click', () => {
        void this.persistManualCollision();
    });
    ```

- [ ] **Step 4: Run TypeScript compiler**
  - Run: `npx tsc -b`
  - Expected: Build succeeds

---

## Task 7: Build and Verify No Errors

**Files:**
- Modify: None
- Test: `src/walk-demo/walk-demo.ts`

**Interfaces:**
- Consumes: All previous tasks completed
- Produces: Clean build, ready for testing

- [ ] **Step 1: Run full TypeScript build**
  - Run: `npx tsc -b`
  - Expected: `[HH:MM:SS] tsc --build ...` followed by no errors

- [ ] **Step 2: Run Vite production build**
  - Run: `npx vite build`
  - Expected: Build succeeds, output to `dist/`

- [ ] **Step 3: Commit all changes**
  - Run:
    ```bash
    git add src/walk-demo/walk-demo.ts
    git commit -m "feat: make free roam default with full collision, decouple camera from walls, fix collision placement

    - Remove freeRoam dev toggle; character always collides with walls and floor
    - Decouple third-person camera from wall collision; boom can pass through walls
    - Fix manual collision placement to anchor to character pose instead of camera
    - Remove 'Add floor collision' button from dev panel
    
    Fixes: balcony camera clipping, collision placement offset in third person"
    ```

---

## Task 8: Manual Testing Suite

**Files:**
- Test: Interactive scene navigation
- No code changes

**Interfaces:**
- Consumes: Clean build from Task 7
- Produces: Verification that all four changes work as expected

- [ ] **Step 1: Start the dev server**
  - Run: `npm run dev` (or whatever your dev command is)
  - Expected: Server starts, page loads at http://localhost:5173/

- [ ] **Step 2: Load a scene with baked grid walls**
  - Select a scene with collision (e.g., the default one)
  - Expected: Scene loads, no errors in console

- [ ] **Step 3: Test character wall collision still works**
  - Walk toward a wall in the baked collision grid
  - Expected: Character stops at the wall boundary; cannot pass through

- [ ] **Step 4: Test third-person camera passes through walls**
  - Switch to third-person view
  - Walk toward a wall or corner so the boom would intersect the wall
  - Expected: Camera continues to its ideal distance; may clip through wall geometry (this is correct now)

- [ ] **Step 5: Test balcony camera behavior (if scene has a balcony)**
  - Walk to a balcony edge
  - Expected: Camera does NOT snap into the character; it stays at ideal distance (this fixes the reported bug)

- [ ] **Step 6: Enable collision debug (if you have VITE_DEV_FLAGS=collision)**
  - Show collision overlay
  - Expected: Pink walls and floor visible; character blocked by them

- [ ] **Step 7: Add a manual wall collision in third person**
  - Click "Add wall collision" in the dev panel
  - Verify the wall appears **in front of the character**, not in front of the camera boom
  - Expected: Wall is placed 1.5m in front of the character's actual position, not the distant boom

- [ ] **Step 8: Add a manual wall collision in first person**
  - Switch to first person
  - Click "Add wall collision" again
  - Expected: Wall placement works as before (first person unchanged)

- [ ] **Step 9: Verify "Add floor collision" button is gone**
  - Look at the dev panel controls under the collision flag
  - Expected: Button labeled "Add floor collision" no longer exists
  - "Add wall collision," "Erase collision," and "Save collision" are still there

- [ ] **Step 10: Test erasing and saving manual walls**
  - Click "Erase collision" near a wall you added
  - Expected: Wall is removed
  - Click "Save collision"
  - Expected: Collision is persisted; refresh page and wall is gone (or still there if erase didn't work)

- [ ] **Step 11: Navigate multiple scenes if available**
  - Load different scenes with different wall layouts
  - Expected: Character always blocked by walls, camera never blocked, placement always anchored to character

- [ ] **Step 12: Verify no toggle for free roam exists**
  - Look at dev panel when VITE_DEV_FLAGS=collision is active
  - Expected: No checkbox labeled "Free roam"

---

## Summary

All changes are deletions or small replacements in `src/walk-demo/walk-demo.ts`. The spec is fully covered:
- ✓ Task 1–3: freeRoam toggle removed entirely
- ✓ Task 4: Camera raycast removed; third-person boom decoupled from walls
- ✓ Task 5: Collision placement anchored to character pose
- ✓ Task 6: Floor collision button removed from dev panel
- ✓ Task 7: Build verification
- ✓ Task 8: Manual testing suite

No new files created. No schema changes. Single commit at the end.
