// Check the future-harvest policy and paired ellipses across map layers.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-31-forecast-v2';
const {document}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:`#/USA/USA?crop=maize&season=main&mask=crop&release=${release}`};
const window={addEventListener:(n,f)=>handlers[n]=f,scrollTo(){},history:{replaceState(a,b,url){location.hash=url;}},AtlasRegionalPage:require('../site/regional-page.js')};
class MapStub {
  constructor(o){maps[o.container]=this;this.sources={};this.layers={};this.events={};this.pending=[];this.canvas=document.createElement('canvas');setTimeout(()=>{this.fired=true;for(const f of this.pending)f();},0);}
  on(n,layer,fn){if(n==='load'){if(!this.fired)this.pending.push(layer);}else this.events[fn?`${n}:${layer}`:n]=fn||layer;}
  addSource(k,s){this.sources[k]={...s,setData(d){this.data=d;}};} getSource(k){return this.sources[k];}
  addLayer(l){this.layers[l.id]=l;} getLayer(k){return this.layers[k];}
  // loaded() remains false while worker sources are busy; the load event does not fire again.
  loaded(){return false;} fitBounds(b){this.fit=b;} jumpTo(c){this.camera=c;} resize(){}
  getCanvas(){return this.canvas;} getCenter(){return {toArray:()=>this.camera?.center||[(this.fit[0][0]+this.fit[1][0])/2,(this.fit[0][1]+this.fit[1][1])/2]};}
  getZoom(){return this.camera?.zoom??5;} getBounds(){return {toArray:()=>this.fit||[[-110,30],[-80,50]]};}
  queryRenderedFeatures(){return [];} remove(){this.removed=true;}
}
const maplibregl={Map:MapStub};window.maplibregl=maplibregl;
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={overlayUnits,link,countryBounds};})();');
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require('../site/calendar.js'),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{try{return new Response(fs.readFileSync(path.join(root,p)));}catch{return new Response('',{status:404});}}});
const ready=async()=>{for(let i=0;i<500&&!maps.cmap?.sources.u;i++)await new Promise(r=>setTimeout(r,5));assert(maps.cmap?.sources.u);return maps.cmap;};
const go=async h=>{location.hash=h+`&release=${release}`;await handlers.hashchange();return ready();};
const renderFeature=f=>({...f,id:0});
(async()=>{
 await handlers.DOMContentLoaded();await ready();
 const marks=()=>document.querySelectorAll('.rows .joint-region,.rows polygon.pt.open').length;
 for(const layer of ['historical','outlook','progress','anomaly']) {
  await go('#/PHL/PHL%3A57%3A?crop=maize&season=main&layer='+layer);
  assert.equal(marks(),0,'unsupported maize has no forecast marks in '+layer);
  assert.match(document.querySelector('.forecast-timing').textContent,/Outlook withheld.*13 August 2027.*31 July 2027/);
  assert(document.querySelectorAll('.rows circle.pt').length>20,'historical observations retained');
  assert(document.querySelectorAll('.rows path[stroke="#111"]').length>0,'historical regression retained');
 }
 let reference;
 for(const layer of ['outlook','historical','progress','anomaly']) {
  await go('#/PHL/PHL%3A57%3A?crop=rice&season=main&layer='+layer);
  assert(document.querySelectorAll('.rows .joint-region').length>=2,'supported future rice retains ellipses');
  assert.match(document.querySelector('.forecast-timing').textContent,/5 November 2026/);
  const coordinates=[...document.querySelectorAll('.rows .joint-region')].map(e=>e.getAttribute('points'));
  if(reference)assert.deepEqual(coordinates,reference);else reference=coordinates;
 }
 await go('#/PHL/PHL%3A57%3A?crop=rice&season=main&axis=year');
 assert.equal(document.querySelectorAll('.rows .joint-region').length,0);
 assert(document.querySelectorAll('.rows polygon.pt.open').length>0,'History retains the supported future marker');
 await go('#/USA/USA%3A30?crop=maize&season=main&layer=historical');
 assert.equal(marks(),0,'past Montana harvest is not still forecast');
 assert(document.querySelectorAll('.rows path[stroke="#111"]').length>0,'state historical relationship survives missing current coverage');
 await go('#/CHN/CHN%3A41%3A410725?crop=maize&season=main&layer=historical');
 assert.equal(marks(),0,'older China records retain historical-only status');
 assert(document.querySelectorAll('.rows circle.pt').length>20);
 const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/releases.json'),'utf8'));
 if(catalog.retired?.length) {
  location.hash='#/PHL/PHL%3A57%3A?crop=rice&season=main&layer=historical&release='+catalog.retired[0];
  await handlers.hashchange();await ready();
  assert.match(document.querySelector('h1').textContent,/Occidental Mindoro/);
  assert(document.getElementById('foot-line').textContent.includes(catalog.default),'retired bookmark resolves to the current release');
  assert(document.querySelectorAll('.rows .joint-region').length>=2,'retired bookmark keeps crop and supported outlook');
 }
 console.log('PASS: future-harvest targets, withheld unsupported outlooks, historical relationships, rice ellipses across layers and History');
})().catch(e=>{console.error(e);process.exitCode=1;});
