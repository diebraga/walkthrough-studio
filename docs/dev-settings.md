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
/test?dev=1                     every flag
/test?dev=collision             one flag
/test?dev=collision,portals     several
/test?dev=0                     everything off, ignoring the .env default
```

### Flags vs toggles

A **flag** decides whether a control exists; a **toggle** is the checkbox itself.
Enabling the `collision` flag adds *Show collision* to the panel — it does not
turn the overlay on. Both toggles default **off** and remember their last state
in `localStorage`, so a reload never drops you into a scene full of debug
geometry, and a view you turned on stays on.

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

## `collision`

Adds **Show collision** to the panel and draws the active collider as solid pink
volumes: a floor slab over walkable cells, and wall cells extruded where they
border somewhere you can stand. Only boundary walls are drawn — the non-walkable
set includes everything outside the room, which would otherwise wrap the camera
in a solid shell.

Use it when you fall through the floor or walk through a wall. Holes in the pink
are holes in the collision.

## `portals`

Adds a **Portals** folder for capturing named points while walking the scene.

| Control | Does |
|---|---|
| Show portals | Draws the markers; separate from *Show collision* because the usual case while authoring is markers on, collision off |
| Name | Name for the next capture; blank auto-increments `portal_1`, `portal_2` |
| Add portal here | Captures the walker's current position and yaw |
| saved | Time of the last successful write, or the error |
| inside | Portal you are currently standing in |
| *(per portal)* | Read-only x/y/z, a radius slider, and Delete |

Portals are drawn in the 3D view as a ring of posts with a centre pole — blue
normally, yellow while you are inside one. Entering and leaving logs
`[portal] entered <name>` / `[portal] exited <name>`, edge-triggered so it fires
once per transition rather than every frame.

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

`to` and `spawn` are null until scenes are linked. They are in the file now so
the shape does not have to change when a portal becomes a real doorway: `to` will
name the target scene and `spawn` the arrival pose in it. Spawns cannot be
derived — each scan has its own arbitrary coordinate frame, so where you arrive
in the kitchen has no relationship to where the door is in the hall. Capture the
arrival point by walking the target scene and adding a portal there too.

## Adding a flag

Add it to `DevFlag` and `ALL_FLAGS` in `src/walk-demo/dev-settings.ts`, guard the
feature with `devEnabled('name')`, and document it here.
