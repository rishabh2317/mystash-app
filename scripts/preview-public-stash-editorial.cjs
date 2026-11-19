/* global __dirname */
/** Local-only public API fixtures. No credentials, remote services, or live writes. */
const path=require('node:path'),fs=require('node:fs');
const express=require('../backend/node_modules/express');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'public-web/dist'),app=express();
app.use(express.json());
const requests=[];const revoked=new Set();
const uuid=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const photos=['interior.jpg','cafe.jpg','chair.jpg','coast.jpg','camera.jpg'];
const available=fs.readdirSync(path.join(root,'public/home/media'));console.log('Fixture image assets:',available.filter(x=>/room|coffee|chair|villa|camera/.test(x)).join(', '));
const productNames=['A slower kind of Sunday','One more coffee','That perfect corner chair','Out-of-office inspiration','The everyday camera'];
const fixtureItems=Array.from({length:25},(_,i)=>({id:uuid(i+1),namespace:i%2?'discovered':'catalog',title:productNames[i%5],brand:i===0?'For your space':i===1?'For a slow morning':'A good find',image:`/home/media/${photos[i%5]}`}));
app.use('/public-stashes',(req,res,next)=>{requests.push(req.originalUrl);res.set('Cache-Control','no-store');if(revoked.has(req.path.split('/')[1])||req.path.includes(uuid(404)))return res.status(404).json({error:'Unavailable'});next();});
app.get('/__fixture/requests',(_req,res)=>res.json(requests));
app.post('/__fixture/revoke/:id',(req,res)=>{revoked.add(req.params.id);res.json({ok:true});});
app.get('/public-stashes/:id',(req,res)=>{const tab=req.query.tab==='places'?'places':'products',count=Number(req.params.id.slice(-3)),total=[0,1,2,3,5,25].includes(count)?count:5,offset=req.query.cursor==='page2'?20:0;
 setTimeout(()=>res.json({schemaVersion:1,publicId:req.params.id,curator:{username:'sonam',avatarUrl:null},counts:{products:total,places:total},items:fixtureItems.slice(offset,offset+20).slice(0,Math.max(0,total-offset)).map((item,i)=>tab==='products'?item:{id:item.id,title:['A sunlit hideaway','The coffee stop','A slower kind of weekend'][i%3],category:'A place for your someday',city:'Mumbai',country:'India'}),nextCursor:total>20&&offset===0?'page2':null,tab}),180);});
app.get('/public-stashes/:stash/products/:namespace/:id/page',(req,res)=>res.json({productId:req.params.id,shoppingProductId:req.params.namespace==='catalog'?req.params.id:null,title:'That perfect corner chair',brand:'Fixture studio',heroImage:'/home/media/chair.jpg',galleryImages:[],description:'Local fixture — stored product detail.',specifications:{Material:'Linen'},offers:[{id:'verified-fixture',merchant:'Verified fixture merchant',price:'120',currency:'INR',action:'buy',availability:'in_stock'}],canShop:true,commerceCountry:'IN',source:null,relatedMedia:[],reviews:null,compareAvailable:false,detailsUpdating:false}));
app.get('/public-stashes/:stash/products/:namespace/:id/outbound',(req,res)=>res.json({url:`http://127.0.0.1:8794/__fixture/merchant?offerId=${req.query.offerId||''}`,merchantName:'Verified fixture merchant'}));
app.get('/__fixture/merchant',(req,res)=>res.type('html').send(`<h1>Verified fixture merchant</h1><p>Offer ${req.query.offerId}</p>`));
app.get('/public-stashes/:stash/places/:id/photo',(_req,res)=>res.json({image:null}));
app.get('/public-stashes/:stash/places/:id',(req,res)=>res.json({id:req.params.id,name:'The coffee stop',category:'Cafe',city:'Mumbai',region:null,country:'India',locality:'Bandra',formattedAddress:'Fixture address, Bandra, Mumbai',latitude:19.05,longitude:72.83,mapsUrl:'https://maps.google.com/?q=Mumbai',provider:'google'}));
app.use('/home',express.static(path.join(root,'public/home')));
app.use(express.static(directory,{index:false}));
app.get(['/stash/:id','/stash/:id/products/:namespace/:product','/stash/:id/places/:place','/stash/:id/sign-in'],(_req,res)=>res.type('html').send(fs.readFileSync(path.join(directory,'index.html'),'utf8')));
app.use((_req,res)=>res.status(404).json({error:'Local fixture route unavailable'}));
app.listen(8794,'127.0.0.1',()=>console.log(`Editorial Public Stash preview (offline fixtures): http://127.0.0.1:8794/stash/${uuid(3)}`));
