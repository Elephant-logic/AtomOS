(() => {
  'use strict';

  let intervalHandles = [];
  let keyboardHandler = null;
  let hydratedApp = null;
  let startupApp = null;

  function capabilities() {
    const declared = Array.isArray(currentApp?.capabilities) ? currentApp.capabilities : [];
    const legacy = (currentApp?.timers || []).map(timer => ({ ...timer, type: 'interval' }));
    return [...declared, ...legacy];
  }

  function clearCapabilities() {
    for (const handle of intervalHandles) clearInterval(handle);
    intervalHandles = [];
    if (keyboardHandler) window.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
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
      for (const key of capability.stateKeys || []) {
        if (Object.hasOwn(state, key)) data[key] = state[key];
      }
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
    return hours > 0
      ? `${pair(hours)}:${pair(minutes)}:${pair(seconds)}`
      : `${pair(minutes)}:${pair(seconds)}`;
  }

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function operand(action, snapshot) {
    if (action.from) return clone(snapshot[action.from]);
    if (action.by !== undefined) return clone(action.by);
    return clone(action.value);
  }

  function conditionMatches(condition, snapshot) {
    if (!condition) return true;
    const left = snapshot[condition.state];
    const right = condition.value;

    switch (condition.operator) {
      case 'truthy': return Boolean(left);
      case 'falsy': return !left;
      case 'eq': return left === right;
      case 'neq': return left !== right;
      case 'gt': return Number(left) > Number(right);
      case 'gte': return Number(left) >= Number(right);
      case 'lt': return Number(left) < Number(right);
      case 'lte': return Number(left) <= Number(right);
      case 'includes':
        return Array.isArray(left)
          ? left.includes(right)
          : String(left ?? '').includes(String(right ?? ''));
      case 'not_includes':
        return Array.isArray(left)
          ? !left.includes(right)
          : !String(left ?? '').includes(String(right ?? ''));
      default: return false;
    }
  }

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function list(value) {
    return Array.isArray(value) ? [...value] : [];
  }

  function applyAction(action, snapshot, emitted) {
    if (!conditionMatches(action.when, snapshot)) return;

    const value = operand(action, snapshot);
    const current = state[action.target];

    switch (action.op) {
      case 'set':
        state[action.target] = value;
        break;
      case 'increment':
      case 'add':
        state[action.target] = numeric(current) + numeric(value ?? 1);
        break;
      case 'decrement':
      case 'subtract':
        state[action.target] = numeric(current) - numeric(value ?? 1);
        break;
      case 'multiply':
        state[action.target] = numeric(current) * numeric(value ?? 1);
        break;
      case 'divide':
        state[action.target] = numeric(value) === 0 ? 'Error' : numeric(current) / numeric(value);
        break;
      case 'modulo':
        state[action.target] = numeric(value) === 0 ? 'Error' : numeric(current) % numeric(value);
        break;
      case 'append':
      case 'concat':
        state[action.target] = String(current ?? '') + String(value ?? '');
        break;
      case 'clear':
        state[action.target] = Array.isArray(current) ? [] : typeof current === 'number' ? 0 : typeof current === 'boolean' ? false : '';
        break;
      case 'toggle':
        state[action.target] = !Boolean(current);
        break;
      case 'calculate':
        try {
          state[action.target] = calculate(value);
        } catch {
          state[action.target] = 'Error';
        }
        break;
      case 'format_time':
        state[action.target] = formatTime(value);
        break;
      case 'list_push': {
        const items = list(current);
        items.push(value);
        state[action.target] = items;
        break;
      }
      case 'list_unshift': {
        const items = list(current);
        items.unshift(value);
        state[action.target] = items;
        break;
      }
      case 'list_pop': {
        const items = list(current);
        items.pop();
        state[action.target] = items;
        break;
      }
      case 'list_shift': {
        const items = list(current);
        items.shift();
        state[action.target] = items;
        break;
      }
      case 'list_remove': {
        const items = list(current);
        const index = action.index !== undefined ? Number(action.index) : items.indexOf(value);
        if (Number.isInteger(index) && index >= 0 && index < items.length) items.splice(index, 1);
        state[action.target] = items;
        break;
      }
      case 'list_set': {
        const items = list(current);
        const index = Number(action.index ?? 0);
        if (Number.isInteger(index) && index >= 0 && index < 200) items[index] = value;
        state[action.target] = items;
        break;
      }
      case 'length':
        state[action.target] = Array.isArray(value) || typeof value === 'string' ? value.length : 0;
        break;
      case 'min':
        state[action.target] = Math.min(numeric(current), numeric(value));
        break;
      case 'max':
        state[action.target] = Math.max(numeric(current), numeric(value));
        break;
      case 'round':
        state[action.target] = Math.round(numeric(value));
        break;
      case 'floor':
        state[action.target] = Math.floor(numeric(value));
        break;
      case 'ceil':
        state[action.target] = Math.ceil(numeric(value));
        break;
      case 'emit':
        if (action.event) emitted.push(action.event);
        break;
    }
  }

  function executeEvent(event, depth = 0) {
    if (!currentApp || depth > 50) return;

    const before = structuredClone(state);
    const snapshot = structuredClone(state);
    const matched = (currentApp.rules || []).filter(rule => rule.event === event);
    const emitted = [];

    for (const rule of matched) {
      for (const action of rule.actions || []) applyAction(action, snapshot, emitted);
    }

    timeline.push({
      tick: timeline.length + 1,
      event,
      before,
      after: structuredClone(state),
      rules: matched
    });

    if (typeof log === 'function') log('event ' + event);
    selection = { type: 'event', data: timeline.at(-1) };
    persistStorage();

    for (const nextEvent of emitted) executeEvent(nextEvent, depth + 1);
    render();
  }

  runEvent = executeEvent;

  function syncCapabilities() {
    clearCapabilities();
    hydrateStorage();

    for (const capability of capabilities()) {
      if (capability.type !== 'interval') continue;
      const everyMs = Math.max(50, Number(capability.everyMs || 1000));
      intervalHandles.push(setInterval(() => {
        if (capability.enabledWhen && !state[capability.enabledWhen]) return;
        executeEvent(capability.event);
      }, everyMs));
    }

    const keyboard = capabilities().filter(x => x.type === 'keyboard');
    if (keyboard.length) {
      keyboardHandler = event => {
        for (const capability of keyboard) {
          const wanted = String(capability.keyboardKey || '').toLowerCase();
          const actual = String(event.key || '').toLowerCase();
          if (wanted !== actual && wanted !== String(event.code || '').toLowerCase()) continue;
          if (capability.preventDefault) event.preventDefault();
          executeEvent(capability.event);
        }
      };
      window.addEventListener('keydown', keyboardHandler);
    }

    if (startupApp !== currentApp) {
      startupApp = currentApp;
      queueMicrotask(() => {
        for (const capability of capabilities().filter(x => x.type === 'startup')) {
          executeEvent(capability.event);
        }
      });
    }
  }

  const originalRequest = request;
  request = async function requestWithCapabilities(editing) {
    hydratedApp = null;
    startupApp = null;
    await originalRequest(editing);
    syncCapabilities();
    render();
  };

  function standaloneRuntime(appData) {
    return `const app=${appData},state=structuredClone(app.state);let timers=[];` +
      `function clone(v){return v===undefined?undefined:structuredClone(v)}` +
      `function val(a,s){return a.from?clone(s[a.from]):a.by!==undefined?clone(a.by):clone(a.value)}` +
      `function num(v){const n=Number(v);return Number.isFinite(n)?n:0}` +
      `function fmt(v){const n=Math.max(0,Math.floor(num(v))),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60,p=x=>String(x).padStart(2,'0');return h>0?p(h)+':'+p(m)+':'+p(s):p(m)+':'+p(s)}` +
      `function ok(c,s){if(!c)return true;const l=s[c.state],r=c.value;switch(c.operator){case'truthy':return!!l;case'falsy':return!l;case'eq':return l===r;case'neq':return l!==r;case'gt':return num(l)>num(r);case'gte':return num(l)>=num(r);case'lt':return num(l)<num(r);case'lte':return num(l)<=num(r);case'includes':return Array.isArray(l)?l.includes(r):String(l??'').includes(String(r??''));case'not_includes':return Array.isArray(l)?!l.includes(r):!String(l??'').includes(String(r??''));default:return false}}` +
      `function calc(v){const s=String(v??'').replaceAll('×','*').replaceAll('÷','/');if(!/^[0-9+\\-*/.()\\s]+$/.test(s))throw Error();const n=Function('"use strict";return ('+s+')')();if(!Number.isFinite(n))throw Error();return Number(n.toFixed(10))}` +
      `function act(a,s,q){if(!ok(a.when,s))return;const v=val(a,s),c=state[a.target];switch(a.op){case'set':state[a.target]=v;break;case'increment':case'add':state[a.target]=num(c)+num(v??1);break;case'decrement':case'subtract':state[a.target]=num(c)-num(v??1);break;case'multiply':state[a.target]=num(c)*num(v??1);break;case'divide':state[a.target]=num(v)===0?'Error':num(c)/num(v);break;case'modulo':state[a.target]=num(v)===0?'Error':num(c)%num(v);break;case'append':case'concat':state[a.target]=String(c??'')+String(v??'');break;case'clear':state[a.target]=Array.isArray(c)?[]:typeof c==='number'?0:typeof c==='boolean'?false:'';break;case'toggle':state[a.target]=!c;break;case'calculate':try{state[a.target]=calc(v)}catch{state[a.target]='Error'}break;case'format_time':state[a.target]=fmt(v);break;case'list_push':{const x=Array.isArray(c)?[...c]:[];x.push(v);state[a.target]=x;break}case'list_unshift':{const x=Array.isArray(c)?[...c]:[];x.unshift(v);state[a.target]=x;break}case'list_pop':{const x=Array.isArray(c)?[...c]:[];x.pop();state[a.target]=x;break}case'list_shift':{const x=Array.isArray(c)?[...c]:[];x.shift();state[a.target]=x;break}case'list_remove':{const x=Array.isArray(c)?[...c]:[],i=a.index!==undefined?Number(a.index):x.indexOf(v);if(Number.isInteger(i)&&i>=0&&i<x.length)x.splice(i,1);state[a.target]=x;break}case'list_set':{const x=Array.isArray(c)?[...c]:[],i=Number(a.index??0);if(Number.isInteger(i)&&i>=0&&i<200)x[i]=v;state[a.target]=x;break}case'length':state[a.target]=(Array.isArray(v)||typeof v==='string')?v.length:0;break;case'min':state[a.target]=Math.min(num(c),num(v));break;case'max':state[a.target]=Math.max(num(c),num(v));break;case'round':state[a.target]=Math.round(num(v));break;case'floor':state[a.target]=Math.floor(num(v));break;case'ceil':state[a.target]=Math.ceil(num(v));break;case'emit':if(a.event)q.push(a.event);break}}` +
      `function run(ev,d=0){if(d>50)return;const s=structuredClone(state),q=[];for(const r of app.rules.filter(x=>x.event===ev))for(const a of r.actions||[])act(a,s,q);save();for(const n of q)run(n,d+1);render()}` +
      `function sk(c){return'atomos:'+(c.key||c.id)}function load(){for(const c of app.capabilities||[])if(c.type==='storage')try{const x=JSON.parse(localStorage.getItem(sk(c))||'null');if(x)for(const k of c.stateKeys||[])if(Object.hasOwn(x,k)&&Object.hasOwn(state,k))state[k]=x[k]}catch{}}` +
      `function save(){for(const c of app.capabilities||[])if(c.type==='storage')try{const x={};for(const k of c.stateKeys||[])if(Object.hasOwn(state,k))x[k]=state[k];localStorage.setItem(sk(c),JSON.stringify(x))}catch{}}` +
      `function caps(){for(const c of app.capabilities||[]){if(c.type==='interval')timers.push(setInterval(()=>{if(!c.enabledWhen||state[c.enabledWhen])run(c.event)},Math.max(50,Number(c.everyMs||1000))));if(c.type==='keyboard')addEventListener('keydown',e=>{if(String(e.key).toLowerCase()===String(c.keyboardKey).toLowerCase()){if(c.preventDefault)e.preventDefault();run(c.event)}})}queueMicrotask(()=>{for(const c of app.capabilities||[])if(c.type==='startup')run(c.event)})}`;
  }

  standalone = function standaloneGeneralRuntime() {
    const data = JSON.stringify(currentApp).replaceAll('<', '\\u003c');
    const runtimeCode = standaloneRuntime(data);
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${currentApp.title}</title><style>body{font:16px system-ui;background:#eef3fa;margin:0;padding:24px}.app{max-width:520px;margin:auto;background:white;padding:22px;border-radius:18px;box-shadow:0 20px 60px #0002}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.full{grid-column:1/-1}.display{font-size:34px;text-align:right;padding:14px;background:#f5f7fb;border-radius:12px;overflow-wrap:anywhere}button,input{padding:13px;border-radius:10px;border:1px solid #ccd6e5;font:inherit}button{background:#2869e8;color:white;font-weight:700}</style><div id="root"></div><script>${runtimeCode}function render(){const root=document.getElementById('root');root.innerHTML='';const box=document.createElement('div');box.className='app';box.innerHTML='<h1>'+app.title+'</h1><p>'+app.description+'</p>';const g=document.createElement('div');g.className='grid';for(const c of app.components){let e;if(c.type==='button'){e=document.createElement('button');e.textContent=c.text||c.label||c.id;e.onclick=()=>run(c.event)}else if(c.type==='input'){e=document.createElement('input');e.placeholder=c.label||'';e.value=state[c.bind]??'';e.oninput=()=>{state[c.bind]=e.type==='number'?Number(e.value):e.value;save()};e.className='full'}else{e=document.createElement('div');const v=c.bind?state[c.bind]??'':c.text||'';e.textContent=Array.isArray(v)?v.join(', '):v;e.className='full '+(c.type==='display'?'display':'')}g.appendChild(e)}box.appendChild(g);root.appendChild(box)}load();render();caps()<\/script>`;
  };

  window.addEventListener('beforeunload', () => {
    persistStorage();
    clearCapabilities();
  });
})();
