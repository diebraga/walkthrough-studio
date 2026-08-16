import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PortalActivationGate } from './portal-activation';

const gate = new PortalActivationGate();

assert.deepEqual(gate.observe('origin:destination'), { activate: true, armed: true });
assert.deepEqual(gate.observe('origin:destination'), { activate: false, armed: true });

gate.disarmForArrival();
assert.deepEqual(gate.observe('destination:origin'), { activate: false, armed: false });
assert.deepEqual(gate.observe('destination:overlapping'), { activate: false, armed: false });
assert.deepEqual(gate.observe(null), { activate: false, armed: true });

assert.deepEqual(gate.observe('destination:origin'), { activate: true, armed: true });
assert.deepEqual(gate.observe('destination:origin'), { activate: false, armed: true });

gate.disarmForArrival();
gate.reset();
assert.deepEqual(gate.observe('destination:origin'), { activate: true, armed: true });

const source = readFileSync(new URL('./walk-demo.ts', import.meta.url), 'utf8');
assert.ok(source.includes("import { PortalActivationGate } from './portal-activation';"));
assert.ok(source.includes('private readonly portalActivation = new PortalActivationGate();'));
assert.ok(source.includes("current.id ?? `${this.params.scheme}:${current.name}`"));

const updateStart = source.indexOf('private updatePortalTrigger');
const updateEnd = source.indexOf('private async teleportThroughPortal', updateStart);
const update = source.slice(updateStart, updateEnd);
const presentationIndex = update.indexOf("this.params.insidePortal = current?.name ?? '-';");
const activationIndex = update.indexOf('if (!this.teleporting) {');
const rendererIndex = update.indexOf('this.portalRenderer?.update(this.portals, this.insidePortalName, floorY);');
assert.notEqual(presentationIndex, -1);
assert.notEqual(activationIndex, -1);
assert.notEqual(rendererIndex, -1);
assert.ok(presentationIndex < activationIndex, 'diagnostics update even while gate observation is paused');
assert.ok(activationIndex < rendererIndex, 'visuals update even while gate observation is paused');
assert.match(
    update,
    /if \(!this\.teleporting\) \{\s+const activation = this\.portalActivation\.observe\(portalKey\);\s+if \(current && activation\.activate\) \{\s+void this\.teleportThroughPortal\(current\);\s+\}\s+\}/,
    'gate observation pauses while teleporting and runs again when teleporting clears',
);

const sceneSelectionStart = source.indexOf("this.sceneBinding = pane.addBinding(this.params, 'scheme'");
const sceneSelectionEnd = source.indexOf(".addBinding(this.params, 'thirdPersonCharacter'", sceneSelectionStart);
const sceneSelection = source.slice(sceneSelectionStart, sceneSelectionEnd);
assert.match(sceneSelection, /this\.portalActivation\.reset\(\);[\s\S]*?void this\.queueReloadScene\(\);/);
assert.match(sceneSelection, /this\.params\.portalDestination = '';\s+if \(this\.portalPane\) this\.mountPortalPanel\(pane\);/);
assert.match(
    sceneSelection,
    /this\.sceneBinding = pane\.addBinding\(this\.params, 'scheme', \{[\s\S]*?\}\)\.on\('change'/,
    'keeps the Scene binding so programmatic portal scene changes can refresh its displayed value',
);

const reloadStart = source.indexOf('private async reloadScene');
const reloadEnd = source.indexOf('private async tryLoadCollision', reloadStart);
const reload = source.slice(reloadStart, reloadEnd);
assert.match(
    reload,
    /if \(options\.scheme\) \{\s+this\.params\.scheme = options\.scheme;\s+this\.sceneBinding\?\.refresh\(\);[\s\S]*?\n        \}/,
    'refreshes the Scene binding after an internal reload changes params.scheme',
);

const teleportStart = source.indexOf('private async teleportThroughPortal');
const teleportEnd = source.indexOf('private setPortalFade', teleportStart);
const teleport = source.slice(teleportStart, teleportEnd);
assert.ok(teleport.indexOf('await this.setPortalFade(1);') < teleport.indexOf('this.portalActivation.disarmForArrival();'));
assert.ok(teleport.indexOf('this.portalActivation.disarmForArrival();') < teleport.indexOf('await this.queueReloadScene(target);'));
assert.match(teleport, /finally \{\s+this\.teleporting = false;\s+\}/);

assert.ok(!source.slice(reloadStart, reloadEnd).includes('this.portalActivation.reset()'));
assert.ok(source.includes("portalDestinationOptions(this.schemes, this.params.scheme)"));
assert.ok(source.includes("folder.addBinding(this.params, 'portalDestination'"));
assert.ok(source.includes("this.params.portalStatus = 'choose a destination';"));
assert.ok(source.includes('const created = await createDatabasePortal({ fromNodeId: sourceNodeId, portal: draft });'));
assert.ok(source.includes('this.replaceConfirmedPortals(sourceNodeId, [...sourcePortals, created]);'));
assert.ok(source.includes('await deleteDatabasePortal({ id: portal.id, fromNodeId: sourceNodeId });'));
assert.ok(source.includes('this.markPortalSaved(sourceNodeId);'));
assert.ok(source.includes('if (this.params.scheme !== sourceNodeId) return;'));
assert.ok(!source.includes('savePortals'));
assert.ok(!source.includes('/__dev/portals'));
