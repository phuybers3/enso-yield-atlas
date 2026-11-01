// Check the future-harvest policy and paired ellipses across map layers.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-11-01-inclusive';
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
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={overlayUnits,link,countryBounds,maskThreshold,maskRoot,forecastReason};})();');
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require('../site/calendar.js'),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{try{return new Response(fs.readFileSync(path.join(root,p)));}catch{return new Response('',{status:404});}}});
const ready=async()=>{for(let i=0;i<500&&!maps.cmap?.sources.u;i++)await new Promise(r=>setTimeout(r,5));assert(maps.cmap?.sources.u);return maps.cmap;};
const go=async h=>{location.hash=h+`&release=${release}`;await handlers.hashchange();return ready();};
const renderFeature=f=>({...f,id:0});
(async()=>{
 await handlers.DOMContentLoaded();await ready();
 const marks=()=>document.querySelectorAll('.rows .joint-region').length;
 for(const [place,title] of [['AUS/AUS%3A161%3A?crop=wheat_spring&season=main','Western Australia'],['CHN/CHN%3A42%3A420881?crop=wheat_winter&season=main','Zhongxiang']]) {
  let reference;
  for(const layer of ['outlook','historical','progress','anomaly']) {
   const map=await go('#/'+place+'&layer='+layer);
   assert.match(document.querySelector('h1').textContent,new RegExp(title));
   assert.equal(document.querySelectorAll('#mask-sel').length,1,'one working detail mask selector');
   if(title==='Western Australia') {
    assert(map.fit[0][1]<-34 && map.fit[1][1]>-15,'initial map includes WA farming south and northern extent');
   }
   assert(marks()>=2,place+' has covariance ellipses in '+layer);
   const coordinates=[...document.querySelectorAll('.rows .joint-region')].map(e=>e.getAttribute('points'));
   if(reference)assert.deepEqual(coordinates,reference);else reference=coordinates;
   assert(document.querySelector('.regional-value'),'finite local headline');
   assert.match(document.querySelector('.regional-page').textContent,/does not contribute to production totals/);
  }
  await go('#/'+place+'&axis=year');assert.equal(marks(),0);assert(document.querySelector('.rows polygon.pt.open'),'future History marker');
  await go('#/'+place+'&index=std');assert.equal(marks(),0,'relative ellipse never on conventional index');
 }
 for(const place of ['PHL/PHL%3A57%3A?crop=maize&season=main','CHN/CHN%3A23%3A230882?crop=rice&season=main','RUS/RUS?crop=wheat&season=Annual']) {
  await go('#/'+place+'&layer=historical');assert.equal(marks(),0);
  assert.match(document.querySelector('.forecast-timing').textContent,/ENSO coverage ends 31 July 2027/);
  assert(document.querySelectorAll('.rows circle.pt').length>10,'historical points retained');
 }
 await go('#/PHL/PHL%3A57%3A?crop=rice&season=main');assert(marks()>=2,'existing supported rice preserved');
 // An earlier regression fixture used Montana's now-completed October maize
 // harvest. Michigan remains inside its next-harvest window on 1 November.
 await go('#/USA/USA%3A26?crop=maize&season=main');assert(marks()>=2,'supported state retains ellipses');
 const stateMarks=[...document.querySelectorAll('.rows .joint-region')].map(e=>e.getAttribute('points'));
 for(const layer of ['historical','progress','anomaly']) {
  await go('#/USA/USA%3A26?crop=maize&season=main&layer='+layer);
  assert.deepEqual([...document.querySelectorAll('.rows .joint-region')].map(e=>e.getAttribute('points')),stateMarks);
 }
 let usMap=await go('#/USA/USA?crop=maize&season=main');
 assert(!document.querySelector('.regional-page'),'county-season link resolves to US overview');
 assert(usMap.fit[0][0]<-124&&usMap.fit[1][0]>-67,'contiguous US initial extent');
 let iowa=usMap.sources.u.data.features.find(f=>f.id==='USA:19:79');
 usMap.events['click:u-hit']({features:[renderFeature(iowa)]});await handlers.hashchange();usMap=await ready();
 assert.match(location.hash,/USA%3A19\?/,'country map opens state');
 iowa=usMap.sources.u.data.features.find(f=>f.id==='USA:19:79');usMap.camera={center:[-94,42],zoom:7};
 usMap.events['click:u-hit']({features:[renderFeature(iowa)]});await handlers.hashchange();usMap=await ready();
 assert.match(location.hash,/USA%3A19%3A79\?/,'state map selects county');
 assert.deepEqual(usMap.camera.center,[-94,42],'selection preserves panned viewport');
 let map=await go('#/CHN?crop=wheat_winter&season=main');
 let f=map.sources.u.data.features.find(f=>f.id==='CHN:42:420881');assert(f);assert.match(f.properties.words,/Yield/);assert.notEqual(f.properties.color,'#d1d0ca');
 assert.equal(document.querySelector('#mask-sel option[selected]').value,'crop');
 assert.equal(window.test.maskThreshold({q:new URLSearchParams()}),1);
 for(const [mask,value,asset] of [['crop',1,'threshold-1'],['crop5',5,'cropgrids'],['all',0,null]]) {
  map=await go('#/CHN?crop=wheat_winter&season=main&mask='+mask);
  assert.equal(window.test.maskThreshold({q:new URLSearchParams('mask='+mask)}),value);
  const sourceText=JSON.stringify(map.sources);
  if(asset)assert(sourceText.includes(asset));
  if(mask==='crop5')assert(!sourceText.includes('threshold-1'));
 }
 for(const crop of ['maize','rice','wheat','soybean','sorghum','cassava']) {
  await go('#/CHN?crop='+crop);assert.equal(document.querySelectorAll('#crop-sel option').length,6);
 }
 assert.match(window.test.forecastReason({status:'insufficient_training',eligible_years:9}),/9 eligible.*10 required/);
 console.log('PASS inclusive forecast views: new local ellipses, layer invariance, history/conventional axes, explicit horizon omissions, six crops, 1%/5%/all masks');
})().catch(e=>{console.error(e);process.exitCode=1;});
