import type { PlaceImport, PortalImport, SceneNodeImport } from "./discover.js";

const TAU = 2 * Math.PI;

export function completeReciprocalPortals(place: PlaceImport): PlaceImport {
  const nodesBySlug = new Map(place.nodes.map((node) => [node.slug, node]));
  const portalsByNodeSlug = new Map(
    place.nodes.map((node) => [node.slug, [...node.portals]]),
  );
  const explicitPortals = place.nodes.map((node) => ({
    node,
    portals: node.portals.filter((portal) => !isGenerated(portal)),
  }));
  const explicitPortalsByNodeSlug = new Map(
    explicitPortals.map(({ node, portals }) => [node.slug, portals]),
  );

  for (const { node: sourceNode, portals } of explicitPortals) {
    for (const forward of portals) {
      const targetNode = nodesBySlug.get(forward.toNodeSlug);
      if (!targetNode) {
        throw new Error(
          `portal destination "${forward.toNodeSlug}" does not exist in place "${place.slug}"`,
        );
      }

      const targetPortals = portalsByNodeSlug.get(targetNode.slug)!;
      const targetExplicitPortals = explicitPortalsByNodeSlug.get(targetNode.slug)!;
      if (targetExplicitPortals.some((portal) => portal.toNodeSlug === sourceNode.slug)) continue;
      const sourceKey = `generated-reverse:${forward.sourceKey}`;
      if (targetPortals.some((portal) => portal.sourceKey === sourceKey)) continue;

      targetPortals.push(createReversePortal(sourceNode, forward));
    }
  }

  return {
    ...place,
    nodes: place.nodes.map((node) => ({
      ...node,
      portals: portalsByNodeSlug.get(node.slug)!,
    })),
  };
}

function createReversePortal(sourceNode: SceneNodeImport, forward: PortalImport): PortalImport {
  return {
    sourceKey: `generated-reverse:${forward.sourceKey}`,
    name: sourceNode.name,
    toNodeSlug: sourceNode.slug,
    position: {
      x: forward.spawn.x,
      y: forward.spawn.y,
      z: forward.spawn.z,
    },
    yaw: forward.spawn.yaw,
    radius: forward.radius,
    spawn: {
      x: forward.position.x,
      y: forward.position.y,
      z: forward.position.z,
      yaw: normalizeYaw(forward.yaw + Math.PI),
      pitch: 0,
    },
    metadata: { generated: true, reverseOf: forward.sourceKey },
  };
}

function isGenerated(portal: PortalImport): boolean {
  return (
    typeof portal.metadata === "object"
    && portal.metadata !== null
    && !Array.isArray(portal.metadata)
    && portal.metadata.generated === true
  );
}

function normalizeYaw(yaw: number): number {
  return ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
