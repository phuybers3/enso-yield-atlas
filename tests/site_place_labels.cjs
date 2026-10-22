// Verify the display against the saved release without refitting any model.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.ATLAS_SITE_ROOT||path.resolve(__dirname,'../site'),stage=root;
const requireAtlas=require('node:module').createRequire(path.join(root,'../package.json'));
const {parseHTML}=requireAtlas('linkedom');
const {document}=parseHTML(fs.readFileSync(path.join(stage,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:'#/SLE/SLE%3ASL1960A20201?crop=maize&season=main'};
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
const source=fs.readFileSync(path.join(stage,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={unitLabel,featureLabel};})();');
const requests=[];
vm.runInNewContext(source,{window,document,location,maplibregl,AtlasCalendar:require(path.join(root,'calendar.js')),URL,URLSearchParams,Response,console,setTimeout,fetch:async p=>{
  requests.push(p); const file=fs.existsSync(path.join(stage,p))?path.join(stage,p):path.join(root,p);
  try{return new Response(fs.readFileSync(file));}catch{return new Response('',{status:404});}
}});
const wait=async condition=>{for(let i=0;i<400&&!condition();i++)await new Promise(r=>setTimeout(r,5));assert(condition(),'UI ready');};
const ready=async(id='cmap')=>{await wait(()=>maps[id]?.sources.u&&!maps[id].removed);return maps[id];};
const go=async hash=>{location.hash=hash;await handlers.hashchange();assert(!document.body.textContent.includes('Something did not load'));return ready(hash.startsWith('#/?')?'wmap':'cmap');};
const tip=(map,key,layer='u-hit')=>{const features=map.sources[layer==='u-hit'?'u':'wu'].data.features;const f=features.find(x=>x.id===key);assert(f,`feature ${key}`);map.events[`mousemove:${layer}`]({features:[{...f,id:0}],point:{x:30,y:30}});return map.__tip.querySelector('b').textContent;};
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/catalog.json')));
(async()=>{
  await handlers.DOMContentLoaded();let map=await ready();
  assert.equal(document.querySelector('h1').textContent,'Bombali, Northern, Sierra Leone');
  assert.equal(tip(map,'SLE:SL1960A20201'),'Bombali, Northern, Sierra Leone');
  assert.equal(tip(map,'SLE:SL1960A20203'),'Koinadugu, Northern, Sierra Leone');
  assert.equal(document.querySelector('#cmap').getAttribute('aria-label'),'Regional map; Bombali, Northern, Sierra Leone selected');
  const headings=[document.querySelector('h1').textContent];
  map=await go('#/SLE?crop=maize&season=main');
  assert.equal(tip(map,'SLE:SL1960A20203'),'Koinadugu, Northern, Sierra Leone');
  assert([...document.querySelectorAll('.placelist a')].some(a=>a.textContent==='Koinadugu, Northern, Sierra Leone'));
  // Panning loads foreign polygons; their parent comes from the names-only index.
  await wait(()=>map.sources.u.data.features.some(f=>f.properties.country==='GIN'&&f.properties.level!=='national'));
  const foreign=map.sources.u.data.features.find(f=>f.properties.country==='GIN'&&window.__atlas.D.placeHierarchy.parents[f.id]);
  assert(foreign,'neighbor with parent metadata');
  const gu=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/units/GIN.json'))).units[foreign.id];
  assert.equal(tip(map,foreign.id),[gu.name,gu.region_name,'Guinea'].join(', '));
  headings.push(tip(map,foreign.id));
  for(const layer of ['progress','anomaly']) {
    map=await go(`#/SLE/SLE%3ASL1960A20201?crop=maize&season=main&layer=${layer}&year=2010`);
    assert.equal(tip(map,'SLE:SL1960A20203'),'Koinadugu, Northern, Sierra Leone');
  }
  map=await go('#/USA/USA%3A19%3A79?crop=maize&season=main');
  assert.equal(document.querySelector('h1').textContent,'Hamilton, Iowa, United States');
  headings.push(document.querySelector('h1').textContent);
  map=await go('#/USA/USA%3A19?crop=maize&season=main');
  assert.equal(document.querySelector('h1').textContent,'Iowa, United States');
  headings.push(document.querySelector('h1').textContent);
  map=await go('#/SLE/SLE?crop=maize&season=Annual');
  assert.equal(document.querySelector('h1').textContent,'Sierra Leone');
  assert.equal(document.querySelector('.crumbs').textContent,'World›Sierra Leone');
  map=await go('#/?crop=maize&layer=anomaly&year=2010');
  await wait(()=>map.sources.wu);
  assert.equal(tip(map,'USA:19:79','wu-fill'),'Hamilton, Iowa, United States');
  assert.equal(requests.filter(p=>p==='data/static/place-hierarchy/2026-10-19.json').length,1,'hierarchy fetched once');
  let unitsChecked=0;
  for(const file of fs.readdirSync(path.join(root,'data/2026-10-19/units')).filter(f=>f.endsWith('.json'))) {
    const data=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/units',file)));
    for(const [key,u] of Object.entries(data.units)) {
      const label=window.test.unitLabel(u,data.iso3,key),country=catalog.countries[data.iso3].name;
      assert(label===country||label.endsWith(', '+country),key+' country missing');
      assert(!/undefined|null/.test(label),key+' invalid name');
      if(u.level==='national') assert.equal(label,country);
      unitsChecked++;
    }
  }
  // Escaping is applied where a label becomes markup.
  assert.equal(window.test.unitLabel({name:'A & B',level:'ADM2',region_name:'X < Y',region_key:'SLE:x'},'SLE','SLE:test'),'A & B, X < Y, Sierra Leone');
  console.log(JSON.stringify({status:'passed',unitsChecked,headings,coverage:'district and parent pages; country, local, neighboring-country and world tooltips; outlook, calendar and anomaly layers; place directory; national deduplication; accessible map name'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
