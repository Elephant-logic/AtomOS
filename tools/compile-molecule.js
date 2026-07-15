#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {compileMolecule}=require('../src/molecules.js');
const input=process.argv[2];
if(!input){console.error('usage: node tools/compile-molecule.js molecule.json [output.atomic.json]');process.exit(2);}
const molecule=JSON.parse(fs.readFileSync(input,'utf8'));
const dir=path.join(__dirname,'..','molecular','atoms');
const atoms={};
for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.atom.json'))){
  const atom=JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
  atoms[atom.id]=atom;
}
const doc=compileMolecule(molecule,atoms);
const output=process.argv[3]||input.replace(/\.molecule\.json$/,'.atomic.json');
fs.writeFileSync(output,JSON.stringify(doc,null,2)+'\n');
console.log(output);
