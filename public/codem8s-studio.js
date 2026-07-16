(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const STORE = 'atomos-codem8s-last-artifact-v1';
  let codeArtifact = null;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

  try { codeArtifact = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch {}

  function download(name, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }

  function renderArtifact(artifact = codeArtifact) {
    if (!artifact) return;
    codeArtifact = artifact;
    try { sessionStorage.setItem(STORE, JSON.stringify(artifact)); } catch {}
    const canvas = $('canvas'); if (!canvas) return;
    const sandbox = artifact.verification?.sandbox || {};
    const shell = document.createElement('div');
    shell.dataset.codem8sArtifact = 'true';
    shell.innerHTML = `
      <div class="library-card" style="margin-bottom:12px">
        <h2>${escapeHtml(artifact.title || 'Code application')}</h2>
        <p class="muted">${escapeHtml(artifact.filename)} · Python · syntax ${artifact.verification?.syntax?.ok ? 'passed' : 'failed'} · sandbox ${sandbox.ok ? 'passed' : 'failed'} · attempt ${artifact.verification?.attempt || 1}</p>
        <div class="row">
          <button id="codem8sDownload" class="good">Download .py</button>
          <button id="codem8sCopy">Copy code</button>
          <button id="codem8sAnalyze">Analyze parts</button>
        </div>
      </div>
      <h3>Verification</h3><pre>${escapeHtml(JSON.stringify(artifact.verification || {}, null, 2))}</pre>
      <p class="muted">The restricted sandbox imports the program in a temporary directory with a stripped environment and timeout. Desktop windows are not opened or clicked on Render.</p>
      <h3>Generated code</h3><pre id="codem8sCode" style="max-height:560px">${escapeHtml(artifact.code || '')}</pre>
      <h3>Planned tests</h3><pre>${escapeHtml(JSON.stringify(artifact.tests || [], null, 2))}</pre>`;
    canvas.replaceChildren(shell);
    $('codem8sDownload')?.addEventListener('click', () => download(artifact.filename || 'codem8s_app.py', artifact.code || '', 'text/x-python'));
    $('codem8sCopy')?.addEventListener('click', async () => { await navigator.clipboard.writeText(artifact.code || ''); if (typeof log === 'function') log('Code copied.', 'ok'); });
    $('codem8sAnalyze')?.addEventListener('click', analyzeCurrent);
  }

  async function analyzeCurrent() {
    if (!codeArtifact?.code) return;
    const response = await fetch('/api/code-analyze', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({code:codeArtifact.code}) });
    const data = await response.json();
    if (!response.ok) return typeof log === 'function' && log(data.error || 'Analysis failed', 'bad');
    if (typeof log === 'function') log(`Code analysis: ${data.analysis.functions.length} functions · ${data.analysis.classes.length} classes · ${data.analysis.dependencies.length} imports.`, 'ok');
    const inspector = $('inspectorBody'); if (inspector) inspector.innerHTML = `<h3>Codem8s parts</h3><pre>${escapeHtml(JSON.stringify(data.analysis,null,2))}</pre>`;
  }

  async function buildCode() {
    const prompt = $('prompt')?.value.trim();
    if (!prompt || prompt.length < 3) return typeof log === 'function' && log('Enter a clearer code request.', 'bad');
    const button = $('codem8sBuild');
    if (button) { button.disabled = true; button.textContent = 'Generating, sandboxing and validating…'; }
    if (typeof log === 'function') log('Codem8s: generating and checking a one-file Python program…');
    try {
      const response = await fetch('/api/code-build', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt}) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Code build failed');
      renderArtifact(data.artifact);
      if (typeof log === 'function') log(`Codem8s built ${data.artifact.filename}; policy, syntax and restricted sandbox checks passed.`, 'ok');
    } catch (error) { if (typeof log === 'function') log(error.message, 'bad'); }
    finally { const live=$('codem8sBuild'); if(live){live.disabled=false;live.textContent='Build code app';} mount(); }
  }

  function mount() {
    const build = $('build');
    if (build && !$('codem8sBuild')) {
      const button=document.createElement('button'); button.id='codem8sBuild'; button.textContent='Build code app'; button.title='Generate, validate and smoke-test a one-file Python program'; button.onclick=buildCode; build.parentElement?.appendChild(button);
    }
    const tabs=document.querySelector('.tabs');
    if (tabs && !$('codem8sResult')) {
      const result=document.createElement('button'); result.id='codem8sResult'; result.className='tab'; result.textContent='Code result'; result.title='Reopen the latest Codem8s result'; result.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===result));renderArtifact();}; tabs.appendChild(result);
    }
    const examples=document.querySelector('.examples');
    if (examples && !document.querySelector('[data-codem8s-example]')) {
      const sample=document.createElement('button'); sample.dataset.codem8sExample='true'; sample.textContent='Python tool'; sample.onclick=()=>{const p=$('prompt');if(p)p.value='Build a one-file Python desktop CSV inventory manager with import, search, edit, delete and export features using Tkinter and the standard library.';}; examples.appendChild(sample);
    }
    return Boolean($('codem8sBuild'));
  }

  mount();
  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.AtomOSCodem8s = { buildCode, analyzeCurrent, renderArtifact, artifact:() => codeArtifact };
})();