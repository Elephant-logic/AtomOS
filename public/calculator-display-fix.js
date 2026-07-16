(() => {
  'use strict';

  function prettyExpression(value) {
    return String(value ?? '')
      .replaceAll('*', '×')
      .replaceAll('/', '÷')
      .replaceAll('-', '−');
  }

  function calculatorContext(event) {
    if (!currentApp || !Array.isArray(currentApp.components) || !Array.isArray(currentApp.rules)) return null;
    const isCalculator = /calculator/i.test(String(currentApp.title || '') + ' ' + String(currentApp.description || '')) ||
      currentApp.rules.some(rule => (rule.actions || []).some(action => action.op === 'calculate'));
    if (!isCalculator) return null;

    const button = currentApp.components.find(component => component.type === 'button' && component.event === event);
    if (!button) return null;
    const label = String(button.label || button.text || button.id || '').trim();
    if (/^(=|equals?|c|clear|ac)$/i.test(label)) return null;
    if (!/^(?:\d|\.|\+|−|-|×|x|\*|÷|\/)$/i.test(label)) return null;

    const expressionKey = Object.keys(currentApp.state || {}).find(key => /^expression$/i.test(key)) ||
      Object.keys(currentApp.state || {}).find(key => /expression|equation|formula/i.test(key));
    const display = currentApp.components.find(component => component.type === 'display' && component.bind);
    if (!expressionKey || !display?.bind) return null;
    return { expressionKey, displayKey: display.bind };
  }

  function install() {
    if (typeof runEvent !== 'function' || runEvent.__calculatorDisplayFixed) return false;
    const original = runEvent;
    const wrapped = function atomosImmediateCalculatorDisplay(event) {
      original(event);
      const context = calculatorContext(event);
      if (!context) return;
      state[context.displayKey] = prettyExpression(state[context.expressionKey]);
      if (typeof render === 'function') render();
    };
    wrapped.__calculatorDisplayFixed = true;
    runEvent = wrapped;
    return true;
  }

  if (!install()) {
    const handle = setInterval(() => {
      if (install()) clearInterval(handle);
    }, 25);
    setTimeout(() => clearInterval(handle), 10000);
  }
})();
