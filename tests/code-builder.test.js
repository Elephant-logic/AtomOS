'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { safeFilename, scanPython, validatePythonSyntax } = require('../src/code-builder');

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

test('scanPython blocks process execution and dynamic code', () => {
  const result = scanPython('import subprocess\nsubprocess.run(["echo", "bad"])\neval("1+1")');
  assert.ok(result.errors.some(message => message.includes('subprocess')));
  assert.ok(result.errors.some(message => message.includes('eval')));
});

test('scanPython rejects undeclared Tkinter Treeview columns', () => {
  const code = `
from tkinter import ttk
columns = ("date", "amount")
tree = ttk.Treeview(root, columns=("date", "amount"), show="headings")
tree.set(item, "_id", "123")
`;
  const result = scanPython(code);
  assert.ok(result.errors.some(message => message.includes('hidden _id column is not declared')));
});

test('scanPython permits record ids stored as Treeview iid', () => {
  const code = `
from tkinter import ttk
tree = ttk.Treeview(root, columns=("date", "amount"), show="headings")
tree.insert("", "end", iid="record-123", values=("2026-01-01", "12.00"))
`;
  assert.deepEqual(scanPython(code).errors, []);
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

test('Studio loads Codem8s without replacing the AtomOS runtime', () => {
  const server = read('server.js');
  const studio = read('public/codem8s-studio.js');
  assert.match(server, /codem8s-studio\.js/);
  assert.doesNotMatch(studio, /runEvent\s*=/);
  assert.doesNotMatch(studio, /request\s*=/);
  assert.match(studio, /Build code app/);
});