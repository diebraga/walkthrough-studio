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
| `rotation` | 3×3 that levels the scan; the scene applies it to the splat layer on load |
| `floorY`, `ceilingY`, `wallHeight` | measured heights |
| `cell`, `origin`, `size` | grid layout |
| `walkable` | base64 bitmask, one bit per cell, row-major over (x, z) |

## Runtime

`src/walk-demo/grid-collision.ts` serves **both colliders from this one file**:

- **floor** — a plane at `floorY`. Asserted, not detected: the scan's floor is
  captured at grazing angles and barely voxelizes, so requiring it per-cell is
  what made you fall through.
- **walls** — every grid cell outside the walkable region, solid from the floor
  up to `wallHeight`. Rays use a 2D DDA across the grid; capsules get pushed out
  of the nearest overlapping cell. Cells outside the grid count as solid, so you
  cannot walk off the bake.

`WalkDemoScene.setLevellingRotation` applies `rotation` to the splat layer on
load, which is what lets the bucket hold the **original** scan with no
pre-processing — splat and grid end up in the same frame by construction.

A scene opts in with `collisionGrid` on its `WalkDemoScheme`; when set it
supersedes the older `voxelJson`/`voxelBin` pair entirely.

## Later: generated, not stored

Baking to a file is a stand-in, like everything else in `public/` — see
[scene-assets.md](scene-assets.md).

The same analysis can run **in the browser** on the splat that is already being
downloaded: roughly 200–400 ms, against a 20–40 s splat load. No CLI, no CSV, no
file. The intended path is:

1. **Automate the bake on upload** — a bucket trigger or CI step runs this tool
   and stores the result, so the pipeline moves server-side rather than into the
   viewer's browser.
2. **Store rows, not files** — the grid and its report become columns on the
   scene row, fetched with the rest of the scene record.
3. **Keep on-demand generation as the fallback** for a scene with no stored
   collision, so dropping in a splat still works.

Baking stays worth doing even once it is automated, for two reasons: the file is
a few KB and so arrives long before the splat, letting the player be placed on
solid ground while the scene resolves; and it puts a human in front of the QA
report before a scene goes live. Generated purely on demand, a scan whose
up-axis detection fails silently drops the visitor through the world.

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
