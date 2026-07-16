(() => {
  'use strict';

  const HISTORY_KEY = 'atomos-app-history-v1';
  const MAX_ENTRIES = 40;

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveHistory(entries) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  }

  function clone(value) {
    return value == null ? value : structuredClone(value);
  }

  function appHash(app) {
    if (!app) return '';
    try { return JSON.stringify(app); } catch { return String(Date.now()); }
  }

  function current() {
    try { return typeof currentApp !== 'undefined' ? currentApp : window.currentApp; }
    catch { return window.currentApp; }
  }

  function snapshot(reason, prompt, app = current()) {
    if (!app) return null;
    const history = loadHistory();
    const hash = appHash(app);
    const latest = history.at(-1);
    if (latest?.hash === hash && latest?.reason === reason) return latest;
    const entry = {
      id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: app.title || 'Untitled app',
      reason: reason || 'snapshot',
      prompt: String(prompt || '').slice(0, 800),
      app: clone(app),
      hash,
      componentCount: (app.components || []).length,
      ruleCount: (app.rules || []).length,
      createdAt: new Date().toISOString()
    };
    history.push(entry);
    saveHistory(history);
    return entry;
  }

  function applyVersion(entry, reason = 'rollback') {
    if (!entry?.app) return false;
    const before = current();
    if (before) snapshot('before rollback', `Restore ${entry.title}`, before);
    try {
      currentApp = clone(entry.app);
      window.currentApp = currentApp;
      state = clone(currentApp.state || {});
      timeline = [];
      selection = null;
      view = 'preview';
      if (typeof model !== 'undefined') model = entry.model || model;
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.view === 'preview'));
      if (typeof render === 'function') render();
      if (typeof log === 'function') log(`${reason === 'rollback' ? 'Rolled back' : 'Restored'} to ${entry.title} from ${new Date(entry.createdAt).toLocaleString()}.`, 'ok');
      snapshot('restored version', entry.prompt, currentApp);
      renderHistoryView();
      updateRollbackButton();
      return true;
    } catch (error) {
      if (typeof log === 'function') log(`Rollback failed: ${error.message}`, 'bad');
      return false;
    }
  }

  function previousVersion() {
    const history = loadHistory();
    const hash = appHash(current());
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].hash && history[i].hash !== hash) return history[i];
    }
    return null;
  }

  function rollback() {
    const previous = previousVersion();
    if (!previous) {
      if (typeof log === 'function') log('No earlier application version is available.', 'bad');
      return false;
    }
    return applyVersion(previous, 'rollback');
  }

  function clearHistory() {
    if (!confirm('Clear all saved application history on this device?')) return;
    localStorage.removeItem(HISTORY_KEY);
    snapshot('current version', '', current());
    renderHistoryView();
    updateRollbackButton();
  }

  function downloadHistory() {
    const blob = new Blob([JSON.stringify(loadHistory(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'atomos-application-history.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
  }

  function renderHistoryView() {
    if (!window.__atomHistoryView) return;
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    const history = loadHistory().slice().reverse();
    canvas.replaceChildren();

    const controls = document.createElement('div');
    controls.className = 'row';
    controls.style.marginTop = '0';
    controls.innerHTML = '<button id="historyRollback" class="primary">Rollback one version</button><button id="historySnapshot">Save snapshot</button><button id="historyDownload">Download history</button><button id="historyClear" class="danger">Clear history</button>';
    canvas.appendChild(controls);

    const summary = document.createElement('div');
    summary.className = 'log';
    summary.textContent = `${history.length} saved version${history.length === 1 ? '' : 's'} on this device. Builds, edits and rollbacks create snapshots automatically.`;
    canvas.appendChild(summary);

    const grid = document.createElement('div');
    grid.className = 'library';
    grid.style.marginTop = '12px';
    const activeHash = appHash(current());
    for (const entry of history) {
      const card = document.createElement('div');
      card.className = 'library-card';
      const active = entry.hash === activeHash;
      card.innerHTML = `<h2>${entry.title}${active ? ' · current' : ''}</h2><p class="muted">${new Date(entry.createdAt).toLocaleString()} · ${entry.reason}</p><div class="muted">${entry.componentCount} components · ${entry.ruleCount} rules${entry.prompt ? `<br>${entry.prompt.replace(/[<>&]/g, '')}` : ''}</div>`;
      const row = document.createElement('div');
      row.className = 'row';
      const restore = document.createElement('button');
      restore.textContent = active ? 'Current' : 'Restore';
      restore.disabled = active;
      restore.className = active ? '' : 'good';
      restore.onclick = () => applyVersion(entry, 'restore');
      const source = document.createElement('button');
      source.textContent = 'Download source';
      source.onclick = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(entry.app, null, 2)], { type: 'application/json' }));
        a.download = `${String(entry.title || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.atomos.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 500);
      };
      row.append(restore, source);
      card.appendChild(row);
      grid.appendChild(card);
    }
    if (!history.length) grid.innerHTML = '<div class="empty">No application history yet. Build or edit an app to create the first version.</div>';
    canvas.appendChild(grid);

    document.getElementById('historyRollback').onclick = rollback;
    document.getElementById('historySnapshot').onclick = () => { snapshot('manual snapshot', document.getElementById('prompt')?.value, current()); renderHistoryView(); updateRollbackButton(); };
    document.getElementById('historyDownload').onclick = downloadHistory;
    document.getElementById('historyClear').onclick = clearHistory;
  }

  function updateRollbackButton() {
    const button = document.getElementById('rollbackApp');
    if (button) button.disabled = !previousVersion();
  }

  function mountUi() {
    const build = document.getElementById('build');
    if (build && !document.getElementById('rollbackApp')) {
      const button = document.createElement('button');
      button.id = 'rollbackApp';
      button.textContent = 'Rollback';
      button.onclick = rollback;
      build.parentElement?.appendChild(button);
    }

    const tabs = document.querySelector('.tabs');
    if (tabs && !document.getElementById('historyTab')) {
      const tab = document.createElement('button');
      tab.id = 'historyTab';
      tab.className = 'tab';
      tab.textContent = 'History';
      tab.onclick = () => {
        window.__atomHistoryView = true;
        document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === tab));
        renderHistoryView();
      };
      tabs.insertBefore(tab, tabs.lastElementChild);
      document.querySelectorAll('.tab:not(#historyTab)').forEach(existing => existing.addEventListener('click', () => { window.__atomHistoryView = false; }));
    }
    updateRollbackButton();
  }

  function installRequestHistory() {
    if (typeof request !== 'function' || request.__historyWrapped) return false;
    const original = request;
    request = async function requestWithHistory(editing) {
      const prompt = document.getElementById('prompt')?.value || '';
      const before = current();
      if (before) snapshot(editing ? 'before edit' : 'before build', prompt, before);
      const beforeHash = appHash(before);
      const result = await original(editing);
      const after = current();
      if (after && appHash(after) !== beforeHash) snapshot(editing ? 'edited build' : 'new build', prompt, after);
      updateRollbackButton();
      if (window.__atomHistoryView) renderHistoryView();
      return result;
    };
    request.__historyWrapped = true;
    const build = document.getElementById('build');
    const edit = document.getElementById('edit');
    if (build) build.onclick = () => request(false);
    if (edit) edit.onclick = () => request(true);
    return true;
  }

  function boot() {
    mountUi();
    const app = current();
    if (app && !loadHistory().length) snapshot('current version', '', app);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      mountUi();
      if (installRequestHistory() || attempts > 50) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.AtomHistory = { snapshot, rollback, restore: applyVersion, history: loadHistory, render: renderHistoryView };
})();