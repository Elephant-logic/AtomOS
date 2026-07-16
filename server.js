'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 250_000;

const APP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'state', 'components', 'rules'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 240 },
    state: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
    components: {
      type: 'array', minItems: 1, maxItems: 100,
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
      type: 'array', maxItems: 20,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'type'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          type: { type: 'string', enum: ['interval', 'storage'] },
          event: { type: 'string', maxLength: 40 },
          everyMs: { type: 'number', minimum: 50, maximum: 86400000 },
          enabledWhen: { type: 'string', maxLength: 40 },
          key: { type: 'string', maxLength: 80 },
          stateKeys: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 40 } }
        }
      }
    },
    timers: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'event', 'everyMs'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          event: { type: 'string', maxLength: 40 },
          everyMs: { type: 'number', minimum: 50, maximum: 86400000 },
          enabledWhen: { type: 'string', maxLength: 40 }
        }
      }
    },
    rules: {
      type: 'array', maxItems: 160,
      items: {
        type: 'object', additionalProperties: false, required: ['event', 'actions'],
        properties: {
          event: { type: 'string', maxLength: 40 },
          actions: {
            type: 'array', minItems: 1, maxItems: 16,
            items: {
              type: 'object', additionalProperties: false, required: ['op', 'target'],
              properties: {
                op: { type: 'string', enum: ['set', 'increment', 'decrement', 'append', 'clear', 'calculate', 'format_time'] },
                target: { type: 'string', maxLength: 40 }, value: { type: ['string', 'number', 'boolean'] }, from: { type: 'string', maxLength: 40 }
              }
            }
          }
        }
      }
    }
  }
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'no-store', 'x-content-type-options': 'nosniff' });
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return res.end(body);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > MAX_BODY) reject(new Error('Request too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) for (const part of item.content || []) if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  return '';
}

function normalizeEnabledWhen(value) {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const simple = text.match(/^(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})$/);
  if (simple) return simple[1];
  const comparison = text.match(/^\(?\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})\s*(?:===|==|is)\s*true\s*\)?$/i);
  if (comparison) return comparison[1];
  const reversed = text.match(/^\(?\s*true\s*(?:===|==|is)\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})\s*\)?$/i);
  if (reversed) return reversed[1];
  return text;
}

function normalizeApplication(app) {
  app.capabilities = Array.isArray(app.capabilities) ? app.capabilities : [];
  if (Array.isArray(app.timers)) {
    for (const timer of app.timers) {
      if (!app.capabilities.some(capability => capability.id === timer.id)) app.capabilities.push({ ...timer, type: 'interval' });
    }
  }
  delete app.timers;

  for (const capability of app.capabilities) {
    if (capability.type === 'interval' && capability.enabledWhen) capability.enabledWhen = normalizeEnabledWhen(capability.enabledWhen);
  }

  const buttons = new Map();
  for (const component of app.components || []) {
    if (component.type !== 'button') continue;
    if (!component.event) component.event = `${component.id}.click`;
    buttons.set(component.id, component);
  }

  const visibleEvents = new Set([...buttons.values()].map(button => button.event));
  for (const rule of app.rules || []) {
    if (!visibleEvents.has(rule.event)) {
      const buttonId = String(rule.event || '').replace(/\.(click|press|tap)$/i, '');
      const button = buttons.get(buttonId);
      if (button) rule.event = button.event;
    }
    for (const action of rule.actions || []) {
      const source = String(action.from || '').toLowerCase();
      const target = String(action.target || '').toLowerCase();
      if (action.op === 'calculate' && /(elapsed|seconds|duration|time)/.test(source) && /(display|formatted|time)/.test(target)) action.op = 'format_time';
    }
  }
  return app;
}

function validateReferences(app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error('The model returned an invalid application object');
  if (!app.state || typeof app.state !== 'object' || Array.isArray(app.state)) throw new Error('Application state is missing');
  if (!Array.isArray(app.components) || app.components.length === 0) throw new Error('Application components are missing');
  if (!Array.isArray(app.rules)) throw new Error('Application rules are missing');
  if (!Array.isArray(app.capabilities)) app.capabilities = [];

  const stateKeys = new Set(Object.keys(app.state));
  const componentIds = new Set();
  const capabilityIds = new Set();
  const events = new Set();

  for (const component of app.components) {
    if (!component.id || !component.type) throw new Error('Every component needs an id and type');
    if (componentIds.has(component.id)) throw new Error(`Duplicate component id: ${component.id}`);
    componentIds.add(component.id);
    if (component.bind && !stateKeys.has(component.bind)) throw new Error(`Unknown binding: ${component.bind}`);
    if (component.event) events.add(component.event);
  }

  for (const capability of app.capabilities) {
    if (!capability.id || !capability.type) throw new Error('Every capability needs id and type');
    if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
    capabilityIds.add(capability.id);
    if (capability.type === 'interval') {
      if (!capability.event || !Number.isFinite(Number(capability.everyMs))) throw new Error(`Interval capability ${capability.id} needs event and everyMs`);
      if (capability.enabledWhen && !stateKeys.has(capability.enabledWhen)) throw new Error(`Unknown interval state key: ${capability.enabledWhen}`);
      events.add(capability.event);
    } else if (capability.type === 'storage') {
      if (!Array.isArray(capability.stateKeys) || capability.stateKeys.length === 0) throw new Error(`Storage capability ${capability.id} needs stateKeys`);
      for (const key of capability.stateKeys) if (!stateKeys.has(key)) throw new Error(`Unknown storage state key: ${key}`);
    } else throw new Error(`Unsupported capability type: ${capability.type}`);
  }

  for (const rule of app.rules) {
    if (!rule.event || !Array.isArray(rule.actions)) throw new Error('Every rule needs an event and actions');
    if (!events.has(rule.event)) throw new Error(`Rule has no matching visible control or capability: ${rule.event}`);
    for (const action of rule.actions) {
      if (!stateKeys.has(action.target)) throw new Error(`Unknown action target: ${action.target}`);
      if (action.from && !stateKeys.has(action.from)) throw new Error(`Unknown action source: ${action.from}`);
      if (action.op === 'format_time' && !action.from) throw new Error('format_time needs a numeric source state key');
    }
  }
}

async function buildApp(prompt, currentApp) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on Render');
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const editing = currentApp && typeof currentApp === 'object';
  const input = editing ? `CURRENT APPLICATION:\n${JSON.stringify(currentApp)}\n\nCHANGE REQUEST:\n${prompt}` : prompt;
  const instructions = [
    'You are the AtomOS application architect.',
    editing ? 'Revise the supplied application. Preserve every unrelated working component, state key, capability and rule. Return the complete revised application.' : 'Turn the request into one complete small interactive application.',
    'Use only the supplied declarative schema. Never emit JavaScript, HTML, markdown, or prose.',
    'Every button event must exactly match a rule event. Every bind and action target must name a state key.',
    'You may synthesize reusable capability declarations when ordinary components and rules are insufficient.',
    'Available sandboxed capability types are interval and storage. For interval provide id, event, everyMs and optional enabledWhen. enabledWhen must be only a boolean state key such as running, never an expression such as running == true. For storage provide id, key and stateKeys. Do not invent unsupported capability types.',
    'Use the format_time action to format elapsed seconds as MM:SS. Never use calculate to create a colon-formatted time string.',
    'A stopwatch should synthesize an interval capability, use running=false and elapsed=0, increment elapsed on each interval event, and use format_time from elapsed into a display state.',
    'An app that must remember data between visits should synthesize a storage capability listing the state keys to persist.',
    'Keep component ids stable during edits unless the component is explicitly removed.',
    'For calculators, keep an expression string and use calculate to place its numeric result into the target.',
    'Make mobile-friendly apps with clear labels and useful initial state.'
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions, input, text: { format: { type: 'json_schema', name: 'atomos_application', strict: false, schema: APP_SCHEMA } } })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw new Error('The model returned no application');
  const app = normalizeApplication(JSON.parse(text));
  validateReferences(app);
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
      const html = data.toString('utf8').replace('</body>', '<script src="/pwa-export.js"></script><script src="/capability-runtime.js"></script></body>');
      return send(res, 200, html, 'text/html; charset=utf-8');
    }
    send(res, 200, data, types[path.extname(filePath)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/status') return send(res, 200, { ready: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5-mini', capabilityTypes: ['interval', 'storage'], actionTypes: ['format_time'] });
  if (req.method === 'POST' && req.url === '/api/build') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const prompt = String(body.prompt || '').trim();
      if (prompt.length < 3 || prompt.length > 6000) return send(res, 400, { error: 'Prompt must be between 3 and 6000 characters' });
      return send(res, 200, await buildApp(prompt, body.currentApp));
    } catch (error) {
      console.error(error);
      return send(res, 500, { error: error.message || 'Build failed' });
    }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`AtomOS listening on ${PORT}`));