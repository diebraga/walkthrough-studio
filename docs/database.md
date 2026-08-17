# Database

Index: [../AGENTS.md](../AGENTS.md).

Neon Postgres is the persistent relational database. Prisma 7 is the ORM and
the only schema-migration mechanism. Runtime code uses the pooled
`DATABASE_URL`; Prisma migrations use `DATABASE_URL_UNPOOLED` through
`prisma.config.ts` when Vercel supplies it. Both values are Vercel-managed
secrets and must never be committed or printed.

## Scene graph

```text
Place
└── SceneNode
    ├── SceneAsset
    ├── outgoing Portal ──> SceneNode
    └── incoming Portal <── SceneNode
```

- A Place is a complete property/location and has a stable UUID plus a unique
  slug.
- A SceneNode is one walkable Gaussian-splat section. Its parsed
  `collision.json` is stored as native Postgres JSONB, not as an escaped JSON
  string. It also carries one canonical arrival pose (`poseX/Y/Z/Yaw/Pitch`),
  used regardless of which portal — or direct load — brought the walker there.
- A SceneAsset stores an external reference, MIME type, byte size, and optional
  metadata. Large `index.ply` splats are never stored as database blobs.
- A Portal is directional. Both endpoints are immutable SceneNode UUID foreign
  keys; legacy destination slugs are used only during import resolution.
- User ownership will eventually attach to Place. No user or fake owner exists
  yet.

## Runtime data flow

```text
Neon -> shared Prisma client -> Hono place graph -> frontend scene catalog -> renderer
SceneAsset reference -> public/ or object storage -> renderer
```

Neon is canonical for migrated place/node metadata, structured collision JSON,
asset references, and directional portals. The frontend never accesses Prisma
directly. It fetches one place graph from Hono, passes collision and portals to
the renderer in memory, and resolves portal targets by immutable node UUID.

Large splats remain outside Postgres. The catalog turns their `objectKey` or
`originalPath` into the same static/Blob URL used by the renderer.

## Initial source import

The initial dataset remains under `public/<place>/<scene>/`. It is migration and
developer-authoring input, not the runtime metadata authority, and must not be
deleted yet. The importer discovers directories, stores
collision JSON on SceneNode, registers PLY/report/manual-collision assets, and
resolves portal destination slugs to node IDs. Upserts and schema uniqueness
make repeated imports idempotent.

```sh
pnpm db:import
```

Unknown files become `OTHER` assets so they are not silently discarded.

### Reciprocal portal completion

Portal authoring remains directional: for an intended `A -> B` link, the author
sets the target scene and an explicit destination spawn in B. Scene coordinate
frames are unrelated, so that spawn must be captured in the target scene; it
cannot be inferred from the portal position in A.

During discovery, the importer completes the graph before writing it to Neon.
If B has no explicit portal targeting A, it generates a default `B -> A`
direction whose position and yaw are the forward destination spawn, whose radius
matches the forward portal, and whose return spawn is the original portal
position in A (facing back through it). Generated source keys are stable, so
repeated imports update rather than duplicate these rows.

An explicit `B -> A` portal is authoritative and suppresses the generated
default. Import reconciliation also removes a formerly generated row when an
explicit reverse replaces it. Neon stores the resulting complete directional
graph; the API and browser never synthesize missing reverse portals at runtime.

This reciprocal completion applies only to legacy file imports. Portals created
through `/api/portals` are written directly to Neon and remain directional. A
developer creates the return direction separately from the destination scene.

### Runtime portal authoring

The developer portal panel reads destinations from the current place graph and
excludes the active scene. A new portal uses the walker's current position and
yaw for its trigger and links to the chosen destination; arrival uses whatever
pose that destination scene already has. Portal create/delete go through
`/api/portals`; a scene's own pose is re-captured separately, from within that
scene, through `/api/scenes`. Neither rewrites `public/**/portals.json`.

Set `PORTAL_AUTHORING_ENABLED=1` only in a developer server environment. Both
mutation routes default off, while graph reads and portal traversal remain
available normally.

## Commands

```sh
pnpm db:validate         # validate schema.prisma
pnpm db:generate         # generate @prisma/client
pnpm db:migrate -- --name <change>  # create/apply a development migration
pnpm db:migrate:deploy   # apply committed migrations
pnpm db:import           # import/update public scene data
pnpm db:inspect          # print a secret-free imported graph summary
pnpm db:studio           # inspect data locally
pnpm test:database       # database-layer unit tests
```

Every database schema change must update `prisma/schema.prisma`, create a named
migration under `prisma/migrations/`, and pass validation. Do not use ad-hoc
`CREATE TABLE` calls or mutate schema during application startup.
