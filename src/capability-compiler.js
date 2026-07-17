'use strict';

const CATALOG = {
  screens: { terms: ['menu','screen','game over','victory'], available: true, primitive: 'screens' },
  state: { terms: ['score','lives','health','checkpoint','coins'], available: true, primitive: 'state' },
  keyboard: { terms: ['keyboard','left','right','jump','controls'], available: true, primitive: 'keyboard capability' },
  sprite: { terms: ['sprite','player','enemy','animation'], available: true, primitive: 'scene entity' },
  physics: { terms: ['gravity','jump','velocity','platformer'], available: true, primitive: 'scene world physics' },
  collision: { terms: ['collision','platform','solid'], available: true, primitive: 'scene tile collision' },
  tilemap: { terms: ['tile map','tilemap','tiles','level'], available: true, primitive: 'scene world map' },
  camera: { terms: ['camera','scrolling','follow'], available: true, primitive: 'scene camera' },
  audio: { terms: ['sound','music','audio'], available: true, primitive: 'sound component' },
  animation: { terms: ['animation','animated','idle','run'], available: true, primitive: 'entity animations' },
  enemy_ai: { terms: ['enemy','enemies','patrol','chase'], available: false, primitive: 'behaviour atom' },
  checkpoints: { terms: ['checkpoint','respawn'], available: false, primitive: 'checkpoint molecule' },
  collectibles: { terms: ['coin','coins','collectible','collect'], available: false, primitive: 'collectible molecule' }
};

function includesTerm(text, term) {
  return text.includes(term);
}

function compileCapabilityPlan(prompt) {
  const text = String(prompt || '').toLowerCase();
  const required = [];
  for (const [id, capability] of Object.entries(CATALOG)) {
    const evidence = capability.terms.filter(term => includesTerm(text, term));
    if (evidence.length) required.push({ id, primitive: capability.primitive, available: capability.available, evidence });
  }
  const reusable = required.filter(item => item.available);
  const missing = required.filter(item => !item.available);
  const generatedAtoms = missing.map(item => ({
    id: `generated.${item.id}`,
    name: item.id.replaceAll('_', ' '),
    kind: 'capability',
    description: `Reusable ${item.primitive} inferred from a successful build.`,
    status: 'draft',
    tags: ['generated', 'capability', item.id],
    implementations: [{ language: 'atomos', code: JSON.stringify({ capability: item.id, primitive: item.primitive }) }]
  }));
  return { required, reusable, missing, generatedAtoms, summary: `${required.length} required · ${reusable.length} reusable · ${missing.length} to synthesize` };
}

function planInstructions(plan) {
  if (!plan.required.length) return 'Use only schema-supported AtomOS primitives.';
  const use = plan.reusable.map(item => `${item.id} via ${item.primitive}`).join(', ') || 'none';
  const synthesize = plan.missing.map(item => `${item.id} as ${item.primitive}`).join(', ') || 'none';
  return `CAPABILITY PLAN: reuse ${use}. Compose missing higher-level behaviour from supported primitives: ${synthesize}. Never invent unsupported component or action types. Every action target must be an existing state key; never emit the literal target "undefined".`;
}

module.exports = { CATALOG, compileCapabilityPlan, planInstructions };
