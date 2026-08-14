# Cloudflare R2 scene assets

## Goal

Serve the production Gaussian-splat files for `23_nashville_dr_tenessee`
directly from a public Cloudflare R2 bucket while keeping Neon Postgres as the
canonical source of scene metadata. The hall uses its existing PLY. The balcony
uses the supplied SPZ instead of its existing PLY.

## Asset layout

The bucket uses stable keys that match the existing property and node slugs:

```text
23_nashville_dr_tenessee/hall/index.ply
23_nashville_dr_tenessee/balcony/index.spz
```

The source files are:

- `public/23_nashville_dr_tenessee/hall/index.ply`
- `/Users/diegobraga/Downloads/42c0e751408d5c0a404a5ef2c67093ad_1786725284_yup.spz`

The existing local balcony PLY remains untouched as a rollback/authoring asset.
The SPZ is copied into the balcony authoring directory as `index.spz`, and SPZ
files receive the same gitignore treatment as PLY files.

## Public delivery

The bucket permits public reads and browser `GET`/`HEAD` requests. Production
uses a Cloudflare custom domain when the account has a managed DNS zone. If no
managed zone is available, setup enables the bucket's public `r2.dev` URL as the
working endpoint; that endpoint is an explicit temporary deployment endpoint
until a custom hostname is attached.

`VITE_SPLAT_BASE_URL` contains the public origin without a property-specific
suffix. It is configured locally and in Vercel, never hard-coded in source.

## Database and import behavior

No Prisma schema change is required. `SceneAsset` already stores the asset type,
object key, original path, MIME type, and byte size.

The importer recognizes both `index.ply` and `index.spz` as
`GAUSSIAN_SPLAT`. For these deployable splat files it records the R2 key by
removing the leading `public/` from the authoring path. SPZ receives a binary
Gaussian-splat MIME type compatible with R2/browser delivery. Re-importing is
idempotent and updates the balcony node to expose one active Gaussian-splat
asset: `index.spz`. A stale `index.ply` database row must not remain eligible for
runtime selection, even though the rollback file remains on disk.

The runtime continues resolving URLs as:

```text
VITE_SPLAT_BASE_URL + SceneAsset.objectKey
```

Collision data, portals, and all scene relationships continue to come from Neon
through `GET /api/scenes?place=23_nashville_dr_tenessee`.

## Provisioning and upload

Setup first discovers the authenticated Cloudflare account and existing buckets
to avoid duplicate resources. It creates a purpose-specific bucket only when an
appropriate bucket does not already exist, applies public access and CORS, then
uploads both objects with their correct content types. Credentials and account
identifiers remain in local/hosting secrets and are never committed or printed.

Database writes use the existing Prisma importer and configured Neon connection.
The deployment environment receives only the public base URL; it does not need
R2 write credentials to render scenes.

## Failure handling

Provisioning stops before database mutation if either upload fails. Each upload
is verified by object metadata and a public `HEAD` request before Neon is
re-imported. The importer rejects ambiguous nodes containing more than one
active Gaussian-splat source rather than relying on directory ordering.

If database import or deployment configuration fails after successful uploads,
the objects remain safe to reuse and the existing production metadata remains
recoverable through Neon history. The old local balcony PLY is retained.

## Verification

- Unit tests cover PLY/SPZ discovery, object keys, MIME types, and rejection of
  ambiguous active splats.
- Database tests and the secret-free inspector confirm the hall points to the
  PLY key and balcony points to the SPZ key with matching byte sizes.
- Public `HEAD` requests confirm both objects are reachable with CORS and correct
  content types.
- `GET /api/scenes?place=23_nashville_dr_tenessee` returns the two R2-backed
  asset references.
- Project convention tests and the production build pass.
- A deployed browser smoke test loads the hall, traverses the portal, and loads
  the balcony SPZ.
