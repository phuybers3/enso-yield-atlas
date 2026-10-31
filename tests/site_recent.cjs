// Monthly observations stay calendar-independent and separate from yield forecasts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const recent=require('../site/recent-anomalies.js');
const arg=process.argv[2]||'2026-10-31';
const folder=/^\d{4}-\d{2}-\d{2}$/.test(arg)?path.join(__dirname,'../site/data/recent-anomalies',arg):arg;
if(!fs.existsSync(folder)){console.log('Monthly supplement absent from this earlier release; no observations synthesized');process.exit(0);}
const packaged=fs.existsSync(path.join(folder,'BRA/index.json'));
const payload=JSON.parse(fs.readFileSync(path.join(folder,packaged?'BRA/index.json':'BRA.json')));
if(packaged){
 const shard=payload.record_files['BRA:18:3415|soybean'];
 payload.records=JSON.parse(fs.readFileSync(path.join(folder,shard))).records;
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
 assert(Object.values(manifest.files).every(f=>f.bytes<1_000_000),'monthly page downloads stay below 1MB each');
}
const base={payload,key:'BRA:18:3415|soybean',calendar:{plant_date:'2026-11-16',harvest_date:'2027-04-21'},today:'2026-10-31',enso:[
 {year:2026,month:9,index:'rel',observed:true,value:1.1},
 {year:2026,month:10,index:'rel',observed:false,scenario:'medium',value:1.4}]};
const p=recent.prepare(base);
assert.equal(p.specs.length,4);assert.match(p.note,/Before the typical planting date/);
assert(p.specs.slice(1).every(s=>s.chart.points.length===12));
for(const width of [330,600]){
 for(const [i,s] of p.specs.entries()){
  const svg=recent.chart({...s.chart,width,height:135,xAxis:i===3});
  assert(!/NaN|Infinity|undefined/.test(svg));assert(svg.includes('data-crop-window'));
  if(i){assert(svg.includes('data-partial="true"'));assert(!svg.includes('data-scenario'));
   assert(svg.includes('data-month="2026-10"'));
  }else assert(svg.includes('data-observed="true"'));
 }
}
const gap=recent.prepare({...base,payload:null});
assert.match(gap.specs[1].chart.note,/not included/);
assert(!recent.chart({...gap.specs[1].chart}).includes('data-value='),'missing observations must not become zero bars');
const other=recent.prepare({...base,key:'BRA:unmatched|soybean'});
assert.match(other.specs[1].chart.note,/extraction unavailable/);
console.log('PASS Recent anomalies: pre-plant values, four aligned panels, crop window, partial month, narrow layout, explicit gaps, no invented weather forecasts');
