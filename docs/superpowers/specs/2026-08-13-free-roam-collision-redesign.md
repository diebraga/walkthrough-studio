# Free Roam with Full Collision — Design Spec

**Date:** 2026-08-13  
**Status:** Design (awaiting implementation plan)

## Summary

Make free-roam walking the default, permanent behavior — no dev toggle — while keeping all wall and floor collision active. The character cannot pass through baked grid walls, manually-added walls, or the floor. The third-person camera boom can pass through walls (camera decoupled from character collision). Fix collision placement so manual walls spawn in front of the actual character, not the distant camera.

## Current State

- `freeRoam` is a dev-only toggle (gated by `devEnabled('collision')`), off by default.
- When on, it replaces all collision with an infinite floor plane — character walks through any wall.
- Intended for previewing animations without fighting a half-baked collision bake.
- Third-person camera raycasts from character to boom to avoid walls; this can fail on scenes with walls outside the baked grid (e.g., balconies), pulling the camera into the character unexpectedly.
- Manual collision placement uses `aimPoint()`, which reads from the rendered camera. In third person this is the pulled-back boom position, so placing a wall lands it in the wrong spot relative to where you're standing.

## Problems This Fixes

1. **Balcony camera clipping** — third-person camera gets yanked into the character when it hits an un-baked wall or grid boundary.
2. **Collision placement offset** — in third person, manually-added walls appear in front of the boom camera, not in front of you.
3. **Dev/prod divergence** — visitors get full collision; developers could opt into a collision-free mode that doesn't represent real use.

## Design

### 1. Delete the `freeRoam` Toggle

**Scope:** `src/walk-demo/walk-demo.ts`

- Remove `freeRoam` field from `ViewerWalkMode` (line ~573)
- Remove `setFreeRoam(enabled: boolean)` method (line ~687–690)
- Remove the `if (this.freeRoam)` branch in `applyCollisionSource()` (line ~693–700); keep the `else` branch (apply real collision) as the only path
- Remove `freeRoam: boolean` from `WalkDemoApp.params` (line ~2457)
- Remove initialization of `freeRoam` in the params object (line ~2503)
- Remove the UI binding for `freeRoam` in the dev panel (line ~2565–2568)
- Remove the `walk.setFreeRoam(this.params.freeRoam)` call during scene load (line ~3180)

**Result:** Character always collides with walls and floor. No toggle. No code path to disable it.

### 2. Decouple Third-Person Camera from Wall Collision

**Scope:** `src/walk-demo/walk-demo.ts`, method `resolveCameraCollision()` (line ~1034–1075)

- Delete the raycast block (line ~1045–1063) that tests for wall hits along the boom line
- Keep the math that computes `cameraCollisionPosition` from `cameraTarget`, `cameraRay`, and distance (line ~1073–1075)
- Result: the boom always sits at its computed distance; walls no longer pull it closer

**Effect:**
- First person: unchanged (camera = capsule position, can't clip walls anyway)
- Third person: camera can be inside or beyond wall geometry; the boom follows its ideal trajectory unobstructed
- Balcony bug: likely fixed — no more unexpected camera jumps when boom passes outside the grid

### 3. Fix Manual Collision Placement

**Scope:** `src/walk-demo/walk-demo.ts`, method `aimPoint()` (line ~2887–2906)

Current logic:
```ts
const camera = walk.getCameraState();  // In third person, this is the boom camera
const yaw = camera.rotation.y;
const pitch = camera.rotation.x;
// Raycast from boom position downward/forward to find placement point
```

New logic:
```ts
const pose = walk.getPose();  // Character's actual position and orientation
const yaw = pose.yaw;         // Character's yaw, not camera yaw
const pitch = 0;              // Level placement (look straight ahead, not up/down)
// Raycast from character position forward/downward to find placement point
```

**Detail:** In first person, `pose` ≈ camera, so this is a no-op. In third person, aiming from `pose` instead of `camera` anchors placement to the actual character, not the distant boom. Pitch is fixed at 0 (horizontal aim) to keep placement simple — walls are placed on level ground in front of the character.

Specific changes:
- Replace `const camera = walk.getCameraState()` with `const pose = walk.getPose()`
- Replace `const yaw = camera.rotation.y` with `const yaw = pose.yaw`
- Replace `const pitch = camera.rotation.x` with `const pitch = 0`
- Replace `camera.position` with `{ x: pose.x, y: pose.y + WALK_EYE_HEIGHT, z: pose.z }` (position the raycast origin at eye level, not boom level)

### 4. Remove "Add Floor Collision" from Dev Panel

**Scope:** `src/walk-demo/walk-demo.ts`, dev panel setup (line ~2569–2570)

- Delete the button definition: `pane.addButton({ title: 'Add floor collision' }).on('click', () => { this.addManualFloorCollision(); });`
- Keep "Add wall collision," "Erase collision," and "Save collision"
- Keep the handler `addManualFloorCollision()` in the class (in case historical `.json` files reference floor entries)

**Rationale:** Floor is a global plane; manual floor patches are redundant and confuse the tool.

## Data Model

No changes to the collision data structures. Manual collision continues to carry `floors` and `walls` arrays. A scene with no manual data still works — it falls back to baked grid collision.

## Testing Checklist

After implementation:
1. Navigate a scene with baked grid walls — character blocked, camera not
2. Add a manual wall via the dev panel — character blocked by it, camera passes through
3. Switch to third person on a balcony — camera should not snap into the character
4. Add a manual wall in third person — it should appear in front of the character, not the camera
5. Add a manual wall in first person — placement should be unchanged
6. Erase a manually-added wall — tool still works
7. Refresh the page — manual collision state persists (if saved)

## Known Limits

- Pitch for `aimPoint()` defaults to 0 (level placement). If a scene needs walls placed at an angle, this can be revisited (use control input or fixed angle).
- Balcony fix assumes wall-free camera is the desired behavior. If balconies should be walled off, that's a data fix, not a code fix.

## Files to Edit

- `src/walk-demo/walk-demo.ts` — 90% of changes; remove toggle, fix camera raycast, fix placement, remove button
- No schema changes; no new files

## Rollout

After implementation:
- `npx tsc -b` and `npx vite build` should pass
- Commit with message: "Make free roam default with full wall collision, decouple camera from walls, fix collision placement"
