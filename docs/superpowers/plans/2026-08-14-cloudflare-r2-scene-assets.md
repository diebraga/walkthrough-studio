# Cloudflare R2 Scene Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the hall PLY and replacement balcony SPZ from public Cloudflare R2, store their canonical object keys in Neon, and configure the deployed renderer to load them.

**Architecture:** Keep R2 responsible only for large immutable asset bytes and Neon responsible for scene metadata. The importer chooses SPZ over PLY when both authoring files exist, assigns stable object keys, and reconciles stale database asset rows; the browser combines each key with `VITE_SPLAT_BASE_URL`.

**Tech Stack:** TypeScript, Node.js test runner, Prisma 7, Neon Postgres, Cloudflare R2/Wrangler, Vite, Vercel

## Global Constraints

- R2 keys are `23_nashville_dr_tenessee/hall/index.ply` and `23_nashville_dr_tenessee/balcony/index.spz`.
- The source balcony SPZ is `/Users/diegobraga/Downloads/42c0e751408d5c0a404a5ef2c67093ad_1786725284_yup.spz`.
- Keep `public/23_nashville_dr_tenessee/balcony/index.ply` untouched for rollback.
- Do not commit or print Cloudflare, Neon, or Vercel credentials.
- Neon remains canonical for metadata; R2 stores asset bytes only.
- Prefer a Cloudflare custom domain; use the public `r2.dev` origin temporarily only when no managed DNS zone is available.
- Do not mutate Neon until both uploaded objects pass metadata and public HTTP verification.
- Preserve the user's unrelated `.mcp.json` change.

---

### Task 1: Recognize R2-backed PLY and SPZ sources

**Files:**
- Modify: `.gitignore`
- Modify: `tools/scene-import/discover.ts`
- Modify: `tools/scene-import/discover.test.ts`

**Interfaces:**
- Consumes: authoring directories under `public/<place>/<node>/`.
- Produces: `discoverSceneImport(rootDirectory): Promise<SceneImportPlan>` with exactly one `GAUSSIAN_SPLAT` per node, an R2-relative `objectKey`, and the source format's MIME type and size.

- [ ] **Step 1: Write failing SPZ preference and object-key tests**

Update the fixture so balcony contains both `index.ply` and `index.spz`, then assert that SPZ wins while hall PLY still resolves:

```ts
await writeFile(path.join(root, "sample_place", "balcony", "index.spz"), "spz-data");

const balcony = plan.places[0].nodes.find((node) => node.slug === "balcony");
assert.ok(balcony);
assert.deepEqual(
  balcony.assets.filter((asset) => asset.type === "GAUSSIAN_SPLAT"),
  [{
    type: "GAUSSIAN_SPLAT",
    objectKey: "sample_place/balcony/index.spz",
    originalPath: "sample_place/balcony/index.spz",
    mimeType: "application/octet-stream",
    sizeBytes: 8,
    metadata: null,
  }],
);
assert.equal(
  hall.assets.find((asset) => asset.type === "GAUSSIAN_SPLAT")?.objectKey,
  "sample_place/hall/index.ply",
);
```

Adjust the repository-dataset assertion from five assets to remain five after `index.spz` is copied: the superseded balcony PLY must not enter the plan.

- [ ] **Step 2: Run the discovery test and confirm failure**

Run: `node --import tsx --test tools/scene-import/discover.test.ts`

Expected: FAIL because `index.spz` is currently classified as `OTHER`, PLY has no object key, and both files appear.

- [ ] **Step 3: Implement deterministic splat selection**

In `discoverNode`, filter the file list before asset processing:

```ts
const preferredSplat = files.includes("index.spz")
  ? "index.spz"
  : files.includes("index.ply")
    ? "index.ply"
    : null;

for (const filename of files) {
  if ((filename === "index.ply" || filename === "index.spz") && filename !== preferredSplat) {
    continue;
  }
  // existing processing
}
```

Use format-aware classification and stable object keys:

```ts
function isGaussianSplat(filename: string): boolean {
  return filename === "index.ply" || filename === "index.spz";
}

function assetType(filename: string): SceneAssetImportType {
  if (isGaussianSplat(filename)) return "GAUSSIAN_SPLAT";
  // existing JSON cases
}

// inside assets.push
objectKey: isGaussianSplat(filename)
  ? sourcePath(placeSlug, nodeSlug, filename)
  : null,
```

Keep `application/octet-stream` for both binary formats because the viewer identifies the encoding from the URL extension and Cloudflare serves byte ranges independently of a vendor-specific MIME registration.

- [ ] **Step 4: Ignore local SPZ authoring assets**

Add alongside the existing PLY rule:

```gitignore
public/**/*.spz
```

- [ ] **Step 5: Run tests and commit**

Run: `node --import tsx --test tools/scene-import/discover.test.ts`

Expected: PASS.

```bash
git add .gitignore tools/scene-import/discover.ts tools/scene-import/discover.test.ts
git commit -m "feat: import SPZ scene assets for R2"
```

---

### Task 2: Reconcile stale SceneAsset rows

**Files:**
- Modify: `tools/scene-import/import.ts`
- Modify: `tools/scene-import/import.test.ts`

**Interfaces:**
- Consumes: each node's complete `assets: SceneAssetImport[]` plan from Task 1.
- Produces: `persistSceneImport(database, plan)` whose stored assets exactly match the plan for each imported node.

- [ ] **Step 1: Write a failing stale-row reconciliation test**

Extend the mock transaction client with `sceneAsset.deleteMany` and seed a stale balcony PLY. Assert the importer calls:

```ts
assert.deepEqual(sceneAssetDeleteCalls, [{
  where: {
    sceneNodeId: "node-balcony",
    originalPath: {
      notIn: [
        "public/sample_place/balcony/index.spz",
        "public/sample_place/balcony/manual-collision.json",
      ],
    },
  },
}]);
```

Also add an empty-assets case asserting `deleteMany({ where: { sceneNodeId: "node-empty" } })`, avoiding Prisma's invalid/ambiguous empty `notIn` semantics.

- [ ] **Step 2: Run the importer test and confirm failure**

Run: `node --import tsx --test tools/scene-import/import.test.ts`

Expected: FAIL because `deleteMany` is never called.

- [ ] **Step 3: Reconcile before upserting assets**

Immediately after each `sceneNode.upsert`, add:

```ts
const originalPaths = node.assets.map((asset) => asset.originalPath);
await tx.sceneAsset.deleteMany({
  where: originalPaths.length
    ? {
        sceneNodeId: nodeRecord.id,
        originalPath: { notIn: originalPaths },
      }
    : { sceneNodeId: nodeRecord.id },
});
```

Then retain the existing asset upsert loop. This makes the authoring plan authoritative for assets without changing IDs of rows that remain.

- [ ] **Step 4: Run importer and database tests**

Run: `node --import tsx --test tools/scene-import/import.test.ts`

Expected: PASS.

Run: `pnpm test:database`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/scene-import/import.ts tools/scene-import/import.test.ts
git commit -m "fix: reconcile imported scene assets"
```

---

### Task 3: Stage the replacement balcony SPZ and update documentation

**Files:**
- Local ignored asset: `public/23_nashville_dr_tenessee/balcony/index.spz`
- Modify: `docs/scene-assets.md`

**Interfaces:**
- Consumes: the supplied download file and Task 1's SPZ discovery behavior.
- Produces: a repeatable local authoring source and documented PLY/SPZ convention.

- [ ] **Step 1: Copy the supplied SPZ without deleting the rollback PLY**

Run:

```bash
cp /Users/diegobraga/Downloads/42c0e751408d5c0a404a5ef2c67093ad_1786725284_yup.spz public/23_nashville_dr_tenessee/balcony/index.spz
```

Expected: source and destination both report `27259679` bytes; `index.ply` still reports `309409303` bytes.

- [ ] **Step 2: Verify exact copy integrity**

Run:

```bash
shasum -a 256 /Users/diegobraga/Downloads/42c0e751408d5c0a404a5ef2c67093ad_1786725284_yup.spz public/23_nashville_dr_tenessee/balcony/index.spz
```

Expected: both SHA-256 values are identical.

- [ ] **Step 3: Document supported authoring formats and precedence**

Update `docs/scene-assets.md` so the structure uses `index.ply | index.spz`, explains that SPZ wins when both are present, and states both formats are ignored by Git and stored externally in production.

- [ ] **Step 4: Confirm discovery and commit documentation**

Run: `node --import tsx --test tools/scene-import/discover.test.ts`

Expected: PASS with five discovered repository assets and balcony `index.spz` selected.

```bash
git add docs/scene-assets.md
git commit -m "docs: describe SPZ scene authoring"
```

---

### Task 4: Provision and publish the R2 bucket

**Files:**
- Create: `config/r2-cors.json`
- Modify: `docs/scene-assets.md`

**Interfaces:**
- Consumes: an authenticated Wrangler session and the two local source assets.
- Produces: a public R2 origin containing the exact stable keys required by Task 1.

- [ ] **Step 1: Verify authentication and inspect existing buckets**

Run: `npx wrangler whoami`

Expected: the intended Cloudflare account is authenticated; do not copy tokens into logs or source.

Run: `npx wrangler r2 bucket list`

Expected: a list of existing buckets. Reuse a clearly project-specific walkthrough bucket; otherwise create `walkthrough-studio-assets`.

- [ ] **Step 2: Create the bucket only if absent**

Run: `npx wrangler r2 bucket create walkthrough-studio-assets`

Expected: successful creation. Skip this command when Step 1 already found that exact bucket.

- [ ] **Step 3: Add a browser-read CORS policy**

Create `config/r2-cors.json`:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": [
          "http://localhost:5173",
          "https://walkthrough-studio-kohl.vercel.app"
        ],
        "methods": ["GET", "HEAD"],
        "headers": ["Range"]
      },
      "exposeHeaders": ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"],
      "maxAgeSeconds": 86400
    }
  ]
}
```

Run: `npx wrangler r2 bucket cors set walkthrough-studio-assets --file config/r2-cors.json`

Expected: CORS configuration updated successfully.

- [ ] **Step 4: Upload hall PLY and balcony SPZ**

Run:

```bash
npx wrangler r2 object put walkthrough-studio-assets/23_nashville_dr_tenessee/hall/index.ply --file public/23_nashville_dr_tenessee/hall/index.ply --content-type application/octet-stream --remote
npx wrangler r2 object put walkthrough-studio-assets/23_nashville_dr_tenessee/balcony/index.spz --file public/23_nashville_dr_tenessee/balcony/index.spz --content-type application/octet-stream --remote
```

Expected: both uploads succeed. If the installed Wrangler version rejects `--remote` for R2 object operations, rerun the same commands without `--remote`; R2 object commands target remote storage by default in those versions.

- [ ] **Step 5: Attach public delivery**

In the Cloudflare R2 bucket settings, attach a custom hostname from an available managed zone. If the account has no managed zone, enable the bucket's public development URL and record its HTTPS origin as the temporary base URL. This console step is necessary because custom-domain choice depends on zones owned by the authenticated account.

- [ ] **Step 6: Verify both public objects before database mutation**

Assign the exact HTTPS origin reported by Cloudflare, then reject an empty or
non-HTTPS value before using it:

```bash
R2_PUBLIC_ORIGIN='the exact HTTPS origin shown in the Cloudflare bucket settings'
case "$R2_PUBLIC_ORIGIN" in https://*) ;; *) exit 1 ;; esac
curl -I "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/hall/index.ply"
curl -I "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/balcony/index.spz"
```

Expected: `200`, `Content-Length: 163141743` for hall, `Content-Length: 27259679` for balcony, byte-range support, and `application/octet-stream`.

Run CORS preflights:

```bash
curl -i -X OPTIONS "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/hall/index.ply" -H 'Origin: https://walkthrough-studio-kohl.vercel.app' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: Range'
curl -i -X OPTIONS "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/balcony/index.spz" -H 'Origin: https://walkthrough-studio-kohl.vercel.app' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: Range'
```

Expected: successful responses allowing the production origin, `GET`, and `Range`.

- [ ] **Step 7: Document the bucket procedure and commit**

Add the exact bucket name, object-key layout, CORS-file command, upload commands, and public-origin requirement to `docs/scene-assets.md`. Do not document credentials or account IDs.

```bash
git add config/r2-cors.json docs/scene-assets.md
git commit -m "docs: add R2 scene asset publishing"
```

---

### Task 5: Import canonical R2 references into Neon

**Files:**
- Runtime data mutation: configured Neon database

**Interfaces:**
- Consumes: verified R2 objects from Task 4 and importer behavior from Tasks 1–2.
- Produces: Neon scene assets whose hall and balcony records point to the exact R2 keys.

- [ ] **Step 1: Inspect current database state without secrets**

Run: `pnpm db:inspect`

Expected: the current property, nodes, and asset summary; no connection string is printed.

- [ ] **Step 2: Run the idempotent import**

Run: `pnpm db:import`

Expected: one place, two nodes, five active assets, and one portal imported. The stale balcony PLY row is removed by reconciliation.

- [ ] **Step 3: Inspect the resulting asset records**

Run: `pnpm db:inspect`

Expected: hall has `objectKey=23_nashville_dr_tenessee/hall/index.ply`, size `163141743`; balcony has `objectKey=23_nashville_dr_tenessee/balcony/index.spz`, size `27259679`; no active balcony PLY asset remains.

- [ ] **Step 4: Verify the API projection locally**

Start: `pnpm dev`

Run: `curl -s 'http://localhost:5173/api/scenes?place=23_nashville_dr_tenessee'`

Expected: the JSON graph contains the exact two object keys and retains the existing collision and portal data.

---

### Task 6: Configure Vercel and verify production

**Files:**
- Local secret/config mutation: `.env.local`
- Vercel environment mutation: `VITE_SPLAT_BASE_URL`

**Interfaces:**
- Consumes: the verified public R2 origin and Neon scene records.
- Produces: local and production builds that resolve scene asset URLs to R2.

- [ ] **Step 1: Set the local public base URL without disturbing other secrets**

Use the Vercel CLI to pull the existing development environment, then set only `VITE_SPLAT_BASE_URL` in `.env.local` to the validated `$R2_PUBLIC_ORIGIN` plus a trailing slash. Read the file before editing and never print its values.

- [ ] **Step 2: Configure all relevant Vercel environments**

Run `npx vercel env ls` to check existing keys. Remove only an existing `VITE_SPLAT_BASE_URL` value when replacement is necessary, then add the selected HTTPS origin for Production, Preview, and Development using `npx vercel env add VITE_SPLAT_BASE_URL <environment>`. Do not alter Neon variables.

Expected: `VITE_SPLAT_BASE_URL` appears for all three environments; its secret value is not echoed in the handoff.

- [ ] **Step 3: Run complete local verification**

Run:

```bash
pnpm test:conventions
pnpm test:database
node --import tsx src/walk-demo/scene-catalog.test.ts
pnpm build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 4: Deploy production**

Run: `npx vercel --prod`

Expected: a successful production deployment of `walkthrough-studio` using the existing Vercel project link.

- [ ] **Step 5: Verify production API and asset URLs**

Run:

```bash
curl -s 'https://walkthrough-studio-kohl.vercel.app/api/scenes?place=23_nashville_dr_tenessee'
curl -I "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/hall/index.ply"
curl -I "$R2_PUBLIC_ORIGIN/23_nashville_dr_tenessee/balcony/index.spz"
```

Expected: the API returns the exact object keys and both assets remain publicly reachable.

- [ ] **Step 6: Perform browser smoke verification**

Open the production app, confirm hall renders from `index.ply`, traverse its existing portal, and confirm balcony renders from `index.spz`. In browser network inspection, both large asset requests must use the R2 origin and return successful status codes without CORS errors.

- [ ] **Step 7: Final repository check**

Run: `git status --short`

Expected: only the user's pre-existing `.mcp.json` modification remains uncommitted; ignored PLY/SPZ files do not appear.
