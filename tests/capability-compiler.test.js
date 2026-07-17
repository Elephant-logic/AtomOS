'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compileCapabilityPlan, planInstructions } = require('../src/capability-compiler');
const { APP_SCHEMA } = require('../src/app-schema');
const { normalizeApplication, validateReferences } = require('../src/app-platform');

test('plans reusable engine primitives and missing game molecules', () => {
  const plan = compileCapabilityPlan('Build a platformer with sprites, gravity, collisions, coins, checkpoints, camera follow, animation and sound.');
  assert.ok(plan.reusable.some(item => item.id === 'physics'));
  assert.ok(plan.reusable.some(item => item.id === 'camera'));
  assert.ok(plan.missing.some(item => item.id === 'collectibles'));
  assert.ok(plan.missing.some(item => item.id === 'checkpoints'));
  assert.ok(plan.generatedAtoms.some(atom => atom.id === 'generated.collectibles'));
  assert.match(planInstructions(plan), /never invent unsupported/i);
});

test('schema exposes scene and sound components', () => {
  const types = APP_SCHEMA.properties.components.items.properties.type.enum;
  assert.ok(types.includes('scene'));
  assert.ok(types.includes('sound'));
});

test('platform scene with nested entities validates', () => {
  const app = normalizeApplication({
    title: 'Test game', description: 'scene test',
    state: { entities: [{ id:'player', x:0, y:0, width:24, height:24, controls:{ left:'ArrowLeft', right:'ArrowRight' } }] },
    components: [{ id:'game', type:'scene', bind:'entities', width:640, height:360, world:{ gravity:700, camera:{follow:'player'}, map:{cols:1,rows:1,tileWidth:32,tileHeight:32,tiles:[1],solidTiles:[1]} } }],
    rules: []
  });
  assert.doesNotThrow(() => validateReferences(app));
});

test('compiler instructions forbid undefined action targets', () => {
  const instructions = planInstructions(compileCapabilityPlan('game with jumping'));
  assert.match(instructions, /target "undefined"/);
});
