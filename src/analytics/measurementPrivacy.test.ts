import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {MeasurementPrivacy,measurementDeviceReceipt,type MeasurementChange} from './measurementPrivacy';
const id='10000000-0000-4000-8000-000000000001';
const prefs={measurement_enabled:true,activity_enabled:true,revision:id,policy_version:1};
function memory(){const values=new Map<string,string>();return {values,getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}};}
describe('flag-independent durable general privacy recovery',()=>{
 it('journals an offline withdrawal, recovers without a device receipt, and only decreases on replay',async()=>{
  const store=memory();let offline=true;const calls:(MeasurementChange|undefined)[]=[];
  const privacy=new MeasurementPrivacy(store,async(_scope,change)=>{calls.push(change);if(offline)throw new Error('offline');return {enabled:false,preferences:{...prefs,measurement_enabled:false,activity_enabled:false}};});
  store.values.set(measurementDeviceReceipt('a'),id);
  await assert.rejects(()=>privacy.change('a',{measurement_enabled:false,activity_enabled:false,decrease_only:true},false));
  assert.equal(await privacy.recoverable('a'),true);assert.equal(store.values.has(measurementDeviceReceipt('a')),false);
  offline=false;await privacy.read('a');assert.equal(await privacy.recoverable('a'),false);
  assert.deepEqual(calls[1],{measurement_enabled:false,activity_enabled:false,decrease_only:true});
 });
 it('partial decreases preserve only explicitly consenting devices and use the returned revision',async()=>{
  for(const device of [true,false]){const store=memory();const privacy=new MeasurementPrivacy(store,async()=>({enabled:false,preferences:{...prefs,activity_enabled:false}}));
   await privacy.change('a',{measurement_enabled:true,activity_enabled:false,decrease_only:true},device);
   assert.equal(store.values.get(measurementDeviceReceipt('a')),device?id:undefined);assert.equal(await privacy.recoverable('a'),true);
  }
 });
 it('does not overwrite newer withdrawals during concurrent operations or activate a new device on GET',async()=>{
  const store=memory();const calls:boolean[]=[];const privacy=new MeasurementPrivacy(store,async(_s,c)=>{if(c)calls.push(c.measurement_enabled);return {enabled:false,preferences:{...prefs,measurement_enabled:c?.measurement_enabled??false,activity_enabled:false}};});
  await Promise.all([privacy.change('a',{measurement_enabled:true,activity_enabled:false,decrease_only:true},true),privacy.change('a',{measurement_enabled:false,activity_enabled:false,decrease_only:true},false)]);
  assert.deepEqual(calls,[true,false]);assert.equal(await privacy.recoverable('a'),false);
  await privacy.read('a');assert.equal(store.values.has(measurementDeviceReceipt('a')),false);
 });
 it('keeps failed or malformed journal entries rather than claiming withdrawal succeeded',async()=>{
  const store=memory();store.values.set('mystash.analytics.withdrawal.a','{"measurement_enabled":true,"activity_enabled":true}');
  const privacy=new MeasurementPrivacy(store,async()=>{throw new Error('must not send enable');});await assert.rejects(()=>privacy.flush('a'),/Invalid withdrawal/);
  assert.equal(await privacy.recoverable('a'),true);await privacy.flush('b');assert.equal(store.values.size,1);
 });
});
