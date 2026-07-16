'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CODE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'language', 'filename', 'code', 'previewHtml', 'tests', 'dependencies', 'notes'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 }, language: { type: 'string', enum: ['python'] },
    filename: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,60}\\.py$' }, code: { type: 'string', minLength: 20, maxLength: 60000 },
    previewHtml: { type: 'string', minLength: 40, maxLength: 60000 },
    tests: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 240 } },
    dependencies: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } },
    notes: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 240 } }
  }
};

const BLOCKED_PATTERNS = [
  [/\bos\.system\s*\(/, 'os.system is not allowed'],
  [/\bsubprocess\.(?:Popen|run|call|check_call|check_output)\s*\(/, 'subprocess execution is not allowed'],
  [/\beval\s*\(/, 'eval is not allowed'], [/\bexec\s*\(/, 'exec is not allowed'],
  [/\b__import__\s*\(/, '__import__ is not allowed'], [/\bsocket\b/, 'raw sockets are not allowed'],
  [/\bctypes\b/, 'ctypes is not allowed'], [/\bpickle\.(?:loads?|Unpickler)\b/, 'unsafe pickle loading is not allowed'],
  [/^\s*(?:from|import)\s+(?:requests|urllib|http\.client|ftplib|smtplib)\b/m, 'network client modules are not allowed in the verification worker']
];

const PREVIEW_BLOCKED = [
  [/<script[^>]+src\s*=/i, 'preview cannot load external scripts'],
  [/<(?:iframe|object|embed|base)\b/i, 'preview cannot embed external documents'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, 'preview cannot access the network'],
  [/\bwindow\.(?:open|location)\b/, 'preview cannot navigate or open windows'],
  [/\bdocument\.cookie\b/, 'preview cannot access cookies']
];

function extractOutputText(response) { if (typeof response.output_text === 'string') return response.output_text; for (const item of response.output || []) for (const part of item.content || []) if (part.type === 'output_text' && typeof part.text === 'string') return part.text; return ''; }
function safeFilename(value) { const base=String(value||'codem8s_app.py').replace(/\.py$/i,'').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'codem8s_app'; return `${base}.py`; }
function scanPython(code) { const source=String(code||''),errors=[]; for(const [pattern,message] of BLOCKED_PATTERNS) if(pattern.test(source)) errors.push(message); const dependencies=new Set(); for(const match of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm)) dependencies.add(match[1].split('.')[0]); const functions=[...source.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map(x=>x[1]); const classes=[...source.matchAll(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm)].map(x=>x[1]); const declaredColumns=new Set(); for(const m of source.matchAll(/Treeview\([^\n]*columns\s*=\s*\(([^)]*)\)/g)) for(const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) declaredColumns.add(q[1]); for(const m of source.matchAll(/\.set\([^,]+,\s*['"]([^'"]+)['"]/g)) if(!declaredColumns.has(m[1])) errors.push(`Treeview column ${m[1]} is used but not declared`); return {errors:[...new Set(errors)],dependencies:[...dependencies].sort(),functions,classes,lineCount:source.split('\n').length}; }
function scanPreview(html) { const source=String(html||''),errors=[]; for(const [pattern,message] of PREVIEW_BLOCKED) if(pattern.test(source)) errors.push(message); if(!/<html\b|<!doctype\s+html/i.test(source)) errors.push('preview must be a complete HTML document'); return {ok:errors.length===0,errors}; }
function runProcess(command,args,options={}) { return new Promise(resolve=>{ const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options}); let stdout='',stderr='',timedOut=false; const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},options.timeoutMs||5000); child.stdout.on('data',x=>stdout+=x); child.stderr.on('data',x=>stderr+=x); child.on('error',error=>{clearTimeout(timer);resolve({ok:false,code:null,stdout,stderr:error.message,timedOut})}); child.on('close',code=>{clearTimeout(timer);resolve({ok:code===0&&!timedOut,code,stdout,stderr,timedOut})}); }); }
async function withTempProgram(code, task) { const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atomos-codem8s-')); const filename=path.join(dir,'app.py'); try { await fs.writeFile(filename,code,'utf8'); return await task({dir,filename}); } finally { await fs.rm(dir,{recursive:true,force:true}); } }
async function validatePythonSyntax(code) { return withTempProgram(code,async({dir,filename})=>{ const result=await runProcess(process.env.PYTHON_BIN||'python3',['-I','-m','py_compile',filename],{cwd:dir,env:{PATH:process.env.PATH||'',HOME:dir,TMPDIR:dir,PYTHONNOUSERSITE:'1'},timeoutMs:5000}); return {ok:result.ok,error:result.stderr.trim(),timedOut:result.timedOut}; }); }
async function smokeTestPython(code) { return withTempProgram(code,async({dir})=>{ const harness='import runpy; runpy.run_path("app.py", run_name="atomos_smoke")'; const result=await runProcess(process.env.PYTHON_BIN||'python3',['-I','-c',harness],{cwd:dir,env:{PATH:process.env.PATH||'',HOME:dir,TMPDIR:dir,PYTHONNOUSERSITE:'1',DISPLAY:''},timeoutMs:5000}); return {ok:result.ok,error:result.stderr.trim(),stdout:result.stdout.trim().slice(0,2000),timedOut:result.timedOut,mode:'restricted import smoke test',limitations:'The Python desktop window is not opened. AtomOS displays the separate functional browser preview in a sandboxed iframe.'}; }); }
async function requestCode({apiKey,model,prompt,feedback=''}) { const instructions=['You are Codem8s, the conventional-code builder inside AtomOS.','Create one complete maintainable Python file that fulfils the request.','Also create previewHtml: one complete self-contained HTML document that visually and interactively demonstrates the same application inside AtomOS.','The browser preview must use only inline HTML, CSS and JavaScript, must not use external resources or network access, and its main controls must work with local in-memory data.','The preview is a companion demonstration, not a claim that Python or Tkinter runs in the browser.','Prefer the Python standard library. List every non-standard dependency.','The Python program must have a main entry point guarded by if __name__ == "__main__".','For Tkinter Treeview record identity, use the item iid or tags; never call tree.set with an undeclared phantom column.','Do not use os.system, subprocess execution, eval, exec, raw sockets, ctypes, unsafe pickle loading, network clients, credential harvesting or destructive behavior.','Do not embed secrets.','Return structured JSON only.'].join(' '); const input=feedback?`${prompt}\n\nPREVIOUS VALIDATION FAILED:\n${feedback}\nReturn the complete repaired Python program and browser preview.`:prompt; const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,instructions,input,text:{format:{type:'json_schema',name:'atomos_code_app',strict:false,schema:CODE_SCHEMA}}})}); const payload=await response.json(); if(!response.ok) throw Error(payload?.error?.message||`OpenAI request failed (${response.status})`); const text=extractOutputText(payload); if(!text) throw Error('The model returned no code application'); return {artifact:JSON.parse(text),responseId:payload.id}; }
async function buildCodeApp({apiKey,model='gpt-5-mini',prompt,maxAttempts=3}) { let feedback='',lastArtifact=null; for(let attempt=1;attempt<=maxAttempts;attempt++){ const result=await requestCode({apiKey,model,prompt,feedback}); const artifact=result.artifact; artifact.filename=safeFilename(artifact.filename); const scan=scanPython(artifact.code); const preview=scanPreview(artifact.previewHtml); const syntax=scan.errors.length?{ok:false,error:scan.errors.join('; ')}:await validatePythonSyntax(artifact.code); const sandbox=syntax.ok?await smokeTestPython(artifact.code):{ok:false,error:'Skipped because syntax or policy validation failed',mode:'restricted import smoke test'}; lastArtifact={...artifact,responseId:result.responseId,verification:{attempt,scan,syntax,sandbox,preview}}; if(syntax.ok&&scan.errors.length===0&&sandbox.ok&&preview.ok)return lastArtifact; feedback=[syntax.error,...scan.errors,sandbox.error,...preview.errors].filter(Boolean).join('\n'); } const error=new Error(`Codem8s could not produce a validated program: ${lastArtifact?.verification?.sandbox?.error||lastArtifact?.verification?.syntax?.error||lastArtifact?.verification?.preview?.errors?.join('; ')||'unknown validation failure'}`); error.artifact=lastArtifact; throw error; }

module.exports={CODE_SCHEMA,BLOCKED_PATTERNS,PREVIEW_BLOCKED,safeFilename,scanPython,scanPreview,validatePythonSyntax,smokeTestPython,buildCodeApp};