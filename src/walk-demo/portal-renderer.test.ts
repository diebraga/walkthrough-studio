import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Portal } from './portals';
// aholo-viewer reads these browser globals while its module graph initializes.
globalThis.requestAnimationFrame ??= () => 0;
globalThis.cancelAnimationFrame ??= () => {};
globalThis.ImageData ??= class ImageData {} as unknown as typeof ImageData;
globalThis.window ??= globalThis as typeof globalThis & Window;
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
(globalThis as typeof globalThis & { HTMLCanvasElement?: typeof HTMLCanvasElement }).HTMLCanvasElement ??= class HTMLCanvasElement {
    toDataURL(): string {
        return '';
    }
} as unknown as typeof HTMLCanvasElement;
const browserGlobals = globalThis as Record<string, unknown>;
for (const name of ['HTMLImageElement', 'HTMLVideoElement', 'OffscreenCanvas', 'ImageBitmap']) {
    browserGlobals[name] ??= class {};
}

const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const timeout = nativeSetTimeout(...args);
    if (args[1] === 600_000) {
        (timeout as unknown as { unref?(): void }).unref?.();
    }
    return timeout;
}) as typeof setTimeout;

let viewerModule!: typeof import('@manycore/aholo-viewer');
let portalRendererModule!: typeof import('./portal-renderer');
try {
    viewerModule = await import('@manycore/aholo-viewer');
    portalRendererModule = await import('./portal-renderer');
} finally {
    globalThis.setTimeout = nativeSetTimeout;
}

const { Blending, Mesh, Side } = viewerModule;
const {
    PORTAL_MATERIAL_OPTIONS,
    PORTAL_VISUAL,
    PortalRenderer,
    buildPortalMarker,
} = portalRendererModule;

assert.deepEqual(PORTAL_VISUAL, {
    glowRadius: 1.7,
    floorOffset: 0.12,
    renderOrder: 10_000,
});

const marker = buildPortalMarker(PORTAL_VISUAL.glowRadius, 0x33bbff);
const positions = marker.positions;
let radialExtent = 0;
let minY = Infinity;
let maxY = -Infinity;
for (let index = 0; index < positions.length; index += 3) {
    radialExtent = Math.max(radialExtent, Math.hypot(positions[index]!, positions[index + 2]!));
    minY = Math.min(minY, positions[index + 1]!);
    maxY = Math.max(maxY, positions[index + 1]!);
    assert.equal(positions[index + 1], 0);
}
assert.equal(Number(radialExtent.toFixed(12)), PORTAL_VISUAL.glowRadius);
assert.equal(minY, 0);
assert.equal(maxY, 0);
assert.equal(positions.length / 9, 24);

assert.deepEqual(PORTAL_MATERIAL_OPTIONS, {
    enableVertexColor: true,
    transparent: true,
    blending: Blending.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: Side.DoubleSide,
});

type PortalMesh = InstanceType<typeof Mesh>;

interface ResourceCalls {
    removeFromParent: number;
    freeAllGpuResourceOwned: number;
}

const addedMeshes: PortalMesh[] = [];
const resourceCalls = new Map<PortalMesh, ResourceCalls>();
const fakeScene = {
    add(mesh: PortalMesh) {
        const calls = { removeFromParent: 0, freeAllGpuResourceOwned: 0 };
        mesh.removeFromParent = () => {
            calls.removeFromParent += 1;
        };
        mesh.freeAllGpuResourceOwned = () => {
            calls.freeAllGpuResourceOwned += 1;
        };
        resourceCalls.set(mesh, calls);
        addedMeshes.push(mesh);
        return this;
    },
} as unknown as import('@manycore/aholo-viewer').Scene3D;

const portals = [
    {
        name: 'ember',
        position: { x: 2.5, y: 99, z: -4.25 },
        yaw: 0.3,
        radius: 1.1,
        to: null,
        spawn: null,
    },
    {
        name: 'quartz',
        position: { x: -7, y: -99, z: 8.5 },
        yaw: -0.8,
        radius: 0.9,
        to: null,
        spawn: null,
    },
] satisfies Portal[];

function expectedRgb(hex: number): number[] {
    return Array.from(new Float32Array([
        ((hex >> 16) & 0xff) / 255,
        ((hex >> 8) & 0xff) / 255,
        (hex & 0xff) / 255,
    ]));
}

function assertMarkerColors(mesh: PortalMesh, centerHex: number): void {
    const colorAttribute = mesh.geometry.getAttribute('color');
    assert.ok(colorAttribute);
    const colors = colorAttribute.array;
    for (let index = 0; index < colors.length; index += 9) {
        assert.deepEqual(Array.from(colors.slice(index, index + 3)), expectedRgb(centerHex));
        assert.deepEqual(Array.from(colors.slice(index + 3, index + 9)), [0, 0, 0, 0, 0, 0]);
    }
}

function assertMaterialContract(mesh: PortalMesh): void {
    const material = mesh.expectOnlyMaterial();
    assert.deepEqual({
        enableVertexColor: material.enableVertexColor,
        transparent: material.transparent,
        blending: material.blending,
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
        side: material.side,
    }, PORTAL_MATERIAL_OPTIONS);
}

const renderer = new PortalRenderer(fakeScene);
renderer.update(portals, 'quartz', -1.75);
assert.equal(addedMeshes.length, 2);

const [normalMesh, activeMesh] = addedMeshes;
assert.ok(normalMesh);
assert.ok(activeMesh);
assert.deepEqual(
    { x: normalMesh.position.x, y: normalMesh.position.y, z: normalMesh.position.z },
    { x: 2.5, y: -1.75 + PORTAL_VISUAL.floorOffset, z: -4.25 },
);
assert.deepEqual(
    { x: activeMesh.position.x, y: activeMesh.position.y, z: activeMesh.position.z },
    { x: -7, y: -1.75 + PORTAL_VISUAL.floorOffset, z: 8.5 },
);
assert.equal(normalMesh.renderOrder, PORTAL_VISUAL.renderOrder);
assert.equal(activeMesh.renderOrder, PORTAL_VISUAL.renderOrder);
assert.equal(normalMesh.visible, true);
assert.equal(activeMesh.visible, true);
assertMaterialContract(normalMesh);
assertMaterialContract(activeMesh);
assertMarkerColors(normalMesh, 0x33bbff);
assertMarkerColors(activeMesh, 0xffd400);

renderer.update(portals, 'quartz', -1.75);
assert.equal(addedMeshes.length, 2, 'an unchanged update keeps existing meshes');
assert.deepEqual(resourceCalls.get(normalMesh), { removeFromParent: 0, freeAllGpuResourceOwned: 0 });
assert.deepEqual(resourceCalls.get(activeMesh), { removeFromParent: 0, freeAllGpuResourceOwned: 0 });

renderer.setVisible(false);
assert.equal(normalMesh.visible, false);
assert.equal(activeMesh.visible, false);

renderer.update(portals, 'ember', -1.75);
assert.equal(addedMeshes.length, 4, 'a changed update replaces every portal mesh');
assert.deepEqual(resourceCalls.get(normalMesh), { removeFromParent: 1, freeAllGpuResourceOwned: 1 });
assert.deepEqual(resourceCalls.get(activeMesh), { removeFromParent: 1, freeAllGpuResourceOwned: 1 });
const replacementMeshes = addedMeshes.slice(2);
assert.ok(replacementMeshes.every((mesh) => mesh.visible === false));
assertMarkerColors(replacementMeshes[0]!, 0xffd400);
assertMarkerColors(replacementMeshes[1]!, 0x33bbff);

renderer.setVisible(true);
assert.ok(replacementMeshes.every((mesh) => mesh.visible === true));
renderer.dispose();
for (const mesh of replacementMeshes) {
    assert.deepEqual(resourceCalls.get(mesh), { removeFromParent: 1, freeAllGpuResourceOwned: 1 });
}

renderer.update(portals, 'ember', -1.75);
assert.equal(addedMeshes.length, 6, 'dispose clears the update key so the same state can be rebuilt');
renderer.dispose();
for (const mesh of addedMeshes.slice(4)) {
    assert.deepEqual(resourceCalls.get(mesh), { removeFromParent: 1, freeAllGpuResourceOwned: 1 });
}

const walkDemoSource = readFileSync(new URL('./walk-demo.ts', import.meta.url), 'utf8');
assert.ok(!walkDemoSource.includes('.portalRenderer?.tick('));
