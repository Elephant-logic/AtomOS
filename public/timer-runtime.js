(() => {
  'use strict';

  let timerHandles = [];

  function clearAtomTimers() {
    for (const handle of timerHandles) clearInterval(handle);
    timerHandles = [];
  }

  function syncAtomTimers() {
    clearAtomTimers();
    if (!currentApp || !Array.isArray(currentApp.timers)) return;

    for (const timer of currentApp.timers) {
      const everyMs = Math.max(50, Number(timer.everyMs || 1000));
      const handle = setInterval(() => {
        if (timer.enabledWhen && !state[timer.enabledWhen]) return;
        runEvent(timer.event);
      }, everyMs);
      timerHandles.push(handle);
    }
  }

  const originalRunEvent = runEvent;
  runEvent = function runEventWithTimers(event) {
    originalRunEvent(event);
    syncAtomTimers();
  };

  const originalRender = render;
  render = function renderWithTimers() {
    originalRender();
  };

  const originalRequest = request;
  request = async function requestWithTimers(editing) {
    await originalRequest(editing);
    syncAtomTimers();
  };

  window.addEventListener('beforeunload', clearAtomTimers);
})();
