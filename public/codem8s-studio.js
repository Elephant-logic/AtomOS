(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let codeArtifact = null;
  const $ = id => document.getElementById(id);

  function download(name, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  }

  function renderArtifact(artifact) {
    codeArtifact = artifact;
    const canvas = $('canvas');
    if (!canvas) return;
    const shell = document.createElement('div');
    shell.innerHTML = `
      <div class="library-card" style="margin-bottom:12px">
        <h2>${artifact.title || 'Code application'}</h2>
        <p class="muted">${artifact.filename} · Python · syntax ${artifact.verification?.syntax?.ok ? 'passed' : 'failed'} · attempt ${artifact.verification?.attempt || 1}</p>
        <div class="row">
          <button id="codem8sDownload" class="good">Download .py</button>
          <button id="codem8sCopy">Copy code</button>
          <button id="codem8sAnalyze">Analyze parts</button>
        </div>
      </div>
      <h3>Verification</h3>
      <pre>${JSON.stringify(artifact.verification || {}, null, 2)}</pre>
      <h3>Generated code</h3>
      <pre id="codem8sCode" style="max-height:560px">${String(artifact.code || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
      <h3>Planned tests</h3>
      <pre>${JSON.stringify(artifact.tests || [], null, 2)}</pre>`;
    canvas.replaceChildren(shell);
    $('codem8sDownload').onclick = () => download(artifact.filename || 'codem8s_app.py', artifact.code || '', 'text/x-python');
    $('codem8sCopy').onclick = () => navigator.clipboard.writeText(artifact.code || '');
    $('codem8sAnalyze').onclick = analyzeCurrent;
  }

  async function analyzeCurrent() {
    if (!codeArtifact?.code) return;
    const response = await fetch('/api/code-analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: codeArtifact.code })
    });
    const data = await response.json();
    if (!response.ok) return typeof log === 'function' && log(data.error || 'Analysis failed', 'bad');
    if (typeof log === 'function') log(`Code analysis: ${data.analysis.functions.length} functions · ${data.analysis.classes.length} classes · ${data.analysis.dependencies.length} imports.`, 'ok');
    const inspector = $('inspectorBody');
    if (inspector) inspector.innerHTML = `<h3>Codem8s parts</h3><pre>${JSON.stringify(data.analysis, null, 2)}</pre>`;
  }

  async function buildCode() {
    const prompt = $('prompt')?.value.trim();
    if (!prompt || prompt.length < 3) return typeof log === 'function' && log('Enter a clearer code request.', 'bad');
    const button = $('codem8sBuild');
    button.disabled = true;
    button.textContent = 'Generating and validating…';
    if (typeof log === 'function') log('Codem8s: generating one-file Python program…');
    try {
      const response = await fetch('/api/code-build', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Code build failed');
      renderArtifact(data.artifact);
      if (typeof log === 'function') log(`Codem8s built ${data.artifact.filename}; syntax and policy checks passed.`, 'ok');
    } catch (error) {
      if (typeof log === 'function') log(error.message, 'bad');
    } finally {
      button.disabled = false;
      button.textContent = 'Build code app';
    }
  }

  function mount() {
    const build = $('build');
    if (!build || $('codem8sBuild')) return false;
    const button = document.createElement('button');
    button.id = 'codem8sBuild';
    button.textContent = 'Build code app';
    button.title = 'Generate a validated one-file Python program with Codem8s';
    button.onclick = buildCode;
    build.parentElement?.appendChild(button);

    const examples = document.querySelector('.examples');
    if (examples) {
      const sample = document.createElement('button');
      sample.textContent = 'Python tool';
      sample.onclick = () => {
        $('prompt').value = 'Build a one-file Python desktop CSV inventory manager with import, search, edit, delete and export features using Tkinter and the standard library.';
      };
      examples.appendChild(sample);
    }
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => { attempts++; if (mount() || attempts > 60) clearInterval(timer); }, 100);
  window.AtomOSCodem8s = { buildCode, analyzeCurrent, artifact: () => codeArtifact };
})();
