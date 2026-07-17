'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyBuildIntent, applyIntentGuard } = require('../src/build-intent');

test('routes a platform game to Build new', () => {
  const result = classifyBuildIntent('Build a 2D platform game with gravity, jumping, enemies, coins, tile maps and camera follow.');
  assert.equal(result.intent, 'game');
  assert.equal(result.option, 'build');
  assert.equal(result.label, 'Build new');
  assert.ok(result.confidence >= 0.67);
});

test('does not infer a backend for a game without backend requirements', () => {
  const result = classifyBuildIntent('Create Forest Escape with sprites, collision, checkpoints, lives and sound effects.');
  assert.equal(result.intent, 'game');
  assert.notEqual(result.option, 'fullstack');
});

test('honours an explicit full stack request', () => {
  const result = classifyBuildIntent('Build a full stack booking website with login, PostgreSQL database and REST API.');
  assert.equal(result.intent, 'fullstack');
  assert.equal(result.option, 'fullstack');
});

test('routes standalone Python desktop tools to code builder', () => {
  const result = classifyBuildIntent('Build a Python desktop app with Tkinter that imports and edits CSV files.');
  assert.equal(result.intent, 'code');
  assert.equal(result.option, 'code');
});

test('explicit no-backend instruction suppresses full stack routing', () => {
  const result = classifyBuildIntent('Build a browser game with login-style menu screens but no backend, database, API or authentication.');
  assert.equal(result.intent, 'game');
  assert.equal(result.option, 'build');
});

test('guard flags selecting full stack for a confident game prompt', () => {
  const result = applyIntentGuard('Build a platformer with gravity, tile maps, sprites and collisions.', 'fullstack');
  assert.equal(result.intent, 'game');
  assert.equal(result.mismatch, true);
  assert.equal(result.label, 'Build new');
});
