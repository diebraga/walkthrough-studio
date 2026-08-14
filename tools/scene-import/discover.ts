import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type SceneAssetImportType =
  | "GAUSSIAN_SPLAT"
  | "COLLISION_REPORT"
  | "MANUAL_COLLISION"
  | "OTHER";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SceneAssetImport {
  type: SceneAssetImportType;
  objectKey: string | null;
  originalPath: string;
  mimeType: string;
  sizeBytes: number;
  metadata: JsonValue | null;
}

export interface PortalImport {
  sourceKey: string;
  name: string;
  toNodeSlug: string;
  position: { x: number; y: number; z: number };
  yaw: number;
  radius: number;
  spawn: { x: number; y: number; z: number; yaw: number; pitch: number };
  metadata: JsonValue | null;
}

export interface SceneNodeImport {
  slug: string;
  name: string;
  collisionData: JsonValue | null;
  metadata: JsonValue;
  assets: SceneAssetImport[];
  portals: PortalImport[];
}

export interface PlaceImport {
  slug: string;
  name: string;
  description: string | null;
  metadata: JsonValue;
  nodes: SceneNodeImport[];
}

export interface SceneImportPlan {
  places: PlaceImport[];
}

const KNOWN_PLACE_NAMES: Record<string, string> = {
  "23_nashville_dr_tenessee": "23 Nashville Dr Tennessee",
};

export async function discoverSceneImport(rootDirectory: string): Promise<SceneImportPlan> {
  const root = path.resolve(rootDirectory);
  const rootPrefix = path.basename(root) === "public" ? "public" : "";
  const places: PlaceImport[] = [];

  for (const placeEntry of await directories(root)) {
    const placePath = path.join(root, placeEntry);
    const nodes: SceneNodeImport[] = [];
    for (const nodeEntry of await directories(placePath)) {
      nodes.push(await discoverNode(root, rootPrefix, placeEntry, nodeEntry));
    }
    if (!nodes.length) continue;
    places.push({
      slug: placeEntry,
      name: KNOWN_PLACE_NAMES[placeEntry] ?? humanizeSlug(placeEntry),
      description: null,
      metadata: { importPath: sourcePath(rootPrefix, placeEntry) },
      nodes,
    });
  }

  return { places };
}

async function discoverNode(
  root: string,
  rootPrefix: string,
  placeSlug: string,
  nodeSlug: string,
): Promise<SceneNodeImport> {
  const nodePath = path.join(root, placeSlug, nodeSlug);
  const files = (await readdir(nodePath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
  let collisionData: JsonValue | null = null;
  const assets: SceneAssetImport[] = [];
  const portals: PortalImport[] = [];

  for (const filename of files) {
    const absolutePath = path.join(nodePath, filename);
    const relativeSource = sourcePath(rootPrefix, placeSlug, nodeSlug, filename);
    if (filename === "collision.json") {
      collisionData = await readJson(absolutePath, sourcePath(placeSlug, nodeSlug, filename));
      continue;
    }
    if (filename === "portals.json") {
      portals.push(
        ...parsePortals(
          await readJson(absolutePath, sourcePath(placeSlug, nodeSlug, filename)),
          sourcePath(placeSlug, nodeSlug, filename),
        ),
      );
      continue;
    }

    const fileStat = await stat(absolutePath);
    const metadata = filename.endsWith(".json")
      ? await readJson(absolutePath, sourcePath(placeSlug, nodeSlug, filename))
      : null;
    assets.push({
      type: assetType(filename),
      objectKey: null,
      originalPath: relativeSource,
      mimeType: mimeType(filename),
      sizeBytes: fileStat.size,
      metadata,
    });
  }

  return {
    slug: nodeSlug,
    name: humanizeSlug(nodeSlug),
    collisionData,
    metadata: { importPath: sourcePath(rootPrefix, placeSlug, nodeSlug) },
    assets,
    portals,
  };
}

function parsePortals(value: JsonValue, relativePath: string): PortalImport[] {
  if (!isRecord(value) || !Array.isArray(value.portals)) {
    throw new Error(`${relativePath} must contain a portals array`);
  }
  return value.portals.map((item, index) => {
    if (!isRecord(item) || !isRecord(item.position) || !isRecord(item.spawn)) {
      throw new Error(`${relativePath} portal #${index} has an invalid shape`);
    }
    const portal = {
      sourceKey: `${relativePath}#${index}`,
      name: requiredString(item.name, relativePath, index, "name"),
      toNodeSlug: requiredString(item.to, relativePath, index, "to"),
      position: {
        x: requiredNumber(item.position.x, relativePath, index, "position.x"),
        y: requiredNumber(item.position.y, relativePath, index, "position.y"),
        z: requiredNumber(item.position.z, relativePath, index, "position.z"),
      },
      yaw: requiredNumber(item.yaw, relativePath, index, "yaw"),
      radius: requiredNumber(item.radius, relativePath, index, "radius"),
      spawn: {
        x: requiredNumber(item.spawn.x, relativePath, index, "spawn.x"),
        y: requiredNumber(item.spawn.y, relativePath, index, "spawn.y"),
        z: requiredNumber(item.spawn.z, relativePath, index, "spawn.z"),
        yaw: requiredNumber(item.spawn.yaw, relativePath, index, "spawn.yaw"),
        pitch: requiredNumber(item.spawn.pitch, relativePath, index, "spawn.pitch"),
      },
      metadata: unknownProperties(item, ["name", "to", "position", "yaw", "radius", "spawn"]),
    } satisfies PortalImport;
    return portal;
  });
}

async function readJson(absolutePath: string, displayPath: string): Promise<JsonValue> {
  try {
    return JSON.parse(await readFile(absolutePath, "utf8")) as JsonValue;
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${displayPath} contains invalid JSON`, { cause: error });
    throw error;
  }
}

async function directories(parent: string): Promise<string[]> {
  return (await readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

function assetType(filename: string): SceneAssetImportType {
  if (filename === "index.ply") return "GAUSSIAN_SPLAT";
  if (filename === "collision-report.json") return "COLLISION_REPORT";
  if (filename === "manual-collision.json") return "MANUAL_COLLISION";
  return "OTHER";
}

function mimeType(filename: string): string {
  if (filename.endsWith(".json")) return "application/json";
  if (filename.endsWith(".txt")) return "text/plain";
  if (filename.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (filename.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function unknownProperties(value: Record<string, JsonValue>, known: string[]): JsonValue | null {
  const unknown = Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)));
  return Object.keys(unknown).length ? unknown : null;
}

function requiredString(value: JsonValue | undefined, file: string, index: number, field: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${file} portal #${index} needs ${field}`);
  return value;
}

function requiredNumber(value: JsonValue | undefined, file: string, index: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${file} portal #${index} needs numeric ${field}`);
  }
  return value;
}

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sourcePath(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}
