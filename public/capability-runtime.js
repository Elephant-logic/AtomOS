(() => {
  'use strict';
  let intervalHandles = [];
  let keyboardHandler = null;
  let hydratedApp = null;
  let startupApp = null;
  let platformLoading = null;

  function capabilities() {
    const declared = Array.isArray(currentApp?.capabilities) ? currentApp.capabilities : [];
    const legacy = (currentApp?.timers || []).map(timer => ({ ...timer, type: 'interval' }));
    return [...declared, ...legacy];
  }
  function clearCapabilities() {
    intervalHandles.forEach(clearInterval); intervalHandles = [];
    if (keyboardHandler) window.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
  }
  function storageKey(c) { return `atomos:${c.key || c.id}`; }
  function hydrateStorage() {
    if (!currentApp || hydratedApp === currentApp) return;
    hydratedApp = currentApp;
    for (const c of capabilities().filter(x => x.type === 'storage')) try {
      const saved = JSON.parse(localStorage.getItem(storageKey(c)) || 'null');
      if (saved) for (const key of c.stateKeys || []) if (Object.hasOwn(saved, key) && Object.hasOwn(state, key)) state[key] = saved[key];
    } catch (error) { console.warn('AtomOS storage load failed', error); }
  }
  function persistStorage() {
    for (const c of capabilities().filter(x => x.type === 'storage')) try {
      const value = {}; for (const key of c.stateKeys || []) if (Object.hasOwn(state, key)) value[key] = state[key];
      localStorage.setItem(storageKey(c), JSON.stringify(value));
    } catch (error) { console.warn('AtomOS storage save failed', error); }
  }
  function execute(event) {
    if (!currentApp || !window.AtomOSRuntime) return;
    const before = structuredClone(state);
    const result = window.AtomOSRuntime.executeEvent(currentApp, state, event);
    timeline.push({ tick: timeline.length + 1, event, before, after: structuredClone(state), rules: result.matched });
    if (typeof log === 'function') log('event ' + event);
    selection = { type: 'event', data: timeline.at(-1) };
    persistStorage();
    render();
  }
  function syncCapabilities() {
    clearCapabilities(); hydrateStorage();
    for (const c of capabilities()) if (c.type === 'interval') intervalHandles.push(setInterval(() => {
      if (!c.enabledWhen || state[c.enabledWhen]) execute(c.event);
    }, Math.max(50, Number(c.everyMs || 1000))));
    const keyboards = capabilities().filter(x => x.type === 'keyboard');
    if (keyboards.length) {
      keyboardHandler = event => { for (const c of keyboards) {
        const wanted = String(c.keyboardKey || '').toLowerCase();
        if (wanted !== String(event.key || '').toLowerCase() && wanted !== String(event.code || '').toLowerCase()) continue;
        if (c.preventDefault) event.preventDefault(); execute(c.event);
      }};
      window.addEventListener('keydown', keyboardHandler);
    }
    if (startupApp !== currentApp) { startupApp = currentApp; queueMicrotask(() => capabilities().filter(x => x.type === 'startup').forEach(c => execute(c.event))); }
  }
  function loadOne(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src; script.async = false; script.onload = resolve; script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  function loadPlatformScripts() {
    if (platformLoading) return platformLoading;
    const scripts = ['/build-verifier.js','/build-pipeline.js','/requirements-assistant-safe.js','/capability-orchestrator-safe.js','/history-manager-safe.js'];
    platformLoading = scripts.reduce((chain, src) => chain.then(() => loadOne(src)), Promise.resolve())
      .catch(error => console.error('AtomOS platform feature failed to load', error));
    return platformLoading;
  }
  function install() {
    if (!window.AtomOSRuntime) return false;
    runEvent = execute;
    const originalRequest = request;
    if (!originalRequest.__runtimeCoreWrapped) {
      const wrapped = async function(editing) { hydratedApp = null; startupApp = null; const result = await originalRequest(editing); syncCapabilities(); render(); return result; };
      wrapped.__runtimeCoreWrapped = true; request = wrapped;
      const build = document.getElementById('build'), edit = document.getElementById('edit');
      if (build) build.onclick = () => request(false); if (edit) edit.onclick = () => request(true);
    }
    syncCapabilities();
    loadPlatformScripts();
    return true;
  }
  function boot() {
    if (install()) return;
    const script = document.createElement('script'); script.src = '/runtime-core.js'; script.onload = install; script.onerror = () => console.error('AtomOS runtime core failed to load'); document.head.appendChild(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('beforeunload', () => { persistStorage(); clearCapabilities(); });
})();
