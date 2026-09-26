// Capture the actual map source and style calls, then compare with regional output.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {parseHTML}=require('linkedom');
const ROOT=path.join(__dirname,'../global'),M=require(path.join(ROOT,'merged-model.js'));
const {window}=parseHTML(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')),document=window.document,$=id=>document.getElementById(id);
window.scrollTo=()=>{};window.innerWidth=1200;window.innerHeight=800;
window.HTMLElement.prototype.getBoundingClientRect=()=>({top:120,bottom:500});
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this._value??this.querySelector('option')?.value??''},set(v){this._value=String(v)},configurable:true});
Object.defineProperty(window.HTMLSelectElement.prototype,'selectedOptions',{get(){return [...this.querySelectorAll('option')].filter(o=>o.value===this.value)},configurable:true});
const query='?crop=maize&metric=enso&model=quadratic&exposure=event&peak=3&harvest=0';
const location={hash:'#/'+query,href:'https://example.org/global/'};
let map,popup;
class MapStub {
 constructor(){map=this;this.layers={};this.sources={};this.events={};this.dragRotate={disable(){}};this.touchZoomRotate={disableRotation(){}};this.canvas=document.createElement('canvas');$('map').append(this.canvas);}
 on(name,fn){this.events[name]=fn;if(name==='load')setTimeout(fn,0);return this;}
 addControl(){} addLayer(layer){this.layers[layer.id]=layer;}
 addSource(id,source){this.sources[id]={data:source.data,setData(data){this.data=data;}};}
 getSource(id){return this.sources[id];}
 setPaintProperty(id,key,value){this.layers[id].paint[key]=value;}
 setFilter(id,value){this.layers[id].filter=value;}
 getCenter(){return {toArray:()=>[0,0]};}getZoom(){return 1;}getBearing(){return 0;}getPitch(){return 0;}
 getCanvas(){return this.canvas;}fitBounds(){}jumpTo(){}
 queryRenderedFeatures(){return this.hovered?[this.hovered]:[];}
}
class Popup {constructor(){popup=this;}remove(){return this;}setLngLat(){return this;}setHTML(html){this.html=html;return this;}addTo(){return this;}}
const context=vm.createContext({document,window,location,history:{replaceState(a,b,hash){location.hash=hash;},pushState(a,b,hash){location.hash=hash;}},navigator:{clipboard:{writeText:async()=>{}}},maplibregl:{Map:MapStub,Popup,NavigationControl:class{},AttributionControl:class{}},AtlasModel:M,AtlasReliability:require(path.join(ROOT,'merged-reliability.js')),AtlasResponse:require(path.join(ROOT,'merged-response.js')),URL,URLSearchParams,Blob,Response,DecompressionStream,setTimeout,console,fetch:async p=>new Response(fs.readFileSync(path.join(ROOT,p)),{status:200})});
const run=s=>vm.runInContext(s,context);
const source=()=>map.sources.units.data.features;
function equalValues(){
 const selected=new Map(run('selected').map(r=>[r.id,r]));
 for(const f of source()){
  const r=selected.get(f.id);assert(r,f.id);assert.equal(f.properties.id,f.id);
  assert.equal(f.properties.valid,r.value!=null);
  if(f.properties.valid){assert.equal(f.properties.value,r.value);assert.equal(f.properties.value,r.response.value);}
  assert.equal(f.properties.extrapolated,!!r.enough&&!!r.response?.extrapolated);
 }
}
run(fs.readFileSync(path.join(ROOT,'merged-app.js'),'utf8'));
(async()=>{
 for(let i=0;i<600&&!run('lastPage');i++)await new Promise(r=>setTimeout(r,25));
 assert(!$('status').classList.contains('error'),$('status').textContent);assert(run('lastPage'));
 equalValues();assert(source().filter(f=>f.properties.valid).length>9000);
 const france=source().filter(f=>f.properties.country==='FRA'&&f.properties.valid);
 assert.equal(france.length,22);assert(france.every(f=>f.properties.value>0&&f.properties.extrapolated));
 // Brown support outlines previously covered these positive fills at world zoom.
 const extra=map.layers['extrapolated-units'];assert(extra.minzoom>=4);
 const rgb=extra.paint['line-color'].match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16));
 assert(Math.max(...rgb)-Math.min(...rgb)<=8,'Support outlines must be neutral');
 const fill=map.layers.units.paint['fill-color'];
 assert.deepEqual(Array.from(fill[3].slice(3).filter((_,i)=>i%2===0)),[-50,-25,0,25,50]);
 const colors=Array.from(fill[3].slice(3).filter((_,i)=>i%2));
 assert.deepEqual(colors,['#8c510a','#d8b365','#f5f5ed','#5ab4ac','#01665e']);
 colors.forEach(c=>assert($('legend-ramp').style.background.includes(c)));
 const route=async hash=>{location.hash=hash;await run('render()');assert(!$('status').classList.contains('error'),$('status').textContent);equalValues();};
 await route('#/country/FRA'+query);
 const sample=source().find(f=>f.properties.valid),original=france.find(f=>f.id===sample.id).properties.value;
 assert.equal(sample.properties.value,original);
 map.hovered=sample;map.events.mousemove({point:{},lngLat:[0,0]});
 const number=(original>0?'+':'')+original.toLocaleString('en',{minimumFractionDigits:1,maximumFractionDigits:1})+'%';
 assert(popup.html.includes(number));
 await route('#/region/FRA/'+encodeURIComponent(sample.id)+query+'&view=world');
 assert.equal(document.querySelector('.response-value').textContent,number);
 await route('#/country/FRA'+query.replace('harvest=0','harvest=1'));
 assert(source().some(f=>f.properties.valid&&f.properties.value!==france.find(x=>x.id===f.id)?.properties.value),'Scenario changes update mapped values');
 await route('#/country/FRA'+query+'&support=observed');assert(!source().some(f=>f.properties.valid));
 await route('#/country/FRA'+query+'&evidence=fdr');assert(source().every(f=>!f.properties.valid||run('selected').find(r=>r.id===f.id).fieldSignificant));
 console.log('PASS current map/tooltip/panel values, 22 positive French maize responses, global/country/region consistency, scenario/filter updates, shared legend palette and neutral zoom-dependent support outlines.');
})().catch(e=>{console.error(e);process.exitCode=1;});
