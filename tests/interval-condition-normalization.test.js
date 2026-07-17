'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApplication, validateReferences, parseEnabledWhen } = require('../src/app-platform');

test('parses a direct interval state key', () => {
  assert.deepEqual(parseEnabledWhen('state.playCoin === true'), ['playCoin']);
});

test('splits OR interval expressions into separate state keys', () => {
  assert.deepEqual(parseEnabledWhen('playCoin || playJump'), ['playCoin', 'playJump']);
});

test('normalization expands OR intervals into valid capabilities', () => {
  const app = normalizeApplication({
    title: 'Game',
    description: '',
    state: { playCoin: false, playJump: false, count: 0 },
    components: [{ id: 'label', type: 'text', text: 'Game' }],
    capabilities: [{ id: 'soundTimer', type: 'interval', event: 'sound.tick', everyMs: 100, enabledWhen: 'playCoin || playJump' }],
    rules: [{ event: 'sound.tick', actions: [{ op: 'increment', target: 'count', value: 1 }] }]
  });
  assert.deepEqual(app.capabilities.map(item => [item.id, item.enabledWhen]), [
    ['soundTimer_1', 'playCoin'],
    ['soundTimer_2', 'playJump']
  ]);
  assert.doesNotThrow(() => validateReferences(app));
});

test('AND interval expressions fail with a useful error', () => {
  assert.throws(() => parseEnabledWhen('playing && hasFocus'), /cannot use AND expressions/);
});
