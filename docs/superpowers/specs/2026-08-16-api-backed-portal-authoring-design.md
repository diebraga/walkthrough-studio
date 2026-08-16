# API-backed portal authoring design

## Goal

Restore the developer portal-authoring workflow while making Neon Postgres the
runtime and authoring authority. A developer standing in one scene chooses a
different scene in the same place, adds a directional portal at the current
walker position, and lands at the destination scene's normal Scene-selector
spawn pose when traversing it.

Portal rendering remains visible to every visitor. Only the controls and API
mutations used to author portals remain developer-only.

## Authoring workflow

The existing Portals developer panel gains a required Destination selector. Its
options come from the place graph already fetched by the application at startup,
so authoring does not introduce another scene-discovery request. The selector
lists database-backed scenes in the current place except the active scene. A
developer in Hall can select Balcony; a developer in Balcony can select Hall;
neither can select the scene they are currently walking.

The Add portal action is disabled or rejected until a destination is selected.
On creation:

1. The source is the active scene-node ID.
2. The trigger position and yaw come from the current walker state.
3. The destination is the selected scene-node ID.
4. The arrival pose is the selected scene's `scheme.pose`, which is the same
   default used when that scene is chosen from the top Scene selector.
5. The portal radius uses the existing default.

Creation is directional. Creating Hall to Balcony never creates Balcony to
Hall. A developer must enter Balcony and explicitly create the return portal.
Changing scenes clears an in-progress destination selection so a stale choice
cannot be applied from the wrong source scene.

## API and persistence

A Hono route module mounted at `/api/portals` owns portal mutations. In keeping
with the deployment routing constraint, the module defines methods only at its
mounted `/` path rather than nested URL handlers. Relative backend imports use
explicit `.js` extensions.

The route supports the existing authoring lifecycle:

- Create a directional portal.
- Update its editable radius.
- Delete it.

Each mutation writes through Prisma to Neon. The create operation validates
that the source and destination nodes exist, belong to the same place, and are
different nodes. It validates finite pose and radius values and generates a
stable source key suitable for the existing `(fromNodeId, sourceKey)` unique
constraint. Update and delete operations verify the target portal belongs to
the declared active source node before changing it.

Successful responses return the serialized portal needed by the frontend. The
client changes its in-memory portal list only after the server confirms the
mutation, preventing failed writes from creating temporary traversable portals.
The active scene scheme is updated at the same time so subsequent scene reloads
within the current session retain the change.

The old `public/<place>/<scene>/portals.json` write path is not used for this
workflow. Those files remain import and developer-authoring inputs, but Neon is
the runtime authority.

## Developer-only boundary

The UI remains guarded by `VITE_DEV_FLAGS=portals`, which is already inert in a
production frontend build. The mutation route adds a server-side authoring gate
that defaults off. Local or explicitly authorized developer environments must
enable it; otherwise mutation requests return not found or forbidden without
touching the database. Read-only scene and portal traversal APIs remain
unchanged.

The server-side gate is required because hiding frontend controls alone does
not protect an HTTP mutation endpoint.

## Rendering and traversal

Portal markers remain owned by the normal portal renderer and are visible
regardless of developer flags or collision-overlay state. The marker is updated
immediately after a successful create, radius change, or deletion. Existing
entry gating, fade, scene switching, and reciprocal ping-pong prevention remain
unchanged.

The destination pose stored on the portal is copied at creation time. Future
changes to a scene's presentation pose affect newly authored portals but do not
silently rewrite existing portal arrivals.

## Error handling

The developer panel reports validation, authorization, network, and database
failures in its existing portal status field. A failed create leaves the local
list unchanged. A failed radius update restores the last confirmed radius. A
failed deletion keeps the portal visible and traversable.

The API uses explicit client-error responses for invalid identifiers,
self-targeting, cross-place targets, malformed numeric values, and duplicate
names/source keys. Unexpected database failures are reported without exposing
credentials or connection details.

## Testing

Tests cover:

- Destination options exclude the active scene and retain other place nodes.
- Scene changes clear or recompute the destination choice.
- Creation requires a destination and uses the selected scene's `scheme.pose`.
- Creation produces only the requested direction.
- API validation rejects self-targeting and cross-place portals.
- Create, radius update, and delete call the expected Prisma operations.
- Failed mutations do not leave optimistic local state behind.
- Portal rendering remains independent of developer flags.
- Existing portal activation and teleport tests continue to pass.

Repository completion requires `pnpm test:conventions && pnpm build`, plus the
focused portal and API test suites.
