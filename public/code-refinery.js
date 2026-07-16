(() => {
  'use strict';

  const MAX_FILES = 40;
  const MAX_TOTAL = 600000;
  const TEXT_EXTENSIONS = new Set(['js','jsx','ts','tsx','mjs','cjs','html','htm','css','scss','json','md','py','java','kt','swift','go','rs','php','vue','svelte']);
  let refineryResult = null;

  function slugify(value) {
    return String(value || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
  }

  function extension(name) {
    return String(name).split('.').pop().toLowerCase();
  }

  function languageFor(name) {
    const ext = extension(name);
    const map = { js:'javascript', jsx:'react', ts:'typescript', tsx:'react-typescript', mjs:'javascript', cjs:'javascript', html:'html', htm:'html', css:'css', scss:'scss', json:'json', md:'markdown', py:'python', java:'java', kt:'kotlin', swift:'swift', go:'go', rs:'rust', php:'php', vue:'vue', svelte:'svelte' };
    return map[ext] || ext || 'text';
  }

  function unique(items, key = x => x) {
    const seen = new Set();
    return items.filter(item => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
  }

  function matches(source, regex, mapper) {
    const out = [];
    for (const match of source.matchAll(regex)) out.push(mapper(match));
    return out;
  }

  function inferConnectors(source, name) {
    const inputs = unique([
      ...matches(source, /\b(?:props\.|props\[['"])([A-Za-z_$][\w$]*)/g, m => m[1]),
      ...matches(source, /\bfunction\s+\w*\s*\(([^)]*)\)/g, m => m[1].split(',').map(x => x.trim()).filter(Boolean)).flat(),
      ...matches(source, /\b(?:on|handle)([A-Z][A-Za-z0-9_]*)\b/g, m => 'event:' + m[1].toLowerCase())
    ]).slice(0, 12);
    const outputs = unique([
      ...matches(source, /\b(?:dispatch|emit)\s*\(\s*['"]([^'"]+)/g, m => 'event:' + m[1]),
      ...matches(source, /\breturn\s+([A-Za-z_$][\w$]*)/g, m => 'returns:' + m[1]),
      ...(name ? ['provides:' + name] : [])
    ]).slice(0, 12);
    return { inputs, outputs };
  }

  function atom(id, kind, file, source, confidence = 0.75, extra = {}) {
    const connectors = inferConnectors(source, id);
    return { id: slugify(id), name: id, kind, file, confidence, connectors, source: source.slice(0, 12000), ...extra };
  }

  function analyseFile(file) {
    const { name, content } = file;
    const lang = languageFor(name);
    const atoms = [];

    if (/^(javascript|typescript|react|react-typescript|vue|svelte)$/.test(lang)) {
      for (const m of content.matchAll(/(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) atoms.push(atom(m[1], /^[A-Z]/.test(m[1]) ? 'ui.component' : 'logic.function', name, m[0], 0.9));
      for (const m of content.matchAll(/(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)[^\{]*\{/g)) atoms.push(atom(m[1], 'logic.class', name, m[0], 0.9));
      for (const m of content.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) atoms.push(atom(m[1], /^[A-Z]/.test(m[1]) ? 'ui.component' : 'logic.function', name, m[0], 0.82));
      for (const m of content.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)/g)) atoms.push(atom(`${m[1].toUpperCase()} ${m[2]}`, 'api.route', name, m[0], 0.95, { method:m[1].toUpperCase(), path:m[2] }));
      for (const m of content.matchAll(/\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*['"`]([^'"`]+)/g)) atoms.push(atom(`API ${m[1]}`, 'api.client', name, m[0], 0.85, { endpoint:m[1] }));
      if (/localStorage|sessionStorage/.test(content)) atoms.push(atom('Browser Storage', 'capability.storage', name, 'localStorage/sessionStorage usage', 0.92));
      if (/setInterval|setTimeout/.test(content)) atoms.push(atom('Timer', 'capability.timer', name, 'setInterval/setTimeout usage', 0.9));
      if (/addEventListener\s*\(\s*['"](?:keydown|keyup)/.test(content)) atoms.push(atom('Keyboard Input', 'capability.keyboard', name, 'keyboard listener', 0.9));
    }

    if (lang === 'html') {
      for (const m of content.matchAll(/<(form|button|input|nav|section|dialog|canvas)\b[^>]*(?:id=['"]([^'"]+)['"])?[^>]*>/gi)) atoms.push(atom(m[2] || m[1], `ui.${m[1].toLowerCase()}`, name, m[0], 0.82));
    }

    if (lang === 'css' || lang === 'scss') {
      for (const m of content.matchAll(/(^|\})\s*\.([A-Za-z_-][\w-]*)\s*\{/gm)) atoms.push(atom(m[2], 'style.component', name, m[0], 0.7));
    }

    if (lang === 'python') {
      for (const m of content.matchAll(/^(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\([^)]*\)\s*:/gm)) atoms.push(atom(m[1], 'logic.function', name, m[0], 0.9));
      for (const m of content.matchAll(/^class\s+([A-Za-z_][\w]*)[^:]*:/gm)) atoms.push(atom(m[1], 'logic.class', name, m[0], 0.9));
    }

    if (lang === 'json') {
      try {
        const value = JSON.parse(content);
        if (value?.app?.components || value?.components) atoms.push(atom('Imported Declarative App', 'atomos.application', name, content, 0.98, { importable:true }));
        else atoms.push(atom('JSON Data Model', 'data.schema', name, content, 0.72));
      } catch {}
    }

    if (!atoms.length) atoms.push(atom(name.replace(/\.[^.]+$/, ''), 'source.module', name, content, 0.45));
    return { name, language:lang, size:content.length, atoms:unique(atoms, x => `${x.kind}:${x.name}`) };
  }

  function moleculeFor(fileResult) {
    const kinds = unique(fileResult.atoms.map(x => x.kind));
    const connectors = {
      inputs: unique(fileResult.atoms.flatMap(x => x.connectors.inputs)).slice(0, 20),
      outputs: unique(fileResult.atoms.flatMap(x => x.connectors.outputs)).slice(0, 20)
    };
    return {
      id: slugify(fileResult.name.replace(/\.[^.]+$/, '')),
      name: fileResult.name.replace(/\.[^.]+$/, ''),
      kind: kinds.some(x => x.startsWith('ui.')) ? 'interface' : kinds.some(x => x.startsWith('api.')) ? 'service' : 'logic',
      sourceFile: fileResult.name,
      atomIds: fileResult.atoms.map(x => x.id),
      connectors,
      confidence: Number((fileResult.atoms.reduce((n,x)=>n+x.confidence,0)/fileResult.atoms.length).toFixed(2))
    };
  }

  function deduplicate(atoms) {
    const groups = new Map();
    for (const item of atoms) {
      const signature = `${item.kind}:${slugify(item.name).replace(/^(get|set|handle|use)-/, '')}`;
      if (!groups.has(signature)) groups.set(signature, []);
      groups.get(signature).push(item);
    }
    return [...groups.values()].map(group => ({ canonical:group[0], alternatives:group.slice(1) }));
  }

  async function readFiles(fileList) {
    const selected = [...fileList].slice(0, MAX_FILES).filter(file => TEXT_EXTENSIONS.has(extension(file.name)) || file.type.startsWith('text/'));
    let total = 0;
    const files = [];
    for (const file of selected) {
      total += file.size;
      if (total > MAX_TOTAL) throw new Error('Selected source is too large. Keep the total under 600 KB.');
      files.push({ name:file.webkitRelativePath || file.name, content:await file.text() });
    }
    if (!files.length) throw new Error('Choose source-code or text files.');
    return files;
  }

  function buildResult(files) {
    const analysed = files.map(analyseFile);
    const atoms = analysed.flatMap(x => x.atoms);
    const molecules = analysed.map(moleculeFor);
    const deduped = deduplicate(atoms);
    return {
      atomosRefinery:'0.1', createdAt:new Date().toISOString(),
      summary:{ files:files.length, atoms:atoms.length, molecules:molecules.length, duplicates:deduped.reduce((n,x)=>n+x.alternatives.length,0) },
      files:analysed.map(({atoms,...rest})=>rest), atoms, molecules,
      reusableLibrary:deduped.map(x => ({ ...x.canonical, alternatives:x.alternatives.map(a=>({name:a.name,file:a.file})) }))
    };
  }

  function saveResult(result) {
    const current = JSON.parse(localStorage.getItem('atomos-refinery-library') || '[]');
    current.push({ id:`refinery-${Date.now()}`, name:`Imported code ${new Date().toLocaleString()}`, ...result });
    localStorage.setItem('atomos-refinery-library', JSON.stringify(current.slice(-20)));
  }

  function downloadResult(result) {
    const blob = new Blob([JSON.stringify(result, null, 2)], { type:'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'atomos-refinery.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function renderResult(host, result) {
    host.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'log';
    summary.textContent = `Extracted ${result.summary.atoms} atoms and ${result.summary.molecules} molecules from ${result.summary.files} files. ${result.summary.duplicates} duplicate candidate(s).`;
    host.appendChild(summary);
    const list = document.createElement('div'); list.className = 'library'; list.style.marginTop = '10px';
    for (const molecule of result.molecules.slice(0, 12)) {
      const card = document.createElement('div'); card.className = 'library-card';
      card.innerHTML = `<h2>${molecule.name}</h2><p class="muted">${molecule.kind} molecule · ${molecule.atomIds.length} atoms · confidence ${Math.round(molecule.confidence*100)}%</p><div class="muted">in: ${molecule.connectors.inputs.join(', ') || 'none'}<br>out: ${molecule.connectors.outputs.join(', ') || 'none'}</div>`;
      list.appendChild(card);
    }
    host.appendChild(list);
  }

  function mount() {
    const left = document.querySelector('.layout > .card');
    if (!left || document.getElementById('codeRefinery')) return;
    const section = document.createElement('section');
    section.id = 'codeRefinery';
    section.innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><h2>Code refinery</h2><p class="muted">Upload existing source files. AtomOS breaks them into candidate atoms, molecules and connectors locally in this browser. Your code is not sent to the AI.</p><input id="refineryFiles" type="file" multiple style="width:100%"><div class="row"><button id="analyseCode" class="primary">Break down code</button><button id="saveRefinery" disabled>Save extracted parts</button><button id="downloadRefinery" disabled>Download map</button></div><div id="refineryOutput" class="muted" style="margin-top:9px">No code analysed yet.</div>`;
    left.appendChild(section);
    const input = document.getElementById('refineryFiles');
    input.setAttribute('accept', [...TEXT_EXTENSIONS].map(x=>'.'+x).join(','));
    document.getElementById('analyseCode').onclick = async () => {
      const button = document.getElementById('analyseCode'); button.disabled = true; button.textContent = 'Analysing…';
      try {
        const files = await readFiles(input.files); refineryResult = buildResult(files);
        renderResult(document.getElementById('refineryOutput'), refineryResult);
        document.getElementById('saveRefinery').disabled = false;
        document.getElementById('downloadRefinery').disabled = false;
        if (typeof log === 'function') log(`Code refinery found ${refineryResult.summary.atoms} atoms and ${refineryResult.summary.molecules} molecules.`, 'ok');
      } catch (error) {
        document.getElementById('refineryOutput').textContent = error.message;
        if (typeof log === 'function') log(error.message, 'bad');
      } finally { button.disabled = false; button.textContent = 'Break down code'; }
    };
    document.getElementById('saveRefinery').onclick = () => { if (!refineryResult) return; saveResult(refineryResult); if (typeof log === 'function') log('Extracted atoms and molecules saved to this device.', 'ok'); };
    document.getElementById('downloadRefinery').onclick = () => refineryResult && downloadResult(refineryResult);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();