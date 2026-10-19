// The harvest-anomaly layer (18 October 2026) against an exported release, with the DOM implementation and the MapLibre
// stub of tests/site_ui.cjs: the layer option, the year control and timeline, the legend, the colour and words of a
// reporting unit on the world overlay and on the country and place maps against records/<ISO>/<unit>.json and
// anomalies/<family>.json, the national fill and its fallback series, the grey state for a year without a yield, the
// default year, a year change through the control, the buttons, the timeline and the back button, the mask, and that the
// family file is fetched once. Run: node tests/site_anomaly.cjs [release]
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
const releases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/releases.json')));
const release = process.argv[2] || releases.default, base = path.join(ROOT, 'data', release);
const location = {hostname: 'localhost', hash: release === releases.default ? '#/' : `#/?release=${release}`};
const requests = [];
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), vm.createContext({window, document, location, maplibregl, AtlasCalendar, URL, URLSearchParams, Response, console, encodeURIComponent, decodeURIComponent, setTimeout,
  fetch: async p => { requests.push(p); try { return new Response(fs.readFileSync(path.join(ROOT, p))); } catch { return new Response('', {status: 404}); } }}));
const J = f => JSON.parse(fs.readFileSync(path.join(base, f)));
const catalog = J('catalog.json');
if (!fs.existsSync(path.join(base, 'anomalies/index.json'))) { console.log(`SKIP site anomaly ${release}: no anomalies folder (release exported before the layer)`); process.exit(0); }
const rel = q => release === releases.default ? '' : `${q.includes('?') ? '&' : '?'}release=${release}`;
const view = () => document.getElementById('view');
const text = () => view().textContent.replace(/\s+/g, ' ');
const go = async hash => { location.hash = hash + rel(hash); await handlers.hashchange(); await new Promise(r => setTimeout(r, 0)); const t = text(); assert(!t.includes('Something did not load'), `${hash}: ${t.slice(0, 300)}`); return t; };
const ready = async id => { for (let i = 0; i < 400 && (!maps[id]?.sources.u || maps[id].removed); i++) await new Promise(r => setTimeout(r, 5)); assert(maps[id]?.sources.u && !maps[id].removed, `map ${id} loaded`); return maps[id].sources.u.data.features; };
const overlay = async () => { for (let i = 0; i < 400 && !maps.wmap.sources.wu; i++) await new Promise(r => setTimeout(r, 5)); assert(maps.wmap.sources.wu, 'world map carries the units overlay'); return maps.wmap.sources.wu.data.features; };
const fmt = (v, d = 1, sign = false) => (sign && v > 0 ? '+' : '') + Number(v).toFixed(d).replace('-', '−');
const pct = (v, d = 1) => fmt(v, d, true) + '%';
const NONE = '#fbfaf7', NOT_ESTIMATED = '#cfcec8', LIMIT = 30;
const PALETTE = ['#7f3b08', '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', '#006837'];
// The colour the page should give a value: the ramp of app.js recomputed here from the palette, so a wrong limit shows.
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; }
function colour(v) { const x = (Math.max(-1, Math.min(1, v / LIMIT)) + 1) / 2; const n = PALETTE.length - 1; const t = Math.max(0, Math.min(1, x)) * n; const i = Math.min(n - 1, Math.floor(t)); return mix(PALETTE[i], PALETTE[i + 1], t - i); }
// The file's row of a series in a year, read with the file's own encoding.
const index = J('anomalies/index.json');
const fileOf = fam => J(`anomalies/${fam}.json`);
const rowOf = (file, sid, year) => { const s = file.series[String(sid)]; if (!s) return null; const i = year - s[0]; return i >= 0 && s[1][i] != null ? {anomaly: s[1][i], yield: s[2][i], exposure: s[3][i]} : null; };
const words = (row, year) => `Yield ${pct(row.anomaly)} from trend, harvest ${year} · reported ${fmt(row.yield, 2)} t/ha, trend ${fmt(row.yield / (1 + row.anomaly / 100), 2)} t/ha${row.exposure != null ? ` · growing-season relative Niño 3.4 ${fmt(row.exposure, 2, true)} °C` : ''}`;
(async () => {
  await handlers.DOMContentLoaded(); await new Promise(r => setTimeout(r, 0));
  let checked = 0;
  const maize = fileOf('maize');
  // 1. The test place: Free State (ZAF:ZA1994A104), Summer maize, 2015, a year the record shard carries; and the year range.
  const unitKey = 'ZAF:ZA1994A104', iso = 'ZAF', year = 2015;
  const units = J(`units/${iso}.json`); const s = units.units[unitKey].series.find(x => x.crop_family === 'maize' && x.season === 'Summer'); assert(s, 'Free State has a Summer maize series');
  const idx = J(`records/${iso}/index.json`); const shard = J(`records/${iso}/${idx.units[unitKey][0]}`); const rec = shard.series[s.id];
  const ta = rec.trend_anomaly.find(a => a[0] === year); assert(ta, `the record has a ${year} anomaly`);
  const row = rowOf(maize, s.id, year); assert(row, 'the family file carries the series in that year');
  assert.equal(row.anomaly, Math.round(ta[3] * 100) / 100, 'the file anomaly is the record anomaly at two decimals'); assert.equal(row.yield, Math.round(ta[1] * 1000) / 1000, 'the file yield is the reported yield at three decimals');
  const expo = rec.enso.find(a => a[0] === year); if (expo && expo[2] != null) assert.equal(row.exposure, Math.round(expo[2] * 100) / 100, 'the file exposure is the record exposure at two decimals');
  const [first, last] = index.years.maize;
  // 2. The world map on the layer: the option, the control, the timeline, the legend, the title and the credit.
  await go(`#/?layer=anomaly&year=${year}&crop=maize`); let feats = await ready('wmap');
  assert.deepEqual([...document.querySelectorAll('#layer-sel option')].map(o => o.textContent), ['Outlook', 'Harvest anomaly by year', 'Crop calendar'], 'the layer is offered on the world map');
  assert.equal(document.querySelector('#layer-sel option[selected]').value, 'anomaly');
  const ys = document.getElementById('year-sel'); assert(ys && ys.getAttribute('min') === String(first) && ys.getAttribute('max') === String(last) && ys.getAttribute('value') === String(year) && document.getElementById('year-out').textContent === String(year), 'the year control over the family\'s years at the requested year');
  assert(document.getElementById('year-prev') && document.getElementById('year-next') && document.getElementById('date-label').hasAttribute('hidden'), 'step buttons; the date control stays hidden');
  const tl = document.querySelector('.controls .year-timeline svg'); assert(tl, 'the timeline sits inside the controls');
  const hits = [...tl.querySelectorAll('rect[data-timeline-year]')]; assert.equal(hits.length, last - first + 1, 'one clickable year per year of the range');
  const djfYears = Object.entries(index.djf_relative_n34).filter(([y, v]) => v != null && Number(y) >= first && Number(y) <= last); assert(tl.querySelectorAll('rect:not([data-timeline-year])').length === djfYears.length, 'one bar per year with a December–February index'); assert(tl.querySelector('polyline') && tl.querySelector('.year-mark'), 'the coverage line and the year marker');
  const kids = [...view().children]; assert(kids[0].tagName === 'H1' && kids[0].textContent === `Maize harvests of ${year} against trend` && kids[1].classList.contains('controls') && kids[2].classList.contains('legend') && kids[3].id === 'wmap', 'title, controls, legend, map in that order');
  const legend = kids[2].textContent; assert(/Harvest anomaly/.test(legend) && legend.includes(`yield (%) from the series' fitted trend, harvest ${year}`) && legend.includes('≤ −30') && legend.includes('≥ +30 %') && legend.includes(`No reported yield for ${year}`) && legend.includes('No maize records') && kids[2].querySelectorAll('svg line').length === 5, `the anomaly legend: ${legend}`);
  assert(!/interval includes zero/.test(legend), 'no hatch key on an observation layer');
  assert(text().includes(`harvest ${year}: ${Number(index.counts_world.maize[year]).toLocaleString('en-US')} series with a reported yield`), 'the credit counts the drawn series');
  assert(document.getElementById('anomaly') && /Harvest anomaly by year/.test(text()) && /no model enters them/.test(text()) && /saturate at ±30 percent/.test(text()), 'the methods paragraph');
  // 3. The national fills: a country whose panel has a national series, one with the family fallback (named in the words), one with no value that year, and one without records.
  const zaf = feats.find(f => f.id === iso); const natZaf = maize.national[iso]; assert(natZaf, 'South Africa has a national maize series');
  const rowZaf = rowOf(maize, natZaf[0], year); assert(rowZaf && zaf.properties.color === colour(rowZaf.anomaly) && zaf.properties.words === words(rowZaf, year) && /national series/.test(zaf.properties.series), `the national fill of South Africa: ${zaf.properties.words}`); checked++;
  const fallback = Object.entries(maize.national).find(([c, n]) => n[2] === 'Annual' && feats.find(f => f.id === c) && J('world.json').panels.some(p => p[0] === `${c}|${n[1]}|main`));
  if (fallback) { const f = feats.find(x => x.id === fallback[0]); assert(f.properties.series.includes('annual record') && f.properties.series.includes('national series'), `the fallback series is named: ${f.properties.series}`); checked++; }
  const noYear = Object.entries(maize.national).map(([c, n]) => [c, rowOf(maize, n[0], year)]).find(([c, r]) => !r && feats.find(f => f.id === c));
  if (noYear) { const f = feats.find(x => x.id === noYear[0]); assert(f.properties.color === NOT_ESTIMATED && f.properties.words === `No reported national yield for harvest ${year}`, `grey without a value: ${noYear[0]} ${f.properties.words}`); checked++; }
  const noMaize = feats.find(f => catalog.countries[f.id] && !Object.keys(catalog.countries[f.id].crops || {}).some(c => catalog.crops[c]?.family === 'maize'));
  if (noMaize) assert(noMaize.properties.color === NONE && noMaize.properties.words === 'No maize records', 'a country without maize records');
  assert(feats.every(f => f.properties.color && f.properties.words && !f.properties.zeroConsistent), 'every country has a colour and words and none is hatched');
  // 4. The overlay: Free State takes the record's value, no unit is hatched, and a unit without the year is not drawn.
  let wu = await overlay(); const fs1 = wu.find(f => f.properties.id === unitKey || f.id === unitKey); assert(fs1, 'Free State on the world overlay');
  assert(fs1.properties.color === colour(row.anomaly) && fs1.properties.words === words(row, year), `Free State words: ${fs1.properties.words}`); checked++;
  assert(fs1.properties.words.includes(pct(ta[3])) && fs1.properties.words.includes(`${fmt(ta[1], 2)} t/ha`) && fs1.properties.words.includes(`trend ${fmt(ta[2], 2)} t/ha`), 'the words carry the record\'s anomaly, reported and trend yields');
  assert(wu.every(f => f.properties.zeroConsistent === false) && maps.wmap.layers['wu-fill'], 'no hatching on the overlay');
  const drawnUnits = Object.entries(maize.units).filter(([k, v]) => rowOf(maize, v[0], year)).length;
  assert(wu.length <= drawnUnits && wu.length > 0.8 * drawnUnits, `the overlay draws the units with a value in ${year} (${wu.length} of ${drawnUnits} with a value)`);
  assert(fs1.properties.series === `${catalog.crops[maize.units[unitKey][1]].label.charAt(0).toUpperCase() + catalog.crops[maize.units[unitKey][1]].label.slice(1)}, ${maize.units[unitKey][2]} season`, `the unit's series is named: ${fs1.properties.series}`);
  // 4b. A unit with records but no current outlook (19 October 2026): absent from world_units.json, drawn from the family file.
  const wuFile = J('world_units.json'); const wheat = fileOf('wheat');
  const extra = Object.entries(wheat.units).find(([k, v]) => !wuFile.units.wheat?.[k] && rowOf(wheat, v[0], 2000)); assert(extra, 'a wheat unit without an outlook has a value in 2000');
  await go('#/?layer=anomaly&year=2000&crop=wheat'); await ready('wmap'); const wuW = await overlay(); const fx = wuW.find(f => f.properties.id === extra[0] || f.id === extra[0]);
  const rowX = rowOf(wheat, extra[1][0], 2000); assert(fx && fx.properties.color === colour(rowX.anomaly) && fx.properties.words === words(rowX, 2000), `${extra[0]} is drawn from the wheat file although world_units.json omits it`); checked++;
  if (wheat.units['AUS:154:']) assert(wuW.find(f => f.properties.id === 'AUS:154:' || f.id === 'AUS:154:'), 'New South Wales wheat is on the world map for 2000');
  const tip = maps.wmap.layered['mousemove:wu-fill']; assert(tip, 'overlay tooltip handler');
  tip({features: [{...fs1, id: 0, properties: fs1.properties}], point: {x: 10, y: 10}}); assert(document.querySelector('#wmap .tooltip').textContent.startsWith('Free State, South Africa') && document.querySelector('#wmap .tooltip').textContent.includes(words(row, year).replace(/<[^>]+>/g, '')), 'overlay tooltip names the place and the words');
  // 5. A year before the series starts: Free State is not drawn and the slider stands at the year; the earliest year is reachable.
  await go(`#/?layer=anomaly&year=${s.first - 1}&crop=maize`); feats = await ready('wmap'); wu = await overlay();
  assert(!wu.find(f => f.properties.id === unitKey) && document.getElementById('year-out').textContent === String(s.first - 1), 'a unit without a yield that year is left undrawn');
  // 6. The default year and an out-of-range year.
  await go('#/?layer=anomaly&crop=rice'); await ready('wmap'); assert.equal(document.getElementById('year-sel').getAttribute('value'), String(index.default_year.rice), 'the default year of rice');
  await go('#/?layer=anomaly&crop=maize&year=1800'); await ready('wmap'); assert.equal(document.getElementById('year-sel').getAttribute('value'), String(index.default_year.maize), 'an out-of-range year falls back to the default');
  // 7. The control: the slider, the buttons, the timeline and the back button all travel through the year parameter.
  await go(`#/?layer=anomaly&year=${year}&crop=maize`); await ready('wmap');
  const slider = document.getElementById('year-sel'); slider.value = String(year + 1); slider.oninput(); assert.equal(document.getElementById('year-out').textContent, String(year + 1), 'the output follows the slider while dragging');
  slider.onchange(); assert(location.hash.includes(`year=${year + 1}`) && location.hash.includes('layer=anomaly') && location.hash.includes('crop=maize'), `the slider changes the year in the URL: ${location.hash}`);
  await handlers.hashchange(); await ready('wmap'); assert.equal(document.getElementById('year-out').textContent, String(year + 1));
  document.getElementById('year-next').onclick(); await handlers.hashchange(); await ready('wmap'); assert(location.hash.includes(`year=${year + 2}`) && document.getElementById('year-out').textContent === String(year + 2), 'next steps a year');
  document.getElementById('year-prev').onclick(); await handlers.hashchange(); await ready('wmap'); assert(location.hash.includes(`year=${year + 1}`), 'previous steps back');
  document.querySelector(`[data-timeline-year="${year - 5}"]`).onclick(); await handlers.hashchange(); await ready('wmap'); assert(location.hash.includes(`year=${year - 5}`) && document.getElementById('year-out').textContent === String(year - 5), 'a click on the timeline selects the year');
  location.hash = `#/?layer=anomaly&year=${year + 1}&crop=maize` + rel('?'); await handlers.hashchange(); await ready('wmap'); assert.equal(document.getElementById('year-out').textContent, String(year + 1), 'the back button restores an earlier year');
  await go(`#/?layer=anomaly&year=${last}&crop=maize`); await ready('wmap'); assert(document.getElementById('year-next').hasAttribute('disabled') && !document.getElementById('year-prev').hasAttribute('disabled'), 'next is disabled at the last year');
  // 8. The mask rides along and the legend shows its swatch.
  await go(`#/?layer=anomaly&year=${year}&crop=maize&mask=crop`); await ready('wmap'); assert(maps.wmap.sources.cropmask?.type === 'image' && maps.wmap.layers['crop-mask'] && text().includes('Land with 5% or less of its area in maize'), 'the mask on the anomaly layer');
  { const z = maps.wmap.sources.u.data.features.find(f => f.id === iso); maps.wmap.events.click({features: [{...z, id: 0, properties: z.properties}]}); assert(location.hash.startsWith(`#/${iso}?`) && location.hash.includes(`year=${year}`) && location.hash.includes('layer=anomaly') && location.hash.includes('mask=crop'), `a click opens the country with the year: ${location.hash}`); }
  // 9. The country map: the units take the record values, the national polygon is unfilled, the year control and legend are there.
  await handlers.hashchange(); let cfeats = await ready('cmap');
  assert(document.querySelector('h1').textContent.includes(`harvest ${year}`) && document.getElementById('year-sel') && /Harvest anomaly/.test(view().querySelector('.legend').textContent), 'country page title, control and legend');
  const fsC = cfeats.find(f => f.id === unitKey); assert(fsC && fsC.properties.color === colour(row.anomaly) && fsC.properties.words === words(row, year) && fsC.properties.reporting, `Free State on the country map: ${fsC?.properties.words}`); checked++;
  const natC = cfeats.find(f => f.id === iso); assert(natC && natC.properties.color === '#eef0ee' && !natC.properties.reporting, 'the national polygon is unfilled under the units');
  assert(text().includes(`national series ${pct(rowZaf.anomaly)} from trend in ${year}`) || text().includes('no national series for this crop and season') || text().includes('no reported national yield'), 'the credit names the national series');
  assert(cfeats.filter(f => f.id !== iso).every(f => !f.properties.zeroConsistent), 'no hatching on the country map');
  // 10. A year without the unit's yield on the country map: grey with the words, still a record.
  await go(`#/${iso}?crop=maize&season=Summer&layer=anomaly&year=${s.first - 1}`); cfeats = await ready('cmap');
  const fsG = cfeats.find(f => f.id === unitKey); assert(fsG.properties.color === NOT_ESTIMATED && fsG.properties.words === `No reported yield for harvest ${s.first - 1} · records ${s.first}–${s.last}` && fsG.properties.reporting, `grey for a missing year: ${fsG.properties.words}`); checked++;
  // 10b. A country whose panel is a national annual record beside local main-season series (China, wheat, 19 October 2026):
  // the counties are coloured from the file by their series of the family and the national polygon is unfilled.
  if (fs.existsSync(path.join(base, 'units/CHN.json')) && fs.existsSync(path.join(base, 'geometry/CHN.json'))) {
    const wheatFile = fileOf('wheat'); const chn = J('units/CHN.json');
    const county = Object.entries(chn.units).find(([k, u]) => u.level !== 'national' && u.series.some(x => x.crop_family === 'wheat' && x.season !== 'Annual' && rowOf(wheatFile, x.id, 1999)));
    if (county) {
      await go('#/CHN?crop=wheat&season=Annual&layer=anomaly&year=1999'); cfeats = await ready('cmap');
      const fc = cfeats.find(f => f.id === county[0]); const alt = county[1].series.filter(x => x.crop_family === 'wheat').sort((a, b) => Number(b.crop_code === 'wheat') - Number(a.crop_code === 'wheat') || a.tier - b.tier || (b.n || 0) - (a.n || 0))[0];
      const rowC = rowOf(wheatFile, alt.id, 1999);
      assert(fc && fc.properties.reporting && fc.properties.color === (rowC ? colour(rowC.anomaly) : NOT_ESTIMATED), `a Chinese county is coloured by its own wheat series under the national annual panel: ${fc?.properties.words}`); checked++;
      assert(cfeats.find(f => f.id === 'CHN').properties.color === '#eef0ee', 'the national polygon is unfilled under the counties');
      assert(fc.properties.crop_code === alt.crop_code && fc.properties.season === alt.season, 'a click opens the county with its own crop and season');
    }
  }
  // 11. The place page: the map takes the layer, the year control sits in the map key, the legend follows, and the charts are untouched.
  await go(`#/${iso}/${encodeURIComponent(unitKey)}?crop=maize&season=Summer&layer=anomaly&year=${year}`); cfeats = await ready('cmap');
  const fsP = cfeats.find(f => f.id === unitKey); assert(fsP && fsP.properties.color === colour(row.anomaly) && fsP.properties.selected, 'the place is coloured by its anomaly and outlined');
  assert(document.querySelector('.regional-map-key #year-sel') && document.querySelector('.regional-map-key #layer-sel option[selected]').value === 'anomaly' && /Harvest anomaly/.test(document.querySelector('.regional-map-key .legend').textContent), 'the place page carries the year control and legend in the map key');
  assert(document.querySelector('.regional-page') && document.querySelectorAll('section.row').length >= 1, 'the rows are drawn');
  document.querySelector('.regional-map-key #year-next').onclick(); assert(location.hash.includes(`year=${year + 1}`) && decodeURIComponent(location.hash).startsWith(`#/${iso}/${unitKey}`), `the place page keeps its place on a year change: ${location.hash}`);
  // 12. One fetch of the family file and of the index for the whole run.
  assert.equal(requests.filter(p => p.endsWith('anomalies/maize.json')).length, 1, 'the maize file is fetched once');
  assert.equal(requests.filter(p => p.endsWith('anomalies/wheat.json')).length, 1, 'the wheat file is fetched once');
  assert.equal(requests.filter(p => p.endsWith('anomalies/index.json')).length, 1, 'the index is fetched once');
  assert(!requests.some(p => p.includes('..')), 'the site reads only its own folders');
  console.log(`PASS site anomaly ${release}: layer option, year control and timeline, legend, national fills, overlay with units beyond the outlook, country and place maps, ${checked} displayed values against the files`);
})().catch(e => { console.error(e); process.exitCode = 1; });
