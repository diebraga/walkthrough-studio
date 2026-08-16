import assert from 'node:assert/strict';
import {
    commitCreatedPortal,
    commitDeletedPortal,
    commitUpdatedPortal,
    createDatabasePortal,
    deleteDatabasePortal,
    portalDestinationOptions,
    updateDatabasePortalRadius,
} from './portal-authoring';
import { createPortal } from './portals';
import type { WalkDemoScheme } from './runtime-scenes';

const pose = (px: number, py: number, pz: number) => ({
    px,
    py,
    pz,
    yaw: 0,
    pitch: 0,
    thirdPersonDistance: 3.4,
});
const schemes = {
    'hall-id': { id: 'hall-id', name: 'Hall', source: 'database', pose: pose(0, -0.4, 0) },
    'balcony-id': { id: 'balcony-id', name: 'Balcony', source: 'database', pose: pose(9.14, 0.17, 3.09) },
    outdoor: { id: 'outdoor', name: 'Outdoor', source: 'legacy', pose: pose(0, 0, 0) },
} as Record<string, WalkDemoScheme>;

assert.deepEqual(portalDestinationOptions(schemes, 'hall-id'), { Balcony: 'balcony-id' });
assert.deepEqual(portalDestinationOptions(schemes, 'balcony-id'), { Hall: 'hall-id' });

const draft = createPortal(
    'balcony-door',
    { x: 1, y: 2, z: 3 },
    0.25,
    schemes['balcony-id']!,
);
assert.deepEqual(draft, {
    name: 'balcony-door',
    position: { x: 1, y: 2, z: 3 },
    yaw: 0.25,
    radius: 0.8,
    toNodeId: 'balcony-id',
    to: null,
    spawn: { x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0 },
});

interface RecordedRequest {
    input: RequestInfo | URL;
    init?: RequestInit;
}
const requests: RecordedRequest[] = [];
const returnedPortal = { ...draft, id: 'portal-id' };
const fetcher: typeof fetch = async (input, init) => {
    requests.push({ input, init });
    if (init?.method === 'DELETE') {
        return Response.json({ deletedId: 'portal-id' });
    }
    if (init?.method === 'PATCH') {
        return Response.json({ portal: { ...returnedPortal, radius: 1.2 } });
    }
    return Response.json({ portal: returnedPortal }, { status: 201 });
};

assert.deepEqual(await createDatabasePortal({ fromNodeId: 'hall-id', portal: draft }, fetcher), returnedPortal);
assert.equal(requests[0]?.input, '/api/portals');
assert.equal(requests[0]?.init?.method, 'POST');
assert.deepEqual(JSON.parse(requests[0]?.init?.body as string), {
    fromNodeId: 'hall-id',
    toNodeId: 'balcony-id',
    name: 'balcony-door',
    position: { x: 1, y: 2, z: 3 },
    yaw: 0.25,
    radius: 0.8,
    spawn: { x: 9.14, y: 0.17, z: 3.09, yaw: 0, pitch: 0 },
});

const updated = await updateDatabasePortalRadius(
    { id: 'portal-id', fromNodeId: 'hall-id', radius: 1.2 },
    fetcher,
);
assert.equal(updated.radius, 1.2);
assert.equal(requests[1]?.init?.method, 'PATCH');

await deleteDatabasePortal({ id: 'portal-id', fromNodeId: 'hall-id' }, fetcher);
assert.equal(requests[2]?.init?.method, 'DELETE');

const failingFetcher: typeof fetch = async () => Response.json({ error: 'authoring disabled' }, { status: 404 });
await assert.rejects(
    createDatabasePortal({ fromNodeId: 'hall-id', portal: draft }, failingFetcher),
    /authoring disabled/,
);

let resolveCreate!: (portal: typeof returnedPortal) => void;
const deferredCreate = new Promise<typeof returnedPortal>((resolve) => {
    resolveCreate = resolve;
});
let activeNodeId = 'hall-id';
const pendingCommit = deferredCreate.then((created) => {
    const confirmed = commitCreatedPortal(schemes, 'hall-id', activeNodeId, created);
    return confirmed;
});
activeNodeId = 'balcony-id';
resolveCreate(returnedPortal);
assert.equal(await pendingCommit, null, 'a response for a departed source scene does not replace the active list');
assert.deepEqual(schemes['hall-id']?.portals, [returnedPortal], 'the response still updates its original source scheme');

schemes['hall-id']!.portals = [];
const first = { ...returnedPortal, id: 'portal-1', name: 'first' };
const second = { ...returnedPortal, id: 'portal-2', name: 'second' };
commitCreatedPortal(schemes, 'hall-id', 'hall-id', second);
assert.deepEqual(
    commitCreatedPortal(schemes, 'hall-id', 'hall-id', first)?.map((portal) => portal.id),
    ['portal-2', 'portal-1'],
    'overlapping creates merge into the latest confirmed source list regardless of response order',
);
const resized = { ...first, radius: 1.4 };
assert.equal(commitUpdatedPortal(schemes, 'hall-id', 'hall-id', resized)?.find((portal) => portal.id === first.id)?.radius, 1.4);
assert.deepEqual(
    commitDeletedPortal(schemes, 'hall-id', 'hall-id', second.id!)?.map((portal) => portal.id),
    ['portal-1'],
);
