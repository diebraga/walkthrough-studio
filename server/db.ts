import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "./generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

const globalDatabase = globalThis as typeof globalThis & {
  walkthroughDatabase?: DatabaseClient;
};

let moduleDatabase: DatabaseClient | undefined;

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to access the scene database");
  }
  return url;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export function getDb(): DatabaseClient {
  if (moduleDatabase) return moduleDatabase;
  if (process.env.NODE_ENV !== "production" && globalDatabase.walkthroughDatabase) {
    moduleDatabase = globalDatabase.walkthroughDatabase;
    return moduleDatabase;
  }

  moduleDatabase = createDatabaseClient(requireDatabaseUrl());
  if (process.env.NODE_ENV !== "production") {
    globalDatabase.walkthroughDatabase = moduleDatabase;
  }
  return moduleDatabase;
}
