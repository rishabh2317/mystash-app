import express,{type Express,type Request,type Response} from 'express';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {PublicStashService} from './service';
import {createSupabaseAdmin} from '../supabase';
import {uuid,StashError} from './contracts';
import {publicStashEnabled,publicStashRateAllowed} from './routes';
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
/** Versioned icon URLs bypass the browser's old Expo-favicon cache. */
export function withPublicFavicon(source:string){
 const icons='<link rel="icon" type="image/png" sizes="32x32" href="/home/media/favicon-sage-cream-v3.png"><link rel="icon" type="image/svg+xml" sizes="any" href="/home/media/favicon-sage-cream-v3.svg">';
 return source.replace(/<link\b[^>]*rel=["'](?:shortcut icon|icon)["'][^>]*>/gi,'').replace('</head>',`${icons}</head>`);
}
export function registerPublicStashWeb(app:Express){
 const directory=resolve(process.env.PUBLIC_STASH_WEB_DIR??'public-web'),entry=resolve(directory,'index.html'),svc=new PublicStashService(createSupabaseAdmin());
 // The marketing homepage has its own static entry; shared links keep the Expo entry.
 const homepage=resolve(directory,'home/index.html');
 app.use('/home',express.static(resolve(directory,'home'),{maxAge:'1h',fallthrough:false}));
 app.get('/',(_req,res)=>{
  res.set('Cache-Control','public, max-age=300');
  if(existsSync(homepage)){res.sendFile(homepage);return;}
  res.status(503).type('html').send('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mystash</title><main><h1>Mystash</h1><p>A home for everything that catches your eye.</p><p>The homepage is temporarily unavailable.</p></main></html>');
 });
 // Editable legal/support shells use explicit routes, separate from shared content.
 for(const page of ['privacy','terms','cookies','account-deletion','contact','content-policy']){
  app.get(`/${page}`,(_req,res)=>res.set('Cache-Control','public, max-age=300').sendFile(resolve(directory,'home/legal',`${page}.html`)));
 }
 app.get('/favicon.ico',(_req,res)=>res.set('Cache-Control','public, max-age=300').sendFile(resolve(directory,'home/media/favicon-sage-cream-v3.ico')));
 app.get('/robots.txt',(_req,res)=>res.type('text').send('User-agent: *\nAllow: /\nDisallow: /auth/\nSitemap: https://mystash.in/sitemap.xml\n'));
 app.get('/sitemap.xml',(_req,res)=>res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://mystash.in/</loc></url></urlset>'));
 app.get('/.well-known/assetlinks.json',(_req,res)=>{
  const fingerprints=(process.env.MYSTASH_ANDROID_APP_LINK_FINGERPRINTS??'').split(',').map(s=>s.trim()).filter(s=>/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(s));
  if(!fingerprints.length){res.status(404).json({error:'Association not configured'});return;}
  res.json([{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.anonymous.Mystash',sha256_cert_fingerprints:fingerprints}}]);
 });
 app.get('/.well-known/apple-app-site-association',(_req,res)=>{
  const team=process.env.MYSTASH_APPLE_TEAM_ID;if(!team||!/^[A-Z0-9]{10}$/.test(team)){res.status(404).json({error:'Association not configured'});return;}
  res.json({applinks:{apps:[],details:[{appID:`${team}.com.anonymous.Mystash`,paths:['/stash/*']}]}});
 });
 app.get('/auth/callback',(_req,res)=>{res.set('Cache-Control','private, no-store').set('Referrer-Policy','no-referrer');if(!existsSync(entry)||!publicStashEnabled()){res.status(404).send('Unavailable');return;}res.type('html').send(withPublicFavicon(readFileSync(entry,'utf8')));});
 app.get('/public-stash-share.png',(_req,res)=>res.sendFile(resolve(directory,'public-stash-share.png')));
 app.use('/_expo',express.static(resolve(directory,'_expo'),{immutable:true,maxAge:'1y',fallthrough:false}));
 app.use('/assets',express.static(resolve(directory,'assets'),{immutable:true,maxAge:'1y',fallthrough:false}));
 const html=async(req:Request,res:Response)=>{
  res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   if(!publicStashEnabled()||!existsSync(entry))throw new StashError(404,'Unavailable');
   if(!await publicStashRateAllowed(req)){res.status(429).type('html').send('<h1>Please try again shortly</h1>');return;}
   const id=uuid(req.params.publicId);let summary='Open Mystash to preview your Public Stash.';
   if(req.query.preview!=='1'){
    const page=await svc.page(id,{});
    if(req.params.productId)await svc.item(id,'product',req.params.namespace,uuid(req.params.productId));
    if(req.params.placeId)await svc.item(id,'place','place',uuid(req.params.placeId));
    summary=`Curated by @${escapeHtml(page.curator.username)} · ${page.counts.products} Products · ${page.counts.places} Places`;
   }
   const canonical=`https://mystash.in${req.path}`;
   const head=`<title>Public Stash on Mystash</title><meta name="description" content="Discover curated Products and Places on Mystash."><meta property="og:title" content="Public Stash on Mystash"><meta property="og:description" content="Discover curated Products and Places on Mystash."><meta property="og:image" content="https://mystash.in/public-stash-share.png"><meta property="og:type" content="website"><meta property="og:url" content="${escapeHtml(canonical)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta name="robots" content="noindex,follow">`;
   const source=withPublicFavicon(readFileSync(entry,'utf8')).replace(/<title>.*?<\/title>/s,'').replace('</head>',`${head}</head>`).replace('</body>',`<noscript><h1>Public Stash</h1><p>${summary}</p><p>Enable JavaScript to browse Products and Places.</p></noscript></body>`);
   res.type('html').send(source);
  }catch(error){res.status(error instanceof StashError?error.status:503).type('html').send('<!doctype html><html><head><meta name="robots" content="noindex"><title>Stash unavailable</title></head><body><h1>Stash unavailable</h1><p>This Stash may be private or no longer available.</p></body></html>');}
 };
 app.get(['/stash/:publicId','/stash/:publicId/products/:namespace/:productId','/stash/:publicId/places/:placeId','/stash/:publicId/sign-in'],html);
}
