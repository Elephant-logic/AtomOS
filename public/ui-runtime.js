(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function install() {
    if (typeof component !== 'function' || install.done) return false;
    const original = component;
    component = function componentWithBoundButtons(definition) {
      const element = original(definition);
      if (definition?.type === 'button') {
        if (definition.bind) element.textContent = String(state?.[definition.bind] ?? definition.label ?? definition.text ?? '');
        element.setAttribute('aria-label', definition.label || definition.text || definition.id || 'button');
        if (definition.bind) element.dataset.bind = definition.bind;
      }
      return element;
    };
    install.done = true;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts > 60) clearInterval(timer);
  }, 100);
})();