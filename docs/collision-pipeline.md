# Collision pipeline

How `collision.json` is produced and what it contains. Index:
[../AGENTS.md](../AGENTS.md).

```
node tools/build-collision.mjs <scene>/index.ply --out <scene>/ [--cell 0.15]
node tools/build-collision.mjs --self-test
```

Read-only: it never rewrites the splat.

## Why collision is derived rather than voxelized

The obvious approach — voxelize the splat with `splat-transform` and use the
occupancy octree — fails on the floor. Floors are photographed at grazing angles,
so they reconstruct as a few large, low-opacity gaussians. They render fine and
then fail the voxelizer's opacity test, leaving holes you fall through. Lowering
the opacity threshold enough to catch them also catches the semi-transparent haze
around every surface, which becomes solid blocks hanging in mid-air.

So the two halves are treated differently:

- **Floor** — asserted as a plane. Fitted to the data, but not required to be
  present voxel by voxel.
- **Walls** — every grid cell outside the walkable region, which comes from a
  flood fill and therefore follows the room's true shape, including alcoves and
  doorways. An axis-aligned bounding rectangle cannot do this; that was tried and
  you walk through walls where the room is not rectangular.

## What is measured, not configured

Nothing is tuned per scene. Each of these was hand-fitted once and then replaced:

| Quantity | How it is derived |
|---|---|
| Up axis | dominant gaussian surface normal (weighted normal covariance) |
| Levelling rotation | iterated from the fitted floor normal |
| Floor height | strongest horizontal layer, ranked by **area**, not point count |
| Ceiling / wall height | high percentile of scene height |
| Opacity gate | percentile of the scene's own opacity distribution |
| Obstacle threshold | Otsu on the scene's density histogram |
| Walkable seed | largest connected component — so nothing is asked per scene |

Ranking floor candidates by area rather than point count is what stops a dense
piece of furniture being mistaken for the floor.

## Output

`collision.json`:

| Field | Meaning |
|---|---|
| `rotation` | 3×3 to level the scene; apply to the splat layer if not ~identity |
| `floorY`, `ceilingY`, `wallHeight` | measured heights |
| `cell`, `origin`, `size` | grid layout |
| `walkable` | base64 bitmask, one bit per cell, row-major over (x, z) |

Consumed by `src/walk-demo/grid-collision.ts`, which serves the floor plane and
the wall cells from the one file.

## QA gates

Every run prints an ASCII plan and a report, and ends with either
`all QA gates passed` or a list of warnings. **Read it.** The gates:

- floor fit rms < 0.08 m — higher means the floor is not planar
- pre-levelling tilt < 15° — higher suggests the up-axis is wrong
- residual tilt < 1° after levelling
- ceiling height 2–5 m — outside that, the scan is probably not metric
- walkable/floor ratio 0.4–3.0
- fewer than 400 connected components

Reference values for `23_nashville_dr_tenessee/hall`: floor `-1.656`, rms
`0.041`, residual tilt `0.17°`, wall height `3.86`, walkable/floor `0.77`.

## `--self-test`

Covers the maths that fails silently — quaternion to axes, 3×3 eigen, the
rotation between two vectors, connected components, Otsu. It has already caught a
real bug (Otsu returning the first of several tied thresholds, which biased the
obstacle cut low). Run it after touching any of those functions.

## Known limits

- **Mirrors and large glass** reconstruct as real depth beyond the wall and punch
  holes. No geometric method distinguishes that from a doorway.
- **Multi-storey** scans have several floor layers; the dominant one is used.
- **Stairs and ramps** break the single-plane floor assumption.
- **Outdoor scenes** have no walls, so the walkable region is unbounded.
- Validated on one scan so far. The up-axis detection assumes horizontal surfaces
  dominate by area, which is not true in a corridor or a wall-heavy scan — the
  pre-levelling tilt gate is what should catch that.

## Gotchas found the hard way

- `splat-transform` applies `-r`/`-t` to `.ply` output but **not** to `.csv`,
  which silently invalidates any measurement taken through a CSV after a rotate.
  This tool therefore does all transforms in JS.
- A negative first value in `-r -9.2,0,0` is parsed as a flag and the rotation is
  dropped without an error. Use the 360° complement.
