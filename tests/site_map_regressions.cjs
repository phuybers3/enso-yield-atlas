// Reproduce the national-link, transparent-boundary and late-overlay failures of 11 October.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-10';
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
 await handlers.DOMContentLoaded();let map=await ready();
 assert.match(location.hash,/^#\/USA\?/);assert.match(document.querySelector('h1').textContent,/main season/);assert(!document.querySelector('.regional-page'),'mismatched national link opens country map');
 assert(map.fit[0][0]<-124&&map.fit[1][0]>-67&&map.fit[0][1]<25&&map.fit[1][1]>49,'complete contiguous US extent');
 const iowa=map.sources.u.data.features.find(f=>f.id==='USA:19:79');map.events['click:u-hit']({features:[renderFeature(iowa)]});assert.match(location.hash,/USA%3A19\?/,'US polygon opens state');
 await handlers.hashchange();map=await ready();const county=map.sources.u.data.features.find(f=>f.id==='USA:19:79');map.events['click:u-hit']({features:[renderFeature(county)]});assert.match(location.hash,/USA%3A19%3A79\?/,'state polygon opens county');
 map=await go('#/CHN?crop=maize&mask=crop');assert(!document.querySelector('.regional-page'),'China remains a country overview with its alternative records visible');
 const cn=map.sources.u.data.features.find(f=>f.id==='CHN'),yu=map.sources.u.data.features.find(f=>f.id==='CHN:41:410725');
 assert(yu.properties.outlineOnly&&yu.properties.selectable&&yu.properties.season==='main');assert(cn.properties.color!=='#fbfaf7');
 map.events['click:u-hit']({features:[renderFeature(cn),renderFeature(yu)]});assert.match(location.hash,/CHN%3A41%3A410725\?/);assert.match(location.hash,/season=main/,'county selection uses the county season');
 await handlers.hashchange();await ready();assert.match(document.querySelector('h1').textContent,/Yuanyang/);assert(document.querySelectorAll('.pt').length>0);
 map=await go('#/CHN?crop=maize&layer=progress');assert.match(document.querySelector('h1').textContent,/main season/);const dates=map.sources.u.data.features.filter(f=>f.properties.harvestDay!=null);assert(dates.length>1900&&new Set(dates.map(f=>f.properties.harvestDay)).size>1,'China calendar defaults to varying district dates');
 map=await go('#/CHN?crop=maize&layer=historical');
 assert.match(document.querySelector('h1').textContent,/historical ENSO response/);
 const raw=JSON.parse(fs.readFileSync(path.join(root,`data/${release}/units/CHN.json`)));
 const registry=JSON.parse(fs.readFileSync(path.join(root,'data/historical-responses/index.json')));
 const historical=JSON.parse(fs.readFileSync(path.join(root,'data/historical-responses',registry.releases[release]['CHN-maize'])));
 const response=r=>(r?.responses||[]).find(x=>x.variable==='ly'&&x.index==='rel');
 const fittedCount=Object.values(historical.series).filter(r=>Number.isFinite(response(r)?.pct_eb)).length;
 const hf=map.sources.u.data.features.filter(f=>f.properties.words.includes('Historical yield response'));
 assert.equal(hf.length,fittedCount,'every available same-release historical fit is mapped');
 assert(new Set(hf.map(f=>f.properties.color)).size>100,'local differences retained');
 assert.equal(map.sources.u.data.features.filter(f=>f.properties.words.includes('Fewer than 10 usable years')).length,1986-fittedCount);
 map.events['click:u-hit']({features:[renderFeature(hf.find(f=>f.id==='CHN:41:410725'))]});
 await handlers.hashchange();await ready();
 const selectedSeries=raw.units['CHN:41:410725'].series.find(s=>s.crop_family==='maize');
 const selected=historical.series[selectedSeries.id],value=response(selected).pct_eb;
 assert(document.querySelector('.regional-subtitle').textContent.includes(`${response(selected).year_first}–${response(selected).year_last}`),'historical label uses the fitted period of this release');
 assert.equal(document.querySelector('.regional-value').textContent,(value>0?'+':'')+value.toFixed(1).replace('-','−')+'%');
 assert.match(document.querySelector('.regional-skill').textContent,selected.validation?.length?/No improvement|lower squared error/:/not assessed/);
 assert.equal(document.querySelectorAll('.rows .pt.open').length,0,'historical layer carries no 2026 forecast markers');
 const labels=[...document.querySelectorAll('.rows section.row .label')].map(x=>x.firstChild.textContent);
 for(const required of ['Temperature','Rainfall','Yield'])assert(labels.includes(required),`${required} is shown`);
 assert(labels.every(x=>['Temperature','Rainfall','Greenness','Yield'].includes(x)),'only known measures are shown');
 map=await go('#/CHN/CHN%3A41%3A410725?crop=maize&season=main&layer=outlook');
 assert.match(document.querySelector('.regional-value').textContent,/Current estimate unavailable/);
 assert.equal(map.sources.u.data.features.find(f=>f.id==='CHN:41:410725').properties.color,'#cfcec8','historical response never becomes an outlook');
 assert.equal(raw.units['CHN:41:410725'].series.find(s=>s.crop_family==='maize').predictions.length,0);
 const worldLink=window.test.link(null,null,{crop:'maize',season:'Annual',series:'x',harvest:2026,release});assert(!/season|series|harvest/.test(worldLink),'world breadcrumb clears place-specific context');
 const late=new MapStub({container:'late'});await new Promise(r=>setTimeout(r,0));late.addLayer({id:'u-line'});window.__atlas.maps.late=late;
 window.test.overlayUnits('late',{type:'FeatureCollection',features:[{id:'a',properties:{},geometry:null}]},()=>'',()=>{});
 assert(late.sources.wu,'late overlay attaches after load while loaded() is false');
 console.log('PASS map regressions: US extent and selection; China historical response, coverage, weather, skill, no forecast contamination; calendar; world links; late overlays');
})().catch(e=>{console.error(e);process.exitCode=1;});
