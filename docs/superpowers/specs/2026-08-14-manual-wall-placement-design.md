# Manual wall placement

## Goal

Change only the manual wall created when a developer presses **Add wall
collision**. Do not change baked collision, capsule resolution, collision-file
format, erasing, saving, floors, or any other collision behavior.

## Placement behavior

Each press continues appending one independent entry to `manualCollision.walls`.
The new wall is centered 1.5 metres in front of the walker's current pose, as it
is today.

The created wall has these fixed dimensions:

- width: `3` metres (increased from `1.4`)
- depth: `0.24` metres (unchanged)
- height: the existing manual-collision wall height, defaulting to `2` metres
  (unchanged)

The wall's long width axis must span across the walker's view at every heading.
The walk controller and manual-box transform use opposite yaw signs, so placement
stores the negated walker yaw in the wall entry. Existing saved walls are not
migrated or modified; the correction applies only to walls added after this
change.

## Implementation boundary

Extract a small pure placement helper from the button handler so orientation and
dimensions are directly testable without constructing the 3D application. The
handler calls the helper and appends its returned wall. All renderer, debug
overlay, persistence, and collision-query code continue consuming the existing
`ManualWallCollision` shape unchanged.

## Verification

Unit tests cover walker headings of 0, 45, and 90 degrees and assert that the
created wall's long axis is perpendicular to the walker's forward direction.
Tests also assert the exact `3 × 0.24` footprint and that repeated placement
appends rather than replaces existing walls. The database suite, convention
suite, and production build must remain green.
