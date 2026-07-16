(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const STORE = 'atomos-codem8s-last-artifact-v2';
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

  function renderArtifact(artifact = codeArtifact, view = 'preview') {
    if (!artifact) return;
    codeArtifact = artifact;
    try { sessionStorage.setItem(STORE, JSON.stringify(artifact)); } catch {}
    const canvas = $('canvas'); if (!canvas) return;
    const sandbox = artifact.verification?.sandbox || {};
    const preview = artifact.verification?.preview || {};
    const shell = document.createElement('div'); shell.dataset.codem8sArtifact = 'true';
    shell.innerHTML = `
      <div class="library-card" style="margin-bottom:12px">
        <h2>${escapeHtml(artifact.title || 'Code application')}</h2>
        <p class="muted">${escapeHtml(artifact.filename)} · Python syntax ${artifact.verification?.syntax?.ok ? 'passed' : 'failed'} · smoke sandbox ${sandbox.ok ? 'passed' : 'failed'} · browser preview ${preview.ok ? 'passed' : 'failed'} · attempt ${artifact.verification?.attempt || 1}</p>
        <div class="row">
          <button id="codem8sPreview" class="good">Display app</button>
          <button id="codem8sSource">View source</button>
          <button id="codem8sDownload">Download .py</button>
          <button id="codem8sCopy">Copy code</button>
          <button id="codem8sAnalyze">Analyze parts</button>
        </div>
      </div>
      <div id="codem8sView"></div>`;
    canvas.replaceChildren(shell);

    const showPreview = () => {
      const host = $('codem8sView'); if (!host) return;
      host.innerHTML = `<h3>Interactive browser display</h3><p class="muted">This sandboxed display mirrors the Python app's intended interface and behaviour. The downloaded Python file remains the desktop application.</p>`;
      const frame = document.createElement('iframe');
      frame.title = `${artifact.title || 'Codem8s'} preview`;
      frame.sandbox = 'allow-scripts allow-forms allow-modals allow-downloads';
      frame.referrerPolicy = 'no-referrer';
      frame.style.cssText = 'width:100%;min-height:640px;border:1px solid var(--line,#444);border-radius:12px;background:white';
      frame.srcdoc = artifact.previewHtml || '<!doctype html><html><body><p>No preview was generated.</p></body></html>';
      host.appendChild(frame);
    };
    const showSource = () => {
      const host = $('codem8sView'); if (!host) return;
      host.innerHTML = `<h3>Verification</h3><pre>${escapeHtml(JSON.stringify(artifact.verification || {}, null, 2))}</pre><h3>Generated Python</h3><pre id="codem8sCode" style="max-height:620px">${escapeHtml(artifact.code || '')}</pre><h3>Planned tests</h3><pre>${escapeHtml(JSON.stringify(artifact.tests || [], null, 2))}</pre>`;
    };

    $('codem8sPreview')?.addEventListener('click', showPreview);
    $('codem8sSource')?.addEventListener('click', showSource);
    $('codem8sDownload')?.addEventListener('click', () => download(artifact.filename || 'codem8s_app.py', artifact.code || '', 'text/x-python'));
    $('codem8sCopy')?.addEventListener('click', async () => { await navigator.clipboard.writeText(artifact.code || ''); if (typeof log === 'function') log('Code copied.', 'ok'); });
    $('codem8sAnalyze')?.addEventListener('click', analyzeCurrent);
    view === 'source' ? showSource() : showPreview();
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
    if (button) { button.disabled = true; button.textContent = 'Generating, testing and creating display…'; }
    if (typeof log === 'function') log('Codem8s: generating Python and a sandboxed browser display…');
    try {
      const response = await fetch('/api/code-build', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt}) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Code build failed');
      renderArtifact(data.artifact, 'preview');
      if (typeof log === 'function') log(`Codem8s built and displayed ${data.artifact.filename}; policy, syntax, smoke sandbox and preview checks passed.`, 'ok');
    } catch (error) { if (typeof log === 'function') log(error.message, 'bad'); }
    finally { const live=$('codem8sBuild'); if(live){live.disabled=false;live.textContent='Build code app';} mount(); }
  }

  function mount() {
    const build = $('build');
    if (build && !$('codem8sBuild')) { const button=document.createElement('button'); button.id='codem8sBuild'; button.textContent='Build code app'; button.title='Generate Python, verify it and display an interactive browser preview'; button.onclick=buildCode; build.parentElement?.appendChild(button); }
    const tabs=document.querySelector('.tabs');
    if (tabs && !$('codem8sResult')) { const result=document.createElement('button'); result.id='codem8sResult'; result.className='tab'; result.textContent='Code app'; result.title='Reopen the latest Codem8s app and interactive display'; result.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===result));renderArtifact();}; tabs.appendChild(result); }
    const examples=document.querySelector('.examples');
    if (examples && !document.querySelector('[data-codem8s-example]')) { const sample=document.createElement('button'); sample.dataset.codem8sExample='true'; sample.textContent='Python tool'; sample.onclick=()=>{const p=$('prompt');if(p)p.value='Build a one-file Python desktop CSV inventory manager with import, search, edit, delete and export features using Tkinter and the standard library.';}; examples.appendChild(sample); }
    return Boolean($('codem8sBuild'));
  }

  mount();
  const observer = new MutationObserver(() => mount()); observer.observe(document.documentElement, { childList:true, subtree:true });
  window.AtomOSCodem8s = { buildCode, analyzeCurrent, renderArtifact, artifact:() => codeArtifact };
})();