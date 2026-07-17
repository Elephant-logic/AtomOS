(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const LANGUAGE_KEY = 'atomos-language-library';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  let lastSynced = '';

  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Knowledge request failed');
    return data;
  }

  async function importAtoms(atoms, quiet = false) {
    if (!Array.isArray(atoms) || !atoms.length) return { imported: 0 };
    const data = await api('/api/knowledge/import', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ atoms }) });
    if (!quiet && typeof log === 'function') log(`Knowledge database learned ${data.imported} atom(s).`, 'ok');
    await refreshStats();
    return data;
  }

  async function migrateBrowserLibrary() {
    let atoms = [];
    try { atoms = JSON.parse(localStorage.getItem(LANGUAGE_KEY) || '[]'); } catch {}
    if (!atoms.length) throw Error('The browser language library is empty. Learn code or HTML first.');
    return importAtoms(atoms);
  }

  async function refreshStats() {
    const host = $('knowledgeStats'); if (!host) return;
    try {
      const stats = await api('/api/knowledge/stats');
      const statuses = stats.statuses || {};
      host.innerHTML = `<b>${stats.total} persistent atoms</b><br>learned ${statuses.learned || 0} · tested ${statuses.tested || 0} · approved ${statuses.approved || 0}<br>${(stats.languages || []).map(x => `${escapeHtml(x.language)} ${x.count}`).join(' · ') || 'No implementations yet'}`;
    } catch (error) { host.textContent = error.message; }
  }

  async function searchKnowledge() {
    const query = $('knowledgeQuery')?.value.trim() || '';
    const host = $('knowledgeResults'); if (!host) return;
    host.textContent = 'Searching…';
    try {
      const data = await api(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=40`);
      host.replaceChildren();
      if (!data.results.length) { host.textContent = 'No matching atoms.'; return; }
      for (const atom of data.results) {
        const card = document.createElement('div'); card.className = 'library-card';
        const inputs = atom.connectors?.inputs || [], outputs = atom.connectors?.outputs || [];
        card.innerHTML = `<h2>${escapeHtml(atom.name)}</h2><p class="muted">${escapeHtml(atom.kind)} · ${escapeHtml(atom.status)} · confidence ${Math.round(Number(atom.confidence || 0) * 100)}%</p><div class="muted">needs: ${escapeHtml(inputs.join(', ') || 'none')}<br>provides: ${escapeHtml(outputs.join(', ') || 'none')}<br>languages: ${escapeHtml(Object.keys(atom.implementations || {}).join(', ') || 'semantic only')}</div><div class="row"><button class="small" data-status="tested">Mark tested</button><button class="small good" data-status="approved">Approve</button></div>`;
        card.querySelectorAll('[data-status]').forEach(button => button.onclick = async () => {
          await api(`/api/knowledge/atoms/${encodeURIComponent(atom.id)}/status`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({status:button.dataset.status}) });
          searchKnowledge(); refreshStats();
        });
        host.appendChild(card);
      }
    } catch (error) { host.textContent = error.message; }
  }

  function mount() {
    const left = document.querySelector('.layout > .card');
    if (!left || $('knowledgeEngine')) return false;
    const section = document.createElement('section'); section.id = 'knowledgeEngine';
    section.innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><h2>Knowledge database</h2><p class="muted">Persistent SQLite library shared by AtomOS builds. Search learned HTML, JavaScript, Python, CSS, connectors and implementations.</p><div id="knowledgeStats" class="log">Connecting…</div><div class="row"><input id="knowledgeQuery" placeholder="Search forms, storage, HTTP…" style="flex:1;min-width:150px;background:#06101d;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:8px"><button id="knowledgeSearch" class="primary">Search</button><button id="knowledgeMigrate">Import browser library</button></div><div id="knowledgeResults" class="library" style="margin-top:10px"></div>`;
    left.appendChild(section);
    $('knowledgeSearch').onclick = searchKnowledge;
    $('knowledgeQuery').onkeydown = event => { if (event.key === 'Enter') searchKnowledge(); };
    $('knowledgeMigrate').onclick = async () => {
      const button = $('knowledgeMigrate'); button.disabled = true; button.textContent = 'Importing…';
      try { await migrateBrowserLibrary(); button.textContent = 'Imported'; }
      catch (error) { button.textContent = 'Import failed'; if (typeof log === 'function') log(error.message, 'bad'); }
      finally { setTimeout(() => { button.disabled = false; button.textContent = 'Import browser library'; }, 1400); }
    };
    refreshStats();
    return true;
  }

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key === LANGUAGE_KEY && value !== lastSynced) {
      lastSynced = value;
      try { importAtoms(JSON.parse(value), true).catch(error => console.warn('Knowledge sync failed', error)); } catch {}
    }
  };

  mount();
  const observer = new MutationObserver(mount); observer.observe(document.documentElement, { childList:true, subtree:true });
  window.AtomOSKnowledge = { importAtoms, migrateBrowserLibrary, search:searchKnowledge, refreshStats };
})();
