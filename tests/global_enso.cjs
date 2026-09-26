const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.join(__dirname,'..'),M=require('../global/model.js');
const climate=JSON.parse(fs.readFileSync(path.join(root,'global/data/enso/2026-09-26/nino34.json')));
for(const [file,hash] of [[climate.frozen_source,climate.source_sha256],[climate.calendar_source,climate.calendar_source_sha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash);
const payload=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,climate.calendar_source))));
const panels=new Map(payload.panels.map(p=>[p.panel,p])),cat=JSON.parse(fs.readFileSync(path.join(root,'global/data/2026-09-26/catalog.json')));
const products=Object.fromEntries(Object.entries(cat.products).map(([k,v])=>[v,k]));
let checked=0;
for(const [key,rows] of Object.entries(payload.observations)){
  const p=panels.get(key.split('|')[0]),crop=products[p.crop];
  if(!crop)continue;
  const s={country:p.country,crop,season:p.season,observations:rows.map(r=>[r[0],Math.exp(r[2])])};
  if(!climate.windows[[s.country,s.crop,s.season].join('|')])continue;
  const values=new Map(M.ensoSeries(s,climate).values);
  for(const [year,expected] of rows){assert(Math.abs(values.get(year)-expected)<1e-10);checked++;}
}
assert(checked>40000,'Compare seasonal alignment with the existing fitted observations');
const s={country:'IN',crop:'wheat',season:'Rabi',observations:[[1998,1],[1999,3],[2000,2]]};
const e=M.ensoSeries(s,climate);
assert.equal(e.window.label,'Nov (previous year)–Apr');
const expected=['1997-11','1997-12','1998-01','1998-02','1998-03','1998-04'].map(m=>climate.monthly[m]).reduce((a,b)=>a+b,0)/6;
assert(Math.abs(e.values[0][1]-expected)<1e-12);
const missing=structuredClone(climate);missing.monthly['1997-12']=null;
assert.equal(M.ensoSeries(s,missing).values[0][1],null,'A missing month must not become zero or a partial-season mean');
assert.equal(M.ensoSeries({...s,season:'Unknown'},climate).values.length,0);
assert.equal(M.ensoSeries(s,null).values.length,0);
const whole=M.ensoSeries({...s,season:'Whole Year',observations:[[2000,1]]},climate);
const wholeExpected=Array.from({length:12},(_,i)=>climate.monthly['2001-'+String(i+1).padStart(2,'0')]).reduce((a,b)=>a+b,0)/12;
assert(Math.abs(whole.values[0][1]-wholeExpected)<1e-12,'Whole Year follows the recorded sowing year');
const sd=a=>{const mean=a.reduce((a,b)=>a+b,0)/a.length;return Math.sqrt(a.reduce((sum,v)=>sum+(v-mean)**2,0)/a.length)};
const yields=[[2000,3],[2001,5],[2002,4],[2004,2]],indices=[[2000,-1],[2001,2],[2002,.5],[2003,3],[2004,-2]];
const scale=M.comparisonScale(yields,indices),lookup=new Map(indices);
assert(scale.matched);
assert(Math.abs(sd(yields.map(r=>r[1]))-sd(yields.map(r=>scale.project(lookup.get(r[0])))))<1e-12,'Equal vertical standard deviations on paired years');
for(const [,v] of indices){assert(scale.project(v)>scale.lo&&scale.project(v)<scale.hi,'No index clipping');assert(Math.abs(scale.indexAt(scale.project(v))-v)<1e-12,'Right ticks preserve actual °C');}
for(const [,v] of yields)assert(v>scale.lo&&v<scale.hi,'No yield clipping');
for(const [ys,es] of [[[[2000,0],[2001,0]],[[2000,-1],[2001,1]]],[[[2000,2]],[[2000,.5]]],[yields,indices.map(r=>[r[0],0])],[[],[]]]){
  const a=M.comparisonScale(ys,es);assert(!a.matched);assert(Number.isFinite(a.lo)&&Number.isFinite(a.hi)&&a.hi>a.lo&&Number.isFinite(a.factor)&&a.factor>0);
}
console.log(`PASS: ${checked} frozen fitted exposures, crop-year alignment, missing months, equal-variability axes, true °C units, no clipping, and constant/short records.`);
