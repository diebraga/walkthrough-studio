import { getDb } from "../server/db.js";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const database = getDb();
try {
  const places = await database.place.findMany({
    orderBy: { slug: "asc" },
    include: {
      sceneNodes: {
        orderBy: { slug: "asc" },
        include: {
          assets: { orderBy: { originalPath: "asc" } },
          outgoingPortals: {
            orderBy: { sourceKey: "asc" },
            include: { toNode: { select: { slug: true } } },
          },
        },
      },
    },
  });
  const collisionTypes = await database.$queryRaw<Array<{ slug: string; jsonType: string | null }>>`
    SELECT "slug", jsonb_typeof("collisionData") AS "jsonType"
    FROM "SceneNode"
    ORDER BY "slug"
  `;
  const binaryColumns = await database.$queryRaw<Array<{ tableName: string; columnName: string }>>`
    SELECT table_name::text AS "tableName", column_name::text AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'bytea'
    ORDER BY table_name, column_name
  `;

  console.log(
    JSON.stringify(
      {
        counts: {
          places: places.length,
          nodes: places.flatMap((place) => place.sceneNodes).length,
          assets: places.flatMap((place) => place.sceneNodes.flatMap((node) => node.assets)).length,
          portals: places.flatMap((place) =>
            place.sceneNodes.flatMap((node) => node.outgoingPortals),
          ).length,
        },
        collisionTypes,
        binaryColumns,
        places: places.map((place) => ({
          id: place.id,
          slug: place.slug,
          name: place.name,
          nodes: place.sceneNodes.map((node) => ({
            id: node.id,
            slug: node.slug,
            assets: node.assets.map((asset) => ({
              id: asset.id,
              type: asset.type,
              originalPath: asset.originalPath,
              sizeBytes: asset.sizeBytes.toString(),
            })),
            portals: node.outgoingPortals.map((portal) => ({
              id: portal.id,
              toNodeId: portal.toNodeId,
              toNodeSlug: portal.toNode.slug,
              position: [portal.positionX, portal.positionY, portal.positionZ],
              yaw: portal.yaw,
              radius: portal.radius,
              spawn: [
                portal.spawnX,
                portal.spawnY,
                portal.spawnZ,
                portal.spawnYaw,
                portal.spawnPitch,
              ],
            })),
          })),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await database.$disconnect();
}
