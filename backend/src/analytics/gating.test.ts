import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Request} from '../auth/requireAuth';
import {analyticsEnabled} from './flags';
import {requestMeasurement} from './context';
import {ingestMeasurement,MeasurementRateLimit} from './service';
import {MeasurementDiagnostics} from './diagnostics';
describe('measurement privacy and operational gates',()=>{
 it('defaults off and never reaches the database when disabled',async t=>{
  const old=process.env.ANALYTICS_ENABLED;delete process.env.ANALYTICS_ENABLED;
  t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=old;});
  assert.equal(analyticsEnabled(),false);
  const admin={rpc(){throw new Error('must not collect');}} as unknown as SupabaseClient;
  assert.deepEqual(await ingestMeasurement(admin,null,{sessionId:'unused',revision:null,anonymousConsent:true},[]),{accepted:[],disabled:true});
  assert.equal(requestMeasurement({headers:{'x-mystash-session':'10000000-0000-4000-8000-000000000001'}} as unknown as Request),null);
 });
 it('uses bounded short-lived hashed rate keys',()=>{
  const limit=new MeasurementRateLimit();for(let n=0;n<12;n++)assert.equal(limit.allow('192.0.2.1',50,10000),true);
  assert.equal(limit.allow('192.0.2.1',1,10001),false);assert.equal(limit.allow('192.0.2.1',1,70001),true);
 });
 it('does not ingest a guest without a declared local opt-in',async t=>{
  const old=process.env.ANALYTICS_ENABLED;process.env.ANALYTICS_ENABLED='true';
  t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=old;});
  const admin={rpc(){throw new Error('must not collect');}} as unknown as SupabaseClient;
  assert.deepEqual(await ingestMeasurement(admin,null,{sessionId:'unused',revision:null,anonymousConsent:false},[]),{accepted:[],consent_rejected:true});
 });
 it('buffers diagnostic totals and retries without retaining raw requests',async t=>{
  const old=process.env.ANALYTICS_ENABLED;process.env.ANALYTICS_ENABLED='true';
  t.after(()=>{if(old===undefined)delete process.env.ANALYTICS_ENABLED;else process.env.ANALYTICS_ENABLED=old;});
  const seen:unknown[]=[];let fails=true;const admin={async rpc(_name:string,args:unknown){seen.push(args);return {error:fails?{}:null};}} as unknown as SupabaseClient;
  const d=new MeasurementDiagnostics();d.add('payload_rejected_batches',2);await d.flush(admin);fails=false;await d.flush(admin);
  assert.deepEqual(seen,[{p_metric:'payload_rejected_batches',p_delta:2},{p_metric:'payload_rejected_batches',p_delta:2}]);
 });
});
