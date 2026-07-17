(() => {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  let latest = null;
  let timer = null;

  function optionFor(button) {
    const text = String(button?.textContent || '').trim().toLowerCase();
    if (text.includes('full stack')) return 'fullstack';
    if (text.includes('code app')) return 'code';
    if (text.includes('build new')) return 'build';
    if (text.includes('change current')) return 'build';
    return null;
  }

  function candidateButtons() {
    return [...document.querySelectorAll('button')].filter(button => optionFor(button));
  }

  function ensureHint() {
    let hint = $('buildIntentHint');
    if (hint) return hint;
    const prompt = $('prompt');
    if (!prompt) return null;
    hint = document.createElement('div');
    hint.id = 'buildIntentHint';
    hint.className = 'muted';
    hint.style.cssText = 'margin-top:7px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;display:none';
    prompt.insertAdjacentElement('afterend', hint);
    return hint;
  }

  function paint(result) {
    latest = result;
    const hint = ensureHint();
    if (hint) {
      hint.style.display = 'block';
      hint.textContent = `Detected: ${result.intent} · Recommended option: ${result.label}`;
    }
    for (const button of candidateButtons()) {
      const recommended = optionFor(button) === result.option;
      button.dataset.intentRecommended = recommended ? 'true' : 'false';
      button.style.boxShadow = recommended ? '0 0 0 2px var(--ok)' : '';
      button.title = recommended ? `Recommended for this ${result.intent} prompt` : button.title;
    }
  }

  async function classify() {
    const prompt = $('prompt')?.value.trim();
    if (!prompt || prompt.length < 3) {
      latest = null;
      const hint = ensureHint(); if (hint) hint.style.display = 'none';
      candidateButtons().forEach(button => { button.style.boxShadow = ''; delete button.dataset.intentRecommended; });
      return null;
    }
    try {
      const response = await fetch('/api/build-intent', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt })
      });
      const data = await response.json();
      if (response.ok) paint(data);
      return response.ok ? data : null;
    } catch { return null; }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(classify, 280);
  }

  document.addEventListener('input', event => { if (event.target?.id === 'prompt') schedule(); });
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    const selected = optionFor(button);
    if (!selected || !latest || latest.confidence < 0.67 || selected === latest.option) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const message = `Prompt classified as ${latest.intent}. Use ${latest.label} instead of ${button.textContent.trim()}.`;
    if (typeof window.log === 'function') window.log(message, 'bad');
    const hint = ensureHint(); if (hint) { hint.style.display = 'block'; hint.textContent = message; }
  }, true);

  function mount() { ensureHint(); if ($('prompt')?.value.trim()) schedule(); }
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.AtomOSBuildRouter = { classify, latest: () => latest };
})();
