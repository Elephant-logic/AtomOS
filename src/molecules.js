'use strict';

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function assertId(v, label) {
  if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(v)) throw new Error(`${label} must be a stable identifier`);
}
function qualify(instance, local) { return `${instance}__${local}`; }
function tokens(v, vars) {
  if (typeof v === 'string') return v.replace(/\$\{([A-Za-z0-9_.-]+)\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`unknown template variable '${k}'`);
    return String(vars[k]);
  });
  if (Array.isArray(v)) return v.map(x => tokens(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x]) => [k,tokens(x,vars)]));
  return v;
}
function connector(c, direction) {
  if (!c || typeof c !== 'object') throw new Error('connector must be an object');
  assertId(c.name, 'connector name');
  return { name:c.name, direction, type:c.type||'any', protocol:c.protocol||'event', required:!!c.required,
    cardinality:c.cardinality||'one', event:c.event||null, source:c.source||null,
    target:c.target||null, property:c.property||null, action:c.action||null };
}
function validateAtomDefinition(atom) {
  if (!atom || atom.kind !== 'atom') throw new Error('atom.kind must be "atom"');
  assertId(atom.id, 'atom id');
  const inputs=(atom.inputs||[]).map(c=>connector(c,'input'));
  const outputs=(atom.outputs||[]).map(c=>connector(c,'output'));
  const seen=new Set();
  for (const c of [...inputs,...outputs]) {
    const k=`${c.direction}:${c.name}`;
    if (seen.has(k)) throw new Error(`duplicate ${c.direction} connector '${c.name}'`);
    seen.add(k);
  }
  return {...atom,inputs,outputs};
}
function compatible(out,input) {
  if (!out || !input || out.direction!=='output' || input.direction!=='input') return false;
  const typeOk=out.type==='any'||input.type==='any'||out.type===input.type;
  const protocolOk=out.protocol===input.protocol||input.protocol==='any'||(out.protocol==='event'&&['value','state'].includes(input.protocol));
  return typeOk&&protocolOk;
}
function compileMolecule(molecule, atomLibrary, opts={}) {
  if (!molecule || molecule.kind!=='molecule') throw new Error('molecule.kind must be "molecule"');
  assertId(molecule.id,'molecule id');
  const system=opts.system||molecule.system||'core';
  const entities=[], rules=[], relationships=[], instances=new Map();
  const sourceMap={molecule:molecule.id,entities:{},rules:{},bonds:{}};

  for (const inst of molecule.atoms||[]) {
    assertId(inst.id,'atom instance id');
    const raw=atomLibrary[inst.atom];
    if (!raw) throw new Error(`unknown atom '${inst.atom}'`);
    const atom=validateAtomDefinition(raw);
    if (instances.has(inst.id)) throw new Error(`duplicate atom instance '${inst.id}'`);
    const vars={instance:inst.id,molecule:molecule.id,...(atom.defaults||{}),...(inst.config||{})};
    const idMap=Object.fromEntries((atom.entities||[]).map(e=>[e.id,qualify(inst.id,e.id)]));
    const remap=v=>{
      if (typeof v==='string') { const x=tokens(v,vars); return idMap[x]||x; }
      if (Array.isArray(v)) return v.map(remap);
      if (v&&typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,remap(x)]));
      return v;
    };
    for (const e0 of atom.entities||[]) {
      const e=remap(clone(e0)); e.id=idMap[e0.id]; e.system=e.system||system; entities.push(e);
      sourceMap.entities[e.id]={molecule:molecule.id,atom:inst.id,template:inst.atom,local:e0.id};
    }
    for (const r0 of atom.rules||[]) {
      const r=remap(clone(r0)); r.id=qualify(inst.id,r0.id); r.system=r.system||system; rules.push(r);
      sourceMap.rules[r.id]={molecule:molecule.id,atom:inst.id,template:inst.atom,local:r0.id};
    }
    instances.set(inst.id,{...inst,atom,connectors:new Map([...atom.inputs,...atom.outputs].map(c=>[c.name,c]))});
  }

  for (let i=0;i<(molecule.bonds||[]).length;i++) {
    const b=molecule.bonds[i], [fi,fn]=String(b.from).split('.'), [ti,tn]=String(b.to).split('.');
    const a=instances.get(fi), z=instances.get(ti);
    if (!a||!z) throw new Error(`bond ${i}: unknown instance`);
    const out=a.connectors.get(fn), input=z.connectors.get(tn);
    if (!out||!input) throw new Error(`bond ${i}: unknown connector`);
    if (!compatible(out,input)) throw new Error(`bond ${i}: incompatible ${out.protocol}<${out.type}> -> ${input.protocol}<${input.type}>`);
    const id=b.id||`bond_${i+1}`;
    const event=out.event||`molecule.${molecule.id}.${fi}.${fn}`;
    const source=out.source?qualify(fi,out.source):null;
    const target=input.target?qualify(ti,input.target):null;
    let action;
    if (input.action) action=tokens(clone(input.action),{target:target||'',property:input.property||'',sourceEvent:event});
    else if (input.protocol==='event') action={emit:[input.event||`molecule.${molecule.id}.${ti}.${tn}`,target||ti,'event.payload']};
    else if (['value','state'].includes(input.protocol)) {
      if (!target||!input.property) throw new Error(`bond ${i}: value input requires target and property`);
      action={set:[target,input.property,'event.payload']};
    } else throw new Error(`bond ${i}: unsupported protocol '${input.protocol}'`);
    const rule={id:qualify(molecule.id,id),system,when:{event,...(source?{source:{id:source}}:{})},then:[action]};
    rules.push(rule);
    sourceMap.rules[rule.id]={molecule:molecule.id,bond:id,from:b.from,to:b.to};
    sourceMap.bonds[id]={from:b.from,to:b.to,generatedRule:rule.id};
  }
  return { atomic:opts.atomic||'0.1', seed:opts.seed??1, systems:[{id:system}], entities, prototypes:[], relationships, rules,
    molecular:{source:molecule,sourceMap} };
}
module.exports={validateAtomDefinition,compatible,compileMolecule,qualify};
