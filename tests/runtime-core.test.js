'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runtime=require('../public/runtime-core.js');

function calculator(){
  const buttons=['2','×','3','=','C'].map((label,i)=>({id:'b'+i,type:'button',label,event:'e'+i}));
  return {state:{expression:'',display:'0'},components:[{id:'d',type:'display',bind:'display'},...buttons],rules:[
    {event:'e0',actions:[{op:'append',target:'expression',value:'2'},{op:'set',target:'display',from:'expression'}]},
    {event:'e1',actions:[{op:'append',target:'expression',value:'*'},{op:'set',target:'display',from:'expression'}]},
    {event:'e2',actions:[{op:'append',target:'expression',value:'3'},{op:'set',target:'display',from:'expression'}]},
    {event:'e3',actions:[{op:'calculate',target:'display',from:'expression'},{op:'set',target:'expression',from:'display'}]},
    {event:'e4',actions:[{op:'set',target:'expression',value:''},{op:'set',target:'display',value:'0'}]}
  ]};
}

test('actions read live state while conditions read the event snapshot',()=>{
  const app=calculator(),state=structuredClone(app.state);
  runtime.executeEvent(app,state,'e0'); assert.equal(state.display,'2');
  runtime.executeEvent(app,state,'e1'); assert.equal(runtime.displayValue(state.display),'2 ×');
  runtime.executeEvent(app,state,'e2'); assert.equal(runtime.displayValue(state.display),'2 × 3');
  runtime.executeEvent(app,state,'e3'); assert.equal(state.display,6);
  runtime.executeEvent(app,state,'e4'); assert.equal(state.display,'0');
});

test('calculator single taps produce six',()=>{
  const app=calculator();
  const state=runtime.simulate(app,['e0','e1','e2','e3']);
  assert.equal(state.display,6);
});

test('interval-style events pause through caller gating without runtime drift',()=>{
  const app={state:{seconds:0,running:false},rules:[{event:'tick',actions:[{op:'increment',target:'seconds',value:1,when:{state:'running',operator:'truthy'}}]}]};
  const state=structuredClone(app.state);
  runtime.executeEvent(app,state,'tick'); assert.equal(state.seconds,0);
  state.running=true; runtime.executeEvent(app,state,'tick'); assert.equal(state.seconds,1);
  state.running=false; runtime.executeEvent(app,state,'tick'); assert.equal(state.seconds,1);
});
