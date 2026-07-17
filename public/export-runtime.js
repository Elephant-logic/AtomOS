(() => {
  'use strict';

  const app = window.ATOMOS_APP || {};
  const state = structuredClone(app.state || {});
  const root = document.getElementById('root');
  const held = Object.create(null);
  const intervals = [];
  let sceneLoop = 0;
  let lastFrame = performance.now();

  function valueOf(action) { return action.from ? state[action.from] : action.value; }
  function activeScreen() { return app.activeScreen ? state[app.activeScreen] : null; }
  function visible(component) { return !component.screen || component.screen === activeScreen(); }

  function run(event) {
    for (const rule of (app.rules || []).filter(item => item.event === event)) {
      for (const action of rule.actions || []) {
        const value = valueOf(action);
        if (action.op === 'set') state[action.target] = structuredClone(value);
        else if (action.op === 'increment') state[action.target] = Number(state[action.target] || 0) + Number(value ?? action.by ?? 1);
        else if (action.op === 'decrement') state[action.target] = Number(state[action.target] || 0) - Number(value ?? action.by ?? 1);
        else if (action.op === 'toggle') state[action.target] = !state[action.target];
        else if (action.op === 'append') state[action.target] = String(state[action.target] ?? '') + String(value ?? '');
        else if (action.op === 'clear') state[action.target] = Array.isArray(state[action.target]) ? [] : '';
        else if (action.op === 'navigate') state[action.target] = value;
        else if (action.op === 'emit' && action.event) run(action.event);
      }
    }
    render();
  }

  function setupCapabilities() {
    for (const capability of app.capabilities || []) {
      if (capability.type === 'startup' && capability.event) queueMicrotask(() => run(capability.event));
      if (capability.type === 'keyboard' && capability.event) {
        addEventListener('keydown', event => {
          if (event.key === capability.keyboardKey || event.code === capability.keyboardKey) {
            if (capability.preventDefault) event.preventDefault();
            run(capability.event);
          }
        });
      }
      if (capability.type === 'interval' && capability.event) {
        const id = setInterval(() => {
          if (!capability.enabledWhen || state[capability.enabledWhen]) run(capability.event);
        }, Math.max(50, Number(capability.everyMs || 1000)));
        intervals.push(id);
      }
    }
  }

  function drawScene(canvas, component, now) {
    const ctx = canvas.getContext('2d');
    const world = component.world || {};
    const entities = Array.isArray(state[component.bind]) ? state[component.bind] : [];
    const width = canvas.width = Math.max(320, canvas.clientWidth * devicePixelRatio);
    const height = canvas.height = Math.max(220, Number(component.height || 360) * devicePixelRatio);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const vw = width / devicePixelRatio, vh = height / devicePixelRatio;
    const dt = Math.min(0.04, Math.max(0, (now - lastFrame) / 1000));
    const gravity = Number(world.gravity || 900);
    const player = entities.find(e => e.type === 'player' || e.id === 'player') || entities[0];
    const floorY = Math.min(Number(world.bounds?.height || 1000) - 32, 330);

    if (player && state.gameRunning !== false) {
      const speed = Number(player.speed || 190);
      if (held.ArrowLeft || state.playerAction === 'left') player.vx = -speed;
      else if (held.ArrowRight || state.playerAction === 'right') player.vx = speed;
      else player.vx = Number(player.vx || 0) * 0.78;
      const grounded = player.y + player.height >= floorY;
      if ((held[' '] || state.playerAction === 'jump') && grounded) player.vy = -Number(player.jumpSpeed || 430);
      player.vy = Number(player.vy || 0) + gravity * dt;
      player.x = Math.max(0, Number(player.x || 0) + Number(player.vx || 0) * dt);
      player.y = Number(player.y || 0) + Number(player.vy || 0) * dt;
      if (player.y + player.height > floorY) { player.y = floorY - player.height; player.vy = 0; }
      state.playerAction = '';

      for (const entity of entities) {
        if (entity === player || entity.removed) continue;
        if (entity.type === 'enemy' || entity.ai === 'patrol') {
          entity.vx = Number(entity.vx || -60);
          entity.x = Number(entity.x || 0) + entity.vx * dt;
          if (entity.x < 520 || entity.x > 900) entity.vx *= -1;
        }
        const hit = player.x < entity.x + (entity.width || 24) && player.x + player.width > entity.x && player.y < entity.y + (entity.height || 24) && player.y + player.height > entity.y;
        if (!hit) continue;
        if (entity.collectible || entity.type === 'coin') {
          entity.removed = true;
          state.coinsCollected = Number(state.coinsCollected || 0) + 1;
          state.score = Number(state.score || 0) + 100;
        } else if (entity.type === 'checkpoint') {
          state.lastCheckpoint = { x: entity.x, y: entity.y };
        } else if (entity.type === 'enemy') {
          state.lives = Number(state.lives || 1) - 1;
          const cp = state.lastCheckpoint || { x: 100, y: 250 };
          player.x = cp.x; player.y = cp.y; player.vx = 0; player.vy = 0;
          if (state.lives <= 0) { state.gameRunning = false; if (app.activeScreen) state[app.activeScreen] = 'gameOver'; render(); }
        }
      }
    }

    const cameraX = player ? Math.max(0, player.x - vw * 0.35) : 0;
    const sky = ctx.createLinearGradient(0, 0, 0, vh);
    sky.addColorStop(0, '#78c5ff'); sky.addColorStop(1, '#dff6ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = '#245c38'; ctx.fillRect(0, floorY, vw, vh - floorY);
    ctx.fillStyle = '#183d28';
    for (let x = -cameraX % 64; x < vw; x += 64) ctx.fillRect(x, floorY, 62, 14);

    for (const entity of entities) {
      if (entity.removed) continue;
      const x = Number(entity.x || 0) - cameraX, y = Number(entity.y || 0);
      if (x < -80 || x > vw + 80) continue;
      if (entity.type === 'player' || entity.id === 'player') ctx.fillStyle = '#2f5bea';
      else if (entity.type === 'coin' || entity.collectible) ctx.fillStyle = '#ffd23f';
      else if (entity.type === 'enemy') ctx.fillStyle = '#d94a4a';
      else if (entity.type === 'checkpoint') ctx.fillStyle = '#8a4fff';
      else ctx.fillStyle = '#334155';
      ctx.fillRect(x, y, Number(entity.width || 24), Number(entity.height || 24));
      if (entity.type === 'coin' || entity.collectible) {
        ctx.strokeStyle = '#9a6b00'; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, Number(entity.width || 24) - 4, Number(entity.height || 24) - 4);
      }
    }
  }

  function createComponent(component) {
    if (!visible(component)) return null;
    if (component.type === 'scene' || component.type === 'game') {
      const wrap = document.createElement('section'); wrap.className = 'scene-wrap full';
      const canvas = document.createElement('canvas'); canvas.className = 'game-canvas'; wrap.appendChild(canvas);
      const draw = now => { if (document.body.contains(canvas)) { drawScene(canvas, component, now); sceneLoop = requestAnimationFrame(draw); } };
      cancelAnimationFrame(sceneLoop); sceneLoop = requestAnimationFrame(draw);
      return wrap;
    }
    if (component.type === 'heading') { const e = document.createElement('h2'); e.className = 'full'; e.textContent = component.text || ''; return e; }
    if (component.type === 'text') { const e = document.createElement('p'); e.className = 'full'; e.textContent = component.bind ? String(state[component.bind] ?? '') : component.text || ''; return e; }
    if (component.type === 'display') { const e = document.createElement('div'); e.className = 'display'; e.innerHTML = `<small>${component.label || ''}</small><strong>${String(state[component.bind] ?? component.text ?? '')}</strong>`; return e; }
    if (component.type === 'button') { const e = document.createElement('button'); e.className = `button ${component.variant || ''}`; e.textContent = component.text || component.label || component.id; e.addEventListener('click', () => run(component.event)); return e; }
    if (component.type === 'sound') return null;
    const e = document.createElement('div'); e.className = 'full'; return e;
  }

  function render() {
    const shell = document.createElement('main'); shell.className = 'app';
    const title = document.createElement('h1'); title.textContent = app.title || 'AtomOS App'; shell.appendChild(title);
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const component of app.components || []) { const node = createComponent(component); if (node) grid.appendChild(node); }
    shell.appendChild(grid); root.replaceChildren(shell);
    lastFrame = performance.now();
  }

  addEventListener('keydown', event => { held[event.key] = true; if (['ArrowLeft','ArrowRight',' '].includes(event.key)) event.preventDefault(); });
  addEventListener('keyup', event => { held[event.key] = false; });
  addEventListener('beforeunload', () => intervals.forEach(clearInterval));
  render();
  setupCapabilities();
})();