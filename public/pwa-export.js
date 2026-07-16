(() => {
  'use strict';

  const encoder = new TextEncoder();
  const hasDOM = typeof document !== 'undefined' && typeof document.createElement === 'function';
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(view, offset, value) { view.setUint16(offset, value, true); }
  function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const stamp = dosDateTime();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length + data.length);
      const lv = new DataView(local.buffer);
      u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0);
      u16(lv, 10, stamp.time); u16(lv, 12, stamp.date); u32(lv, 14, crc);
      u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
      local.set(name, 30); local.set(data, 30 + name.length);
      locals.push(local);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0);
      u16(cv, 12, stamp.time); u16(cv, 14, stamp.date); u32(cv, 16, crc);
      u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, name.length);
      u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
      central.set(name, 46); centrals.push(central);
      offset += local.length;
    }

    const centralSize = centrals.reduce((sum, x) => sum + x.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, files.length); u16(ev, 10, files.length);
    u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);

    return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
  }

  function safeJson(value) {
    return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  }

  function appHtml(app) {
    const data = safeJson(app);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2969e8">
<link rel="manifest" href="manifest.webmanifest">
<title>${String(app.title || 'AtomOS App').replace(/[<>&]/g, '')}</title>
<style>
*{box-sizing:border-box}body{font:16px/1.45 system-ui,sans-serif;background:#eef3fb;color:#162238;margin:0;padding:20px;min-height:100vh}.app{max-width:620px;margin:auto;background:white;border-radius:18px;padding:22px;box-shadow:0 18px 60px #0002}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.full{grid-column:1/-1}.display{font-size:32px;font-weight:800;text-align:right;border:1px solid #d5deea;border-radius:12px;padding:14px;min-height:62px;overflow-wrap:anywhere}.button{padding:13px;border:0;border-radius:10px;background:#2969e8;color:white;font-weight:700;min-height:48px}.secondary{background:#5c6d83}.danger{background:#dc4054}.input{padding:12px;border:1px solid #ccd8e8;border-radius:10px;width:100%}.spacer{height:8px}@media(display-mode:standalone){body{padding-top:max(20px,env(safe-area-inset-top))}}
</style>
</head>
<body><div id="root"></div>
<script>
const app=${data};
let state=structuredClone(app.state||{});
const root=document.getElementById('root');
function valueOf(a){return a.from?state[a.from]:a.value}
function calculate(x){const s=String(x??'').replaceAll('×','*').replaceAll('÷','/');if(!/^[0-9+\\-*/.()\\s]+$/.test(s))throw Error('Invalid expression');const n=Function('"use strict";return ('+s+')')();if(!Number.isFinite(n))throw Error('Math error');return Number(n.toFixed(10))}
function run(event){for(const rule of(app.rules||[]).filter(x=>x.event===event)){for(const action of rule.actions||[]){const v=valueOf(action);if(action.op==='set')state[action.target]=v;else if(action.op==='append')state[action.target]=String(state[action.target]??'')+String(v??'');else if(action.op==='increment')state[action.target]=Number(state[action.target]||0)+Number(v??1);else if(action.op==='decrement')state[action.target]=Number(state[action.target]||0)-Number(v??1);else if(action.op==='clear')state[action.target]=typeof state[action.target]==='number'?0:'';else if(action.op==='calculate'){try{state[action.target]=calculate(v)}catch{state[action.target]='Error'}}}}render()}
function component(c){let e;if(c.type==='heading'){e=document.createElement('h2');e.textContent=c.text||'';e.className='full'}else if(c.type==='text'){e=document.createElement('div');e.textContent=c.bind?String(state[c.bind]??''):c.text||'';e.className='full'}else if(c.type==='display'){e=document.createElement('div');e.className='display full';e.textContent=String(state[c.bind]??c.text??'')}else if(c.type==='input'){e=document.createElement('input');e.className='input full';e.type=c.inputType||'text';e.placeholder=c.label||'';e.value=String(state[c.bind]??'');e.oninput=()=>{state[c.bind]=e.type==='number'?Number(e.value):e.value}}else if(c.type==='button'){e=document.createElement('button');e.className='button '+(c.variant||'');e.textContent=c.label||c.text||c.id;e.onclick=()=>run(c.event)}else{e=document.createElement('div');e.className='spacer full'}return e}
function render(){const shell=document.createElement('div');shell.className='app';const h=document.createElement('h1');h.textContent=app.title||'AtomOS App';const p=document.createElement('p');p.textContent=app.description||'';const grid=document.createElement('div');grid.className='grid';for(const c of app.components||[])grid.appendChild(component(c));shell.append(h,p,grid);root.replaceChildren(shell)}
render();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));
<\/script>
</body></html>`;
  }

  function manifest(app) {
    const name = String(app.title || 'AtomOS App');
    return JSON.stringify({
      name,
      short_name: name.slice(0, 24),
      description: String(app.description || 'Built with AtomOS'),
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#eef3fb',
      theme_color: '#2969e8',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
    }, null, 2);
  }

  function iconSvg(app) {
    const initials = String(app.title || 'A').split(/\s+/).map(x => x[0]).join('').slice(0, 2).toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#2969e8"/><circle cx="256" cy="256" r="142" fill="#fff" opacity=".15"/><text x="256" y="292" text-anchor="middle" font-family="system-ui,sans-serif" font-size="150" font-weight="800" fill="white">${initials.replace(/[<>&]/g, '')}</text></svg>`;
  }

  function serviceWorker() {
    return `const CACHE='atomos-app-v1';const FILES=['./','./index.html','./manifest.webmanifest','./icon.svg'];self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match('./index.html'))))});`;
  }

  function pwaReadme(app) {
    return `# ${app.title || 'AtomOS App'}\n\nThis is an installable Progressive Web App generated by AtomOS.\n\n## Deploy\n\nUpload every file in this ZIP to the same HTTPS website folder. Render Static Site, GitHub Pages, Netlify and Cloudflare Pages all work.\n\nAfter deployment, open the HTTPS URL in Chrome on Android, then choose **Install app** or **Add to Home screen** from the browser menu.\n\nOpening index.html directly from Downloads will not install the PWA because service workers require HTTPS (or localhost).\n`;
  }

  function downloadPwa(app) {
    const name = (typeof slug === 'function' ? slug(app.title) : 'atomos-app');
    const blob = zipStore([
      { name: 'index.html', data: appHtml(app) },
      { name: 'manifest.webmanifest', data: manifest(app) },
      { name: 'sw.js', data: serviceWorker() },
      { name: 'icon.svg', data: iconSvg(app) },
      { name: 'README.md', data: pwaReadme(app) }
    ]);
    if (!hasDOM) return blob;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}-pwa.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    return blob;
  }

  if (hasDOM && typeof renderPublish === 'function') {
    const originalRenderPublish = renderPublish;
    renderPublish = function renderPublishWithPwa() {
      originalRenderPublish();
      if (!currentApp) return;
      const grid = document.querySelector('#canvas .export-grid');
      if (!grid || document.getElementById('pwaExportCard')) return;
      const card = document.createElement('div');
      card.id = 'pwaExportCard'; card.className = 'export-card';
      card.innerHTML = '<h2>Installable Android/Web app</h2><p class="muted">Downloads a complete PWA ZIP with offline support, manifest, icon and service worker. Deploy it over HTTPS, then install it from Chrome.</p>';
      const button = document.createElement('button');
      button.className = 'good'; button.textContent = 'Download PWA package';
      button.onclick = () => downloadPwa(currentApp);
      card.appendChild(button); grid.prepend(card);
    };
  }

  if (hasDOM && document.head && typeof document.head.appendChild === 'function') {
    const refineryScript = document.createElement('script');
    refineryScript.src = '/code-refinery.js';
    refineryScript.defer = true;
    document.head.appendChild(refineryScript);
  }
})();