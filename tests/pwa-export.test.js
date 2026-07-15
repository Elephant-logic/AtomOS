'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadExporter() {
  const filename = path.join(__dirname, '..', 'public', 'pwa-export.js');
  let source = fs.readFileSync(filename, 'utf8');
  source = source.replace(
    /\}\)\(\);\s*$/,
    'globalThis.__pwaTest={crc32,zipStore,safeJson,appHtml,manifest,iconSvg,serviceWorker,pwaReadme};})();'
  );

  const context = {
    console,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    DataView,
    Blob,
    Date,
    JSON,
    structuredClone,
    renderPublish() {},
    currentApp: null,
    document: { querySelector() { return null; }, getElementById() { return null; } },
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout() {},
    slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename });
  return context.__pwaTest;
}

const calculator = {
  title: 'Test Calculator',
  description: 'Offline calculator smoke test',
  state: { expression: '', result: 0 },
  components: [
    { id: 'display', type: 'display', bind: 'result' },
    { id: 'one', type: 'button', label: '1', event: 'one' },
    { id: 'plus', type: 'button', label: '+', event: 'plus' },
    { id: 'equals', type: 'button', label: '=', event: 'equals' }
  ],
  rules: [
    { event: 'one', actions: [{ op: 'append', target: 'expression', value: '1' }] },
    { event: 'plus', actions: [{ op: 'append', target: 'expression', value: '+' }] },
    { event: 'equals', actions: [{ op: 'calculate', target: 'result', from: 'expression' }] }
  ]
};

test('PWA manifest is installable and scoped locally', () => {
  const api = loadExporter();
  const manifest = JSON.parse(api.manifest(calculator));
  assert.equal(manifest.name, 'Test Calculator');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some(icon => icon.src === 'icon.svg' && icon.purpose.includes('maskable')));
});

test('generated app HTML embeds the app and registers its service worker', () => {
  const api = loadExporter();
  const html = api.appHtml(calculator);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
  assert.match(html, /"title":"Test Calculator"/);
  assert.match(html, /function run\(event\)/);
  assert.match(html, /function calculate\(x\)/);
  assert.doesNotMatch(html, /<script src=/);
});

test('service worker precaches the complete application shell', () => {
  const api = loadExporter();
  const worker = api.serviceWorker();
  for (const required of ['./', './index.html', './manifest.webmanifest', './icon.svg']) {
    assert.ok(worker.includes(required), `missing ${required}`);
  }
  assert.match(worker, /caches\.open\(CACHE\)/);
  assert.match(worker, /self\.addEventListener\('fetch'/);
  assert.match(worker, /caches\.match\('\.\/index\.html'\)/);
});

test('ZIP writer emits a valid archive containing every required PWA file', async () => {
  const api = loadExporter();
  const files = [
    { name: 'index.html', data: api.appHtml(calculator) },
    { name: 'manifest.webmanifest', data: api.manifest(calculator) },
    { name: 'sw.js', data: api.serviceWorker() },
    { name: 'icon.svg', data: api.iconSvg(calculator) },
    { name: 'README.md', data: api.pwaReadme(calculator) }
  ];
  const blob = api.zipStore(files);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const text = Buffer.from(bytes).toString('utf8');
  for (const file of files) assert.ok(text.includes(file.name), `archive missing ${file.name}`);
  assert.deepEqual([...bytes.slice(-22, -18)], [0x50, 0x4b, 0x05, 0x06]);
});

test('server injects the PWA exporter into Studio', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /<script src="\/pwa-export\.js"><\/script>/);
  assert.match(server, /'\.webmanifest': 'application\/manifest\+json'/);
});
