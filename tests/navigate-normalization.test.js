'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApplication, validateReferences } = require('../server');

function prepare(actions) {
  const app = normalizeApplication({
    title: 'Menus',
    description: '',
    screens: ['menu', 'game'],
    activeScreen: 'activeScreen',
    state: { activeScreen: 'menu' },
    components: [{ id: 'start', type: 'button', label: 'Start', event: 'start.click', screen: 'menu' }],
    rules: [{ event: 'start.click', actions }]
  });
  validateReferences(app);
  return app;
}

test('repairs navigate actions that put the screen name in target', () => {
  const app = prepare([{ op: 'navigate', target: 'game' }]);
  assert.deepEqual(app.rules[0].actions[0], {
    op: 'navigate',
    target: 'activeScreen',
    value: 'game'
  });
});

test('repairs navigate target when value already names a declared screen', () => {
  const app = prepare([{ op: 'navigate', target: 'menu', value: 'game' }]);
  assert.equal(app.rules[0].actions[0].target, 'activeScreen');
  assert.equal(app.rules[0].actions[0].value, 'game');
});

test('does not hide an invalid navigate destination', () => {
  assert.throws(
    () => prepare([{ op: 'navigate', target: 'nowhere' }]),
    /Unknown action target|navigate must target/
  );
});
