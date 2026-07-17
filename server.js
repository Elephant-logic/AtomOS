'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildCodeApp, scanPython } = require('./src/code-builder');
const knowledge = require('./src/knowledge/service');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 500_000;

const VALUE_SCHEMA = {
  anyOf: [
    { type: 'string' }, { type: 'number' }, { type: 'boolean' },
    { type: 'array', maxItems: 200, items: { type: ['string', 'number', 'boolean'] } }
  ]
};
const CONDITION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['state', 'operator'],
  properties: {
    state: { type: 'string', maxLength: 40 },
    operator: { type: 'string', enum: ['truthy', 'falsy', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'includes', 'not_includes'] },
    value: VALUE_SCHEMA
  }
};
const ACTION_TYPES = [
  'set', 'increment', 'decrement', 'append', 'clear', 'calculate', 'format_time',
  'add', 'subtract', 'multiply', 'divide', 'modulo', 'toggle', 'concat',
  'list_push', 'list_pop', 'list_shift', 'list_unshift', 'list_remove', 'list_set',
  'length', 'min', 'max', 'round', 'floor', 'ceil', 'emit'
];
const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['op', 'target'],
  properties: {
    op: { type: 'string', enum: ACTION_TYPES }, target: { type: 'string', maxLength: 40 },
    value: VALUE_SCHEMA, from: { type: 'string', maxLength: 40 }, by: VALUE_SCHEMA,
    index: { type: 'number' }, separator: { type: 'string', maxLength: 20 },
    event: { type: 'string', maxLength: 40 }, when: CONDITION_SCHEMA
  }
};
const APP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'state', 'components', 'rules'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 240 },
    state: { type: 'object', additionalProperties: VALUE_SCHEMA },
    components: {
      type: 'array', minItems: 1, maxItems: 120,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'type'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          type: { type: 'string', enum: ['heading', 'text', 'display', 'input', 'button', 'spacer'] },
          text: { type: 'string', maxLength: 120 }, label: { type: 'string', maxLength: 40 },
          bind: { type: 'string', maxLength: 40 }, inputType: { type: 'string', enum: ['text', 'number', 'email', 'password'] },
          event: { type: 'string', maxLength: 40 }, variant: { type: 'string', enum: ['primary', 'secondary', 'danger'] }
        }
      }
    },
    capabilities: {
      type: 'array', maxItems: 30,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'type'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          type: { type: 'string', enum: ['interval', 'storage', 'startup', 'keyboard'] },
          event: { type: 'string', maxLength: 40 }, everyMs: { type: 'number', minimum: 50, maximum: 86400000 },
          enabledWhen: { type: 'string', maxLength: 40 }, key: { type: 'string', maxLength: 80 },
          stateKeys: { type: 'array', maxItems: 80, items: { type: 'string', maxLength: 40 } },
          keyboardKey: { type: 'string', maxLength: 30 }, preventDefault: { type: 'boolean' }
        }
      }
    },
    timers: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'event', 'everyMs'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          event: { type: 'string', maxLength: 40 }, everyMs: { type: 'number', minimum: 50, maximum: 86400000 },
          enabledWhen: { type: 'string', maxLength: 40 }
        }
      }
    },
    rules: {
      type: 'array', maxItems: 240,
      items: {
        type: 'object', additionalProperties: false, required: ['event', 'actions'],
        properties: { event: { type: 'string', maxLength: 40 }, actions: { type: 'array', minItems: 1, maxItems: 40, items: ACTION_SCHEMA } }
      }
    }
  }
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': type.startsWith('text/html') ? 'no-cache' : 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(Buffer.isBuffer(body) || body instanceof Uint8Array ? body : (typeof body === 'string' ? body : JSON.stringify(body)));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) reject(new Error('Request too large')); });
    req.on('end', () => resolve(data)); req.on('error', reject);
  });
}
function readLargeBody(req, max = 5_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > max) reject(new Error('Knowledge import is too large')); });
    req.on('end', () => resolve(data)); req.on('error', reject);
  });
}
function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) for (const part of item.content || []) if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  return '';
}
function normalizeEnabledWhen(value) {
  const text = String(value || '').trim(); if (!text) return undefined;
  for (const pattern of [/^(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})$/, /^\(?\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})\s*(?:===|==|is)\s*true\s*\)?$/i, /^\(?\s*true\s*(?:===|==|is)\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})\s*\)?$/i]) {
    const match = text.match(pattern); if (match) return match[1];
  }
  return text;
}
function normalizeApplication(app) {
  app.capabilities = Array.isArray(app.capabilities) ? app.capabilities : [];
  for (const timer of Array.isArray(app.timers) ? app.timers : []) if (!app.capabilities.some(c => c.id === timer.id)) app.capabilities.push({ ...timer, type: 'interval' });
  delete app.timers;
  for (const capability of app.capabilities) if (capability.type === 'interval' && capability.enabledWhen) capability.enabledWhen = normalizeEnabledWhen(capability.enabledWhen);
  const buttons = new Map();
  for (const component of app.components || []) if (component.type === 'button') {
    if (!component.event) component.event = `${component.id}.click`;
    buttons.set(component.id, component);
  }
  const visibleEvents = new Set([...buttons.values()].map(button => button.event));
  for (const rule of app.rules || []) {
    if (!visibleEvents.has(rule.event)) {
      const button = buttons.get(String(rule.event || '').replace(/\.(click|press|tap)$/i, ''));
      if (button) rule.event = button.event;
    }
    for (const action of rule.actions || []) {
      const source = String(action.from || '').toLowerCase(), target = String(action.target || '').toLowerCase();
      if (action.op === 'calculate' && /(elapsed|seconds|duration|remaining|time)/.test(source) && /(display|formatted|time)/.test(target)) action.op = 'format_time';
      if ((action.op === 'increment' || action.op === 'decrement') && action.by !== undefined && action.value === undefined) action.value = action.by;
    }
  }
  return app;
}
function validateReferences(app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error('The model returned an invalid application object');
  if (!app.state || typeof app.state !== 'object' || Array.isArray(app.state)) throw new Error('Application state is missing');
  if (!Array.isArray(app.components) || !app.components.length) throw new Error('Application components are missing');
  if (!Array.isArray(app.rules)) throw new Error('Application rules are missing');
  if (!Array.isArray(app.capabilities)) app.capabilities = [];
  const stateKeys = new Set(Object.keys(app.state)), componentIds = new Set(), capabilityIds = new Set();
  const entryEvents = new Set(), ruleEvents = new Set(), emittedEvents = new Set();
  for (const component of app.components) {
    if (!component.id || !component.type) throw new Error('Every component needs an id and type');
    if (componentIds.has(component.id)) throw new Error(`Duplicate component id: ${component.id}`);
    componentIds.add(component.id);
    if (component.bind && !stateKeys.has(component.bind)) throw new Error(`Unknown binding: ${component.bind}`);
    if (component.event) entryEvents.add(component.event);
  }
  for (const capability of app.capabilities) {
    if (!capability.id || !capability.type) throw new Error('Every capability needs id and type');
    if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
    capabilityIds.add(capability.id);
    if (capability.type === 'interval') {
      if (!capability.event || !Number.isFinite(Number(capability.everyMs))) throw new Error(`Interval capability ${capability.id} needs event and everyMs`);
      if (capability.enabledWhen && !stateKeys.has(capability.enabledWhen)) throw new Error(`Unknown interval state key: ${capability.enabledWhen}`);
      entryEvents.add(capability.event);
    } else if (capability.type === 'storage') {
      if (!Array.isArray(capability.stateKeys) || !capability.stateKeys.length) throw new Error(`Storage capability ${capability.id} needs stateKeys`);
      for (const key of capability.stateKeys) if (!stateKeys.has(key)) throw new Error(`Unknown storage state key: ${key}`);
    } else if (capability.type === 'startup') {
      if (!capability.event) throw new Error(`Startup capability ${capability.id} needs event`); entryEvents.add(capability.event);
    } else if (capability.type === 'keyboard') {
      if (!capability.event || !capability.keyboardKey) throw new Error(`Keyboard capability ${capability.id} needs event and keyboardKey`); entryEvents.add(capability.event);
    } else throw new Error(`Unsupported capability type: ${capability.type}`);
  }
  for (const rule of app.rules) {
    if (!rule.event || !Array.isArray(rule.actions)) throw new Error('Every rule needs an event and actions');
    if (ruleEvents.has(rule.event)) throw new Error(`Duplicate rule event: ${rule.event}`);
    ruleEvents.add(rule.event);
    for (const action of rule.actions) {
      if (!stateKeys.has(action.target)) throw new Error(`Unknown action target: ${action.target}`);
      if (action.from && !stateKeys.has(action.from)) throw new Error(`Unknown action source: ${action.from}`);
      if (action.when && !stateKeys.has(action.when.state)) throw new Error(`Unknown condition state key: ${action.when.state}`);
      if (action.op === 'format_time' && !action.from) throw new Error('format_time needs a numeric source state key');
      if (action.op === 'emit') { if (!action.event) throw new Error('emit needs an event name'); emittedEvents.add(action.event); }
    }
  }
  for (const event of emittedEvents) if (!ruleEvents.has(event)) throw new Error(`Emitted event has no matching rule: ${event}`);
  for (const event of ruleEvents) if (!entryEvents.has(event) && !emittedEvents.has(event)) throw new Error(`Rule cannot be reached from a visible control, capability or emitted event: ${event}`);
}
async function buildApp(prompt, currentApp) {
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on Render');
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const editing = currentApp && typeof currentApp === 'object';
  const input = editing ? `CURRENT APPLICATION:\n${JSON.stringify(currentApp)}\n\nCHANGE REQUEST:\n${prompt}` : prompt;
  const instructions = [
    'You are the AtomOS application architect.',
    editing ? 'Revise the supplied application. Preserve every unrelated working component, state key, capability and rule. Return the complete revised application.' : 'Turn the request into one complete small interactive application.',
    'Use only the supplied declarative schema. Never emit JavaScript, HTML, markdown, or prose.',
    'Every button event must exactly match a rule event. Every bind and action target must name a state key.',
    'Build new behavior by composing general actions and sandboxed capabilities instead of inventing app-specific runtime code.',
    'Capability types: interval, storage, startup and keyboard. enabledWhen must be a boolean state key.',
    'Conditions read state at the start of the event. Use from for state values and value or by for literals.',
    'Internal event chains are supported. Every emitted event must have exactly one matching rule. Every emit action still needs a valid existing state target.',
    'Use format_time for seconds. Use calculate only for arithmetic expressions.',
    'Keep component ids stable during edits. Make mobile-friendly apps.'
  ].join(' ');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions, input, text: { format: { type: 'json_schema', name: 'atomos_application', strict: false, schema: APP_SCHEMA } } })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload); if (!text) throw new Error('The model returned no application');
  const app = normalizeApplication(JSON.parse(text)); validateReferences(app);
  return { app, model, responseId: payload.id, mode: editing ? 'edit' : 'build', capabilities: app.capabilities.map(({ id, type }) => ({ id, type })) };
}
function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain');
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    if (rel === 'index.html') {
      const html = data.toString('utf8').replace('</body>', '<script src="/pwa-export.js"></script><script src="/capability-runtime.js"></script><script src="/codem8s-studio.js"></script><script src="/knowledge-studio.js"></script></body>');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    send(res, 200, data, types[path.extname(filePath)] || 'application/octet-stream');
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && req.url === '/api/status') return send(res, 200, {
    ready: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    capabilityTypes: ['interval', 'storage', 'startup', 'keyboard'], actionTypes: ACTION_TYPES,
    conditionalActions: true, internalEvents: true, listState: true, codeBuilder: { languages: ['python'], execution: false, verification: ['blocked-pattern scan', 'python syntax compile', 'repair loop'] }
  });
  if (req.method === 'GET' && url.pathname === '/api/knowledge/stats') {
    try { return send(res, 200, await knowledge.stats()); }
    catch (error) { return send(res, 500, { error: error.message || 'Knowledge database failed' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/knowledge/search') {
    try { return send(res, 200, await knowledge.search(url.searchParams.get('q') || '', Number(url.searchParams.get('limit') || 30))); }
    catch (error) { return send(res, 500, { error: error.message || 'Knowledge search failed' }); }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/knowledge/atoms/')) {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/knowledge/atoms/'.length));
      const result = await knowledge.get(id); return send(res, result.atom ? 200 : 404, result);
    } catch (error) { return send(res, 500, { error: error.message || 'Knowledge lookup failed' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/knowledge/import') {
    try { return send(res, 200, await knowledge.importAtoms(JSON.parse(await readLargeBody(req) || '{}'))); }
    catch (error) { return send(res, 500, { error: error.message || 'Knowledge import failed' }); }
  }
  if (req.method === 'POST' && /\/api\/knowledge\/atoms\/[^/]+\/status$/.test(url.pathname)) {
    try {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
      const body = JSON.parse(await readBody(req) || '{}'); return send(res, 200, await knowledge.setStatus(id, body.status));
    } catch (error) { return send(res, 500, { error: error.message || 'Knowledge review failed' }); }
  }
  if (req.method === 'POST' && /\/api\/knowledge\/atoms\/[^/]+\/usage$/.test(url.pathname)) {
    try {
      const id = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
      const body = JSON.parse(await readBody(req) || '{}'); return send(res, 200, await knowledge.recordUsage(id, Boolean(body.success)));
    } catch (error) { return send(res, 500, { error: error.message || 'Knowledge usage update failed' }); }
  }
  if (req.method === 'POST' && req.url === '/api/build') {
    try {
      const body = JSON.parse(await readBody(req) || '{}'), prompt = String(body.prompt || '').trim();
      if (prompt.length < 3 || prompt.length > 6000) return send(res, 400, { error: 'Prompt must be between 3 and 6000 characters' });
      return send(res, 200, await buildApp(prompt, body.currentApp));
    } catch (error) { console.error(error); return send(res, 500, { error: error.message || 'Build failed' }); }
  }
  if (req.method === 'POST' && req.url === '/api/code-build') {
    try {
      const body = JSON.parse(await readBody(req) || '{}'), prompt = String(body.prompt || '').trim();
      if (prompt.length < 3 || prompt.length > 12000) return send(res, 400, { error: 'Prompt must be between 3 and 12000 characters' });
      const artifact = await buildCodeApp({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini', prompt, maxAttempts: 3 });
      return send(res, 200, { artifact, mode: 'code', execution: false });
    } catch (error) { console.error(error); return send(res, 500, { error: error.message || 'Code build failed', artifact: error.artifact || null }); }
  }
  if (req.method === 'POST' && req.url === '/api/code-analyze') {
    try {
      const body = JSON.parse(await readBody(req) || '{}'), code = String(body.code || '');
      if (!code || code.length > 100000) return send(res, 400, { error: 'Code must be between 1 and 100000 characters' });
      return send(res, 200, { analysis: scanPython(code) });
    } catch (error) { return send(res, 500, { error: error.message || 'Code analysis failed' }); }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'Method not allowed' });
});
knowledge.init().then(result => console.log(`AtomOS knowledge database ready: ${result.database}`)).catch(error => console.error('Knowledge database unavailable:', error));
server.listen(PORT, '0.0.0.0', () => console.log(`AtomOS listening on ${PORT}`));
