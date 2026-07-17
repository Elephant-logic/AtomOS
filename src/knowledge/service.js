'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKER = path.join(__dirname, 'knowledge_db.py');
const DEFAULT_DB = path.join(process.cwd(), 'data', 'atomos-knowledge.db');

function requestKnowledge(payload, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.python || process.env.PYTHON || 'python3', [WORKER], {
      cwd: process.cwd(),
      env: { ...process.env, ATOMOS_KNOWLEDGE_DB: options.database || process.env.ATOMOS_KNOWLEDGE_DB || DEFAULT_DB },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Knowledge database timed out')); }, options.timeout || 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 5_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(stdout || '{}'); }
      catch { return reject(new Error(stderr || `Knowledge worker returned invalid output (${code})`)); }
      if (code !== 0 || !result.ok) return reject(new Error(result.error || stderr || `Knowledge worker failed (${code})`));
      resolve(result);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function normalizeImportedAtoms(value) {
  const roots = Array.isArray(value) ? value : [value];
  const atoms = [];
  for (const root of roots) {
    if (!root) continue;
    if (Array.isArray(root.atoms)) atoms.push(...root.atoms);
    else if (root.id || root.name) atoms.push(root);
  }
  return atoms.filter(Boolean).slice(0, 1000);
}

module.exports = {
  init: options => requestKnowledge({ op: 'init' }, options),
  stats: options => requestKnowledge({ op: 'stats' }, options),
  search: (q, limit = 30, options) => requestKnowledge({ op: 'search', q, limit }, options),
  get: (id, options) => requestKnowledge({ op: 'get', id }, options),
  importAtoms: (value, options) => requestKnowledge({ op: 'import', atoms: normalizeImportedAtoms(value) }, options),
  setStatus: (id, status, options) => requestKnowledge({ op: 'status', id, status }, options),
  recordUsage: (id, success, options) => requestKnowledge({ op: 'record_usage', id, success }, options),
  normalizeImportedAtoms
};
