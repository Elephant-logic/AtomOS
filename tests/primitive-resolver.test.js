'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toAtom, resolvePrimitives, primitiveInstructions } = require('../src/primitive-resolver');

function fakeKnowledge(initial = []) {
  const atoms = [...initial];
  return {
    atoms,
    async search() { return { results: [...atoms] }; },
    async importAtoms(value) {
      atoms.push(...value.atoms);
      return { ok: true, ids: value.atoms.map(atom => atom.id) };
    },
    async recordUsage() { return { ok: true }; }
  };
}

test('primitive atoms use the knowledge engine implementation format', () => {
  const atom = toAtom({
    id: 'coin_collectible',
    name: 'Coin collectible',
    description: 'Collects coins.',
    instructions: 'Compose collision state and increment score.',
    dependencies: []
  });
  assert.equal(atom.id, 'primitive-coin-collectible');
  assert.equal(atom.kind, 'primitive.capability');
  assert.ok(Array.isArray(atom.implementations.atomos));
  assert.match(atom.implementations.atomos[0].source, /increment score/);
});

test('missing capabilities create and persist composition primitives', async () => {
  const knowledge = fakeKnowledge();
  const plan = { missing: [{ id: 'collectibles', primitive: 'collectible molecule' }] };
  const resolution = await resolvePrimitives('game with coins', plan, { knowledge, disableModel: true });
  assert.ok(resolution.created.includes('primitive-collectibles'));
  assert.equal(knowledge.atoms.length, 1);
  assert.match(primitiveInstructions(resolution), /primitive-collectibles/);
});

test('known primitives are reused instead of regenerated', async () => {
  const existing = toAtom({ id: 'collectibles', name: 'Collectibles', description: 'Known.', instructions: 'Reuse known collectible rules.', dependencies: [] });
  const knowledge = fakeKnowledge([existing]);
  const plan = { missing: [{ id: 'collectibles', primitive: 'collectible molecule' }] };
  const resolution = await resolvePrimitives('game with coins', plan, { knowledge, disableModel: true });
  assert.deepEqual(resolution.reused, [existing.id]);
  assert.deepEqual(resolution.created, []);
  assert.equal(knowledge.atoms.length, 1);
});
