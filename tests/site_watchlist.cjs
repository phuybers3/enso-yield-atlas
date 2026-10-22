// Verify the display against the saved release without refitting any model.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.env.ATLAS_SITE_ROOT||path.resolve(__dirname,'../site'),stage=root;
const requireAtlas=require('node:module').createRequire(path.join(root,'../package.json'));
const {parseHTML}=requireAtlas('linkedom');
const {document}=parseHTML(fs.readFileSync(path.join(stage,'index.html'),'utf8'));
const handlers={},maps={},location={hostname:'localhost',hash:'#/?crop=maize'};
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
const source=fs.readFileSync(path.join(stage,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,'window.test={unitLabel,featureLabel,outlookColor,watchlist};})();');
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
  await handlers.DOMContentLoaded();let map=await ready('wmap');const A=window.test;
  const W=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/world.json')));
  const panels=W.panels.map(a=>Object.fromEntries(W.columns.panels.map((k,i)=>[k,a[i]])));
  const noPattern=m=>{assert(!Object.values(m.layers).some(l=>l.paint?.['fill-pattern']));assert(!Object.keys(m.layers).some(k=>k.includes('hatch')));};
  noPattern(map);
  const cards=[...document.querySelectorAll('.watchlist-item')];assert.equal(cards.length,6);
  assert(cards.find(x=>x.getAttribute('data-watch-key')==='USA|maize|main').textContent.includes('Historical ENSO test: improvement unresolved'));
  assert(cards.find(x=>x.getAttribute('data-watch-key')==='RUS|maize|Annual').textContent.includes('Post-peak ENSO evolution assumed'));
  assert(cards.find(x=>x.getAttribute('data-watch-key')==='USA|maize|main').textContent.includes('harvest 2026, 2027'));
  for(const card of cards){
    const p=panels.find(p=>p.key===card.getAttribute('data-watch-key'));assert(p);assert.equal(p.crop_family,'maize');
    assert.equal(Number(card.getAttribute('data-watch-pct')),p.pct);assert.equal(Number(card.getAttribute('data-watch-mt')),p.dprod_mt);
    assert(p.baseline_production_mt>=.1&&(Math.abs(p.pct)>=10||Math.abs(p.dprod_mt)>=1));
    const url=new URL(card.getAttribute('href'),'http://atlas.local');const q=new URLSearchParams(url.hash.split('?')[1]);
    assert.equal(q.get('crop'),p.crop_code);assert.equal(q.get('season'),p.season);
    assert.equal(card.classList.contains('loss'),p.pct<0);assert(card.textContent.includes('80% effect range'));
  }
  for(const col of document.querySelectorAll('.watchlist-column')){
    const effects=[...col.querySelectorAll('.watchlist-item')].map(x=>Math.abs(Number(x.getAttribute('data-watch-mt'))));
    assert(effects.every((v,i)=>!i||v<=effects[i-1]));
  }
  for(const [v,c] of [[null,'#cfcec8'],[NaN,'#cfcec8'],[Infinity,'#cfcec8'],[0,'rgb(247,247,247)'],[-30,'rgb(127,59,8)'],[30,'rgb(45,0,75)'],[-50,'rgb(127,59,8)'],[50,'rgb(45,0,75)']])assert.equal(A.outlookColor(v),c);
  // The legend and map must encode the same numeric value, including between stops.
  const checkLegend=()=>{
    const legend=document.querySelector('.outlook-legend'),stops=[...legend.querySelectorAll('stop')];
    assert.equal(stops.length,11);assert.deepEqual([...legend.querySelectorAll('svg text')].map(t=>t.textContent),['≤ −30%','−15%','0%','+15%','≥ +30%']);
    assert(legend.textContent.includes('Orange: losses · purple: gains'));assert(legend.textContent.includes('Colors saturate at ±30%'));
    assert(legend.textContent.includes('Current estimate unavailable'));assert(legend.querySelector('svg').getAttribute('aria-label').includes('% change'));
    const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
    for(let value=-30;value<=30;value+=.5){
      const fraction=(value+30)/60,upper=stops.findIndex(s=>parseFloat(s.getAttribute('offset'))/100>=fraction);
      const a=stops[Math.max(0,upper-1)],b=stops[upper],lo=parseFloat(a.getAttribute('offset'))/100,hi=parseFloat(b.getAttribute('offset'))/100;
      const t=hi>lo?(fraction-lo)/(hi-lo):0,A0=rgb(a.getAttribute('stop-color')),B0=rgb(b.getAttribute('stop-color'));
      const expected=A0.map((c,i)=>Math.round(c+(B0[i]-c)*t)),actual=A.outlookColor(value).match(/\d+/g).map(Number);
      assert(actual.every((c,i)=>Math.abs(c-expected[i])<=1),`map and colorbar agree at ${value}%`);
    }
    assert.notEqual(A.outlookColor(-5),A.outlookColor(-9));assert.notEqual(A.outlookColor(5),A.outlookColor(9));
  };checkLegend();

  const wu=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/world_units.json')));let count=0;
  for(const crop of ['maize','rice','wheat','soybean','sorghum','cassava']){
    map=await go('#/?crop='+crop);await wait(()=>map.sources.wu);noPattern(map);checkLegend();
    for(const f of map.sources.wu.data.features){const value=wu.units[crop][f.id][wu.columns.indexOf('pct')];assert.equal(f.properties.color,A.outlookColor(value));count++;}
    for(const card of document.querySelectorAll('.watchlist-item'))assert.equal(panels.find(p=>p.key===card.getAttribute('data-watch-key')).crop_family,crop);
  }
  map=await go('#/USA?crop=maize&season=main');noPattern(map);checkLegend();
  const usa=JSON.parse(fs.readFileSync(path.join(root,'data/2026-10-19/units/USA.json')));
  assert(document.querySelectorAll('.watchlist-item').length>0);
  for(const card of document.querySelectorAll('.watchlist-item')){
    const key=card.getAttribute('data-watch-key'),u=usa.units[key];assert(u&&u.level!=='national');assert(card.querySelector('.watchlist-place').textContent.endsWith(', United States'));
    const url=new URL(card.getAttribute('href'),'http://atlas.local'),q=new URLSearchParams(url.hash.split('?')[1]);
    const s=u.series.find(x=>x.id===q.get('series'));assert(s&&s.crop_code==='maize'&&s.season==='main');
    const pred=s.predictions.map(a=>Object.fromEntries(usa.columns.predictions.map((k,i)=>[k,a[i]]))).find(x=>x.method==='index_outlook'&&x.scenario==='medium'&&x.harvest_year===Number(q.get('harvest')));
    const w=Object.fromEntries(usa.columns.weight.map((k,i)=>[k,s.weight[i]]));assert.equal(Number(card.getAttribute('data-watch-pct')),pred.pct);assert.equal(Number(card.getAttribute('data-watch-mt')),w.baseline_production_t*pred.pct/100/1e6);
  }
  const first=document.querySelector('.watchlist-item').getAttribute('href');await go(first);assert(document.querySelector('h1').textContent.endsWith(', United States'));
  map=await go('#/USA/USA%3A46%3A63?crop=maize&season=main');noPattern(map);checkLegend();assert(document.querySelector('h1').textContent.includes('South Dakota, United States'));
  for(const layer of ['anomaly','progress','historical']){await go('#/USA?crop=maize&season=main&layer='+layer);assert.equal(document.querySelectorAll('.watchlist').length,0);}
  console.log(JSON.stringify({status:'passed',worldUnitColorsChecked:count,crops:6,checks:'no hatching; continuous colorbar matches map; saturation endpoints; exact saved watchlist values; ranking and route selection; country/source-series links; missing values; other layers'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
