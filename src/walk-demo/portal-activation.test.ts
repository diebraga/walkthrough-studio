import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PortalActivationGate } from './portal-activation';

const gate = new PortalActivationGate();

assert.deepEqual(gate.observe('hall:balcony'), { activate: true, armed: true });
assert.deepEqual(gate.observe('hall:balcony'), { activate: false, armed: true });

gate.disarmForArrival();
assert.deepEqual(gate.observe('balcony:hall'), { activate: false, armed: false });
assert.deepEqual(gate.observe('balcony:overlapping'), { activate: false, armed: false });
assert.deepEqual(gate.observe(null), { activate: false, armed: true });

assert.deepEqual(gate.observe('balcony:hall'), { activate: true, armed: true });
assert.deepEqual(gate.observe('balcony:hall'), { activate: false, armed: true });

gate.disarmForArrival();
gate.reset();
assert.deepEqual(gate.observe('balcony:hall'), { activate: true, armed: true });

const source = readFileSync(new URL('./walk-demo.ts', import.meta.url), 'utf8');
assert.ok(source.includes("import { PortalActivationGate } from './portal-activation';"));
assert.ok(source.includes('private readonly portalActivation = new PortalActivationGate();'));
assert.ok(source.includes("current.id ?? `${this.params.scheme}:${current.name}`"));
assert.ok(source.includes('const activation = this.portalActivation.observe(portalKey);'));
assert.match(source, /if \(current && activation\.activate\) \{\s+void this\.teleportThroughPortal\(current\);\s+\}/);

const sceneSelectionStart = source.indexOf("pane.addBinding(this.params, 'scheme'");
const sceneSelectionEnd = source.indexOf(".addBinding(this.params, 'thirdPersonCharacter'", sceneSelectionStart);
const sceneSelection = source.slice(sceneSelectionStart, sceneSelectionEnd);
assert.match(sceneSelection, /this\.portalActivation\.reset\(\);\s+void this\.queueReloadScene\(\);/);

const teleportStart = source.indexOf('private async teleportThroughPortal');
const teleportEnd = source.indexOf('private setPortalFade', teleportStart);
const teleport = source.slice(teleportStart, teleportEnd);
assert.ok(teleport.indexOf('await this.setPortalFade(1);') < teleport.indexOf('this.portalActivation.disarmForArrival();'));
assert.ok(teleport.indexOf('this.portalActivation.disarmForArrival();') < teleport.indexOf('await this.queueReloadScene(target);'));

const reloadStart = source.indexOf('private async reloadScene');
const reloadEnd = source.indexOf('private async tryLoadCollision', reloadStart);
assert.ok(!source.slice(reloadStart, reloadEnd).includes('this.portalActivation.reset()'));
