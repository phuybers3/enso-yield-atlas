// Exercise navigation with browser-like history and a camera-aware MapLibre stub.
// The live-browser check separately covers WebGL rendering and pointer interaction.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {parseHTML}=require('linkedom');
const ROOT=path.join(__dirname,'../global'), M=require(path.join(ROOT,'model.js'));
async function app(initial='',small=false) {
  const {window}=parseHTML(fs.readFileSync(path.join(ROOT,'archive.html'),'utf8')),document=window.document;
  const $=id=>document.getElementById(id);
  let focused;
  window.HTMLElement.prototype.focus=function(){focused=this};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value??(this.querySelector('option[selected]')||this.querySelector('option'))?.value??''},set(v){this._value=String(v)},configurable:true});
  window.scrollY=0;window.scrollTo=({top})=>{window.scrollY=top};
  window.innerWidth=small?390:1200;window.innerHeight=800;
  $('map').getBoundingClientRect=()=>({top:(small?850:240)-window.scrollY,bottom:(small?1190:710)-window.scrollY});
  document.querySelector('.legend').getBoundingClientRect=()=>({top:(small?770:170)-window.scrollY});
  $('region-overlay').getBoundingClientRect=()=>({top:small?304:98});
  const location={hash:initial,href:'https://example.org/global/'+initial};
  const entries=[{hash:initial,state:null}];let index=0;
  const history={
    get state(){return entries[index].state},get length(){return entries.length},
    replaceState(state,_,hash){entries[index]={state,hash};location.hash=hash},
    pushState(state,_,hash){entries.splice(index+1);entries.push({state,hash});index++;location.hash=hash},
    back(){if(index>0){index--;this.restore()}},
    forward(){if(index<entries.length-1){index++;this.restore()}},
    restore(){location.hash=entries[index].hash;window.dispatchEvent(new window.Event('popstate'));window.dispatchEvent(new window.Event('hashchange'))}
  };
  let map;
  class MapStub {
    constructor(){map=this;this.camera={center:[32,18],zoom:.8,bearing:0,pitch:0};this.sources={};this.events={};this.fits=0;this.writes=0;this.filters={};this.dragRotate={disable(){}};this.touchZoomRotate={disableRotation(){}};this.canvas=document.createElement('canvas');$('map').append(this.canvas)}
    on(event,fn){this.events[event]=fn;if(event==='load')setTimeout(fn,0);return this}
    addControl(){} addLayer(){} setPaintProperty(){}
    addSource(id){this.sources[id]={setData:data=>{this.writes++;this.data=data}}}
    getSource(id){return this.sources[id]}
    setFilter(id,value){this.filters[id]=value}
    getCenter(){return {toArray:()=>this.camera.center.slice()}}
    getZoom(){return this.camera.zoom} getBearing(){return this.camera.bearing} getPitch(){return this.camera.pitch}
    getCanvas(){return this.canvas}
    fitBounds(b){this.fits++;this.camera={center:b[0].map((n,i)=>(n+b[1][i])/2),zoom:4,bearing:0,pitch:0}}
    jumpTo(c){this.camera=JSON.parse(JSON.stringify(c))}
    queryRenderedFeatures(){return this.clicked?[this.clicked]:[]}
  }
  class Popup {remove(){return this}setLngLat(){return this}setHTML(){return this}addTo(){return this}}
  const context=vm.createContext({document,window,location,history,navigator:{clipboard:{writeText:async()=>{}}},maplibregl:{Map:MapStub,Popup,NavigationControl:class{},AttributionControl:class{}},AtlasModel:M,AtlasResponse:require(path.join(ROOT,'response.js')),URL,URLSearchParams,Blob,setTimeout,console,fetch:async p=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))})});
  const run=s=>vm.runInContext(s,context);
  // Wait for a finished render, including the asynchronous regional series.
  async function ready(){for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,1));if($('status').classList.contains('error'))throw Error($('status').textContent);if(run('lastPage')&&!$('status').textContent.startsWith('Loading')&&!$('detail').textContent.includes('Loading regional')){await new Promise(r=>setImmediate(r));return}}throw Error('Navigation did not finish')}
  function click(a){const e=new window.Event('click',{bubbles:true,cancelable:true});e.button=0;a.dispatchEvent(e)}
  run(fs.readFileSync(path.join(ROOT,'app.js'),'utf8'));await ready();
  return {$,window,document,location,history,map,run,ready,click,get focused(){return focused}};
}
(async()=>{
  const a=await app(),{$,window,map,history,run}=a;
  const worldHash=a.location.hash;
  const worldCamera={center:[91,21],zoom:3.25,bearing:0,pitch:0};map.jumpTo(worldCamera);window.scrollY=420;$('search').value='Ind';$('search').oninput();$('locations').scrollTop=37;
  const writes=map.writes,fits=map.fits;
  // A real map click opens a reporting unit directly over the world map.
  map.clicked={properties:{id:'IN.ADM2.00008',country:'IN'}};map.events.click({point:{}});await a.ready();
  assert(!$('region-overlay').hidden);assert.equal($('title').textContent,'Global crop yields');assert.equal(run('state.view'),'world');assert.deepEqual(map.camera,worldCamera);assert.equal(map.fits,fits);assert.equal(map.writes,writes);assert.equal(window.scrollY,420);assert.equal($('search').value,'Ind');assert.equal($('locations').scrollTop,37);assert.equal(a.focused,$('close-region'));assert.equal(history.length,2);assert.equal(run('detailSeries.id'),'IN.ADM2.00008');
  // Region switching must not add history entries or change the map camera.
  $('region-overlay').scrollTop=300;
  $('next-region').onclick();await a.ready();const next=run('state.unit');assert.notEqual(next,'IN.ADM2.00008');assert.equal(history.length,2);assert.equal($('region-overlay').scrollTop,0);assert.deepEqual(map.camera,worldCamera);
  history.back();await a.ready();assert($('region-overlay').hidden);assert.equal(a.location.hash,worldHash);assert.equal(window.scrollY,420);assert.deepEqual(map.camera,worldCamera);assert.equal($('search').value,'Ind');assert.equal(a.focused,map.canvas);
  history.forward();await a.ready();assert(!$('region-overlay').hidden);assert.equal(run('state.unit'),next);assert.deepEqual(map.camera,worldCamera);
  $('close-region').onclick();await a.ready();assert($('region-overlay').hidden);assert.equal(a.location.hash,worldHash);
  // Follow an actual country link, then open and switch regions from its list.
  const india=[...a.document.querySelectorAll('#locations a')].find(el=>el.textContent.startsWith('India'));
  assert(india);a.click(india);await a.ready();assert.equal($('title').textContent,'India');assert.equal($('search').value,'');
  const countryCamera={center:[80.7,17.8],zoom:6.5,bearing:0,pitch:0};map.jumpTo(countryCamera);window.scrollY=320;$('search').value='Gunt';$('search').oninput();$('locations').scrollTop=25;
  a.click(a.document.querySelector('#locations a'));await a.ready();assert.equal(run('state.view'),'country');assert.equal($('title').textContent,'India');assert.deepEqual(map.camera,countryCamera);assert.equal($('search').value,'Gunt');assert.equal(window.scrollY,320);
  const escape=new window.Event('keydown',{bubbles:true,cancelable:true});escape.key='Escape';a.document.dispatchEvent(escape);await a.ready();assert($('region-overlay').hidden);assert.equal(a.focused.dataset.unit,'IN.ADM2.00008');assert.equal($('locations').scrollTop,25);
  history.back();await a.ready();assert.equal($('title').textContent,'Global crop yields');assert.deepEqual(map.camera,worldCamera);assert.equal(window.scrollY,420);assert.equal($('search').value,'Ind');
  history.forward();await a.ready();assert.equal($('title').textContent,'India');assert.deepEqual(map.camera,countryCamera);assert.equal(window.scrollY,320);assert.equal($('search').value,'Gunt');
  // Shared links have no originating history entry: close stays in the atlas.
  const direct=await app('#/region/JP/JP.ADM1.00001?crop=wheat');assert(!direct.$('region-overlay').hidden);assert.equal(direct.$('title').textContent,'Japan');assert.equal(direct.history.length,1);
  await direct.$('close-region').onclick();await direct.ready();assert(direct.$('region-overlay').hidden);assert.equal(direct.run('state.kind'),'country');assert.equal(direct.run('state.country'),'JP');assert.equal(direct.history.length,1);
  const missing=await app('#/region/IN/IN.ADM2.00008?crop=wheat&season=Summer&view=world');assert(!missing.$('region-overlay').hidden);assert(missing.$('detail').textContent.includes('No Wheat records'));assert(!missing.$('region-select').disabled);await missing.$('close-region').onclick();await missing.ready();assert.equal(missing.run('state.kind'),'world');
  const mobile=await app('#/region/JP/JP.ADM1.00001?crop=wheat',true);assert.equal(mobile.window.scrollY,770,'Direct links should bring the map behind the bottom sheet');await mobile.$('close-region').onclick();await mobile.ready();assert.equal(mobile.window.scrollY,770);
  mobile.window.scrollY=1400;mobile.click(mobile.document.querySelector('#locations a'));await mobile.ready();assert.equal(mobile.window.scrollY,770,'Opening from a list below the map should reveal the map');mobile.$('close-region').onclick();await mobile.ready();assert.equal(mobile.window.scrollY,1400,'Closing should return to the original list position');
  const response=await app('#/region/IN/IN.ADM2.00267?crop=wheat&metric=enso&model=quadratic&amplitude=3&view=world');
  const rr=response.run('selected.find(r=>r.id===state.unit)');assert(rr.response.value<0);assert(response.map.data.features.some(f=>f.properties.valid&&f.properties.value<0),'Decreases must retain their negative mapped value');
  const camera=response.map.camera;response.$('model').value='linear';response.$('model').onchange();await response.ready();assert.equal(response.run('state.model'),'linear');assert.equal(response.history.length,1);assert.deepEqual(response.map.camera,camera);
  response.$('event-preset').onclick();await response.ready();assert.equal(response.run('state.exposure'),'event');assert.equal(response.run('state.peak'),3);assert.equal(response.document.querySelectorAll('.scenario-point').length,1);
  response.$('next-region').onclick();await response.ready();assert.equal(response.history.length,1);assert.deepEqual(response.map.camera,camera);assert.equal(response.run('state.exposure'),'event');
  await response.$('close-region').onclick();await response.ready();assert(response.$('region-overlay').hidden);assert.equal(response.run('state.metric'),'enso');assert.equal(response.run('state.exposure'),'event');
  console.log('PASS: map and list navigation, camera/scroll/search preservation, single-entry regional switching, Back/Forward, Escape and focus return, direct links, and missing-data panels.');
})().catch(e=>{console.error(e);process.exitCode=1});
