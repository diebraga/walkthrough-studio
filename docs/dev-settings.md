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
imported module. Nothing runs, and the write endpoint does not exist server-side,
so this is bundle weight rather than exposure.

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
additive floor circle; the landmark turns yellow while the walker is inside it.
The `portals` flag adds a **Portals** folder for
developer-only authoring controls while walking the scene.

| Control | Does |
|---|---|
| Name | Name for the next capture; blank auto-increments `portal_1`, `portal_2` |
| Add portal here | Captures the walker's current position and yaw |
| saved | Time of the last successful write, or the error |
| inside | Portal you are currently standing in |
| *(per portal)* | Read-only x/y/z, a radius slider, and Delete |

Linked portals are traversable doorways, including the importer-generated
reciprocal return direction. Entering and leaving logs `[portal] entered <name>`
/ `[portal] exited <name>`, edge-triggered so it fires once per transition
rather than every frame.

After a linked portal changes scenes, arrival is deliberately disarmed while
the walker remains inside any destination portal radius. The destination marker
still turns yellow, but it cannot immediately send the walker back. Walk fully
outside every portal radius to rearm activation, then re-enter the return portal
to travel back.

Rows are **collapsed by default on purpose**: deleting takes expand-then-click,
so a stray click cannot remove the wrong portal. Position is read-only — if a
portal is in the wrong place, delete it and walk back, rather than turning the
panel into a tiny 3D editor.

### Saving

Every change writes `public/<property>/<scene>/portals.json` immediately through
`POST /__dev/portals`, served by `tools/portal-write-plugin.ts`. That plugin is
`apply: "serve"`, so it exists on the dev server only and is absent from a
production build. It refuses to write outside `public/`, because the path comes
from the page.

There is no undo. `portals.json` is committed, so `git checkout` the file if you
delete something you wanted.

### Format

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
scene. Spawns cannot be derived — each scan has its own arbitrary coordinate
frame, so where you arrive in the kitchen has no relationship to where the door
is in the hall. Walk the target scene, use **Copy position** to capture that pose,
and place it on the forward portal before running `pnpm db:import`.

You do not need to author a second portal solely to make the doorway reversible.
The importer places the generated reverse portal behind the authored forward
destination spawn, and its return landing behind the original forward portal.
Each offset uses the corresponding pose's yaw and clears the trigger by the
portal radius plus `0.7` metres. If the return needs different placement,
radius, or arrival pose, author an explicit target-to-source portal; that
explicit reverse takes precedence over the generated default.

## Adding a flag

Add it to `DevFlag` and `ALL_FLAGS` in `src/walk-demo/dev-settings.ts`, guard the
feature with `devEnabled('name')`, and document it here.
