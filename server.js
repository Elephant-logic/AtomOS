'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 100_000;

const APP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'state', 'components', 'rules'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 240 },
    state: {
      type: 'object',
      additionalProperties: { type: ['string', 'number', 'boolean'] }
    },
    components: {
      type: 'array', minItems: 1, maxItems: 80,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'type'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' },
          type: { type: 'string', enum: ['heading', 'text', 'display', 'input', 'button', 'spacer'] },
          text: { type: 'string', maxLength: 120 },
          label: { type: 'string', maxLength: 40 },
          bind: { type: 'string', maxLength: 40 },
          inputType: { type: 'string', enum: ['text', 'number', 'email', 'password'] },
          event: { type: 'string', maxLength: 40 },
          variant: { type: 'string', enum: ['primary', 'secondary', 'danger'] }
        }
      }
    },
    rules: {
      type: 'array', maxItems: 120,
      items: {
        type: 'object', additionalProperties: false,
        required: ['event', 'actions'],
        properties: {
          event: { type: 'string', maxLength: 40 },
          actions: {
            type: 'array', minItems: 1, maxItems: 12,
            items: {
              type: 'object', additionalProperties: false,
              required: ['op', 'target'],
              properties: {
                op: { type: 'string', enum: ['set', 'increment', 'decrement', 'append', 'clear', 'calculate'] },
                target: { type: 'string', maxLength: 40 },
                value: { type: ['string', 'number', 'boolean'] },
                from: { type: 'string', maxLength: 40 }
              }
            }
          }
        }
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
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    res.end(body);
    return;
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error('Request too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

async function buildApp(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on Render');

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      instructions: [
        'You are the AtomOS application architect.',
        'Turn the user request into one complete small interactive application.',
        'Use only the provided declarative schema. Never emit JavaScript, HTML, markdown, or prose.',
        'Every button event must have a matching rule.',
        'Every bind and action target must name a key in state.',
        'For calculators, keep an expression string and use calculate to place its numeric result into the target.',
        'Make mobile-friendly apps with clear labels and useful initial state.'
      ].join(' '),
      input: prompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'atomos_application',
          strict: true,
          schema: APP_SCHEMA
        }
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  }

  const text = extractOutputText(payload);
  if (!text) throw new Error('The model returned no application');
  const app = JSON.parse(text);
  validateReferences(app);
  return { app, model, responseId: payload.id };
}

function validateReferences(app) {
  const stateKeys = new Set(Object.keys(app.state || {}));
  const componentIds = new Set();
  const events = new Set();
  for (const component of app.components || []) {
    if (componentIds.has(component.id)) throw new Error(`Duplicate component id: ${component.id}`);
    componentIds.add(component.id);
    if (component.bind && !stateKeys.has(component.bind)) throw new Error(`Unknown binding: ${component.bind}`);
    if (component.event) events.add(component.event);
  }
  for (const rule of app.rules || []) {
    if (!events.has(rule.event)) throw new Error(`Rule has no matching visible control: ${rule.event}`);
    for (const action of rule.actions || []) {
      if (!stateKeys.has(action.target)) throw new Error(`Unknown action target: ${action.target}`);
      if (action.from && !stateKeys.has(action.from)) throw new Error(`Unknown action source: ${action.from}`);
    }
  }
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    send(res, 200, data, types[ext] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/status') {
    return send(res, 200, { ready: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  }
  if (req.method === 'POST' && req.url === '/api/build') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const prompt = String(body.prompt || '').trim();
      if (prompt.length < 3 || prompt.length > 4000) return send(res, 400, { error: 'Prompt must be between 3 and 4000 characters' });
      const result = await buildApp(prompt);
      return send(res, 200, result);
    } catch (error) {
      console.error(error);
      return send(res, 500, { error: error.message || 'Build failed' });
    }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  send(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`AtomOS listening on ${PORT}`));