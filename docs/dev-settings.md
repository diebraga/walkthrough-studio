# Developer settings

Tools that must never reach a viewer. Index: [../AGENTS.md](../AGENTS.md).

## Enabling

The default lives in `.env`, so tooling is on for developers without touching a
URL:

```
VITE_DEV_FLAGS=collision,portals
```

Restart the dev server after editing it — Vite reads `.env` at startup only. For
a personal setting that is not committed, use `.env.local`; Vite gives it
precedence.

Override per-tab with a query param, which is then remembered in `localStorage`:

```
/?dev=1                         every flag
/?dev=collision                 one flag
/?dev=collision,portals         several
/?dev=0                         everything off, ignoring the .env default
```

### Flags vs toggles

A **flag** decides whether a control exists; a **toggle** is the checkbox itself.
Enabling the `collision` flag adds *Show collision* to the panel — it does not
turn the overlay on. The collision toggle defaults **off** and remembers its
last state in `localStorage`, so a reload never drops you into a scene full of
debug geometry, and a view you turned on stays on.

Resolved in precedence order: **query param → localStorage → `.env`**. So
`?dev=0` lets you see the app exactly as a visitor would without editing a file,
and it sticks until you pass `?dev=` again. Active flags are logged at startup.

Two deliberate choices:

- **`.env` is the only thing that turns tooling on by default.** Delete the line
  and the app starts in the state a visitor sees.
- **Gated on `import.meta.env.DEV`.** A production build can never switch these
  on, whatever `.env` or the URL says.

Note this makes the dev code **inert in production, not absent** — the panel
methods still ship as dead code, because class methods are not tree-shaken. To
drop them from the bundle the panel would have to move into a dynamically
imported module. Nothing runs, and the server-side write route cannot mutate
data unless its separate authoring gate is explicitly enabled, so this is
bundle weight rather than exposure.

## General developer controls

When any dev flag is active, the Camera menu adds **Fly**. It is a free camera:
WASD moves through the scan, Space rises, Shift descends, and collision/gravity
are ignored.

When `VITE_DEV_FLAGS` is set in the env file, the panel also adds **Copy
position**, which writes the current camera pose as JSON to the clipboard. Query
params alone do not add this control. Use it while flying to capture a spawn
candidate.

## `collision`

Adds **Show collision** to the panel and draws the active collider as solid pink
volumes: a floor slab over walkable cells, and wall cells extruded where they
border somewhere you can stand. Only boundary walls are drawn — the non-walkable
set includes everything outside the room, which would otherwise wrap the camera
in a solid shell.

Use it when you fall through the floor or walk through a wall. Holes in the pink
are holes in the collision.

## `portals`

Portal landmarks are always shown to visitors. Each is a static blue/cyan
additive floor circle with a bipolar jet through its center, rendered on top
of Gaussian splats so it stays visible everywhere. The `portals` flag adds a
**Portals** folder for developer-only authoring controls while walking the
scene.

Database writes have a second, server-side guard. Add this to `.env.local` when
authoring:

```
PORTAL_AUTHORING_ENABLED=1
```

Without it the controls may be visible, but mutation requests return `404` and
Neon is unchanged.

The list is grouped into one collapsible folder per database scene, each
showing that scene's own portals — spanning every scene in the place, not
just the one currently loaded.

| Control | Does |
|---|---|
| Destination | Another database scene in this place; the active scene is excluded |
| Add portal here | Captures the walker position/yaw and links to Destination; name auto-increments `portal_1`, `portal_2` |
| saved | Time of the last successful write, or the error |
| inside | Portal you are currently standing in |
| *(per scene)* | **Set respawn here** |
| *(per portal)* | Delete |

Each scene has one canonical arrival pose (`SceneNode.pose` in Neon), used no
matter which portal — or direct scene-picker jump — brought the walker there.
**Set respawn here** sets it to wherever you're currently standing, so it's
only enabled while the loaded scene is the one whose pose you're editing.

The `saved` field shows `saving <scene>...` while Neon is being updated. It
changes to the confirmed `(x, y, z)` coordinates only after the server
returns the updated scene. If the write fails, the field keeps the error
visible and the last confirmed pose remains in use.

Creating a portal only links the trigger and destination; arrival pose is
whatever the destination scene's pose already is. Creation is one-way: Hall
to Balcony never creates Balcony to Hall. Author each direction from the
scene where its trigger lives.

Linked portals are traversable doorways. Entering and leaving logs `[portal]
entered <name>` / `[portal] exited <name>`, edge-triggered so it fires once per
transition rather than every frame.

After a linked portal changes scenes, arrival is deliberately disarmed while
the walker remains inside any destination portal radius. Walk fully outside
every portal radius to rearm activation, then re-enter the return portal to
travel back.

Rows are **collapsed by default on purpose**: deleting takes expand-then-click,
so a stray click cannot remove the wrong portal.

### Saving

Portal creates and deletions are sent to `/api/portals`; scene respawn edits
are sent to `/api/scenes`. Both are written to Neon through Prisma. Local
markers and traversal state update only after the API confirms the write.
There is no undo; a deleted database portal must be authored again or
restored through normal database recovery.

### Legacy import format

```json
{
  "portals": [
    {
      "name": "kitchen-door",
      "position": { "x": 2.1, "y": -1.66, "z": 3.4 },
      "yaw": -1.79,
      "radius": 0.8,
      "to": null,
      "spawn": null
    }
  ]
}
```

`to` and `spawn` are null until scenes are linked. To author a forward doorway,
set `to` to the target scene slug and `spawn` to the desired arrival pose in that
scene — the importer applies it as that scene's canonical `SceneNode.pose`
(first portal targeting it wins). Spawns cannot be derived — each scan has its
own arbitrary coordinate frame, so where you arrive in the kitchen has no
relationship to where the door is in the hall. Walk the target scene, use
**Copy position** to capture that pose, and place it on the forward portal
before running `pnpm db:import`.

The importer can still generate reciprocal entries from legacy `portals.json`
inputs. Runtime API authoring does not run importer completion; author each
direction explicitly from the scene where its trigger lives.

## Adding a flag

Add it to `DevFlag` and `ALL_FLAGS` in `src/walk-demo/dev-settings.ts`, guard the
feature with `devEnabled('name')`, and document it here.
