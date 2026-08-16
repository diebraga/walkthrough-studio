import { Hono, type Context } from "hono";
import { getDb } from "../db.js";

export interface PortalPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface CreatePortalInput {
  fromNodeId: string;
  toNodeId: string;
  name: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  radius: number;
  spawn: PortalPose;
}

export interface UpdatePortalRadiusInput {
  id: string;
  fromNodeId: string;
  radius: number;
}

export interface PortalRecord {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  radius: number;
  spawn: PortalPose;
  toNodeId: string;
}

export interface PortalMutationStore {
  create(input: CreatePortalInput): Promise<PortalRecord>;
  updateRadius(input: UpdatePortalRadiusInput): Promise<PortalRecord>;
  delete(input: { id: string; fromNodeId: string }): Promise<void>;
}

class PortalRequestError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PortalRequestError(`${field} must be a UUID`, 400);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PortalRequestError(`${field} must be a finite number`, 400);
  }
  return value;
}

function parsePoint(value: unknown, field: string): { x: number; y: number; z: number } {
  if (!isRecord(value)) throw new PortalRequestError(`${field} must be an object`, 400);
  return {
    x: requiredNumber(value.x, `${field}.x`),
    y: requiredNumber(value.y, `${field}.y`),
    z: requiredNumber(value.z, `${field}.z`),
  };
}

function parsePose(value: unknown): PortalPose {
  if (!isRecord(value)) throw new PortalRequestError("spawn must be an object", 400);
  return {
    ...parsePoint(value, "spawn"),
    yaw: requiredNumber(value.yaw, "spawn.yaw"),
    pitch: requiredNumber(value.pitch, "spawn.pitch"),
  };
}

function parseCreate(value: unknown): CreatePortalInput {
  if (!isRecord(value)) throw new PortalRequestError("request body must be an object", 400);
  const fromNodeId = requiredUuid(value.fromNodeId, "fromNodeId");
  const toNodeId = requiredUuid(value.toNodeId, "toNodeId");
  if (fromNodeId === toNodeId) throw new PortalRequestError("portal destination must differ from its source", 400);
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new PortalRequestError("name is required", 400);
  }
  const radius = requiredNumber(value.radius, "radius");
  if (radius <= 0) throw new PortalRequestError("radius must be greater than zero", 400);
  return {
    fromNodeId,
    toNodeId,
    name: value.name.trim(),
    position: parsePoint(value.position, "position"),
    yaw: requiredNumber(value.yaw, "yaw"),
    radius,
    spawn: parsePose(value.spawn),
  };
}

function parseUpdate(value: unknown): UpdatePortalRadiusInput {
  if (!isRecord(value)) throw new PortalRequestError("request body must be an object", 400);
  const radius = requiredNumber(value.radius, "radius");
  if (radius <= 0) throw new PortalRequestError("radius must be greater than zero", 400);
  return {
    id: requiredUuid(value.id, "id"),
    fromNodeId: requiredUuid(value.fromNodeId, "fromNodeId"),
    radius,
  };
}

function parseDelete(value: unknown): { id: string; fromNodeId: string } {
  if (!isRecord(value)) throw new PortalRequestError("request body must be an object", 400);
  return {
    id: requiredUuid(value.id, "id"),
    fromNodeId: requiredUuid(value.fromNodeId, "fromNodeId"),
  };
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new PortalRequestError("request body must be valid JSON", 400);
  }
}

function serializePortal(portal: {
  id: string;
  name: string;
  positionX: number;
  positionY: number;
  positionZ: number;
  yaw: number;
  radius: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  spawnYaw: number;
  spawnPitch: number;
  toNodeId: string;
}): PortalRecord {
  return {
    id: portal.id,
    name: portal.name,
    position: { x: portal.positionX, y: portal.positionY, z: portal.positionZ },
    yaw: portal.yaw,
    radius: portal.radius,
    spawn: {
      x: portal.spawnX,
      y: portal.spawnY,
      z: portal.spawnZ,
      yaw: portal.spawnYaw,
      pitch: portal.spawnPitch,
    },
    toNodeId: portal.toNodeId,
  };
}

export const databasePortalMutationStore: PortalMutationStore = {
  async create(input) {
    return getDb().$transaction(async (tx) => {
      const nodes = await tx.sceneNode.findMany({
        where: { id: { in: [input.fromNodeId, input.toNodeId] } },
        select: { id: true, placeId: true },
      });
      const source = nodes.find((node) => node.id === input.fromNodeId);
      const destination = nodes.find((node) => node.id === input.toNodeId);
      if (!source || !destination) throw new PortalRequestError("source or destination scene not found", 404);
      if (source.placeId !== destination.placeId) {
        throw new PortalRequestError("portal scenes must belong to the same place", 400);
      }
      const existing = await tx.portal.findFirst({
        where: { fromNodeId: input.fromNodeId, name: input.name },
        select: { id: true },
      });
      if (existing) throw new PortalRequestError("portal name already exists in source scene", 409);
      const portal = await tx.portal.create({
        data: {
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          sourceKey: `runtime:${crypto.randomUUID()}`,
          name: input.name,
          positionX: input.position.x,
          positionY: input.position.y,
          positionZ: input.position.z,
          yaw: input.yaw,
          radius: input.radius,
          spawnX: input.spawn.x,
          spawnY: input.spawn.y,
          spawnZ: input.spawn.z,
          spawnYaw: input.spawn.yaw,
          spawnPitch: input.spawn.pitch,
        },
      });
      return serializePortal(portal);
    });
  },
  async updateRadius(input) {
    const result = await getDb().portal.updateMany({
      where: { id: input.id, fromNodeId: input.fromNodeId },
      data: { radius: input.radius },
    });
    if (result.count === 0) throw new PortalRequestError("portal not found", 404);
    const portal = await getDb().portal.findUnique({ where: { id: input.id } });
    if (!portal) throw new PortalRequestError("portal not found", 404);
    return serializePortal(portal);
  },
  async delete(input) {
    const result = await getDb().portal.deleteMany({ where: input });
    if (result.count === 0) throw new PortalRequestError("portal not found", 404);
  },
};

export function portalAuthoringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PORTAL_AUTHORING_ENABLED === "1";
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof PortalRequestError) return c.json({ error: error.message }, error.status);
  if (isRecord(error) && error.code === "P2002") return c.json({ error: "Portal already exists" }, 409);
  console.error("[portal] mutation failed", error);
  return c.json({ error: "Portal mutation failed" }, 500);
}

export function createPortalsRoute(
  store: PortalMutationStore = databasePortalMutationStore,
  authoringEnabled: () => boolean = portalAuthoringEnabled,
): Hono {
  const route = new Hono();
  route.use("/", async (c, next) => {
    if (!authoringEnabled()) return c.json({ error: "Not found" }, 404);
    await next();
  });
  route.post("/", async (c) => {
    try {
      const portal = await store.create(parseCreate(await readJson(c)));
      return c.json({ portal }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  route.patch("/", async (c) => {
    try {
      const portal = await store.updateRadius(parseUpdate(await readJson(c)));
      return c.json({ portal });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  route.delete("/", async (c) => {
    try {
      const input = parseDelete(await readJson(c));
      await store.delete(input);
      return c.json({ deletedId: input.id });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
  return route;
}

export const portals = createPortalsRoute();
