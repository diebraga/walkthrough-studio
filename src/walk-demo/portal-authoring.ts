import type { Portal } from './portals';
import type { WalkDemoScheme } from './runtime-scenes';

export class PortalMutationQueue {
    private readonly chains = new Map<string, Promise<void>>();

    enqueue(key: string, task: () => Promise<void>): Promise<void> {
        const previous = this.chains.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.chains.set(key, next);
        return next.finally(() => {
            if (this.chains.get(key) === next) this.chains.delete(key);
        });
    }
}

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

function commitPortalMutation(
    schemes: Record<string, WalkDemoScheme>,
    sourceNodeId: string,
    activeNodeId: string,
    mutate: (portals: Portal[]) => Portal[],
): Portal[] | null {
    const source = schemes[sourceNodeId];
    if (!source) return null;
    const portals = mutate(source.portals ? [...source.portals] : []);
    source.portals = portals.map((portal) => ({ ...portal }));
    return sourceNodeId === activeNodeId ? portals : null;
}

export function commitCreatedPortal(
    schemes: Record<string, WalkDemoScheme>,
    sourceNodeId: string,
    activeNodeId: string,
    created: Portal,
): Portal[] | null {
    return commitPortalMutation(schemes, sourceNodeId, activeNodeId, (portals) => [
        ...portals.filter((portal) => portal.id !== created.id),
        created,
    ]);
}

export function commitUpdatedPortal(
    schemes: Record<string, WalkDemoScheme>,
    sourceNodeId: string,
    activeNodeId: string,
    updated: Portal,
): Portal[] | null {
    return commitPortalMutation(
        schemes,
        sourceNodeId,
        activeNodeId,
        (portals) => portals.map((portal) => portal.id === updated.id ? updated : portal),
    );
}

export function commitDeletedPortal(
    schemes: Record<string, WalkDemoScheme>,
    sourceNodeId: string,
    activeNodeId: string,
    deletedId: string,
): Portal[] | null {
    return commitPortalMutation(
        schemes,
        sourceNodeId,
        activeNodeId,
        (portals) => portals.filter((portal) => portal.id !== deletedId),
    );
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
    if (!portal.toNodeId) {
        throw new Error('Portal destination is required');
    }
    const data = await portalRequest('POST', {
        fromNodeId: input.fromNodeId,
        toNodeId: portal.toNodeId,
        name: portal.name,
        position: portal.position,
        yaw: portal.yaw,
        radius: portal.radius,
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

export interface ScenePose {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
}

interface ScenePoseResponse {
    node?: { id: string; pose: ScenePose };
    error?: string;
}

export async function updateDatabaseScenePose(
    input: { id: string; pose: ScenePose },
    fetcher: typeof fetch = fetch,
): Promise<ScenePose> {
    const response = await fetcher('/api/scenes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await response.json() as ScenePoseResponse;
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (!data.node) throw new Error('Scene API response is missing node');
    if (data.node.id !== input.id) throw new Error('Scene API response has the wrong node id');
    return data.node.pose;
}

export function formatScenePoseStatus(sceneName: string, pose: ScenePose): string {
    const point = [pose.x, pose.y, pose.z].map((value) => value.toFixed(2)).join(', ');
    return `saved ${sceneName} spawn → (${point})`;
}

export async function deleteDatabasePortal(
    input: { id: string; fromNodeId: string },
    fetcher: typeof fetch = fetch,
): Promise<void> {
    await portalRequest('DELETE', input, fetcher);
}
