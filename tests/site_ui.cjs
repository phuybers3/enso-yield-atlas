// Drive the site application against the exported release with a DOM implementation and a MapLibre stub:
// the three views at world, country and unit level for the four panels the review named, the numbers in the page
// against panels.json and the unit files, the release routing, and the absence of any withheld weather view.
// Run: node tests/site_ui.cjs [release]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const {parseHTML} = require('linkedom');
const ROOT = path.join(__dirname, '../site');
const {window: dom} = parseHTML(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const document = dom.document, handlers = {}, maps = {};
const window = {addEventListener: (name, fn) => { handlers[name] = fn; }, scrollTo() {}};
Object.defineProperty(dom.HTMLSelectElement.prototype, 'value', {get() { return this._value ?? this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; }, set(v) { this._value = v; }, configurable: true});
class MapStub {
  constructor(o) { maps[o.container] = this; this.sources = {}; this.events = {}; this.canvas = document.createElement('canvas'); }
  on(n, layer, callback) { this.events[n] = callback || layer; if (n === 'load') setTimeout(layer, 0); }
  addSource(id, s) { this.sources[id] = s; } addLayer() {} addControl() {} fitBounds(b) { this.fit = b; } remove() { this.removed = true; } getCanvas() { return this.canvas; }
}
const maplibregl = {Map: MapStub, NavigationControl: class {}}; window.maplibregl = maplibregl;
const publicMode=process.env.ATLAS_PUBLIC==='1';const dataBase='https://raw.githubusercontent.com/phuybers3/enso-yield-atlas/'+'a'.repeat(40)+'/site/';
const location = {hostname:publicMode?'phuybers3.github.io':'localhost',hash: '#/season/USA?crop=maize&season=main'};
const requests = [];
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), vm.createContext({window, document, location, maplibregl, URL, URLSearchParams, Response, console, encodeURIComponent, decodeURIComponent, setTimeout,
  fetch: async p => { requests.push(p); if(p==='hosting.json')return new Response(JSON.stringify({data_base:dataBase}));if(publicMode){assert(p.startsWith(dataBase),'public data must use deployment commit: '+p);p=p.slice(dataBase.length);} try { return new Response(fs.readFileSync(path.join(ROOT, p))); } catch { return new Response('', {status: 404}); } }}));
const releases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/releases.json')));
const release = process.argv[2] || releases.default, base = path.join(ROOT, 'data', release);
const J = f => JSON.parse(fs.readFileSync(path.join(base, f)));
const text = () => document.getElementById('view').textContent.replace(/\s+/g, ' ');
const go = async hash => { location.hash = hash; await handlers.hashchange(); await new Promise(r => setTimeout(r, 0)); const t = text(); assert(!t.includes('Something did not load'), `${hash}: ${t.slice(0, 200)}`); return t; };
const ready = async id => { for (let i = 0; i < 400 && (!maps[id]?.sources.u || maps[id].removed); i++) await new Promise(r => setTimeout(r, 5)); assert(maps[id]?.sources.u && !maps[id].removed, `map ${id} loaded`); return maps[id].sources.u.data.features; };
const pct = (v, d = 1) => (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
const NAMED = [['USA', 'maize', 'main', 'USA:17:57'], ['IND', 'rice_milled', 'Kharif', null], ['BRA', 'maize', 'main', null], ['ARG', 'maize', 'main', null]];
(async () => {
  await handlers.DOMContentLoaded();
  const panels = new Map(J('panels.json').map(p => [p.key, p]));
  assert.deepEqual([...document.querySelectorAll('#view-nav a')].map(a => a.textContent), ['This season', 'El Niño relationships', 'Yield history', 'About & data']);
  assert.equal(document.getElementById('release-tag').textContent.slice(0, 8 + release.length), `release ${release}`);
  let checked = 0;
  for (const [iso, crop, season, unit] of NAMED) {
    const key = `${iso}|${crop}|${season}`, p = panels.get(key); assert(p, key);
    const units = J(`units/${iso}.json`);
    const q = `?crop=${crop}&season=${season}`;
    // season view: the panel card carries the medium, low and high index_outlook rows and the weather row with its gates
    const t = await go(`#/season/${iso}${q}`);
    const med = p.predictions.find(x => x.method === 'index_outlook' && x.scenario === 'medium'), lo = p.predictions.find(x => x.scenario === 'low'), hi = p.predictions.find(x => x.scenario === 'high');
    for (const v of [med.pct, med.lo, med.hi, lo.pct, hi.pct]) { assert(t.includes(pct(v)), `${key}: ${pct(v)} missing from the season view`); checked++; }
    assert(t.includes(p.status) && t.includes(`harvest ${p.harvest_year}`), `${key}: status and harvest year`);
    if (p.weather) { assert(t.includes(`${pct(p.weather.pct_panel)} ± ${p.weather.se_panel.toFixed(1)}`) && t.includes(`Lead ${p.weather.lead} months`), `${key}: weather estimate`); assert(t.includes(p.weather.usable_panel ? 'Meets the weather checks' : 'Does not yet meet all weather checks'), `${key}: usable flag`); checked += 2; }
    else assert(t.includes('No estimate') && t.includes('no weather-to-date row'), `${key}: weather absence`);
    assert(!/withheld|calendar review/i.test(t), `${key}: the season view must not withhold weather`);
    assert(t.includes('Historical prediction skill by lead') && t.includes('ENSO observations and scenario paths'), `${key}: skill panel and index paths`);
    const sw = p.season_weather;
    if (sw) { assert(t.includes(sw.verdict) && t.includes(`${(100 * sw.frac_elapsed).toFixed(0)}% of window run`) && t.includes(`${sw.metrics_concordant} of the ${sw.metrics_with_signal} metrics`), `${key}: season weather card`); checked += 2; }
    else assert(t.includes('no season-to-date weather row'), `${key}: season weather absence`);
    const feats = await ready('cmap');
    const picked = Object.entries(units.units).filter(([, u]) => u.series.some(s => s.crop_code === crop && s.season === season));
    const mapped = feats.filter(f => f.properties.level !== 'national' || picked.some(([k]) => k === f.id));
    assert(mapped.length > 0 && mapped.length <= picked.length, `${key}: ${mapped.length} mapped units for ${picked.length} selected`);
    assert(mapped.every(f => f.properties.color), `${key}: every mapped unit is coloured`);
    // the rainfall and temperature layers colour the units that carry a weather row
    const tr = await go(`#/season/${iso}${q}&layer=rain`); assert(tr.includes('Rainfall anomaly to date, mm'), `${key}: rain layer`);
    const rainFeats = await ready('cmap'); const withWeather = picked.filter(([, u]) => u.series.some(s => s.crop_code === crop && s.season === season && s.weather.length)).length;
    const coloured = rainFeats.filter(f => f.properties.color && f.properties.color !== '#d5d6d2' && f.properties.color !== '#eceae4').length;
    assert(withWeather === 0 ? coloured === 0 : coloured > 0, `${key}: ${coloured} coloured units for ${withWeather} with weather`);
    const tt = await go(`#/season/${iso}${q}&layer=tmax`); assert(tt.includes('temperature anomaly'), `${key}: temperature layer`); await ready('cmap');
    // response view: the country row of the season window and the regions
    const t2 = await go(`#/response/${iso}${q}`);
    if (p.response) { assert(t2.includes(pct(p.response.pct_per_degC, 2)), `${key}: country response ${pct(p.response.pct_per_degC, 2)}`); checked++; }
    assert(t2.includes('Regions, ranked') && t2.includes('Local coverage'), `${key}: response view sections`);
    await ready('cmap');
    // record view: a unit table with record lengths
    const t3 = await go(`#/record/${iso}${q}`);
    assert(/\d+ reporting units with/.test(t3) && t3.includes('Latest yield') && t3.includes('Trend, % per year'), `${key}: record view`);
    await ready('cmap');
    const ta = await go(`#/record/${iso}${q}&measure=anomaly`); assert(ta.includes('anomaly from the series trend'), `${key}: anomaly measure`); await ready('cmap');
    if (unit) {
      const u = units.units[unit], s = u.series.find(x => x.crop_code === crop && x.season === season);
      const t4 = await go(`#/record/${iso}/${encodeURIComponent(unit)}${q}`);
      assert(t4.includes(u.name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())) && t4.includes(`${s.n} years`) && t4.includes(`series ${s.id}`), `${unit}: record view`); checked++;
      const rec = JSON.parse(fs.readFileSync(path.join(base, `records/${iso}.json`))).series[s.id];
      assert(t4.includes(`Log-linear trend ${pct(rec.trend.trend_pct_per_year, 2)} per year`) && t4.includes('fitted trend'), `${unit}: trend drawn and stated`); checked++;
      const last = rec.trend_anomaly[rec.trend_anomaly.length - 1]; assert(t4.includes(pct(last[3])), `${unit}: latest anomaly in the table`); checked++;
      const t5 = await go(`#/response/${iso}/${encodeURIComponent(unit)}${q}`);
      const cols = units.columns.responses, rel = s.responses.find(r => r[cols.indexOf('index')] === 'rel');
      assert(t5.includes(pct(rel[cols.indexOf('pct_best')], 2)) && t5.includes(rel[cols.indexOf('response_level')]), `${unit}: response row`); checked++;
      const t6 = await go(`#/season/${iso}/${encodeURIComponent(unit)}${q}`);
      const pc = units.columns.predictions, m = s.predictions.find(r => r[pc.indexOf('method')] === 'index_outlook' && r[pc.indexOf('scenario')] === 'medium');
      assert(t6.includes(pct(m[pc.indexOf('pct')], 2)) && t6.includes('Planting and harvest windows'), `${unit}: prediction row and windows`); checked++;
      if (s.weather.length) { const pr = s.weather.find(w => w.product === 'chirps').metrics.precip; assert(t6.includes('Weather observed during this growing season') && t6.includes(pr[0].toFixed(1)), `${unit}: series weather table`); checked++; }
    }
  }
  // world views
  const w = J('world.json');
  const t7 = await go('#/season');
  assert(t7.includes(`${w.headline.panels} panels`) && t7.includes(pct(w.headline.weather_implied_pct, 2)) && t7.includes(pct(w.headline.index_implied_pct, 2)) && t7.includes('ENSO observations and scenario paths'), 'world headline and index paths');
  const maizeMed = w.world.find(x => x.crop_family === 'maize' && x.method === 'index_outlook' && x.scenario === 'medium');
  assert(t7.includes((maizeMed.dprod_mt > 0 ? '+' : '') + maizeMed.dprod_mt.toFixed(2)), 'world maize row'); checked += 2;
  await ready('wmap');
  const t8 = await go('#/response?crop=maize');
  const usa = w.responses.find(x => x.key === 'USA|maize|main'); assert(t8.includes(pct(usa.pct_per_degC, 2)), 'world response list'); checked++;
  const t9 = await go('#/record?crop=rice_milled');
  assert(t9.includes('India') && t9.includes('Reporting units with rice (milled) records'), 'world record list');
  // routing: the release travels in the link; an unknown release is an explicit error; nav links keep the selection
  await go('#/season/ARG?crop=maize&season=main&release=' + release);
  assert(document.getElementById('release-sel').value === release);
  location.hash = '#/season/ARG?release=1999-01-01'; await handlers.hashchange(); await new Promise(r => setTimeout(r, 0));
  assert(text().includes('Unknown release 1999-01-01'), 'unknown release message');
  await go('#/season/ARG?crop=maize&season=main');
  const hrefs = [...document.querySelectorAll('#view-nav a')].map(a => a.getAttribute('href'));
  assert.deepEqual(hrefs.slice(0, 3), ['season','response','record'].map(v=>`#/${v}/ARG?crop=maize&season=main&release=${release}`));
  // Regressions reported by readers: same crop family, current season, both indices,
  // local feature precedence, same-year records and truthful empty selections.
  const usCopy=await go('#/season/USA?crop=maize&season=main');assert(usCopy.includes('coefficient-uncertainty bounds')&&!usCopy.includes('Central scenario · 95%'));
  const china=await go('#/season/CHN?crop=maize');
  assert(china.includes('China · maize, Annual') && china.includes('1,986 local units, main season'));
  assert(document.querySelector('#view-nav a').getAttribute('href').includes('season=Annual'));
  const chinaOld=await go('#/season/CHN?crop=maize&season=main');
  assert(chinaOld.includes('A current panel is available') && chinaOld.includes('Annual'));
  const rice=await go('#/record?crop=rice');assert(rice.includes('India'));
  const standard=await go('#/response?crop=maize&index=std');
  const disp=JSON.parse(fs.readFileSync(path.join(ROOT,`display/${release}/summary.json`)));
  const stdUSA=disp.responses.find(x=>x.key==='USA|maize|main'&&x.index==='std');
  assert(standard.includes(pct(stdUSA.pct_per_degC,2)) && !standard.includes('world list carries the relative index'));
  await go('#/response/BRA?crop=maize&season=main');const brazilFeatures=await ready('cmap');
  const outline=brazilFeatures.find(f=>!f.properties.reporting),local=brazilFeatures.find(f=>f.properties.reporting);
  assert(local && !local.properties.name.includes('_'));
  if(outline){maps.cmap.events.mousemove({features:[outline,local],point:{x:100,y:100}});const tooltip=document.querySelector('#cmap .tooltip').textContent;assert(tooltip.includes('Selected estimate')&&!tooltip.includes('National outline'),'reporting unit wins over outline');}
  await go('#/record/USA?crop=maize&season=main&year=2025');const historyFeatures=await ready('cmap');
  const original=J('units/USA.json');const old=Object.entries(original.units).find(([k,u])=>u.series.some(s=>s.crop_code==='maize'&&s.season==='main'&&s.last<2000)&&historyFeatures.some(f=>f.id===k));
  assert(old && historyFeatures.find(f=>f.id===old[0]).properties.color==='#d5d6d2','old observations must not color a 2025 map');
  const missing=await go('#/record/USA?crop=cassava');assert(missing.includes('No cassava records')&&!missing.includes('· maize'));
  const t10 = await go('#/about');
  assert(t10.includes('does not aggregate, pool, convert units or decide significance') && t10.includes('Archive'), 'about page');
  assert(!requests.some(p => p.includes('..')), 'the site reads only its own data folder');
  console.log(`PASS site ${release}: three views at world, country and unit level for ${NAMED.length} panels, ${checked} displayed numbers against the data files, no withheld weather view, release routing and navigation`);
})().catch(e => { console.error(e); process.exitCode = 1; });
