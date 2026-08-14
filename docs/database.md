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
  string.
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
