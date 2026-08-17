import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./walk-demo.ts', import.meta.url), 'utf8');
const rendererConstruction = source.match(/this\.portalRenderer = new PortalRenderer\(this\.ctx\.renderer\.scene\);/);
const rendererUpdate = source.match(/this\.portalRenderer\?\.update\(this\.portals, floorY\);/);
const portalDevGateStart = source.indexOf("if (devEnabled('portals'))");
const portalDevGateEnd = source.indexOf('}', portalDevGateStart) + 1;

assert.ok(rendererConstruction, 'each loaded scene creates a portal renderer');
assert.ok(rendererUpdate, 'the frame loop updates the portal renderer');
assert.notEqual(portalDevGateStart, -1, 'portal authoring remains developer-gated');

const portalDevGate = source.slice(portalDevGateStart, portalDevGateEnd);
for (const snippet of [rendererConstruction[0], rendererUpdate[0]]) {
    assert.ok(!portalDevGate.includes(snippet), 'portal presentation must not be developer-gated');
}

assert.doesNotMatch(source, /showPortals/, 'the developer panel must not own portal visibility');

const sceneSelectionStart = source.indexOf("this.sceneBinding = pane.addBinding(this.params, 'scheme'");
const sceneSelectionEnd = source.indexOf(".addBinding(this.params, 'thirdPersonCharacter'", sceneSelectionStart);
const sceneSelection = source.slice(sceneSelectionStart, sceneSelectionEnd);
assert.match(
    sceneSelection,
    /if \(this\.portalPane\) this\.mountPortalPanel\(pane\);/,
    'scene changes only remount portal authoring when the developer-gated panel already exists',
);
assert.doesNotMatch(
    sceneSelection,
    /this\.params\.portalDestination = '';\s+this\.mountPortalPanel\(pane\);/,
    'scene changes must not expose portal authoring when the portals flag is off',
);
