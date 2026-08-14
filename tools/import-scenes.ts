import path from "node:path";
import { getDb } from "../server/db.js";
import { discoverSceneImport } from "./scene-import/discover.js";
import { persistSceneImport } from "./scene-import/import.js";

try {
  process.loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const database = getDb();
try {
  const plan = await discoverSceneImport(path.resolve("public"));
  const summary = await persistSceneImport(database, plan);
  console.log(JSON.stringify(summary));
} finally {
  await database.$disconnect();
}
