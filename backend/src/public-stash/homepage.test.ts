import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerPublicStashWeb,withPublicFavicon} from './web';

test('static homepage is independent of Stash availability and preserves public routing', async () => {
 const directory=mkdtempSync(join(tmpdir(),'mystash-home-'));
 const keys=['PUBLIC_STASH_WEB_DIR','PUBLIC_STASH_ENABLED','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','MYSTASH_ANDROID_APP_LINK_FINGERPRINTS','MYSTASH_APPLE_TEAM_ID'] as const;
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 process.env.PUBLIC_STASH_WEB_DIR=directory;
 process.env.PUBLIC_STASH_ENABLED='false';
 process.env.SUPABASE_URL='https://test.invalid';
 process.env.SUPABASE_SERVICE_ROLE_KEY='offline-test-key';
 delete process.env.MYSTASH_ANDROID_APP_LINK_FINGERPRINTS;
 delete process.env.MYSTASH_APPLE_TEAM_ID;
 mkdirSync(join(directory,'home'));
 writeFileSync(join(directory,'home/index.html'),'<h1>Homepage fixture</h1>');
 writeFileSync(join(directory,'home/style.css'),'body{color:black}');
 writeFileSync(join(directory,'index.html'),'<h1>Expo fixture</h1>');
 writeFileSync(join(directory,'favicon.ico'),'favicon fixture');
 mkdirSync(join(directory,'home/legal'));
 for(const page of ['privacy','terms','cookies','account-deletion','contact','content-policy']) writeFileSync(join(directory,'home/legal',`${page}.html`),`<meta name="robots" content="noindex,follow"><h1>${page} placeholder</h1>`);
 const app=express();registerPublicStashWeb(app);
 const server=app.listen(0,'127.0.0.1');
 try {
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;
  const home=await fetch(origin);assert.equal(home.status,200);assert.match(await home.text(),/Homepage fixture/);
  assert.match(home.headers.get('cache-control')??'',/max-age=300/);
  assert.equal((await fetch(`${origin}/home/style.css`)).status,200);
  const icon=await fetch(`${origin}/favicon.ico`);assert.equal(icon.status,200);assert.equal(await icon.text(),'favicon fixture');
  assert.match(await (await fetch(`${origin}/robots.txt`)).text(),/Sitemap: https:\/\/mystash.in\/sitemap.xml/);
  const sitemap=await (await fetch(`${origin}/sitemap.xml`)).text();assert.match(sitemap,/<loc>https:\/\/mystash.in\/<\/loc>/);assert.doesNotMatch(sitemap,/\/stash\//);
  for(const page of ['privacy','terms','cookies','account-deletion','contact','content-policy']) {
   const response=await fetch(`${origin}/${page}`);assert.equal(response.status,200);assert.match(await response.text(),/noindex,follow/);
  }
  for(const route of ['/auth/callback','/stash/123','/.well-known/assetlinks.json','/.well-known/apple-app-site-association']) assert.equal((await fetch(origin+route)).status,404,route);
 } finally {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  keys.forEach(key=>{if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];});
  rmSync(directory,{recursive:true,force:true});
 }
});

test('public Expo pages use versioned smile icons while retaining the app bundle',()=>{
 const source='<html><head><link rel="icon" href="/favicon.ico" /></head><body><script src="/_expo/entry.js"></script></body></html>';
 const html=withPublicFavicon(source);
 assert.doesNotMatch(html,/href="\/favicon.ico"/);
 assert.match(html,/favicon-smile-v1.svg/);
 assert.match(html,/favicon-smile-v1.png/);
 assert.match(html,/_expo\/entry.js/);
 assert.equal(withPublicFavicon(html),html);
});
