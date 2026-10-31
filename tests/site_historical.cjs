// Historical maps must retain older local records without turning them into forecasts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom'),root=path.resolve(__dirname,'../site');
const release=process.argv[2]||'2026-10-19',read=p=>JSON.parse(fs.readFileSync(path.join(root,p)));
const registry=read('data/historical-responses/index.json');
const {document}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:`#/?crop=maize&layer=historical&release=${release}`};
const window={addEventListener:(n,f)=>handlers[n]=f,scrollTo(){},AtlasRegionalPage:require('../site/regional-page.js')};
class MapStub {
 constructor(o){maps[o.container]=this;this.sources={};this.layers={};this.canvas=document.createElement('canvas');}
 on(n,a,b){if(n==='load')setTimeout(b||a,0);} loaded(){return true;}
 addSource(k,s){this.sources[k]={...s,setData(d){this.data=d;}};}getSource(k){return this.sources[k];}
 addLayer(l){this.layers[l.id]=l;}getLayer(k){return this.layers[k];}
 fitBounds(b){this.fit=b;}getBounds(){return {toArray:()=>this.fit};}getCanvas(){return this.canvas;}remove(){}
}
const maplibregl={Map:MapStub};window.maplibregl=maplibregl;
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.audit={diverging,YIELD_PALETTE,link};})();');
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require('../site/calendar.js'),URL,URLSearchParams,Response,console,setTimeout,
 fetch:async p=>{try{return new Response(fs.readFileSync(path.join(root,p)));}catch{return new Response('',{status:404});}}});
const ready=async()=>{for(let i=0;i<600&&!maps.wmap?.sources.wu;i++)await new Promise(r=>setTimeout(r,5));assert(maps.wmap?.sources.wu);return maps.wmap;};
(async()=>{
 let fits=0,points=0;const byFamily={};
 for(const [name,file] of Object.entries(registry.releases[release])) {
  const extra=read('data/historical-responses/'+file),iso=name.slice(0,3),units=read(`data/${release}/units/${iso}.json`);
  const catalog=Object.fromEntries(Object.values(units.units).flatMap(u=>u.series.map(s=>[s.id,s])));
  assert.equal(extra.release,release);assert.equal(extra.model.pooling_fraction,.25);
  for(const [id,s] of Object.entries(extra.series)) {
   assert(catalog[id]);assert.equal(catalog[id].responses.length,0,'supplements only fill absent release regressions');
   assert(!s.predictions,'historical fitting cannot create an outlook');assert.equal(s.validation.length,0,'no invented skill');
   if(!catalog[id].display_points)assert.equal(s.relationship_history.length,0,'source restrictions apply to points');
   for(const r of s.responses) {
    assert(r.year_last<=2025);assert(r.n_years>=10);
    if(r.variable==='ly'&&r.pct_eb!=null){assert(Math.abs(r.pct_eb-100*Math.expm1(r.slope_eb))<1e-9);fits++;}
   }
   points+=s.relationship_history.length;
  }
 }
 await handlers.DOMContentLoaded();
 for(const fam of ['maize','rice','wheat','soybean','sorghum','cassava']) {
  if(fam!=='maize'){location.hash=`#/?crop=${fam}&layer=historical&release=${release}`;await handlers.hashchange();}
  const m=await ready(),data=read('data/historical-responses/'+registry.world[release][fam]);
  const features=m.sources.wu.data.features;assert(features.length>0);byFamily[fam]=features.length;
  for(const f of features) {
   const r=data.units[f.id].responses.rel;
   assert.equal(f.properties.color,r?window.audit.diverging(r.pct_eb,10,window.audit.YIELD_PALETTE):'#cfcec8','map and ±10% legend share a scale');
   assert(!/undefined|NaN/.test(f.properties.words),f.id);
  }
  if(fam==='maize')assert(features.filter(f=>f.properties.country==='CHN').length>1700,'China local maize fits appear globally');
  if(fam==='wheat')assert(features.filter(f=>f.properties.country==='AUS').length>=5,'Australian state wheat fits appear globally');
 }
 location.hash=`#/?crop=maize&layer=outlook&release=${release}`;await handlers.hashchange();const m=await ready();
 const china=m.sources.wu.data.features.filter(f=>f.properties.country==='CHN');
 assert(china.length>1700&&china.every(f=>f.properties.outlineOnly),'current map exposes China records as outlines over the national forecast');
 assert(china.every(f=>!f.properties.zeroConsistent),'no local significance flag without a local forecast');
 const select=document.getElementById('layer-sel');Object.defineProperty(select,'value',{value:'historical',configurable:true});select.onchange();
 assert(location.hash.includes('layer=historical'),'world selector preserves historical layer');await handlers.hashchange();await ready();
 assert(document.querySelector('h1').textContent.includes('historical ENSO relationships'));
 assert(window.audit.link(null,null,{crop:'maize',layer:'historical',season:'main'}).includes('layer=historical'),'world breadcrumb retains historical view');
 console.log('PASS historical coverage:',JSON.stringify({fits,points,world_units:byFamily}));
})().catch(e=>{console.error(e);process.exitCode=1;});
