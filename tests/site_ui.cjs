// Drive the pilot interface against an exported release with a DOM implementation and a MapLibre stub: the first
// screen (title, two controls, map, legend in words, nothing to read above the map), the world and country maps on
// the outlook and calendar layers, the unit page's three numbers per row against the unit files, the omission of empty rows, the
// publication rule for restricted sources, direct routing for a national-only country, the old links, the URL state
// and the calendar fixture. The test reads both release contracts: 2026-10-08 (panels.json, display shards) and
// 2026-10-09 (world.json rows, units/<ISO>.json, records/<ISO>/<unit>.json shards, countries/<ISO>.json aggregates),
// with its own accessors, so that a value the page shows is compared to the file it came from and not to the
// application's reading of it. Run: node tests/site_ui.cjs [release]
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const {parseHTML} = require('linkedom');
const ROOT = path.join(__dirname, '../site');
const AtlasCalendar = require(path.join(ROOT, 'calendar.js'));
AtlasCalendar.todayISO = () => '2026-10-11';
const {window: dom} = parseHTML(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const document = dom.document, handlers = {}, maps = {}, markers = [];
const window = {addEventListener: (name, fn) => { handlers[name] = fn; }, scrollTo() {}};
Object.defineProperty(dom.HTMLSelectElement.prototype, 'value', {get() { return this._value ?? this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; }, set(v) { this._value = v; }, configurable: true});
class MapStub {
  constructor(o) { maps[o.container] = this; this.sources = {}; this.events = {}; this.layers = {}; this.canvas = document.createElement('canvas'); for (const h of ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate']) this[h] = {disabled: false, disable() { this.disabled = true; }}; }
  // Layer-scoped handlers are kept by layer, as MapLibre keeps them: the world map registers a second set for its units overlay.
  on(n, layer, callback) { if (callback) { (this.layered ||= {})[`${n}:${layer}`] = callback; if (layer === 'u-hit') this.events[n] = callback; } else this.events[n] = layer; if (n === 'load') setTimeout(callback ? layer : layer, 0); }
  addSource(id, s) { this.sources[id] = Object.assign({setData(d) { this.data = d; }}, s); } addLayer(l) { this.layers[l.id] = l; } getLayer(id) { return this.layers[id]; } getSource(id) { return this.sources[id]; } queryRenderedFeatures() { return []; } loaded() { return true; }
  addControl() {} fitBounds(b) { this.fit = b; }
  getCenter() { const c = this.camera?.center || [(this.fit[0][0]+this.fit[1][0])/2,(this.fit[0][1]+this.fit[1][1])/2]; return {toArray:()=>c}; }
  getZoom() { return this.camera?.zoom ?? 5; } getBounds() { return {toArray:()=>this.fit || [[this.camera.center[0]-1,this.camera.center[1]-1],[this.camera.center[0]+1,this.camera.center[1]+1]]}; }
  jumpTo(camera) { this.camera = camera; } remove() { this.removed = true; } getCanvas() { return this.canvas; }
}
class MarkerStub { constructor(o) { this.el = o.element; markers.push(this); } setLngLat(c) { this.c = c; return this; } addTo() { return this; } }
const maplibregl = {Map: MapStub, NavigationControl: class {}, Marker: MarkerStub}; window.maplibregl = maplibregl;
window.AtlasRegionalPage = require(path.join(ROOT, 'regional-page.js'));
const publicMode = process.env.ATLAS_PUBLIC === '1'; const dataBase = 'https://raw.githubusercontent.com/phuybers3/enso-yield-atlas/' + 'a'.repeat(40) + '/site/';
const releases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/releases.json')));
const release = process.argv[2] || releases.default, base = path.join(ROOT, 'data', release);
const location = {hostname: publicMode ? 'phuybers3.github.io' : 'localhost', hash: release === releases.default ? '#/' : `#/?release=${release}`};
const requests = [];
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), vm.createContext({window, document, location, maplibregl, AtlasCalendar, URL, URLSearchParams, Response, console, encodeURIComponent, decodeURIComponent, setTimeout,
  fetch: async p => { requests.push(p); if (p === 'hosting.json') return new Response(JSON.stringify({data_base: dataBase})); if (publicMode) { assert(p.startsWith(dataBase), 'public data must use the deployment commit: ' + p); p = p.slice(dataBase.length); } try { return new Response(fs.readFileSync(path.join(ROOT, p))); } catch { return new Response('', {status: 404}); } }}));
const J = f => JSON.parse(fs.readFileSync(path.join(base, f)));
const DJ = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'display', release, f)));
const catalog = J('catalog.json'), NEW = catalog.contract === '2026-10-09';
const RECONCILED=catalog.model?.replicates?.method==='centered_year_blocks_plus_shrinkage_student_v1';
const rel = q => release === releases.default ? '' : `${q.includes('?') ? '&' : '?'}release=${release}`;
const view = () => document.getElementById('view');
const text = () => view().textContent.replace(/\s+/g, ' ');
const go = async hash => { location.hash = hash + rel(hash); await handlers.hashchange(); await new Promise(r => setTimeout(r, 0)); const t = text(); assert(!t.includes('Something did not load'), `${hash}: ${t.slice(0, 300)}`); return t; };
const ready = async id => { for (let i = 0; i < 400 && (!maps[id]?.sources.u || maps[id].removed); i++) await new Promise(r => setTimeout(r, 5)); assert(maps[id]?.sources.u && !maps[id].removed, `map ${id} loaded`); return maps[id].sources.u.data.features; };
const fmt = (v, d = 1, sign = false) => (sign && v > 0 ? '+' : '') + Number(v).toFixed(d).replace('-', '−');
const pct = (v, d = 1) => fmt(v, d, true) + '%';
const rowsOf = (file, table, arr) => (arr || []).map(a => Object.fromEntries(file.columns[table].map((c, i) => [c, a[i]])));
const fixture = fs.existsSync(path.join(ROOT, 'fixtures/calendar_fixture.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/calendar_fixture.json'))) : null;
const fxRow = (unitKey, hy, season) => { if (!fixture) return null; const c = Object.fromEntries(fixture.columns.map((k, i) => [k, i])); const i = fixture.rows.findIndex(r => r[c.unit_key] === unitKey && r[c.harvest_year] === hy && (!season || r[c.season] === season)); return i < 0 ? null : {row: fixture.rows[i], expected: fixture.expected[i][fixture.dates.indexOf('2026-10-09')], c}; };
const NONE = '#fbfaf7', NOT_ESTIMATED = '#cfcec8', UNRESOLVED = '#f2c6d5';
const sectionRows = () => [...view().querySelectorAll('section.row')];
const rowByLabel = label => sectionRows().find(r => r.querySelector('.label').firstChild.textContent === label) || null;
const yieldRow = () => rowByLabel('Yield');
// Recover plotted percentages from the SVG's labelled grid lines, independently of the chart's scale function.
function assertYieldPercent(row, rec, outlook, axis='enso') {
  const svg = row.querySelector('svg');
  assert(svg.querySelector('.chart-y-label').textContent === 'Yield anomaly (%)', 'yield axis is in percent');
  const ticks = [...svg.querySelectorAll('text[text-anchor="end"]')].map(t => [Number(t.textContent.replace('−', '-')), Number(t.previousElementSibling.getAttribute('y1'))]);
  assert(ticks.length >= 2, 'yield scale has labelled grid lines');
  const [[v0, p0], [v1, p1]] = ticks;
  const valueAt = pixel => v0 + (pixel - p0) * (v1 - v0) / (p1 - p0);
  const tolerance = Math.abs((v1 - v0) / (p1 - p0)) * 0.3;
  const matches = (pixel, expected, label) => assert(Math.abs(valueAt(pixel) - expected) <= tolerance, `${label}: plotted ${valueAt(pixel)}%, expected ${expected}%`);
  for (const point of svg.querySelectorAll('circle.pt:not(.open)')) {
    const fitted=axis==='enso'?(rec.relationship_history||[]).find(a=>a[0]==='ly'&&a[1]==='rel'&&a[2]===Number(point.getAttribute('data-year'))):null;
    if(fitted){
      matches(Number(point.getAttribute('cy')),fitted[4],`fitted year ${fitted[2]}`);
      assert(point.querySelector('title').textContent.includes('from the fitted ENSO-neutral baseline'),'fitted points name their actual reference');
      continue;
    }
    const source = rec.trend_anomaly.find(a => a[0] === Number(point.getAttribute('data-year')));
    matches(Number(point.getAttribute('cy')), source[3], `year ${source[0]}`);
    assert(point.querySelector('title').textContent.includes(`${pct(source[3])} from trend; reported yield ${fmt(source[1], 2)} t/ha, trend ${fmt(source[2], 2)} t/ha`), 'tooltip uses the exported percentage and retains reported and trend yields');
  }
  if (outlook && outlook.pct != null) {
    const diamond = svg.querySelector('polygon.pt');
    const joint = axis === 'enso' && rec.joint_regions?.find(j => j.variable === 'ly' && j.index === 'rel' && j.status === 'available');
    if (axis === 'enso' && rec.joint_regions && !joint) {
      assert(!diamond, 'no joint marker without matching paired draws');
      return;
    }
    assert(diamond, 'available central outlook has a marker');
    const center = Number(diamond.getAttribute('points').split(' ')[1].split(',')[1]);
    matches(center, joint ? joint.center[1] : outlook.pct, 'central outlook');
    if (joint) {
      assert(svg.querySelectorAll('.joint-region').length === 2, 'two joint probability boundaries');
      return;
    }
    const whisker = diamond.previousElementSibling;
    matches(Number(whisker.getAttribute('y1')), outlook.hi ?? outlook.pct, 'upper outlook');
    matches(Number(whisker.getAttribute('y2')), outlook.lo ?? outlook.pct, 'lower outlook');
  }
}
const notes = () => (view().querySelector('.notes')?.textContent || '').replace(/\s+/g, ' ');
// Detailed row values remain available inside the closed Details panel.
const numsOf = sec => { const label = typeof sec === 'string' ? sec : sec.querySelector('.label').firstChild.textContent; return [...document.querySelectorAll(`.numrow[data-row="${label}"] .num`)].map(n => { const t = n.querySelector('.v.text'); return {k: n.querySelector('.k').textContent, v: n.querySelector('.v').textContent, text: t ? t.textContent : null, i: n.querySelector('.i')?.textContent || ''}; }); };
// ---- contract-aware readers of the release files ----------------------------------------------------------------
// The compact panel row: the central ENSO-outlook value with its interval, the harvest year and the series count.
const panels = new Map(NEW ? rowsOf(J('world.json'), 'panels', J('world.json').panels).map(p => [p.key, p])
  : J('panels.json').map(p => { const m = p.predictions.find(x => x.method === 'index_outlook' && x.scenario === 'medium') || {}; return [p.key, {...p, pct: m.pct, lo: m.lo, hi: m.hi}]; }));
const unitsOf = (iso, fam) => NEW ? J(`units/${iso}.json`) : DJ(`units/${iso}-${fam}.json`);
const isPublic = s => NEW ? s.display_points === true : ['hultgren', 'faostat'].includes(s.source);
// The record of a series: the shard under 2026-10-09 (always present, with nulls where withheld); the display
// records file under 2026-10-08 (public sources only). Weather rows come from the shard or the units series.
const recordOf = (iso, fam, unitKey, s) => {
  if (NEW) { const idx = J(`records/${iso}/index.json`); const f = idx.units[unitKey][0]; const shard = J(`records/${iso}/${f}`); const r = shard.series[s.id]; return {...r, responses: rowsOf(shard, 'responses', r.responses), columns: shard.columns, file: f}; }
  return isPublic(s) ? {...DJ(`records/${iso}-${fam}.json`).series[s.id], weather: s.weather, responses: []} : {obs: null, trend_anomaly: null, enso: [], weather: s.weather, responses: []};
};
const yieldResponse = (units, s) => { const r = rowsOf(units, 'responses', s.responses).find(x => x.index === 'rel' && (NEW ? x.variable === 'ly' : true)); return r ? (NEW ? {pct: r.pct_eb, note: r.note, weight: r.own_data_weight} : {pct: r.pct_best, level: r.response_level}) : null; };
// The state record of a panel (10 October 2026): records/<ISO>/state_<key>.json under `states` in the index.
const stateRecordOf = (iso, regionKey, crop, season) => { if (!NEW) return null; const idx = J(`records/${iso}/index.json`); const e = idx.states?.[regionKey]; if (!e) return null; const shard = J(`records/${iso}/${e[0]}`); const r = shard.series[`${crop}|${season}`]; return r ? {...r, responses: rowsOf(shard, 'responses', r.responses), columns: shard.columns} : null; };
const regionMedium = (iso, regionKey, crop, season, hy) => { if (!NEW) return null; const c = J(`countries/${iso}.json`); return rowsOf(c, 'regions', c.regions).find(x => x.region_key === regionKey && x.crop_code === crop && x.season === season && x.method === 'index_outlook' && x.scenario === 'medium' && x.target_year === hy) || null; };
(async () => {
  await handlers.DOMContentLoaded(); await new Promise(r => setTimeout(r, 0));
  let checked = 0;
  // 1. The first screen: title, two controls, the map, the legend in words; the prose only after the map.
  const v = view(); const kids = [...v.children]; const mapIndex = kids.findIndex(k => k.id === 'wmap');
  assert(kids[0].tagName === 'H1' && kids[0].textContent.startsWith('El Niño and the harvest'), 'title first');
  assert(mapIndex === 3 && kids[1].classList.contains('controls'), 'controls and map key above map');
  assert.deepEqual([...kids[1].querySelectorAll('select')].map(s => s.id), ['crop-sel', 'layer-sel']);
  assert(document.getElementById('date-label').hasAttribute('hidden'), 'date hidden on the outlook layer');
  assert.deepEqual([...document.querySelectorAll('#layer-sel option')].map(o => o.textContent), fs.existsSync(path.join(base, 'anomalies/index.json')) ? ['Outlook', 'Harvest anomaly by year', 'Crop calendar'] : ['Outlook', 'Crop calendar'], 'the anomaly layer is offered where the release carries its files');
  assert.equal(document.getElementById('crop-sel').value, 'maize');
  const legend = kids[mapIndex - 1]; assert(legend.classList.contains('legend') && (RECONCILED?/ENSO effect on yield/.test(legend.textContent):/Yield anomaly/.test(legend.textContent)) && (RECONCILED?/% change from the ENSO-neutral trend/.test(legend.textContent):/% from the trend yield/.test(legend.textContent)) && /≤ −10/.test(legend.textContent) && /≥ \+10 %/.test(legend.textContent) && legend.querySelectorAll('svg line').length === 5 && /Current estimate unavailable/.test(legend.textContent) && /No maize records/.test(legend.textContent), 'colourbar with a title, unit, five tick marks and the state swatches');
  assert(document.getElementById('methods') && document.getElementById('credits') && kids.indexOf(document.querySelector('.prose')) > mapIndex, 'methods and credits below the map');
  assert(/Greenness is shown where the release has observations/.test(text()) && /NDVI/.test(text()) && !/NDVI.*Deferred/.test(text()), 'available NDVI is described without falsely listing it as absent');
  assert(text().includes(`release ${release}`) || document.getElementById('foot-line').textContent.includes(release), 'the release is named');
  // A reconciled release publishes no weather-based number, so its methods name the ENSO range alone (20 October 2026).
  if (NEW) { assert(/80% range of the ENSO effect/.test(text()) && (RECONCILED || /95% confidence interval of the fitted mean/.test(text())) && !/80% prediction interval/.test(text()) && !/95% intervals of the fitted coefficient/.test(text()) && !/paper that accompanies/.test(text()) && (!RECONCILED || /About this release/.test(text())), 'methods describe the ranges, call none a prediction interval and promise no paper'); assert(text().includes(catalog.sources.hvstat.citation.slice(0, 30)) && text().includes('USDA NASS'), 'credits from catalog.sources'); }
  let feats = await ready('wmap');
  const usaWorld = feats.find(f => f.id === 'USA'), usaRow = panels.get('USA|maize|main');
  assert(usaWorld.properties.words.includes(pct(usaRow.pct)) && usaWorld.properties.words.includes(pct(usaRow.lo)) && usaWorld.properties.words.includes(pct(usaRow.hi)) && usaWorld.properties.localDetail, `USA outlook words on the world map: ${usaWorld.properties.words}`); checked++;
  const noMaize = feats.find(f => catalog.countries[f.id] && !Object.keys(catalog.countries[f.id].crops || {}).some(c=>catalog.crops[c]?.family==='maize'));
  if (noMaize) assert(noMaize.properties.color === NONE && noMaize.properties.words === 'No maize records', 'a country without maize records is named as such');
  assert(feats.every(f => f.properties.color && f.properties.words), 'every country has a colour and words');
  // 2. The calendar layers on the world map: the date control appears, the national calendar drives the words, the fixture agrees.
  await go('#/?layer=progress&date=2026-10-09');
  assert(document.getElementById('date-label').hasAttribute('hidden'), 'rolling calendar uses today without a separate date control');
  assert(!requests.some(p => p.includes('fixtures/world_calendar')) === NEW, NEW ? 'the candidate reads calendar_world.json, not the fixture' : 'the pilot reads the world calendar fixture');
  feats = await ready('wmap');
  const usaCal = feats.find(f => f.id === 'USA'), fxUSA = fxRow('USA', 2026, 'Annual');
  if (fxUSA) { assert(usaCal.properties.harvestDay === AtlasCalendar.day(fxUSA.row[fxUSA.c.harvest_date]), 'world harvest date matches published calendar'); checked++; }
  if (NEW) { const wc = J('calendar_world.json'); const bra = wc.panels['BRA|maize|main'].map(a => Object.fromEntries(wc.columns.map((c, i) => [c, a[i]]))).find(x => x.harvest_year === panels.get('BRA|maize|main').harvest_year); const fb = feats.find(f => f.id === 'BRA');
    if (bra.cycle_unresolved) assert(fb.properties.color === UNRESOLVED, 'BRA unresolved per the published flag'); else assert(fb.properties.color !== UNRESOLVED && fb.properties.words.includes(`Planted ${Number(bra.plant_date.slice(8, 10))}`), `BRA calendar from calendar_world.json: ${fb.properties.words}`); checked++; }
  else assert(feats.find(f => f.id === 'BRA').properties.color === UNRESOLVED && feats.find(f => f.id === 'BRA').properties.words.includes('Crop cycle unresolved'), 'Brazilian maize cycle unresolved at world level');
  const harvestBefore = usaCal.properties.harvestDay;
  await go('#/?layer=harvest&date=2028-01-01'); feats = await ready('wmap');
  assert(feats.find(f => f.id === 'USA').properties.harvestDay === harvestBefore, 'legacy calendar route shows the same harvest date regardless of marker date');
  const worldLegend = document.querySelector('.harvest-legend');
  assert(Number(worldLegend.dataset.harvestMin) === AtlasCalendar.day('2026-04-11') && Number(worldLegend.dataset.harvestToday) === AtlasCalendar.day('2026-10-11') && Number(worldLegend.dataset.harvestMax) === AtlasCalendar.day('2027-04-11'), 'world date scale is fixed at six months either side of today, regardless of legacy marker date');
  const past=feats.find(f=>Number.isFinite(f.properties.harvestDay)&&f.properties.harvestDay<AtlasCalendar.day('2026-10-11'));
  const future=feats.find(f=>Number.isFinite(f.properties.harvestDay)&&f.properties.harvestDay>AtlasCalendar.day('2026-10-11'));
  assert(past&&future&&past.properties.color!==future.properties.color,'past and future have distinct colors');
  // 3. The four cases: country map, unit page, numbers against the files.
  const CASES = [['USA', 'maize', 'main', 'maize', 'USA:19:1', 'Adair', 'Iowa'], ['IND', 'rice_milled', 'Kharif', 'rice', 'IND:IN.ADM2.00488', 'Kota', 'Rajasthan'], ['BRA', 'maize', 'main', 'maize', 'BRA:25:4715', 'Batatais', 'São Paulo'], ['ARG', 'maize', 'main', 'maize', 'ARG:8:251', 'Victoria', 'Entre Ríos']];
  for (const [iso, crop, season, fam, unitKey, unitName, regionName] of CASES) {
    const p = panels.get(`${iso}|${crop}|${season}`), units = unitsOf(iso, fam), country = catalog.countries[iso].name;
    const t = await go(`#/${iso}?crop=${crop}&season=${season}`);
    assert(t.includes(`${country}:`) && t.includes(`harvest ${p.harvest_year}`), `${iso}: country title`);
    assert(t.includes(`country outlook ${pct(p.pct)} from usual (${pct(p.lo)} to ${pct(p.hi)})`), `${iso}: country outlook line`); checked++;
    assert(document.getElementById('cmap') && document.querySelector('.record-directory') && !document.querySelector('.record-directory').hasAttribute('open'), `${iso}: country map with collapsed record search`);
    feats = await ready('cmap');
    const withSeries = feats.filter(f => units.units[f.id]?.series.some(s => s.crop_code === crop && s.season === season));
    assert(withSeries.length > 0 && feats.every(f => f.properties.color && f.properties.words), `${iso}: ${withSeries.length} mapped units with the series`);
    assert(markers.some(m => m.el.textContent === regionName), `${iso}: state label ${regionName} on the map`);
    const u = units.units[unitKey], s = u.series.find(x => x.crop_code === crop && x.season === season), preds = rowsOf(units, 'predictions', s.predictions).filter(x => x.harvest_year === p.harvest_year), med = preds.find(x => x.method === 'index_outlook' && x.scenario === 'medium'), wt = preds.find(x => x.method === 'weather_todate');
    const f0 = feats.find(f => f.id === unitKey); assert(f0 && (med ? f0.properties.words.includes(pct(med.pct)) : f0.properties.words.includes('no current estimate')), `${unitKey}: outlook words on the country map`); checked++;
    // A click on the unit: a large country (150 or more mapped units with the series, more than one state) opens its state first; a smaller one the unit.
    const big = withSeries.length >= 150 && new Set(withSeries.map(f => units.units[f.id].region_key)).size > 1;
    maps.cmap.events.click({features: [{...f0, id: 0, properties: f0.properties}]});
    const target = big ? `#/${iso}/${encodeURIComponent(u.region_key)}?` : `#/${iso}/${encodeURIComponent(unitKey)}?`;
    assert(location.hash.startsWith(target) && location.hash.includes(`crop=${crop}`) && location.hash.includes(`season=${season}`), `${unitKey}: click opens ${big ? 'the state' : 'the unit'}: ${location.hash}`);
    assert([...Object.values(maps.cmap.scrollZoom ? {s: maps.cmap.scrollZoom} : {})].every(h => h.disabled) && maps.cmap.dragPan.disabled, `${iso}: zoom and pan disabled`);
    // the calendar layer on the country map, against the fixture's status of the unit's series
    await go(`#/${iso}?crop=${crop}&season=${season}&layer=progress&date=2026-10-09`); feats = await ready('cmap');
    const fx = fxRow(unitKey, p.harvest_year, season); const fw = feats.find(f => f.id === unitKey).properties.words;
    if (fx) { const [phase, progress, dfp, dfh] = fx.expected;
      const cal = NEW ? rowsOf(units, 'calendar', s.calendar).find(x => x.harvest_year === p.harvest_year) : null;
      const unresolved = NEW ? cal.cycle_unresolved : iso === 'BRA' && ['first', 'second'].includes(fx.row[fx.c.cycle]);
      if (NEW) assert(cal.plant_date === fx.row[fx.c.plant_date] && cal.harvest_date === fx.row[fx.c.harvest_date], `${unitKey}: calendar_status dates agree with the fixture`);
      if (unresolved) assert(fw.includes('Crop cycle unresolved'), `${unitKey}: ${fw}`);
      else assert(feats.find(f => f.id === unitKey).properties.harvestDay === AtlasCalendar.day(fx.row[fx.c.harvest_date]), `${unitKey}: harvest date equals published calendar`);
      checked++; }
    // the unit page
    await go(`#/${iso}/${encodeURIComponent(unitKey)}?crop=${crop}&season=${season}`);
    const crumbs = document.querySelector('.crumbs').textContent.replace(/\s+/g, ' ');
    assert(crumbs.includes('World') && crumbs.includes(country) && crumbs.includes(regionName) && crumbs.endsWith(unitName), `${unitKey}: breadcrumbs ${crumbs}`);
    assert(document.querySelector('h1').textContent.startsWith(`${unitName}, ${regionName}`), `${unitKey}: title`);
    await ready('cmap'); assert(maps.cmap.sources.u.data.features.some(f => f.id === unitKey && f.properties.selected === true) && !document.querySelector('.context'), `${unitKey}: the local map outlines the unit`);
    // The local map: a window 1000 km wide centred on the unit, beside the charts; neighbours from other countries arrive with their files.
    { const lon = u.lon, lat = u.lat, w = 1000 / (6371 * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI; const fit = maps.cmap.fit;   // the window is 1000 km wide
      assert(Math.abs(fit[1][0] - fit[0][0] - w) < 1e-6 && Math.abs((fit[0][0] + fit[1][0]) / 2 - lon) < 1e-6 && fit[0][1] < lat && fit[1][1] > lat, `${unitKey}: window ${JSON.stringify(fit)} around ${lon}, ${lat}`);
      assert(document.querySelector('.local .local-map #cmap') && document.querySelector('.local .local-series .rows'), `${unitKey}: map beside the charts`);
      for (let i = 0; i < 400 && !maps.cmap.sources.u.data.features.some(f => f.properties.country && f.properties.country !== iso); i++) await new Promise(r => setTimeout(r, 5));
      const foreign = maps.cmap.sources.u.data.features.filter(f => f.properties.country && f.properties.country !== iso);
      if (iso === 'ARG' && NEW) { assert(foreign.some(f => f.properties.country === 'BRA' && f.properties.level !== 'national') && foreign.some(f => f.properties.country === 'URY'), `${unitKey}: Brazilian municipalities and Uruguay in the window`);
        const nb = foreign.find(f => f.properties.country === 'BRA' && f.properties.level !== 'national' && f.properties.reporting); const pk = J('world_units.json').panels.maize.BRA;
        maps.cmap.events.click({features: [{...nb, id: 0, properties: nb.properties}]}); assert(decodeURIComponent(location.hash).startsWith(`#/BRA/${nb.id}?`) && location.hash.includes(`crop=${pk.split('|')[1]}`) && location.hash.includes(`season=${encodeURIComponent(pk.split('|')[2])}`), `${unitKey}: a neighbour across the border opens with Brazil's maize panel: ${location.hash}`);
        await go(`#/${iso}/${encodeURIComponent(unitKey)}?crop=${crop}&season=${season}`); checked++; }
      // one axis for the stack: only the last chart carries the tick labels and the axis name
      const svgs = sectionRows().map(r => r.querySelector('svg')); assert(svgs.length && svgs.slice(0, -1).every(s => !s.textContent.includes('Niño') && !s.textContent.includes('Harvest year')) && svgs[svgs.length - 1].textContent.includes('Niño'), `${unitKey}: the axis is drawn once`);
      // Reader-facing panels retain the plotted data; supporting explanations are in the Details panel.
      assert(svgs.every(s => s.querySelector('.chart-y-label') && s.querySelector('[data-chart-frame]') && !s.textContent.includes('forecast') && !s.textContent.includes('so far')), `${unitKey}: plain axis labels and measurable plot frames`);
      const cap = document.querySelector('#regional-details .caption'); assert(cap && cap.textContent.includes('open diamond') && document.querySelector('#regional-details').hidden && document.querySelector('#regional-paper').hidden, `${unitKey}: supporting text behind closed disclosures`);
      assert(!document.querySelector('.local .numbers') && document.querySelector('.regional-key') && document.querySelector('.regional-estimate'), `${unitKey}: one visible estimate and compact symbol key`); }
    const rec = recordOf(iso, fam, unitKey, s);
    const best = rec.weather.find(w => w.product === 'best'), chirps = rec.weather.find(w => w.product === 'chirps');
    const tResp = rec.responses.find(x => x.variable === 'tavg_mean' && x.index === 'rel'), pResp = rec.responses.find(x => x.variable === 'precip' && x.index === 'rel');
    const vhp = rec.weather.find(w => w.product === 'vhp'), nResp = rec.responses.find(x => x.variable === 'ndvi_mean' && x.index === 'rel');
    const nHist = (rec.weather_history || []).some(h => h[3] != null);
    // a row renders only with a number or a mark: temperature with a season-to-date row or a fitted response; greenness (14 October 2026) likewise, or with a history
    const rows = sectionRows(); const expectRows = [...(best?.metrics?.tavg_mean || tResp ? ['Temperature'] : []), ...(chirps?.metrics?.precip || pResp ? ['Rainfall'] : []), ...(vhp?.metrics?.ndvi_mean || nResp || nHist ? ['Greenness'] : []), 'Yield'];
    assert.deepEqual(rows.map(r => r.querySelector('.label').firstChild.textContent), expectRows, `${unitKey}: rows with something to show`);
    const Y = yieldRow(), TR = rowByLabel('Temperature'), RR = rowByLabel('Rainfall');
    assert(rows.every(r => r.querySelectorAll('details').length === 0) && notes().length > 0, `${unitKey}: no disclosures on the rows, notes below them`);
    assert(rows.every(r => numsOf(r).length === 3) && rows.every(r => !r.querySelector('.nums')), `${unitKey}: three numbers per row, retained inside Details`);
    const y = numsOf(Y);
    const head = document.querySelector('.regional-estimate');
    if (med?.pct != null) assert(head.querySelector('.regional-value').textContent === pct(med.pct), `${unitKey}: visible estimate equals the release row`);
    if (med?.pct != null && med.skill_vs_trend == null) assert(head.textContent.includes('not yet assessed') && !head.textContent.includes('No improvement'), `${unitKey}: unknown skill is not failed skill`);
    const detailsButton = document.querySelector('[data-regional-panel=details]'); detailsButton.onclick();
    assert(!document.querySelector('#regional-details').hidden && detailsButton.getAttribute('aria-expanded') === 'true');
    detailsButton.onclick(); assert(document.querySelector('#regional-details').hidden);
    assert(![...document.querySelectorAll('#regional-paper a')].some(a => /records\/|units\//.test(a.getAttribute('href'))), `${unitKey}: no unchecked bulk-data download`);

    if (med) { assert(y[0].v === pct(med.pct) && !y[0].i, `${unitKey}: From ENSO ${y[0].v} vs ${pct(med.pct)}, no explanatory line beside it`); assert(notes().includes(`from ENSO ${pct(med.lo)} to ${pct(med.hi)}, the 80% range of the ENSO effect`), `${unitKey}: the range is in the notes, named as the ENSO-effect range`); checked += 2;
      // the headline distinguishes a validated forecast from a conditional historical response, and the notes say why
      assert(med.usable && med.skill_vs_trend > 0 ? /Validated:/.test(notes()) : /Conditional:.*not a validated forecast/.test(notes()), `${unitKey}: validation words (usable ${med.usable}): ${y[0].k} / ${notes().slice(0, 200)}`); }
    else assert(/Too few years|No outlook|Not estimated|Historical record available/.test(y[0].v), `${unitKey}: reason in place of the number`);
    // the scenario contrasts (19 October 2026): the chance of a 20% loss and gain at the central path in the estimate head, and the extrapolation words
    { const scc = rec.columns?.scenario_contrast || []; const central = (rec.scenario_contrast || []).map(a => Object.fromEntries(scc.map((c, i) => [c, a[i]]))).find(r => r.scenario === 'central');
      const chance = document.querySelector('.regional-chance');
      if (central && central.p_loss20 != null && med?.pct != null) { assert(chance && chance.textContent.includes(`${(100 * central.p_loss20).toFixed(0)}%`) && chance.textContent.includes(`${(100 * central.p_gain20).toFixed(0)}%`), `${unitKey}: the chances of a 20% loss and gain are shown: ${chance?.textContent}`);
        assert(!!central.extrapolated === chance.textContent.includes('beyond the fitted index range'), `${unitKey}: extrapolation words (${central.extrapolated})`); checked += 2; }
      else assert(!chance, `${unitKey}: no chance line without a central scenario row`); }
    const reported=rec.obs?.find(a=>a[0]===p.harvest_year && Number.isFinite(a[1])); assert(y[1].v === (reported ? fmt(reported[1],2)+' t/ha' : 'Not available for this harvest year'), `${unitKey}: reported harvest availability`);
    if (wt && wt.usable) { assert(y[2].v === pct(wt.pct) && notes().includes(`${pct(wt.lo)} to ${pct(wt.hi)}, the 95% interval of the fitted mean`), `${unitKey}: at harvest, its interval in the notes`); checked++; } else assert(y[2].v.startsWith('Not yet available'), `${unitKey}: at harvest reason`);
    const GR = rowByLabel('Greenness'); const gn = GR ? numsOf(GR) : null;
    if (vhp?.metrics?.ndvi_mean) { assert(gn[1].v === fmt(vhp.metrics.ndvi_mean[2], 3, true) + ' NDVI' && gn[1].k.includes(vhp.data_end.slice(0, 4)), `${unitKey}: greenness so far ${gn[1].v}`); checked++; }
    if (GR) { const fitted=(rec.relationship_history||[]).filter(a=>a[0]==='ndvi_mean'&&a[1]==='rel'); const hist = (rec.weather_history || []).filter(h => h[3] != null && rec.enso.some(e => e[0] === h[0] && e[2] != null)); assert(GR.querySelectorAll('circle.pt:not(.open)').length === (fitted.length||hist.length), `${unitKey}: greenness points use the fitted sample where available`);
      assert(GR.querySelectorAll('circle.pt.provisional').length === (fitted.length?0:hist.filter(h => h[4] === 1).length), `${unitKey}: provisional seasons as open circles`); }
    const tn = TR ? numsOf(TR) : null, rn = RR ? numsOf(RR) : null;
    if (best) { assert(tn[1].v === fmt(best.metrics.tavg_mean[2], 1, true) + ' °C' && tn[1].k.includes(best.data_end.slice(0, 4)), `${unitKey}: temperature so far ${tn[1].v}`); checked++; } else if (tn) assert(tn[1].v.startsWith('No season-to-date observations'), `${unitKey}: temperature absence named`);
    if (chirps) { assert(rn[1].v === fmt(chirps.metrics.precip[2], 0, true) + ' mm', `${unitKey}: rainfall so far ${rn[1].v}`); checked++; } else if (rn) assert(rn[1].v.startsWith('No season-to-date observations'), `${unitKey}: rainfall absence named`);
    // the third weather slot: the departure the index so far implies, from the shard's expectations (2026-10-09); 'Not available' under the older contract
    const wxT = NEW ? rec.weather_expected?.tavg_mean : null, wxP = NEW ? rec.weather_expected?.precip : null, wxc = rec.columns?.weather_expected || [];
    const wx = a => a ? Object.fromEntries(wxc.map((c, i) => [c, a[i]])) : null;
    if (tn) { const e = wx(wxT); if (e && e.expected_todate != null) { assert(tn[2].k === 'Index so far' && tn[2].v === `${fmt(e.expected_todate, 2, true)} °C`, `${unitKey}: temperature from the index so far ${tn[2].v}`); checked++; } else assert(tn[2].v === 'Not available' || tn[2].v === 'No window month yet', `${unitKey}: temperature third slot ${tn[2].v}`); }
    // (14 October 2026) a greenness row is expected where the record carries greenness; checked above
    if (NEW) {
      // the weather responses of the shard: the slope per +1 °C in the From ENSO slot and a line on the chart
      if (tResp) { const e = wx(wxT); const j=rec.joint_regions?.find(j=>j.variable==='tavg_mean'&&j.index==='rel'&&j.status==='available'&&j.target_year===p.harvest_year); const expected=j?.center[1]??e?.expected_central; if (expected != null) { assert(tn[0].v === `${fmt(expected, 2, true)} °C` && tn[0].k === 'From ENSO', `${unitKey}: temperature from ENSO this season ${tn[0].v}`); } else assert(tn[0].text, `${unitKey}: no window, reason given`); assert(TR.querySelector('path[stroke="#111"]') && notes().includes(`temperature ${fmt(tResp.slope_eb, 2, true)} °C`), `${unitKey}: temperature response line and its sensitivity in the notes`);
        const fitted=(rec.relationship_history||[]).filter(a=>a[0]==='tavg_mean'&&a[1]==='rel');
        const hist = (rec.weather_history || []).filter(h => h[1] != null && rec.enso.some(a => a[0] === h[0] && a[2] != null));
        const expectedPoints = fitted.length || hist.length;
        assert(TR.querySelectorAll('circle.pt:not(.open)').length === expectedPoints, `${unitKey}: ${TR.querySelectorAll('circle.pt:not(.open)').length} temperature relationship points for ${expectedPoints} fitted seasons`); checked += 2; } else if (tn) assert(tn[0].v === 'No fitted response for this unit', `${unitKey}: no temperature response named`);
      if (pResp) { const e = wx(wxP); const j=rec.joint_regions?.find(j=>j.variable==='precip'&&j.index==='rel'&&j.status==='available'&&j.target_year===p.harvest_year); const expected=j?.center[1]??e?.expected_central; if (expected != null) assert(rn[0].v === `${fmt(expected, 0, true)} mm`, `${unitKey}: rainfall from ENSO this season ${rn[0].v}`); assert(RR.querySelector('path[stroke="#111"]'), `${unitKey}: rainfall response line`); checked++; }
      if (TR) assert(!TR.querySelector('svg').textContent.includes('pending'), `${unitKey}: weather curves no longer marked pending`);
    } else {
      if (tn) assert(tn[0].v === 'Not yet estimated for this unit' && TR.querySelector('svg').textContent.includes('pending'), `${unitKey}: temperature row pending`);
      if (rn) assert(RR.querySelector('svg').textContent.includes('pending'), `${unitKey}: rainfall curve marked pending`);
    }
    // observed points only for public sources; the fitted curve and coverage for restricted ones
    const pts = Y.querySelectorAll('circle.pt'), diamond = Y.querySelector('polygon.pt');
    if (isPublic(s)) { const fitted=(rec.relationship_history||[]).filter(a=>a[0]==='ly'&&a[1]==='rel');const n = fitted.length||rec.enso.filter(a => a[2] != null && rec.trend_anomaly.some(b => b[0] === a[0] && Number.isFinite(b[3]))).length; assert(pts.length === n, `${unitKey}: ${pts.length} observed points for ${n} matched years`); checked++;
      assertYieldPercent(Y, rec, med); }
    else { assert(pts.length === 0 && notes().includes('withheld') && notes().includes(`${s.n} years`), `${unitKey}: restricted source shows no points; the notes say so`);
      if (NEW) { assert(rec.obs === null && rec.trend_anomaly === null && notes().includes(catalog.sources[s.permission].permission.note), `${unitKey}: the shard withholds the observations and the notes name the reason`); assert(requests.some(q => q.includes(`records/${iso}/${rec.file}`)), `${unitKey}: the shard is read for the exposures and the weather`); }
      else assert(!requests.some(q => q.includes(`records/${iso}-`)), `${unitKey}: the observations file is never requested`); }
    const jointYield = rec.joint_regions?.find(j => j.variable === 'ly' && j.index === 'rel' && j.status === 'available' && j.target_year === p.harvest_year);
    assert(!!diamond === (rec.joint_regions ? !!jointYield : !!med), `${unitKey}: forecast diamond iff a matching outlook is available`);
    const resp = yieldResponse(units, s);
    if (resp && resp.pct != null) { assert(Y.querySelector('path[stroke="#111"]') && Y.querySelector('polygon[opacity=".09"]'), `${unitKey}: one curve and one band`); if (NEW && TR && tResp && tResp.se_eb != null) assert(TR.querySelector('polygon[opacity=".09"]'), `${unitKey}: the temperature line carries its band`); assert(notes().includes(`yield ${pct(resp.pct, 2)}`) && (!NEW || notes().includes(`own-data weight ${fmt(resp.weight, 2)}`)), `${unitKey}: fit in the notes`); checked++; }
    else if (resp) assert(Y.textContent.includes('withheld') && notes().includes('pooling center'), `${unitKey}: withheld own estimate named`);
    assert(notes().includes('Growing window for harvest') && notes().includes(`${s.n} years ${s.first}–${s.last}`), `${unitKey}: years and dates in the notes`);
    assert(!notes().includes('prediction interval') && !Y.querySelector('svg').textContent.includes('Points:'), `${unitKey}: no interval misnamed, no coverage line on the chart`);
    // the year axis
    await go(`#/${iso}/${encodeURIComponent(unitKey)}?crop=${crop}&season=${season}&axis=year`);
    assert(document.querySelector('[data-regional-axis=year]').getAttribute('aria-pressed') === 'true' && yieldRow().querySelector('svg').textContent.includes('Harvest year'), `${unitKey}: year axis`);
    if (isPublic(s)) { assert(yieldRow().querySelectorAll('circle.pt').length === rec.trend_anomaly.filter(a => Number.isFinite(a[3])).length, `${unitKey}: every observed percentage in year mode`); assertYieldPercent(yieldRow(), rec, med,'year'); }
    assert(!yieldRow().querySelector('path[stroke="#111"]'), `${unitKey}: no ENSO curve in year mode`);
    // the state page from the breadcrumb
    const regionKey = u.region_key; const t4 = await go(`#/${iso}/${encodeURIComponent(regionKey)}?crop=${crop}&season=${season}`);
    const sr = stateRecordOf(iso, regionKey, crop, season);
    assert(document.querySelector('h1').textContent.startsWith(`${regionName}`) && t4.includes(sr ? 'State average' : 'state-level aggregate'), `${regionKey}: state page`);
    const sm = regionMedium(iso, regionKey, crop, season, p.harvest_year);
    const stateLabels = sectionRows().map(r => r.querySelector('.label').firstChild.textContent);
    if (sr) {
      // the state average: yield, temperature and rainfall rows from the state record, the points against its series
      assert(!(sr.weather_history || []).some(h => h[3] != null) || stateLabels.includes('Greenness'), `${regionKey}: a state with a greenness history shows the row`);
      assert(stateLabels.includes('Yield') && (!(sr.weather_history || []).some(h => h[1] != null) || stateLabels.includes('Temperature')) && (!(sr.weather_history || []).some(h => h[2] != null) || stateLabels.includes('Rainfall')), `${regionKey}: state rows ${stateLabels}`);
      const ly = sr.responses.find(x => x.variable === 'ly' && x.index === 'rel');
      assert(!!yieldRow().querySelector('path[stroke="#111"]') === !!(RECONCILED?sr.yield_response_components?.length:ly && ly.pct_eb != null), `${regionKey}: the release's aggregate response curve is drawn when available`);
      assert(notes().includes(`State average: the mean yield of the ${sr.n_units} reporting units`), `${regionKey}: the notes name the average`);
      await go(`#/${iso}/${encodeURIComponent(regionKey)}?crop=${crop}&season=${season}&axis=year`);
      assert(yieldRow().querySelectorAll('circle.pt:not(.open)').length === sr.trend_anomaly.filter(a => Number.isFinite(a[3])).length, `${regionKey}: state points for every observed percentage`);
      assertYieldPercent(yieldRow(), sr, sm ? {pct: sm.pct_mean, lo: sm.pct_lo, hi: sm.pct_hi} : null, 'year');
      const TRs = rowByLabel('Temperature'); if (TRs) assert(TRs.querySelectorAll('circle.pt:not(.open)').length === sr.weather_history.filter(h => h[1] != null).length, `${regionKey}: state temperature history points`);
      await go(`#/${iso}/${encodeURIComponent(regionKey)}?crop=${crop}&season=${season}`); checked += 2;
    } else assert(stateLabels.join() === 'Yield', `${regionKey}: without a state record the state page shows the yield row only`);
    if (sm) { const sy = numsOf(yieldRow()); assert(sy[0].v === pct(sm.pct_mean) && notes().includes(`${pct(sm.pct_lo)} to ${pct(sm.pct_hi)}`), `${regionKey}: state outlook ${sy[0].v} vs ${pct(sm.pct_mean)}`); checked++; }
  }
  await go('#/USA/USA%3A19%3A1?crop=maize&season=main&layer=progress');
  feats = await ready('cmap');
  const localLegend = document.querySelector('.harvest-legend');
  assert(Number(localLegend.dataset.harvestMin) === AtlasCalendar.day('2026-04-11') && Number(localLegend.dataset.harvestToday) === AtlasCalendar.day('2026-10-11') && Number(localLegend.dataset.harvestMax) === AtlasCalendar.day('2027-04-11'), 'local date scale matches the world scale and remains centered on today');
  assert(document.querySelector('.regional-map-key').contains(localLegend) && !document.querySelector('.local-map .legend'), 'map key above map, calendar space below reserved');
  assert(!maps.cmap.layers['sel-fill'] && maps.cmap.layers['sel-line'].paint['line-width'] > maps.cmap.layers['national-line'].paint['line-width'], 'selected boundary is thick and does not replace harvest-date fill');
  assert(!maps.cmap.dragPan.disabled && maps.cmap.scrollZoom.disabled, 'local maps permit dragging without scroll zoom');
  const previousMap = maps.cmap;
  previousMap.jumpTo({center:[-92.7,41.4],zoom:6.25});
  const neighbor = feats.find(f => f.id !== 'USA:19:1' && f.properties.reporting && (!f.properties.country || f.properties.country === 'USA') && f.properties.level !== 'national');
  const stableView = {center:previousMap.getCenter().toArray(),zoom:previousMap.getZoom()};
  previousMap.events.click({features:[neighbor]});
  await handlers.hashchange(); await ready('cmap');
  assert(JSON.stringify(maps.cmap.camera) === JSON.stringify(stableView), 'clicking another unit preserves the panned map center and zoom');
  assert(maps.cmap.sources.u.data.features.some(f=>f.id === neighbor.id && f.properties.selected), 'the new selection is highlighted without moving the camera');
  // 4. A national-only country opens its page directly (the first such country with a maize panel, by ISO3).
  const natIso = Object.keys(catalog.countries).sort().find(iso => { const ks = catalog.countries[iso].panels.filter(k => panels.get(k)?.crop_family === 'maize'); return ks.length && ks.every(k => (panels.get(k).n_series || 0) <= 1); });
  const natName = catalog.countries[natIso].name, natPanel = panels.get(catalog.countries[natIso].panels.find(k => panels.get(k)?.crop_family === 'maize'));
  await go(`#/${natIso}?crop=maize`);
  assert(new RegExp(`World.*${natName}`).test(document.querySelector('.crumbs').textContent) && document.querySelector('.regional-page'), `${natIso}: direct page`);
  assert(document.querySelector('h1').textContent.startsWith(`${natName}`) && yieldRow() && !rowByLabel('Greenness'), `${natIso}: national unit page`);
  if (natPanel?.pct != null) { assert(numsOf(yieldRow())[0].v === pct(natPanel.pct), `${natIso}: national outlook`); checked++; }
  const nationalSupplement = path.join(ROOT, 'data/national-weather', release);
  if (fs.existsSync(path.join(nationalSupplement, 'SRB.json'))) {
    for (const iso of ['SRB', 'RUS']) {
      const units = unitsOf(iso, 'maize'), s = units.units[iso].series.find(s => s.crop_code === 'maize');
      const extra = JSON.parse(fs.readFileSync(path.join(nationalSupplement, `${iso}.json`))).series[s.id];
      const record = recordOf(iso, 'maize', iso, s);
      await go(`#/${iso}/${iso}?crop=maize&season=${encodeURIComponent(s.season)}`);
      for (const [label, col] of [['Temperature', 1], ['Rainfall', 2]]) {
        const expected = extra.weather_history.filter(a => a[col] != null && record.enso.some(e => e[0] === a[0] && e[2] != null));
        const row = rowByLabel(label); assert(row && row.querySelectorAll('circle.pt:not(.open)').length === expected.length, `${iso}: national ${label} history against matching ENSO years`);
        assert(!row.querySelector('polygon.pt') && !row.querySelector('path[stroke="#111"]'), `${iso}: historical supplement does not invent a weather forecast or fitted response`);
        const point = row.querySelector('circle.pt'); const year = Number(point.getAttribute('data-year'));
        const source = expected.find(a => a[0] === year);
        assert(point.querySelector('title').textContent.includes(fmt(source[col], col === 1 ? 2 : 0, true)), `${iso}: weather tooltip equals supplement`);
      }
      assert(notes().includes(extra.context.rainfall_source) && notes().includes('Historical context only'), `${iso}: national source and scope disclosed`);
      await go(`#/${iso}/${iso}?crop=maize&season=${encodeURIComponent(s.season)}&axis=year`);
      assert(rowByLabel('Temperature').querySelectorAll('circle.pt').length === extra.weather_history.filter(a => a[1] != null).length, `${iso}: all available national temperature years in History`);
      assert(!maps.cmap.layers['sel-fill'] && maps.cmap.layers['sel-line'], `${iso}: selection preserves the data fill`);
    }
  }
  if (NEW && catalog.countries.CHN) {
    await go('#/CHN/CHN?crop=maize&season=Annual&mask=crop');
    const china=await ready('cmap'), national=china.find(f=>f.id==='CHN');
    const counties=china.filter(f=>f.properties.country==='CHN'&&f.properties.level!=='national');
    assert(national.properties.reporting && !national.properties.outlineOnly && national.properties.color!=='#eef0ee' && national.properties.color!==NONE, 'China national estimate remains colored even when old county geometry exists');
    assert(counties.length>1900 && counties.every(f=>f.properties.outlineOnly&&!f.properties.reporting), 'nonmatching China county records supply outlines without covering or impersonating the national estimate');
    assert(JSON.stringify(maps.cmap.layers['u-fill'].filter).includes('outlineOnly') && text().includes('national estimate'), 'national map is labeled and excludes outline-only polygon fills');
  }
  // 5. Old links resolve; the URL carries the state; unknown release is explicit.
  await go('#/season/USA/USA:19:1?crop=maize&season=main'); assert(document.querySelector('h1').textContent.startsWith('Adair, Iowa'), 'old season link');
  await go('#/record/USA?crop=maize&season=main'); assert(document.getElementById('cmap'), 'old record link');
  await go('#/about'); assert(document.getElementById('wmap') && document.getElementById('methods'), 'old about link');
  await go('#/USA?crop=maize&season=main&layer=planting&date=2026-12-31&harvest=2027'); await ready('cmap');
  const adair = maps.cmap.sources.u.data.features.find(f => f.id === 'USA:19:1'); maps.cmap.events.click({features: [{...adair, id: 0, properties: adair.properties}]}); const href = location.hash;
  for (const k of ['crop=maize', 'season=main', 'layer=planting', 'date=2026-12-31', 'harvest=2027', ...(release === releases.default ? [] : [`release=${release}`])]) assert(href.includes(k), `URL carries ${k}: ${href}`);
  assert(document.querySelector('h1').textContent.includes('harvest 2027'), 'target harvest from the URL');
  // A place opened from a map starts on the ENSO axis whatever the previous page showed (10 October 2026, evening).
  await go('#/USA?crop=maize&season=main&axis=year'); await ready('cmap');
  const adair2 = maps.cmap.sources.u.data.features.find(f => f.id === 'USA:19:1'); maps.cmap.events.click({features: [{...adair2, id: 0, properties: adair2.properties}]});
  assert(!location.hash.includes('axis='), `a map click drops the axis choice: ${location.hash}`);
  location.hash = '#/USA?release=1999-01-01'; await handlers.hashchange(); await new Promise(r => setTimeout(r, 0)); assert(text().includes('Unknown release 1999-01-01'), 'unknown release message');
  await go('#/?crop=rice'); assert(document.getElementById('crop-sel').value === 'rice' && text().includes('No rice records'), 'crop selection and legend words follow the crop');
  // 5c. The cropped-land mask (11 October 2026): off by default; ticked, a paper raster sits above the unit fills and below
  // the outlines on the country and place maps, an image in the world plane does the same on the world map, the legend
  // and the credit say so, and the setting rides in mask=crop through the links from the world map down to a place.
  if (NEW) {
    const rend = (f, i) => ({...f, id: i, properties: f.properties});   // a rendered feature as MapLibre delivers it (see 5b)
    await go('#/?crop=maize'); await ready('wmap'); assert(document.getElementById('mask-chk') && !document.getElementById('mask-chk').hasAttribute('checked') && !maps.wmap.sources.cropmask && !maps.wmap.layers['crop-mask'], 'mask: off by default, no raster');
    await go('#/?crop=maize&mask=crop'); await ready('wmap');
    assert(document.getElementById('mask-chk').hasAttribute('checked') && maps.wmap.sources.cropmask?.type === 'image' && maps.wmap.sources.cropmask.url.includes('static/cropgrids/world/maize.png') && maps.wmap.sources.cropmask.coordinates.length === 4 && maps.wmap.layers['crop-mask'], 'world map: the mask image pinned to the box');
    { const ks = Object.keys(maps.wmap.layers); assert(ks.indexOf('u-fill') < ks.indexOf('crop-mask') && ks.indexOf('crop-mask') < ks.indexOf('u-line'), 'world map: the mask between the fills and the outlines'); }
    assert(text().includes('Land with 5% or less of its area in maize') && text().includes('colours on cropped land only'), 'world map: the legend swatch and the credit clause');
    { const bra = maps.wmap.sources.u.data.features.find(f => f.id === 'BRA'); maps.wmap.events.click({features: [rend(bra, 0)]}); assert(location.hash.startsWith('#/BRA?') && location.hash.includes('mask=crop'), `world click carries the mask: ${location.hash}`); }
    await go('#/USA?crop=maize&season=main&mask=crop'); await ready('cmap');
    assert(maps.cmap.sources.cropmask?.type === 'raster' && maps.cmap.sources.cropmask.tiles[0].includes('static/cropgrids/mask/maize/') && maps.cmap.layers['crop-mask'] && maps.cmap.layers['u-fill'].paint['fill-opacity'] === 0.95, 'country map: the mask tiles over opaque fills');
    { const ks = Object.keys(maps.cmap.layers); assert(ks.indexOf('u-fill') < ks.indexOf('crop-mask') && ks.indexOf('crop-mask') < ks.indexOf('u-line'), 'country map: the mask between the fills and the outlines'); }
    assert(text().includes('Land with 5% or less of its area in maize') && text().includes('colours on cropped land only'), 'country map: the legend swatch and the credit clause');
    { const adairF = maps.cmap.sources.u.data.features.find(f => f.id === 'USA:19:1'); maps.cmap.events.click({features: [rend(adairF, 0)]}); assert(location.hash.includes('mask=crop') && decodeURIComponent(location.hash).startsWith('#/USA/USA:19'), `unit click carries the mask (to the state of a big country): ${location.hash}`); }
    await go('#/USA?crop=maize&season=main&layer=progress&mask=crop'); await ready('cmap'); assert(maps.cmap.layers['crop-mask'] && text().includes('Outside crop mask'), 'calendar layer: masked too');
    await go('#/USA/USA:19:1?crop=maize&season=main&mask=crop'); await ready('cmap'); assert(maps.cmap.sources.cropmask?.type === 'raster' && maps.cmap.layers['crop-mask'], 'place map: the mask tiles');
    const adairU = unitsOf('USA', 'maize').units['USA:19:1']; if (adairU.crop_area && adairU.crop_area.maize) assert(notes().includes('CROPGRIDS 2020') && notes().includes(`${Math.round(adairU.crop_area.maize[0]).toLocaleString('en-US')} ha of maize`), 'place notes: the crop area');
    await go('#/USA/USA:19:1?crop=maize&season=main'); await ready('cmap'); assert(!maps.cmap.sources.cropmask && !maps.cmap.layers['crop-mask'], 'place map: no mask when the box is clear');
    // no wash over the units outside a state, with or without the mask (the user's rule of 11 October 2026, afternoon)
    await go('#/USA/USA:19?crop=maize&season=main&mask=crop'); await ready('cmap'); assert(maps.cmap.layers['crop-mask'] && !maps.cmap.layers['dim-fill'] && !maps.cmap.sources.u.data.features.some(f => 'dim' in f.properties), 'state page with the mask: no wash');
    await go('#/USA/USA:19?crop=maize&season=main'); await ready('cmap'); assert(!maps.cmap.layers['crop-mask'] && !maps.cmap.layers['dim-fill'], 'state page without the mask: no wash either');
    if (fs.existsSync(path.join(ROOT, 'data/static/cropgrids/manifest.json'))) { const tm = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/static/cropgrids/manifest.json'))); assert(tm.threshold === 0.05 && tm.families.maize.tiles > 100 && fs.existsSync(path.join(ROOT, 'data/static/cropgrids/mask/maize/0/0/0.png')) && fs.existsSync(path.join(ROOT, 'data/static/cropgrids/world/maize.png')), 'mask tiles and world image on disk'); }
  }
  // 5b. Map clicks as MapLibre delivers them (10 October 2026): a rendered feature carries a generated integer id, not
  // our string id, and on a country map the national polygon lies under every unit and reports too. The handlers must
  // open the country from the world map and the local unit, not the national page, from the country map.
  const rendered = (f, i) => ({...f, id: i, properties: f.properties});
  await go('#/?crop=maize'); await ready('wmap');
  const braWorld = maps.wmap.sources.u.data.features.find(f => f.id === 'BRA'); assert(braWorld, 'Brazil on the world map');
  maps.wmap.events.click({features: [rendered(braWorld, 0)]}); assert(location.hash.startsWith('#/BRA?'), `world click opens the country: ${location.hash}`);
  await handlers.hashchange(); await ready('cmap');
  const nat = maps.cmap.sources.u.data.features.find(f => f.id === 'BRA'), muni = maps.cmap.sources.u.data.features.find(f => f.id !== 'BRA' && f.properties.reporting);
  assert(nat && !nat.properties.reporting && nat.properties.color === '#eef0ee' && muni, 'the national polygon is drawn unfilled and not reporting where local units exist');
  maps.cmap.events.mousemove({features: [rendered(nat, 0), rendered(muni, 1)], point: {x: 10, y: 10}});
  assert(!document.querySelector('#cmap .tooltip').textContent.startsWith('Brazil'), 'hover names the municipality, not the country');
  maps.cmap.events.click({features: [rendered(nat, 0), rendered(muni, 1)]});
  const muniRegion = unitsOf('BRA', 'maize').units[muni.id].region_key;
  assert(decodeURIComponent(location.hash).startsWith(`#/BRA/${muniRegion}?`), `country click on a large country opens the state: ${location.hash}`);
  await handlers.hashchange(); await ready('cmap');
  const stateFeats = maps.cmap.sources.u.data.features; assert(stateFeats.filter(f => f.properties.member).length > 1 && stateFeats.filter(f => f.properties.member).every(f => unitsOf('BRA', 'maize').units[f.id].region_key === muniRegion) && stateFeats.some(f => !f.properties.member) && !stateFeats.some(f => f.properties.selected) && !maps.cmap.layers['dim-fill'], 'the local map keeps the state\'s units beside the rest, with no wash (11 October 2026)');
  const muni2 = stateFeats.find(f => f.id === muni.id); maps.cmap.events.click({features: [rendered(nat, 0), rendered(muni2, 1)]});
  assert(decodeURIComponent(location.hash).startsWith(`#/BRA/${muni.id}?`), `state click opens the unit: ${location.hash}`);
  // The world map draws the reporting units over the countries under the 2026-10-09 contract.
  if (NEW) { await go('#/?crop=maize'); await ready('wmap'); for (let i = 0; i < 400 && !maps.wmap.sources.wu; i++) await new Promise(r => setTimeout(r, 5)); assert(maps.wmap.sources.wu && maps.wmap.sources.wu.data.features.length > 1000 && maps.wmap.layers['wu-fill'], 'world map carries the units overlay');
    // The world map is cut at 130°W and 180°: the box, the sea frame along the bounding meridians, and the masks over the land beyond them.
    assert(maps.wmap.fit[0][0] === -130 && maps.wmap.fit[1][0] === 180 && maps.wmap.sources.frame && maps.wmap.sources.mask && maps.wmap.layers['mask-fill'], 'world map bounds, frame and masks');
    // A click on a reporting unit opens its country, whatever the country's size (the user's rule of 10 October 2026, evening).
    const wu = maps.wmap.sources.wu.data.features; const byCountry = {}; for (const f of wu) byCountry[f.properties.country] = (byCountry[f.properties.country] || 0) + 1;
    const small = wu.find(f => byCountry[f.properties.country] < 150), large = wu.find(f => byCountry[f.properties.country] >= 150);
    const click = maps.wmap.layered['click:wu-fill'];
    for (const f of [small, large]) { click({features: [{...f, id: 0, properties: f.properties}]}); assert(location.hash.startsWith(`#/${f.properties.country}?`) && !decodeURIComponent(location.hash).includes(f.properties.id), `world click on a unit opens its country: ${location.hash}`); }
    checked++; }
  // 6. The phone layout stacks the numbers under each chart; the calendar fixture, when present, backs the calendar test.
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert(/@media\(max-width:800px\)\{\.row\{grid-template-columns:1fr/.test(css) && /@media\(max-width:480px\)/.test(css), 'phone layout rules');
  assert(!requests.some(p => p.includes('..')), 'the site reads only its own folders');
  assert(!requests.some(p => p.includes('skill.json')), 'the skill file is not loaded until the yield details open');
  if (NEW) assert(!requests.some(p => p.includes('panels.json') || p.includes(`display/${release}/units`) || p.includes(`display/${release}/records`)), 'the candidate reads no panels.json or display shards');
  console.log(`PASS site ${release} (contract ${catalog.contract || '2026-10-08'}): first screen, world and country outlook and harvest-date maps, unit pages for ${CASES.length} cases with ${checked} displayed values against the files, restricted-source rule, national-only routing, old links and URL state${fixture ? ', calendar fixture' : ''}`);
})().catch(e => { console.error(e); process.exitCode = 1; });
