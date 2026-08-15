# Visible reciprocal portals

## Goal

Make linked scene portals an obvious, always-visible part of the visitor
experience and make every linked portal traversable in both directions without
causing automatic back-and-forth scene reloads.

## Portal presentation

Portal rendering is runtime presentation, not developer debug UI. Every portal
in the active scene is visible in development and production without a flag,
toggle, or local-storage setting. The developer portal panel remains gated by
the existing `portals` flag for capture, editing, and deletion only.

The placement and presentation details in this design are superseded by the
[safe floor-circle portals design](2026-08-15-safe-floor-circle-portals-design.md).
Portals are static floor circles; their geometry and materials live in a
portal-specific renderer rather than remaining coupled to the manual-collision
debug overlay.

## Reciprocal data model

The existing `Portal` table remains directional and requires no schema change.
The import plan becomes responsible for completing the directional graph.

For every explicit linked portal `A -> B`, the importer checks whether node B
already has an explicit portal targeting A. If one exists, it is authoritative
and no generated record is created. Otherwise the importer generates one
directional `B -> A` record with a stable source key derived from the original
portal source key.

The generated return portal follows the placement rules in the
[safe floor-circle portals design](2026-08-15-safe-floor-circle-portals-design.md):

- position: behind the forward portal's configured destination spawn position
  in B by the forward portal's radius plus `0.7` metres, preserving that spawn's
  Y coordinate;
- yaw: the forward portal's destination spawn yaw;
- radius: the forward portal's radius;
- destination: node A;
- return spawn position: behind the forward portal's original position in A by
  the forward portal's radius plus `0.7` metres, preserving that position's Y
  coordinate;
- return spawn yaw: the forward portal yaw rotated by 180 degrees and normalized;
- return spawn pitch: `0`;
- metadata identifying it as generated and recording the originating source key.

Generated portals participate in the same Prisma upsert as explicit portals.
Their stable source keys make repeated imports update rather than duplicate
them. Import reconciliation removes generated records that are no longer part
of the complete plan, including when an explicit reverse portal replaces one.
Neon remains the canonical runtime portal graph.

## Loop prevention

Portal activation has an arrival lock independent of portal names and IDs.
Normal startup is armed. Immediately before a portal-driven scene reload, portal
activation is disarmed. In the destination scene, every portal trigger is
ignored while the walker remains inside any portal radius. The system rearms
only after a frame in which the walker is outside all portal radii.

This permits deliberate return travel: arrive in B, walk out of the generated
return portal, then step back into it to return to A. It also handles explicit
reverse portals and overlapping arrival triggers without relying on matching
names. Visual active-state updates continue while activation is disarmed.

## Components and data flow

1. Authoring captures and links an explicit `A -> B` portal with a destination
   spawn.
2. Scene discovery validates explicit portal destinations and completes missing
   reverse directions in the import plan.
3. The Prisma importer reconciles and upserts the complete portal set.
4. Hono returns both directional records from Neon without synthesizing data.
5. The scene catalog and runtime use the existing directional portal shape.
6. The portal renderer displays every active-scene portal above splat depth.
7. The traversal controller applies arrival lockout across scene reloads.

## Failure handling

Import fails before opening a transaction when a destination node is missing or
a linked portal lacks a usable spawn. Generated keys are deterministic and must
not collide with explicit source keys. More than one explicit reverse portal is
allowed because the author may intentionally provide multiple ways back; its
presence suppresses only generation of the default reverse portal.

No runtime reverse portal is invented when Neon lacks one. This makes incomplete
imports visible during inspection instead of splitting authority between the
database and browser.

## Verification

- Geometry tests assert the flat floor-circle radius, floor offset,
  depth-independent material settings, and render order.
- Import tests cover reverse generation, explicit-reverse precedence, stable
  idempotent keys, return yaw normalization, and stale generated-row removal.
- Traversal tests cover A-to-B arrival without immediate return, rearming only
  after exiting every portal radius, deliberate B-to-A return, and overlapping
  arrival portals.
- Runtime tests assert portal visuals are created when no developer flags are
  active.
- Focused generic portal tests, convention tests, and the production build pass.
