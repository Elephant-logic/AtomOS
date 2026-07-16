'use strict';
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'..','public','pwa-export.js');
let source=fs.readFileSync(file,'utf8');
const anchor="    loadScript('/semantic-library.js');";
if(!source.includes(anchor))throw new Error('Could not find Studio script loader');
const scripts=[
  "    loadScript('/build-pipeline.js');",
  "    loadScript('/requirements-assistant-safe.js');",
  "    loadScript('/capability-orchestrator-safe.js');",
  "    loadScript('/history-manager-safe.js');"
];
for(const line of scripts){if(!source.includes(line))source=source.replace(anchor,anchor+'\n'+line)}
fs.writeFileSync(file,source);
