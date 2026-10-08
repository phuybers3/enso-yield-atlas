// Validate the new model against unit coefficients and the frozen weather/calendar issue.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto'),vm=require('vm');
const {parseHTML}=require('linkedom');
const root=path.join(__dirname,'../watch'),base='regional/2026-10-06-v1/',J=f=>JSON.parse(fs.readFileSync(path.join(root,f)));
const m=J(base+'model.json'),manifest=J(base+'manifest.json'),oldPanels=J('data/2026-10-06/panels.json');
for(const [f,h]of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,base,f))).digest('hex'),h,f);
const near=(a,b,tol=1e-6)=>assert(Math.abs(a-b)<=tol,`${a} != ${b}`);
let units=0,local=0;const byPanel=new Map(),byCrop=new Map();
for(const c of m.countries){
 const pack=J(base+'countries/'+c.iso3+'.json'),old=J('season-data/2026-10-06/'+c.iso3+'.json');
 for(const [key,s]of Object.entries(pack.seasons)){
  const oldSeason=old.seasons[key];assert.deepEqual(s.years,oldSeason.years);assert.equal(s.calendar_issues,oldSeason.calendar_issues);
  assert.deepEqual(Object.keys(s.units),Object.keys(oldSeason.units));
  const p=oldPanels.find(p=>p.iso3===c.iso3&&p.crop_code+'|'+p.season===key),tot={w:0,low:0,medium:0,high:0};
  for(const [k,u]of Object.entries(s.units)){
   units++;for(const field of ['s','n','r','t','rr','tr','year','start','end','f','calendar_issue','weather_start','weather_end','weather_harvest_year'])assert.deepEqual(u[field],oldSeason.units[k][field],`${c.iso3}/${k}/${field}`);
   if(u.response_level==='local'){local++;assert(u.fit_n>=20);assert(u.fit_first<=u.fit_last);assert.equal(u.uncertainty,'classical OLS; independent, constant-variance errors');}
   near(u.e,100*Math.expm1(u.beta*u.exposure_medium));near(u.lo,100*Math.expm1(u.beta*u.exposure_low));near(u.hi,100*Math.expm1(u.beta*u.exposure_high));
   near(u.sensitivity,100*Math.expm1(u.beta));assert(u.ci_lo<=u.e&&u.e<=u.ci_hi);
   assert.equal(u.uncertain,u.beta_lo<=0&&u.beta_hi>=0);
   tot.w+=u.production_mt;tot.low+=u.lo*u.production_mt;tot.medium+=u.e*u.production_mt;tot.high+=u.hi*u.production_mt;
  }
  byPanel.set(c.iso3+'|'+key,tot);const ck=c.iso3+'|'+p.crop_family,ct=byCrop.get(ck)||{w:0,low:0,medium:0,high:0};for(const k in ct)ct[k]+=tot[k];byCrop.set(ck,ct);
 }
}
assert.equal(units,42942);assert.equal(local,m.audit.local_records);
for(const p of m.panels){const t=byPanel.get(p.iso3+'|'+p.crop_code+'|'+p.season);for(const s of ['low','medium','high']){near(p.expected['pct_'+s],t[s]/t.w);near(p.expected['mt_'+s],t[s]/100,1e-5);}assert(p.expected.shares.uncertain>=0&&p.expected.shares.uncertain<=1+1e-12);}
for(const r of m.rows){const t=byCrop.get(r.iso3+'|'+r.crop);near(r.production_mt,t.w,1e-5);for(const s of ['low','medium','high'])near(r.values[s],t[s]/t.w);}
for(const c of m.countries){const rows=m.rows.filter(r=>r.iso3===c.iso3),w=rows.reduce((s,r)=>s+r.production_mt,0);near(c.expected.pct_medium,rows.reduce((s,r)=>s+r.values.medium*r.production_mt,0)/w);}
assert(m.audit.usa_maize.distinct_coefficients>2000,'U.S. maize retains independently fitted local coefficients');
assert(m.audit.usa_maize.response_range[0]<0&&m.audit.usa_maize.response_range[1]>0);

// Run the actual default interface, including clicked-region uncertainty and share state.
const {window:dom}=parseHTML(fs.readFileSync(path.join(root,'index.html'),'utf8')),document=dom.document,handlers={},maps={},copied=[];
Object.defineProperty(dom.HTMLSelectElement.prototype,'value',{get(){return this._value??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value??'';},set(v){this._value=v;},configurable:true});
class MapStub{constructor(o){maps[o.container]=this;this.sources={};this.events={};}on(n,layer,cb){this.events[n]=cb||layer;if(n==='load')setTimeout(layer,0);}addSource(id,s){this.sources[id]=s;}addLayer(){}addControl(){}fitBounds(b){this.fit=b;}remove(){this.removed=true;}getCanvas(){return {style:{}};}}
const maplibregl={Map:MapStub,NavigationControl:class{}},window={maplibregl,addEventListener:(n,fn)=>handlers[n]=fn,scrollTo(){}};
const location={search:'',hash:'#/country/USA?crop=maize&view=yield'},navigator={clipboard:{writeText:async t=>copied.push(t)}};
vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),vm.createContext({window,document,location,navigator,maplibregl,URL,URLSearchParams,Response,DecompressionStream,console,fetch:async p=>new Response(fs.readFileSync(path.join(root,p)))}));
const ready=async id=>{for(let i=0;i<200&&(!maps[id]?.sources.u||maps[id].removed);i++)await new Promise(r=>setTimeout(r,5));assert(maps[id]?.sources.u&&!maps[id].removed);return maps[id].sources.u.data.features;};
const go=async h=>{location.hash=h;await handlers.hashchange();assert(!document.getElementById('view').textContent.includes('Something did not load'));};
(async()=>{
 await handlers.DOMContentLoaded();let features=await ready('map1');
 const usa=m.panels.find(p=>p.iso3==='USA'&&p.crop_code==='maize');assert(document.querySelector('.yield-comparison').textContent.includes('+'+usa.expected.pct_medium.toFixed(1)+'%'));
 assert(!document.getElementById('view').textContent.includes('one pooled ENSO sensitivity'));
 assert.equal(features.length,2734);assert(maps.map1.fit[0][0]>-130);
 const sample=features.find(f=>f.properties.u.response_level==='local');maps.map1.events.click({features:[{...sample,properties:{...sample.properties,u:JSON.stringify(sample.properties.u)}}]});
 const detail=document.getElementById('unit-detail');assert(!detail.hidden);assert(detail.textContent.includes('95% fitted-response interval'));assert(detail.textContent.includes('classical OLS'));assert(detail.textContent.includes(sample.properties.u.n));
 const sel=document.getElementById('map1-var');sel.value='sensitivity';sel.onchange();await handlers.hashchange();features=await ready('map1');
 assert(location.hash.includes('measure=sensitivity')&&location.hash.includes('crop=maize'));assert(document.getElementById('map1-legend').textContent.includes('per +1 °C'));
 await document.getElementById('copy-link').onclick();assert(copied[0].includes('response=regional-v1')&&copied[0].includes('issue=2026-10-06')&&copied[0].includes('measure=sensitivity'));
 assert(document.querySelector('.yield-evidence').textContent.includes('Predictive skill of the local ENSO responses has not been established'));assert(!document.querySelector('.yield-evidence').textContent.includes('ENSO skill'));
 await go('#/world?crop=maize&view=yield');await ready('wmap');assert(document.querySelector('.scenario-table').textContent.includes('local fits'));
 await go('#/downloads');assert(document.querySelector(`a[href="${base}scenario-summary.csv"]`));assert(document.getElementById('view').textContent.includes('Earlier bulletin'));
 await go('#/methods');assert(document.getElementById('view').textContent.includes('independent, constant-variance residuals'));
 console.log(`PASS regional model: ${units} records, ${local} local fits, unit/panel/country aggregation, fixed weather and calendars, uncertainty, sensitivity layer, share model and archive labels`);
})().catch(e=>{console.error(e);process.exitCode=1;});
