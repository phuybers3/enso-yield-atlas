/* Check every released series against record routing and map values, plus complete rendered edge cases. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const ROOT=path.resolve(__dirname,'../site'),release=process.argv[2]||'2026-10-10';
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const {document}=parseHTML('<main id="view"></main><footer id="foot-line"></footer>');
const window={addEventListener(){},scrollTo(){},AtlasRegionalPage:{...require('../site/regional-page.js'),mount(v,o){window.specs=o.specs;}}};
const location={hash:'',hostname:'localhost'};
const apiNames=['D','ensureRelease','panelsOf','panelFor','seriesFor','unitCell','unitCollection','S','harvestScale','renderDetail','recordTables','loadNationalWeather','loadRecord'];
const originalSource=fs.readFileSync(path.join(ROOT,'app.js'),'utf8');
const source=fs.readFileSync(path.join(ROOT,'app.js'),'utf8').replace(/\}\)\(\);\s*$/,`window.audit={${apiNames.join(',')}};})();`);
vm.runInNewContext(source,{window,document,location,URLSearchParams,URL,Response,console,setTimeout,AtlasCalendar:require('../site/calendar.js'),fetch:async p=>{try{return new Response(fs.readFileSync(path.join(ROOT,p)));}catch{return new Response('',{status:404});}}});
const A=window.audit,base=`data/${release}/`,out=process.argv[3]?path.resolve(process.argv[3]):path.resolve(__dirname,`../../planning/display_audit_${release}`);
const counts={countries:0,series:0,units:0,formerly_unreachable_series:0,record_only_combinations:0,mapped_units:0,unmapped_units:0,series_routes_checked:0,map_cells_checked:0,records:0,observations:0,raw_yield_fallback:0,partial_anomalies:0,weather_history:0,quality_flag_records:0};
const countryRows=[],samples=[],stateSamples=[];
(async()=>{
  A.D.releases=read('data/releases.json'); await A.ensureRelease(release);
  assert.equal(A.D.contract,'2026-10-09','This exhaustive audit reads the modern contract. Legacy UI tests cover the older release.');
  counts.record_only_combinations=A.D.availablePanels.filter(p=>p.record_only).length;
  for(const iso of Object.keys(A.D.catalog.countries)){
    const file=`${base}units/${iso}.json`;if(!fs.existsSync(path.join(ROOT,file)))continue;
    const u=read(file),idx=read(`${base}records/${iso}/index.json`),shards=new Map();
    const geo=A.D.catalog.countries[iso].geometry?read(`${base}geometry/${iso}.json`):{features:[]};
    const geometry=new Set(geo.features.map(f=>f.id));
    const row={iso,country:A.D.catalog.countries[iso].name,series:0,historical_only_series:0,units:Object.keys(u.units).length,unmapped:0};
    counts.countries++;counts.units+=row.units;
    for(const [key,unit] of Object.entries(u.units)){
      counts[geometry.has(key)?'mapped_units':'unmapped_units']++;if(!geometry.has(key))row.unmapped++;
      for(const s of unit.series){
        counts.series++;row.series++;
        const r={iso,key,q:new URLSearchParams({crop:s.crop_code,season:s.season,series:String(s.id),release})};
        const p=A.panelFor(r,iso,unit);
        assert(p && p.crop_code===s.crop_code && p.season===s.season,`${iso}/${key}/${s.id}: exact series route`);
        counts.series_routes_checked++;
        if(p.record_only){counts.formerly_unreachable_series++;row.historical_only_series++;}
        const predictions=A.S.predictions(u,s),prediction=predictions.find(p=>p.method==='index_outlook'&&p.scenario==='medium');
        const hy=prediction?.harvest_year||p.harvest_year;
        const f={id:key,properties:{...unit,country:iso}};
        const cell=A.unitCell(u,p,'outlook','2026-10-11',hy,s.id)(f);
        assert(cell.hasRecord,`${iso}/${key}: known record must not become no-record`);
        if(prediction?.pct!=null)assert(cell.words.includes(prediction.pct.toFixed(1).replace('-','−')),`${s.id}: mapped value from selected series`);
        const other=A.unitCell(u,p,'outlook','2026-10-11',1900,s.id)(f);
        assert.equal(other.color,'#cfcec8','A forecast from another harvest year is not reused');
        const cal=A.S.calendar(u,s).find(c=>c.harvest_year===hy),calendar=A.unitCell(u,p,'progress','2026-10-11',hy,s.id)(f);
        if(cal?.harvest_date&&!cal.cycle_unresolved)assert(Number.isFinite(calendar.harvestDay),`${s.id}: calendar is reachable`);
        counts.map_cells_checked+=3;
        const entry=idx.units[key];assert(entry,`${key}: record shard listed`);
        if(!shards.has(entry[0]))shards.set(entry[0],read(`${base}records/${iso}/${entry[0]}`));
        const rec=shards.get(entry[0]).series[s.id];assert(rec,`${s.id}: series record in indexed shard`);
        if(!s.display_points)assert(!rec.obs?.length && !rec.trend_anomaly?.length,'Withheld observations stay withheld');
        counts.records++;
        counts.observations+=(rec.obs||[]).filter(a=>Number.isFinite(a[1])).length;
        if(rec.obs?.length&&!rec.trend_anomaly?.length){counts.raw_yield_fallback++;if(samples.filter(x=>x.kind==='raw').length<2)samples.push({iso,key,s,kind:'raw'});}
        if((rec.obs||[]).length>(rec.trend_anomaly||[]).length)counts.partial_anomalies++;
        if(rec.weather_history?.length)counts.weather_history++;
        if(rec.qc?.length)counts.quality_flag_records++;
        // Each crop, national/local status, and a missing forecast gets a full page check below.
        const kind=`${s.crop_family}/${unit.level==='national'?'national':'local'}/${prediction?'outlook':'history'}`;
        if(!samples.some(x=>x.kind===kind))samples.push({iso,key,s,kind});
      }
    }
    for(const [key,entry] of Object.entries(idx.states||{})) {
      const shard=read(`${base}records/${iso}/${entry[0]}`);
      for(const [sid,rec] of Object.entries(shard.series||{})) {
        counts.state_records=(counts.state_records||0)+1;
        const [crop_code,season]=sid.split('|');
        const p=A.panelFor({q:new URLSearchParams({crop:crop_code,season})},iso);
        assert(p && p.crop_code===crop_code&&p.season===season,`${iso}/${key}: state record route`);
        if(rec.obs?.length&&!rec.trend_anomaly?.length)counts.state_raw_yield_fallback=(counts.state_raw_yield_fallback||0)+1;
        const earlier=rec.weather_history?.length&&rec.obs?.length&&rec.weather_history[0][0]<rec.obs[0][0];
        if(earlier)counts.weather_before_state_yields=(counts.weather_before_state_yields||0)+1;
        if(stateSamples.length<2&&earlier)stateSamples.push({iso,key,crop_code,season});
      }
    }
    countryRows.push(row);
    // All geometries are checked for the active crop/season. National-only fills must survive county outlines.
    for(const fam of A.D.catalog.families){
      const p=A.panelFor({q:new URLSearchParams({crop:fam})},iso);if(!p)continue;
      const fc=A.unitCollection(geo,u,A.unitCell(u,p,'outlook','2026-10-11',p.harvest_year));
      const local=Object.values(u.units).some(unit=>unit.level!=='national'&&unit.series.some(s=>s.crop_code===p.crop_code&&s.season===p.season));
      const national=fc.features.find(f=>f.properties.level==='national'&&u.units[f.id]?.series.some(s=>s.crop_code===p.crop_code&&s.season===p.season));
      if(!local&&national)assert(!national.properties.outlineOnly&&national.properties.reporting,`${iso}/${fam}: national fill retained`);
    }
  }
  const fullChecks=[];
  for(const sample of samples){
    const {iso,key,s}=sample;
    for(const axis of ['enso','year']){
      const r={iso,key,q:new URLSearchParams({crop:s.crop_code,season:s.season,series:String(s.id),release,axis})};
      location.hash=`#/${iso}/${encodeURIComponent(key)}?${r.q}`;
      await A.renderDetail(document.getElementById('view'),r,0);
      const text=document.getElementById('view').textContent;
      assert(!text.includes('Something did not load'),`${iso}/${key}: page loads`);
      const u=read(`${base}units/${iso}.json`);let rec=await A.loadRecord(iso,s.crop_family,key,s,u);
      if(u.units[key].level==='national')rec=await A.loadNationalWeather(iso,s,rec);
      const expo=new Set((rec.enso||[]).filter(a=>Number.isFinite(a[2])).map(a=>a[0]));
      const byLabel=new Map(window.specs.map(x=>[x.label,x]));
      for(const [label,col] of [['Temperature',1],['Rainfall',2]]){
        const fitted=axis==='enso'?(rec.relationship_history||[]).filter(a=>a[0]===(label==='Temperature'?'tavg_mean':'precip')&&a[1]==='rel'&&Number.isFinite(a[3])&&Number.isFinite(a[4])):[];
        const expected=fitted.length?fitted:(rec.weather_history||[]).filter(a=>Number.isFinite(a[col])&&(axis==='year'||expo.has(a[0])));
        assert.equal(byLabel.get(label)?.chart.points.length||0,expected.length,`${iso}/${key}/${axis}: every eligible ${label} point`);
      }
      for(const spec of window.specs)assert(spec.chart.points.every(p=>p.x>=spec.chart.x0&&p.x<=spec.chart.x1),`${iso}/${key}/${axis}: plotted years fit the chart`);
      const raw=!(rec.trend_anomaly||[]).some(a=>Number.isFinite(a[3]))&&(rec.obs||[]).some(a=>Number.isFinite(a[1]));
      const yieldSource=raw?rec.obs:rec.trend_anomaly||[];
      const fittedYield=axis==='enso'?(rec.relationship_history||[]).filter(a=>a[0]==='ly'&&a[1]==='rel'&&Number.isFinite(a[3])&&Number.isFinite(a[4])):[];
      const n=fittedYield.length||yieldSource.filter(a=>Number.isFinite(a[raw?1:3])&&(axis==='year'||expo.has(a[0]))).length;
      assert.equal(byLabel.get('Yield').chart.points.length,n,`${iso}/${key}/${axis}: complete yield points`);
      if(raw)assert.equal(byLabel.get('Yield').chart.yLabel,'reported yield (t/ha)');
      if(rec.qc?.length)assert(text.includes('Data quality flags'));
      if(rec.obs?.length)assert(text.includes('Reported yields'));
      fullChecks.push({iso,key,series:String(s.id),axis,kind:sample.kind});
    }
  }
  for(const sample of stateSamples) {
    const r={iso:sample.iso,key:sample.key,q:new URLSearchParams({crop:sample.crop_code,season:sample.season,axis:'year',release})};
    await A.renderDetail(document.getElementById('view'),r,0);
    for(const spec of window.specs)assert(spec.chart.points.every(p=>p.x>=spec.chart.x0&&p.x<=spec.chart.x1),'State weather history must fit the axis even when yields start later');
    assert(!document.getElementById('view').textContent.includes('Growing window for harvest'),'State pages cannot borrow a county calendar');
  }
  // The selected harvest controls every current marker, including weather and map colors.
  const target={iso:'USA',key:'USA:19:1',q:new URLSearchParams({crop:'maize',season:'main',harvest:'2024',release})};
  await A.renderDetail(document.getElementById('view'),target,0);
  assert(window.specs.every(x=>!x.chart.sofar&&!x.chart.forecast),'A 2024 selection cannot display 2026 weather or outlook markers');
  // A changed release cannot retain another release's neighboring map values.
  A.D.worldUnits={stale:true};A.D.countryBox=new Map([['stale',[]]]);
  await A.ensureRelease(release==='2026-10-10'?'2026-10-09-candidate':'2026-10-10');
  assert.equal(A.D.worldUnits,null);assert.equal(A.D.countryBox,null);
  fs.mkdirSync(out,{recursive:true});
  const report={release,application_sha256:require('node:crypto').createHash('sha256').update(originalSource).digest('hex'),state_cases:stateSamples,counts,full_page_checks:fullChecks.length,countries:countryRows,rendered_cases:fullChecks,passed:true,scope:'Display checks against the identified release, including source permissions, exact-series routing and chart-point coverage. Older archived applications are outside this audit.'};
  fs.writeFileSync(path.join(out,`visibility-${release}.json`),JSON.stringify(report,null,2)+'\n');
  const countRows=[['Countries',counts.countries],['Source series checked',counts.series],['State records checked',counts.state_records],['Previously unreachable series',counts.formerly_unreachable_series],['Additional crop–season combinations',counts.record_only_combinations],['Map cells checked',counts.map_cells_checked],['Full detail-page renders',fullChecks.length],['Places without geometry, reachable by search',counts.unmapped_units],['Series using reported yield when anomalies are absent',counts.raw_yield_fallback],['State records using reported yield when anomalies are absent',counts.state_raw_yield_fallback]];
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas display audit · ${release}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:16px/1.55 system-ui;background:#fbfaf7;color:#202720}h1{font-size:29px}h2{font-size:20px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-variant-numeric:tabular-nums}a{color:#235d83}code{overflow-wrap:anywhere;font-size:12px}.note{color:#576157}details{margin:24px 0}summary{cursor:pointer}img{max-width:100%}</style><h1>Atlas display audit</h1><p class="note">${new Date().toISOString().slice(0,10)} · release ${release} · local implementation</p><p>We checked each released source series against crop and season selection, record-file access, outlook colors, harvest dates and source display permissions. We rendered ${fullChecks.length} detail-page cases across all six crops, both chart views, national and local records, and records with and without outlooks. Additional state cases check weather histories that begin before yield observations.</p><table><tbody>${countRows.map(([k,v])=>`<tr><th>${k}</th><td>${Number(v||0).toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table><h2>Corrections</h2><p>We separated record discovery from current forecast availability. Browse records, country crop-record selection, local series selection and place search now expose records omitted from the current prediction sample. Default source priorities remain unchanged. Explicit selection can open another published series.</p><p>We draw reported yield in tonnes per hectare when a percentage anomaly is absent. Details includes every permitted reported yield, including observations outside the exported anomaly series, as well as published scenarios, weather measures and quality flags. History uses the full range of the available weather and yield years.</p><p>We retain national color when county geometry has no matching record. Calendar maps can show neighboring countries' published dates. Outlook maps respect the requested harvest year; weather markers and ENSO expectations must match that year. Release changes clear neighboring-country map caches, and late requests from a previous release cannot restore them. World overlays use the same crop–season panel as their national background.</p><p>We added country historical-test tables, covered-production crop summaries, monthly ENSO paths, release links and a change summary behind disclosures. Country skill remains labeled as country-level evidence. Observed future-index diagnostics remain distinct from issued outlooks.</p><h2>Limits</h2><p>We did not change the database, recompute forecasts, relax recency or skill rules, alter stable HarvestStat districts, download new data or publish the website. The ${counts.unmapped_units} places without geometry remain available by search. Missing calendars, missing forecasts and restricted observations retain explicit states. The audit covers the current /site application and its release adapters; the separate archived /watch, /global and /climate applications were not rewritten.</p><p>These checks establish display coverage and consistency with released values. They do not establish forecast skill or validate the underlying scientific models.</p><details><summary>Country coverage</summary><table><thead><tr><th>Country</th><th>Series</th><th>Recovered series</th><th>Unmapped places</th></tr></thead><tbody>${countryRows.map(r=>`<tr><td>${r.country}</td><td>${r.series}</td><td>${r.historical_only_series}</td><td>${r.unmapped}</td></tr>`).join('')}</tbody></table></details><p><a href="visibility-${release}.json">Machine-readable audit</a> · <a href="http://127.0.0.1:8787/site/index.html#/?release=${release}">Open local atlas</a></p><p class="note">Application SHA-256: <code>${report.application_sha256}</code></p></html>`;
  fs.writeFileSync(path.join(out,`visibility-${release}.html`),html);
  console.log('PASS exhaustive visibility:',JSON.stringify(counts),`${fullChecks.length} full detail renders; release cache isolation`);
})().catch(e=>{console.error(e);process.exitCode=1;});
