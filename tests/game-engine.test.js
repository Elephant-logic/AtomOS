'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../public/game-engine.js');

test('detects entity overlap with axis aligned boxes', () => {
  assert.equal(engine.overlaps({ x:0,y:0,width:20,height:20 }, { x:10,y:10,width:20,height:20 }), true);
  assert.equal(engine.overlaps({ x:0,y:0,width:20,height:20 }, { x:30,y:30,width:20,height:20 }), false);
});

test('steps velocity acceleration gravity and bounds deterministically', () => {
  const result = engine.stepEntity({ x:0,y:0,width:10,height:10,vx:100,vy:0,ax:0,ay:0 }, 100, {
    gravity:100,
    bounds:{ x:0,y:0,width:200,height:200 }
  });
  assert.equal(result.x, 10);
  assert.equal(result.y, 1);
  assert.equal(result.vy, 10);
});

test('blocks movement into solid tile map cells', () => {
  const map={ cols:2,rows:1,tileWidth:32,tileHeight:32,tiles:[0,1],solidTiles:[1] };
  const result=engine.stepEntity({ x:0,y:0,width:32,height:32,vx:400,vy:0 },100,{ map });
  assert.equal(result.x,0);
  assert.equal(result.vx,0);
});

test('selects sprite sheet animation frame from elapsed time', () => {
  const sprite={ animation:'walk',animations:{ walk:{ fps:4,frames:[2,3,4,5] } } };
  assert.equal(engine.animationFrame(sprite,0),2);
  assert.equal(engine.animationFrame(sprite,500),4);
  assert.equal(engine.animationFrame(sprite,1000),2);
});

test('camera follows an entity and converts world coordinates', () => {
  const camera=engine.cameraFollow({ zoom:2 },{ x:100,y:50,width:20,height:20 },{ width:200,height:100 });
  assert.deepEqual(camera,{ zoom:2,x:60,y:35 });
  assert.deepEqual(engine.worldToScreen({ x:70,y:40,width:10,height:5 },camera),{ x:20,y:10,width:20,height:10 });
});

test('world step applies keyboard controls and follows player', () => {
  let world=engine.createWorld({
    entities:[{ id:'player',x:0,y:0,width:16,height:16,speed:120,controls:{ right:'ArrowRight' } }],
    camera:{ follow:'player',viewport:{ width:100,height:100 } }
  });
  world=engine.stepWorld(world,100,{ ArrowRight:true });
  assert.equal(world.entities[0].x,12);
  assert.equal(world.entities[0].vx,120);
  assert.equal(world.camera.follow,'player');
});