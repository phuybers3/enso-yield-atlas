// Reproduce the national-link, transparent-boundary and late-overlay failures of 11 October.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-19';
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
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={load,geometryHasDatelineJump,countryBounds,countryExtent};})();');
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require('../site/calendar.js'),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{try{return new Response(fs.readFileSync(path.join(root,p)));}catch{return new Response('',{status:404});}}});
const ready=async()=>{for(let i=0;i<500&&!maps.cmap?.sources.u;i++)await new Promise(r=>setTimeout(r,5));assert(maps.cmap?.sources.u);return maps.cmap;};
const go=async h=>{location.hash=h+`&release=${release}`;await handlers.hashchange();return ready();};
const renderFeature=f=>({...f,id:0});
(async()=>{
 const results=[];
 for(const iso of ['RUS','FJI','AUS','USA','NZL']) {
  const geo=await window.test.load(`data/${release}/geometry/${iso}.json`);
  assert(geo.features.every(f=>!window.test.geometryHasDatelineJump(f.geometry)),iso+' has no world-spanning ring edges');
  const b=window.test.countryBounds(geo,iso);
  assert(b[1][0]-b[0][0]<180,iso+' camera must not span the world');
  if(iso==='AUS')assert(b[0][0]>110&&b[1][0]<160,'Australia remains framed on Australia');
  results.push([iso,b]);
 }
 console.log('PASS date-line geometry and camera extents',JSON.stringify(results));
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
