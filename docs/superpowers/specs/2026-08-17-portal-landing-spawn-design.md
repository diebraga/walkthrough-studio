# Portal Landing Spawn Design

## Goal

When a developer stands in a destination scene and clicks **Set respawn here**
for a directional portal, the application must persist that exact walker pose.
The next traversal through that portal must land at the confirmed pose instead
of the destination scene's default pose.

The authoring panel must make the result unambiguous: it shows a saving state,
then either a success message naming the portal and saved coordinates or the
server error. A failed request must not change the traversal pose.

## Scope

This change covers database-backed directional portals and their in-session
authoring flow. It does not change ordinary Scene-selector navigation, legacy
`portals.json` importing, portal trigger geometry, or reciprocal-portal
generation.

## Data flow

1. The landing button is enabled only when the currently loaded scene is the
   selected portal's destination.
2. Clicking it captures the current controlled walker pose: position, yaw, and
   pitch.
3. The client displays `saving <source scene> / <portal>...` and sends a PATCH
   containing the portal ID, its source node ID, and the captured pose.
4. The server validates the portal identity and pose, updates the matching Neon
   row, reads it back, and returns the serialized portal.
5. Only that confirmed response replaces the portal in the source scene's
   in-memory graph. The panel then displays the portal identity and confirmed
   coordinates.
6. Traversal resolves its target from that updated portal and passes the pose
   through the scene-reload boundary. Portal-triggered reloads apply that pose
   after collision setup and must not subsequently apply the scene default.

Portal writes remain serialized per portal so rapid actions cannot allow an
older response to replace a newer one.

## Error behavior

The panel keeps the error visible when capture, validation, authorization,
database update, or response parsing fails. The message identifies the portal
and includes the API error text. The last confirmed in-memory portal remains
unchanged, so traversal never uses an unconfirmed pose.

If the portal is missing an ID, source node, destination, or returned portal,
the operation fails visibly instead of silently returning. Success is reported
only after the confirmed server response has been committed locally.

## Testing

Regression coverage will prove:

- the landing action captures and PATCHes the current pose for the exact
  directional portal;
- a confirmed response updates the portal in its source scene even while the
  destination scene is active;
- a failed response preserves the prior spawn and exposes the error;
- Hall-to-Balcony traversal resolves to the newly confirmed coordinates rather
  than Balcony's default pose;
- the reload lifecycle applies a portal pose after collision initialization and
  does not overwrite it with the default pose;
- backend request validation and persistence return the updated spawn.

Verification will include the focused regression tests followed by
`pnpm test:conventions` and `pnpm build`, as required by the repository.
