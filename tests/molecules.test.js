'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {compileMolecule,compatible}=require('../src/molecules.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'..',p),'utf8'));
const atoms={
  'ui.button':read('molecular/atoms/button.atom.json'),
  'ui.text-display':read('molecular/atoms/text-display.atom.json'),
  'state.string':read('molecular/atoms/string-state.atom.json')
};
test('typed connector compatibility',()=>{
  assert.equal(compatible({direction:'output',type:'String',protocol:'event'},{direction:'input',type:'String',protocol:'state'}),true);
  assert.equal(compatible({direction:'output',type:'Number',protocol:'event'},{direction:'input',type:'String',protocol:'state'}),false);
});
test('compiler namespaces atoms and creates source maps',()=>{
  const doc=compileMolecule(read('molecular/molecules/counter.molecule.json'),atoms);
  assert.ok(doc.entities.some(e=>e.id==='display__display'));
  assert.ok(doc.entities.some(e=>e.id==='value__state'));
  assert.ok(doc.rules.some(r=>r.id==='counter__show_value'));
  assert.equal(doc.molecular.sourceMap.rules.counter__show_value.from,'value.changed');
});
