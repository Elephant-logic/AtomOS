'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateProject } = require('../src/fullstack-builder');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('translator and full-stack browser scripts parse as JavaScript', () => {
  assert.doesNotThrow(() => new Function(read('public/code-refinery.js')));
  assert.doesNotThrow(() => new Function(read('public/fullstack-studio.js')));
});

test('code refinery emits AtomOS language definitions with runtime implementations', () => {
  const source = read('public/code-refinery.js');
  assert.match(source, /atomosLanguageVersion/);
  assert.match(source, /translationStatus/);
  assert.match(source, /implementations/);
  assert.match(source, /Save to language library/);
  assert.match(source, /AtomOSTranslator/);
});

test('full-stack workspace builds incrementally without replacing either runtime', () => {
  const source = read('public/fullstack-studio.js');
  assert.match(source, /Build full stack/);
  assert.match(source, /Build suggested next bit/);
  assert.match(source, /frontend\/index\.html/);
  assert.match(source, /backend\//);
  assert.match(source, /contract:application-data/);
  assert.doesNotMatch(source, /runEvent\s*=/);
  assert.doesNotMatch(source, /request\s*=/);
});

test('project validator accepts connected files and rejects broken edges', () => {
  const project = {
    files:[{ path:'frontend/index.html' }, { path:'backend/app.py' }],
    nodes:[
      { id:'frontend', file:'frontend/index.html' },
      { id:'backend', file:'backend/app.py' }
    ],
    edges:[{ from:'frontend', to:'backend' }]
  };
  assert.equal(validateProject(project), project);
  assert.throws(() => validateProject({ ...project, edges:[{ from:'frontend', to:'missing' }] }), /Broken graph edge/);
});
