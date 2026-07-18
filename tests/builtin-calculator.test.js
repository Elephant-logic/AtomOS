'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CALCULATOR, matchBuiltinApp } = require('../src/builtin-apps');
const { normalizeApplication, validateReferences } = require('../src/app-platform');
const runtime = require('../public/runtime-core');

test('calculator prompts select the deterministic builtin', () => {
  const match = matchBuiltinApp('Build a calculator with plus, minus, multiply and divide.');
  assert.equal(match.id, 'calculator');
  assert.notEqual(match.app, CALCULATOR);
});

test('calculator builtin validates and calculates reliably', () => {
  const app = normalizeApplication(structuredClone(CALCULATOR));
  assert.doesNotThrow(() => validateReferences(app));
  const state = structuredClone(app.state);
  for (const event of ['one', 'plus', 'two', 'multiply', 'three', 'equals']) runtime.executeEvent(app, state, event);
  assert.equal(state.expression, 7);
  runtime.executeEvent(app, state, 'clear');
  assert.equal(state.expression, 0);
});
