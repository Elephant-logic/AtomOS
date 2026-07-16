(() => {
  'use strict';
  function buttonByLabel(app, label) {
    const aliases = { '×':['×','*','x','X'], '÷':['÷','/'], '−':['−','-'], 'C':['C','AC','Clear'] };
    const wanted = aliases[label] || [label];
    return (app.components || []).find(c => c.type === 'button' && wanted.includes(String(c.label ?? c.text ?? '')));
  }
  function changed(before, after) { return JSON.stringify(before) !== JSON.stringify(after); }
  function verify(app) {
    const checks=[]; const add=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});
    const keys=new Set(Object.keys(app?.state||{})), buttons=(app?.components||[]).filter(c=>c.type==='button');
    const counts=new Map(); for(const r of app?.rules||[]) counts.set(r.event,(counts.get(r.event)||0)+1);
    add('Every visible button is connected',buttons.every(b=>b.event&&counts.has(b.event)));
    add('All bindings exist',(app?.components||[]).every(c=>!c.bind||keys.has(c.bind)));
    add('All actions use valid state',(app?.rules||[]).every(r=>(r.actions||[]).every(a=>(a.op==='emit'||keys.has(a.target))&&(!a.from||keys.has(a.from)))));
    if(window.AtomOSRuntime){
      for(const button of buttons){
        const before=structuredClone(app.state||{}), after=structuredClone(before);
        window.AtomOSRuntime.executeEvent(app,after,button.event);
        add(`Button ${button.label||button.text||button.id} has an observable action`,changed(before,after),button.event);
      }
    }
    const two=buttonByLabel(app,'2'), mul=buttonByLabel(app,'×'), three=buttonByLabel(app,'3'), eq=buttonByLabel(app,'='), clear=buttonByLabel(app,'C');
    if(two&&mul&&three&&eq&&window.AtomOSRuntime){
      const state=structuredClone(app.state||{}), display=(app.components||[]).find(c=>c.type==='display')?.bind;
      window.AtomOSRuntime.executeEvent(app,state,two.event); add('Single tap displays 2',display&&String(window.AtomOSRuntime.displayValue(state[display]))==='2',String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,mul.event); add('Operator appears immediately',display&&/[×*x]$/.test(String(window.AtomOSRuntime.displayValue(state[display]))),String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,three.event); add('Expression displays 2 × 3',display&&/^2\s*[×*x]\s*3$/.test(String(window.AtomOSRuntime.displayValue(state[display]))),String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,eq.event); add('2 × 3 equals 6',display&&Number(state[display])===6,String(state[display]));
      if(clear){window.AtomOSRuntime.executeEvent(app,state,clear.event);add('Clear returns display to zero',display&&String(state[display])==='0',String(state[display]));}
    }
    if(/tic\s*tac\s*toe/i.test(String(app?.title||'')+' '+String(app?.description||''))&&window.AtomOSRuntime){
      const cells=buttons.filter(b=>!/restart|reset|new game/i.test(String(b.label||b.text||b.id)));
      add('Tic Tac Toe has exactly nine playable cells',cells.length===9,String(cells.length));
      add('Every Tic Tac Toe cell displays bound state',cells.length===9&&cells.every(c=>c.bind&&keys.has(c.bind)),cells.filter(c=>!c.bind).map(c=>c.id).join(', '));
      if(cells.length>=2){
        const game=structuredClone(app.state||{}), first=cells[0], second=cells[1];
        const firstBefore=structuredClone(game); window.AtomOSRuntime.executeEvent(app,game,first.event);
        add('First cell tap places a mark',first.bind&&String(game[first.bind]??'').length>0,first.bind?String(game[first.bind]):'missing bind');
        const firstMark=first.bind?game[first.bind]:undefined; window.AtomOSRuntime.executeEvent(app,game,second.event);
        add('Second cell tap places the other mark',second.bind&&String(game[second.bind]??'').length>0&&game[second.bind]!==firstMark,second.bind?String(game[second.bind]):'missing bind');
        const occupied=structuredClone(game); window.AtomOSRuntime.executeEvent(app,game,first.event);
        add('Occupied cell cannot be overwritten',first.bind&&game[first.bind]===occupied[first.bind],first.bind?String(game[first.bind]):'missing bind');
        add('Cell taps change runtime state',changed(firstBefore,game));
      }
      const restart=buttons.find(b=>/restart|reset|new game/i.test(String(b.label||b.text||b.id)));
      if(restart&&cells.every(c=>c.bind)){const game=structuredClone(app.state||{});for(const c of cells.slice(0,2))window.AtomOSRuntime.executeEvent(app,game,c.event);window.AtomOSRuntime.executeEvent(app,game,restart.event);add('Restart clears all cells',cells.every(c=>String(game[c.bind]??'')===''),cells.map(c=>String(game[c.bind]??'')).join(','));}
    }
    return {passed:checks.every(c=>c.pass),checks,failures:checks.filter(c=>!c.pass)};
  }
  function show(report,retest=false){if(typeof log!=='function')return;log(`${retest?'Retest':'Build verification'}: ${report.checks.filter(c=>c.pass).length}/${report.checks.length} passed`,report.passed?'ok':'bad');for(const c of report.checks)log(`${c.pass?'✓':'✗'} ${c.name}${!c.pass&&c.detail?' — '+c.detail:''}`,c.pass?'ok':'bad');}
  const original=request; let repairing=false;
  request=async function verifiedRequest(editing){const result=await original(editing);if(!currentApp||!window.AtomOSRuntime)return result;let report=verify(currentApp);show(report);window.AtomOSVerification=report;if(report.passed||repairing)return result;repairing=true;const box=document.getElementById('prompt'),previous=box.value;box.value='Repair only these failed runtime verification checks. Use state-bound button labels for dynamic game cells, ensure each tap changes the correct state exactly once, prevent occupied cells from changing, and preserve all working behaviour: '+report.failures.map(x=>x.name+(x.detail?` (${x.detail})`:'')).join('; ');await original(true);box.value=previous;if(currentApp){report=verify(currentApp);show(report,true);window.AtomOSVerification=report;}repairing=false;return result;};
  const build=document.getElementById('build'),edit=document.getElementById('edit');if(build)build.onclick=()=>request(false);if(edit)edit.onclick=()=>request(true);
  window.AtomOSVerifier={verify};
})();