'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const knowledge = require('../src/knowledge/service');

function tempOptions(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomos-knowledge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { database: path.join(dir, 'knowledge.db') };
}

test('knowledge database imports, searches and retrieves implementations', async t => {
  const options = tempOptions(t);
  await knowledge.init(options);
  const imported = await knowledge.importAtoms({ atoms: [{
    id: 'login-form', name: 'Login form', kind: 'ui.form', confidence: .91,
    tags: ['html', 'authentication'],
    connectors: { inputs: ['identity:session'], outputs: ['event:submit', 'data:credentials'] },
    atomos: { implementations: { html: { source: '<form id="login"></form>' }, javascript: { source: 'login.addEventListener("submit", submitLogin)' } } }
  }] }, options);
  assert.equal(imported.imported, 1);

  const search = await knowledge.search('login', 10, options);
  assert.equal(search.results.length, 1);
  assert.equal(search.results[0].id, 'login-form');
  assert.deepEqual(search.results[0].connectors.outputs, ['data:credentials', 'event:submit']);
  assert.equal(search.results[0].implementations.html[0].source, '<form id="login"></form>');
});

test('knowledge records are versioned, reviewable and counted', async t => {
  const options = tempOptions(t);
  await knowledge.importAtoms([{ id:'sqlite-store', name:'SQLite store', kind:'storage.database', atomos:{ implementations:{ python:{ source:'sqlite3.connect(path)' } } } }], options);
  await knowledge.importAtoms([{ id:'sqlite-store', name:'SQLite storage', kind:'storage.database', confidence:.9, atomos:{ implementations:{ python:{ source:'sqlite3.connect(path)' } } } }], options);
  await knowledge.setStatus('sqlite-store', 'approved', options);
  await knowledge.recordUsage('sqlite-store', true, options);

  const item = await knowledge.get('sqlite-store', options);
  assert.equal(item.atom.version, 2);
  assert.equal(item.atom.status, 'approved');
  assert.equal(item.atom.usage.successful_builds, 1);

  const stats = await knowledge.stats(options);
  assert.equal(stats.total, 1);
  assert.equal(stats.statuses.approved, 1);
  assert.equal(stats.languages[0].language, 'python');
});

test('normalizes translator documents and atom arrays', () => {
  assert.equal(knowledge.normalizeImportedAtoms({ atoms:[{id:'a'}] }).length, 1);
  assert.equal(knowledge.normalizeImportedAtoms([{id:'a'}, {id:'b'}]).length, 2);
  assert.equal(knowledge.normalizeImportedAtoms(null).length, 0);
});
