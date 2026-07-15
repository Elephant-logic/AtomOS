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
    persistStorage();
  };

  const originalRequest = request;
  request = async function requestWithCapabilities(editing) {
    hydratedApp = null;
    await originalRequest(editing);
    syncCapabilities();
    render();
  };

  window.addEventListener('beforeunload', () => {
    persistStorage();
    clearIntervals();
  });
})();