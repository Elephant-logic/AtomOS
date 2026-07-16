'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'language', 'filename', 'code', 'tests', 'dependencies', 'notes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    language: { type: 'string', enum: ['python'] },
    filename: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,60}\\.py$' },
    code: { type: 'string', minLength: 20, maxLength: 60000 },
    tests: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 240 } },
    dependencies: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
    notes: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 240 } }
  }
};

const BLOCKED_PATTERNS = [
  [/\bos\.system\s*\(/, 'os.system is not allowed'],
  [/\bsubprocess\.(?:Popen|run|call|check_call|check_output)\s*\(/, 'subprocess execution is not allowed'],
  [/\beval\s*\(/, 'eval is not allowed'],
  [/\bexec\s*\(/, 'exec is not allowed'],
  [/\b__import__\s*\(/, '__import__ is not allowed'],
  [/\bsocket\b/, 'raw sockets are not allowed'],
  [/\bctypes\b/, 'ctypes is not allowed'],
  [/\bpickle\.(?:loads?|Unpickler)\b/, 'unsafe pickle loading is not allowed']
];

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

function safeFilename(value) {
  const base = String(value || 'codem8s_app.py').replace(/\.py$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'codem8s_app';
  return `${base}.py`;
}

function scanPython(code) {
  const source = String(code || '');
  const errors = [];
  for (const [pattern, message] of BLOCKED_PATTERNS) if (pattern.test(source)) errors.push(message);
  const dependencies = new Set();
  for (const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)) dependencies.add(match[1].split('.')[0]);
  const functions = [...source.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map(match => match[1]);
  const classes = [...source.matchAll(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)].map(match => match[1]);
  return { errors, dependencies: [...dependencies].sort(), functions, classes, lineCount: source.split('\n').length };
}

function runProcess(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, options.timeoutMs || 5000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, code: null, stdout, stderr: error.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
  });
}

async function validatePythonSyntax(code) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomos-codem8s-'));
  const filename = path.join(dir, 'app.py');
  try {
    await fs.writeFile(filename, code, 'utf8');
    const result = await runProcess(process.env.PYTHON_BIN || 'python3', ['-m', 'py_compile', filename], {
      cwd: dir,
      env: { PATH: process.env.PATH || '' },
      timeoutMs: 5000
    });
    return { ok: result.ok, error: result.stderr.trim() };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function requestCode({ apiKey, model, prompt, feedback = '' }) {
  const instructions = [
    'You are Codem8s, the conventional-code builder inside AtomOS.',
    'Create one complete, maintainable Python file that fulfils the request.',
    'Prefer the Python standard library. List every non-standard dependency.',
    'The program must have a clear main entry point and robust error handling.',
    'Do not use os.system, subprocess execution, eval, exec, raw sockets, ctypes, unsafe pickle loading, persistence, credential harvesting or destructive behavior.',
    'Do not embed secrets. Read optional API keys from environment variables.',
    'Return structured JSON only.'
  ].join(' ');
  const input = feedback ? `${prompt}\n\nPREVIOUS VALIDATION FAILED:\n${feedback}\nReturn the complete repaired program.` : prompt;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions,
      input,
      text: { format: { type: 'json_schema', name: 'atomos_code_app', strict: false, schema: CODE_SCHEMA } }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw new Error('The model returned no code application');
  return { artifact: JSON.parse(text), responseId: payload.id };
}

async function buildCodeApp({ apiKey, model = 'gpt-5-mini', prompt, maxAttempts = 3 }) {
  let feedback = '';
  let lastArtifact = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await requestCode({ apiKey, model, prompt, feedback });
    const artifact = result.artifact;
    artifact.filename = safeFilename(artifact.filename);
    const scan = scanPython(artifact.code);
    const syntax = scan.errors.length ? { ok: false, error: scan.errors.join('; ') } : await validatePythonSyntax(artifact.code);
    lastArtifact = { ...artifact, responseId: result.responseId, verification: { attempt, syntax, scan } };
    if (syntax.ok && scan.errors.length === 0) return lastArtifact;
    feedback = [syntax.error, ...scan.errors].filter(Boolean).join('\n');
  }
  const error = new Error(`Codem8s could not produce a validated program: ${lastArtifact?.verification?.syntax?.error || 'unknown validation failure'}`);
  error.artifact = lastArtifact;
  throw error;
}

module.exports = { CODE_SCHEMA, BLOCKED_PATTERNS, safeFilename, scanPython, validatePythonSyntax, buildCodeApp };
