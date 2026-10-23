// Verify the display against the saved release without refitting any model.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.ATLAS_SITE_ROOT||path.resolve(__dirname,'../site'),stage=root;
const requireAtlas=require('node:module').createRequire(path.join(root,'../package.json'));
const {parseHTML}=requireAtlas('linkedom');
const {document}=parseHTML(fs.readFileSync(path.join(stage,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:'#/USA/USA%3A31%3A41?crop=maize&season=main&axis=year'};
const window={addEventListener:(n,f)=>handlers[n]=f,scrollTo(){},history:{replaceState(a,b,url){location.hash=url;}},AtlasRegionalPage:require(path.join(root,'regional-page.js'))};
class MapStub {
  constructor(o){maps[o.container]=this;this.sources={};this.layers={};this.events={};this.canvas=document.createElement('canvas');}
  on(n,layer,fn){if(n==='load')setTimeout(layer,0);else this.events[fn?`${n}:${layer}`:n]=fn||layer;}
  addSource(k,s){this.sources[k]={...s,setData(d){this.data=d;}};} getSource(k){return this.sources[k];}
  addLayer(l){this.layers[l.id]=l;} getLayer(k){return this.layers[k];}
  loaded(){return true;} fitBounds(b){this.fit=b;} jumpTo(c){this.camera=c;} resize(){}
  getCanvas(){return this.canvas;} getCenter(){return {toArray:()=>this.camera?.center||[0,0]};}
  getZoom(){return 5;} getBounds(){return {toArray:()=>this.fit};}
  queryRenderedFeatures(){return [];} remove(){this.removed=true;}
}
const maplibregl={Map:MapStub};window.maplibregl=maplibregl;
const source=fs.readFileSync(path.join(stage,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={withNdviHistory};})();');
const requests=[];
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require(path.join(root,'calendar.js')),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{
  requests.push(p); const file=fs.existsSync(path.join(stage,p))?path.join(stage,p):path.join(root,p);
  try{return new Response(fs.readFileSync(file));}catch{return new Response('',{status:404});}
}});
const wait=async condition=>{for(let i=0;i<400&&!condition();i++)await new Promise(r=>setTimeout(r,5));assert(condition(),'UI ready');};
const ready=async(id='cmap')=>{await wait(()=>maps[id]?.sources.u&&!maps[id].removed);return maps[id];};
const go=async hash=>{location.hash=hash;await handlers.hashchange();assert(!document.body.textContent.includes('Something did not load'));return ready(hash.startsWith('#/?')?'wmap':'cmap');};

const row=()=>[...document.querySelectorAll('section.row')].find(r=>r.querySelector('.label').textContent.startsWith('Greenness'));
(async()=>{
  await handlers.DOMContentLoaded();await ready();
  const extra=JSON.parse(fs.readFileSync(path.join(root,'data/ndvi-history/2026-10-19/USA.json')));
  const expected=extra.series['186572596871921081'];
  assert.equal(expected.length,42,'Custer has 42 complete NDVI seasons');
  assert(row(),'Custer History displays Greenness');
  const pts=[...row().querySelectorAll('circle.pt:not(.open)')];
  assert.equal(pts.length,expected.length,'all historical NDVI points shown');
  for(const [year,value,provisional] of expected){
    const pt=pts.find(p=>Number(p.getAttribute('data-year'))===year);assert(pt);
    assert.equal(pt.classList.contains('provisional'),!!provisional,'early sensor years remain provisional');
    const label=pt.querySelector('title').textContent;
    const shown=Number(label.split(': ')[1].split(' ')[0].replace('−','-'));
    assert(Math.abs(shown-value)<=0.000501,`NDVI tooltip ${year}: ${shown} vs ${value}`);
  }
  const sentinel={weather_history:[[2001,1.25,32,0.123,0],[2002,-1.2,-30,null,null]],obs:[[2001,7]],weather:[{product:'vhp'}],joint_regions:[]};
  const before=JSON.stringify(sentinel);
  const repaired=await window.test.withNdviHistory('USA','186572596871921081',sentinel);
  assert.equal(JSON.stringify(sentinel),before,'merge does not mutate frozen input');
  assert.equal(repaired.weather_history.find(r=>r[0]===2001)[3],0.123,'existing NDVI preserved');
  assert.deepEqual(repaired.obs,sentinel.obs);assert.deepEqual(repaired.weather,sentinel.weather);
  assert.equal(JSON.stringify(repaired.weather_history.find(r=>r[0]===2002).slice(1,3)),JSON.stringify([-1.2,-30]),'weather values unchanged');
  await go('#/USA/USA%3A31?crop=maize&season=main&axis=year');
  assert(row()?.querySelectorAll('circle.pt:not(.open)').length>20,'Nebraska aggregate history');
  await go('#/USA/USA%3A31%3A41?crop=maize&season=main&axis=enso');
  assert(row()?.querySelectorAll('circle.pt').length>20,'Custer ENSO relationship retains historical NDVI');
  await go('#/RUS/RUS?crop=maize&season=Annual&axis=year');
  assert(!row(),'no invented NDVI for an unextracted national series');
  assert.equal(requests.filter(p=>p==='data/ndvi-history/2026-10-19/USA.json').length,1,'country supplement cached');
  console.log(JSON.stringify({status:'passed',custerSeasons:pts.length,checks:['county History','state History','ENSO relationship','provisional flags','no invented national values','frozen data preserved']},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
