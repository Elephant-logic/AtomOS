(() => {
  'use strict';
  function buttonByLabel(app, label) {
    const aliases = { '×':['×','*','x','X'], '÷':['÷','/'], '−':['−','-'], 'C':['C','AC','Clear'] };
    const wanted = aliases[label] || [label];
    return (app.components || []).find(c => c.type === 'button' && wanted.includes(String(c.label ?? c.text ?? '')));
  }
  function verify(app) {
    const checks=[]; const add=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});
    const keys=new Set(Object.keys(app?.state||{})), buttons=(app?.components||[]).filter(c=>c.type==='button');
    const counts=new Map(); for(const r of app?.rules||[]) counts.set(r.event,(counts.get(r.event)||0)+1);
    add('Every visible button is connected',buttons.every(b=>b.event&&counts.has(b.event)));
    add('Button events are not duplicated',buttons.every(b=>counts.get(b.event)===1));
    add('All bindings exist',(app?.components||[]).every(c=>!c.bind||keys.has(c.bind)));
    add('All actions use valid state',(app?.rules||[]).every(r=>(r.actions||[]).every(a=>keys.has(a.target)&&(!a.from||keys.has(a.from)))));
    const two=buttonByLabel(app,'2'), mul=buttonByLabel(app,'×'), three=buttonByLabel(app,'3'), eq=buttonByLabel(app,'='), clear=buttonByLabel(app,'C');
    if(two&&mul&&three&&eq&&window.AtomOSRuntime){
      const state=structuredClone(app.state||{}), display=(app.components||[]).find(c=>c.type==='display')?.bind;
      window.AtomOSRuntime.executeEvent(app,state,two.event); add('Single tap displays 2',display&&String(window.AtomOSRuntime.displayValue(state[display]))==='2',String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,mul.event); add('Operator appears immediately',display&&/[×*x]$/.test(String(window.AtomOSRuntime.displayValue(state[display]))),String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,three.event); add('Expression displays 2 × 3',display&&/^2\s*[×*x]\s*3$/.test(String(window.AtomOSRuntime.displayValue(state[display]))),String(state[display]));
      window.AtomOSRuntime.executeEvent(app,state,eq.event); add('2 × 3 equals 6',display&&Number(state[display])===6,String(state[display]));
      if(clear){window.AtomOSRuntime.executeEvent(app,state,clear.event);add('Clear returns display to zero',display&&String(state[display])==='0',String(state[display]));}
    }
    return {passed:checks.every(c=>c.pass),checks,failures:checks.filter(c=>!c.pass)};
  }
  function show(report,retest=false){if(typeof log!=='function')return;log(`${retest?'Retest':'Build verification'}: ${report.checks.filter(c=>c.pass).length}/${report.checks.length} passed`,report.passed?'ok':'bad');for(const c of report.checks)log(`${c.pass?'✓':'✗'} ${c.name}${!c.pass&&c.detail?' — '+c.detail:''}`,c.pass?'ok':'bad');}
  const original=request; let repairing=false;
  request=async function verifiedRequest(editing){const result=await original(editing);if(!currentApp||!window.AtomOSRuntime)return result;let report=verify(currentApp);show(report);window.AtomOSVerification=report;if(report.passed||repairing)return result;repairing=true;const box=document.getElementById('prompt'),previous=box.value;box.value='Repair only these failed verification checks while preserving all working behaviour: '+report.failures.map(x=>x.name+(x.detail?` (${x.detail})`:'')).join('; ');await original(true);box.value=previous;if(currentApp){report=verify(currentApp);show(report,true);window.AtomOSVerification=report;}repairing=false;return result;};
  const build=document.getElementById('build'),edit=document.getElementById('edit');if(build)build.onclick=()=>request(false);if(edit)edit.onclick=()=>request(true);
  window.AtomOSVerifier={verify};
})();