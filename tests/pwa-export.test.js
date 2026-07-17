'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExporter() {
  const filename = path.join(__dirname, '..', 'public', 'pwa-export.js');
  let source = fs.readFileSync(filename, 'utf8');
  source = source.replace(/\}\)\(\);\s*$/, 'globalThis.__pwaTest={crc32,zipStore,safeJson,appHtml,manifest,iconSvg,serviceWorker,pwaReadme};})();');
  const context = {
    console, TextEncoder, Uint8Array, Uint32Array, DataView, Blob, Date, JSON, structuredClone,
    renderPublish() {}, currentApp: null,
    document: { querySelector() { return null; }, getElementById() { return null; } },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }, setTimeout() {},
    slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename });
  return context.__pwaTest;
}

const calculator = {
  title: 'Test Calculator', description: 'Offline calculator smoke test', state: { expression: '', result: 0 },
  components: [{ id:'display',type:'display',bind:'result' },{ id:'one',type:'button',label:'1',event:'one' }],
  rules: [{ event:'one',actions:[{op:'append',target:'expression',value:'1'}] }]
};
const game = {
  title:'Forest Escape', screens:['menu','game'], activeScreen:'activeScreen',
  state:{activeScreen:'game',gameRunning:true,entities:[{id:'player',type:'player',x:40,y:100,width:24,height:32}]},
  components:[{id:'forest',type:'scene',bind:'entities',screen:'game',world:{gravity:900}}], rules:[], capabilities:[]
};

test('PWA manifest is installable and scoped locally', () => {
  const manifest = JSON.parse(loadExporter().manifest(calculator));
  assert.equal(manifest.name,'Test Calculator');assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
  assert.ok(manifest.icons.some(icon=>icon.src==='icon.svg'&&icon.purpose.includes('maskable')));
});

test('generated HTML boots the shared playable runtime', () => {
  const html = loadExporter().appHtml(game);
  assert.match(html, /window\.ATOMOS_APP=/);
  assert.match(html, /<script src="\.\/export-runtime\.js"><\/script>/);
  assert.match(html, /"type":"scene"/);
  assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.doesNotMatch(html, /function component\(c\)/);
});

test('service worker precaches the playable runtime', () => {
  const worker = loadExporter().serviceWorker();
  for (const required of ['./','./index.html','./export-runtime.js','./manifest.webmanifest','./icon.svg']) assert.ok(worker.includes(required),`missing ${required}`);
  assert.match(worker,/caches\.open\(CACHE\)/);assert.match(worker,/self\.addEventListener\('fetch'/);
});

test('ZIP writer emits a valid archive containing the runtime', async () => {
  const api=loadExporter();
  const files=[{name:'index.html',data:api.appHtml(game)},{name:'export-runtime.js',data:'// runtime'},{name:'manifest.webmanifest',data:api.manifest(game)},{name:'sw.js',data:api.serviceWorker()},{name:'icon.svg',data:api.iconSvg(game)},{name:'README.md',data:api.pwaReadme(game)}];
  const bytes=new Uint8Array(await api.zipStore(files).arrayBuffer());
  assert.deepEqual([...bytes.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  const text=Buffer.from(bytes).toString('utf8');for(const file of files)assert.ok(text.includes(file.name),`archive missing ${file.name}`);
  assert.deepEqual([...bytes.slice(-22,-18)],[0x50,0x4b,0x05,0x06]);
});

test('playable runtime contains scene, physics, screen and input support', () => {
  const runtime=fs.readFileSync(path.join(__dirname,'..','public','export-runtime.js'),'utf8');
  assert.match(runtime,/drawScene/);assert.match(runtime,/requestAnimationFrame/);assert.match(runtime,/gameRunning/);assert.match(runtime,/activeScreen/);assert.match(runtime,/touch-controls|ArrowLeft/);
});

test('server injects the PWA exporter into Studio', () => {
  const server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  assert.match(server,/<script src="\/pwa-export\.js"><\/script>/);assert.match(server,/'\.webmanifest': 'application\/manifest\+json'/);
});