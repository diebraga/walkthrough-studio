# Manual Testing Checklist

Run after starting dev server (`npm run dev`). Check each item; mark ✓ when verified.

## Character Collision

- [ ] Walk toward a wall in the baked collision grid
  - Expected: Character stops at the wall boundary; cannot pass through

- [ ] Navigate multiple scenes with different wall layouts
  - Expected: Character always blocked by walls, behavior consistent across scenes

## Third-Person Camera

- [ ] Switch to third-person view
- [ ] Walk toward a wall or corner so the boom would intersect the wall
  - Expected: Camera continues to its ideal distance; may clip through wall geometry (this is correct now)

- [ ] Test on a balcony edge (if scene has one)
  - Expected: Camera does NOT snap into the character; stays at ideal distance (fixes reported bug)

## Manual Collision Placement

- [ ] Enable collision debug (VITE_DEV_FLAGS=collision if not already on)
- [ ] Add a manual wall collision in third person (click "Add wall collision" button)
  - Expected: Wall appears **in front of the character**, not in front of the camera boom
  - Verify: Wall is placed 1.5m in front of character's actual position

- [ ] Add a manual wall collision in first person
  - Expected: Wall placement works as before (first person unchanged)

- [ ] Test erasing manual walls (click "Erase collision")
  - Expected: Walls removed correctly

- [ ] Test saving collision (click "Save collision")
  - Expected: Collision persists; refresh page and wall is gone (if erase worked) or still there (if not erased)

## Dev Panel Changes

- [ ] Look at dev panel when VITE_DEV_FLAGS=collision is active
- [ ] Verify "Free roam" checkbox NO LONGER EXISTS
  - Expected: Button/checkbox labeled "Free roam" is gone

- [ ] Verify "Add floor collision" button NO LONGER EXISTS
  - Expected: Button labeled "Add floor collision" is gone

- [ ] Verify these buttons still exist:
  - [ ] "Add wall collision"
  - [ ] "Erase collision"
  - [ ] "Save collision"

## Collision Overlay (if enabled)

- [ ] Show collision overlay (click "Show collision" toggle)
- [ ] Walk around the scene
  - Expected: Pink walls and floor visible; character blocked by them

## End-to-End Navigation

- [ ] Load a complex scene with multiple rooms
- [ ] Navigate freely between them
  - Expected: No restrictions on movement (no portals needed), but walls always block
  - Expected: Third-person camera never clips into character unexpectedly
  - Expected: Manual wall placements are accurate

---

**All tests pass?** Proceed to final code review.
**Any failures?** Note which item and re-examine that component.
