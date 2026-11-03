import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('Find observations use the existing queue, honor consent/feature shutdown and fence switched accounts',()=>{
 const calls:unknown[][]=[];const state={enabled:false,scope:'A'};const env={EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED:'true'};
 const exports:Record<string,unknown>={};const code=ts.transpileModule(fs.readFileSync('src/analytics/findMeasurement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env},require:()=>({analyticsSnapshot:()=>state,enqueueObservation:(...args:unknown[])=>calls.push(args)})});
 const observe=exports.observeFind as (owner:string,name:string,input?:unknown)=>void;
 observe('A','find.capture_submitted',{origin:'gallery'});assert.equal(calls.length,0);
 state.enabled=true;observe('B','find.results_opened',{findId:'PRIVATE_FIND_ID'});assert.equal(calls.length,0);
 observe('A','find.capture_submitted',{origin:'gallery',url:'PRIVATE URL CANARY',note:'PRIVATE NOTE CANARY'});assert.equal(calls.length,1);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
 env.EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED='false';observe('A','find.opened');assert.equal(calls.length,1);
 state.enabled=false;env.EXPO_PUBLIC_FIND_MEASUREMENT_ENABLED='true';observe('A','find.opened');assert.equal(calls.length,1);
});
