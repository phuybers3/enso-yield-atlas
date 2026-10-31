// Reproduce the national-link, transparent-boundary and late-overlay failures of 11 October.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-19';
const fixture=process.argv.includes('--monthly-fixture');
const {document}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:`#/USA/USA?crop=maize&season=main&mask=crop&release=${release}`};
const window={addEventListener:(n,f)=>handlers[n]=f,scrollTo(){},history:{replaceState(a,b,url){location.hash=url;}},AtlasRegionalPage:require('../site/regional-page.js'),AtlasRecent:require('../site/recent-anomalies.js')};
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
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require('../site/calendar.js'),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{try{
 if(fixture && p==='data/recent-anomalies/index.json'){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'data/recent-anomalies/2026-10-31/manifest.json')));
  return new Response(JSON.stringify({releases:{[release]:Object.fromEntries(Object.entries(manifest.countries).map(([iso,file])=>[iso,release+'/'+file]))}}));
 }
 if(fixture)p=p.replace('data/recent-anomalies/'+release+'/','data/recent-anomalies/2026-10-31/');
 return new Response(fs.readFileSync(path.join(root,p)));
 }catch{return new Response('',{status:404});}}});
const ready=async()=>{for(let i=0;i<500&&!maps.cmap?.sources.u;i++)await new Promise(r=>setTimeout(r,5));assert(maps.cmap?.sources.u);return maps.cmap;};
const go=async h=>{location.hash=h+`&release=${release}`;await handlers.hashchange();return ready();};
const renderFeature=f=>({...f,id:0});
(async()=>{
 await handlers.DOMContentLoaded();await ready();
 await go('#/BRA/BRA%3A18%3A3415?crop=soybean&season=main&axis=recent');
 assert.equal(document.querySelector('[data-regional-axis=recent]').getAttribute('aria-pressed'),'true');
 assert.equal(document.querySelectorAll('.rows .recent-chart').length,4);
 assert.equal(document.querySelectorAll('.rows [data-crop-window]').length,4);
 const hasSupplement=fixture||fs.existsSync(path.join(root,'data/recent-anomalies',release,'BRA/index.json'));
 if(hasSupplement){
  assert.equal(document.querySelectorAll('.rows [data-month="2026-10"]').length,3);
  assert.match(document.querySelector('.recent-notes').textContent,/Before the typical planting date/);
  assert.match(document.querySelector('.regional-dates').textContent,/Monthly temperature through 25 Oct 2026.*NDVI through 28 Oct 2026/);
 }else assert.equal(document.querySelectorAll('.rows [data-value]').length,0);
 assert(!document.querySelector('.rows .pt.open'),'no yield-outlook markers on monthly observations');
 document.querySelector('[data-regional-axis=year]').onclick();await handlers.hashchange();await ready();
 assert.match(location.hash,/axis=year/);assert(!document.querySelector('.recent-chart'));
 document.querySelector('[data-regional-axis=recent]').onclick();await handlers.hashchange();await ready();
 const crop=document.getElementById('crop-sel');Object.defineProperty(crop,'value',{value:'maize',configurable:true});crop.onchange();await handlers.hashchange();await ready();
 assert.match(location.hash,/axis=recent/);assert.equal(document.querySelectorAll('.rows .recent-chart').length,4);
 await go('#/SRB/SRB?crop=maize&season=Annual&axis=recent');
 assert.equal(document.querySelectorAll('.rows .recent-chart').length,4);
 assert.match(document.querySelectorAll('.rows .recent-chart')[1].textContent,/extraction unavailable|not included/);
 console.log('PASS Recent anomalies navigation: direct URL, tab changes, crop changes, pre-plant observations, national gaps and separate seasonal estimates');
})().catch(e=>{console.error(e);process.exitCode=1;});
