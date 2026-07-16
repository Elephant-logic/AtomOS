'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { safeFilename, scanPython, scanPreview, validatePythonSyntax } = require('../src/code-builder');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('safeFilename produces a portable Python filename', () => {
  assert.equal(safeFilename('../../My Tool.py'), 'My_Tool.py');
  assert.equal(safeFilename(''), 'codem8s_app.py');
});

test('scanPython extracts reusable parts and dependencies', () => {
  const result = scanPython('import csv\nfrom tkinter import ttk\n\nclass Store:\n    pass\n\ndef load_items():\n    return []\n');
  assert.deepEqual(result.dependencies, ['csv', 'tkinter']);
  assert.deepEqual(result.classes, ['Store']);
  assert.deepEqual(result.functions, ['load_items']);
  assert.deepEqual(result.errors, []);
});

test('scanPython blocks process execution, dynamic code and phantom Treeview columns', () => {
  const unsafe = scanPython('import subprocess\nsubprocess.run(["echo", "bad"])\neval("1+1")');
  assert.ok(unsafe.errors.some(message => message.includes('subprocess')));
  assert.ok(unsafe.errors.some(message => message.includes('eval')));
  const tree = scanPython('tree = ttk.Treeview(root, columns=("date", "amount"))\ntree.set(item, "_id", "1")');
  assert.ok(tree.errors.some(message => message.includes('_id')));
});

test('browser preview rejects external resources and requires mobile-safe interaction', () => {
  const valid = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><input type="date"><button onclick="this.textContent=\'OK\'">Go</button></body></html>';
  assert.equal(scanPreview(valid).ok, true);
  assert.equal(scanPreview('<!doctype html><html><body><button>Go</button></body></html>').ok, false);
  assert.equal(scanPreview('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div style="width:900px"></div></body></html>').ok, false);
  assert.equal(scanPreview('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>Date (YYYY-MM-DD)<input></body></html>').ok, false);
  assert.equal(scanPreview('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><script src="https://example.com/x.js"></script></body></html>').ok, false);
  assert.equal(scanPreview('<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><script>fetch("https://example.com")</script></html>').ok, false);
});

test('Python syntax validation compiles without executing code', async () => {
  const valid = await validatePythonSyntax('def add(a, b):\n    return a + b\n');
  assert.equal(valid.ok, true);
  const invalid = await validatePythonSyntax('def broken(:\n    pass\n');
  assert.equal(invalid.ok, false);
});

test('server exposes separate declarative and code build APIs', () => {
  const server = read('server.js');
  assert.match(server, /\/api\/build/);
  assert.match(server, /\/api\/code-build/);
  assert.match(server, /\/api\/code-analyze/);
  assert.match(server, /execution: false/);
});

test('Studio displays Codem8s preview without replacing the AtomOS runtime', () => {
  const server = read('server.js');
  const studio = read('public/codem8s-studio.js');
  assert.match(server, /codem8s-studio\.js/);
  assert.doesNotMatch(studio, /runEvent\s*=/);
  assert.doesNotMatch(studio, /request\s*=/);
  assert.match(studio, /Build code app/);
  assert.match(studio, /sandbox = 'allow-scripts allow-forms allow-modals allow-downloads'/);
  assert.match(studio, /srcdoc = artifact\.previewHtml/);
});