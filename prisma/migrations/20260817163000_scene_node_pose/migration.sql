-- Replace two disconnected spawn concepts (a per-portal arrival override in
-- Portal, and a hardcoded NODE_POSES map in client source) with one
-- database-backed default pose per scene, used by every arrival path.

ALTER TABLE "SceneNode" ADD COLUMN "poseX" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SceneNode" ADD COLUMN "poseY" DOUBLE PRECISION NOT NULL DEFAULT -0.4;
ALTER TABLE "SceneNode" ADD COLUMN "poseZ" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SceneNode" ADD COLUMN "poseYaw" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "SceneNode" ADD COLUMN "posePitch" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Seed each scene's canonical pose from whichever portal already has a
-- runtime-authored spawn for it (first one found, by portal id), so this
-- migration doesn't discard the landing spots already saved via
-- "Set respawn here" today.
UPDATE "SceneNode" AS node
SET "poseX" = chosen."spawnX",
    "poseY" = chosen."spawnY",
    "poseZ" = chosen."spawnZ",
    "poseYaw" = chosen."spawnYaw",
    "posePitch" = chosen."spawnPitch"
FROM (
  SELECT DISTINCT ON ("toNodeId") "toNodeId", "spawnX", "spawnY", "spawnZ", "spawnYaw", "spawnPitch"
  FROM "Portal"
  ORDER BY "toNodeId", id
) AS chosen
WHERE node.id = chosen."toNodeId";

ALTER TABLE "Portal" DROP COLUMN "spawnX";
ALTER TABLE "Portal" DROP COLUMN "spawnY";
ALTER TABLE "Portal" DROP COLUMN "spawnZ";
ALTER TABLE "Portal" DROP COLUMN "spawnYaw";
ALTER TABLE "Portal" DROP COLUMN "spawnPitch";
