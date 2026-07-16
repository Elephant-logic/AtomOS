(() => {
  'use strict';

  const LIBRARY_KEY = 'atomos-atom-factory-v1';
  const REFINERY_KEY = 'atomos-refinery-library';
  const MAX_MEMORY_ITEMS = 24;

  function slug(value) {
    return String(value || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
  }

  function load(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function saveLibrary(value) {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(value.slice(-500)));
  }

  function signature(item) {
    return `${item.level || 'atom'}:${item.kind || 'unknown'}:${slug(item.name || item.id)}`;
  }

  function mergeItem(library, candidate) {
    const sig = signature(candidate);
    const existing = library.find(item => item.signature === sig);
    if (existing) {
      existing.seen = Number(existing.seen || 1) + 1;
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0));
      existing.connectors = existing.connectors || { inputs: [], outputs: [] };
      existing.connectors.inputs = [...new Set([...(existing.connectors.inputs || []), ...(candidate.connectors?.inputs || [])])].slice(0, 30);
      existing.connectors.outputs = [...new Set([...(existing.connectors.outputs || []), ...(candidate.connectors?.outputs || [])])].slice(0, 30);
      existing.sources = [...new Set([...(existing.sources || []), ...(candidate.sources || []), candidate.file, candidate.sourceFile].filter(Boolean))].slice(0, 20);
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    const item = {
      id: candidate.id || slug(candidate.name),
      name: candidate.name || candidate.id,
      level: candidate.level || 'atom',
      kind: candidate.kind || 'unknown',
      confidence: Number(candidate.confidence || 0.5),
      connectors: candidate.connectors || { inputs: [], outputs: [] },
      atomIds: candidate.atomIds || [],
      sources: [candidate.file, candidate.sourceFile].filter(Boolean),
      status: Number(candidate.confidence || 0) >= 0.82 ? 'approved' : 'review',
      seen: 1,
      signature: sig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    library.push(item);
    return item;
  }

  function learnRefinery() {
    const imports = load(REFINERY_KEY);
    const library = load(LIBRARY_KEY);
    let learned = 0;
    for (const result of imports) {
      for (const atom of result.reusableLibrary || result.atoms || []) {
        mergeItem(library, { ...atom, level: 'atom' }); learned++;
      }
      for (const molecule of result.molecules || []) {
        mergeItem(library, { ...molecule, level: 'molecule' }); learned++;
      }
    }
    saveLibrary(library);
    return learned;
  }

  function learnCurrentApp() {
    if (!window.currentApp && typeof currentApp === 'undefined') return 0;
    const app = window.currentApp || currentApp;
    if (!app) return 0;
    const library = load(LIBRARY_KEY);
    for (const component of app.components || []) {
      mergeItem(library, {
        id: component.id,
        name: component.label || component.text || component.id,
        level: 'atom',
        kind: `ui.${component.type}`,
        confidence: 1,
        connectors: { inputs: component.bind ? [component.bind] : [], outputs: component.event ? [`event:${component.event}`] : [] },
        sourceFile: app.title
      });
    }
    for (const capability of app.capabilities || []) {
      mergeItem(library, {
        id: capability.id,
        name: capability.id,
        level: 'atom',
        kind: `capability.${capability.type}`,
        confidence: 1,
        connectors: { inputs: [capability.enabledWhen, ...(capability.stateKeys || [])].filter(Boolean), outputs: [capability.event].filter(Boolean).map(x => `event:${x}`) },
        sourceFile: app.title
      });
    }
    mergeItem(library, {
      id: slug(app.title), name: app.title, level: 'molecule', kind: 'application.pattern', confidence: 1,
      atomIds: [...(app.components || []).map(x => x.id), ...(app.capabilities || []).map(x => x.id)],
      connectors: { inputs: [], outputs: (app.rules || []).map(x => `event:${x.event}`).slice(0, 30) }, sourceFile: app.title
    });
    saveLibrary(library);
    return (app.components || []).length + (app.capabilities || []).length + 1;
  }

  function memorySummary() {
    return load(LIBRARY_KEY)
      .filter(item => item.status === 'approved')
      .sort((a, b) => (b.seen || 0) - (a.seen || 0) || (b.confidence || 0) - (a.confidence || 0))
      .slice(0, MAX_MEMORY_ITEMS)
      .map(item => `${item.level}:${item.name} [${item.kind}] inputs(${(item.connectors?.inputs || []).join('|')}) outputs(${(item.connectors?.outputs || []).join('|')})`)
      .join('\n');
  }

  function installBuildMemory() {
    if (typeof request !== 'function' || request.__atomFactoryWrapped) return;
    const original = request;
    request = async function requestWithFactoryMemory(editing) {
      const enabled = document.getElementById('useFactoryMemory')?.checked !== false;
      const field = document.getElementById('prompt');
      const originalPrompt = field?.value || '';
      const memory = enabled ? memorySummary() : '';
      if (field && memory) {
        field.value = `${originalPrompt}\n\nATOMOS REUSABLE LIBRARY MEMORY:\n${memory}\nPrefer these compatible atoms and molecules. Preserve their connector contracts when useful. Do not mention this memory in the app.`;
      }
      try { return await original(editing); }
      finally { if (field) field.value = originalPrompt; }
    };
    request.__atomFactoryWrapped = true;
    const build = document.getElementById('build');
    const edit = document.getElementById('edit');
    if (build) build.onclick = () => request(false);
    if (edit) edit.onclick = () => request(true);
  }

  function setStatus(id, status) {
    const library = load(LIBRARY_KEY);
    const item = library.find(x => x.id === id || x.signature === id);
    if (item) { item.status = status; item.updatedAt = new Date().toISOString(); saveLibrary(library); }
    renderFactory();
  }

  function addToPrompt(item) {
    const field = document.getElementById('prompt');
    if (!field) return;
    const contract = `Use the reusable ${item.level} "${item.name}" (${item.kind}). Inputs: ${(item.connectors?.inputs || []).join(', ') || 'none'}. Outputs: ${(item.connectors?.outputs || []).join(', ') || 'none'}.`;
    field.value = `${field.value.trim()}\n\n${contract}`.trim();
    field.focus();
  }

  function renderGraph(host, items) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;min-width:720px;min-height:460px';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    wrap.appendChild(svg);
    const molecules = items.filter(x => x.level === 'molecule').slice(0, 8);
    const atoms = items.filter(x => x.level === 'atom').slice(0, 18);
    const nodes = new Map();
    function node(item, x, y) {
      const el = document.createElement('div');
      el.className = 'graph-node'; el.style.left = x + 'px'; el.style.top = y + 'px';
      el.innerHTML = `<b>${item.name}</b><small>${item.kind}</small><div class="port"><span>${item.status}</span><span>seen ${item.seen || 1}</span></div>`;
      el.onclick = () => addToPrompt(item); wrap.appendChild(el); nodes.set(item.id, el);
    }
    molecules.forEach((m, i) => node(m, 25, 20 + i * 105));
    atoms.forEach((a, i) => node(a, 330 + (i % 2) * 205, 20 + Math.floor(i / 2) * 95));
    setTimeout(() => {
      for (const molecule of molecules) {
        const from = nodes.get(molecule.id); if (!from) continue;
        for (const atomId of molecule.atomIds || []) {
          const to = nodes.get(atomId); if (!to) continue;
          const ar = from.getBoundingClientRect(), br = to.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const x1 = ar.right - wr.left, y1 = ar.top + ar.height / 2 - wr.top, x2 = br.left - wr.left, y2 = br.top + br.height / 2 - wr.top;
          path.setAttribute('d', `M${x1},${y1} C${x1+70},${y1} ${x2-70},${y2} ${x2},${y2}`); path.setAttribute('class', 'edge'); svg.appendChild(path);
        }
      }
    });
    host.appendChild(wrap);
  }

  function renderFactory() {
    const canvas = document.getElementById('canvas');
    if (!canvas || window.__atomFactoryView !== true) return;
    canvas.replaceChildren();
    const library = load(LIBRARY_KEY);
    const top = document.createElement('div'); top.className = 'row'; top.style.marginTop = '0';
    top.innerHTML = `<button id="learnImports" class="primary">Learn saved code</button><button id="learnApp">Learn current app</button><button id="downloadFactory">Download library</button><button id="clearFactory" class="danger">Clear library</button><label class="muted" style="display:flex;align-items:center;gap:6px"><input id="useFactoryMemory" type="checkbox" checked> Use library when building</label>`;
    canvas.appendChild(top);
    const summary = document.createElement('div'); summary.className = 'log';
    summary.textContent = `${library.length} reusable parts · ${library.filter(x=>x.status==='approved').length} approved · ${library.filter(x=>x.status==='review').length} awaiting review`;
    canvas.appendChild(summary);
    renderGraph(canvas, library.filter(x => x.status !== 'rejected'));
    const grid = document.createElement('div'); grid.className = 'library'; grid.style.marginTop = '12px';
    for (const item of library.slice().sort((a,b)=>b.confidence-a.confidence).slice(0, 60)) {
      const card = document.createElement('div'); card.className = 'library-card';
      card.innerHTML = `<h2>${item.name}</h2><p class="muted">${item.level} · ${item.kind} · ${Math.round((item.confidence || 0)*100)}% · seen ${item.seen || 1}</p><div class="muted">in: ${(item.connectors?.inputs || []).join(', ') || 'none'}<br>out: ${(item.connectors?.outputs || []).join(', ') || 'none'}</div>`;
      const row = document.createElement('div'); row.className = 'row';
      const use = document.createElement('button'); use.textContent = 'Use'; use.onclick = () => addToPrompt(item);
      const approve = document.createElement('button'); approve.textContent = 'Approve'; approve.className = 'good'; approve.onclick = () => setStatus(item.signature, 'approved');
      const reject = document.createElement('button'); reject.textContent = 'Reject'; reject.className = 'danger'; reject.onclick = () => setStatus(item.signature, 'rejected');
      row.append(use, approve, reject); card.appendChild(row); grid.appendChild(card);
    }
    canvas.appendChild(grid);
    document.getElementById('learnImports').onclick = () => { const n = learnRefinery(); if (typeof log === 'function') log(`Atom Factory learned ${n} extracted parts.`, 'ok'); renderFactory(); };
    document.getElementById('learnApp').onclick = () => { const n = learnCurrentApp(); if (typeof log === 'function') log(`Atom Factory learned ${n} parts from the current app.`, 'ok'); renderFactory(); };
    document.getElementById('downloadFactory').onclick = () => { const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(load(LIBRARY_KEY),null,2)],{type:'application/json'}));a.download='atomos-atom-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500); };
    document.getElementById('clearFactory').onclick = () => { if (confirm('Clear the reusable Atom Factory library on this device?')) { localStorage.removeItem(LIBRARY_KEY); renderFactory(); } };
  }

  function mount() {
    const tabs = document.querySelector('.tabs');
    if (!tabs || document.getElementById('factoryTab')) return;
    const tab = document.createElement('button'); tab.id = 'factoryTab'; tab.className = 'tab'; tab.textContent = 'Factory';
    tab.onclick = () => {
      window.__atomFactoryView = true;
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
      renderFactory();
    };
    tabs.insertBefore(tab, tabs.lastElementChild);
    document.querySelectorAll('.tab:not(#factoryTab)').forEach(existing => existing.addEventListener('click', () => { window.__atomFactoryView = false; }));
    installBuildMemory();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.AtomFactory = { learnRefinery, learnCurrentApp, memorySummary, renderFactory };
})();