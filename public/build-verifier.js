(() => {
  'use strict';

  function clone(value) { return structuredClone(value); }
  function calc(value) {
    const source = String(value ?? '').replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
    if (!/^[0-9+\-*/.()\s]+$/.test(source)) throw new Error('Invalid expression');
    const result = Function('"use strict";return (' + source + ')')();
    if (!Number.isFinite(result)) throw new Error('Math error');
    return Number(result.toFixed(10));
  }
  function operand(action, state) {
    if (action.from) return clone(state[action.from]);
    if (action.by !== undefined) return clone(action.by);
    return clone(action.value);
  }
  function run(app, state, event) {
    for (const rule of (app.rules || []).filter(rule => rule.event === event)) {
      for (const action of rule.actions || []) {
        const value = operand(action, state);
        const current = state[action.target];
        if (action.op === 'set') state[action.target] = value;
        else if (action.op === 'append' || action.op === 'concat') state[action.target] = String(current ?? '') + String(value ?? '');
        else if (action.op === 'increment' || action.op === 'add') state[action.target] = Number(current || 0) + Number(value ?? 1);
        else if (action.op === 'decrement' || action.op === 'subtract') state[action.target] = Number(current || 0) - Number(value ?? 1);
        else if (action.op === 'multiply') state[action.target] = Number(current || 0) * Number(value ?? 1);
        else if (action.op === 'divide') state[action.target] = Number(value) === 0 ? 'Error' : Number(current || 0) / Number(value);
        else if (action.op === 'clear') state[action.target] = typeof current === 'number' ? 0 : '';
        else if (action.op === 'calculate') { try { state[action.target] = calc(value); } catch { state[action.target] = 'Error'; } }
      }
    }
  }
  function buttonByLabel(app, label) {
    const aliases = { '×': ['×', '*', 'x', 'X'], '÷': ['÷', '/'], '−': ['−', '-'], 'C': ['C', 'AC', 'Clear'] };
    const wanted = aliases[label] || [label];
    return (app.components || []).find(component => component.type === 'button' && wanted.includes(String(component.label ?? component.text ?? '')));
  }
  function verify(app) {
    const checks = [];
    const add = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
    const stateKeys = new Set(Object.keys(app?.state || {}));
    const buttons = (app?.components || []).filter(component => component.type === 'button');
    const events = new Map();
    for (const rule of app?.rules || []) events.set(rule.event, (events.get(rule.event) || 0) + 1);
    add('Every visible button is connected', buttons.every(button => button.event && events.has(button.event)));
    add('Button events are not duplicated', buttons.every(button => events.get(button.event) === 1));
    add('All display bindings exist', (app?.components || []).every(component => !component.bind || stateKeys.has(component.bind)));
    add('All actions use valid state', (app?.rules || []).every(rule => (rule.actions || []).every(action => stateKeys.has(action.target) && (!action.from || stateKeys.has(action.from)))));

    const digit2 = buttonByLabel(app, '2'), multiply = buttonByLabel(app, '×'), digit3 = buttonByLabel(app, '3'), equals = buttonByLabel(app, '='), clear = buttonByLabel(app, 'C');
    if (digit2 && multiply && digit3 && equals) {
      const testState = clone(app.state || {});
      const displayComponent = (app.components || []).find(component => component.type === 'display');
      const displayKey = displayComponent?.bind;
      run(app, testState, digit2.event);
      add('Single tap displays 2', displayKey && String(testState[displayKey]) === '2', displayKey ? String(testState[displayKey]) : 'no display');
      run(app, testState, multiply.event);
      add('Operator appears immediately', displayKey && /[×*x]$/.test(String(testState[displayKey])), displayKey ? String(testState[displayKey]) : 'no display');
      run(app, testState, digit3.event);
      add('Expression displays 2 × 3', displayKey && /^2\s*[×*x]\s*3$/.test(String(testState[displayKey])), displayKey ? String(testState[displayKey]) : 'no display');
      run(app, testState, equals.event);
      add('2 × 3 equals 6', displayKey && Number(testState[displayKey]) === 6, displayKey ? String(testState[displayKey]) : 'no display');
      if (clear) {
        run(app, testState, clear.event);
        add('Clear returns display to zero', displayKey && String(testState[displayKey]) === '0', displayKey ? String(testState[displayKey]) : 'no display');
      }
    }
    return { passed: checks.every(check => check.pass), checks, failures: checks.filter(check => !check.pass) };
  }
  function show(report, repaired = false) {
    if (typeof log !== 'function') return;
    log((repaired ? 'Retest' : 'Build verification') + ': ' + report.checks.filter(check => check.pass).length + '/' + report.checks.length + ' passed', report.passed ? 'ok' : 'bad');
    for (const check of report.checks) log((check.pass ? '✓ ' : '✗ ') + check.name + (check.detail && !check.pass ? ` — ${check.detail}` : ''), check.pass ? 'ok' : 'bad');
  }

  const originalRequest = request;
  let repairing = false;
  request = async function verifiedRequest(editing) {
    await originalRequest(editing);
    if (!currentApp) return;
    let report = verify(currentApp);
    show(report);
    window.AtomOSVerification = report;
    if (report.passed || repairing) return;

    repairing = true;
    const promptBox = document.getElementById('prompt');
    const previousPrompt = promptBox.value;
    promptBox.value = 'Repair only the failed verification checks below. Preserve all working components and behaviour. Failed checks: ' + report.failures.map(item => item.name + (item.detail ? ` (${item.detail})` : '')).join('; ') + '. Return the complete corrected application.';
    log('Verification failed. AtomOS is repairing and retesting once…', 'bad');
    await originalRequest(true);
    promptBox.value = previousPrompt;
    if (currentApp) {
      report = verify(currentApp);
      show(report, true);
      window.AtomOSVerification = report;
    }
    repairing = false;
  };

  window.AtomOSVerifier = { verify };
})();