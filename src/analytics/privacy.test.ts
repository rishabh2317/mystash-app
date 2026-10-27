import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {analyticsIdentityChanged,devicePreferences} from './privacy';
const revision='10000000-0000-4000-8000-000000000001';
const granted={measurement_enabled:true,activity_enabled:true,revision,policy_version:1};
describe('device consent',()=>{
 it('requires an explicit matching device receipt before using account measurement',()=>{
  assert.equal(devicePreferences(granted,null).measurement_enabled,false);
  assert.equal(devicePreferences(granted,'10000000-0000-4000-8000-000000000002').activity_enabled,false);
  assert.equal(devicePreferences(granted,revision).activity_enabled,true);
 });
 it('does not let an old device receipt override withdrawal or an unknown policy',()=>{
  assert.equal(devicePreferences({...granted,measurement_enabled:false},revision).activity_enabled,false);
  assert.equal(devicePreferences({...granted,policy_version:2},revision).measurement_enabled,false);
  assert.equal(devicePreferences({measurement_enabled:'true'},revision).measurement_enabled,false);
 });
});

it('distinguishes cold auth restoration from logout and account switching',()=>{
 assert.equal(analyticsIdentityChanged(undefined,'a'),false);assert.equal(analyticsIdentityChanged('a','a'),false);
 assert.equal(analyticsIdentityChanged('a','b'),true);assert.equal(analyticsIdentityChanged('a',null),true);assert.equal(analyticsIdentityChanged(null,'a'),true);
});
