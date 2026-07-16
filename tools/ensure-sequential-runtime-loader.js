'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'public', 'pwa-export.js');
const marker = "loadScript('/sequential-runtime-fix.js');";
let source = fs.readFileSync(target, 'utf8');

if (!source.includes(marker)) {
  const anchor = "  loadScript('/semantic-library.js');";
  if (!source.includes(anchor)) throw new Error('Could not find AtomOS browser loader anchor');
  source = source.replace(anchor, `${anchor}\n  ${marker}`);
  fs.writeFileSync(target, source);
  console.log('Enabled sequential AtomOS runtime actions');
}
