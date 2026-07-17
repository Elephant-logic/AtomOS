'use strict';

const { APP_SCHEMA, ACTION_TYPES } = require('./app-schema');
const Condition = require('../public/condition-expression');

function parseEnabledWhen(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const direct = text.match(/^(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})$/);
  if (direct) return [direct[1]];
  const truthy = text.match(/^\(?\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})\s*(?:===|==|is)\s*true\s*\)?$/i);
  if (truthy) return [truthy[1]];
  if (/&&|\band\b/i.test(text)) throw new Error(`Interval enabledWhen cannot use AND expressions: ${text}`);
  const parts = text.split(/\s*(?:\|\||\bor\b)\s*/i).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const keys = parts.map(part => {
      const match = part.match(/^\(?\s*(?:state\.)?([A-Za-z][A-Za-z0-9_-]{0,39})(?:\s*(?:===|==|is)\s*true)?\s*\)?$/i);
      return match && match[1];
    });
    if (keys.every(Boolean)) return [...new Set(keys)];
  }
  throw new Error(`Interval enabledWhen must be one state key or an OR of state keys: ${text}`);
}

function normalizeApplication(app) {
  if (!app.state || typeof app.state !== 'object' || Array.isArray(app.state)) app.state = {};
  app.capabilities = Array.isArray(app.capabilities) ? app.capabilities : [];
  for (const timer of Array.isArray(app.timers) ? app.timers : []) {
    if (!app.capabilities.some(item => item.id === timer.id)) app.capabilities.push({ ...timer, type: 'interval' });
  }
  delete app.timers;
  const expandedCapabilities = [];
  for (const capability of app.capabilities) {
    if (capability.type !== 'interval' || !capability.enabledWhen) {
      expandedCapabilities.push(capability);
      continue;
    }
    const keys = parseEnabledWhen(capability.enabledWhen);
    if (keys.length <= 1) {
      expandedCapabilities.push({ ...capability, enabledWhen: keys[0] });
      continue;
    }
    keys.forEach((key, index) => {
      const suffix = `_${index + 1}`;
      const base = String(capability.id || 'interval').slice(0, Math.max(1, 40 - suffix.length));
      expandedCapabilities.push({ ...capability, id: `${base}${suffix}`, enabledWhen: key });
    });
  }
  app.capabilities = expandedCapabilities;
  if (Array.isArray(app.screens) && app.screens.length) {
    if (!app.activeScreen) app.activeScreen = 'activeScreen';
    if (app.state[app.activeScreen] === undefined) app.state[app.activeScreen] = app.screens[0];
  }
  const entityKey = Object.keys(app.state).find(key => Array.isArray(app.state[key]) && app.state[key].some(item => item && typeof item === 'object' && ('x' in item || 'vx' in item || 'controls' in item))) || 'entities';
  if (!Array.isArray(app.state[entityKey])) app.state[entityKey] = [];
  const buttons = new Map();
  for (const component of app.components || []) {
    if (component.type === 'board' && (!component.bind || !Array.isArray(app.state[component.bind]))) {
      component.type = 'scene';
      component.bind = entityKey;
      component.world = component.world || {};
      if (!component.world.map && Number(component.rows) > 0 && Number(component.cols) > 0) {
        component.world.map = { rows: Number(component.rows), cols: Number(component.cols), tileWidth: 32, tileHeight: 32, tiles: Array(Number(component.rows) * Number(component.cols)).fill(0), solidTiles: [1] };
      }
      delete component.rows; delete component.cols; delete component.indexState; delete component.event;
    }
    if (component.type === 'button') {
      if (!component.event) component.event = `${component.id}.click`;
      buttons.set(component.id, component);
    }
    if (component.type === 'board') {
      if (!component.event) component.event = `${component.id}.select`;
      if (!component.indexState) component.indexState = `${component.id}Index`;
      if (app.state[component.indexState] === undefined) app.state[component.indexState] = 0;
    }
    if (component.type === 'repeat' && component.itemEvent) {
      if (!component.itemIndexState) component.itemIndexState = `${component.id}Index`;
      if (app.state[component.itemIndexState] === undefined) app.state[component.itemIndexState] = 0;
    }
  }
  const visibleEvents = new Set([...buttons.values()].map(button => button.event));
  for (const rule of app.rules || []) {
    if (!visibleEvents.has(rule.event)) {
      const button = buttons.get(String(rule.event || '').replace(/\.(click|press|tap)$/i, ''));
      if (button) rule.event = button.event;
    }
    for (const action of rule.actions || []) {
      const source = String(action.from || '').toLowerCase(), target = String(action.target || '').toLowerCase();
      if (action.op === 'calculate' && /(elapsed|seconds|duration|remaining|time)/.test(source) && /(display|formatted|time)/.test(target)) action.op = 'format_time';
      if ((action.op === 'increment' || action.op === 'decrement') && action.by !== undefined && action.value === undefined) action.value = action.by;
    }
  }
  return app;
}

function validateReferences(app) {
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error('The model returned an invalid application object');
  if (!app.state || typeof app.state !== 'object' || Array.isArray(app.state)) throw new Error('Application state is missing');
  if (!Array.isArray(app.components) || !app.components.length) throw new Error('Application components are missing');
  if (!Array.isArray(app.rules)) throw new Error('Application rules are missing');
  if (!Array.isArray(app.capabilities)) app.capabilities = [];
  const stateKeys = new Set(Object.keys(app.state));
  const componentIds = new Set(), capabilityIds = new Set(), entryEvents = new Set(), ruleEvents = new Set(), emittedEvents = new Set();
  const screens = new Set(Array.isArray(app.screens) ? app.screens : []);
  if (screens.size && !stateKeys.has(app.activeScreen)) throw new Error(`activeScreen state key is missing: ${app.activeScreen}`);
  for (const component of app.components) {
    if (!component.id || !component.type) throw new Error('Every component needs an id and type');
    if (componentIds.has(component.id)) throw new Error(`Duplicate component id: ${component.id}`);
    componentIds.add(component.id);
    if (component.bind && !stateKeys.has(component.bind)) throw new Error(`Unknown binding: ${component.bind}`);
    for (const field of ['visibleWhen','hiddenWhen','enabledWhen','disabledWhen']) if (component[field]) {
      let referenced;
      try { referenced = Condition.extractStateKeys(component[field]); }
      catch (error) { throw new Error(`Component ${component.id} has invalid ${field} condition: ${error.message}`); }
      for (const key of referenced) if (!stateKeys.has(key)) throw new Error(`Component ${component.id} references unknown state key: ${key}`);
    }
    for (const field of ['indexState','itemIndexState']) if (component[field] && !stateKeys.has(component[field])) throw new Error(`Component ${component.id} references unknown state key: ${component[field]}`);
    if (component.screen && !screens.has(component.screen)) throw new Error(`Component ${component.id} references unknown screen: ${component.screen}`);
    if (component.type === 'board') {
      if (!component.bind || !Array.isArray(app.state[component.bind])) throw new Error(`Board ${component.id} needs a bind to a list state key`);
      if (!component.indexState) throw new Error(`Board ${component.id} needs an indexState state key`);
      if (!Number.isFinite(Number(component.rows)) || !Number.isFinite(Number(component.cols))) throw new Error(`Board ${component.id} needs rows and cols`);
    }
    if (component.type === 'scene' && (!component.bind || !Array.isArray(app.state[component.bind]))) throw new Error(`Scene ${component.id} needs a bind to an entity list state key`);
    if (component.type === 'repeat') {
      if (!component.bind || !Array.isArray(app.state[component.bind])) throw new Error(`Repeat ${component.id} needs a bind to a list state key`);
      if (component.itemEvent && !component.itemIndexState) throw new Error(`Repeat ${component.id} with itemEvent needs itemIndexState`);
      if (component.itemEvent) entryEvents.add(component.itemEvent);
    }
    if (component.type === 'group' && (!Array.isArray(component.children) || !component.children.length)) throw new Error(`Group ${component.id} needs children`);
    if (component.type === 'image' && (!component.src || !/^(https:\/\/|data:image\/)/i.test(component.src))) throw new Error(`Image ${component.id} needs an https or data:image src`);
    if (component.type === 'link') {
      const hasHref = Boolean(component.href), hasScreen = Boolean(component.toScreen);
      if (hasHref === hasScreen) throw new Error(`Link ${component.id} needs exactly one of href or toScreen`);
      if (hasScreen && !screens.has(component.toScreen)) throw new Error(`Link ${component.id} references unknown screen: ${component.toScreen}`);
      if (hasHref && !/^(https?:\/\/|mailto:)/i.test(component.href)) throw new Error(`Link ${component.id} href must be http(s) or mailto`);
    }
    if (component.event) entryEvents.add(component.event);
  }
  for (const component of app.components) if (component.type === 'group') for (const child of component.children) {
    if (!componentIds.has(child)) throw new Error(`Group ${component.id} references unknown child: ${child}`);
    if (child === component.id) throw new Error(`Group ${component.id} cannot contain itself`);
  }
  for (const capability of app.capabilities) {
    if (!capability.id || !capability.type) throw new Error('Every capability needs id and type');
    if (capabilityIds.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
    capabilityIds.add(capability.id);
    if (capability.type === 'interval') {
      if (!capability.event || !Number.isFinite(Number(capability.everyMs))) throw new Error(`Interval capability ${capability.id} needs event and everyMs`);
      if (capability.enabledWhen && !stateKeys.has(capability.enabledWhen)) throw new Error(`Unknown interval state key: ${capability.enabledWhen}`);
      entryEvents.add(capability.event);
    } else if (capability.type === 'storage') {
      if (!Array.isArray(capability.stateKeys) || !capability.stateKeys.length) throw new Error(`Storage capability ${capability.id} needs stateKeys`);
      for (const key of capability.stateKeys) if (!stateKeys.has(key)) throw new Error(`Unknown storage state key: ${key}`);
    } else if (capability.type === 'startup') { if (!capability.event) throw new Error(`Startup capability ${capability.id} needs event`); entryEvents.add(capability.event); }
    else if (capability.type === 'keyboard') { if (!capability.event || !capability.keyboardKey) throw new Error(`Keyboard capability ${capability.id} needs event and keyboardKey`); entryEvents.add(capability.event); }
    else throw new Error(`Unsupported capability type: ${capability.type}`);
  }
  for (const rule of app.rules) {
    if (!rule.event || !Array.isArray(rule.actions)) throw new Error('Every rule needs an event and actions');
    if (ruleEvents.has(rule.event)) throw new Error(`Duplicate rule event: ${rule.event}`);
    ruleEvents.add(rule.event);
    for (const action of rule.actions) {
      if (!stateKeys.has(action.target)) throw new Error(`Unknown action target: ${action.target}`);
      if (action.from && !stateKeys.has(action.from)) throw new Error(`Unknown action source: ${action.from}`);
      if (action.indexFrom && !stateKeys.has(action.indexFrom)) throw new Error(`Unknown index source: ${action.indexFrom}`);
      if (action.when && !stateKeys.has(action.when.state)) throw new Error(`Unknown condition state key: ${action.when.state}`);
      if (action.op === 'format_time' && !action.from) throw new Error('format_time needs a numeric source state key');
      if (action.op === 'navigate') {
        if (!screens.size) throw new Error('navigate needs the application to declare screens');
        if (action.target !== app.activeScreen) throw new Error(`navigate must target the activeScreen state key: ${app.activeScreen}`);
        if (!screens.has(action.value)) throw new Error(`navigate value must be a declared screen: ${action.value}`);
      }
      if (action.op === 'emit') { if (!action.event) throw new Error('emit needs an event name'); emittedEvents.add(action.event); }
    }
  }
  for (const event of emittedEvents) if (!ruleEvents.has(event)) throw new Error(`Emitted event has no matching rule: ${event}`);
  for (const event of ruleEvents) if (!entryEvents.has(event) && !emittedEvents.has(event)) throw new Error(`Rule cannot be reached from a visible control, capability or emitted event: ${event}`);
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) for (const part of item.content || []) if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  return '';
}

async function buildApp(prompt, currentApp) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on Render');
  const model = process.env.OPENAI_MODEL || 'gpt-5-mini';
  const editing = currentApp && typeof currentApp === 'object';
  const input = editing ? `CURRENT APPLICATION:\n${JSON.stringify(currentApp)}\n\nCHANGE REQUEST:\n${prompt}` : prompt;
  const instructions = [
    'You are the AtomOS application architect. Return only one complete application matching the supplied JSON schema.',
    editing ? 'Revise the current application and preserve unrelated working features and stable ids.' : 'Build one complete small interactive application.',
    'Every button, board and repeat item event must have a matching rule. Every bind, condition and action target must name a state key.',
    'Interval enabledWhen accepts exactly one state key. Do not write JavaScript expressions such as a || b or a && b; create separate interval capabilities when different state keys should enable the same event.',
    'Use scene, not board, for real-time platformers, physics games, sprites, camera-follow worlds and tile-map levels. Scene bind must point to an entity-list state key. Use board only for clickable grid and turn-based games, and board bind must point to a flat list state key.',
    'Use screens plus activeScreen and navigate for multi-page websites, menus, game scenes and dialogs. Untagged components are shared chrome.',
    'Use board with rows, cols, list bind and indexState for tile and turn-based games. Use list_set or list_remove with indexFrom.',
    'Use group with child ids and row, column, grid or stack layout instead of inventing special layout components.',
    'Use repeat for lists, galleries, shops, inventories, cards and scoreboards. Bind it to a list; itemEvent and itemIndexState make items interactive.',
    'Use visibleWhen, hiddenWhen, enabledWhen and disabledWhen for declarative UI conditions. They accept state keys or expressions such as activeScreen == "menu", score >= 10, !paused, ready && connected. Quote string values when possible; bare comparison values are treated as strings.',
    'Images require https or data:image sources. Links require either a safe external href or a declared toScreen target.',
    'Use interval, storage, startup and keyboard capabilities. Make the result responsive and mobile friendly.'
  ].join(' ');
  const response = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'}, body:JSON.stringify({model,instructions,input,text:{format:{type:'json_schema',name:'atomos_application',strict:false,schema:APP_SCHEMA}}}) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed (${response.status})`);
  const text = extractOutputText(payload);
  if (!text) throw new Error('The model returned no application');
  const app = normalizeApplication(JSON.parse(text));
  validateReferences(app);
  return { app, model, responseId: payload.id, mode: editing ? 'edit' : 'build', capabilities: app.capabilities.map(({ id, type }) => ({ id, type })) };
}

module.exports = { normalizeApplication, validateReferences, buildApp, APP_SCHEMA, ACTION_TYPES, parseEnabledWhen };
