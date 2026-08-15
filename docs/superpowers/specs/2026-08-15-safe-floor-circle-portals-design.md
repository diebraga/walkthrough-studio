# Safe floor-circle portals

## Goal

Keep reciprocal portals dynamic for arbitrary scene graphs while ensuring that
portal arrivals never place the walker inside a return trigger. Present every
portal as a clear circle on the floor, without a vertical beam.

## Root cause

The reciprocal importer currently places a generated return portal at the
forward portal's destination spawn and places its return spawn at the original
portal position. Both arrival points therefore coincide with portal trigger
centres. The activation lock prevents an immediate reload loop, but the walker
still arrives on top of a portal and must escape that trigger before returning.

The renderer also combines a floor glow with crossed vertical beam geometry.
That conflicts with the required floor-circle presentation.

## Reciprocal placement

Authored forward portal positions and destination spawns remain unchanged. Only
the generated reverse portal and its generated return spawn are offset.

For a pose with yaw `theta`, its forward direction is:

```text
forward.x = -sin(theta)
forward.z = -cos(theta)
```

The clearance for each generated placement is the forward portal's trigger
radius plus `0.7` metres. A point behind a pose is:

```text
behind.x = pose.x - forward.x * clearance
behind.z = pose.z - forward.z * clearance
```

Therefore:

- the generated reverse portal in the destination node is placed behind the
  authored destination spawn, using the destination spawn yaw;
- the reverse portal's destination spawn in the source node is placed behind
  the original forward portal, using the forward portal yaw;
- Y coordinates are preserved from their corresponding authored points;
- the generated reverse portal yaw remains the authored destination spawn yaw;
- the generated return spawn yaw remains the original forward portal yaw plus
  `PI`, normalized to `[-PI, PI)`, with pitch `0`;
- the generated portal keeps the forward portal radius and stable generated
  metadata/key behavior.

Because the clearance is strictly greater than the trigger radius, arrivals are
outside the generated portal circle in either direction. Existing explicit
reverse portals remain authoritative and are never moved or synthesized over.

## Portal presentation

Each active-scene portal is rendered only as a flat radial-gradient circle on
the floor. The centre uses the existing normal blue or active yellow and the
edge fades to transparent through additive vertex colouring.

The circle keeps the existing `1.7` metre visual radius, `0.12` metre floor
offset, additive blending, double-sided rendering, disabled depth testing and
depth writing, and render order `10000`. These depth-independent settings keep
it visible through splat haze. The vertical beam, beam dimensions, spin speed,
renderer spin state, and per-frame rotation call are removed.

## Runtime behavior

Neon remains the canonical runtime graph. The browser does not invent reverse
portals. The existing arrival activation gate remains as defensive protection
for explicit portals, overlapping triggers, and unusual authored geometry.
Geometric separation and activation lockout serve different purposes: the
former gives a natural landing position, while the latter prevents accidental
activation during transitions.

## Generic verification

Automated tests use invented node names, positions, yaws, and radii. They must
not name hall, balcony, a property slug, asset file, production database row,
or a fixed production portal count.

- Reciprocal tests prove the exact behind-pose math for destination and source
  placement, including non-zero yaw and a radius other than the production
  value.
- Reciprocal tests prove both generated arrival points are farther from their
  associated portal centres than the trigger radius.
- Existing generic tests continue to cover explicit-reverse precedence,
  idempotence, non-recursion, multiple forward links, missing destinations,
  metadata, and yaw normalization.
- Renderer tests prove the geometry lies entirely on the floor plane, reaches
  the `1.7` metre visual radius, contains no elevated beam vertices, and retains
  the depth-independent material and render-order contract.
- Discovery tests may validate generic graph invariants but must not assert the
  current repository dataset has a specific portal count.
- Run the focused generic portal tests, convention checks, and production
  build. No browser traversal test tied to particular scenes is required for
  this correction.

## Scope

This correction changes generated reciprocal placement, the portal marker
geometry, the renderer lifecycle needed by that geometry, and their generic
tests. It does not change authored portal data, database schema, API shapes,
collision behavior, scene assets, or unrelated UI.
