'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('restored features use one build pipeline instead of stacking request wrappers',()=>{
  const pipeline=read('public/build-pipeline.js');
  assert.match(pipeline,/request = async function pipelineRequest/);
  for(const file of ['public/requirements-assistant-safe.js','public/capability-orchestrator-safe.js','public/history-manager-safe.js']){
    const source=read(file);
    assert.match(source,/AtomOSBuildPipeline/);
    assert.doesNotMatch(source,/request\s*=\s*async function/);
  }
});

test('safe loader preserves verifier and loads pipeline before restored middleware',()=>{
  const loader=read('tools/ensure-safe-platform-loader.js');
  const packageJson=JSON.parse(read('package.json'));
  assert.match(packageJson.scripts.start,/ensure-verifier-loader\.js/);
  assert.match(packageJson.scripts.start,/ensure-safe-platform-loader\.js/);
  assert.ok(loader.indexOf("build-pipeline.js") < loader.indexOf("requirements-assistant-safe.js"));
  assert.ok(loader.indexOf("requirements-assistant-safe.js") < loader.indexOf("capability-orchestrator-safe.js"));
  assert.ok(loader.indexOf("capability-orchestrator-safe.js") < loader.indexOf("history-manager-safe.js"));
});

test('calculator sequential runtime regression remains protected',()=>{
  const runtime=read('public/capability-runtime.js');
  assert.match(runtime,/function operand\(action, snapshot\)/);
  assert.match(runtime,/const value = operand\(action, state\)/);
  assert.match(runtime,/applyAction\(action, snapshot, emitted\)/);
  const verifier=read('public/build-verifier.js');
  assert.match(verifier,/2 × 3 equals 6/);
  assert.match(verifier,/Operator appears immediately/);
});
