# Database-Backed Scene Runtime Design

## Goal

Make Neon Postgres the canonical runtime source for the current Nashville place,
scene nodes, collision data, assets, and portal relationships without redesigning
the existing Aholo renderer or moving large Gaussian-splat binaries into Postgres.

## Current state

`GET /api/scenes` already reads the entire imported graph through the shared
Prisma client in one relational query. The renderer does not consume it: it
hard-codes `hall` and `balcony` schemes, loads `collision.json`,
`manual-collision.json`, and `portals.json` from static folders, and identifies a
portal target by an application scheme string. `.ply` files are loaded from the
same relative paths or from `VITE_SPLAT_BASE_URL`.

The database does not currently model a node's default camera pose. Those small
presentation defaults remain application configuration. The unrelated outdoor
demo is not imported and remains an explicitly legacy static scheme.

## Architecture

### API

Retain `GET /api/scenes` for graph listing and add
`GET /api/scenes/:placeSlug` for the runtime. Both routes use a shared Prisma
selection and serializer, including all nodes, collision JSON, asset references,
and outgoing portal destinations. The place route returns `404` for an unknown
slug. It does not expose Prisma or database credentials.

The Prisma query loads the graph with nested `select` clauses in one request;
there is no query per node, asset, or portal.

### Frontend catalog boundary

Add a focused `src/walk-demo/scene-catalog.ts` module. It owns the API response
types, runtime validation, graph fetch, and conversion into renderer scene
descriptors. `walk-demo.ts` consumes those descriptors rather than knowing the
database response shape.

Each descriptor contains the immutable node ID, readable node slug/name, resolved
Gaussian-splat URL, structured collision data, structured manual collision data
when present, directional portals, asset base for dev-authoring tools, and the
existing application-side default pose.

The initial runtime requests place slug `23_nashville_dr_tenessee`. Node selection
uses slugs for readable UI and immutable node IDs for portal relationships.
Missing places, nodes, splat assets, malformed collision data, and invalid portal
destinations produce explicit errors rather than an unhandled renderer crash.

### Assets

`GAUSSIAN_SPLAT` rows remain references. An `objectKey` that is an absolute URL
can be used directly. Otherwise `originalPath` is normalized from
`public/<place>/<node>/index.ply` to `/<place>/<node>/index.ply` and resolved
through the existing `VITE_SPLAT_BASE_URL` mechanism. No `.ply` content passes
through Hono, Prisma, or Postgres.

### Collision and manual collision

For database nodes, `SceneNode.collisionData` is passed directly to
`walk.loadCollisionGrid()` and levelling rotation is applied as before. The
renderer no longer fetches `collision.json` for those nodes.

Imported `MANUAL_COLLISION` asset metadata is adapted into the existing manual
collision structure. Dev-only editing may continue saving the source JSON file;
that workflow remains migration authoring input and does not become a production
database write API in this task.

### Portals

The API already emits `toNodeId`, destination slug, and the exact trigger/spawn
values. Runtime portal records retain `toNodeId`. Teleport resolution looks up
the destination descriptor by immutable node ID and preserves position, radius,
yaw, spawn position, spawn yaw, and spawn pitch. Invalid destinations are ignored
safely and reported.

### Startup and errors

The entry module fetches and validates the graph before constructing the walk
application. Existing loading UI remains visible while metadata loads. A metadata
failure reaches the existing top-level error path, logs a useful message, and
shows the current fallback scene instead of leaving a black or crashed renderer.

There is no silent static metadata fallback for a migrated database place because
that would create two competing canonical sources. The source JSON files remain
on disk for import, authoring, and rollback. The non-migrated outdoor demo remains
a deliberately isolated legacy descriptor.

## Testing and verification

Tests cover:

- API list and place responses, including unknown-place `404`;
- catalog validation and Nashville hall/balcony adaptation;
- static and Blob splat URL resolution;
- collision and manual-collision handoff without metadata fetches;
- ID-based portal destination resolution and exact spawn preservation;
- missing scene, missing splat, malformed collision, and invalid portal target;
- convention checks, database tests, typecheck, and production build.

Runtime verification calls the API directly, starts the actual app, confirms the
hall and balcony splats are requested from external/static storage, confirms no
runtime requests for collision or portal JSON, and exercises hall-to-balcony
teleportation with the imported spawn pose. The final Vercel deployment is tested
through the production alias and correlated with build/runtime logs.

## Documentation

Update the database, API, and scene-asset documentation to state that Neon is the
canonical metadata source, Hono is the frontend boundary, collision and portal
metadata are database-backed, and large splats remain external. New runtime code
must not infer scene relationships from filesystem paths.
