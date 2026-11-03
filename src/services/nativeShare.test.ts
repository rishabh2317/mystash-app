import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { normalizeSharedInput } from '../../backend/src/user-import/domain/sharedInput';
import { extractSharedLink } from '../ui/shareImport';

test('native share fixtures agree with existing frontend and backend URL policy',()=>{
 const fixtures=JSON.parse(fs.readFileSync('modules/mystash-share/fixtures/share-links.json','utf8')) as {input:string;ok:boolean}[];
 for(const f of fixtures){assert.equal(extractSharedLink(f.input).ok,f.ok,f.input);assert.equal(normalizeSharedInput(f.input).ok,f.ok,f.input);}
});
test('session bridge coalesces changes, copies no refresh token, and clears on logout',async()=>{
 const calls:unknown[]=[];
 const native={syncSession:async(value:unknown)=>{calls.push(value);},listPending:async()=>[],claim:async()=>{},discard:async()=>{},retry:async()=>{}};
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(fs.readFileSync('src/services/nativeShare.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{EXPO_PUBLIC_NATIVE_SHARE_ENABLED:'true',EXPO_PUBLIC_MYSTASH_INGEST_URL:'https://example.test'}},
  require:(id:string)=>id==='@/modules/mystash-share'?{__esModule:true,default:native}:{isAuthEmailVerified:()=>true}});
 const sync=exports.syncNativeShareSession as (s:unknown)=>Promise<void>;
 const a={user:{id:'a'},access_token:'access-a',refresh_token:'private-refresh',expires_at:100};
 await Promise.all([sync(a),sync({...a,user:{id:'b'},access_token:'access-b'})]);
 assert.equal(calls.length,1);assert.equal((calls[0] as {accountId:string}).accountId,'b');
 assert.deepEqual(Object.keys(calls[0] as object).sort(),['accessToken','accountId','apiBase','expiresAt']);
 await sync(null);assert.equal(calls.at(-1),null);assert.ok(!JSON.stringify(calls).includes('private-refresh'));
});
