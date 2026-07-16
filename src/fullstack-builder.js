'use strict';

const PROJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'stack', 'files', 'nodes', 'edges', 'tests', 'suggestions'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    summary: { type: 'string', maxLength: 500 },
    stack: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 80 } },
    files: {
      type: 'array', minItems: 1, maxItems: 30,
      items: {
        type: 'object', additionalProperties: false,
        required: ['path', 'language', 'purpose', 'content'],
        properties: {
          path: { type: 'string', pattern: '^[A-Za-z0-9_./-]{1,160}$' },
          language: { type: 'string', maxLength: 40 },
          purpose: { type: 'string', maxLength: 240 },
          content: { type: 'string', maxLength: 60000 }
        }
      }
    },
    nodes: {
      type: 'array', maxItems: 80,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'kind', 'label', 'file', 'provides', 'requires', 'status'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,59}$' },
          kind: { type: 'string', maxLength: 60 },
          label: { type: 'string', maxLength: 100 },
          file: { type: 'string', maxLength: 160 },
          provides: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
          requires: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } },
          status: { type: 'string', enum: ['planned', 'generated', 'connected', 'tested', 'verified', 'broken', 'stale'] }
        }
      }
    },
    edges: {
      type: 'array', maxItems: 160,
      items: {
        type: 'object', additionalProperties: false,
        required: ['from', 'to', 'connector', 'status'],
        properties: {
          from: { type: 'string', maxLength: 60 },
          to: { type: 'string', maxLength: 60 },
          connector: { type: 'string', maxLength: 100 },
          status: { type: 'string', enum: ['planned', 'connected', 'verified', 'broken', 'stale'] }
        }
      }
    },
    tests: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 300 } },
    suggestions: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 300 } }
  }
};

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) for (const part of item.content || []) {
    if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  }
  return '';
}

function validateProject(project) {
  const files = new Set((project.files || []).map(file => file.path));
  const nodes = new Set();
  for (const node of project.nodes || []) {
    if (nodes.has(node.id)) throw Error(`Duplicate project node: ${node.id}`);
    nodes.add(node.id);
    if (!files.has(node.file)) throw Error(`Node ${node.id} references missing file: ${node.file}`);
  }
  for (const edge of project.edges || []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) throw Error(`Broken graph edge: ${edge.from} -> ${edge.to}`);
  }
  return project;
}

async function buildFullStackProject({ apiKey, model = 'gpt-5-mini', prompt, currentProject = null }) {
  if (!apiKey) throw Error('OPENAI_API_KEY is not configured on Render');
  const editing = currentProject && typeof currentProject === 'object';
  const instructions = [
    'You are the AtomOS incremental full-stack architect.',
    'Return a small but complete multi-file project as structured JSON.',
    'Build one working vertical slice across interface, API, logic, storage and tests instead of generating disconnected layers.',
    'Use browser HTML/CSS/JavaScript for the frontend and Node.js standard-library code for the backend unless the request explicitly requires another stack.',
    'Every file must be complete. Every graph node must reference one returned file.',
    'Use provides and requires as typed molecule-style connectors such as api:create-item, schema:item, storage:item and ui:item-form.',
    'Connect nodes with edges whose connector matches the capability flowing between them.',
    'Keep the first project small enough to understand and run. Put sensible next capabilities in suggestions.',
    editing ? 'Incrementally revise the supplied project. Preserve unrelated files, nodes and connections; change only what the request affects.' : 'Create the project nucleus and the first complete feature.',
    'Do not include markdown fences or prose outside the JSON.'
  ].join(' ');
  const input = editing
    ? `CURRENT PROJECT:\n${JSON.stringify(currentProject)}\n\nCHANGE REQUEST:\n${prompt}`
    : prompt;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions,
      input,
      text: { format: { type: 'json_schema', name: 'atomos_fullstack_project', strict: false, schema: PROJECT_SCHEMA } }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw Error('The model returned no full-stack project');
  const project = validateProject(JSON.parse(text));
  return {
    project: {
      ...project,
      atomosProjectVersion: '0.1',
      updatedAt: new Date().toISOString(),
      history: [
        ...((editing && Array.isArray(currentProject.history)) ? currentProject.history.slice(-19) : []),
        { at: new Date().toISOString(), request: prompt, changedFiles: project.files.map(file => file.path) }
      ]
    },
    mode: editing ? 'fullstack-edit' : 'fullstack-build',
    model,
    responseId: payload.id
  };
}

module.exports = { PROJECT_SCHEMA, validateProject, buildFullStackProject };
