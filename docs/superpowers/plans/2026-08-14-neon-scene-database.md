# Neon Scene Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision Neon through Vercel, create the initial Prisma scene graph, import `public/` idempotently, expose a minimal read API, and verify it locally and in production.

**Architecture:** Prisma owns the relational schema and migrations; a shared Neon-adapted client is the only runtime database entry point. A filesystem discovery module produces a database-independent import plan, a persistence module upserts that plan transactionally, and one Hono route serializes the graph for clients.

**Tech Stack:** Neon Postgres, Prisma ORM, `@prisma/adapter-neon`, `@neondatabase/serverless`, TypeScript, Hono, Vercel CLI, Node test runner.

## Global Constraints

- Preserve Hono's shared app and direct Vercel export architecture.
- Preserve all current files under `public/` and do not move PLY assets.
- Store parsed collision structures as Prisma `Json`/Postgres JSONB, never escaped strings.
- Store only PLY references and metadata in Postgres, never PLY bytes.
- Use migrations for schema changes; never create tables at application startup.
- Keep all relative imports under `server/`, `api/`, and `adapters/` extension-complete with `.js`.
- Do not add users, authentication, or fake owners.
- Never print or commit database secrets.

---

### Task 1: Provision and configure Neon/Prisma

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `prisma.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: connected Vercel Neon resource and ignored local environment file.
- Produces: compatible Prisma CLI/client, Neon adapter, and serverless driver dependencies.

- [ ] **Step 1: Recheck Vercel resources**

Run `npx vercel integration list walkthrough-studio`. Reuse an existing Neon resource if present.

- [ ] **Step 2: Provision only when absent**

Run the current CLI's non-interactive Neon marketplace command with a free plan, resource name `walkthrough-studio-db`, all three environments, automatic project connection, and env pull. If legal terms require one interactive acceptance, use the CLI's official `accept-terms` flow; stop only if human browser authorization is unavoidable.

- [ ] **Step 3: Pull environment securely**

Run `npx vercel env pull .env.local --environment=development --yes`. Inspect names only and confirm `DATABASE_URL` plus an unpooled/direct variable where available.

- [ ] **Step 4: Install current compatible dependencies**

Run:

```sh
pnpm add @prisma/client @prisma/adapter-neon @neondatabase/serverless
pnpm add -D prisma tsx
```

- [ ] **Step 5: Configure Prisma CLI**

Create `prisma.config.ts` using the installed Prisma version's official config API. Load `.env.local` without exposing values and select `DATABASE_URL_UNPOOLED ?? DATABASE_URL` for migrations. Ignore the generated client directory.

- [ ] **Step 6: Commit dependency/configuration changes**

```sh
git add package.json pnpm-lock.yaml prisma.config.ts .gitignore
git commit -m "build: configure Prisma for Neon"
```

### Task 2: Relational schema, migration, and shared client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_init_scene_database/migration.sql`
- Create: `server/db.ts`
- Create: `server/db.test.ts`

**Interfaces:**
- Produces: `Place`, `SceneNode`, `SceneAsset`, `Portal`, `SceneAssetType`.
- Produces: shared `db` Prisma client and `createDatabaseClient(url)`.

- [ ] **Step 1: Add a failing database-client shape test**

Assert that importing `server/db.ts` exposes one shared client factory and that missing `DATABASE_URL` produces an actionable error only when the database is used, not while unrelated build code imports the Hono app.

- [ ] **Step 2: Verify RED**

Run `pnpm tsx server/db.test.ts`; expect failure because `server/db.ts` does not exist.

- [ ] **Step 3: Write the Prisma schema**

Implement UUID IDs, JSON fields, timestamp defaults, relations, indexes, and unique constraints exactly as specified. Generate the client into `server/generated/prisma` or the installed Prisma version's supported equivalent.

- [ ] **Step 4: Implement one Neon-adapted client**

Use `PrismaNeon` with the pooled runtime URL. Cache the client on `globalThis` in development. Export a lazy accessor if required to prevent database configuration from breaking frontend-only builds.

- [ ] **Step 5: Validate, generate, and create migration**

Run Prisma format/validate/generate, then create the initial migration with `prisma migrate dev --name init_scene_database` against Neon. Inspect generated SQL for JSONB columns, foreign keys, unique indexes, and no binary PLY column.

- [ ] **Step 6: Verify GREEN and commit**

Run the client test and Prisma validation, then commit schema, migration, client, and test.

### Task 3: Test-first filesystem discovery and idempotent importer

**Files:**
- Create: `tools/scene-import/discover.ts`
- Create: `tools/scene-import/discover.test.ts`
- Create: `tools/scene-import/import.ts`
- Create: `tools/scene-import/import.test.ts`
- Create: `tools/import-scenes.ts`

**Interfaces:**
- Produces: `discoverSceneImport(root): Promise<SceneImportPlan>`.
- Produces: `persistSceneImport(prisma, plan): Promise<ImportSummary>`.
- Produces: CLI summary containing counts only, no secrets.

- [ ] **Step 1: Write failing discovery tests**

Create temporary fixtures covering multiple places/nodes, JSON parsing, exact PLY sizes, report/manual metadata, unknown files, portal fields, unknown portal metadata, invalid JSON, and unresolved destination input.

- [ ] **Step 2: Verify discovery RED**

Run `pnpm tsx tools/scene-import/discover.test.ts`; expect missing implementation failure.

- [ ] **Step 3: Implement discovery minimally**

Return a typed plan with place/node/asset/portal source records. Use deterministic ordering and source keys such as `public/<place>/<node>/portals.json#0`. Classify every actual file according to the spec.

- [ ] **Step 4: Verify discovery GREEN and real dataset**

Run tests and a dry discovery of `public/`; expect 1 place, 2 nodes, 5 assets, 1 portal, no unclassified files.

- [ ] **Step 5: Write failing persistence tests**

Use a small in-memory fake Prisma transaction surface to assert two-pass upserts, ID-based portal resolution, stable unique keys, second-run update behavior, and failure before portal persistence when a destination is absent.

- [ ] **Step 6: Implement transactional persistence and CLI**

Upsert places, nodes, assets, then portals inside one transaction. Convert filesystem sizes to bigint. Preserve parsed JSON objects without stringification. Do not delete undiscovered rows.

- [ ] **Step 7: Verify GREEN and commit**

Run both importer test files and commit the discovery/import modules and CLI.

### Task 4: Minimal database read API

**Files:**
- Create: `server/routes/scenes.ts`
- Create: `server/routes/scenes.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Produces: `GET /api/scenes` returning `{ places: [...] }`.
- Assets serialize `sizeBytes` as a decimal string.
- Portals include `toNodeId`, `toNodeSlug`, and `toNodeName`.

- [ ] **Step 1: Write failing route test**

Inject a scene-reader function returning representative Prisma-shaped rows with bigint sizes and directional portal relations. Assert status 200 and frontend-safe JSON.

- [ ] **Step 2: Verify RED**

Run `pnpm tsx server/routes/scenes.test.ts`; expect missing route failure.

- [ ] **Step 3: Implement and mount route**

Keep query construction inside the route's reader boundary, use the shared client, order deterministically, serialize bigint, and mount with `app.route("/scenes", scenes)` using `.js` imports.

- [ ] **Step 4: Verify GREEN and existing Hono checks**

Run the route test, Vercel entry test, and AWS adapter test.

- [ ] **Step 5: Commit**

Commit the route, test, and app mount.

### Task 5: Scripts, build integration, and documentation

**Files:**
- Modify: `package.json`
- Modify: `AGENTS.md`
- Create: `docs/database.md`
- Modify: `docs/api.md`

**Interfaces:**
- Produces: `db:generate`, `db:validate`, `db:migrate`, `db:migrate:deploy`, `db:import`, `db:studio`.
- Production build generates Prisma before TypeScript.

- [ ] **Step 1: Add package scripts and build generation**

Keep `check:conventions` first, then Prisma generation, TypeScript, and Vite. Add import/test commands using `tsx`.

- [ ] **Step 2: Document the database architecture**

Add `docs/database.md` to the AGENTS index and document Neon, Prisma, model ownership, JSONB collision storage, external PLY storage, directional portal IDs, import source, commands, and migration-only schema changes. Add the read endpoint to API docs.

- [ ] **Step 3: Verify scripts and commit**

Run database validation/generation, importer tests, route tests, convention tests, typecheck, and production build; then commit.

### Task 6: Migrate, import twice, and inspect Neon

**Files:**
- Database state only; no planned source edits.

**Interfaces:**
- Produces: migrated and imported Neon database.

- [ ] **Step 1: Deploy the committed migration**

Run `pnpm db:migrate:deploy` with the pulled unpooled/direct URL.

- [ ] **Step 2: Run import twice**

Capture count-only summaries. Query IDs/counts after each run and prove the second run creates no duplicates or ID churn.

- [ ] **Step 3: Inspect relationships and JSON types**

Query through Prisma and print a secret-free structured summary: place→nodes→asset paths and portal destination slugs. Verify PostgreSQL `jsonb_typeof(collisionData) = 'object'`, exact portal coordinates, asset byte sizes, and no binary columns.

- [ ] **Step 4: Test local API**

Start Vite, call `/api/scenes`, validate response counts and relationships, call the existing health route, then stop the server.

### Task 7: Full verification and production deployment

**Files:**
- Verify only unless diagnosis identifies a specific defect.

**Interfaces:**
- Produces: deployed Git commit and verified production database API.

- [ ] **Step 1: Run fresh local verification**

Run all new tests, existing `*.test.ts` scripts where configured, convention checks, Prisma validate/generate, typecheck, Vite build, and `npx vercel build --prod --yes`.

- [ ] **Step 2: Confirm Vercel environment linkage**

List Neon resource connections and environment-variable names only for development, preview, and production.

- [ ] **Step 3: Push the completed commits**

Push `main` through the existing Git/Vercel workflow, wait for the exact commit deployment, and ensure the required alias targets it.

- [ ] **Step 4: Verify production**

Call `https://walkthrough-studio-kohl.vercel.app/api/scenes` and `/health`. Inspect build/runtime logs. Repeat diagnosis/fix/migrate/deploy/test only for evidenced failures.

- [ ] **Step 5: Final repository check**

Run `git status --short`, compare `HEAD` and `origin/main`, and record the deployment ID and commit.
