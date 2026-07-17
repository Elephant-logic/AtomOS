'use strict';

const SCALAR = { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] };
const VALUE_SCHEMA = {
  anyOf: [
    ...SCALAR.anyOf,
    { type: 'array', maxItems: 500, items: { anyOf: [...SCALAR.anyOf, { type: 'object', additionalProperties: true }] } },
    { type: 'object', additionalProperties: true }
  ]
};
const CONDITION_SCHEMA = { type:'object', additionalProperties:false, required:['state','operator'], properties:{ state:{type:'string',maxLength:40}, operator:{type:'string',enum:['truthy','falsy','eq','neq','gt','gte','lt','lte','includes','not_includes']}, value:VALUE_SCHEMA } };
const ACTION_TYPES = ['set','increment','decrement','append','clear','calculate','format_time','add','subtract','multiply','divide','modulo','toggle','concat','list_push','list_pop','list_shift','list_unshift','list_remove','list_set','length','min','max','round','floor','ceil','emit','navigate'];
const ACTION_SCHEMA = { type:'object', additionalProperties:false, required:['op','target'], properties:{ op:{type:'string',enum:ACTION_TYPES}, target:{type:'string',maxLength:40}, value:VALUE_SCHEMA, from:{type:'string',maxLength:40}, by:VALUE_SCHEMA, index:{type:'number'}, indexFrom:{type:'string',maxLength:40}, separator:{type:'string',maxLength:20}, event:{type:'string',maxLength:40}, when:CONDITION_SCHEMA } };
const ID = { type:'string', pattern:'^[A-Za-z][A-Za-z0-9_-]{0,39}$' };
const STATE_KEY = { type:'string', maxLength:40 };
const WORLD_SCHEMA = { type:'object', additionalProperties:true, properties:{ gravity:{type:'number'}, camera:{type:'object',additionalProperties:true}, bounds:{type:'object',additionalProperties:true}, map:{type:'object',additionalProperties:true} } };
const COMPONENT_SCHEMA = {
  type:'object', additionalProperties:false, required:['id','type'], properties:{
    id:ID, type:{type:'string',enum:['heading','text','display','input','button','spacer','board','image','link','group','repeat','scene','sound']},
    text:{type:'string',maxLength:120}, label:{type:'string',maxLength:80}, bind:STATE_KEY,
    inputType:{type:'string',enum:['text','number','email','password','date','color','range']}, event:STATE_KEY,
    variant:{type:'string',enum:['primary','secondary','danger']}, screen:ID,
    visibleWhen:STATE_KEY, hiddenWhen:STATE_KEY, enabledWhen:STATE_KEY, disabledWhen:STATE_KEY,
    rows:{type:'number',minimum:1,maximum:100}, cols:{type:'number',minimum:1,maximum:100}, indexState:STATE_KEY,
    src:{type:'string',maxLength:2000}, alt:{type:'string',maxLength:160}, href:{type:'string',maxLength:2000}, toScreen:ID,
    children:{type:'array',maxItems:160,items:ID}, layout:{type:'string',enum:['row','column','grid','stack']},
    columns:{type:'number',minimum:1,maximum:12}, gap:{type:'number',minimum:0,maximum:64},
    itemType:{type:'string',enum:['text','button','card','image']}, itemEvent:STATE_KEY, itemIndexState:STATE_KEY, itemLabelField:STATE_KEY, itemImageField:STATE_KEY,
    width:{type:'number',minimum:1,maximum:4096}, height:{type:'number',minimum:1,maximum:4096}, world:WORLD_SCHEMA,
    loop:{type:'boolean'}, volume:{type:'number',minimum:0,maximum:1}, autoplay:{type:'boolean'}
  }
};
const APP_SCHEMA = {
  type:'object', additionalProperties:false, required:['title','description','state','components','rules'], properties:{
    title:{type:'string',minLength:1,maxLength:80}, description:{type:'string',maxLength:240},
    screens:{type:'array',maxItems:40,items:ID}, activeScreen:STATE_KEY,
    state:{type:'object',additionalProperties:VALUE_SCHEMA}, components:{type:'array',minItems:1,maxItems:200,items:COMPONENT_SCHEMA},
    capabilities:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['id','type'],properties:{id:ID,type:{type:'string',enum:['interval','storage','startup','keyboard']},event:STATE_KEY,everyMs:{type:'number',minimum:16,maximum:86400000},enabledWhen:STATE_KEY,key:{type:'string',maxLength:80},stateKeys:{type:'array',maxItems:100,items:STATE_KEY},keyboardKey:{type:'string',maxLength:30},preventDefault:{type:'boolean'}}}},
    timers:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['id','event','everyMs'],properties:{id:ID,event:STATE_KEY,everyMs:{type:'number',minimum:16,maximum:86400000},enabledWhen:STATE_KEY}}},
    rules:{type:'array',maxItems:300,items:{type:'object',additionalProperties:false,required:['event','actions'],properties:{event:STATE_KEY,actions:{type:'array',minItems:1,maxItems:50,items:ACTION_SCHEMA}}}}
  }
};
module.exports = { VALUE_SCHEMA, ACTION_TYPES, APP_SCHEMA };
