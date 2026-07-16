(() => {
  'use strict';

  let intervalHandles = [];
  let hydratedApp = null;

  function capabilities() {
    const declared = Array.isArray(currentApp?.capabilities) ? currentApp.capabilities : [];
    const legacy = (currentApp?.timers || []).map(timer => ({ ...timer, type: 'interval' }));
    return [...declared, ...legacy];
  }

  function clearIntervals() {
    for (const handle of intervalHandles) clearInterval(handle);
    intervalHandles = [];
  }

  function storageKey(capability) {
    return `atomos:${capability.key || capability.id}`;
  }

  function hydrateStorage() {
    if (!currentApp || hydratedApp === currentApp) return;
    hydratedApp = currentApp;
    for (const capability of capabilities().filter(x => x.type === 'storage')) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey(capability)) || 'null');
        if (!saved || typeof saved !== 'object') continue;
        for (const key of capability.stateKeys || []) {
          if (Object.hasOwn(saved, key) && Object.hasOwn(state, key)) state[key] = saved[key];
        }
      } catch (error) {
        console.warn('AtomOS storage capability could not load', capability.id, error);
      }
    }
  }

  function persistStorage() {
    if (!currentApp) return;
    for (const capability of capabilities().filter(x => x.type === 'storage')) {
      const data = {};
      for (const key of capability.stateKeys || []) if (Object.hasOwn(state, key)) data[key] = state[key];
      try {
        localStorage.setItem(storageKey(capability), JSON.stringify(data));
      } catch (error) {
        console.warn('AtomOS storage capability could not save', capability.id, error);
      }
    }
  }

  function formatTime(value) {
    const total = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pair = number => String(number).padStart(2, '0');
    return hours > 0 ? `${pair(hours)}:${pair(minutes)}:${pair(seconds)}` : `${pair(minutes)}:${pair(seconds)}`;
  }

  function applyExtendedActions(event) {
    let changed = false;
    for (const rule of currentApp?.rules || []) {
      if (rule.event !== event) continue;
      for (const action of rule.actions || []) {
        if (action.op !== 'format_time') continue;
        state[action.target] = formatTime(action.from ? state[action.from] : action.value);
        changed = true;
      }
    }
    return changed;
  }

  function syncCapabilities() {
    clearIntervals();
    hydrateStorage();
    for (const capability of capabilities()) {
      if (capability.type !== 'interval') continue;
      const everyMs = Math.max(50, Number(capability.everyMs || 1000));
      intervalHandles.push(setInterval(() => {
        if (capability.enabledWhen && !state[capability.enabledWhen]) return;
        runEvent(capability.event);
      }, everyMs));
    }
  }

  const originalRunEvent = runEvent;
  runEvent = function runEventWithCapabilities(event) {
    originalRunEvent(event);
    const changed = applyExtendedActions(event);
    persistStorage();
    if (changed) render();
  };

  const originalRequest = request;
  request = async function requestWithCapabilities(editing) {
    hydratedApp = null;
    await originalRequest(editing);
    syncCapabilities();
    render();
  };

  if (typeof standalone === 'function') {
    const originalStandalone = standalone;
    standalone = function standaloneWithExtendedActions() {
      const html = originalStandalone();
      const needle = "else if(a.op==='calculate'){try{state[a.target]=calc(v)}catch{state[a.target]='Error'}}";
      const replacement = "else if(a.op==='calculate'){try{state[a.target]=calc(v)}catch{state[a.target]='Error'}}else if(a.op==='format_time'){const n=Math.max(0,Math.floor(Number(v)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60,p=x=>String(x).padStart(2,'0');state[a.target]=h>0?p(h)+':'+p(m)+':'+p(s):p(m)+':'+p(s)}";
      return html.includes(needle) ? html.replace(needle, replacement) : html;
    };
  }

  window.addEventListener('beforeunload', () => {
    persistStorage();
    clearIntervals();
  });
})();