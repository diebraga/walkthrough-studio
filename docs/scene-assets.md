# Scene assets

How scene files are named and organised. Index: [../AGENTS.md](../AGENTS.md).

## Structure

```
public/
  <property-slug>/            key for a place — becomes a DB row later
    <scene>/                  one part of that place
      index.ply               the splat (gitignored, too large for git)
      collision.json          baked collision — floor plane + walkable grid
      collision-report.json   what the bake measured, and its QA warnings
      portals.json            named points in the scene (optional)
```

Real example:

```
public/23_nashville_dr_tenessee/hall/index.ply
public/23_nashville_dr_tenessee/hall/collision.json
public/23_nashville_dr_tenessee/hall/collision-report.json
```

## The two levels

**Property slug** — the key identifying a place. Usually an address
(`23_nashville_dr_tenessee`), but it is just a slug: a warehouse, a unit number,
a site name all work. Lowercase, underscore-separated, no spaces.

**Scene** — one part of that place: `hall`, `kitchen`, `corridor`, `bathroom`.
Named for the room, not numbered, so the folder says what it is. One property has
many scenes.

## Runtime ownership

Neon Postgres is the canonical runtime source for places, nodes, collision,
asset references, and portals. The frontend obtains one place graph through
`GET /api/scenes/:placeSlug`; it does not discover nodes or relationships by
walking these folders.

`public/` remains the import and developer-authoring source. The importer turns
these folders into database rows. Do not delete them yet: they remain useful for
repeatable imports, local authoring, and rollback.

Portals are captured in-app rather than written by hand — see
[dev-settings.md](dev-settings.md).

In deployed environments, large `index.ply` files are loaded from object storage
when `VITE_SPLAT_BASE_URL` is set. `SceneAsset` supplies the reference. Runtime
collision and portals come from Neon through Hono, not separate static JSON
requests. Collision reports remain import/QA metadata.

## Adding a scene

1. `mkdir -p public/<property-slug>/<scene>/`
2. Put the splat in as `index.ply`.
3. Bake collision — see [collision-pipeline.md](collision-pipeline.md):
   ```
   node tools/build-collision.mjs public/<property-slug>/<scene>/index.ply \
     --out public/<property-slug>/<scene>
   ```
4. Read the QA report before trusting it. `all QA gates passed` is the bar.
5. Run `pnpm db:import`. The renderer discovers the node through the database
   graph; do not add a hard-coded folder relationship.

Collision generation is expected to become automatic — run on upload, stored as
scene-row columns rather than a file. See
[collision-pipeline.md](collision-pipeline.md#later-generated-not-stored).

## Why collision is baked, not computed at load

Collision could be derived in the browser from the splat that is already being
downloaded — roughly 200–400 ms, which is nothing against a 20–40 s splat load.
It is baked anyway, for two reasons:

- **`collision.json` is a few KB, so it arrives long before the splat.** The
  player can be placed on solid ground while the scene is still resolving.
- **Someone reads the report before the scene ships.** Generated on demand, a
  scan whose up-axis detection fails silently produces broken collision and drops
  the player through the world. Baking puts a human between the scan and the user.

Computing on demand is still the right fallback when no `collision.json` exists.
It is not built yet.

## Committed vs local

`public/**/*.ply` is gitignored — splats run 100 MB+, over GitHub's hard 100 MB
per-file limit, and a push containing one is rejected outright. `collision.json`
and `collision-report.json` are small and **are** committed: they are the
reviewed, derived artefacts.

A fresh clone can read metadata from Neon, but local static splat delivery still
requires the files or a configured `VITE_SPLAT_BASE_URL`.
