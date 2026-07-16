(() => {
  'use strict';

  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;

  const RESOURCE_KEY = 'atomos-build-resources-v1';
  let activeResources = [];
  let bypassOnce = false;

  const DEFINITIONS = [
    { id:'logo', type:'resource.image', label:'Logo', test:/\b(logo|brand mark|app icon)\b/i, accept:'image/*', required:true },
    { id:'hero', type:'resource.image', label:'Main image', test:/\b(hero image|background image|cover image|product image|photo|picture)\b/i, accept:'image/*', required:true },
    { id:'audio', type:'resource.audio', label:'Audio or sound', test:/\b(audio|sound effect|music|voice clip)\b/i, accept:'audio/*', required:true },
    { id:'video', type:'resource.video', label:'Video', test:/\b(video|intro clip|background video)\b/i, accept:'video/*', required:true },
    { id:'api', type:'service.api', label:'External API', test:/\b(api|weather data|live data|exchange rate|maps|openai|stripe|supabase|firebase)\b/i, required:true },
    { id:'database', type:'service.database', label:'Database provider', test:/\b(database|cloud sync|accounts|login|shared data|backend)\b/i, required:true },
    { id:'camera', type:'permission.camera', label:'Camera permission', test:/\b(camera|scan qr|take photo|webcam)\b/i, required:true },
    { id:'location', type:'permission.location', label:'Location permission', test:/\b(gps|location|nearby|map of me|geolocation)\b/i, required:true },
    { id:'graphics', type:'graphics.provider', label:'Graphics provider', test:/\b(3d|webgl|advanced graphics|chart|physics simulation|canvas game)\b/i, required:true }
  ];

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(RESOURCE_KEY) || '{}'); }
    catch { return {}; }
  }

  function saveForApp(title, resources) {
    const store = loadStore();
    store[String(title || 'untitled')] = resources.map(({ data, ...item }) => ({ ...item, data }));
    localStorage.setItem(RESOURCE_KEY, JSON.stringify(store));
  }

  function resourcesFor(app) {
    const store = loadStore();
    return store[String(app?.title || 'untitled')] || activeResources || [];
  }

  function detect(prompt) {
    return DEFINITIONS.filter(def => def.test.test(prompt)).map(def => ({ ...def, status:'waiting', choice:'', data:'', fileName:'' }));
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file selected'));
      if (file.size > 3_000_000) return reject(new Error('Keep uploaded resources under 3 MB each.'));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
  }

  function requirementSummary(resources) {
    return resources.map(item => {
      if (item.choice === 'upload') return `${item.type} id=${item.id} supplied by user as ${item.fileName || 'uploaded file'}`;
      if (item.choice === 'provider') return `${item.type} id=${item.id} provider=${item.provider || 'user-selected'}; credentials must stay in secure server environment variables`;
      if (item.choice === 'builtin') return `${item.type} id=${item.id} use approved built-in provider`;
      if (item.choice === 'placeholder') return `${item.type} id=${item.id} use a clearly labelled placeholder`;
      return `${item.type} id=${item.id} omitted by user`;
    }).join('\n');
  }

  function ensureStyles() {
    if (document.getElementById('atomosRequirementStyles')) return;
    const style = document.createElement('style');
    style.id = 'atomosRequirementStyles';
    style.textContent = `
      .atomos-req-backdrop{position:fixed;inset:0;background:#101827aa;z-index:9999;display:grid;place-items:center;padding:16px}
      .atomos-req-modal{width:min(680px,100%);max-height:88vh;overflow:auto;background:white;border-radius:18px;padding:20px;box-shadow:0 24px 90px #0006;color:#162238}
      .atomos-req-card{border:1px solid #d8e1ee;border-radius:12px;padding:13px;margin:10px 0}
      .atomos-req-card.done{border-color:#4aa96c;background:#f1fff5}.atomos-req-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
      .atomos-req-actions button,.atomos-req-modal button{padding:10px 13px;border-radius:9px;border:1px solid #cbd6e5;background:#f4f7fb;font-weight:700}
      .atomos-req-modal .primary{background:#2869e8;color:white;border-color:#2869e8}.atomos-req-preview{max-width:100%;max-height:150px;border-radius:10px;margin-top:8px}
      .atomos-user-resources{grid-column:1/-1;display:grid;gap:10px}.atomos-user-resources img{max-width:100%;max-height:280px;object-fit:contain;border-radius:12px;border:1px solid #d7e0ec}
    `;
    document.head.appendChild(style);
  }

  function ask(resources) {
    ensureStyles();
    return new Promise(resolve => {
      const backdrop = document.createElement('div'); backdrop.className = 'atomos-req-backdrop';
      const modal = document.createElement('div'); modal.className = 'atomos-req-modal';
      modal.innerHTML = '<h2>AtomOS needs a few things</h2><p>Resolve these requirements before the build continues. Uploaded files stay in this browser and are not sent to the AI.</p>';
      const cards = document.createElement('div'); modal.appendChild(cards);
      const footer = document.createElement('div'); footer.className = 'atomos-req-actions';
      const cancel = document.createElement('button'); cancel.textContent = 'Cancel build';
      const continueButton = document.createElement('button'); continueButton.className = 'primary'; continueButton.textContent = 'Continue build'; continueButton.disabled = true;
      footer.append(cancel, continueButton); modal.appendChild(footer); backdrop.appendChild(modal); document.body.appendChild(backdrop);

      const refresh = () => {
        cards.replaceChildren();
        for (const item of resources) {
          const card = document.createElement('div'); card.className = 'atomos-req-card' + (item.status === 'done' ? ' done' : '');
          card.innerHTML = `<b>${item.label}</b><div>${item.type}</div><small>${item.status === 'done' ? 'Resolved: ' + item.choice : 'Waiting for your choice'}</small>`;
          const actions = document.createElement('div'); actions.className = 'atomos-req-actions';

          if (item.accept) {
            const upload = document.createElement('button'); upload.textContent = 'Upload';
            const input = document.createElement('input'); input.type = 'file'; input.accept = item.accept; input.hidden = true;
            upload.onclick = () => input.click();
            input.onchange = async () => {
              try { item.data = await readFile(input.files?.[0]); item.fileName = input.files?.[0]?.name || ''; item.choice = 'upload'; item.status = 'done'; refresh(); }
              catch (error) { alert(error.message); }
            };
            actions.append(upload, input);
          }

          if (item.type.startsWith('service.')) {
            const provider = document.createElement('button'); provider.textContent = 'Choose provider';
            provider.onclick = () => { item.provider = prompt('Provider name (for example Supabase, OpenWeather or your own API):', item.provider || '') || ''; if (item.provider) { item.choice='provider'; item.status='done'; refresh(); } };
            actions.appendChild(provider);
          }

          if (item.type === 'graphics.provider') {
            const builtin = document.createElement('button'); builtin.textContent = 'Use built-in Canvas';
            builtin.onclick = () => { item.choice='builtin'; item.provider='graphics.canvas'; item.status='done'; refresh(); };
            actions.appendChild(builtin);
          }

          if (item.type.startsWith('permission.')) {
            const approve = document.createElement('button'); approve.textContent = 'Allow app to request it';
            approve.onclick = () => { item.choice='builtin'; item.status='done'; refresh(); };
            actions.appendChild(approve);
          }

          const placeholder = document.createElement('button'); placeholder.textContent = item.accept ? 'Use placeholder' : 'Build without it';
          placeholder.onclick = () => { item.choice = item.accept ? 'placeholder' : 'skip'; item.status='done'; refresh(); };
          actions.appendChild(placeholder); card.appendChild(actions);
          if (item.data?.startsWith('data:image/')) { const img=document.createElement('img'); img.src=item.data; img.className='atomos-req-preview'; card.appendChild(img); }
          cards.appendChild(card);
        }
        continueButton.disabled = resources.some(item => item.status !== 'done');
      };

      cancel.onclick = () => { backdrop.remove(); resolve(null); };
      continueButton.onclick = () => { backdrop.remove(); resolve(resources); };
      refresh();
    });
  }

  function installRequestGuard() {
    if (typeof request !== 'function' || request.__requirementsWrapped) return;
    const original = request;
    request = async function requestWithRequirements(editing) {
      if (bypassOnce) { bypassOnce = false; return original(editing); }
      const field = document.getElementById('prompt');
      const originalPrompt = field?.value || '';
      const needs = detect(originalPrompt);
      if (!needs.length) return original(editing);
      const resolved = await ask(needs);
      if (!resolved) { if (typeof log === 'function') log('Build cancelled while waiting for requirements.', 'bad'); return; }
      activeResources = resolved;
      if (field) field.value = `${originalPrompt}\n\nATOMOS USER-RESOLVED REQUIREMENTS:\n${requirementSummary(resolved)}\nUse supplied resources by role. Never expose credentials in application JSON or browser code.`;
      bypassOnce = true;
      try {
        const result = await request(editing);
        const app = (typeof currentApp !== 'undefined' && currentApp) || window.currentApp;
        if (app) saveForApp(app.title, resolved);
        return result;
      } finally { if (field) field.value = originalPrompt; }
    };
    request.__requirementsWrapped = true;
    const build = document.getElementById('build'); const edit = document.getElementById('edit');
    if (build) build.onclick = () => request(false);
    if (edit) edit.onclick = () => request(true);
  }

  function resourcePanel(app) {
    const supplied = resourcesFor(app).filter(x => x.choice === 'upload' && x.data);
    if (!supplied.length) return null;
    const panel = document.createElement('div'); panel.className = 'atomos-user-resources';
    for (const item of supplied) {
      if (item.data.startsWith('data:image/')) { const img=document.createElement('img'); img.src=item.data; img.alt=item.label; panel.appendChild(img); }
      else if (item.data.startsWith('data:audio/')) { const audio=document.createElement('audio'); audio.controls=true; audio.src=item.data; panel.appendChild(audio); }
      else if (item.data.startsWith('data:video/')) { const video=document.createElement('video'); video.controls=true; video.src=item.data; video.style.maxWidth='100%'; panel.appendChild(video); }
    }
    return panel;
  }

  function installPreviewResources() {
    if (typeof appPreview !== 'function' || appPreview.__requirementsWrapped) return;
    const original = appPreview;
    appPreview = function appPreviewWithResources() {
      const shell = original();
      const panel = resourcePanel((typeof currentApp !== 'undefined' && currentApp) || window.currentApp);
      const grid = shell?.querySelector?.('.app-grid');
      if (panel && grid) grid.prepend(panel);
      return shell;
    };
    appPreview.__requirementsWrapped = true;
  }

  function mount() {
    installRequestGuard();
    installPreviewResources();
    const left = document.querySelector('.layout > .card');
    if (left && !document.getElementById('requirementsStatus')) {
      const note = document.createElement('div'); note.id='requirementsStatus'; note.className='muted'; note.style.marginTop='8px';
      note.textContent='Build Assistant will pause for required images, providers, permissions or services instead of guessing.';
      left.appendChild(note);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  setTimeout(mount, 250);
  window.AtomRequirements = { detect, resourcesFor, resourcePanel, version:'0.1' };
})();