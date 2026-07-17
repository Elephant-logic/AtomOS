'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../public/runtime-core');
const { normalizeApplication, validateReferences } = require('../server');

function prepare(app) {
  const value = normalizeApplication(structuredClone(app));
  validateReferences(value);
  return value;
}

test('screens navigate between website pages', () => {
  const app = prepare({
    title: 'Site', description: '', screens: ['home', 'about'], activeScreen: 'activeScreen',
    state: { activeScreen: 'home' },
    components: [
      { id: 'go', type: 'button', label: 'About', event: 'go.click', screen: 'home' },
      { id: 'about', type: 'heading', text: 'About', screen: 'about' }
    ],
    rules: [{ event: 'go.click', actions: [{ op: 'navigate', target: 'activeScreen', value: 'about' }] }]
  });
  const state = structuredClone(app.state);
  runtime.executeEvent(app, state, 'go.click');
  assert.equal(state.activeScreen, 'about');
});

test('board clicks can update the selected cell with indexFrom', () => {
  const app = prepare({
    title: 'Board', description: '',
    state: { cells: ['', '', '', ''], selected: 2, mark: 'X' },
    components: [{ id: 'grid', type: 'board', rows: 2, cols: 2, bind: 'cells', event: 'grid.select', indexState: 'selected' }],
    rules: [{ event: 'grid.select', actions: [{ op: 'list_set', target: 'cells', indexFrom: 'selected', from: 'mark' }] }]
  });
  const state = structuredClone(app.state);
  runtime.executeEvent(app, state, 'grid.select');
  assert.deepEqual(state.cells, ['', '', 'X', '']);
});

test('repeat supports object-backed galleries and item events', () => {
  const app = prepare({
    title: 'Gallery', description: '',
    state: { products: [{ name: 'One', src: 'https://example.com/one.png' }], selectedProduct: 0, message: '' },
    components: [{ id: 'products', type: 'repeat', bind: 'products', itemType: 'card', itemLabelField: 'name', itemEvent: 'products.select', itemIndexState: 'selectedProduct' }],
    rules: [{ event: 'products.select', actions: [{ op: 'set', target: 'message', value: 'selected' }] }]
  });
  assert.equal(app.components[0].itemIndexState, 'selectedProduct');
});

test('groups validate child ids and conditional state keys', () => {
  const app = prepare({
    title: 'Layout', description: '', state: { open: true },
    components: [
      { id: 'title', type: 'heading', text: 'Hello', visibleWhen: 'open' },
      { id: 'layout', type: 'group', layout: 'column', children: ['title'] }
    ], rules: []
  });
  assert.equal(app.components[1].layout, 'column');
  assert.throws(() => prepare({
    title: 'Bad', description: '', state: {},
    components: [{ id: 'layout', type: 'group', children: ['missing'] }], rules: []
  }), /unknown child/);
});

test('unsafe images and invalid links are rejected', () => {
  assert.throws(() => prepare({
    title: 'Bad image', description: '', state: {},
    components: [{ id: 'pic', type: 'image', src: 'javascript:alert(1)' }], rules: []
  }), /https or data:image/);
  assert.throws(() => prepare({
    title: 'Bad link', description: '', screens: ['home'], activeScreen: 'screen', state: { screen: 'home' },
    components: [{ id: 'link', type: 'link', href: 'https://example.com', toScreen: 'home' }], rules: []
  }), /exactly one/);
});
