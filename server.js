'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { buildCodeApp, scanPython } = require('./src/code-builder');
const knowledge = require('./src/knowledge/service');
const { normalizeApplication, validateReferences, buildApp, APP_SCHEMA, ACTION_TYPES } = require('./src/app-platform');
const { classifyBuildIntent, applyIntentGuard } = require('./src/build-intent');
const { compileCapabilityPlan, planInstructions } = require('./src/capability-compiler');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 500_000;
function send(res,status,body,type='application/json; charset=utf-8'){res.writeHead(status,{'content-type':type,'cache-control':type.startsWith('text/html')?'no-cache':'no-store','x-content-type-options':'nosniff'});res.end(Buffer.isBuffer(body)||body instanceof Uint8Array?body:(typeof body==='string'?body:JSON.stringify(body)));}
function readBody(req,max=MAX_BODY){return new Promise((resolve,reject)=>{let data='';req.on('data',chunk=>{data+=chunk;if(data.length>max)reject(new Error('Request too large'));});req.on('end',()=>resolve(data));req.on('error',reject);});}
function serveStatic(req,res){const pathname=new URL(req.url,'http://localhost').pathname;const rel=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');const filePath=path.normalize(path.join(PUBLIC_DIR,rel));if(!filePath.startsWith(PUBLIC_DIR))return send(res,403,'Forbidden','text/plain');fs.readFile(filePath,(error,data)=>{if(error)return send(res,404,'Not found','text/plain');const types={ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };if(rel==='index.html'){const scripts='<script src="/runtime-core.js"></script><script src="/condition-expression.js"></script><script src="/pwa-export.js"></script><script src="/capability-runtime.js"></script><script src="/codem8s-studio.js"></script><script src="/knowledge-studio.js"></script><script src="/game-web-studio.js"></script><script src="/game-engine.js"></script><script src="/game-engine-studio.js"></script><script src="/build-router.js"></script>';return send(res,200,data.toString('utf8').replace('</body>',`${scripts}</body>`),'text/html; charset=utf-8');}send(res,200,data,types[path.extname(filePath)]||'application/octet-stream');});}
async function knowledgeRoute(req,res,url){if(!url.pathname.startsWith('/api/knowledge'))return false;try{if(req.method==='GET'&&url.pathname==='/api/knowledge/stats')return send(res,200,await knowledge.stats()),true;if(req.method==='GET'&&url.pathname==='/api/knowledge/search')return send(res,200,await knowledge.search(url.searchParams.get('q')||'',Number(url.searchParams.get('limit')||30))),true;if(req.method==='GET'&&url.pathname.startsWith('/api/knowledge/atoms/')){const id=decodeURIComponent(url.pathname.slice('/api/knowledge/atoms/'.length));const result=await knowledge.get(id);send(res,result.atom?200:404,result);return true;}if(req.method==='POST'&&url.pathname==='/api/knowledge/import')return send(res,200,await knowledge.importAtoms(JSON.parse(await readBody(req,5_000_000)||'{}'))),true;if(req.method==='POST'&&/\/api\/knowledge\/atoms\/[^/]+\/status$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/').slice(-2)[0]);const body=JSON.parse(await readBody(req)||'{}');send(res,200,await knowledge.setStatus(id,body.status));return true;}if(req.method==='POST'&&/\/api\/knowledge\/atoms\/[^/]+\/usage$/.test(url.pathname)){const id=decodeURIComponent(url.pathname.split('/').slice(-2)[0]);const body=JSON.parse(await readBody(req)||'{}');send(res,200,await knowledge.recordUsage(id,Boolean(body.success)));return true;}send(res,404,{error:'Knowledge endpoint not found'});return true;}catch(error){send(res,500,{error:error.message||'Knowledge database failed'});return true;}}

async function compileAndBuild(prompt,currentApp,intent){
  const plan=compileCapabilityPlan(prompt);
  const guarded=`BUILD PROFILE: ${intent.intent}. ${intent.instructions}\n${planInstructions(plan)}\n\nUSER REQUEST:\n${prompt}`;
  let result;
  try { result=await buildApp(guarded,currentApp); }
  catch(error){
    const repair=`${guarded}\n\nREPAIR REQUIREMENT: A previous attempt failed validation with: ${error.message}. Return a corrected complete application. Use scene for real-time games and sound for audio. Every rule action target must exactly match a declared state key.`;
    result=await buildApp(repair,currentApp);
    result.repaired=true;
  }
  if(plan.generatedAtoms.length){
    try { await knowledge.importAtoms({atoms:plan.generatedAtoms}); result.learnedAtoms=plan.generatedAtoms.map(atom=>atom.id); }
    catch(error){ result.knowledgeWarning=error.message; }
  }
  return {...result,plan};
}

const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await knowledgeRoute(req,res,url))return;
  if(req.method==='GET'&&url.pathname==='/api/status')return send(res,200,{ready:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||'gpt-5-mini',capabilityTypes:['interval','storage','startup','keyboard'],actionTypes:ACTION_TYPES,componentTypes:APP_SCHEMA.properties.components.items.properties.type.enum,screens:true,boards:true,groups:true,repeats:true,scenes:true,audio:true,capabilityCompiler:true,conditionalActions:true,conditionalComponents:true,internalEvents:true,listState:true,intentRouter:true,codeBuilder:{languages:['python'], execution: false, verification:['blocked-pattern scan','python syntax compile','repair loop']}});
  if(req.method==='POST'&&url.pathname==='/api/build-intent'){try{const body=JSON.parse(await readBody(req)||'{}');const prompt=String(body.prompt||'').trim();if(prompt.length<3||prompt.length>12000)return send(res,400,{error:'Prompt must be between 3 and 12000 characters'});return send(res,200,{...applyIntentGuard(prompt,body.option),plan:compileCapabilityPlan(prompt)});}catch(error){return send(res,400,{error:error.message||'Classification failed'});}}
  if(req.method==='POST'&&url.pathname==='/api/capability-plan'){try{const body=JSON.parse(await readBody(req)||'{}');return send(res,200,compileCapabilityPlan(String(body.prompt||'')));}catch(error){return send(res,400,{error:error.message||'Planning failed'});}}
  if(req.method==='POST'&&url.pathname==='/api/build'){try{const body=JSON.parse(await readBody(req)||'{}');const prompt=String(body.prompt||'').trim();if(prompt.length<3||prompt.length>6000)return send(res,400,{error:'Prompt must be between 3 and 6000 characters'});const intent=classifyBuildIntent(prompt);const result=await compileAndBuild(prompt,body.currentApp,intent);return send(res,200,{...result,intent});}catch(error){console.error(error);return send(res,500,{error:error.message||'Build failed'});}}
  if(req.method==='POST'&&url.pathname==='/api/code-build'){try{const body=JSON.parse(await readBody(req)||'{}');const prompt=String(body.prompt||'').trim();if(prompt.length<3||prompt.length>12000)return send(res,400,{error:'Prompt must be between 3 and 12000 characters'});const guard=applyIntentGuard(prompt,'code');if(guard.mismatch)return send(res,409,{error:`This looks like a ${guard.intent} request. Use ${guard.label}.`,intent:guard});const artifact=await buildCodeApp({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini',prompt,maxAttempts:3});return send(res,200,{artifact,mode:'code', execution: false, intent:guard});}catch(error){console.error(error);return send(res,500,{error:error.message||'Code build failed',artifact:error.artifact||null});}}
  if(req.method==='POST'&&url.pathname==='/api/code-analyze'){try{const body=JSON.parse(await readBody(req)||'{}');const code=String(body.code||'');if(!code||code.length>100000)return send(res,400,{error:'Code must be between 1 and 100000 characters'});return send(res,200,{analysis:scanPython(code)});}catch(error){return send(res,500,{error:error.message||'Code analysis failed'});}}
  if(req.method==='GET')return serveStatic(req,res);send(res,405,{error:'Method not allowed'});
});
if(require.main===module){knowledge.init().then(result=>console.log(`AtomOS knowledge database ready: ${result.database}`)).catch(error=>console.error('Knowledge database unavailable:',error));server.listen(PORT,'0.0.0.0',()=>console.log(`AtomOS listening on ${PORT}`));}
module.exports={normalizeApplication,validateReferences,buildApp,APP_SCHEMA,ACTION_TYPES,classifyBuildIntent,applyIntentGuard,compileCapabilityPlan,server};
