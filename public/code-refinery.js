(() => {
  'use strict';

  const EXT = new Set('js jsx ts tsx mjs cjs html htm css scss json md py java kt swift go rs php vue svelte'.split(' '));
  const LIBRARY_KEY = 'atomos-refinery-library';
  const LANGUAGE_KEY = 'atomos-language-library';
  let result = null;

  const slug = value => String(value || 'part').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
  const uniq = values => [...new Set(values.filter(Boolean))];
  const languageOf = name => ({ js:'javascript', jsx:'react', ts:'typescript', tsx:'react-typescript', html:'html', htm:'html', css:'css', scss:'scss', json:'json', py:'python', vue:'vue', svelte:'svelte' }[String(name).split('.').pop().toLowerCase()] || String(name).split('.').pop().toLowerCase());

  function parameters(signature) {
    const match = String(signature).match(/\(([^)]*)\)/);
    if (!match) return [];
    return match[1].split(',').map(x => x.trim().replace(/=.*$/, '').replace(/^\*+/, '')).filter(x => /^[A-Za-z_$][\w$]*$/.test(x));
  }

  function inferOperations(source) {
    const operations = [];
    if (/\breturn\s+/.test(source)) operations.push({ op:'return', source:'result' });
    if (/\b(?:sum|reduce)\s*\(/.test(source)) operations.push({ op:'aggregate', mode:'sum' });
    if (/\.filter\s*\(|\bfilter\s*\(/.test(source)) operations.push({ op:'filter' });
    if (/\.map\s*\(|\bmap\s*\(/.test(source)) operations.push({ op:'map' });
    if (/\bif\s*[\s(]/.test(source)) operations.push({ op:'condition' });
    if (/\b(?:fetch|requests\.|urllib\.|http\.)/.test(source)) operations.push({ op:'http_request' });
    if (/\b(?:localStorage|sessionStorage|open\s*\(|json\.dump|json\.load)/.test(source)) operations.push({ op:'storage' });
    if (/\b(?:setInterval|setTimeout|sleep\s*\()/.test(source)) operations.push({ op:'timer' });
    if (/\b(?:emit|dispatch)\s*\(/.test(source)) operations.push({ op:'emit' });
    if (/addEventListener\s*\(/.test(source)) operations.push({ op:'event_handler' });
    if (/classList\.|style\.|innerHTML|textContent/.test(source)) operations.push({ op:'render' });
    return operations.length ? operations : [{ op:'external_implementation' }];
  }

  function connectors(source, name, inputs = []) {
    const required = uniq(inputs.map(x => `value:${x}`).concat(
      [...source.matchAll(/\b(?:fetch|requests\.(?:get|post|put|delete))\s*\(\s*['"]([^'"]+)/g)].map(x => `api:${x[1]}`),
      [...source.matchAll(/(?:getElementById\s*\(\s*['"]([^'"]+)|querySelector\s*\(\s*['"]#([^'"]+))/g)].map(x => `ui:${x[1] || x[2]}`)
    )).slice(0, 30);
    const provided = uniq(
      [...source.matchAll(/\b(?:dispatch|emit)\s*\(\s*['"]([^'"]+)/g)].map(x => `event:${x[1]}`)
        .concat([...source.matchAll(/addEventListener\s*\(\s*['"]([^'"]+)/g)].map(x => `event:${x[1]}`))
        .concat(name ? [`function:${slug(name)}`] : [])
    ).slice(0, 30);
    return { inputs: required, outputs: provided };
  }

  function translatedPart({ name, kind, file, source, language, confidence = .8, extra = {} }) {
    const inputs = parameters(source), operations = inferOperations(source);
    return {
      id: slug(name), name, kind, sourceFile:file, confidence,
      connectors:connectors(source, name, inputs),
      atomos:{ languageVersion:'0.2', kind, inputs:inputs.map(input => ({ name:input, type:'unknown' })), outputs:[{ name:'result', type:'unknown' }], operations, translationStatus:operations.some(x => x.op === 'external_implementation') ? 'external' : 'partial', implementations:{ [language]:{ source:String(source).slice(0,12000) } } },
      ...extra
    };
  }

  function analyseJavaScript(source, file, language, parts) {
    for (const match of source.matchAll(/(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[\s\S]{0,2400}?(?=\n(?:export\s+)?(?:async\s+)?function\s+|$)/g)) parts.push(translatedPart({ name:match[1], kind:/^[A-Z]/.test(match[1])?'ui.component':'logic.function', file, source:match[0], language, confidence:.9 }));
    for (const match of source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)/g)) parts.push(translatedPart({ name:`${match[1].toUpperCase()} ${match[2]}`, kind:'api.route', file, source:match[0], language, confidence:.95, extra:{ method:match[1].toUpperCase(), path:match[2] } }));
    for (const match of source.matchAll(/(?:getElementById\(['"]([^'"]+)['"]\)|querySelector\(['"]#([^'"]+)['"]\))\.addEventListener\(['"]([^'"]+)/g)) {
      const target = match[1] || match[2], event = match[3];
      parts.push(translatedPart({ name:`${target} ${event}`, kind:'ui.event', file, source:match[0], language, confidence:.94, extra:{ target, event } }));
    }
  }

  function analyseHtml(source, file, parts) {
    let doc;
    try { doc = new DOMParser().parseFromString(source, 'text/html'); } catch { return; }
    const title = doc.querySelector('title')?.textContent?.trim();
    const body = doc.body;
    if (body) parts.push(translatedPart({ name:title || file.replace(/\.[^.]+$/, ''), kind:'ui.document', file, source:body.outerHTML, language:'html', confidence:.98, extra:{ title:title || '', semanticRole:'application-shell' } }));

    const selector = 'header,nav,main,section,article,aside,footer,form,fieldset,dialog,canvas,table,ul,ol,button,input,select,textarea,a,img';
    for (const element of doc.querySelectorAll(selector)) {
      const tag = element.tagName.toLowerCase();
      const id = element.id || element.getAttribute('name') || element.getAttribute('aria-label') || element.textContent?.trim().slice(0,50) || tag;
      const eventAttrs = [...element.attributes].filter(a => a.name.startsWith('on')).map(a => a.name.slice(2));
      const requires = [];
      if (element.getAttribute('form')) requires.push(`ui:${element.getAttribute('form')}`);
      if (element.getAttribute('href')?.startsWith('/')) requires.push(`route:${element.getAttribute('href')}`);
      const part = translatedPart({
        name:id,
        kind:`ui.${tag}`,
        file,
        source:element.outerHTML,
        language:'html',
        confidence:.94,
        extra:{
          html:{ tag, id:element.id || null, name:element.getAttribute('name'), type:element.getAttribute('type'), role:element.getAttribute('role'), text:String(element.textContent || '').trim().slice(0,160), attributes:Object.fromEntries([...element.attributes].map(a => [a.name,a.value]).slice(0,30)) },
          semanticRole: tag === 'form' ? 'input-group' : tag === 'button' ? 'action-control' : tag === 'input' || tag === 'select' || tag === 'textarea' ? 'data-input' : 'layout'
        }
      });
      part.connectors.inputs = uniq([...part.connectors.inputs, ...requires]);
      part.connectors.outputs = uniq([...part.connectors.outputs, `ui:${slug(id)}`, ...eventAttrs.map(e => `event:${e}`)]);
      part.atomos.operations = [{ op:'render_element', tag, attributes:part.html.attributes }, ...eventAttrs.map(event => ({ op:'event_handler', event }))];
      part.atomos.translationStatus = 'partial';
      parts.push(part);
    }

    for (const script of doc.querySelectorAll('script:not([src])')) analyseJavaScript(script.textContent || '', file, 'javascript', parts);
    for (const script of doc.querySelectorAll('script[src]')) parts.push(translatedPart({ name:script.getAttribute('src'), kind:'dependency.script', file, source:script.outerHTML, language:'html', confidence:.98, extra:{ src:script.getAttribute('src') } }));
    for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) parts.push(translatedPart({ name:link.getAttribute('href') || 'stylesheet', kind:'dependency.stylesheet', file, source:link.outerHTML, language:'html', confidence:.98, extra:{ href:link.getAttribute('href') } }));
  }

  function analyse(file) {
    const language = languageOf(file.name), source = file.content, parts = [];
    if (/javascript|typescript|react|vue|svelte/.test(language)) analyseJavaScript(source, file.name, language, parts);
    if (language === 'python') {
      const starts = [...source.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*:/gm)];
      starts.forEach((match,index) => parts.push(translatedPart({ name:match[1], kind:'logic.function', file:file.name, source:source.slice(match.index, starts[index+1]?.index ?? source.length), language, confidence:.92 })));
      for (const match of source.matchAll(/^class\s+([A-Za-z_]\w*)[^:]*:/gm)) parts.push(translatedPart({ name:match[1], kind:'logic.class', file:file.name, source:match[0], language, confidence:.9 }));
    }
    if (language === 'html') analyseHtml(source, file.name, parts);
    if (language === 'css' || language === 'scss') for (const match of source.matchAll(/([^{}]+)\{([^{}]{1,2000})\}/g)) parts.push(translatedPart({ name:match[1].trim(), kind:'ui.style', file:file.name, source:match[0], language, confidence:.82, extra:{ selector:match[1].trim() } }));
    if (!parts.length) parts.push(translatedPart({ name:file.name.replace(/\.[^.]+$/, ''), kind:'source.module', file:file.name, source, language, confidence:.45 }));
    return { name:file.name, language, size:source.length, parts };
  }

  function build(files) {
    const analysed = files.map(analyse), atoms = analysed.flatMap(x => x.parts);
    const molecules = analysed.map(file => ({ id:slug(file.name.replace(/\.[^.]+$/, '')), name:file.name.replace(/\.[^.]+$/, ''), kind:file.parts.some(x => x.kind.startsWith('ui.')) ? 'interface' : file.parts.some(x => x.kind.startsWith('api.')) ? 'service' : 'logic', sourceFile:file.name, atomIds:file.parts.map(x => x.id), connectors:{ inputs:uniq(file.parts.flatMap(x => x.connectors.inputs)), outputs:uniq(file.parts.flatMap(x => x.connectors.outputs)) }, confidence:Number((file.parts.reduce((n,x)=>n+x.confidence,0)/file.parts.length).toFixed(2)) }));
    const edges=[]; for (const from of molecules) for (const to of molecules) if (from !== to) for (const connector of from.connectors.inputs.filter(x => to.connectors.outputs.includes(x))) edges.push({ from:from.id, to:to.id, connector });
    return { atomosLanguageVersion:'0.2', createdAt:new Date().toISOString(), summary:{ files:files.length, atoms:atoms.length, molecules:molecules.length, translated:atoms.filter(x => x.atomos.translationStatus !== 'external').length, htmlParts:atoms.filter(x => x.sourceFile.match(/\.html?$/i)).length }, files:analysed.map(({parts,...file})=>file), atoms, molecules, edges };
  }

  async function readFiles(list) {
    let total=0; const output=[];
    for (const file of [...list].slice(0,40)) { const extension=file.name.split('.').pop().toLowerCase(); if (!EXT.has(extension) && !file.type.startsWith('text/')) continue; total += file.size; if (total > 600000) throw Error('Selected source is too large. Keep the total under 600 KB.'); output.push({ name:file.webkitRelativePath || file.name, content:await file.text() }); }
    if (!output.length) throw Error('Choose source-code or text files.'); return output;
  }

  function saveTranslation(value) {
    const refinery=JSON.parse(localStorage.getItem(LIBRARY_KEY)||'[]'); refinery.push({ id:`refinery-${Date.now()}`, name:`Imported code ${new Date().toLocaleString()}`, ...value }); localStorage.setItem(LIBRARY_KEY,JSON.stringify(refinery.slice(-20)));
    const library=JSON.parse(localStorage.getItem(LANGUAGE_KEY)||'[]'); library.push(...value.atoms.map(atom=>({ id:`${atom.id}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, name:atom.name, kind:atom.kind, connectors:atom.connectors, atomos:atom.atomos, html:atom.html, semanticRole:atom.semanticRole, sourceFile:atom.sourceFile }))); localStorage.setItem(LANGUAGE_KEY,JSON.stringify(library.slice(-1000)));
  }
  function download(value) { const link=document.createElement('a'); link.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})); link.download='atomos-translation.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),500); }
  function render(host,value) { host.innerHTML=`<div class="log">Translated ${value.summary.atoms} parts from ${value.summary.files} files into AtomOS Language ${value.atomosLanguageVersion}. Learned ${value.summary.htmlParts || 0} HTML/interface parts. ${value.summary.translated} parts have semantic operations; the rest keep external implementations.</div>`; const graph=document.createElement('div'); graph.className='library'; graph.style.marginTop='10px'; for (const molecule of value.molecules.slice(0,20)) { const card=document.createElement('div'); card.className='library-card'; card.innerHTML=`<h2>${molecule.name}</h2><p class="muted">${molecule.kind} molecule · ${molecule.atomIds.length} translated part(s)</p><div class="muted">needs: ${molecule.connectors.inputs.join(', ') || 'none'}<br>provides: ${molecule.connectors.outputs.join(', ') || 'none'}</div>`; graph.appendChild(card); } host.appendChild(graph); }
  function loadScript(src) { if (document.querySelector(`script[src="${src}"]`)) return; const script=document.createElement('script'); script.src=src; script.defer=true; document.head.appendChild(script); }

  function mount() {
    const left=document.querySelector('.layout > .card'); if (!left || document.getElementById('codeRefinery')) return;
    const section=document.createElement('section'); section.id='codeRefinery'; section.innerHTML=`<hr style="border:0;border-top:1px solid var(--line);margin:14px 0"><h2>Code and HTML translator</h2><p class="muted">Upload HTML, CSS, Python, JavaScript or a project folder. AtomOS learns page structure, forms, controls, events, functions, routes, connectors and supported behaviour while retaining the original implementation.</p><input id="refineryFiles" type="file" multiple style="width:100%"><div class="row"><button id="analyseCode" class="primary">Learn code / HTML</button><button id="saveRefinery" disabled>Save to language library</button><button id="downloadRefinery" disabled>Download translation</button></div><div id="refineryOutput" class="muted" style="margin-top:9px">No code or HTML translated yet.</div>`; left.appendChild(section);
    const input=document.getElementById('refineryFiles'); input.accept=[...EXT].map(x=>`.${x}`).join(',');
    document.getElementById('analyseCode').onclick=async()=>{ const button=document.getElementById('analyseCode'); button.disabled=true; button.textContent='Learning…'; try { result=build(await readFiles(input.files)); render(document.getElementById('refineryOutput'),result); document.getElementById('saveRefinery').disabled=false; document.getElementById('downloadRefinery').disabled=false; if(typeof log==='function')log(`Learned ${result.summary.atoms} parts, including ${result.summary.htmlParts || 0} HTML parts, into AtomOS Language.`,'ok'); } catch(error) { document.getElementById('refineryOutput').textContent=error.message; if(typeof log==='function')log(error.message,'bad'); } finally { button.disabled=false; button.textContent='Learn code / HTML'; } };
    document.getElementById('saveRefinery').onclick=()=>{ if(result){ saveTranslation(result); if(typeof log==='function')log('Translated code and HTML saved to the AtomOS language library.','ok'); } };
    document.getElementById('downloadRefinery').onclick=()=>result&&download(result);
    loadScript('/fullstack-studio.js');
    loadScript('/fullstack-auto.js');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',mount); else mount();
  window.AtomOSTranslator={analyse,build,saveTranslation,current:()=>result};
})();