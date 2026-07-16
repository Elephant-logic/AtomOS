(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const STORE = 'atomos-fullstack-project-v1';
  let project = null;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  try { project = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}

  function save() {
    if (!project) return;
    localStorage.setItem(STORE, JSON.stringify(project));
  }

  function analyseArtifact(artifact) {
    const pythonFunctions = [...String(artifact.code || '').matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)].map(x => x[1]);
    const browserHandlers = [...String(artifact.previewHtml || '').matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g)].map(x => x[1] || x[2]).filter(Boolean);
    const nodes = [
      { id:'browser-app', kind:'frontend.application', label:'Browser application', file:'frontend/index.html', provides:['ui:application','event:user-actions'], requires:['contract:application-data'], status:'tested' },
      { id:'python-app', kind:'backend.application', label:'Python application', file:`backend/${artifact.filename || 'app.py'}`, provides:['contract:application-data'], requires:['storage:local'], status:artifact.verification?.syntax?.ok ? 'tested' : 'generated' }
    ];
    pythonFunctions.slice(0, 20).forEach(name => nodes.push({ id:`py-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`, kind:'logic.function', label:name, file:`backend/${artifact.filename || 'app.py'}`, provides:[`function:${name}`], requires:[], status:'generated' }));
    browserHandlers.slice(0, 20).forEach(name => nodes.push({ id:`web-${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`, kind:'frontend.function', label:name, file:'frontend/index.html', provides:[`function:${name}`], requires:[], status:'generated' }));
    return nodes;
  }

  function makeProject(prompt, artifact, previous = null) {
    const version = (previous?.version || 0) + 1;
    const nodes = analyseArtifact(artifact);
    const edges = [{ from:'browser-app', to:'python-app', connector:'contract:application-data', status:'connected' }];
    const suggestions = [
      'Add persistent database storage and migration support',
      'Add an HTTP API contract between the browser and backend',
      'Add authentication and user-specific data',
      'Add integration tests for the complete user journey'
    ];
    return {
      atomosProjectVersion:'0.1',
      id: previous?.id || `project-${Date.now()}`,
      title: artifact.title || 'Full-stack project',
      request: prompt,
      version,
      stack:['Browser HTML/CSS/JavaScript','Python'],
      files:[
        { path:'frontend/index.html', language:'html', purpose:'Interactive browser frontend', content:artifact.previewHtml || '' },
        { path:`backend/${artifact.filename || 'app.py'}`, language:'python', purpose:'Python application and business logic', content:artifact.code || '' }
      ],
      nodes,
      edges,
      tests:artifact.tests || [],
      suggestions,
      artifact,
      history:[...(previous?.history || []).slice(-19), { version, at:new Date().toISOString(), request:prompt }]
    };
  }

  function downloadProject() {
    if (!project) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type:'application/json' }));
    link.download = `${String(project.title || 'atomos-project').toLowerCase().replace(/[^a-z0-9]+/g,'-')}.atomos-project.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 800);
  }

  function renderProject() {
    if (!project) return;
    const canvas = $('canvas'); if (!canvas) return;
    const shell = document.createElement('div'); shell.dataset.fullstackProject = 'true';
    shell.innerHTML = `<div class="library-card"><h2>${escapeHtml(project.title)}</h2><p class="muted">Full-stack project v${project.version} · ${project.files.length} files · ${project.nodes.length} graph nodes · ${project.edges.length} connection(s)</p><div class="row"><button id="fullstackPreview" class="good">Run browser app</button><button id="fullstackGraph">Project graph</button><button id="fullstackFiles">Files</button><button id="fullstackNext">Build suggested next bit</button><button id="fullstackDownload">Download project map</button></div></div><div id="fullstackView"></div>`;
    canvas.replaceChildren(shell);

    const showPreview = () => {
      const host = $('fullstackView'); if (!host) return;
      host.innerHTML = '<h3>Frontend runtime</h3><p class="muted">The browser frontend runs separately from the Python target. Their shared contract is represented in the project graph.</p>';
      const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts allow-forms allow-modals allow-downloads'; frame.referrerPolicy = 'no-referrer'; frame.style.cssText = 'width:100%;min-height:680px;border:1px solid var(--line,#444);border-radius:12px;background:white'; frame.srcdoc = project.files.find(x => x.path === 'frontend/index.html')?.content || ''; host.appendChild(frame);
    };
    const showGraph = () => {
      const host = $('fullstackView'); if (!host) return;
      host.innerHTML = `<h3>Molecule project graph</h3><p class="muted">Nodes describe files and functions. Connections describe the contracts they require and provide.</p>`;
      const graph = document.createElement('div'); graph.className = 'library';
      for (const node of project.nodes) {
        const card = document.createElement('div'); card.className = 'library-card';
        const outgoing = project.edges.filter(edge => edge.from === node.id);
        card.innerHTML = `<h2>${escapeHtml(node.label)}</h2><p class="muted">${escapeHtml(node.kind)} · ${escapeHtml(node.file)} · ${escapeHtml(node.status)}</p><div class="muted">provides: ${escapeHtml(node.provides.join(', ') || 'none')}<br>requires: ${escapeHtml(node.requires.join(', ') || 'none')}<br>connections: ${escapeHtml(outgoing.map(x => `${x.connector} → ${x.to}`).join(', ') || 'none')}</div>`;
        graph.appendChild(card);
      }
      host.appendChild(graph);
      const suggestions = document.createElement('div'); suggestions.className = 'library-card'; suggestions.innerHTML = `<h2>Suggested next pieces</h2><ol>${project.suggestions.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>`; host.appendChild(suggestions);
    };
    const showFiles = () => {
      const host = $('fullstackView'); if (!host) return;
      host.innerHTML = '<h3>Project files</h3>';
      for (const file of project.files) {
        const card = document.createElement('div'); card.className = 'library-card'; card.innerHTML = `<h2>${escapeHtml(file.path)}</h2><p class="muted">${escapeHtml(file.language)} · ${escapeHtml(file.purpose)}</p><pre style="max-height:420px">${escapeHtml(file.content)}</pre>`; host.appendChild(card);
      }
    };
    $('fullstackPreview')?.addEventListener('click', showPreview);
    $('fullstackGraph')?.addEventListener('click', showGraph);
    $('fullstackFiles')?.addEventListener('click', showFiles);
    $('fullstackNext')?.addEventListener('click', buildNext);
    $('fullstackDownload')?.addEventListener('click', downloadProject);
    showGraph();
  }

  async function requestArtifact(prompt) {
    const response = await fetch('/api/code-build', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ prompt }) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Full-stack build failed');
    return data.artifact;
  }

  async function buildFullStack() {
    const request = $('prompt')?.value.trim();
    if (!request || request.length < 3) return typeof log === 'function' && log('Enter a full-stack application request.', 'bad');
    const button = $('fullstackBuild'); if (button) { button.disabled = true; button.textContent = 'Building first vertical slice…'; }
    if (typeof log === 'function') log('Full stack: building a connected browser and Python project slice…');
    try {
      const augmented = `${request}\n\nBuild this as the first working vertical slice of a full-stack project. The Python file is the backend/business-logic target. The browser preview is the frontend target. Keep shared data names and behaviour aligned across both. Do not add unrelated date fields or features.`;
      const artifact = await requestArtifact(augmented);
      project = makeProject(request, artifact, null); save(); renderProject();
      if (typeof log === 'function') log(`Full-stack project created with ${project.files.length} files and ${project.nodes.length} graph nodes.`, 'ok');
    } catch (error) { if (typeof log === 'function') log(error.message, 'bad'); }
    finally { const live = $('fullstackBuild'); if (live) { live.disabled = false; live.textContent = 'Build full stack'; } mount(); }
  }

  async function buildNext() {
    if (!project) return;
    const suggestion = project.suggestions[0] || 'Add the next missing tested capability';
    if (typeof log === 'function') log(`Incremental build: ${suggestion}…`);
    try {
      const context = project.files.map(file => `FILE ${file.path}:\n${file.content}`).join('\n\n').slice(0, 28000);
      const artifact = await requestArtifact(`Existing full-stack project:\n${context}\n\nIncremental change: ${suggestion}. Preserve all working behaviour. Return the complete updated Python target and complete updated browser frontend. Keep their contracts aligned.`);
      project = makeProject(suggestion, artifact, project); project.suggestions = project.suggestions.slice(1).concat('Review the graph and add the next missing vertical feature'); save(); renderProject();
      if (typeof log === 'function') log(`Project updated to version ${project.version}.`, 'ok');
    } catch (error) { if (typeof log === 'function') log(error.message, 'bad'); }
  }

  function mount() {
    const codeButton = $('codem8sBuild');
    if (codeButton && !$('fullstackBuild')) {
      const button = document.createElement('button'); button.id = 'fullstackBuild'; button.textContent = 'Build full stack'; button.title = 'Build a connected browser and Python project, graph its files and suggest the next vertical slice'; button.onclick = buildFullStack; codeButton.parentElement?.insertBefore(button, codeButton.nextSibling);
    }
    const tabs = document.querySelector('.tabs');
    if (tabs && !$('fullstackResult')) { const tab = document.createElement('button'); tab.id = 'fullstackResult'; tab.className = 'tab'; tab.textContent = 'Full stack'; tab.onclick = () => renderProject(); tabs.appendChild(tab); }
    return Boolean($('fullstackBuild'));
  }

  mount();
  const observer = new MutationObserver(mount); observer.observe(document.documentElement, { childList:true, subtree:true });
  window.AtomOSFullStack = { buildFullStack, buildNext, renderProject, project:() => project };
})();
