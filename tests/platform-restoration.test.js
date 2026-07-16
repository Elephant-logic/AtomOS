'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('canonical startup remains free of source mutators',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts.start,'node server.js');
  assert.doesNotMatch(pkg.scripts.start,/ensure-|runtime-patch/);
});

test('platform features use middleware and never replace event execution',()=>{
  const files=['public/requirements-assistant-safe.js','public/capability-orchestrator-safe.js','public/history-manager-safe.js'];
  for(const file of files){
    const source=read(file);
    assert.match(source,/AtomOSBuildPipeline/);
    assert.doesNotMatch(source,/runEvent\s*=/);
    assert.doesNotMatch(source,/request\s*=\s*async function/);
  }
});

test('runtime loads verifier and middleware in a deterministic order',()=>{
  const source=read('public/capability-runtime.js');
  const names=['/build-verifier.js','/build-pipeline.js','/requirements-assistant-safe.js','/capability-orchestrator-safe.js','/history-manager-safe.js'];
  for(let i=1;i<names.length;i++)assert.ok(source.indexOf(names[i-1])<source.indexOf(names[i]));
  assert.match(source,/script\.async = false/);
  assert.match(source,/scripts\.reduce/);
});

test('only the runtime adapter assigns runEvent',()=>{
  const adapter=read('public/capability-runtime.js');
  assert.match(adapter,/runEvent = execute/);
  for(const file of ['public/build-pipeline.js','public/requirements-assistant-safe.js','public/capability-orchestrator-safe.js','public/history-manager-safe.js','public/build-verifier.js']){
    assert.doesNotMatch(read(file),/runEvent\s*=/);
  }
});
