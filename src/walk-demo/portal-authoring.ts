import type { Portal } from './portals';
import type { WalkDemoScheme } from './runtime-scenes';

export function portalDestinationOptions(
    schemes: Readonly<Record<string, WalkDemoScheme>>,
    activeNodeId: string,
): Record<string, string> {
    return Object.fromEntries(
        Object.values(schemes)
            .filter((scheme) => scheme.source === 'database' && scheme.id !== activeNodeId)
            .map((scheme) => [scheme.name, scheme.id]),
    );
}

export function applyConfirmedPortals(
    schemes: Record<string, WalkDemoScheme>,
    sourceNodeId: string,
    activeNodeId: string,
    portals: Portal[],
): Portal[] | null {
    const source = schemes[sourceNodeId];
    if (!source) return null;
    source.portals = portals.map((portal) => ({ ...portal }));
    return sourceNodeId === activeNodeId ? portals : null;
}

interface PortalResponse {
    portal?: Omit<Portal, 'to'>;
    error?: string;
}

async function portalRequest(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    fetcher: typeof fetch,
): Promise<PortalResponse> {
    const response = await fetcher('/api/portals', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json() as PortalResponse;
    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
}

export async function createDatabasePortal(
    input: { fromNodeId: string; portal: Portal },
    fetcher: typeof fetch = fetch,
): Promise<Portal> {
    const portal = input.portal;
    if (!portal.toNodeId || !portal.spawn) {
        throw new Error('Portal destination and spawn are required');
    }
    const data = await portalRequest('POST', {
        fromNodeId: input.fromNodeId,
        toNodeId: portal.toNodeId,
        name: portal.name,
        position: portal.position,
        yaw: portal.yaw,
        radius: portal.radius,
        spawn: portal.spawn,
    }, fetcher);
    if (!data.portal) throw new Error('Portal API response is missing portal');
    return { ...data.portal, to: null };
}

export async function updateDatabasePortalRadius(
    input: { id: string; fromNodeId: string; radius: number },
    fetcher: typeof fetch = fetch,
): Promise<Portal> {
    const data = await portalRequest('PATCH', input, fetcher);
    if (!data.portal) throw new Error('Portal API response is missing portal');
    return { ...data.portal, to: null };
}

export async function deleteDatabasePortal(
    input: { id: string; fromNodeId: string },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await portalRequest('DELETE', input, fetcher);
}
