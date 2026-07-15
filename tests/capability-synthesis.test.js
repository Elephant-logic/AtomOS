'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'public', 'capability-runtime.js'), 'utf8');

test('server exposes a sandboxed capability vocabulary', () => {
  assert.match(server, /enum: \['interval', 'storage'\]/);
  assert.match(server, /You may synthesize reusable capability declarations/);
  assert.match(server, /Do not invent unsupported capability types/);
});

test('server validates interval and storage capability references', () => {
  assert.match(server, /Interval capability .* needs event and everyMs/);
  assert.match(server, /Storage capability .* needs stateKeys/);
  assert.match(server, /Rule has no matching visible control or capability/);
});

test('browser runtime executes interval capabilities', () => {
  assert.match(runtime, /capability\.type !== 'interval'/);
  assert.match(runtime, /setInterval/);
  assert.match(runtime, /capability\.enabledWhen/);
  assert.match(runtime, /runEvent\(capability\.event\)/);
});

test('browser runtime persists declared state only', () => {
  assert.match(runtime, /capability\.type === 'storage'/);
  assert.match(runtime, /capability\.stateKeys/);
  assert.match(runtime, /localStorage\.setItem/);
  assert.match(runtime, /localStorage\.getItem/);
});

test('Studio loads the generic capability runtime', () => {
  assert.match(server, /\/capability-runtime\.js/);
  assert.doesNotMatch(server, /<script src="\/timer-runtime\.js"/);
});
