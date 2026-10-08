// Exercise navigation and map source selection against the real frozen release.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {parseHTML}=require('linkedom');
const ROOT=path.join(__dirname,'../watch');
const {window:dom}=parseHTML(fs.readFileSync(path.join(ROOT,'index.html'),'utf8'));
const document=dom.document,handlers={},maps={},copied=[];
const window={addEventListener:(name,fn)=>{handlers[name]=fn;},scrollTo(){}};
Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{get(){return this._value??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(v){this._value=v;},configurable:true});
class MapStub{
 constructor(o){maps[o.container]=this;this.sources={};this.events={};this.canvas=document.createElement('canvas');}
 on(n,layer,callback){this.events[n]=callback||layer;if(n==='load')setTimeout(layer,0);}
 addSource(id,s){this.sources[id]=s;}addLayer(){}addControl(){}fitBounds(){}remove(){this.removed=true;}getCanvas(){return this.canvas;}
}
const maplibregl={Map:MapStub,NavigationControl:class{}};window.maplibregl=maplibregl;
const location={search:'',hash:'#/country/IND?crop=rice&season=rice_milled%7CKharif'};
const navigator={clipboard:{writeText:async s=>copied.push(s)}};
vm.runInContext(fs.readFileSync(path.join(ROOT,'app.js'),'utf8'),vm.createContext({window,document,location,navigator,maplibregl,URL,URLSearchParams,Response,DecompressionStream,console,fetch:async p=>new Response(fs.readFileSync(path.join(ROOT,p)))}));
const ready=async id=>{for(let i=0;i<200&&(!maps[id]?.sources.u||maps[id].removed);i++)await new Promise(r=>setTimeout(r,5));assert(maps[id]?.sources.u&&!maps[id].removed,`map ${id} loaded`);return maps[id].sources.u.data.features;};
const go=async hash=>{location.hash=hash;await handlers.hashchange();assert(!document.getElementById('view').textContent.includes('Something did not load'));};
const J=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f)));
(async()=>{
 await handlers.DOMContentLoaded();
 const panels=J('data/2026-10-06/panels.json');
 for(const iso of ['IND','IDN','USA']){
  const p=panels.filter(p=>p.iso3===iso&&p.crop_family==='rice').sort((a,b)=>b.production_mt-a.production_mt)[0],key=p.crop_code+'|'+p.season;
  await go(`#/country/${iso}?crop=rice&season=${encodeURIComponent(key)}&view=patterns`);
  const features=await ready('map1'),units=J(`season-data/2026-10-06/${iso}.json`).seasons[key].units;
  assert.equal(features[0].properties.level,'national');
  assert.equal(features.length,Object.keys(units).length+1,'only selected-season units plus national context');
  for(const f of features.slice(1)){assert(units[f.properties.id]);assert.equal(f.properties.u.s,units[f.properties.id].s);assert.equal(f.properties.u.e,units[f.properties.id].e);}
  assert(!document.getElementById('map2'),'only selected view is rendered');
  const sample=features.find(f=>f.properties.u.e!=null);
  maps.map1.events.mousemove({point:{x:10,y:10},features:[{...sample,properties:{...sample.properties,u:JSON.stringify(sample.properties.u)}}]});
  const tip=document.querySelector('#map1 .tooltip').textContent;
  assert(tip.includes(sample.properties.u.n));assert(tip.includes('Relationship:'));assert(tip.includes('Conditional yield'));
 }
 await go('#/country/IND?crop=rice&season=rice_milled%7CKharif&view=weather');await ready('map2');
 assert.equal(document.querySelector('[data-view="weather"]').getAttribute('aria-pressed'),'true');
 const select=document.getElementById('map2-var');select.value='t';select.onchange();await handlers.hashchange();await ready('map2');
 assert(location.hash.includes('weather=t')&&location.hash.includes('Kharif'));
 assert(document.getElementById('map2-legend').textContent.includes('−1.5 °C'));
 assert(document.getElementById('view').textContent.includes('not whether conditions benefit crops'));
 await document.getElementById('copy-link').onclick();assert(copied[0].includes('?issue=2026-10-06#/country/IND'));assert(copied[0].includes('Kharif'));
 document.getElementById('season-sel').value='rice_milled|Rabi';document.getElementById('season-sel').onchange({target:{value:'rice_milled|Rabi'}});await handlers.hashchange();await ready('map2');
 assert(location.hash.includes('Rabi')&&location.hash.includes('view=weather'));
 assert(document.getElementById('view').textContent.includes('growing season is ahead'));
 await go('#/country/IND?crop=rice&season=rice_milled%7CKharif&view=yields');
 assert(document.getElementById('view').textContent.includes('-2.5% ± 0.5'));
 assert(document.getElementById('view').textContent.includes('skill improvement is small'));
 await go('#/country/ARG?crop=maize&view=weather');
 assert(document.getElementById('view').textContent.includes('Weather display withheld'));assert(!document.getElementById('map2'));
 await go('#/country/IND?crop=rice&season=all');assert(!document.querySelector('#map1 canvas'));assert(document.getElementById('view').textContent.includes('Select one growing season'));
 await go('#/world?crop=cassava&view=patterns');await ready('wmap');
 assert(document.querySelector('.scenario-table').textContent.includes('Higher ENSO'));
 assert(document.querySelector('.scenario-table').textContent.includes('Cassava'));
 document.querySelector('[data-view="weather"]').onclick();await handlers.hashchange();
 assert(location.hash.includes('crop=cassava'));assert(document.getElementById('view').textContent.includes('Observed weather by growing season'));
 await go('#/context');assert(document.getElementById('view').textContent.includes('-27.7%'));assert(document.getElementById('view').textContent.includes('November 2027–March 2028'));
 await go('#/table?crop=rice&min=0');assert(document.querySelector('table a').getAttribute('href').includes('season='));
 await go('#/methods');await go('#/downloads');
 console.log('PASS Watch view/season routing, share links, map layering and selection, weather units, uncertainty, calendar gates, FEWS NET and download pages');
})().catch(e=>{console.error(e);process.exitCode=1;});
