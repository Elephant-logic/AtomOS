'use strict';

function slug(value) {
  return String(value || 'primitive').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'primitive';
}

function primitiveId(value) {
  const id = slug(value);
  return id.startsWith('primitive-') ? id : `primitive-${id}`;
}

function implementationSource(spec) {
  return JSON.stringify({
    id: spec.id,
    description: spec.description,
    instructions: spec.instructions,
    dependencies: spec.dependencies || []
  });
}

function toAtom(spec, status = 'learned') {
  const id = primitiveId(spec.id || spec.name);
  return {
    id,
    name: String(spec.name || id.replace(/^primitive-/, '').replaceAll('-', ' ')).slice(0, 160),
    kind: 'primitive.capability',
    description: String(spec.description || `Reusable AtomOS primitive for ${id}.`).slice(0, 1000),
    status,
    confidence: Number(spec.confidence || 0.55),
    tags: ['primitive', 'capability', ...String(spec.id || '').split(/[^a-z0-9]+/i).filter(Boolean)],
    metadata: {
      instructions: String(spec.instructions || ''),
      dependencies: Array.isArray(spec.dependencies) ? spec.dependencies.map(item => primitiveId(item.id || item.name)) : []
    },
    implementations: {
      atomos: [{ source: implementationSource(spec), runtime: 'composition' }]
    }
  };
}

function fallbackSpec(capability) {
  const id = capability.id || capability.primitive || 'missing-capability';
  return {
    id,
    name: id.replaceAll('_', ' '),
    description: `Reusable ${capability.primitive || id} composed from schema-supported AtomOS components, state, rules and capabilities.`,
    instructions: `Implement ${id} only by composing existing AtomOS state keys, components, rules and capabilities. Do not invent component types, action types or undeclared state keys.`,
    dependencies: [],
    confidence: 0.5
  };
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) for (const part of item.content || []) {
    if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  }
  return '';
}

async function synthesizePrimitive(capability, options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey || options.disableModel) return fallbackSpec(capability);
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-5-mini';
  const schema = {
    type: 'object', additionalProperties: false, required: ['id','name','description','instructions','dependencies'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 80 },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: 'string', minLength: 1, maxLength: 600 },
      instructions: { type: 'string', minLength: 1, maxLength: 2000 },
      dependencies: { type: 'array', maxItems: 8, items: {
        type: 'object', additionalProperties: false, required: ['id','name','description','instructions'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 80 },
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', minLength: 1, maxLength: 500 },
          instructions: { type: 'string', minLength: 1, maxLength: 1200 }
        }
      }}
    }
  };
  const input = `Create one reusable AtomOS composition primitive for this missing capability:\n${JSON.stringify(capability)}\nThe primitive must be implementable with existing AtomOS schema primitives. Dependencies must be smaller reusable composition primitives, not new runtime component or action types.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: 'Return a compact primitive specification. Never return JavaScript. Never invent unsupported runtime types. Express behavior as composition instructions over state, components, rules and capabilities.',
      input,
      text: { format: { type: 'json_schema', name: 'atomos_primitive', strict: false, schema } }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Primitive synthesis failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw new Error('Primitive synthesis returned no specification');
  return JSON.parse(text);
}

function atomInstructions(atom) {
  const instructions = atom?.metadata?.instructions;
  if (instructions) return String(instructions);
  const entries = atom?.implementations?.atomos;
  if (Array.isArray(entries) && entries[0]?.source) {
    try { return JSON.parse(entries[0].source).instructions || ''; } catch {}
  }
  return atom?.description || '';
}

function bestMatch(results, capability) {
  const wanted = new Set([slug(capability.id), slug(capability.primitive)]);
  return (results || []).find(atom => {
    const values = [atom.id, atom.name, ...(atom.tags || [])].map(slug);
    return values.some(value => wanted.has(value) || [...wanted].some(term => value.includes(term)));
  });
}

async function findExisting(capability, knowledgeApi) {
  const query = [capability.id, capability.primitive].filter(Boolean).join(' ');
  try {
    const result = await knowledgeApi.search(query, 20);
    return bestMatch(result.results, capability) || null;
  } catch {
    return null;
  }
}

async function resolvePrimitives(prompt, plan, options = {}) {
  const knowledgeApi = options.knowledge;
  if (!knowledgeApi) throw new Error('Primitive resolver needs a knowledge API');
  const required = Array.isArray(plan?.missing) ? plan.missing : [];
  const reused = [], created = [], atoms = [];

  for (const capability of required) {
    const existing = await findExisting(capability, knowledgeApi);
    if (existing) {
      reused.push(existing.id);
      atoms.push(existing);
      continue;
    }

    let spec;
    try { spec = await synthesizePrimitive(capability, options); }
    catch (error) { spec = { ...fallbackSpec(capability), synthesisWarning: error.message }; }

    const dependencySpecs = Array.isArray(spec.dependencies) ? spec.dependencies : [];
    const generated = [...dependencySpecs.map(item => toAtom({ ...item, dependencies: [] })), toAtom(spec)];
    const imported = await knowledgeApi.importAtoms({ atoms: generated });
    created.push(...(imported.ids || generated.map(atom => atom.id)));
    atoms.push(...generated);
  }

  const instructions = atoms.map(atom => `${atom.id}: ${atomInstructions(atom)}`).filter(Boolean);
  return {
    reused,
    created,
    atoms: atoms.map(atom => atom.id),
    instructions,
    summary: `${reused.length} reused · ${created.length} created`
  };
}

function primitiveInstructions(resolution) {
  if (!resolution?.instructions?.length) return 'No additional learned primitives are required.';
  return `RESOLVED PRIMITIVES:\n${resolution.instructions.map(item => `- ${item}`).join('\n')}\nCompose the application from these primitives. Do not replace them with invented runtime types.`;
}

module.exports = { slug, primitiveId, toAtom, fallbackSpec, synthesizePrimitive, findExisting, resolvePrimitives, primitiveInstructions };
