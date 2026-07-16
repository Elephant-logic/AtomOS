(() => {
  'use strict';

  const LIBRARY_KEY = 'atomos-atom-factory-v1';
  const VERSION = '0.2';

  function slug(value) {
    return String(value || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
  }

  function textFor(item) {
    return [item.name, item.id, item.kind, ...(item.sources || []), ...(item.connectors?.inputs || []), ...(item.connectors?.outputs || [])]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function semanticKind(item) {
    const text = textFor(item);
    const original = String(item.kind || 'unknown').toLowerCase();

    if (/newton|gravity|gravitational/.test(text)) return 'physics.gravity';
    if (/collision|hitbox|intersect/.test(text)) return 'physics.collision';
    if (/velocity|acceleration|force|mass|physics/.test(text)) return 'physics.engine';
    if (/websocket|socket\.io|realtime|real-time/.test(text)) return 'network.websocket';
    if (/fetch|axios|http|rest|api\.client|api\.route/.test(text) || original.startsWith('api.')) return 'network.http';
    if (/login|logout|signup|sign-up|authentication|oauth|jwt|session user/.test(text)) return 'identity.authentication';
    if (/database|sqlite|postgres|mysql|indexeddb/.test(text)) return 'storage.database';
    if (/localstorage|sessionstorage|browser storage|capability\.storage/.test(text)) return 'storage.local';
    if (/audio|sound|music|playback|oscillator/.test(text)) return 'media.audio';
    if (/camera|webcam|video capture/.test(text)) return 'media.camera';
    if (/microphone|speech|voice input/.test(text)) return 'media.microphone';
    if (/chart|graph plot|visualization|visualisation/.test(text)) return 'graphics.chart';
    if (/canvas|webgl|renderer|sprite/.test(text)) return 'graphics.canvas';
    if (/drag|drop|draggable|pointermove/.test(text)) return 'input.drag-drop';
    if (/gesture|swipe|pinch/.test(text)) return 'input.gesture';
    if (/keyboard|keydown|keyup|space key/.test(text)) return 'input.keyboard';
    if (/gamepad|controller/.test(text)) return 'input.gamepad';
    if (/timer|interval|timeout|stopwatch|countdown|pomodoro/.test(text)) return 'time.interval';
    if (/notification|toast|alert/.test(text)) return 'device.notification';
    if (/clipboard|copy|paste/.test(text)) return 'device.clipboard';
    if (/geolocation|gps|location/.test(text)) return 'device.location';
    if (/share sheet|navigator\.share/.test(text)) return 'device.share';
    if (/form|validation/.test(text)) return 'ui.form';
    if (/input|textbox|field/.test(text) || original === 'ui.input') return 'ui.input';
    if (/button|action control/.test(text) || original === 'ui.button') return 'ui.button';
    if (/canvas/.test(original)) return 'graphics.canvas';
    if (original.startsWith('capability.')) return original.replace('capability.', 'runtime.');
    if (original === 'interface') return 'application.interface';
    if (original === 'logic') return 'application.logic';
    if (original === 'service') return 'application.service';
    return original;
  }

  function tagsFor(item, kind) {
    const tags = new Set(String(kind).split('.'));
    const text = textFor(item);
    for (const tag of ['reusable', item.level || 'atom']) tags.add(tag);
    if (/mobile|touch|tap/.test(text)) tags.add('mobile');
    if (/offline|cache|service worker/.test(text)) tags.add('offline');
    if (/persistent|storage|database/.test(text)) tags.add('persistent');
    if (/real-time|realtime|websocket/.test(text)) tags.add('realtime');
    return [...tags].filter(Boolean).slice(0, 12);
  }

  function mergeEntries(items) {
    const merged = new Map();
    for (const raw of items) {
      const item = { ...raw };
      item.kind = semanticKind(item);
      item.semanticKind = item.kind;
      item.tags = tagsFor(item, item.kind);
      item.taxonomyVersion = VERSION;
      item.signature = `${item.level || 'atom'}:${item.kind}:${slug(item.name || item.id)}`;
      const existing = merged.get(item.signature);
      if (!existing) {
        merged.set(item.signature, item);
        continue;
      }
      existing.seen = Number(existing.seen || 1) + Number(item.seen || 1);
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(item.confidence || 0));
      existing.status = existing.status === 'approved' || item.status === 'approved' ? 'approved' : existing.status || item.status;
      existing.sources = [...new Set([...(existing.sources || []), ...(item.sources || [])])].slice(0, 30);
      existing.tags = [...new Set([...(existing.tags || []), ...(item.tags || [])])].slice(0, 12);
      existing.connectors = existing.connectors || { inputs: [], outputs: [] };
      existing.connectors.inputs = [...new Set([...(existing.connectors.inputs || []), ...(item.connectors?.inputs || [])])].slice(0, 40);
      existing.connectors.outputs = [...new Set([...(existing.connectors.outputs || []), ...(item.connectors?.outputs || [])])].slice(0, 40);
      existing.atomIds = [...new Set([...(existing.atomIds || []), ...(item.atomIds || [])])].slice(0, 100);
      existing.updatedAt = new Date().toISOString();
    }
    return [...merged.values()];
  }

  function migrateLibrary() {
    let current;
    try { current = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); }
    catch { return 0; }
    if (!Array.isArray(current) || !current.length) return 0;
    const next = mergeEntries(current);
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    if (changed) localStorage.setItem(LIBRARY_KEY, JSON.stringify(next.slice(-500)));
    return next.length;
  }

  function categorySummary() {
    let library = [];
    try { library = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); } catch {}
    const counts = {};
    for (const item of library) {
      const category = String(item.kind || 'unknown').split('.')[0];
      counts[category] = (counts[category] || 0) + 1;
    }
    return counts;
  }

  function refreshFactorySoon() {
    setTimeout(() => {
      migrateLibrary();
      if (window.__atomFactoryView && window.AtomFactory?.renderFactory) window.AtomFactory.renderFactory();
    }, 50);
  }

  document.addEventListener('click', event => {
    const id = event.target?.id;
    if (id === 'learnImports' || id === 'learnApp') refreshFactorySoon();
  }, true);

  window.addEventListener('storage', event => {
    if (event.key === LIBRARY_KEY) refreshFactorySoon();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { migrateLibrary(); });
  } else {
    migrateLibrary();
  }

  window.AtomSemanticLibrary = { semanticKind, tagsFor, migrateLibrary, categorySummary, version: VERSION };
})();