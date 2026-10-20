// Verify the interval used, geographic propagation, and rendering order of outlook hatching.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const root=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-10';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const {document}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:`#/?crop=maize&mask=crop&release=${release}`};
const window={addEventListener:(n,f)=>handlers[n]=f,scrollTo(){},AtlasRegionalPage:require('../site/regional-page.js')};
class MapStub {
  constructor(o){maps[o.container]=this;this.sources={};this.layers={};this.order=[];this.images={};this.events={};this.canvas=document.createElement('canvas');}
  on(n,layer,fn){if(n==='load')setTimeout(layer,0);else this.events[fn?`${n}:${layer}`:n]=fn||layer;}
  addSource(k,s){this.sources[k]={...s,setData(d){this.data=d;}};} getSource(k){return this.sources[k];}
  addLayer(l,before){this.layers[l.id]=l;const i=this.order.indexOf(before);if(i<0)this.order.push(l.id);else this.order.splice(i,0,l.id);}
  getLayer(k){return this.layers[k];} addImage(k,v){this.images[k]=v;} hasImage(k){return !!this.images[k];}
  fitBounds(b){this.fit=b;} jumpTo(c){this.camera=c;} getCanvas(){return this.canvas;} remove(){this.removed=true;}
  getCenter(){return {toArray:()=>this.camera?.center||[(this.fit[0][0]+this.fit[1][0])/2,(this.fit[0][1]+this.fit[1][1])/2]};}
  getZoom(){return this.camera?.zoom??5;} getBounds(){return {toArray:()=>this.fit||[[-110,30],[-80,50]]};}
  queryRenderedFeatures(){return [];} loaded(){return true;} resize(){}
}
const maplibregl={Map:MapStub};window.maplibregl=maplibregl;
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.hatchAudit={D,zeroConsistent,unitCell,loadNeighbours,version:()=>renderVersion};})();');
vm.runInNewContext(source,{window,document,location,maplibregl,URL,URLSearchParams,Response,console,setTimeout,AtlasCalendar:require('../site/calendar.js'),fetch:async p=>{try{return new Response(fs.readFileSync(path.join(root,p)));}catch{return new Response('',{status:404});}}});
const ready=async id=>{for(let i=0;i<300&&!maps[id]?.sources.u;i++)await new Promise(r=>setTimeout(r,5));assert(maps[id]?.sources.u);return maps[id];};
const go=async (hash,id='cmap')=>{location.hash=hash+`&release=${release}`;await handlers.hashchange();return ready(id);};
const rows=(d,table,arr)=>(arr||[]).map(a=>Object.fromEntries(d.columns[table].map((k,i)=>[k,a[i]])));
const expected=r=>!!r&&Number.isFinite(r.pct)&&Number.isFinite(r.lo)&&Number.isFinite(r.hi)&&r.lo<=r.hi&&r.lo<=0&&r.hi>=0;
const uData=iso=>read(`data/${release}/units/${iso}.json`);
const assertOrder=(m,a,b)=>assert(m.order.indexOf(a)>=0&&m.order.indexOf(a)<m.order.indexOf(b),`${a} below ${b}`);
(async()=>{
  await handlers.DOMContentLoaded();let m=await ready('wmap');const A=window.hatchAudit;
  for(const [r,want] of [[{pct:2,lo:-1,hi:5},true],[{pct:-2,lo:-5,hi:0},true],[{pct:2,lo:0,hi:5},true],[{pct:0,lo:0,hi:0},true],[{pct:2,lo:.01,hi:5},false],[{pct:-2,lo:-5,hi:-.01},false],[{pct:1,lo:null,hi:4},false],[{pct:1,lo:-2,hi:null},false],[{pct:null,lo:-2,hi:4},false],[{pct:0,lo:2,hi:-2},false],[{pct:0,lo:NaN,hi:2},false]])assert.equal(A.zeroConsistent(r),want,JSON.stringify(r));
  const W=read(`data/${release}/world.json`),panels=rows(W,'panels',W.panels).filter(p=>p.crop_family==='maize'),largest=new Map();
  for(const p of panels)if(!largest.has(p.iso3)||p.baseline_production_mt>largest.get(p.iso3).baseline_production_mt)largest.set(p.iso3,p);
  for(const f of m.sources.u.data.features)assert.equal(f.properties.zeroConsistent,expected(largest.get(f.id)),`world ${f.id}`);
  assertOrder(m,'u-fill','u-zero-hatch');assertOrder(m,'u-zero-hatch','crop-mask');assertOrder(m,'crop-mask','u-hit');assertOrder(m,'u-zero-hatch','sel-line');
  assert(m.images['enso-zero-80'].data.some((v,i)=>i%4===3&&v===0),'transparent pattern preserves fills');
  assert(m.images['enso-zero-80'].data.some((v,i)=>i%4===3&&v>0),'pattern contains visible stripes');
  assert.equal(document.querySelectorAll('.uncertainty-key').length,1);
  const wu=read(`data/${release}/world_units.json`),values=wu.units.maize;let crossed=0,clear=0;
  for(const f of m.sources.wu.data.features){const v=Object.fromEntries(wu.columns.map((c,i)=>[c,values[f.id][i]]));assert.equal(f.properties.zeroConsistent,expected(v),f.id);if(expected(v))crossed++;else clear++;}
  assert(crossed>100&&clear>100,'world units distinguish both categories');
  assertOrder(m,'u-zero-hatch','wu-fill');assertOrder(m,'wu-fill','wu-zero-hatch');assertOrder(m,'wu-zero-hatch','crop-mask');assert.equal(m.layers['wu-fill'].paint['fill-opacity'],1,'local units occlude national hatching');
  for(const crop of ['rice','wheat','soybean','sorghum','cassava']){
    m=await go(`#/?crop=${crop}&mask=crop`,'wmap');
    assert(m.sources.wu.data.features.length>0,`${crop}: reporting units drawn`);
    for(const f of m.sources.wu.data.features){const row=wu.units[crop][f.id],v=Object.fromEntries(wu.columns.map((c,i)=>[c,row[i]]));assert.equal(f.properties.zeroConsistent,expected(v),`${crop} ${f.id}`);}
  }
  m=await go('#/USA?crop=maize&season=main&mask=crop');
  const usa=uData('USA');let checked=0;
  for(const f of m.sources.u.data.features){const unit=usa.units[f.id],s=unit?.series.filter(s=>s.crop_code==='maize'&&s.season==='main').sort((a,b)=>a.tier-b.tier||(b.n||0)-(a.n||0))[0];if(!s||unit.level==='national')continue;const p=rows(usa,'predictions',s.predictions).find(p=>p.method==='index_outlook'&&p.scenario==='medium'&&p.harvest_year===2026);assert.equal(f.properties.zeroConsistent,expected(p),f.id);checked++;}
  assert(checked>2000);assert(!m.sources.u.data.features.find(f=>f.id==='USA').properties.zeroConsistent,'outline country is not hatched');
  m=await go('#/USA/USA%3A19?crop=maize&season=main&mask=crop');assert(m.sources.u.data.features.some(f=>f.properties.zeroConsistent));
  m=await go('#/USA/USA%3A19%3A79?crop=maize&season=main&mask=crop');
  const selected=m.sources.u.data.features.find(f=>f.id==='USA:19:79');assert(selected.properties.selected);assertOrder(m,'u-zero-hatch','sel-line');
  assert.equal(m.layers['sel-line'].paint['line-color'],'#432580');
  await A.loadNeighbours('cmap',[[-104,44],[-78,55]],'USA','maize','outlook',A.version(),null);
  const neighbours=m.__data.features.filter(f=>f.properties.country==='CAN'&&values[f.id]);assert(neighbours.length>0,'neighbour rows appended');
  for(const f of neighbours){const r=Object.fromEntries(wu.columns.map((c,i)=>[c,values[f.id][i]]));assert.equal(f.properties.zeroConsistent,expected(r),`neighbour ${f.id}`);}
  for(const layer of ['historical','progress']){m=await go(`#/USA/USA%3A19%3A79?crop=maize&season=main&layer=${layer}`);assert(!m.sources.u.data.features.some(f=>f.properties.zeroConsistent));assert.equal(document.querySelectorAll('.uncertainty-key').length,0);}
  m=await go('#/CHN?crop=maize&mask=crop');
  const national=m.sources.u.data.features.find(f=>f.id==='CHN');assert.equal(national.properties.zeroConsistent,expected(largest.get('CHN')));
  for(const f of m.sources.u.data.features.filter(f=>f.properties.outlineOnly))assert(!f.properties.zeroConsistent,'national estimate does not become a local classification');
  const missing=await go('#/CHN/CHN%3A41%3A410725?crop=maize&season=main');assert(!missing.sources.u.data.features.find(f=>f.id==='CHN:41:410725').properties.zeroConsistent,'no outlook is not a zero response');
  A.D.contract='2026-10-08';assert.equal(A.zeroConsistent({pct:1,lo:-2,hi:4}),false,'legacy 95% range not called 80%');
  console.log(`PASS uncertainty: all six crops; ${crossed} hatched / ${clear} other world maize units, ${checked} US units; zero endpoints, missing ranges, national/local/neighbor maps, masks, selection, non-outlook layers and legacy intervals.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
