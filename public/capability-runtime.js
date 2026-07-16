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

  function actionMatches(condition, snapshot) {
    if (!condition) return true;
    const actual = snapshot[condition.state];
    const expected = condition.value;
    switch (condition.operator || 'truthy') {
      case 'truthy': return Boolean(actual);
      case 'falsy': return !actual;
      case 'eq': return actual === expected;
      case 'neq': return actual !== expected;
      case 'gt': return Number(actual) > Number(expected);
      case 'gte': return Number(actual) >= Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'lte': return Number(actual) <= Number(expected);
      default: return false;
    }
  }

  function arithmetic(value) {
    const source = String(value ?? '').replaceAll('×', '*').replaceAll('÷', '/');
    if (!/^[0-9+\-*/.()\s]+$/.test(source)) throw new Error('Invalid expression');
    const result = Function('"use strict";return (' + source + ')')();
    if (!Number.isFinite(result)) throw new Error('Math error');
    return Number(result.toFixed(10));
  }

  function applyAction(action) {
    const value = action.from ? state[action.from] : action.value;
    if (action.op === 'set') state[action.target] = value;
    else if (action.op === 'increment') state[action.target] = Number(state[action.target] || 0) + Number(value ?? 1);
    else if (action.op === 'decrement') state[action.target] = Number(state[action.target] || 0) - Number(value ?? 1);
    else if (action.op === 'append') state[action.target] = String(state[action.target] ?? '') + String(value ?? '');
    else if (action.op === 'clear') state[action.target] = typeof state[action.target] === 'number' ? 0 : '';
    else if (action.op === 'format_time') state[action.target] = formatTime(value);
    else if (action.op === 'calculate') {
      try { state[action.target] = arithmetic(value); }
      catch { state[action.target] = 'Error'; }
    }
  }

  runEvent = function runEventWithCapabilities(event) {
    const before = structuredClone(state);
    const matched = (currentApp?.rules || []).filter(rule => rule.event === event);
    for (const rule of matched) {
      for (const action of rule.actions || []) {
        if (actionMatches(action.when, before)) applyAction(action);
      }
    }
    timeline.push({ tick: timeline.length + 1, event, before, after: structuredClone(state), rules: matched });
    log('event ' + event);
    selection = { type: 'event', data: timeline.at(-1) };
    persistStorage();
    render();
  };

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
      let html = originalStandalone();
      const needle = "function run(ev){for(const r of app.rules.filter(x=>x.event===ev))for(const a of r.actions){const v=val(a);";
      const replacement = "function ok(c,s){if(!c)return true;const a=s[c.state],v=c.value;return c.operator==='falsy'?!a:c.operator==='eq'?a===v:c.operator==='neq'?a!==v:c.operator==='gt'?Number(a)>Number(v):c.operator==='gte'?Number(a)>=Number(v):c.operator==='lt'?Number(a)<Number(v):c.operator==='lte'?Number(a)<=Number(v):!!a}function run(ev){const before=structuredClone(state);for(const r of app.rules.filter(x=>x.event===ev))for(const a of r.actions){if(!ok(a.when,before))continue;const v=val(a);";
      if (html.includes(needle)) html = html.replace(needle, replacement);
      const calculateNeedle = "else if(a.op==='calculate'){try{state[a.target]=calc(v)}catch{state[a.target]='Error'}}";
      const calculateReplacement = "else if(a.op==='calculate'){try{state[a.target]=calc(v)}catch{state[a.target]='Error'}}else if(a.op==='format_time'){const n=Math.max(0,Math.floor(Number(v)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60,p=x=>String(x).padStart(2,'0');state[a.target]=h>0?p(h)+':'+p(m)+':'+p(s):p(m)+':'+p(s)}";
      return html.includes(calculateNeedle) ? html.replace(calculateNeedle, calculateReplacement) : html;
    };
  }

  window.addEventListener('beforeunload', () => {
    persistStorage();
    clearIntervals();
  });
})();