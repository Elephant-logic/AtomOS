(() => {
  'use strict';

  const LIBRARY_KEY = 'atomos-atom-factory-v1';
  const RECEIPT_KEY = 'atomos-capability-build-receipts-v1';
  const MAX_RECEIPTS = 30;

  const BUILT_INS = new Set([
    'runtime.state', 'runtime.rules', 'runtime.conditions', 'runtime.lists',
    'time.interval', 'storage.local', 'runtime.startup', 'input.keyboard',
    'ui.button', 'ui.input', 'ui.display', 'ui.text'
  ]);

  const SIGNALS = [
    ['time.interval', /timer|stopwatch|countdown|pomodoro|every second|interval|schedule/i],
    ['storage.local', /save|remember|persist|offline state|reload|between visits/i],
    ['input.keyboard', /keyboard|key press|space key|arrow key/i],
    ['input.touch', /touch|tap|mobile|phone|swipe|gesture/i],
    ['graphics.canvas', /canvas|drawing|paint|sprite|game board|visual simulation/i],
    ['physics.gravity', /gravity|newton|orbit|mass|force/i],
    ['physics.collision', /collision|hitbox|intersect|bounce/i],
    ['network.http', /api|http|fetch|rest|remote data/i],
    ['network.websocket', /websocket|real.?time|multiplayer|live sync/i],
    ['identity.authentication', /login|sign.?up|account|authentication|oauth/i],
    ['storage.database', /database|records|customers|inventory|orders|sql/i],
    ['graphics.chart', /chart|analytics|graph|plot|dashboard/i],
    ['media.audio', /audio|sound|music|beep/i],
    ['media.camera', /camera|photo|scan|barcode/i],
    ['device.location', /gps|geolocation|map|location/i],
    ['device.notification', /notification|reminder|alert me/i],
    ['device.clipboard', /clipboard|copy|paste/i],
    ['device.share', /share sheet|share button/i],
    ['input.drag-drop', /drag|drop|kanban/i],
    ['data.collection', /todo|list|collection|catalog|products|items/i],
    ['ui.form', /form|validation|fields|survey/i]
  ];

  function load(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function slug(value) {
    return String(value || 'capability').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'capability';
  }

  function requiredCapabilities(prompt) {
    const required = new Set(['runtime.state', 'runtime.rules']);
    for (const [kind, pattern] of SIGNALS) if (pattern.test(prompt)) required.add(kind);
    if (/button|start|stop|reset|submit|clear|add|remove/i.test(prompt)) required.add('ui.button');
    if (/input|enter|type|search|email|password/i.test(prompt)) required.add('ui.input');
    return [...required];
  }

  function approvedLibrary() {
    return load(LIBRARY_KEY).filter(item => item.status === 'approved');
  }

  function findProvider(kind, library) {
    return library.find(item => item.kind === kind || item.semanticKind === kind || (item.tags || []).includes(kind));
  }

  function planFor(prompt) {
    const library = approvedLibrary();
    const required = requiredCapabilities(prompt);
    const resolved = [];
    const missing = [];
    for (const kind of required) {
      if (BUILT_INS.has(kind)) resolved.push({ kind, provider: 'built-in runtime' });
      else {
        const provider = findProvider(kind, library);
        if (provider) resolved.push({ kind, provider: provider.name, id: provider.id });
        else missing.push(kind);
      }
    }
    return { required, resolved, missing, createdAt: new Date().toISOString() };
  }

  function planText(plan) {
    const resolved = plan.resolved.map(x => `${x.kind} -> ${x.provider}`).join('; ') || 'none';
    const missing = plan.missing.join(', ') || 'none';
    return [
      'ATOMOS CAPABILITY-FIRST BUILD PROCESS:',
      '1. Compose from existing runtime primitives and approved reusable library parts.',
      '2. Preserve connector contracts of reused parts.',
      '3. For missing behavior, first synthesize it from supported declarative actions and capabilities.',
      '4. Never invent unrestricted JavaScript, packages, permissions, network access, device access or secrets.',
      '5. Make the result mobile-friendly and test each visible control through its matching event and rule.',
      `Required capabilities: ${plan.required.join(', ')}.`,
      `Resolved providers: ${resolved}.`,
      `Unresolved capability concepts: ${missing}.`,
      'If an unresolved concept cannot be represented by the supplied schema, build the safest useful supported subset rather than pretending unsupported access exists.'
    ].join('\n');
  }

  function mergeCandidate(kind, sourceTitle) {
    if (BUILT_INS.has(kind)) return;
    const library = load(LIBRARY_KEY);
    const signature = `atom:${kind}:${slug(kind)}`;
    const existing = library.find(item => item.signature === signature || item.kind === kind);
    if (existing) {
      existing.seen = Number(existing.seen || 1) + 1;
      existing.requested = Number(existing.requested || 0) + 1;
      existing.updatedAt = new Date().toISOString();
    } else {
      library.push({
        id: slug(kind), name: kind, level: 'atom', kind, semanticKind: kind,
        confidence: 0.45, connectors: { inputs: [], outputs: [] }, atomIds: [],
        sources: [sourceTitle || 'capability planner'], status: 'review', seen: 1, requested: 1,
        signature, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        candidateOnly: true
      });
    }
    save(LIBRARY_KEY, library.slice(-500));
  }

  function appCapabilityKinds(app) {
    const kinds = new Set(['runtime.state', 'runtime.rules']);
    for (const component of app?.components || []) kinds.add(`ui.${component.type}`);
    for (const capability of app?.capabilities || []) {
      const map = { interval: 'time.interval', storage: 'storage.local', startup: 'runtime.startup', keyboard: 'input.keyboard' };
      kinds.add(map[capability.type] || `runtime.${capability.type}`);
    }
    return [...kinds];
  }

  function recordReceipt(prompt, plan, app) {
    const provided = appCapabilityKinds(app);
    const unresolved = plan.required.filter(kind => !provided.includes(kind) && !plan.resolved.some(x => x.kind === kind && x.provider !== 'built-in runtime'));
    const receipts = load(RECEIPT_KEY);
    receipts.push({
      id: `build-${Date.now()}`, prompt: prompt.slice(0, 500), appTitle: app?.title || 'Untitled',
      required: plan.required, resolved: plan.resolved, provided, unresolved,
      createdAt: new Date().toISOString()
    });
    save(RECEIPT_KEY, receipts.slice(-MAX_RECEIPTS));
    for (const kind of unresolved) mergeCandidate(kind, app?.title);
    return unresolved;
  }

  function install() {
    if (typeof request !== 'function' || request.__capabilityOrchestrated) return false;
    const original = request;
    request = async function capabilityFirstRequest(editing) {
      const field = document.getElementById('prompt');
      const userPrompt = field?.value?.trim() || '';
      const plan = planFor(userPrompt);
      if (field) field.value = `${userPrompt}\n\n${planText(plan)}`.slice(0, 5900);
      if (typeof log === 'function') {
        log(`Capability plan: ${plan.required.length} required, ${plan.resolved.length} resolved, ${plan.missing.length} new concept(s).`);
      }
      try {
        const result = await original(editing);
        const app = (typeof currentApp !== 'undefined' && currentApp) || window.currentApp;
        if (app) {
          if (window.AtomFactory?.learnCurrentApp) window.AtomFactory.learnCurrentApp();
          const unresolved = recordReceipt(userPrompt, plan, app);
          if (typeof log === 'function') {
            log(unresolved.length
              ? `Build completed. ${unresolved.length} capability concept(s) saved for Factory review.`
              : 'Build completed with all planned capabilities resolved.', unresolved.length ? 'bad' : 'ok');
          }
        }
        return result;
      } finally {
        if (field) field.value = userPrompt;
      }
    };
    request.__capabilityOrchestrated = true;
    const build = document.getElementById('build');
    const edit = document.getElementById('edit');
    if (build) build.onclick = () => request(false);
    if (edit) edit.onclick = () => request(true);
    return true;
  }

  function mountReceiptCard() {
    const receipts = load(RECEIPT_KEY);
    const last = receipts.at(-1);
    if (!last || document.getElementById('capabilityReceipt')) return;
    const left = document.querySelector('.layout > .card');
    if (!left) return;
    const card = document.createElement('section');
    card.id = 'capabilityReceipt';
    card.innerHTML = `<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><h2>Last capability plan</h2><div class="log">${last.appTitle}: ${last.required.length} required · ${last.provided.length} provided · ${last.unresolved.length} awaiting Factory review</div>`;
    left.appendChild(card);
  }

  function boot() {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (install() || attempts > 40) clearInterval(timer);
    }, 100);
    mountReceiptCard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.AtomCapabilityOrchestrator = { planFor, requiredCapabilities, recordReceipt, receipts: () => load(RECEIPT_KEY) };
})();