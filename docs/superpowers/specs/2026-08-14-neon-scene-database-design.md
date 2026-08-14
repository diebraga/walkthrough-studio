# Neon scene database design

## Goal

Provision Neon Postgres through the linked Vercel project, add Prisma as the
database layer, and import the current `public/` scene tree into an idempotent
relational representation without changing the renderer or deleting source
files.

## Discovered source dataset

The repository currently contains one place directory and two scene-node
directories:

```text
public/23_nashville_dr_tenessee/
├── balcony/
│   ├── collision-report.json       799 bytes
│   ├── collision.json           13,512 bytes
│   ├── index.ply             309,409,303 bytes
│   └── manual-collision.json       224 bytes
└── hall/
    ├── collision-report.json       688 bytes
    ├── collision.json           13,887 bytes
    ├── index.ply             163,141,743 bytes
    └── portals.json                396 bytes
```

There are no thumbnails, previews, place metadata files, additional places,
or additional scene nodes. `hall/portals.json` contains one directional portal
from hall to balcony. Both collision files are small structured JSON documents
and are suitable for Postgres JSONB. Both PLY files are hundreds of megabytes
and must remain outside Postgres.

## Provisioning and connection strategy

Use the authenticated Vercel CLI marketplace integration. Recheck existing
project resources immediately before mutation; reuse a connected Neon resource
if one appears. Otherwise create one Neon resource for `walkthrough-studio` and
connect it to development, preview, and production without a variable prefix.

Pull environment variables through `vercel env pull` into an ignored local env
file. Never print connection values. Use the pooled `DATABASE_URL` for runtime
queries. Use `DATABASE_URL_UNPOOLED` for Prisma migrations when the integration
provides it, falling back to `DATABASE_URL` only if the unpooled variable is not
available.

## Prisma configuration

Install mutually compatible current versions of `prisma`, `@prisma/client`,
`@prisma/adapter-neon`, and `@neondatabase/serverless`. Use Prisma's current
configuration format as reported by the installed CLI rather than assuming an
older generator or datasource convention.

Generate the client into a repository-local generated directory that is
gitignored. Centralize runtime construction in `server/db.ts`; route modules
must import the shared client rather than instantiate `PrismaClient`.

The shared client uses the Neon adapter and a development global cache so Vite
hot reload does not create unbounded clients. Serverless invocations reuse the
module-scoped instance when the runtime reuses an isolate.

## Relational model

### Place

- `id`: UUID primary key
- `slug`: unique stable import key
- `name`: display name
- `description`: optional text
- `metadata`: optional JSONB
- `createdAt`, `updatedAt`: timestamps
- relation to many scene nodes

No user or owner row is created. A future nullable/required `ownerId` can be
added to `Place` by migration when authentication exists.

### SceneNode

- `id`: UUID primary key
- `placeId`: immutable foreign key to Place, cascade delete
- `slug`: stable within its place
- `name`: display name
- `collisionData`: optional JSONB containing parsed `collision.json`
- `metadata`: optional JSONB containing import provenance
- `createdAt`, `updatedAt`: timestamps
- unique `(placeId, slug)`
- relations to assets, outgoing portals, and incoming portals

### SceneAsset

- `id`: UUID primary key
- `sceneNodeId`: foreign key to SceneNode, cascade delete
- `type`: enum `GAUSSIAN_SPLAT`, `COLLISION_REPORT`, `MANUAL_COLLISION`, `OTHER`
- `objectKey`: optional object-storage key; null for files only served locally
- `originalPath`: repository-relative source path
- `mimeType`: MIME type
- `sizeBytes`: bigint
- `metadata`: optional JSONB
- `createdAt`, `updatedAt`: timestamps
- unique `(sceneNodeId, originalPath)`

The two PLY records contain references and sizes only. Collision-report and
manual-collision JSON remain source assets and preserve their parsed content in
asset metadata. `collision.json` is not duplicated as an asset because its
content is the node's `collisionData`. `portals.json` is represented by Portal
rows rather than as an asset.

### Portal

- `id`: UUID primary key
- `fromNodeId`, `toNodeId`: foreign keys to immutable SceneNode IDs
- `sourceKey`: deterministic key derived from source path and array index
- `name`
- `positionX`, `positionY`, `positionZ`
- `yaw`, `radius`
- `spawnX`, `spawnY`, `spawnZ`, `spawnYaw`, `spawnPitch`
- `metadata`: optional JSONB containing unknown meaningful source properties
- `createdAt`, `updatedAt`: timestamps
- unique `(fromNodeId, sourceKey)`

Hall→balcony and balcony→hall are distinct records. The legacy `to` slug is
used only while resolving the import and is not persisted as relational
identity.

## Import process

Implement discovery separately from persistence so filesystem classification
can be tested without a database. Discovery recursively examines immediate
place and node directories, validates JSON shapes, gathers file byte sizes,
and returns a typed import plan.

Persistence runs one transaction and follows two passes:

1. Upsert every Place, SceneNode, and SceneAsset using schema uniqueness.
2. Resolve each portal destination slug inside the same place to a SceneNode
   ID and upsert the directional Portal.

Existing imported records are updated from source truth. Records outside the
discovered source set are not deleted. Running the importer repeatedly must
leave row counts and immutable IDs unchanged.

The legacy place slug receives the display name `23 Nashville Dr Tennessee`;
unknown future slugs use deterministic title-casing. Every record stores source
path/provenance metadata where appropriate.

Unknown files are registered as `OTHER` assets with MIME type and byte size;
unknown JSON content is parsed into metadata rather than discarded. Invalid
JSON, invalid portal shapes, or unresolved portal destinations fail the import
before partial persistence.

## Read API

Add `server/routes/scenes.ts` and mount it at `/scenes` under the existing Hono
`/api` base path. `GET /api/scenes` returns all places ordered by slug, with
nodes, assets, and outgoing portals. Portal responses include destination node
ID and destination slug/name for frontend convenience. Bigint asset sizes are
serialized as decimal strings because JSON cannot encode bigint directly.

The endpoint exposes no connection data and does not change current frontend
fetching.

## Commands and migrations

Add package commands for Prisma generation, schema validation, migration
development/deployment, import, and Studio. Create and commit a real initial
migration; application startup never creates or modifies tables.

The production build runs Prisma generation before TypeScript compilation so
Vercel always has the generated client. Existing project convention checks
remain first in the build.

## Tests and verification

Test source discovery/classification, portal preservation/resolution input,
unknown-file handling, bigint API serialization, and the route using an
injected database boundary where appropriate. Then verify against Neon:

- schema validation and client generation;
- initial migration deployment;
- importer succeeds twice;
- second run preserves counts and IDs;
- one Place, two SceneNodes, five SceneAssets, and one Portal exist;
- collision values are JSONB objects, not strings;
- PLY bytes are not stored in Postgres;
- portal coordinates and both node foreign keys match source data;
- local API returns the imported graph;
- existing tests, typecheck, Vite build, and Vercel production build pass;
- deployed API returns the imported graph after the Git/Vercel deployment.

## Documentation

Add a concise database document to the `AGENTS.md` index. It records Neon,
Prisma, the model relationships, JSONB collision storage, external PLY storage,
directional portal IDs, the public-directory migration source, commands, and
the requirement that all future schema changes use migrations.

## Non-goals

- No users, authentication, or fake ownership rows.
- No PLY upload or movement.
- No renderer migration to API-provided scene configuration.
- No deletion or rewriting of `public/` source data.
- No unrelated Hono, Vite, UI, or deployment redesign.
