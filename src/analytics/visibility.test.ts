import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {visibleFraction,ExposureDwell} from './visibility';
describe('qualified card exposure',()=>{
 it('excludes offscreen horizontal rail items and clipped vertical content',()=>{
  assert.equal(visibleFraction(500,100,100,100,400,50,700),0);
  assert.equal(visibleFraction(350,100,100,100,400,50,700),0.5);
  assert.equal(visibleFraction(0,0,100,100,400,50,700),0.5);
  assert.equal(visibleFraction(0,100,0,100,400,50,700),0);
 });
 it('requires one second of observed continuous foreground visibility',()=>{
  const d=new ExposureDwell();assert.equal(d.observe(1,true,0),false);assert.equal(d.observe(1,true,500),false);
  assert.equal(d.observe(1,true,1000),true);d.observe(0,false,1100);assert.equal(d.observe(1,true,2000),false);
 });
 it('does not count background time or long gaps between native observations',()=>{
  const d=new ExposureDwell();d.observe(1,true,0);assert.equal(d.observe(1,true,5000),false);
  d.reset();assert.equal(d.observe(1,true,10000),false);assert.equal(d.observe(1,false,11000),false);
 });
});
