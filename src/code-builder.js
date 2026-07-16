'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'language', 'filename', 'code', 'previewHtml', 'tests', 'dependencies', 'notes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    language: { type: 'string', enum: ['python'] },
    filename: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,60}\\.py$' },
    code: { type: 'string', minLength: 20, maxLength: 60000 },
    previewHtml: { type: 'string', minLength: 40, maxLength: 60000 },
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
  [/^\s*(?:from|import)\s+socket\b/m, 'raw sockets are not allowed'],
  [/^\s*(?:from|import)\s+ctypes\b/m, 'ctypes is not allowed'],
  [/\bpickle\.(?:loads?|Unpickler)\b/, 'unsafe pickle loading is not allowed'],
  [/^\s*(?:from|import)\s+(?:requests|urllib|http\.client|ftplib|smtplib)\b/m, 'network client modules are not allowed in the verification worker']
];

const PREVIEW_BLOCKED = [
  [/<script[^>]+src\s*=/i, 'preview cannot load external scripts'],
  [/<(?:iframe|object|embed|base)\b/i, 'preview cannot embed external documents'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'preview cannot access the network'],
  [/\bwindow\.(?:open|location)\b/, 'preview cannot navigate or open windows'],
  [/\bdocument\.cookie\b/, 'preview cannot access cookies']
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
  const base = String(value || 'codem8s_app.py')
    .replace(/\.py$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'codem8s_app';
  return `${base}.py`;
}

function scanPython(code) {
  const source = String(code || '');
  const errors = [];
  for (const [pattern, message] of BLOCKED_PATTERNS) {
    if (pattern.test(source)) errors.push(message);
  }

  const dependencies = new Set();
  for (const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)) {
    dependencies.add(match[1].split('.')[0]);
  }

  const functions = [...source.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map(x => x[1]);
  const classes = [...source.matchAll(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)].map(x => x[1]);

  const columnGroups = new Map();
  for (const match of source.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[\[(]([^\]\)]*)[\])]/gm)) {
    const values = [...match[2].matchAll(/['\"]([^'\"]+)['\"]/g)].map(x => x[1]);
    if (values.length) columnGroups.set(match[1], values);
  }

  const declaredColumns = new Set();
  for (const match of source.matchAll(/Treeview\([^\n]*columns\s*=\s*([^,\n)]+)/g)) {
    const expression = match[1].trim();
    for (const quoted of expression.matchAll(/['\"]([^'\"]+)['\"]/g)) declaredColumns.add(quoted[1]);
    for (const value of columnGroups.get(expression) || []) declaredColumns.add(value);
  }

  for (const match of source.matchAll(/\.set\([^,]+,\s*['\"]([^'\"]+)['\"]/g)) {
    if (declaredColumns.size && !declaredColumns.has(match[1])) {
      errors.push(`Treeview column ${match[1]} is used but not declared`);
    }
  }

  return {
    errors: [...new Set(errors)],
    dependencies: [...dependencies].sort(),
    functions,
    classes,
    lineCount: source.split('\n').length
  };
}

function scanPreview(html) {
  const source = String(html || '');
  const errors = [];
  for (const [pattern, message] of PREVIEW_BLOCKED) {
    if (pattern.test(source)) errors.push(message);
  }
  if (!/<html\b|<!doctype\s+html/i.test(source)) errors.push('preview must be a complete HTML document');
  if (!/<meta[^>]+name=['\"]viewport['\"][^>]+width=device-width/i.test(source)) errors.push('preview must include a mobile viewport meta tag');
  if (/(?:min-width|width)\s*:\s*(?:[7-9]\d\d|\d{4,})px/i.test(source)) errors.push('preview contains a fixed desktop width that will overflow on phones');

  const mentionsStrictDate = /YYYY-MM-DD/i.test(source);
  const usesDateInput = /type\s*=\s*['\"]date['\"]/i.test(source);
  const normalizesSeparators = /replace\s*\([^)]*[.\/]\s*[^)]*\)/i.test(source) || /split\s*\(\s*['\"][.\/]['\"]\s*\)/i.test(source);
  if (mentionsStrictDate && !usesDateInput && !normalizesSeparators) {
    errors.push('date input must use type=date or normalize slash/dot separators before validation');
  }
  return { ok: errors.length === 0, errors };
}

function runProcess(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs || 5000);
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: error.message, timedOut });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
  });
}

async function withTempProgram(code, task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomos-codem8s-'));
  const filename = path.join(dir, 'app.py');
  try {
    await fs.writeFile(filename, code, 'utf8');
    return await task({ dir, filename });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function validatePythonSyntax(code) {
  return withTempProgram(code, async ({ dir, filename }) => {
    const result = await runProcess(process.env.PYTHON_BIN || 'python3', ['-I', '-m', 'py_compile', filename], {
      cwd: dir,
      env: { PATH: process.env.PATH || '', HOME: dir, TMPDIR: dir, PYTHONNOUSERSITE: '1' },
      timeoutMs: 5000
    });
    return { ok: result.ok, error: result.stderr.trim(), timedOut: result.timedOut };
  });
}

async function smokeTestPython(code) {
  return withTempProgram(code, async ({ dir }) => {
    const harness = [
      'import runpy, sys, types',
      'tk = types.ModuleType("tkinter")',
      'tk.Tk = type("Tk", (object,), {})',
      'for name in ("X","Y","BOTH","LEFT","RIGHT","TOP","BOTTOM","END","W","E","N","S","VERTICAL","HORIZONTAL"):',
      '    setattr(tk, name, name)',
      'ttk = types.ModuleType("tkinter.ttk")',
      'for name in ("Frame","Label","Entry","Button","Treeview","Scrollbar","Combobox"):',
      '    setattr(ttk, name, type(name, (object,), {}))',
      'messagebox = types.ModuleType("tkinter.messagebox")',
      'filedialog = types.ModuleType("tkinter.filedialog")',
      'tk.ttk, tk.messagebox, tk.filedialog = ttk, messagebox, filedialog',
      'sys.modules.update({"tkinter": tk, "tkinter.ttk": ttk, "tkinter.messagebox": messagebox, "tkinter.filedialog": filedialog})',
      'runpy.run_path("app.py", run_name="atomos_smoke")'
    ].join('\n');
    const result = await runProcess(process.env.PYTHON_BIN || 'python3', ['-I', '-c', harness], {
      cwd: dir,
      env: { PATH: process.env.PATH || '', HOME: dir, TMPDIR: dir, PYTHONNOUSERSITE: '1', DISPLAY: '' },
      timeoutMs: 5000
    });
    return {
      ok: result.ok,
      error: result.stderr.trim(),
      stdout: result.stdout.trim().slice(0, 2000),
      timedOut: result.timedOut,
      mode: 'headless import smoke test with Tkinter stubs',
      limitations: 'The verification host does not include Tkinter or a display. AtomOS stubs GUI modules only while importing the program, then displays the separate functional browser preview.'
    };
  });
}

async function requestCode({ apiKey, model, prompt, feedback = '' }) {
  const instructions = [
    'You are Codem8s, the conventional-code builder inside AtomOS.',
    'Create one complete maintainable Python file that fulfils the request.',
    'Also create previewHtml: one complete self-contained HTML document that visually and interactively demonstrates the same application inside AtomOS.',
    'The preview must be mobile-first and responsive: include a viewport meta tag, use max-width:100%, wrapping controls, readable 16px-or-larger inputs, and no fixed desktop widths that overflow a phone.',
    'For date fields, use input type=date where practical and normalize YYYY/MM/DD and YYYY.MM.DD to YYYY-MM-DD. Show validation inline rather than with alert dialogs.',
    'The browser preview must use only inline HTML, CSS and JavaScript and must not use external resources or network access.',
    'Prefer the Python standard library and list every non-standard dependency.',
    'The Python program must have a main entry point guarded by if __name__ == "__main__".',
    'Avoid nested quote mistakes in f-strings. When formatting dictionary values, assign the value to a variable first or use alternating quote styles.',
    'For Tkinter Treeview record identity, use the item iid or tags; never call tree.set with an undeclared phantom column.',
    'Do not use os.system, subprocess execution, eval, exec, raw sockets, ctypes, unsafe pickle loading, network clients, credential harvesting or destructive behavior.',
    'Do not embed secrets.',
    'Return structured JSON only.'
  ].join(' ');

  const input = feedback
    ? `${prompt}\n\nPREVIOUS VALIDATION FAILED:\n${feedback}\nRepair every listed issue. Return the complete Python program and complete browser preview, not a patch.`
    : prompt;

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
  if (!response.ok) throw Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw Error('The model returned no code application');
  return { artifact: JSON.parse(text), responseId: payload.id };
}

async function buildCodeApp({ apiKey, model = 'gpt-5-mini', prompt, maxAttempts = 3 }) {
  let feedback = '';
  let lastArtifact = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await requestCode({ apiKey, model, prompt, feedback });
    const artifact = result.artifact;
    artifact.filename = safeFilename(artifact.filename);

    const scan = scanPython(artifact.code);
    const preview = scanPreview(artifact.previewHtml);
    const syntax = await validatePythonSyntax(artifact.code);
    const sandbox = syntax.ok && scan.errors.length === 0
      ? await smokeTestPython(artifact.code)
      : { ok: false, error: 'Not run because Python validation failed', mode: 'headless import smoke test' };

    const reasons = [syntax.error, ...scan.errors, sandbox.error, ...preview.errors].filter(Boolean);
    const accepted = syntax.ok && scan.errors.length === 0 && sandbox.ok && preview.ok;

    lastArtifact = {
      ...artifact,
      responseId: result.responseId,
      verification: { attempt, accepted, scan, syntax, sandbox, preview, warnings: reasons }
    };

    if (accepted) return lastArtifact;
    feedback = reasons.join('\n');
  }

  // Never throw away a generated file and browser display merely because repair
  // attempts were exhausted. Return the last artifact clearly marked as needing
  // repair so Studio can still display it, allow download, and show exact errors.
  lastArtifact.verification.accepted = false;
  lastArtifact.verification.status = 'generated_with_warnings';
  lastArtifact.notes = [
    ...(Array.isArray(lastArtifact.notes) ? lastArtifact.notes : []),
    'This build was generated and displayed, but automatic verification still found issues. Review the verification warnings before running the downloaded Python file.'
  ];
  return lastArtifact;
}

module.exports = {
  CODE_SCHEMA,
  BLOCKED_PATTERNS,
  PREVIEW_BLOCKED,
  safeFilename,
  scanPython,
  scanPreview,
  validatePythonSyntax,
  smokeTestPython,
  buildCodeApp
};
