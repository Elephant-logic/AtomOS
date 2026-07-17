'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApplication, validateReferences } = require('../src/app-platform');

test('converts a platform-game board without list data into a scene', () => {
  const app = normalizeApplication({
    title: 'Forest Escape', description: '',
    state: { entities: [{ id: 'player', x: 0, y: 0, width: 24, height: 24 }] },
    components: [{ id: 'level_board', type: 'board', bind: 'levelMap', rows: 10, cols: 20, world: { gravity: 700 } }],
    rules: []
  });
  assert.equal(app.components[0].type, 'scene');
  assert.equal(app.components[0].bind, 'entities');
  assert.doesNotThrow(() => validateReferences(app));
});

test('keeps real list-backed boards unchanged', () => {
  const app = normalizeApplication({
    title: 'Board', description: '', state: { cells: ['', '', '', ''] },
    components: [{ id: 'board', type: 'board', bind: 'cells', rows: 2, cols: 2 }], rules: []
  });
  assert.equal(app.components[0].type, 'board');
  assert.doesNotThrow(() => validateReferences(app));
});
