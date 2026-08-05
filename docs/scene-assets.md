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

## Why it is shaped this way

`public/` is standing in for the asset bucket. The same paths will work when the
files move to object storage, and the property slug becomes the key of a database
table with scenes as its rows. **That table does not exist yet** — the folders are
the source of truth for now, and nothing should depend on a database.

Everything a scene needs lives in one folder. Adding a scene is dropping a folder
in; nothing has to be renamed or wired up elsewhere.

## Adding a scene

1. `mkdir -p public/<property-slug>/<scene>/`
2. Put the splat in as `index.ply`.
3. Bake collision — see [collision-pipeline.md](collision-pipeline.md):
   ```
   node tools/build-collision.mjs public/<property-slug>/<scene>/index.ply \
     --out public/<property-slug>/<scene>
   ```
4. Read the QA report before trusting it. `all QA gates passed` is the bar.
5. Point the app at the folder — currently the `SCENE_HALL` constant in
   `src/walk-demo/walk-demo.ts`.

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

A fresh clone therefore has no splats and `/test` will not load until one is
placed by hand. That is deliberate until the bucket exists.
