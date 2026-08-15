import assert from 'node:assert/strict';
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

const { Blending, Side } = await import('@manycore/aholo-viewer');
const {
    PORTAL_MATERIAL_OPTIONS,
    PORTAL_VISUAL,
    buildPortalMarker,
} = await import('./portal-renderer');

assert.deepEqual(PORTAL_VISUAL, {
    beamHeight: 2.4,
    beamWidth: 0.22,
    glowRadius: 1.7,
    floorOffset: 0.12,
    spinSpeed: 0.6,
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
}
assert.ok(Math.abs(radialExtent - PORTAL_VISUAL.glowRadius) < 1e-9);
assert.equal(minY, 0);
assert.equal(maxY, PORTAL_VISUAL.beamHeight);

assert.deepEqual(PORTAL_MATERIAL_OPTIONS, {
    enableVertexColor: true,
    transparent: true,
    blending: Blending.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: Side.DoubleSide,
});
