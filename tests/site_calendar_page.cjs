const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SITE = path.resolve(__dirname,'../site');
const {parseHTML} = require(path.join(SITE,'../node_modules/linkedom'));
const page = require('../site/calendar-page.js'), bar = require('../site/calendar-bar.js');
require('../site/calendar.js').todayISO = () => '2026-10-11';
assert.equal(page.normalizedHash('#/USA?layer=planting&mask=crop&crop=rice'),'#/USA?layer=progress&mask=crop&crop=rice');
assert.equal(page.normalizedHash('#/USA?layer=outlook'),'#/USA?layer=outlook');
assert.deepEqual(page.route('#/record/USA/USA%3A6%3A7?crop=rice').key,'USA:6:7');
const {window:dom} = parseHTML('<main><div id="view"></div></main><p id="foot-line"></p>');
const document = dom.document, listeners = {}, maps = {}, requests = [], errors = [];
const publicMode = process.env.ATLAS_PUBLIC === '1', base = 'https://raw.githubusercontent.com/phuybers3/enso-yield-atlas/' + 'a'.repeat(40) + '/site/';
const location = {hostname:publicMode?'phuybers3.github.io':'127.0.0.1',pathname:'/site/index.html',search:'',hash:'#/USA/USA%3A6%3A7?crop=rice&season=main&harvest=2026&release=2026-10-08'};
const window = {document,location,MutationObserver:dom.MutationObserver,AtlasCalendar:require(path.join(SITE,'calendar.js')),AtlasCalendarBar:bar,
  addEventListener:(event,fn,capture) => { const list=listeners[event] ||= []; capture ? list.unshift(fn):list.push(fn); },scrollTo(){},
  console:{warn:(...x)=>errors.push(x),error:(...x)=>errors.push(x)},
  history:{replaceState:(s,t,url)=>{location.hash=url.slice(url.indexOf('#'));}}};
Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{get(){return this._value ?? this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? '';},set(v){this._value=v;},configurable:true});
class MapStub {
  constructor(o){maps[o.container]=this;this.sources={};this.layers={};this.canvas=document.createElement('canvas');for(const h of ['scrollZoom','boxZoom','dragRotate','dragPan','keyboard','doubleClickZoom','touchZoomRotate'])this[h]={disable(){}};}
  on(n,a,b){if(n==='load')setTimeout(b||a,0);} addSource(id,s){this.sources[id]={...s,setData(d){this.data=d;}};} addLayer(l){this.layers[l.id]=l;} getLayer(id){return this.layers[id];} getSource(id){return this.sources[id];}
  queryRenderedFeatures(){return [];} loaded(){return true;} addControl(){} fitBounds(b){this.fit=b;} getBounds(){return {toArray:()=>this.fit};} remove(){} getCanvas(){return this.canvas;}
}
class Marker {setLngLat(){return this;} addTo(){return this;}}
const maplibregl={Map:MapStub,Marker,NavigationControl:class{}};
const fetch=async url=>{requests.push(url);if(url==='hosting.json')return new Response(JSON.stringify({data_base:base}));if(publicMode){assert(url.startsWith(base),url);url=url.slice(base.length);}const file=path.join(SITE,url);
  try{return new Response(fs.readFileSync(file));}catch{return new Response('',{status:404});}
};
window.fetch=fetch;window.maplibregl=maplibregl;window.AtlasRegionalPage=require(path.join(SITE,'regional-page.js'));
const context=vm.createContext({window,document,location,history:window.history,fetch,console,Map,URLSearchParams,setTimeout,clearTimeout,maplibregl,AtlasCalendar:window.AtlasCalendar,AtlasCalendarBar:bar});
page.install(window);
vm.runInContext(fs.readFileSync(path.join(SITE,'app.js'),'utf8'),context);
const until=async(test)=>{for(let i=0;i<400;i++){if(test())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out: '+document.getElementById('view').textContent.slice(0,300));};
async function go(hash,ready){location.hash=hash;for(const fn of listeners.hashchange||[])fn();await until(ready);}
const text=()=>document.querySelector('.crop-calendar')?.textContent||'';
(async()=>{
  for(const fn of listeners.DOMContentLoaded||[])await fn();
  await until(()=>text().includes('Planting: 15 Apr 2026'));
  assert.equal(document.querySelector('h1').textContent,'Butte, California');
  assert(document.querySelector('.local-map > #cmap').nextElementSibling.id==='crop-calendar-slot');
  assert(text().includes('Grain filling: 6 Sep 2026'));
  assert.equal(document.querySelectorAll('#crop-calendar-slot').length,1);
  await go('#/ARG/ARG%3A8%3A251?crop=maize&season=main&harvest=2026&release=2026-10-08',()=>text().includes('Growing season: 23 Oct 2025'));
  assert.equal(document.querySelectorAll('.crop-calendar-year').length,1);
  assert(text().includes('23 Oct 2026 – 1 May 2027'),'Next published season also appears in the rolling window');
  assert.equal(document.querySelector('.crop-calendar-marker').style.left,'50%');
  assert(text().includes('23 Oct 2025 – 1 May 2026'));
  await go('#/USA/USA%3A6%3A7?crop=sorghum&season=main&harvest=2026&release=2026-10-08',()=>document.querySelector('.regional-subtitle')?.textContent.includes('Sorghum yield')&&text().includes('Stage dates unavailable'));
  assert.equal(document.querySelectorAll('.crop-calendar-band').length,1);
  await go('#/USA/USA%3A6?crop=rice&release=2026-10-08',()=>document.querySelector('h1')?.textContent === 'California'&&document.getElementById('crop-calendar-slot')?.hidden);
  const n=requests.length;await new Promise(r=>setTimeout(r,40));assert.equal(requests.length,n,'No repeated requests for a state with varied calendars');
  await go('#/USA?crop=rice&layer=planting&mask=crop&date=2026-10-11&release=2026-10-08',()=>!document.querySelector('.regional-page')&&document.querySelector('#layer-sel')?.dataset.cropCalendar);
  assert.match(location.hash,/layer=progress/);assert.match(location.hash,/mask=crop/);
  assert.deepEqual([...document.querySelectorAll('#layer-sel option')].map(o=>o.textContent),fs.existsSync(path.join(SITE,'data','2026-10-08','anomalies/index.json'))?['Outlook','Historical ENSO response','Harvest anomaly by year','Crop calendar']:['Outlook','Historical ENSO response','Crop calendar']);
  assert(document.getElementById('mask-chk').hasAttribute('checked'));
  await until(()=>Object.values(maps.cmap.layers).some(l=>l.id==='crop-mask'));
  await go('#/USA/USA%3A6%3A7?crop=maize&season=main&harvest=2026&release=2026-10-08',()=>document.querySelector('.regional-subtitle')?.textContent.includes('Maize yield')&&text().includes('Grain filling'));
  assert(text().includes('Growing season: 15 May 2026'),'Legacy release retains its own calendar');
  assert.deepEqual(errors,[]);
  console.log('PASS calendar integration'+(publicMode?' with hosted assets':'')+': real dates, cross-year crop, fallback, state guard, old links, two choices, crop mask, legacy release.');
})().catch(e=>{console.error(e);process.exitCode=1;});
