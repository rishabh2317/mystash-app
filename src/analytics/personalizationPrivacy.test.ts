import assert from 'node:assert/strict';
import {describe,it} from 'node:test';
import {PendingPersonalizationWithdrawals} from './personalizationPrivacy';
function storage(){const data=new Map<string,string>();return {data,async getItem(k:string){return data.get(k)??null;},async setItem(k:string,v:string){data.set(k,v);},async removeItem(k:string){data.delete(k);}};}
describe('durable personalization withdrawal',()=>{
 it('persists before network delivery and keeps failed withdrawals for reconnect',async()=>{
  const s=storage();let online=false,calls=0;const q=new PendingPersonalizationWithdrawals(s,async()=>{calls++;assert.equal([...s.data.values()][0],'1');if(!online)throw new Error('offline');});
  await assert.rejects(()=>q.withdraw('account-a'));assert.equal(s.data.size,1);online=true;await q.flush('account-a');assert.equal(s.data.size,0);assert.equal(calls,2);
 });
 it('never sends a pending withdrawal with another account scope or as guest',async()=>{
  const s=storage();const called:string[]=[];const q=new PendingPersonalizationWithdrawals(s,async id=>{called.push(id);throw new Error('session changed');});
  await assert.rejects(()=>q.withdraw('a'));await q.flush('b');await q.flush('guest');assert.deepEqual(called,['a']);assert.equal(s.data.size,1);await assert.rejects(()=>q.withdraw('guest'));
 });
 it('coalesces concurrent foreground/settings retries',async()=>{
  const s=storage();await s.setItem('mystash.personalization.withdrawal.a','1');let calls=0,release:()=>void=()=>{};
  const gate=new Promise<void>(r=>release=r);const q=new PendingPersonalizationWithdrawals(s,async()=>{calls++;await gate;});
  const a=q.flush('a'),b=q.flush('a');await Promise.resolve();assert.equal(calls,1);release();await Promise.all([a,b]);assert.equal(s.data.size,0);
 });
 it('does no network work with no pending marker and stores no credentials or profile',async()=>{
  const s=storage();let calls=0;const q=new PendingPersonalizationWithdrawals(s,async()=>{calls++;});await q.flush('a');assert.equal(calls,0);assert.equal(s.data.size,0);
 });
});
