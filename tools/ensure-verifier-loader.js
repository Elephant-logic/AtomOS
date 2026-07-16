'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'public', 'pwa-export.js');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes("loadScript('/build-verifier.js')")) {
  const anchor = "    loadScript('/semantic-library.js');";
  if (!source.includes(anchor)) throw new Error('Could not find Studio script loader');
  source = source.replace(anchor, anchor + "\n    loadScript('/build-verifier.js');");
  fs.writeFileSync(file, source);
}
