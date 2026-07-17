'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const condition = require('../public/condition-expression');

test('condition evaluator supports generated UI expressions safely', () => {
  const state = { activeScreen:'menu', score:12, paused:false, ready:true, connected:false };
  assert.equal(condition.evaluate('activeScreen==menu', state), true);
  assert.equal(condition.evaluate('activeScreen == "game"', state), false);
  assert.equal(condition.evaluate('score >= 10 && !paused', state), true);
  assert.equal(condition.evaluate('ready || connected', state), true);
  assert.deepEqual(condition.extractStateKeys('score >= 10 && !paused'), ['score','paused']);
});

test('explicit state references remain available on comparison right sides', () => {
  const state = { selected:'menu', activeScreen:'menu' };
  assert.equal(condition.evaluate('activeScreen == state.selected', state), true);
  assert.deepEqual(condition.extractStateKeys('activeScreen == state.selected'), ['activeScreen','selected']);
});
