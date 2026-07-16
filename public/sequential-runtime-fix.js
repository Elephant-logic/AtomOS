(() => {
  'use strict';

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
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
      case 'includes': return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
      case 'not_includes': return Array.isArray(left) ? !left.includes(right) : !String(left ?? '').includes(String(right ?? ''));
      default: return false;
    }
  }

  function operand(action) {
    if (action.from) return clone(state[action.from]);
    if (action.by !== undefined) return clone(action.by);
    return clone(action.value);
  }

  function formatTime(value) {
    const total = Math.max(0, Math.floor(number(value)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pair = value => String(value).padStart(2, '0');
    return hours ? `${pair(hours)}:${pair(minutes)}:${pair(seconds)}` : `${pair(minutes)}:${pair(seconds)}`;
  }

  function apply(action, snapshot, emitted) {
    if (!conditionMatches(action.when, snapshot)) return;
    const value = operand(action);
    const current = state[action.target];
    switch (action.op) {
      case 'set': state[action.target] = value; break;
      case 'increment':
      case 'add': state[action.target] = number(current) + number(value ?? 1); break;
      case 'decrement':
      case 'subtract': state[action.target] = number(current) - number(value ?? 1); break;
      case 'multiply': state[action.target] = number(current) * number(value ?? 1); break;
      case 'divide': state[action.target] = number(value) === 0 ? 'Error' : number(current) / number(value); break;
      case 'modulo': state[action.target] = number(value) === 0 ? 'Error' : number(current) % number(value); break;
      case 'append':
      case 'concat': state[action.target] = String(current ?? '') + String(value ?? ''); break;
      case 'clear': state[action.target] = Array.isArray(current) ? [] : typeof current === 'number' ? 0 : typeof current === 'boolean' ? false : ''; break;
      case 'toggle': state[action.target] = !Boolean(current); break;
      case 'calculate':
        try { state[action.target] = calculate(value); } catch { state[action.target] = 'Error'; }
        break;
      case 'format_time': state[action.target] = formatTime(value); break;
      case 'list_push': { const items = Array.isArray(current) ? [...current] : []; items.push(value); state[action.target] = items; break; }
      case 'list_unshift': { const items = Array.isArray(current) ? [...current] : []; items.unshift(value); state[action.target] = items; break; }
      case 'list_pop': { const items = Array.isArray(current) ? [...current] : []; items.pop(); state[action.target] = items; break; }
      case 'list_shift': { const items = Array.isArray(current) ? [...current] : []; items.shift(); state[action.target] = items; break; }
      case 'list_remove': {
        const items = Array.isArray(current) ? [...current] : [];
        const index = action.index !== undefined ? Number(action.index) : items.indexOf(value);
        if (Number.isInteger(index) && index >= 0 && index < items.length) items.splice(index, 1);
        state[action.target] = items;
        break;
      }
      case 'list_set': {
        const items = Array.isArray(current) ? [...current] : [];
        const index = Number(action.index ?? 0);
        if (Number.isInteger(index) && index >= 0 && index < 200) items[index] = value;
        state[action.target] = items;
        break;
      }
      case 'length': state[action.target] = Array.isArray(value) || typeof value === 'string' ? value.length : 0; break;
      case 'min': state[action.target] = Math.min(number(current), number(value)); break;
      case 'max': state[action.target] = Math.max(number(current), number(value)); break;
      case 'round': state[action.target] = Math.round(number(value)); break;
      case 'floor': state[action.target] = Math.floor(number(value)); break;
      case 'ceil': state[action.target] = Math.ceil(number(value)); break;
      case 'emit': if (action.event) emitted.push(action.event); break;
    }
  }

  function executeSequentially(event, depth = 0) {
    if (!currentApp || depth > 50) return;
    const before = structuredClone(state);
    const snapshot = structuredClone(state);
    const matched = (currentApp.rules || []).filter(rule => rule.event === event);
    const emitted = [];
    for (const rule of matched) for (const action of rule.actions || []) apply(action, snapshot, emitted);
    timeline.push({ tick: timeline.length + 1, event, before, after: structuredClone(state), rules: matched });
    if (typeof log === 'function') log('event ' + event);
    selection = { type: 'event', data: timeline.at(-1) };
    for (const next of emitted) executeSequentially(next, depth + 1);
    render();
  }

  function install() {
    runEvent = executeSequentially;
    if (typeof standalone === 'function' && !standalone.__sequentialFixed) {
      const original = standalone;
      const fixed = function sequentialStandalone() {
        return original().replace(
          'function val(a,s){return a.from?clone(s[a.from]):',
          'function val(a,s){return a.from?clone(state[a.from]):'
        );
      };
      fixed.__sequentialFixed = true;
      standalone = fixed;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
