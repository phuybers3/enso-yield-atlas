const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const root=path.join(__dirname,'../watch'),J=f=>JSON.parse(fs.readFileSync(path.join(root,f))),sha=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
const ctx=J('context/2026-10-07.json'),panels=J('data/2026-10-06/panels.json'),m=J('season-data/2026-10-06/manifest.json');
for(const [f,h]of Object.entries(ctx.source_sha256))assert.equal(sha('data/2026-10-06/'+f),h);
for(const [f,h]of Object.entries(m.files))assert.equal(sha('season-data/2026-10-06/'+f),h);
let seasons=0,records=0,flagged=0;
for(const f of Object.keys(m.files)){
 const x=J('season-data/2026-10-06/'+f);
 for(const [key,s]of Object.entries(x.seasons)){
  seasons++;const p=panels.find(p=>p.iso3===x.iso3&&p.crop_code+'|'+p.season===key);assert(p);
  assert.equal(Object.keys(s.units).length,p.series);
  for(const u of Object.values(s.units)){
   records++;if(u.calendar_issue){flagged++;assert.notEqual(Number(u.end.slice(0,4)),u.year);}else if(u.end)assert.equal(Number(u.end.slice(0,4)),u.year);
   if(u.weather_start){assert.equal(u.weather_start,u.start);assert.equal(u.weather_end,u.end);assert.equal(u.weather_harvest_year,u.year);assert(u.start<='2026-09-30');}
  }
 }
}
assert.equal(seasons,643);assert.equal(flagged,3158);assert.equal(m.checks.previous_map_records_reproduced,41150);
for(const row of ctx.rows){assert(Number.isFinite(row.values.low)&&Number.isFinite(row.values.medium)&&Number.isFinite(row.values.high));assert(row.production_mt>0);}
for(const key of ctx.bulletin_selection)assert(ctx.rows.find(r=>r.iso3+'|'+r.crop===key));
const aus=ctx.rows.find(r=>r.iso3==='AUS'&&r.crop==='wheat');assert.equal(aus.values.medium.toFixed(1),'-17.3');
const arm=ctx.rows.find(r=>r.iso3==='ARM'&&r.crop==='maize');assert.notEqual(arm.values.low,0,'small crops must not be rounded to zero tonnes before calculating percentages');
console.log(`PASS review extension: ${seasons} seasons, ${records} records, ${flagged} calendar flags, all source hashes and finite unrounded aggregates`);
