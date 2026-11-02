import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retireTerminalJob} from './terminalJob';
test('never removes waiting, active, delayed or paused work',async()=>{
 for(const state of ['waiting','active','delayed','paused'])await retireTerminalJob(async()=>({getState:async()=>state,remove:async()=>{throw Error('must not remove');}}));
});
test('a competing retry replacing the terminal job is safe',async()=>{
 let n=0;
 await retireTerminalJob(async()=>++n===1?{getState:async()=>'failed',remove:async()=>{throw Error('locked');}}:{getState:async()=>'active',remove:async()=>{throw Error('must not remove');}});
});
test('a retained terminal job is an actionable failure',async()=>{
 await assert.rejects(()=>retireTerminalJob(async()=>({getState:async()=>'failed',remove:async()=>{throw Error('storage failure');}})),/terminal_job_retained/);
});
