/* ENSO crop atlas, pilot interface of 9 October 2026: one path from the world map to a country map to a unit page.
   The page draws what scripts/export_release.py wrote under data/<release>/. Saved local slopes and production
   weights define regional display curves; fitted outlook totals and intervals remain the exported values.
   The page does not refit models. It checks whether an exported 80% outlook interval includes zero and uses calendar.js
   for date arithmetic. Two release contracts are read: 2026-10-08 (panels.json, display/<release>/ shards and
   fixtures/world_calendar_<release>.json) and 2026-10-09 (world.json panel rows, calendar_world.json,
   countries/<ISO>.json aggregates, units/<ISO>.json leaf rows, records/<ISO>/<unit>.json shards). The adapters in
   the "data access" section put both into one shape; the render code reads that shape only. Routes:
   #/                      the world map            ?crop=&season=&layer=&date=&harvest=&axis=&index=&release=
   #/<ISO3>                the country map, or the national unit page when the country reports nationally only
   #/<ISO3>/<unit or region key>   the detail page: the rows temperature, rainfall and yield sharing one axis (a row with nothing to show is left out)
   Links of the 8 October application (#/season|response|record/...) resolve to the same places. */
(() => {
const NEW = '2026-10-09';                       // the contract of calendar_world.json, response_leaf and aggregate rows
const FAMILY_LABEL = {maize: 'Maize', rice: 'Rice', wheat: 'Wheat', soybean: 'Soybean', sorghum: 'Sorghum', cassava: 'Cassava'};
const LAYERS = [['outlook', 'Outlook'], ['anomaly', 'Harvest anomaly by year'], ['progress', 'Crop calendar']];
// The cropped-land mask (11 October 2026, in place of the Cropped area layer of the same morning): when the reader ticks the
// box, a paper-coloured raster covers the land where the CROPGRIDS 2020 harvested share of the crop family is at or below
// MASK_THRESHOLD percent, above the unit fills and below the outlines, so the colours of every layer show only where the
// crop is grown. The tiles and the world image are built by scripts/build_crop_tiles.py under data/static/cropgrids and
// served with the data; the setting travels in the mask=crop query parameter through every link.
const MASK_THRESHOLD = 5;
const MASK_TILES = fam => dataURL(`data/static/cropgrids/mask/${fam}/{z}/{x}/{y}.png`);
const MASK_WORLD = fam => dataURL(`data/static/cropgrids/world/${fam}.png`);
const maskOn = r => r.q.get('mask') === 'crop';
const maskSwatch = fam => [['#fbfaf7', `Land with ${MASK_THRESHOLD}% or less of its area in ${FAMILY_LABEL[fam].toLowerCase()} (CROPGRIDS 2020)`]];
const maskWords = ` · colours on cropped land only (CROPGRIDS 2020, above ${MASK_THRESHOLD}% of the cell harvested)`;
// Sources whose observations may be shown as points under the 2026-10-08 contract, which carries no permissions
// table. The 2026-10-09 contract publishes display_points per series and the permission block per source in
// catalog.sources, and the list is not consulted.
const PUBLIC_SOURCES = new Set(['hultgren', 'faostat', 'nass', 'ibge', 'magyp', 'eurostat']);
const SOURCE_LABEL = {hultgren: 'Hultgren et al. replication data and agency extensions', hvstat: 'HarvestStat', faostat: 'FAOSTAT', nass: 'USDA NASS', ibge: 'IBGE', magyp: 'MAGyP', eurostat: 'Eurostat', destatis: 'Destatis'};
const WINDOW_LABEL = {user_pairs: 'documented local calendar (planting and harvest days)', riceatlas: 'RiceAtlas', user_windows: 'documented local calendar (months)', hultgren_median: 'median of the Hultgren calendars', giews: 'FAO GIEWS national calendar', fao_cc: 'FAO crop calendar', geoglam: 'GEOGLAM', ggcmi: 'GGCMI national calendar', hvstat_literature: 'HarvestStat literature calendar', hvstat_derived: 'HarvestStat calendar (the source\'s own season months)', asap: 'ASAP calendar', hvstat: 'HarvestStat calendar', conab_safrinha: 'CONAB calendar, second-crop (safrinha) window'};
const METHOD = {trend: 'Trend only', index_perfect: 'ENSO, future index known', index_todate: 'Index observed to date', index_outlook: 'ENSO outlook', weather_todate: 'Weather to date', index_hier: 'ENSO, hierarchical fit'};
const SCEN = {low: 'lower', medium: 'central', high: 'higher', observed: 'observed'};
// Colours. Orange to purple is the conditional outlook; brown to green is historical yield below or above usual, brown to teal is drier or wetter, blue
// to red is cooler or warmer; the harvest-date map separates past (rose) and future (blue) around today. The states have words beside them.
const YIELD_PALETTE = ['#7f3b08', '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', '#006837'];
const RAIN_PALETTE = ['#8c510a', '#bf812d', '#d8b365', '#f5f5ed', '#5ab4ac', '#35978f', '#01665e'];
const TEMP_PALETTE = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'];
const CAL_RAMP = ['#a92350', '#dc7898', '#f5f2e8', '#65a5cf', '#185b9a'];
const OFFSET_PALETTE = ['#5e5c57', '#a3a19b', '#e2e1dc', '#f6f3fa', '#b39cd6', '#7a56b6', '#3b2378'];
const C = {none: '#fbfaf7', notEstimated: '#cfcec8', unresolved: '#f2c6d5', unavailable: '#cfcec8', pre: '#fdf6dc', post: '#6f6c66'};
const MAP_COLORS = {local: '#737d8c', national: '#414b5a', selectionEdge: '#432580', halo: '#fbfaf7'};
const OUTLOOK_LIMIT = 10; // historical-response scale
// ColorBrewer PuOr is rated colorblind-safe. A fixed linear scale preserves comparisons
// across crops and map levels; only colors saturate beyond ±30%, never the saved values.
// Colors by Cynthia Brewer, Mark Harrower and Penn State: https://colorbrewer2.org/#type=diverging&scheme=PuOr&n=11
const WATCH_THRESHOLD = 10;
const EFFECT_COLOR_LIMIT = 30;
const EFFECT_PALETTE = ['#7f3b08','#b35806','#e08214','#fdb863','#fee0b6','#f7f7f7','#d8daeb','#b2abd2','#8073ac','#542788','#2d004b'];
const outlookColor = v => diverging(v, EFFECT_COLOR_LIMIT, EFFECT_PALETTE);
// The harvest-anomaly layer (18 October 2026): the departure of each reported yield from the series' own trend in a chosen
// harvest year, read from data/<release>/anomalies/<family>.json (scripts/anomaly_layer.py). The colours saturate at
// ±ANOMALY_LIMIT percent. The outlook uses its own palette over the same numeric range.
const ANOMALY_LIMIT = 30;
// The maps: one box of fixed proportion at the top of every page, trimmed to 65°N–65°S at world level, with no zoom or
// drag; the reader moves between levels by clicking (world → country → state → unit). A country whose panel has at
// least this many local units opens its states first; smaller countries open their units directly.
const WORLD_LAT = [-57, 65];                           // Cape Horn is at 56°S; Antarctica is left out of the drawn features
const WORLD_LON = [-130, 180];                         // the eastern Pacific west of the Americas is left out (10 October 2026), so the continents fill the box
const BIG_COUNTRY_UNITS = 150;
// The world map is drawn in the Equal Earth projection (Šavrič, Patterson and Jenny 2019), which keeps areas true so
// the tropics are not shrunk as on a Mercator map. MapLibre renders Mercator only, so every world polygon is projected
// to the Equal Earth plane on load and the plane is handed to the renderer as pseudo-coordinates: a projected x maps
// to a pseudo-longitude linearly and a projected y to the pseudo-latitude whose Mercator ordinate is linear in y, so
// the renderer, with zoom and pan off, shows the plane undistorted. Country and state maps stay in Mercator.
const EE = {A1: 1.340264, A2: -0.081106, A3: 0.000893, A4: 0.003796, M: Math.sqrt(3) / 2};
function equalEarth(lon, lat) {
  const l = lon * Math.PI / 180, f = lat * Math.PI / 180, t = Math.asin(EE.M * Math.sin(f)), t2 = t * t, t6 = t2 * t2 * t2;
  return [(2 * Math.sqrt(3) / 3) * l * Math.cos(t) / (EE.A1 + 3 * EE.A2 * t2 + t6 * (7 * EE.A3 + 9 * EE.A4 * t2)), t * (EE.A1 + EE.A2 * t2 + t6 * (EE.A3 + EE.A4 * t2))];
}
const EE_XMAX = equalEarth(180, 0)[0], EE_K = Math.PI / EE_XMAX;
const toPseudo = ([x, y]) => [x * 180 / EE_XMAX, Math.atan(Math.sinh(y * EE_K)) * 180 / Math.PI];
const projectPoint = ([lon, lat]) => toPseudo(equalEarth(lon, lat));
const projectCoords = c => typeof c[0] === 'number' ? projectPoint(c) : c.map(projectCoords);
const projectFeature = f => f.geometry ? {...f, geometry: {...f.geometry, coordinates: projectCoords(f.geometry.coordinates)}} : f;
// The box: a meridian's pseudo-longitude equals its longitude at the equator and shrinks toward the poles, so the
// bounding meridians fit the box at the equator and curve inward above and below it.
const WORLD_BOUNDS = [[WORLD_LON[0], projectPoint([0, WORLD_LAT[0]])[1]], [WORLD_LON[1], projectPoint([0, WORLD_LAT[1]])[1]]];
const meridian = (lon, from, to) => { const pts = []; const step = from < to ? 2 : -2; for (let lat = from; step > 0 ? lat < to : lat > to; lat += step) pts.push(projectPoint([lon, lat])); pts.push(projectPoint([lon, to])); return pts; };
// The outline of the projected world between the latitude cuts and the bounding meridians, drawn beneath the countries
// as the sea; and the masks beyond the meridians, drawn over everything in the page colour, which hide the land that
// the rectangular box would otherwise show outside the curved cut (Alaska and the Yukon beyond 130°W).
function worldFrame() {
  const ring = [...meridian(WORLD_LON[1], WORLD_LAT[0], WORLD_LAT[1]), ...meridian(WORLD_LON[0], WORLD_LAT[1], WORLD_LAT[0])]; ring.push(ring[0]);
  return {type: 'Feature', id: '__frame', properties: {frame: true}, geometry: {type: 'Polygon', coordinates: [ring]}};
}
function worldMasks() {
  const y0 = WORLD_BOUNDS[0][1] - 1, y1 = WORLD_BOUNDS[1][1] + 1;
  const left = [[WORLD_LON[0] - 2, y0], [WORLD_LON[0] - 2, y1], ...meridian(WORLD_LON[0], WORLD_LAT[1], WORLD_LAT[0])]; left.push(left[0]);
  const right = [...meridian(WORLD_LON[1], WORLD_LAT[0], WORLD_LAT[1]), [WORLD_LON[1], y1], [WORLD_LON[1], y0]]; right.push(right[0]);
  return [left, right].map((ring, i) => ({type: 'Feature', id: `__mask${i}`, properties: {mask: true}, geometry: {type: 'Polygon', coordinates: [ring]}}));
}
const HOSTING = {base: ''};
const dataURL = path => HOSTING.base && /^(data|display|fixtures)\//.test(path) ? HOSTING.base + path : path;
const cache = new Map(); const D = {release: null}; const maps = {}; let renderVersion = 0;
let retainedLocalView = null;
window.__atlas = {D, maps, cache};      // inspection only
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = (v, d = 1, sign = false) => v == null || !isFinite(v) ? '–' : (sign && v > 0 ? '+' : '') + Number(v).toFixed(d).replace('-', '−');
const pct = (v, d = 1) => v == null || !isFinite(v) ? '–' : fmt(v, d, true) + '%';
const num = v => v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('en-US');
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const ordinal = n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th')}`;
// Unit names arrive as the source wrote them; a name written entirely in lower case is shown in title case.
const placeName = value => {const n=String(value||'').replace(/_/g,' ');return n===n.toLowerCase()?n.replace(/(^|[\s(\-])(\p{L})/gu,(m,a,b)=>a+b.toUpperCase()):n;};
const cropLabel = code => D.catalog?.crops[code]?.label || String(code).replace(/_/g, ' ');
const seasonWords = s => s === 'main' ? 'main season' : s === 'Annual' ? 'annual record' : /^planted_m(\d+)$/.test(s) ? 'planted in ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(s.slice(9)) - 1] : s + ' season';
const cropSeason = p => `${cap(cropLabel(p.crop_code))}, ${seasonWords(p.season)}`;
const monthName = m => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1];
const longDate = iso => { if (!iso) return '–'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${monthName(m)} ${y}`; };
const shortDate = iso => { if (!iso) return '–'; const [y, m, d] = iso.split('-').map(Number); return `${d} ${monthName(m).slice(0, 3)} ${y}`; };
const rowsOf = (file, table, arr) => { const cols = file.columns[table]; return (arr || []).map(a => Object.fromEntries(cols.map((c, i) => [c, a[i]]))); };
function geometryHasDatelineJump(geometry) {
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some(p => p.some(r => r.some((point,i) => i > 0 && Math.abs(point[0]-r[i-1][0]) > 180)));
}
async function load(path) {
  if (!cache.has(path)) cache.set(path, (async () => { const r = await fetch(dataURL(path), {cache: 'no-cache'}); if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`); const data = await r.json();
    // Dissolved national rings can join opposite sides of the date line.
    // The release's split world outline preserves the same country identity.
    if (/\/geometry\/[A-Z]{3}\.json$/.test(path) && data.features?.some(f => f.properties?.level === 'national' && geometryHasDatelineJump(f.geometry))) {
      const world = await load(path.replace(/[^/]+$/, 'world.json'));
      data.features = data.features.map(f => {
        if (f.properties?.level !== 'national' || !geometryHasDatelineJump(f.geometry)) return f;
        const replacement = world.features.find(w => w.id === f.id);
        return replacement && !geometryHasDatelineJump(replacement.geometry) ? {...f, geometry:replacement.geometry} : f;
      });
    }
    return data; })().catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}
// ---- colour scales -----------------------------------------------------------------------------------------------
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; }
function ramp(x, palette) { const n = palette.length - 1; const t = Math.max(0, Math.min(1, x)) * n; const i = Math.min(n - 1, Math.floor(t)); return mix(palette[i], palette[i + 1], t - i); }
const diverging = (v, lim, palette) => v == null || !Number.isFinite(v) ? C.notEstimated : ramp((Math.max(-1, Math.min(1, v / lim)) + 1) / 2, palette);
const sequential = (v, lo, hi, palette) => v == null || !Number.isFinite(v) ? C.notEstimated : ramp(hi > lo ? (v - lo) / (hi - lo) : 0.5, palette);
// Signed offsets: before the anchor in greys over `before` days, after it in purples over `after` days.
const offsetColor = (v, before, after) => v == null ? C.unavailable : ramp((Math.max(-1, Math.min(1, v < 0 ? v / before : v / after)) + 1) / 2, OFFSET_PALETTE);
function legend(title, ticks, palette, states) {
  const stops = palette.map((c, i) => `${c} ${100 * i / (palette.length - 1)}%`).join(',');
  return `<div class="legend"><div class="scale"><div class="detail">${esc(title)}</div><div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ticks">${ticks.map(l => `<span>${esc(l)}</span>`).join('')}</div></div>${states.map(([c, w]) => `<span class="state"><i style="background:${c}"></i>${esc(w)}</span>`).join('')}</div>`;
}
// ---- routing -----------------------------------------------------------------------------------------------------
function route() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); let parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const qs = new URLSearchParams(q || '');
  if (['season', 'response', 'record'].includes(parts[0])) parts = parts.slice(1);          // links of the 8 October application
  else if (parts[0] === 'about') { parts = []; qs.set('to', 'methods'); }
  return {iso: parts[0] || null, key: parts[1] || null, q: qs};
}
function link(iso, key, q) {
  const clean = {...q};
  // A season and source-series id belong to one place, not to the world view.
  if (!iso) { for (const k of ['season','series','records','harvest']) delete clean[k]; if(clean.layer==='historical') delete clean.layer; }
  const params = Object.fromEntries(Object.entries(clean).filter(([, v]) => v != null && v !== ''));
  const s = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return `#/${iso ? encodeURIComponent(iso) : ''}${key ? '/' + encodeURIComponent(key) : ''}${s}`;
}
const qobj = (r, extra = {}) => ({crop: r.q.get('crop'), season: r.q.get('season'), series: r.q.get('series'), records: r.q.get('records'), layer: r.q.get('layer'), date: r.q.get('date'), harvest: r.q.get('harvest'), year: r.q.get('year'), axis: r.q.get('axis'), index: r.q.get('index'), mask: r.q.get('mask'), release: r.q.get('release') || (D.release === D.releases?.default ? null : D.release), ...extra});
function selectInLocalMap(href) {
  const map = maps.cmap;
  const targetPath = href.split('?')[0].split('/').filter(Boolean);
  const nationalDestination = targetPath.length < 3 || targetPath[1] === targetPath[2];
  if (!nationalDestination && document.querySelector('.regional-page') && map?.getCenter && map?.getZoom) {
    retainedLocalView = {href, camera:{center:map.getCenter().toArray(), zoom:map.getZoom()},
      bounds:map.getBounds().toArray(), scrollY:window.scrollY || 0};
  }
  location.hash = href;
}
const go = (r, iso, key, extra) => { selectInLocalMap(link(iso, key, qobj(r, extra))); };
// A place opened from a map starts on the ENSO axis (the user's rule of 10 October 2026, evening): the axis choice of the
// page the reader came from is not carried over, and the page opens at its top with the map beside the panels.
const seriesLink = (iso, key, q) => link(iso, key, {...q, axis: null, to: null});
function revealSection(id) {
  const el = id && document.getElementById(id);
  if (!el?.scrollIntoView) return false;
  if (el.tagName === 'DETAILS') el.open = true;
  if (id === 'series') el.focus?.({preventScroll: true});
  el.scrollIntoView({behavior: 'instant', block: 'start'});
  return true;
}
function openSeries(iso, key, q) {
  const href = seriesLink(iso, key, q);
  if (location.hash === href) revealSection('series');
  else location.hash = href;
}
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => init().catch(e => { document.getElementById('view').innerHTML = `<p>Could not start: ${esc(e.message)}</p>`; }));
async function init() {
  if (location.hostname === 'phuybers3.github.io') { const h = await fetch('hosting.json').then(r => { if (!r.ok) throw new Error('Deployment metadata is unavailable'); return r.json(); }); if (!/^https:\/\/raw\.githubusercontent\.com\/phuybers3\/enso-yield-atlas\/[0-9a-f]{40}\/site\/$/.test(h.data_base)) throw new Error('Invalid deployment data location'); HOSTING.base = h.data_base; }
  D.releases = await load('data/releases.json');
  document.getElementById('view').addEventListener('mouseover', e => { const t = e.target?.closest?.('.pt'); if (!t) return; const y = t.getAttribute('data-year'); for (const el of document.querySelectorAll('.pt.hi')) el.classList.remove('hi'); for (const el of document.querySelectorAll(`.pt[data-year="${y}"]`)) el.classList.add('hi'); });
  return render();
}
// ---- data access: one shape for both contracts ---------------------------------------------------------------------
// A panel row: key, iso3, crop_code, crop_family, season, harvest_year, lead, status, n_series, local_share,
// baseline_production_mt, pct, lo, hi, se, lo_resp, hi_resp (the central ENSO-outlook row), label. Under the
// 2026-10-08 contract the row is built from panels.json and keeps that record as `legacy` for the detail rows the
// countries file does not carry there.
const isNew = () => D.contract === NEW;
const isReconciled = () => D.catalog?.model?.replicates?.method === 'centered_year_blocks_plus_shrinkage_student_v1';
const responseComponents = (record, index) => record?.yield_response_components_by_index?.[index]
  || (index==='rel' ? record?.yield_response_components || [] : []);
const pathAssumptionLabel = () => D.catalog?.model?.forward_input_assumption?.full_issued_seasonal_path === false
  ? 'DJF outlook with an assumed seasonal path.' : '';
const intervalReviewLabel = () => {
  if(!isReconciled())return '';
  const model=D.catalog.model;
  if(!model.uncertainty_calibration?.approved)return /failed/.test(model.uncertainty_calibration?.status || '')
    ? 'Interval calibration checks failed; research candidate.' : 'Interval calibration under review; research candidate.';
  if(!model.monte_carlo_precision?.approved)return model.monte_carlo_precision?.checks?.some(x=>!x.passed)
    ? 'Research intervals: numerical precision checks did not pass.' : 'Interval numerical precision remains under review; research candidate.';
  return '';
};
const medium = rows => rows.find(x => x.method === 'index_outlook' && x.scenario === 'medium');
// Modern outlook exports carry the 10th and 90th percentiles of the ENSO effect.
// The legacy release has 95% intervals; missing/legacy ranges are not classified as 80% intervals.
const hasOutlook80 = row => isNew() && Number.isFinite(row?.pct) && Number.isFinite(row.lo) && Number.isFinite(row.hi) && row.lo <= row.hi;
const zeroConsistent = row => hasOutlook80(row) && row.lo <= 0 && row.hi >= 0;
const outlookIntervalNote = row => !isNew() || !Number.isFinite(row?.pct) ? '' : !hasOutlook80(row)
  ? '<br>80% interval unavailable' : `<br>80% interval ${zeroConsistent(row) ? 'includes' : 'excludes'} zero`;
const outlookHighlightKey = () => '<p class="detail outlook-key">Orange: losses · purple: gains. Colors saturate at ±30%; tooltips show exact values and effect ranges. Palette: <a href="https://colorbrewer2.org/#type=diverging&amp;scheme=PuOr&amp;n=11" target="_blank" rel="noopener noreferrer">ColorBrewer PuOr</a>.</p>';
const panelLabel = p => `${D.catalog.countries[p.iso3]?.name || p.iso3} ${cropLabel(p.crop_code)}, ${seasonWords(p.season)}`;
async function ensureRelease(release) {
  if (D.release === release) return;
  if (!D.releases.releases.some(x => x.release === release)) throw new Error(`Unknown release ${release}`);
  const base = `data/${release}/`;
  const [catalog, world] = await Promise.all([load(base + 'catalog.json'), load(base + 'world.json')]);
  const contract = catalog.contract || world.contract || '2026-10-08';
  D.catalog = catalog;
  let panels;
  if (contract === NEW) panels = rowsOf(world, 'panels', world.panels).map(p => ({...p, label: panelLabel(p)}));
  else {
    const raw = await load(base + 'panels.json');
    panels = raw.map(p => { const m = medium(p.predictions || []) || {}; return {key: p.key, iso3: p.iso3, crop_code: p.crop_code, crop_family: p.crop_family, season: p.season, harvest_year: p.harvest_year, lead: m.lead ?? p.predictions?.[0]?.lead ?? null, status: p.status, n_series: p.n_series, local_share: p.local_share, baseline_production_mt: p.production_mt, pct: m.pct ?? null, lo: m.lo ?? null, hi: m.hi ?? null, se: m.se ?? null, lo_resp: null, hi_resp: null, label: p.label, legacy: p}; });
  }
  const availablePanels = [...panels];
  for (const [iso, country] of Object.entries(catalog.countries)) for (const [crop, seasons] of Object.entries(country.crops || {})) for (const season of seasons) {
    if (!panels.some(p => p.iso3 === iso && p.crop_code === crop && p.season === season)) availablePanels.push({key:`${iso}|${crop}|${season}`, iso3:iso, crop_code:crop, crop_family:catalog.crops[crop]?.family, season, harvest_year:Number(world.issue?.slice(0,4)), record_only:true, pct:null});
  }
  // The harvest-anomaly layer (18 October 2026) is offered where the release carries anomalies/index.json.
  const [anomalies, names, watchContext] = await Promise.all([
    load(base + 'anomalies/index.json').catch(() => null),
    load(`data/static/place-hierarchy/${release}.json`).catch(() => null),
    load(`data/static/watchlist-context/${release}.json`).catch(() => null)
  ]);
  D.placeHierarchy = names?.release === release ? names : null;
  D.watchlistContext = watchContext?.release === release ? watchContext.panels : null;
  Object.assign(D, {release, base, contract, world, panels, availablePanels, panelByKey: new Map(panels.map(p => [p.key, p])), worldCal: null, worldUnits:null, countryBox:null, anomalies});
  document.getElementById('foot-line').innerHTML = `ENSO crop atlas, release ${esc(release)}${catalog.candidate ? ' (candidate)' : ''}: ENSO outlook issued ${esc(world.issue)} (${esc(world.index.outlook.source)}), weather observations to ${esc(longDate(world.data_end))}, yields as reported to the release database. ${intervalReviewLabel()} ${pathAssumptionLabel()} <a href="${link(null, null, {to: 'methods', release: release === D.releases.default ? null : release})}">Methods and sources</a> · <a href="https://github.com/phuybers3/enso-yield-atlas">Repository</a>.`;
}
// The country's rows for a panel: prediction_panel rows, aggregate rows (2026-10-09 only), the season weather and
// the weather-to-date panel summary.
async function panelDetail(p) {
  if (p.record_only) return {label:panelLabel(p), predictions:[], aggregate:[], season_weather:null, weather:null, response:null};
  if (!isNew()) { const L = p.legacy || {}; return {label: p.label, predictions: L.predictions || [], aggregate: [], season_weather: L.season_weather || null, weather: L.weather || null, response: L.response || null}; }
  const c = await load(D.base + `countries/${p.iso3}.json`); const cp = c.panels.find(x => x.key === p.key);
  return cp ? {label: p.label, predictions: rowsOf(c, 'predictions', cp.predictions), aggregate: rowsOf(c, 'aggregate', cp.aggregate), season_weather: cp.season_weather || null, weather: cp.weather || null, response: null} : {label: p.label, predictions: [], aggregate: [], season_weather: null, weather: null, response: null};
}
const loadCountry = iso => load(D.base + `countries/${iso}.json`);
// State rows: aggregate rows per scenario under 2026-10-09 (pct_mean with pct_lo/hi and the response-only
// pct_lo_resp/hi_resp); response_region rows (pct_per_degC with lo/hi per index) under 2026-10-08.
const regionRows = (country, regionKey, crop, season) => (isNew() ? rowsOf(country, 'regions', country.regions) : country.regions || []).filter(x => x.region_key === regionKey && x.crop_code === crop && x.season === season);
async function loadUnits(iso, fam) {
  const modern=isNew(), release=D.release, base=D.base;
  const units=await (modern ? load(base+`units/${iso}.json`) : load(`display/${release}/units/${iso}-${fam}.json`));
  if(!modern) return units;
  const registry=await load('data/historical-responses/index.json').catch(e=>{console.warn('Historical response registry unavailable:',e.message);return null;});
  const file=registry?.releases?.[release]?.[`${iso}-${fam}`];
  const extra=file ? await load('data/historical-responses/'+file).catch(e=>{console.warn('Historical response supplement unavailable:',e.message);return null;}) : null;
  // Supplemental historical fits never enter the predictions arrays or current production aggregates.
  if(extra?.release===release) return {...units,historical:extra.series,historicalSummary:extra.summary};
  return units;
}
// Per-series accessors over a units file.
function mergeHistoricalResponses(current, historical) {
  const merged = new Map(current.map(x=>[`${x.variable}|${x.index}`,x]));
  for (const x of historical) {
    const key=`${x.variable}|${x.index}`, present=merged.get(key);
    if(!present || (!Number.isFinite(present.slope_eb) && Number.isFinite(x.slope_eb))) merged.set(key,x);
  }
  return [...merged.values()];
}
const S = {
  calendar(units, s) {
    if (isNew()) return rowsOf(units, 'calendar', s.calendar);
    return rowsOf(units, 'windows', s.windows).map(w => ({harvest_year: w.harvest_year, cycle: w.cycle, plant_date: w.start_date, harvest_date: w.end_date, calendar_source: w.source, window_source: w.source, confidence: null, cycle_unresolved: cycleUnresolved(units.iso3, s.crop_family, s.season, w.cycle)}));
  },
  predictions: (units, s) => rowsOf(units, 'predictions', s.predictions),
  responses(units, s) {
    if (isNew()) {
      const current=rowsOf(units,'responses',s.responses);
      const extra=units.historical?.[s.id]?.responses?.filter(x=>x.variable==='ly')||[];
      return mergeHistoricalResponses(current,extra);
    }
    return rowsOf(units, 'responses', s.responses).map(x => ({variable: 'ly', index: x.index, n_years: x.n_years, pct_eb: x.pct_best, lo_eb: x.lo_best, hi_eb: x.hi_best, p: x.p_best, level: x.response_level, shrink_weight: x.shrink_weight, pct_raw: x.pct_raw, lo_raw: x.lo_raw, hi_raw: x.hi_raw, note: ''}));
  },
  weight: (units, s) => isNew() && s.weight ? Object.fromEntries(units.columns.weight.map((c, i) => [c, s.weight[i]])) : null,
  isPublic: s => isNew() ? !!s.display_points : PUBLIC_SOURCES.has(s.source),
  permission: s => isNew() ? (s.permission || s.source) : s.source,
};
const sourceName = id => D.catalog.sources?.[id]?.name || SOURCE_LABEL[id] || id;
const sourceNote = id => D.catalog.sources?.[id]?.permission?.note || null;
const CONFIDENCE = {dated: 'dates to the day', monthly: 'dates to the month', approximate: 'approximate dates', missing: 'dates missing'};
const calendarLabel = row => row ? `${WINDOW_LABEL[row.calendar_source] || row.calendar_source || WINDOW_LABEL[row.window_source] || row.window_source || 'calendar'}${row.confidence ? `, ${CONFIDENCE[row.confidence] || row.confidence}` : ''}${row.cycle && row.cycle !== 'single' ? `, ${row.cycle} crop` : ''}` : '';
// The record of a series: observations, trend, anomalies, ENSO exposures, QC flags, the weather-variable responses
// and the season-to-date weather. Under 2026-10-09 every unit has a shard, with obs, trend_anomaly and qc null and
// `withheld` naming the reason where the source permits no display of points; under 2026-10-08 the observations
// file is requested for public sources only and the season weather comes from the units file.
async function loadRecord(iso, fam, key, s, units) {
  const metricsOf = (rows, cols) => (rows || []).map(w => ({...w, metrics: Object.fromEntries(Object.entries(w.metrics || {}).map(([k, a]) => [k, Object.fromEntries(cols.map((c, i) => [c, a[i]]))]))}));
  if (isNew()) {
    const idx = await load(D.base + `records/${iso}/index.json`); const f = idx.units?.[key]?.[0]; if (!f) return null;
    const file = D.base + `records/${iso}/${f}`; const shard = await load(file); const r = shard.series?.[s.id]; if (!r) return null;
    const current=rowsOf(shard,'responses',r.responses);
    const extra=units.historical?.[s.id]?.responses?.filter(x=>x.variable!=='ly')||[];
    const extraPoints=units.historical?.[s.id]?.relationship_history;
    const relationship_history=extraPoints ? [...new Map([...extraPoints,...(r.relationship_history||[])].map(a=>[`${a[0]}|${a[1]}|${a[2]}`,a])).values()] : r.relationship_history;
    const restored = await withNdviHistory(iso, s.id, r);
    return {...restored, ...(relationship_history ? {relationship_history} : {}), responses:mergeHistoricalResponses(current,extra), weather: metricsOf(r.weather, shard.columns.weather_metrics), columns: shard.columns, file};
  }
  const pub = S.isPublic(s); const weather = metricsOf(s.weather, units.columns.weather_metrics);
  const file = `display/${D.release}/records/${iso}-${fam}.json`;
  const r = pub ? await load(file).then(f => f.series[s.id]).catch(() => null) : null;
  return {obs: r?.obs ?? null, trend: r?.trend ?? null, trend_anomaly: r?.trend_anomaly ?? null, enso: r?.enso || [], qc: r?.qc ?? null, responses: [], weather, withheld: pub ? null : `the ${sourceName(s.source)} terms are not yet recorded in the source register`, file: pub ? file : null};
}
// Recover historical greenness from the original fitted database. The companion
// files carry only NDVI history; they cannot change forecasts or other observations.
async function withNdviHistory(iso, id, record, stateKey=null) {
  const release = D.release;
  const registry = await load('data/ndvi-history/index.json').catch(()=>null);
  const file = registry?.releases?.[release]?.[iso];
  if (!file) return record;
  const extra = await load('data/ndvi-history/'+file);
  if (extra.release !== release || extra.iso3 !== iso) throw new Error('NDVI history release mismatch');
  const rows = stateKey ? extra.states?.[stateKey]?.[id] : extra.series?.[id];
  if (!rows?.length) return {...record,ndvi_history_status:extra.unavailable?.[id] || 'unavailable'};
  const history = new Map((record.weather_history || []).map(row=>[row[0],[...row]]));
  for (const [year,value,provisional] of rows) {
    const row=history.get(year)||[year,null,null,null,null];
    if (!Number.isFinite(row[3])) {row[3]=value;row[4]=provisional;}
    history.set(year,row);
  }
  return {...record,weather_history:[...history.values()].sort((a,b)=>a[0]-b[0]),ndvi_history_source:file};
}
// The state record of a panel (10 October 2026): records/<ISO>/state_<key>.json, listed under `states` in the index,
// keyed crop_code|season; the area-weighted average of the state's units in the shape of a unit record.
async function loadStateRecord(iso, key, p) {
  if (!isNew()) return null;
  const idx = await load(D.base + `records/${iso}/index.json`); const f = idx.states?.[key]?.[0]; if (!f) return null;
  const file = D.base + `records/${iso}/${f}`; const shard = await load(file); const id = `${p.crop_code}|${p.season}`; const r = shard.series?.[id]; if (!r) return null;
  const metricsOf = (rows, cols) => (rows || []).map(w => ({...w, metrics: Object.fromEntries(Object.entries(w.metrics || {}).map(([k, a]) => [k, Object.fromEntries(cols.map((c, i) => [c, a[i]]))]))}));
  const restored = await withNdviHistory(iso, id, r, key);
  return {...restored, id, level: 'state', responses: rowsOf(shard, 'responses', r.responses), weather: metricsOf(r.weather, shard.columns.weather_metrics), columns: shard.columns, file};
}
// The national display supplement supplies historical observations where the release has no national weather.
// Its dates and sources remain separate from current-season weather and forecast/model results.
async function loadNationalWeather(iso, s, rec) {
  if (!rec || !isNew() || [1,2].every(c=>(rec.weather_history||[]).some(a=>Number.isFinite(a[c])))) return rec;
  if (!D.nationalWeatherIndex) D.nationalWeatherIndex = await load('data/national-weather/index.json').catch(() => ({releases:{}}));
  const file = D.nationalWeatherIndex.releases?.[D.release]?.[iso];
  if (!file) return rec;
  const supplement = await load('data/national-weather/' + file).catch(() => null);
  const extra = supplement?.release === D.release ? supplement.series?.[s.id] : null;
  if (!extra) return rec;
  const history=new Map((rec.weather_history||[]).map(a=>[a[0],a.slice()]));
  const missing=[1,2].filter(c=>![...history.values()].some(a=>Number.isFinite(a[c])));
  for (const a of extra.weather_history) {const row=history.get(a[0]) || [a[0],null,null];for(const c of missing) row[c]=a[c];history.set(a[0],row);}
  return {...rec, weather_history:[...history.values()].sort((a,b)=>a[0]-b[0]), national_weather_context:extra.context};
}
// The world calendar: calendar_world.json (one row per harvest year per panel) or the pilot fixture (one row).
async function worldCalendar() { if (!D.worldCal) D.worldCal = await load(isNew() ? D.base + 'calendar_world.json' : `fixtures/world_calendar_${D.release}.json`); return D.worldCal; }
function worldCalRow(key, hy) {
  const w = D.worldCal; const raw = w?.panels[key]; if (!raw) return null;
  const rows = (isNew() ? raw : [raw]).map(a => Object.fromEntries(w.columns.map((c, i) => [c, a[i]])));
  const row = rows.find(x => x.harvest_year === hy) || (isNew() ? null : rows[0]); if (!row) return null;
  if (!isNew()) row.cycle_unresolved = cycleUnresolved(row.iso3, D.panelByKey.get(key)?.crop_family, row.series_season, row.cycle);
  return row;
}
const publishedRange = () => D.worldCal?.published_range || D.catalog.calendar?.published_range || null;
// The harvest-anomaly files (18 October 2026): one per family with every series of the family from 1961 on, keyed by series id
// (anomalies/<family>.json: series[id] = [first_year, anomaly_pct[], yield_t_ha[], exposure[]] over consecutive harvest years,
// null where the year has no reported yield; national[ISO3] = [series_id, crop_code, season]; units[unit_key] = [series_id,
// crop_code, season], the series the world map draws every reporting unit by, 19 October 2026), and the index with the year
// ranges, the coverage counts, the default years and the December–February relative Niño 3.4 of each harvest year.
const anomalyFiles = new Map();
async function loadAnomaly(fam) { const k = `${D.release}/${fam}`; if (!anomalyFiles.has(k)) anomalyFiles.set(k, await load(D.base + `anomalies/${fam}.json`)); return anomalyFiles.get(k); }
const anomalyFile = fam => anomalyFiles.get(`${D.release}/${fam}`) || null;
const anomalyIndex = () => load(D.base + 'anomalies/index.json');
// The row of a series in a harvest year, or null where the year has no reported yield; the trend yield follows from the two.
function anomalyRow(file, sid, year) {
  const s = file?.series?.[String(sid)]; if (!s) return null; const i = year - s[0]; const a = i >= 0 ? s[1][i] : null;
  return a == null ? null : {anomaly: a, yield: s[2][i], trend: s[2][i] == null ? null : s[2][i] / (1 + a / 100), exposure: s[3][i]};
}
const anomalyWords = (row, year) => `Yield ${pct(row.anomaly)} from trend, harvest ${year} · reported ${fmt(row.yield, 2)} t/ha, trend ${fmt(row.trend, 2)} t/ha${row.exposure != null ? ` · growing-season relative Niño 3.4 ${fmt(row.exposure, 2, true)} °C` : ''}`;
// The year of the layer: the year parameter within the family's range, else the index's default, the latest year with at
// least half the family's peak coverage on the world map.
function yearFor(r, fam, index) { const [first, last] = index?.years?.[fam] || [1961, 2026]; const y = Number(r.q.get('year')); return Number.isInteger(y) && y >= first && y <= last ? y : (index?.default_year?.[fam] ?? last); }
async function loadAnomalyLayer(r, fam) { const [index, file] = await Promise.all([anomalyIndex(), loadAnomaly(fam)]); return {index, file, year: yearFor(r, fam, index)}; }
const yearControlFor = (anomaly, fam) => ({year: anomaly.year, years: anomaly.index.years[fam], counts: anomaly.index.counts_world[fam] || {}, djf: anomaly.index.djf_relative_n34 || {}});
// State outlines and label centres: display/<release>/regions/<ISO>.json, else labels at the mean position of the
// state's units. Only release 2026-10-08 was exported with a display folder, and the later releases copy their
// geometry from it (manifest.json, geometry.copied_from), so the loader asks for a folder that exists in the repository
// and never for one that would answer 404; the hosted site reads display/ from the data base as it reads the release
// data (20 October 2026). An export that ships regions with a later release adds that release here. The four French
// overseas departments have no outline file.
const DISPLAY_RELEASES = ['2026-10-08'];
const REGIONS_ABSENT = new Set(['GLP', 'GUF', 'MTQ', 'REU']);
const regionFiles = new Map();
async function loadRegions(iso, units, regionList) {
  const displayRelease = [D.release, D.catalog.source_release].find(r => DISPLAY_RELEASES.includes(r)) || DISPLAY_RELEASES[DISPLAY_RELEASES.length - 1];
  const tryLoad = r => r && !REGIONS_ABSENT.has(iso) ? load(`display/${r}/regions/${iso}.json`).catch(() => null) : null;
  const k = `${D.release}/${iso}`; if (!regionFiles.has(k)) regionFiles.set(k, await tryLoad(displayRelease));
  const g = regionFiles.get(k);
  if (g?.features?.length || !units) return g;      // a file without features (South Africa's) leaves the labels to the units
  const feats = regionList.map(([k, n]) => { const pts = Object.values(units.units).filter(u => u.region_key === k && u.lon != null && u.lat != null); return pts.length ? {type: 'Feature', geometry: null, properties: {name: n, center: [pts.reduce((a, u) => a + u.lon, 0) / pts.length, pts.reduce((a, u) => a + u.lat, 0) / pts.length]}} : null; }).filter(Boolean);
  return feats.length ? {type: 'FeatureCollection', features: feats} : null;
}
// ---- selection ---------------------------------------------------------------------------------------------------
const familyOf = r => { const w = r.q.get('crop'); return D.catalog.crops[w]?.family || (D.catalog.families.includes(w) ? w : 'maize'); };
const panelsOf = (iso, fam) => (D.availablePanels || D.panels).filter(p => p.iso3 === iso && p.crop_family === fam).sort((a, b) => Number(!!a.record_only)-Number(!!b.record_only) || (b.baseline_production_mt || 0) - (a.baseline_production_mt || 0));
function panelFor(r, iso, unit) {
  const all = panelsOf(iso, familyOf(r));
  const ps = unit && all.some(p=>hasSeries(unit,p)) ? all.filter(p=>hasSeries(unit,p)) : all;
  const chosen = unit?.series.find(s=>String(s.id)===r.q.get('series'));
  const crop = chosen?.crop_code || r.q.get('crop'), season = chosen?.season || r.q.get('season');
  return ps.find(p => p.crop_code === crop && p.season === season) || ps.find(p => p.season === season) || ps.find(p => p.crop_code === crop) || ps[0] || null;
}
const harvestFor = (r, p) => Number(r.q.get('harvest')) || p?.harvest_year || null;
const validDate = s => s && AtlasCalendar.day(s) != null ? s : null;
const dateFor = r => validDate(r.q.get('date')) || AtlasCalendar.todayISO();
const layerFor = r => r.iso && r.q.get('layer')==='historical' ? 'historical' : r.q.get('layer') === 'anomaly' ? (D.anomalies ? 'anomaly' : 'outlook') : ['progress','planting','harvest','calendar'].includes(r.q.get('layer')) ? 'progress' : 'outlook';
const indexFor = r => r.q.get('index') === 'std' ? 'std' : 'rel';
const axisFor = r => r.q.get('axis') === 'year' ? 'year' : 'enso';
// The 2026-10-08 pilot keeps Brazilian annual maize records annual: a first- or second-crop window assigned by the
// month rule is shown as unresolved on the calendar layers (4_ag/planning/atlas_development_plan_2026-10-09.md,
// Decisions). The 2026-10-09 contract publishes cycle_unresolved on every calendar row and this rule is not applied.
const cycleUnresolved = (iso, fam, season, cycle) => iso === 'BRA' && fam === 'maize' && ['first', 'second'].includes(cycle) && ['main', 'Annual'].includes(season);
function calStatus(row, date, unresolved) {
  const st = AtlasCalendar.phaseAt(row || {}, date, publishedRange());
  return {...st, unresolved: !!unresolved, row};
}
function calCell(layer, st) {
  if (st.unresolved) return {color: C.unresolved, words: 'Crop cycle unresolved'};
  const harvestDay = AtlasCalendar.day(st.row?.harvest_date);
  if (harvestDay == null) return {color: C.unavailable, words: 'Harvest date unavailable'};
  return {color: CAL_RAMP[2], harvestDay, words: `Typical harvest ${longDate(st.row.harvest_date)}`};
}
// A fixed rolling window makes past/future colors comparable across places and after panning.
// Published harvest dates outside the window saturate at its endpoints; the dates themselves never wrap.
function harvestScale(fc) {
  const range = AtlasCalendar.rollingWindow(AtlasCalendar.todayISO());
  for (const f of fc?.features || []) if (f.properties.reporting !== false && Number.isFinite(f.properties.harvestDay)) {
    f.properties.color = ramp(AtlasCalendar.windowFraction(f.properties.harvestDay, range), CAL_RAMP);
  }
  return range;
}
// The country page passes a null range before its progress branch computes one, so the default is applied here rather
// than as a parameter default, which null would skip.
function calLegend(layer, fam, mask = false, range = null) {
  range = range || AtlasCalendar.rollingWindow(AtlasCalendar.todayISO());
  const states = [[C.unresolved, 'Crop cycle unresolved'], [C.unavailable, 'Calendar unavailable'], [C.none, `No ${FAMILY_LABEL[fam].toLowerCase()} records`]].concat(mask ? [['#fbfaf7','Outside crop mask']] : []);
  const {lo,mid,hi} = range;
  const dateLabel = day => new Date(day * 86400000).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  return `<div class="legend harvest-legend" data-harvest-min="${lo}" data-harvest-today="${mid}" data-harvest-max="${hi}"><div class="scale">
    <div class="title">Typical harvest date</div><div class="ramp" style="background:linear-gradient(90deg,${CAL_RAMP.join(',')})"><i class="harvest-today"></i></div>
    <div class="harvest-ticks"><span>Past<small>≤ ${dateLabel(lo)}</small></span><span><b>Today</b><small>${dateLabel(mid)}</small></span><span>Future<small>≥ ${dateLabel(hi)}</small></span></div>
    </div>${states.map(([color,label]) => `<span class="state"><i style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
}
// A colourbar: a title, the unit on a second line, the ramp with tick marks at the labelled values, and the swatches
// for the states a colour cannot express.
function colourbar(title, unit, marks, palette, states, id) {
  const W = 300, H = 46, x0 = 10, x1 = W - 10, y0 = 4, h = 11;
  const stops = palette.map((c, i) => `<stop offset="${(100 * i / (palette.length - 1)).toFixed(1)}%" stop-color="${c}"/>`).join('');
  const ticks = marks.map(m => { const x = x0 + (x1 - x0) * m.t; return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0 + h}" y2="${y0 + h + 5}" stroke="#4f4e4a" stroke-width="1"/><text x="${x.toFixed(1)}" y="${y0 + h + 17}" font-size="11" text-anchor="${m.t === 0 ? 'start' : m.t === 1 ? 'end' : 'middle'}" fill="#4f4e4a">${esc(m.label)}</text>`; }).join('');
  return `<div class="legend"><div class="scale"><div class="title">${esc(title)}</div><div class="detail">${esc(unit)}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}, ${esc(unit)}"><defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${h}" fill="url(#${id})" rx="2"/>${ticks}</svg></div>${states.map(([c, w]) => `<span class="state"><i style="background:${c}"></i>${esc(w)}</span>`).join('')}</div>`;
}
const outlookLegend = (fam, mask = false) => colourbar('Conditional ENSO effect on yield', '% change from the neutral trend · central outlook',
  [{t:0,label:'≤ −30%'},{t:.25,label:'−15%'},{t:.5,label:'0%'},{t:.75,label:'+15%'},{t:1,label:'≥ +30%'}], EFFECT_PALETTE,
  [[C.notEstimated,'Current estimate unavailable'],[C.none,`No ${FAMILY_LABEL[fam].toLowerCase()} records`]].concat(mask ? maskSwatch(fam) : []), 'ramp-outlook')
  .replace('<div class="legend">','<div class="legend outlook-legend">').replace(/<\/div>$/,`${outlookHighlightKey()}</div>`);

const historicalLegend = (fam,mask) => colourbar('Historical ENSO response',`Yield change (%) per +1 °C of the growing-season ${indexFor(route())==='std'?'standard':'relative'} Niño 3.4 index`, [{t:0,label:'≤ −10'},{t:.25,label:'−5'},{t:.5,label:'0'},{t:.75,label:'+5'},{t:1,label:'≥ +10 %'}],YIELD_PALETTE,[[C.notEstimated,'Historical response unavailable'],[C.none,`No ${FAMILY_LABEL[fam].toLowerCase()} records`]].concat(mask?maskSwatch(fam):[]),'ramp-historical');
const anomalyLegend = (fam, mask = false, year = null) => colourbar('Harvest anomaly', `yield (%) from the series' fitted trend${year ? `, harvest ${year}` : ''}`, [{t: 0, label: `≤ −${ANOMALY_LIMIT}`}, {t: 0.25, label: `−${ANOMALY_LIMIT / 2}`}, {t: 0.5, label: '0'}, {t: 0.75, label: `+${ANOMALY_LIMIT / 2}`}, {t: 1, label: `≥ +${ANOMALY_LIMIT} %`}], YIELD_PALETTE, [[C.notEstimated, `No reported yield for ${year || 'the year'}`], [C.none, `No ${FAMILY_LABEL[fam].toLowerCase()} records`]].concat(mask ? maskSwatch(fam) : []), 'ramp-anomaly');
const mapLegend = (layer, fam, mask, range, year) => layer === 'historical' ? historicalLegend(fam,mask) : layer === 'anomaly' ? anomalyLegend(fam, mask, year) : layer === 'outlook' ? outlookLegend(fam, mask) : calLegend(layer, fam, mask, range);
const mapChoices = (r,layer) => [...LAYERS.slice(0,1),...(r.iso?[['historical','Historical ENSO response']]:[]),...LAYERS.slice(1)].filter(([k]) => k !== 'anomaly' || D.anomalies).map(([k,l])=>`<option value="${k}"${k===layer?' selected':''}>${l}</option>`).join('');
function controls(r, fam, layer, date, yearCtl = null) {
  const cal = layer === 'progress', mask = maskOn(r); const range = publishedRange();
  return `<div class="controls"><label>Crop <select id="crop-sel" aria-label="Crop">${D.catalog.families.map(f => `<option value="${f}"${f === fam ? ' selected' : ''}>${FAMILY_LABEL[f]}</option>`).join('')}</select></label>
    <label>Map <select id="layer-sel" aria-label="Map layer">${mapChoices(r,layer)}</select></label>
    <label id="date-label" hidden>Date <input type="date" id="date-sel" value="${esc(date)}" min="${esc(range?.[0] || '')}" max="${esc(range?.[1] || '')}" aria-label="Calendar date"></label>
    ${yearCtl ? yearControl(yearCtl) : ''}<label class="chk"><input type="checkbox" id="mask-chk"${mask ? ' checked' : ''}> Cropped land only (above ${MASK_THRESHOLD}% harvested)</label>${yearCtl ? yearTimeline(yearCtl) : ''}</div>`;
}
// The year control of the harvest-anomaly layer (18 October 2026): a slider over the family's years with the year beside it
// and a step either way; the change travels in the year parameter through go, so the back button restores earlier years.
function yearControl(y) {
  const [first, last] = y.years;
  return `<label class="year" id="year-label">Harvest year <button type="button" id="year-prev" aria-label="Previous year"${y.year <= first ? ' disabled' : ''}>‹</button><input type="range" id="year-sel" min="${first}" max="${last}" step="1" value="${y.year}" aria-label="Harvest year"><output id="year-out" for="year-sel">${y.year}</output><button type="button" id="year-next" aria-label="Next year"${y.year >= last ? ' disabled' : ''}>›</button></label>`;
}
// The timeline under the control: per harvest year a bar for the December–February relative Niño 3.4 ending in it (red above
// zero, blue below, saturating at 2.5 °C) and a line for the number of series with a value, the selected year marked; a click
// on a year selects it. Each track is labelled at its right end, so the SVG keeps 128 of its 640 units for the labels.
function yearTimeline(y) {
  const [first, last] = y.years, n = last - first + 1, W = 640, H = 74, x0 = 6, x1 = W - 128, w = (x1 - x0) / n, mid = 22, hBar = 16, cTop = 44, cBot = 60;
  const peak = Math.max(1, ...Object.values(y.counts).map(Number)), xc = k => x0 + (k + 0.5) * w;
  const bars = [], ticks = [], hits = []; const line = [];
  for (let k = 0; k < n; k++) {
    const yr = first + k, v = y.djf[yr], c = Number(y.counts[yr] || 0);
    if (v != null) { const h = Math.max(0.6, Math.min(1, Math.abs(v) / 2.5) * hBar); bars.push(`<rect x="${(x0 + k * w + 0.3).toFixed(1)}" y="${(v >= 0 ? mid - h : mid).toFixed(1)}" width="${Math.max(0.4, w - 0.6).toFixed(1)}" height="${h.toFixed(1)}" fill="${v >= 0 ? '#c0504d' : '#4a7fb5'}"/>`); }
    line.push(`${xc(k).toFixed(1)},${(cBot - (cBot - cTop) * c / peak).toFixed(1)}`);
    if (yr % 10 === 0) ticks.push(`<text x="${xc(k).toFixed(1)}" y="${H - 2}" font-size="9" text-anchor="middle" fill="#86847e">${yr}</text>`);
    hits.push(`<rect data-timeline-year="${yr}" x="${(x0 + k * w).toFixed(1)}" y="0" width="${w.toFixed(2)}" height="${H}" fill="transparent"><title>${yr}: December–February relative Niño 3.4 ${v == null ? 'unavailable' : fmt(v, 2, true) + ' °C'} · ${num(c)} series with a reported yield</title></rect>`);
  }
  const sx = xc(y.year - first).toFixed(1);
  return `<div class="year-timeline"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Timeline of the December–February relative Niño 3.4 and the number of series per harvest year"><line x1="${x0}" x2="${x1}" y1="${mid}" y2="${mid}" stroke="#c4c3bb" stroke-width="0.6"/>${bars.join('')}<line x1="${x0}" x2="${x1}" y1="${cBot}" y2="${cBot}" stroke="#c4c3bb" stroke-width="0.6"/><polyline points="${line.join(' ')}" fill="none" stroke="#4f4e4a" stroke-width="1.1"/><line class="year-mark" x1="${sx}" x2="${sx}" y1="2" y2="${cBot + 2}" stroke="#432580" stroke-width="1.4"/><text x="${sx}" y="${H - 2}" font-size="9" font-weight="700" text-anchor="middle" fill="#432580">${y.year}</text>${ticks.filter(t => Math.abs(Number(t.match(/>(\d{4})</)[1]) - y.year) > 2).join('')}${hits.join('')}<text x="${x1 + 6}" y="${mid + 3}" font-size="9" fill="#86847e">NINO3.4 index</text><text x="${x1 + 6}" y="${cBot - 2}" font-size="9" fill="#86847e">number of records available</text></svg></div>`;
}
function bindControls(r, iso, key) {
  key ||= document.querySelector('.regional-page')?.dataset.place || null;
  const c = document.getElementById('crop-sel'); if (c) c.onchange = () => go(r, iso, key, {crop: c.value, season: null, series:null, harvest: null});
  const panelSelect = document.getElementById('record-panel-sel');
  // On a place page the chosen record (a Brazilian safra or safrinha season, say) opens on the same place when the
  // place reports it; a record the place lacks opens the country's record list (20 October 2026).
  if (panelSelect) panelSelect.onchange = async () => {
    const p = (D.availablePanels || D.panels).find(p=>p.key === panelSelect.value); if(!p) return;
    if (key) { const units = await loadUnits(iso, p.crop_family).catch(() => null); const u = units?.units[key]; const has = u ? hasSeries(u, p) : Object.values(units?.units || {}).some(x => x.region_key === key && hasSeries(x, p)); if (has) return go(r,iso,key,{crop:p.crop_code,season:p.season,series:null,harvest:null,records:null}); }
    go(r,iso,null,{crop:p.crop_code,season:p.season,series:null,harvest:null,records:1}); };
  const seriesSelect = document.getElementById('series-sel');
  if (seriesSelect) seriesSelect.onchange = () => {const option=seriesSelect.querySelector(`option[value="${seriesSelect.value}"]`);go(r,iso,key,{crop:option.dataset.crop,season:option.dataset.season,series:seriesSelect.value,harvest:null});};
  const skill=document.getElementById('skill-disclosure');
  if(skill) skill.ontoggle=async()=>{if(!skill.open || skill.dataset.loaded)return;skill.dataset.loaded='1';try {const all=await load(D.base+'skill.json');const rows=skillRows((all.panels?.[skill.dataset.panel]||[]).map(a=>Object.fromEntries(all.columns.map((c,i)=>[c,a[i]]))));skill.querySelector('.skill-content').innerHTML=rows.length?table(['Method','Months to harvest#','Years#','Skill vs trend#','Skill 80% range','80% coverage#'],rows.map(x=>[METHOD[x.method]||x.method,x.lead,x.n_years,fmt(x.skill_vs_trend,3,true),x.skill_lo80==null?'–':`${fmt(x.skill_lo80,3,true)} to ${fmt(x.skill_hi80,3,true)}`,x.coverage_80==null?'–':pct(x.coverage_80*100)])):'No historical evaluation published for this country record.';}catch{skill.querySelector('.skill-content').textContent='Historical evaluation could not be loaded.';delete skill.dataset.loaded;}};
  const search = document.getElementById('record-search');
  if (search) search.oninput = () => { const q=search.value.toLocaleLowerCase().trim(); for(const li of document.querySelectorAll('[data-record-search]')) li.hidden=!li.dataset.recordSearch.includes(q); };
  const l = document.getElementById('layer-sel'); if (l) l.onchange = () => go(r, iso, key, {layer:l.value, ...(['progress','historical'].includes(l.value) && iso && !key && panelFor(r,iso)?.n_series===1 ? {season:null,series:null}: {})});
  const d = document.getElementById('date-sel'); if (d) d.onchange = () => { if (validDate(d.value)) go(r, iso, key, {date: d.value}); };
  const ys = document.getElementById('year-sel'), yo = document.getElementById('year-out');
  if (ys) { ys.oninput = () => { if (yo) yo.textContent = ys.value; }; ys.onchange = () => go(r, iso, key, {year: ys.value}); }
  const yp = document.getElementById('year-prev'); if (yp && ys) yp.onclick = () => go(r, iso, key, {year: Number(ys.value) - 1});
  const yn = document.getElementById('year-next'); if (yn && ys) yn.onclick = () => go(r, iso, key, {year: Number(ys.value) + 1});
  for (const el of document.querySelectorAll('[data-timeline-year]')) el.onclick = () => go(r, iso, key, {year: el.dataset.timelineYear});
  const m = document.getElementById('mask-chk'); if (m) m.onchange = () => go(r, iso, key, {mask: m.checked ? 'crop' : null});
  for (const a of document.querySelectorAll('[data-regional-axis]')) a.onclick = () => go(r, iso, key, {axis: a.dataset.regionalAxis === 'enso' ? null : 'year', to: null});
}
// Record discovery uses the catalog, including crop seasons outside the current prediction sample.
function panelChooser(r,iso,p) {
  const ps=panelsOf(iso,familyOf(r));
  return ps.length>1 ? `<label class="record-choice">Crop record <select id="record-panel-sel" aria-label="Crop record">${ps.map(x=>`<option value="${esc(x.key)}"${x.key===p.key?' selected':''}>${esc(cropSeason(x))}${x.record_only?' · historical records':''}</option>`).join('')}</select></label>` : '';
}
function countryDirectory(r,fam) {
  const entries=Object.entries(D.catalog.countries).filter(([iso])=>panelsOf(iso,fam).length).sort((a,b)=>a[1].name.localeCompare(b[1].name));
  return `<details class="record-directory"><summary>Browse countries · ${entries.length}</summary><label class="place">Find a country <input id="record-search" type="search" aria-label="Find a country"></label><ul class="placelist">${entries.map(([iso,c])=>`<li data-record-search="${esc(c.name.toLocaleLowerCase())}"><a href="${link(iso,null,qobj(r,{season:null,series:null,records:1}))}">${esc(c.name)}</a></li>`).join('')}</ul></details>`;
}
function placeDirectory(r,iso,units,p) {
  const entries=Object.entries(units.units).filter(([,u])=>hasSeries(u,p)).sort((a,b)=>unitLabel(a[1],iso,a[0]).localeCompare(unitLabel(b[1],iso,b[0])));
  return `<details class="record-directory"><summary>Find a place · ${entries.length}</summary><label class="place">Search place or region <input id="record-search" type="search" aria-label="Find a reporting place"></label><ul class="placelist">${entries.map(([key,u])=>{const s=seriesFor(u,p.crop_code,p.season);return `<li data-record-search="${esc((unitLabel(u,iso,key)+' '+key).toLocaleLowerCase())}"><a href="${link(iso,key,qobj(r,{crop:p.crop_code,season:p.season,series:null,records:null,axis:'year'}))}">${esc(unitLabel(u,iso,key))}</a> <span class="muted">${s.first}–${s.last}</span></li>`;}).join('')}</ul></details>`;
}
function seriesChooser(unit,selected) {
  return unit.series.length>1 ? `<label class="record-choice">Local series <select id="series-sel" aria-label="Local series">${unit.series.map(s=>`<option value="${esc(s.id)}" data-crop="${esc(s.crop_code)}" data-season="${esc(s.season)}"${s.id===selected?.id?' selected':''}>${esc(cropSeason(s))} · ${esc(sourceName(S.permission(s)))} · ${s.first}–${s.last}${s.basis&&s.basis!=='unknown'?' · '+esc(s.basis):''}</option>`).join('')}</select></label>` : '';
}
// The leave-one-year-out test supplies the full-season index whatever the months to harvest, so the release lists one
// identical row per lead; identical rows are shown once with the span of leads they cover (20 October 2026).
function skillRows(rows) {
  const groups = new Map();
  for (const x of rows) { const k = [x.method, x.n_years, x.skill_vs_trend, x.skill_lo80, x.skill_hi80, x.coverage_80].join('|'); const g = groups.get(k); if (g) g.leads.push(x.lead); else groups.set(k, {...x, leads: [x.lead]}); }
  return [...groups.values()].map(g => { const leads = g.leads.filter(l => l != null).sort((a, b) => a - b); return {...g, lead: leads.length > 1 ? `${leads[0]}–${leads[leads.length - 1]}` : g.lead}; });
}
function skillDisclosure(p) {
  return `<details id="skill-disclosure" class="record-table" data-panel="${esc(p.key)}"><summary>Historical skill</summary><p class="detail">Each harvest year is withheld and predicted using the remaining record and the observed seasonal ENSO index. Positive skill means improvement over the trend alone; these country-panel tests do not establish local or issued-forecast skill.</p><div class="skill-content table-scroll">Loading when opened…</div></details>`;
}
// Monthly ENSO observations and the saved scenario paths, shown only with a local history.
function ensoHistory(index = 'rel') {
  const rows = (D.world.index_path || []).filter(r => (r.index || 'rel') === index && Number.isFinite(r.value));
  if (!rows.length) return '';
  const time = r => r.year * 12 + r.month - 1;
  const first = Math.min(...rows.map(time)), last = Math.max(...rows.map(time));
  const bottom = Math.floor(Math.min(0, ...rows.map(r => r.value))), top = Math.ceil(Math.max(1, ...rows.map(r => r.value)));
  const x = t => 48 + (t-first)/Math.max(1,last-first)*540;
  const y = v => 184 - (v-bottom)/(top-bottom)*148;
  const observed = [...new Map(rows.filter(r => r.observed).map(r => [time(r),r])).values()].sort((a,b)=>time(a)-time(b));
  const cutoff = observed.at(-1);
  const path = rs => rs.map((r,i)=>(i?'L':'M')+x(time(r)).toFixed(2)+','+y(r.value).toFixed(2)).join(' ');
  const colors = {low:'#9b6226', medium:'#286da8', high:'#8663a3'};
  const labels = {low:'Low peak',medium:'Central peak',high:'High peak'};
  let svg = '';
  for (let v=bottom;v<=top;v++) svg += `<line x1="48" x2="588" y1="${y(v)}" y2="${y(v)}" stroke="${v===0?'#92918a':'#e4e3dc'}"/><text x="39" y="${y(v)+4}" text-anchor="end">${v}</text>`;
  for (let t=first;t<=last;t+=6) svg += `<text x="${x(t)}" y="205" text-anchor="middle">${monthName(t%12+1).slice(0,3)} ${Math.floor(t/12)}</text>`;
  for (const scenario of ['low','high','medium']) {
    const future=rows.filter(r=>!r.observed&&r.scenario===scenario).sort((a,b)=>time(a)-time(b));
    if(future.length) svg += `<path data-scenario="${scenario}" d="${path(cutoff?[cutoff,...future]:future)}" fill="none" stroke="${colors[scenario]}" stroke-width="2" stroke-dasharray="${scenario==='medium'?'6 3':'2 3'}"><title>${labels[scenario]} scenario</title></path>`;
  }
  svg += `<path data-observed="true" d="${path(observed)}" fill="none" stroke="#222" stroke-width="2.5"><title>Observed monthly ENSO</title></path>`;
  if(cutoff) svg += `<line x1="${x(time(cutoff))}" x2="${x(time(cutoff))}" y1="30" y2="184" stroke="#888" stroke-dasharray="3 3"/><text x="${x(time(cutoff))+6}" y="23">Scenarios →</text>`;
  return `<section class="enso-history" aria-label="ENSO history and seasonal scenarios"><h2>ENSO history and seasonal scenarios</h2><p class="detail">Monthly ${index==='std'?'':'relative '}Niño 3.4 (°C)</p><svg viewBox="0 0 620 220" role="img" aria-label="Observed ENSO followed by low, central and high peak scenarios"><title>ENSO observations and monthly scenarios</title>${svg}</svg><div class="enso-path-key"><span style="--path-color:#222">Observed</span>${['low','medium','high'].map(k=>`<span style="--path-color:${colors[k]}">${labels[k]}</span>`).join('')}</div><p class="detail">Outlook issued ${esc(D.world.issue)}. Future months follow the assumed 2015–16 shape, scaled to the peak outlook; the paths do not represent uncertainty in its timing.</p></section>`;
}
function collapseMethods(html) {
  return html.replace(/<h2 id="([^"]+)">([^<]+)<\/h2>([\s\S]*?)(?=<h2 id=|<\/div>$)/g, (_,id,title,body) => `<details class="method-section" id="${id}"><summary>${title}</summary>${body}</details>`);
}
const WEATHER_LABELS={tavg_mean:'Mean temperature (°C)',tmax_mean:'Mean daily maximum (°C)',tmin_mean:'Mean daily minimum (°C)',precip:'Rainfall (mm)',gdd:'Growing degree days',edd30:'Degree days above 30°C',kdd31:'Degree days above 31°C',tmax_p95_days:'Hot days (above historical 95th percentile)',wet_days:'Wet days',precip_p95_days:'Heavy-rain days',rx1day:'Largest 1-day rainfall (mm)',rx5day:'Largest 5-day rainfall (mm)',cdd:'Consecutive dry days',txx:'Maximum temperature (°C)'};
function recordTables(rec,preds,weather) {
  const fold=(title,head,rows)=>rows.length?`<details class="record-table"><summary>${esc(title)}</summary><div class="table-scroll">${table(head,rows)}</div></details>`:'';
  const observations=(rec?.obs||[]).filter(a=>Number.isFinite(a[1]));
  const anomalies=new Map((rec?.trend_anomaly||[]).map(a=>[a[0],a]));
  return fold('Reported yields',['Year#','Yield (t/ha)#','Trend (t/ha)#','Anomaly (%)#'],observations.map(a=>[a[0],fmt(a[1],3),fmt(anomalies.get(a[0])?.[2],3),pct(anomalies.get(a[0])?.[3])]))
    +fold('Published yield estimates and scenarios',['Method','Scenario','Harvest#','Change (%)#','Lower (%)#','Upper (%)#','Historical checks'],preds.map(p=>[METHOD[p.method]||p.method,SCEN[p.scenario]||p.scenario,p.harvest_year,pct(p.pct),pct(p.lo),pct(p.hi),window.AtlasRegionalPage.skillStatus(p)]))
    +fold('Additional weather measures',['Measure','Product','Harvest#','Through','Observed#','Reference#','Anomaly#'],weather.flatMap(w=>Object.entries(w.metrics||{}).map(([k,m])=>[WEATHER_LABELS[k]||k,w.product,w.harvest_year,w.data_end,fmt(m.value,2),fmt(m.reference,2),fmt(m.anom,2,true)])))
    +fold('Published weather relationships',['Measure','Index','Years#','Response per °C of ENSO#','Standard error#'],(rec?.responses||[]).filter(x=>x.variable!=='ly').map(x=>[WEATHER_LABELS[x.variable]||x.variable,x.index==='rel'?'Relative Niño 3.4':'Niño 3.4',x.n_years,fmt(x.slope_eb,3,true),fmt(x.se_eb,3)]))
    +fold('Data quality flags',['Year#','Check','Severity','Note'],rec?.qc||[]);
}
const crumbs = items => `<p class="crumbs">${items.map((it, i) => it.href && i < items.length - 1 ? `<a href="${it.href}">${esc(it.name)}</a>` : `<b>${esc(it.name)}</b>`).join('<span>›</span>')}</p>`;
// Use the reporting hierarchy from this release on every map and place page.
// The small names-only index supplies parents without loading every country's yield records.
function placeParts(u, iso, key) {
  const country = D.catalog.countries[iso]?.name || (u.level === 'national' ? u.name : iso);
  if (u.level === 'national' || key === iso) return [{key: iso, name: country}];
  const name = placeName(u.name || key);
  const parent = u.region_key || D.placeHierarchy?.parents[key];
  const region = placeName(u.region_name || D.placeHierarchy?.regions[parent]);
  const parts = [{key, name}];
  if (region && parent !== key && parent !== iso && region.toLocaleLowerCase() !== name.toLocaleLowerCase()) parts.push({key: parent, name: region});
  if (country) parts.push({key: iso, name: country});
  return parts;
}
const unitLabel = (u, iso, key) => placeParts(u, iso, key).map(p => p.name).join(', ');
const featureLabel = (f, iso, units) => f.properties.place_label || unitLabel(units?.units[f.id] || f.properties, f.properties.country || iso, f.id);
const hasSeries = (u, p) => u.series.some(s => s.crop_code === p.crop_code && s.season === p.season);
// ---- render ------------------------------------------------------------------------------------------------------
async function render() {
  window.AtlasRegionalPage.reset();
  const version = ++renderVersion; const r = route(); const view = document.getElementById('view');
  const localView = retainedLocalView?.href === location.hash ? retainedLocalView : null;
  retainedLocalView = null;
  try {
    await ensureRelease(r.q.get('release') || D.releases.default);
    if (version !== renderVersion) return;
    if (!r.iso) await renderWorld(view, r, version);
    else if (!D.catalog.countries[r.iso]) view.innerHTML = `${crumbs([{name: 'World', href: link(null, null, qobj(r))}, {name: r.iso}])}<p>No country ${esc(r.iso)} in release ${esc(D.release)}.</p>`;
    else if (r.key) await renderDetail(view, r, version, null, localView);
    else await renderCountry(view, r, version, localView);
    if (version !== renderVersion) return;
    bindControls(r, r.iso, r.key);
    if (!revealSection(r.q.get('to'))) window.scrollTo(0, localView?.scrollY || 0);
  } catch (e) { if (version === renderVersion) view.innerHTML = `<p>Something did not load: ${esc(e.message)}</p>`; }
}
// A watchlist orders existing estimates. It neither refits nor combines overlapping places.
function watchlist(r, fam, entries, local = false) {
  if (!isNew() || layerFor(r) !== 'outlook') return '';
  const eligible = entries.filter(x => Number.isFinite(x.pct) && Number.isFinite(x.effectMt)
    && (local || x.baselineMt >= 0.1) && (Math.abs(x.pct) >= WATCH_THRESHOLD || Math.abs(x.effectMt) >= 1));
  const group = sign => eligible.filter(x => Math.sign(x.pct) === sign)
    .sort((a,b) => Math.abs(b.effectMt)-Math.abs(a.effectMt) || a.name.localeCompare(b.name)).slice(0,3);
  const column = (sign, title) => {
    const selected = group(sign);
    return `<div class="watchlist-column"><h3>${title}</h3>${selected.length ? selected.map(x => `<a class="watchlist-item ${sign<0?'loss':'gain'}" href="${esc(x.href)}" data-watch-key="${esc(x.id)}" data-watch-pct="${x.pct}" data-watch-mt="${x.effectMt}">
      <span class="watchlist-place">${esc(x.name)}</span><span class="watchlist-record">${esc(x.record)}${x.year ? ` · harvest ${x.year}` : x.years ? ` · harvest ${esc(x.years)}` : ' · coming harvests'}</span>
      <span class="watchlist-value">${pct(x.pct)} <small>(${fmt(x.effectMt,2,true)} Mt)</small></span>
      <span class="watchlist-range">${hasOutlook80(x) ? `80% effect range ${pct(x.lo)} to ${pct(x.hi)}${zeroConsistent(x)?' · includes zero':''}` : 'Effect range unavailable'}</span>
      ${x.skill?`<span class="watchlist-range">Historical ENSO test: ${esc(x.skill)}</span>`:''}${x.postPeak?'<span class="watchlist-range">Post-peak ENSO evolution assumed</span>':''}
      ${x.beyondFit?'<span class="watchlist-range">Beyond the fitted ENSO range</span>':''}</a>`).join('') : '<p class="detail">No estimate meets the watchlist thresholds.</p>'}</div>`;
  };
  return `<section class="watchlist" id="watchlist" aria-label="${esc(FAMILY_LABEL[fam])} watchlist"><h2>${esc(FAMILY_LABEL[fam])} watchlist</h2>
    <p class="detail">${local?'Reporting places for this crop and season':'Country crop-season estimates'} with a change of at least 10% or 1 million tonnes${local?'':', and at least 0.1 million tonnes of covered baseline production'}. Up to three losses and gains, ranked by production effect.</p>
    <div class="watchlist-grid">${column(-1,'Larger losses')}${column(1,'Larger gains')}</div>
    <p class="credit">Conditional on the saved ENSO path; future months follow the scaled 2015–16 evolution. Mt = million tonnes at fixed harvested area, over the covered production base. The nominal ranges describe the ENSO effect; total harvest uncertainty is wider. Inclusion reflects magnitude. Historical tests use observed ENSO and local yield errors; issued-forecast skill remains unassessed.</p></section>`;
}
function worldWatchlist(r, fam) {
  return watchlist(r, fam, D.panels.filter(p=>p.crop_family===fam).map(p=>({...p,...D.watchlistContext?.[p.key],id:p.key,
    name:D.catalog.countries[p.iso3]?.name||p.iso3,record:cropSeason(p),baselineMt:p.baseline_production_mt,effectMt:p.dprod_mt,
    href:link(p.iso3,null,qobj(r,{crop:p.crop_code,season:p.season,series:null,records:null,harvest:null,to:null,axis:null}))})));
}
function countryWatchlist(r, units, p, hy) {
  const candidates = Object.entries(units.units).filter(([,u])=>hasSeries(u,p));
  const hasLocal = candidates.some(([,u])=>u.level!=='national');
  const entries = candidates.filter(([,u])=>!hasLocal||u.level!=='national').map(([key,u])=>{
    const s=seriesFor(u,p.crop_code,p.season),m=medium(S.predictions(units,s).filter(x=>x.harvest_year===hy)),w=S.weight(units,s);
    if(!Number.isFinite(m?.pct)||!w?.covered||w.target_year!==hy||!Number.isFinite(w.baseline_production_t))return null;
    return {...m,id:key,name:unitLabel(u,units.iso3,key),record:cropSeason(p),year:m.harvest_year,beyondFit:m.beyond_fit,
      effectMt:w.baseline_production_t*m.pct/100/1e6,
      href:seriesLink(units.iso3,key,qobj(r,{crop:p.crop_code,season:p.season,series:s.id,records:null,harvest:hy,to:null}))};
  }).filter(Boolean);
  return watchlist(r,p.crop_family,entries,true);
}

async function renderWorld(view, r, version) {
  if (r.q.get('to') === 'reference') {
    view.innerHTML = `<a href="${link(null,null,{release:D.release})}">← Back to the atlas</a><h1>Detailed release documentation</h1><p><a href="../references.html">Data sources and references</a></p>${detailedMethods(familyOf(r))}`;
    return;
  }
  const fam = familyOf(r), layer = layerFor(r), date = dateFor(r), season = r.q.get('season');
  if (layer === 'progress') await worldCalendar();
  const anomaly = layer === 'anomaly' ? await loadAnomalyLayer(r, fam) : null;
  if (version !== renderVersion) return;
  const byIso = new Map(); for (const p of D.panels.filter(p => p.crop_family === fam)) { const cur = byIso.get(p.iso3); if (!cur || (p.season === season && cur.season !== season) || (cur.season !== season && (p.baseline_production_mt || 0) > (cur.baseline_production_mt || 0))) byIso.set(p.iso3, p); }
  const q = qobj(r,{season:null,series:null,records:null,harvest:null});
  const countryLink = iso => { const p=byIso.get(iso); return link(iso,null,{...q,crop:p?.crop_code||fam,season:layer==='progress'?null:p?.season}); };
  const cell = f => {
    const p = byIso.get(f.id); if (!p) { const available=panelsOf(f.id,fam).length; return {color:available ? C.notEstimated : C.none, words:available ? (layer==='outlook'?'Historical records available; no current outlook':'Local records available; open the country to view its calendars') : `No ${FAMILY_LABEL[fam].toLowerCase()} records`}; }
    if (layer === 'outlook') return p.pct == null ? {color: C.notEstimated, words: 'Current estimate unavailable'} : {color: outlookColor(p.pct), zeroConsistent:zeroConsistent(p), words: `Yield ${pct(p.pct)} from usual (${pct(p.lo)} to ${pct(p.hi)}) · harvest ${p.harvest_year}${outlookIntervalNote(p)}`};
    // The anomaly layer: the national series of the panel, or of the family where the panel has none, named with its crop and
    // season; the local units are drawn over it below, and a year the national series does not report is grey.
    if (layer === 'anomaly') {
      const nat = anomaly.file.national[f.id]; const series = nat ? `${cap(cropLabel(nat[1]))}, ${seasonWords(nat[2])} · national series` : null;
      if (!nat) return {color: C.notEstimated, words: 'Local records only; no national series for this crop', series};
      const row = anomalyRow(anomaly.file, nat[0], anomaly.year);
      return row ? {color: diverging(row.anomaly, ANOMALY_LIMIT, YIELD_PALETTE), words: anomalyWords(row, anomaly.year), series} : {color: C.notEstimated, words: `No reported national yield for harvest ${anomaly.year}`, series};
    }
    const hy = harvestFor(r, p); const row = worldCalRow(p.key, hy); const st = calStatus(row, date, row?.cycle_unresolved); const c = calCell(layer, st);
    return {...c, words: `${c.words}<br>${row?.plant_date ? `Planted ${longDate(row.plant_date)}, harvest ${longDate(row.harvest_date)} · national calendar, ${esc(calendarLabel(row))}` : `No national calendar published for harvest ${hy}`}`};
  };
  const world = await load(D.base + 'geometry/world.json'); if (version !== renderVersion) return;
  const fc = {type: 'FeatureCollection', features: world.features.filter(f => f.id !== 'ATA').map(f => { const c = cell(f); return projectFeature({...f, properties: {...f.properties, color: c.color, zeroConsistent:!!c.zeroConsistent, harvestDay: c.harvestDay, words: c.words, series: c.series || null, localDetail: (byIso.get(f.id)?.n_series || 0) > 1}}); })};
  const calendarRange = layer === 'progress' ? harvestScale(fc) : null;
  const title = layer === 'anomaly' ? `${FAMILY_LABEL[fam]} harvests of ${anomaly.year} against trend` : `El Niño and the harvest of ${D.panels.some(p => p.harvest_year === 2027) ? '2026–27' : '2026'}`;
  const drawn = layer === 'anomaly' ? `harvest ${anomaly.year}: ${num(anomaly.index.counts_world?.[fam]?.[anomaly.year] || 0)} series with a reported yield · every reporting unit with a record of the crop is drawn, the national series beneath them and elsewhere` : layer === 'outlook' ? 'reporting units are drawn where a country has them, national totals elsewhere' : 'dotted outlines mark countries with local records';
  view.innerHTML = `<h1>${esc(title)}</h1>${controls(r, fam, layer, date, anomaly && yearControlFor(anomaly, fam))}${mapLegend(layer, fam, maskOn(r), calendarRange, anomaly?.year)}<div id="wmap" class="map world" role="img" aria-label="World map coloured by the selected layer"></div>
    <p class="credit" id="world-credit">Release ${esc(D.release)} · ENSO outlook issued ${esc(D.world.issue)} (${esc(D.world.index.outlook.source)}) · weather to ${esc(longDate(D.world.data_end))} · ${drawn} · click a country to open it${maskOn(r) ? maskWords : ''}</p>
    ${worldWatchlist(r, fam)}${methods(fam)}`;
  drawMap('wmap', fc, f => { const p = byIso.get(f.id); return `<b>${esc(f.properties.name)}</b>${f.properties.series ? `<br>${esc(f.properties.series)}` : p ? `<br>${esc(cropSeason(p))}` : ''}<br>${f.properties.words}`; }, f => { if (D.catalog.countries[f.id]) location.hash = countryLink(f.id); }, WORLD_BOUNDS, null, null, maskOn(r) ? {mask: {image: MASK_WORLD(fam)}} : {});
  // The regional detail, drawn over the country fill once its coarse geometry has loaded (geometry/world_units.json carries
  // every reporting unit below the national level). The outlook layer draws the local units of the panel each country is
  // coloured by (world_units.json, 2026-10-09 contract). The anomaly layer draws every unit with a record of the family
  // (the family file's units map, 19 October 2026), so records that end before the outlook period, such as the Australian
  // wheat states to 2008, still appear; a unit without a reported yield in the chosen year is not drawn.
  if ((layer === 'outlook' || layer === 'anomaly') && isNew()) {
    const [wu, geo] = await Promise.all([layer === 'outlook' ? load(D.base + 'world_units.json').catch(() => null) : null, load(D.base + 'geometry/world_units.json').catch(() => null)]);
    if (version !== renderVersion || !geo || (layer === 'outlook' && !wu)) return;
    let feats;
    if (layer === 'anomaly') {
      const loc = anomaly.file.units || {};
      feats = geo.features.filter(f => loc[f.id]).map(f => { const [sid, crop, season] = loc[f.id]; const row = anomalyRow(anomaly.file, sid, anomaly.year);
        return row ? projectFeature({...f, properties: {...f.properties, color: diverging(row.anomaly, ANOMALY_LIMIT, YIELD_PALETTE), zeroConsistent: false, series: `${cap(cropLabel(crop))}, ${seasonWords(season)}`, words: anomalyWords(row, anomaly.year)}}) : null; }).filter(Boolean);
    } else {
      const vals = wu.units[fam] || {}; const cols = wu.columns;
      feats = geo.features.filter(f => vals[f.id] && wu.panels?.[fam]?.[f.properties.country] === byIso.get(f.properties.country)?.key).map(f => { const v = Object.fromEntries(cols.map((c, i) => [c, vals[f.id][i]]));
        return projectFeature({...f, properties: {...f.properties, color: v.pct == null ? C.notEstimated : outlookColor(v.pct), zeroConsistent:zeroConsistent(v), words: v.pct == null ? 'Current estimate unavailable' : `Yield ${pct(v.pct)} from usual (${pct(v.lo)} to ${pct(v.hi)}) · harvest ${v.harvest_year}${outlookIntervalNote(v)}`}}); });
    }
    // A click on a unit opens its country (the user's rule of 10 October 2026, evening): the country map shows the
    // units, and only the largest countries put the state level between the country and the unit.
    overlayUnits('wmap', {type: 'FeatureCollection', features: feats}, f => { const p = byIso.get(f.properties.country); return `<b>${esc(featureLabel(f))}</b>${f.properties.series ? `<br>${esc(f.properties.series)}` : p ? `<br>${esc(cropSeason(p))}` : ''}<br>${f.properties.words}`; },
      f => { if (D.catalog.countries[f.properties.country]) location.hash = countryLink(f.properties.country); });
  }
}
async function renderCountry(view, r, version, localView) {
  const iso = r.iso, c = D.catalog.countries[iso], fam = familyOf(r), q = qobj(r);
  let p=panelFor(r,iso);
  if (!p) { view.innerHTML = `${crumbs([{name: 'World', href: link(null, null, q)}, {name: c.name}])}<h1>${esc(c.name)}</h1><p>No ${FAMILY_LABEL[fam].toLowerCase()} records for ${esc(c.name)} in release ${esc(D.release)}. Crops with records: ${D.catalog.families.filter(f => panelsOf(iso, f).length).map(f => `<a href="${link(iso, null, {...q, crop: f, season: null})}">${FAMILY_LABEL[f].toLowerCase()}</a>`).join(', ') || 'none'}.</p>`; return; }
  const layer=layerFor(r),date=dateFor(r);
  const [units, geo, , anomaly] = await Promise.all([loadUnits(iso, fam), load(D.base + `geometry/${iso}.json`).catch(() => null), layer === 'progress' ? worldCalendar() : null, layer === 'anomaly' ? loadAnomalyLayer(r, fam) : null]);
  if (version !== renderVersion) return;
  // A national forecast fallback must not hide the available district calendars.
  if(['progress','historical','anomaly'].includes(layer)&&!r.q.get('season')) {
    const candidates=panelsOf(iso,fam).map(p=>({p,n:Object.values(units.units).filter(u=>u.level!=='national'&&hasSeries(u,p)).length})).sort((a,b)=>b.n-a.n);
    if(candidates[0]?.n) p=candidates[0].p;
  }
  const hy=harvestFor(r,p),q2={...q,crop:p.crop_code,season:p.season};
  const regionList = [...new Map(Object.values(units.units).filter(u => u.region_key && hasSeries(u, p)).map(u => [u.region_key, u.region_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const regions = await loadRegions(iso, units, regionList); if (version !== renderVersion) return;
  const matching = Object.entries(units.units).filter(([,u])=>hasSeries(u,p));
  const localRecords=Object.values(units.units).filter(u=>u.level!=='national' && u.series.some(s=>s.crop_family===fam));
  if (!r.q.get('records') && !p.record_only && matching.length === 1 && !localRecords.length) return renderDetail(view,r,version,matching[0][0],localView);
  const localAlternatives=localRecords.filter(u=>!hasSeries(u,p));
  const localSeries=localAlternatives.flatMap(u=>u.series.filter(s=>s.crop_family===fam));
  const historicNote=matching.length===1 && localSeries.length ? `<p class="credit">Current outlook: national. ${num(localAlternatives.length)} local ${esc(cropLabel(p.crop_code))} records cover ${Math.min(...localSeries.map(s=>s.first))}–${Math.max(...localSeries.map(s=>s.last))}${units.historical ? `. <a href="${link(iso,null,{...q,layer:'historical',season:null,series:null})}">Explore historical local responses</a>.` : ' and appear on the harvest-anomaly layer.'}</p>` : '';
  const cell = unitCell(units, p, layer, date, hy, null, indexFor(r), anomaly?.year);
  const big = !p.record_only && isBig(units, p);
  const natSeries = anomaly && units.units[iso] ? seriesFor(units.units[iso], p.crop_code, p.season) : null, natRow = natSeries ? anomalyRow(anomaly.file, natSeries.id, anomaly.year) : null;
  const headline = layer === 'historical' ? 'historical relationships; current-harvest applicability is assessed separately' : layer === 'anomaly' ? (natRow ? `national series ${pct(natRow.anomaly)} from trend in ${anomaly.year}` : natSeries ? `no reported national yield for harvest ${anomaly.year}` : 'no national series for this crop and season') : p.record_only ? 'historical records; no current outlook' : `country outlook ${pct(p.pct)} from usual (${pct(p.lo)} to ${pct(p.hi)})`;
  view.innerHTML = `${crumbs([{name: 'World', href: link(null, null, q)}, {name: c.name}])}<h1>${esc(c.name)}: ${esc(cropSeason(p).toLowerCase())}${layer==='historical'?' · historical ENSO response':`, harvest ${layer === 'anomaly' ? anomaly.year : hy}`}</h1>${controls(r, fam, layer, date, anomaly && yearControlFor(anomaly, fam))}${panelChooser(r,iso,p)}${historicNote}
    ${mapLegend(layer, fam, maskOn(r), null, anomaly?.year)}<div id="cmap" class="map" role="img" aria-label="Country map of reporting units"></div>
    <p class="credit">${matching.length} reporting places · ${headline} · ${big ? 'click a state to open it, then a unit' : 'click a unit to open its page'}${maskOn(r) ? maskWords : ''}</p>
    <p class="credit">Yields: ${esc(sourcesOf(units, p))}. Calendars as named in each unit's details. Boundaries: ${esc(c.name)} reporting units as published by the sources.</p>${countryWatchlist(r,units,p,hy)}${placeDirectory(r,iso,units,p)}`;
  if (!geo) { document.getElementById('cmap').innerHTML = `<p class="map-note">No boundary file for this country. ${regionList.map(([k, n]) => `<a href="${seriesLink(iso, k, q2)}">${esc(unitLabel({name:n,level:"region"},iso,k))}</a>`).join(' · ')}</p>`; return; }
  const fc = unitCollection(geo, units, cell);
  // Region files name the state and its centre; the key comes from the units that carry that name.
  const regionKey = new Map(regionList.map(([k, n]) => [n, k]));
  const fit = countryBounds(geo, iso, units, p);
  if (layer === 'progress') { const range = harvestScale(fc); view.querySelector('.legend').outerHTML = mapLegend(layer, fam, maskOn(r), range); }
  const tip = f => `<b>${esc(featureLabel(f,iso,units))}</b><br>${f.properties.words}${big && units.units[f.id]?.region_key ? `<br><span class="muted">Opens ${esc(units.units[f.id].region_name)}</span>` : ''}`;
  // The country map behaves as the local map does (the user's request of 20 October 2026): it can be dragged, the
  // neighbours' units arrive with their files, and a neighbour's unit opens with its own country's panel.
  const openOnCountryMap = f => {
    const c2 = f.properties.country || iso;
    if (c2 !== iso) {
      const pk = D.worldUnits?.panels?.[fam]?.[c2]; const pp = f.properties.crop_code ? {crop_code:f.properties.crop_code,season:f.properties.season} : pk ? D.panelByKey.get(pk) : null;
      selectInLocalMap(pp && f.properties.level !== 'national' ? link(c2, f.id, {...q, crop: pp.crop_code, season: pp.season, axis: null}) : link(c2, null, {...q, axis: null})); return;
    }
    const u = units.units[f.id]; if (!u || f.properties.selectable===false) return;
    openSeries(iso, big && u.region_key && u.level !== 'national' ? u.region_key : f.id, {...q2,series:null,crop:f.properties.crop_code||p.crop_code,season:f.properties.season||p.season});
  };
  const onPanCountry = map => { if (version !== renderVersion) return; loadNeighbours('cmap', map.getBounds().toArray(), iso, fam, layer, version, Number(r.q.get('harvest'))||null, anomaly?.year).catch(() => {}); };
  drawMap('cmap', fc, tip, openOnCountryMap, fit, regions, n => regionKey.has(n) ? seriesLink(iso, regionKey.get(n), q2) : null, {draggable:true, onPan:onPanCountry, ...(maskOn(r) ? {mask: {tiles: MASK_TILES(fam)}} : {})});
}
// The colour and words of a unit polygon for the selected layer; shared by the country, state and unit maps.
function unitCell(units, p, layer, date, hy, selectedSeries, index='rel', year=null) {
  return f => {
    const u = units.units[f.id], s = u && (u.series.find(s=>selectedSeries && String(s.id)===String(selectedSeries)) || seriesFor(u,p.crop_code,p.season));
    if (!s) {
      const alt=u?.series.filter(s=>s.crop_family===p.crop_family).sort((a,b)=>Number(b.crop_code===p.crop_code)-Number(a.crop_code===p.crop_code)||a.tier-b.tier||(b.n||0)-(a.n||0))[0];
      // The anomaly layer colours the unit by its series of the family where none matches the panel's crop and season, the
      // world map's rule (19 October 2026): China's counties report wheat for the main season beside a national annual
      // record, and were left outline-only under the national fill.
      if (layer === 'anomaly' && alt) {
        const row = anomalyRow(anomalyFile(p.crop_family), alt.id, year);
        return {hasRecord:true, crop_code:alt.crop_code, season:alt.season, color: row ? diverging(row.anomaly, ANOMALY_LIMIT, YIELD_PALETTE) : C.notEstimated,
                words: `${esc(cropSeason(alt))}<br>${row ? anomalyWords(row, year) : `No reported yield for harvest ${year} · records ${alt.first}–${alt.last}`}`};
      }
      return {hasRecord:false,selectable:!!alt,crop_code:alt?.crop_code,season:alt?.season,color:C.none,words:alt ? `${esc(cropSeason(alt))} · records ${alt.first}–${alt.last}<br>No current outlook for this record; click for its history` : `No ${cropLabel(p.crop_code)} records for this season`};
    }
    if(layer==='historical') {
      const h=S.responses(units,s).find(x=>x.variable==='ly'&&x.index===index);
      const sk=units.historical?.[s.id]?.validation?.find(x=>x.index===index);
      return {hasRecord:true,color:diverging(h?.pct_eb,OUTLOOK_LIMIT,YIELD_PALETTE),words:h?.pct_eb==null ? `${esc(units.historical?.[s.id]?.historical_reason||'Historical response unavailable')} · records ${s.first}–${s.last}` : `Historical yield response ${pct(h.pct_eb)} per +1 °C ${index==='std'?'standard':'relative'} Niño 3.4<br>95% interval ${pct(h.lo_eb)} to ${pct(h.hi_eb)} · ${h.year_first??s.first}–${h.year_last??s.last}<br>${sk?.skill_vs_trend!=null ? `Held-year test: ${sk.skill_vs_trend>0?'improvement over':'no improvement over'} trend only` : 'Held-year skill not assessed for this record'}<br>Historical relationship; current outlook assessed separately`};
    }
    // The anomaly layer: the series' departure in the chosen year from the family file loaded by the page; grey where the
    // series reports no yield for that year.
    if (layer === 'anomaly') {
      const row = anomalyRow(anomalyFile(p.crop_family), s.id, year);
      return row ? {hasRecord:true, color: diverging(row.anomaly, ANOMALY_LIMIT, YIELD_PALETTE), words: anomalyWords(row, year)} : {hasRecord:true, color: C.notEstimated, words: `No reported yield for harvest ${year} · records ${s.first}–${s.last}`};
    }
    if (layer === 'outlook') { const m = medium(S.predictions(units, s).filter(x=>x.harvest_year===hy)); return m?.pct == null ? {hasRecord:true, color: C.notEstimated, words: `Historical records only (${s.first}–${s.last}); no current estimate for harvest ${hy}${units.historical?.[s.id] ? '<br>Historical ENSO response available' : ''}`} : {hasRecord:true, color: outlookColor(m.pct), zeroConsistent:zeroConsistent(m), words: `Yield ${pct(m.pct)} from usual (${pct(m.lo)} to ${pct(m.hi)}) · harvest ${m.harvest_year}${m.beyond_fit ? ' · beyond the fitted range' : ''}${outlookIntervalNote(m)}`}; }
    const row = S.calendar(units, s).find(x => x.harvest_year === hy) || null;
    const st = calStatus(row, date, row?.cycle_unresolved); const cc = calCell(layer, st);
    return {...cc, hasRecord:true, words: `${cc.words}<br>${row ? `Planted ${longDate(row.plant_date)}, harvest ${longDate(row.harvest_date)} · ${esc(calendarLabel(row))}` : `No calendar for harvest ${hy}`}`};
  };
}
// The polygons of a map: the national polygon first and unfilled where the country has local units (it lay over the
// county fills and washed them out), every other polygon coloured by `cell`, and `selected` marked for the highlight.
function unitCollection(geo, units, cell, keep, selected) {
  const feats = geo.features.filter(f => !keep || keep(f));
  const cells = new Map(feats.map(f => [f.id,cell(f)]));
  const local = feats.some(f => f.properties.level !== 'national' && cells.get(f.id).hasRecord);
  const nationalOnly = !local && feats.some(f => f.properties.level === 'national' && cells.get(f.id).hasRecord);
  const ordered = [...feats.filter(f => f.properties.level === 'national'), ...feats.filter(f => f.properties.level !== 'national')];
  // A single place is outlined; a set of places (a state's units) keeps its colours while everything else fades.
  const many = selected instanceof Set;
  const out = ordered.map(f => { const national = f.properties.level === 'national'; const cc = cells.get(f.id); const outlineOnly = nationalOnly && !national; const color = national && local ? '#eef0ee' : cc.color; const member = many ? selected.has(f.id) : f.id === selected;
    return {...f, properties: {...f.properties, place_label:featureLabel(f,units.iso3,units), color, zeroConsistent:!!cc.zeroConsistent && !outlineOnly && !(national && local), outlineOnly, selectable:(cc.hasRecord || cc.selectable || false) && !(national && local), crop_code:cc.crop_code, season:cc.season, harvestDay: cc.harvestDay, words: cc.words, reporting: !!cc.hasRecord && !outlineOnly && !(national && local), selected: !many && member, member}}; });
  return {type: 'FeatureCollection', features: layered(out)};
}
// Drawing order where unit sets overlap (Zambia carries the Hultgren districts and the FEWS NET districts): the
// national polygon first, then the units without a value for the panel, then the coloured units, so a unit that
// has no record for this crop never covers one that has.
const layered = feats => [...feats.filter(f => f.properties.level === 'national'), ...feats.filter(f => f.properties.level !== 'national' && f.properties.color === C.none), ...feats.filter(f => f.properties.level !== 'national' && f.properties.color !== C.none)];
const isBig = (units, p) => Object.values(units.units).filter(u => u.region_key && u.level !== 'national' && hasSeries(u, p)).length >= BIG_COUNTRY_UNITS && new Set(Object.values(units.units).filter(u => u.region_key).map(u => u.region_key)).size > 1;
function sourcesOf(units, p) { const s = new Set(); for (const u of Object.values(units.units)) for (const x of u.series) if (x.crop_code === p.crop_code && x.season === p.season) s.add(sourceName(S.permission(x))); return [...s].join('; '); }
// The series of a unit for a crop and season; where a unit carries several (area basis, source), the first tier and then the longest.
function seriesFor(unit, crop, season) { const c = unit.series.filter(x => x.crop_code === crop && x.season === season); return c.sort((a, b) => a.tier - b.tier || (b.n || 0) - (a.n || 0))[0] || null; }
// ---- the detail page ---------------------------------------------------------------------------------------------
// A unit page and a state page share one layout (10 October 2026): the map of the state at the top, three rows of a
// chart and three numbers (temperature, rainfall, yield), and the notes at the bottom. A state page draws the state
// record of the panel, which the exporter writes in the shape of a unit record: the area-weighted average of the
// state's units, with the hierarchical state center as its yield response. The paper that accompanies the atlas
// carries the method; the page carries the numbers and a few sentences of notes.
async function renderDetail(view, r, version, forcedKey, localView) {
  const iso = r.iso, c = D.catalog.countries[iso], fam = familyOf(r), q = qobj(r), key = forcedKey || r.key;
  const availableUnits = await loadUnits(iso,fam);
  const requestedPanel=panelFor(r,iso);
  // Old national links sometimes carry a county season. Resolve that record at country level,
  // instead of silently substituting an annual national series and a 1000-km local viewport.
  if (availableUnits.units[key]?.level==='national' && requestedPanel && !hasSeries(availableUnits.units[key],requestedPanel) && Object.values(availableUnits.units).some(u=>u.level!=='national'&&hasSeries(u,requestedPanel))) {
    r.key=null; window.history?.replaceState(null,'',link(iso,null,qobj(r,{series:null})));
    return renderCountry(view,r,version);
  }
  const selectionUnit=availableUnits.units[key] || {series:Object.values(availableUnits.units).filter(u=>u.region_key===key).flatMap(u=>u.series)};
  const p = panelFor(r,iso,selectionUnit);
  if (!p) return renderCountry(view, r, version);
  const [units, country, geo, pd] = await Promise.all([loadUnits(iso, fam), loadCountry(iso), load(D.base + `geometry/${iso}.json`).catch(() => null), panelDetail(p)]);
  if (version !== renderVersion) return;
  const unit = units.units[key];
  const regionUnits = Object.entries(units.units).filter(([, u]) => u.region_key === key);
  const stateKey = unit ? unit.region_key : key;
  const stateRows = stateKey ? regionRows(country, stateKey, p.crop_code, p.season) : [];
  const region = !unit && (stateRows.length || regionUnits.length) ? {region_key: key, region_name: stateRows[0]?.region_name || regionUnits[0]?.[1].region_name || key} : null;
  if (!unit && !region) { view.innerHTML = `${crumbs([{name: 'World', href: link(null, null, q)}, {name: c.name, href: link(iso, null, q)}, {name: key}])}<p>No place ${esc(key)} in ${esc(c.name)} for ${esc(cropSeason(p).toLowerCase())}.</p>`; return; }
  const q2 = {...q, crop: p.crop_code, season: p.season};
  const us = unit ? unit.series.find(s=>String(s.id)===r.q.get('series')) || seriesFor(unit, p.crop_code, p.season) : null;
  const hy = harvestFor(r, p), axis = axisFor(r), index = indexFor(r);
  let rec = us ? await loadRecord(iso, fam, key, us, units) : region ? await loadStateRecord(iso, key, p) : null;
  if (us && unit.level === 'national') rec = await loadNationalWeather(iso, us, rec);
  if (version !== renderVersion) return;
  // The series of the page: the unit's, or the state record standing in for one.
  const s = us || (rec ? {id: rec.id, crop_code: p.crop_code, season: p.season, n: rec.trend?.n_years ?? (rec.obs || []).length, first: rec.trend?.year_first ?? rec.obs?.[0]?.[0] ?? null, last: rec.trend?.year_last ?? rec.obs?.[rec.obs.length - 1]?.[0] ?? null, state: true, n_units: rec.n_units} : null);
  const level = s?.state ? 'state' : 'unit';
  const isPublic = us ? S.isPublic(us) : !!s;
  const withheld = us ? (rec?.withheld || (rec && rec.obs == null ? 'observations withheld under the publication rule' : null) || (isPublic ? null : 'observations withheld under the publication rule')) : null;
  const permission = us ? S.permission(us) : null;
  const name = unit ? placeName(unit.name) : region.region_name;
  const national = unit && unit.level === 'national';
  // A unit that is its own state (a Zimbabwean province, an Australian state) is not named twice.
  const inState = !!(unit && unit.region_key && !national && unit.region_key !== key && unit.region_name !== name);
  const trail = [{name: 'World', href: link(null, null, q)}, {name: c.name, href: link(iso, null, q)}];
  if (inState) trail.push({name: placeName(unit.region_name), href: link(iso, unit.region_key, q2)});
  if (!national) trail.push({name});
  // The calendar: the unit's; for a state the calendar of its first unit with the series, which the state's units share.
  const memberS = null; // A state contains different calendars; never label one county's dates as the state's.
  const calendar = us ? S.calendar(units, us) : memberS ? S.calendar(units, memberS) : []; const win = calendar.find(w => w.harvest_year === hy) || null;
  const preds = us ? S.predictions(units, us).filter(x => x.harvest_year === hy) : [];
  const med = medium(preds), wt = preds.find(x => x.method === 'weather_todate');
  const resp = us ? S.responses(units, us).find(x => (x.variable || 'ly') === 'ly' && x.index === index) || null
    : (rec && index === 'rel' ? (rec.responses || []).find(x => x.variable === 'ly' && x.index === 'rel') || null : null);
  const respWithheld = resp && resp.pct_eb == null && !s?.state ? (resp.note || 'no_own_slope') : null;
  const historical=us ? units.historical?.[us.id] : null;
  const historicalValidation=historical?.validation?.find(x=>x.index===index);
  const layer=!r.q.get('layer') && historical?.responses?.some(x=>x.variable==='ly'&&x.pct_eb!=null) && med?.pct==null ? 'historical' : layerFor(r), date=dateFor(r);
  // Preserve this explicit quantity when a reader clicks another county or changes the chart axis.
  if(layer==='historical') {r.q.set('layer',layer);q2.layer=layer;}
  const anomaly = layer === 'anomaly' ? await loadAnomalyLayer(r, fam) : null;
  if (version !== renderVersion) return;
  // The state and country rows: under 2026-10-09 the central outlook aggregates (pct_mean with its 80% range);
  // under 2026-10-08 the response_region and response_country rows for the index.
  const stateRow = isNew() ? stateRows.find(x => x.method === 'index_outlook' && x.scenario === 'medium' && x.target_year === hy) || null : stateRows.find(x => x.index === index) || null;
  const countryRow = isNew() ? pd.aggregate.find(x => x.method === 'index_outlook' && x.scenario === 'medium' && x.target_year === hy) || null : (country.responses || []).find(x => x.crop_code === p.crop_code && x.season === p.season && x.index === index && x.window === 'season') || pd.response;
  const weather = (rec?.weather || []).filter(w=>w.harvest_year === hy);
  const best = weather.find(w => w.product === 'best') || weather.find(w=>w.metrics?.tavg_mean), chirps = weather.find(w => w.product === 'chirps') || weather.find(w=>w.metrics?.precip);
  const temp = best?.metrics?.tavg_mean ? {...best, m: best.metrics.tavg_mean} : null;
  const rain = chirps?.metrics?.precip ? {...chirps, m: chirps.metrics.precip} : null;
  // The greenness so far (14 October 2026): product vhp, the crop-weighted NOAA STAR VHP NDVI of the window to date.
  const vhp = weather.find(w => w.product === 'vhp') || weather.find(w => w.metrics?.ndvi_mean);
  const green = vhp?.metrics?.ndvi_mean ? {...vhp, m: vhp.metrics.ndvi_mean} : null;
  // The weather-variable responses of the record: the fitted slope of the seasonal metric per +1 °C of the relative
  // index, drawn as a line through the origin.
  const wresp = v => (rec?.responses || []).find(x => x.variable === v && x.index === index) || null;
  const tResp = wresp('tavg_mean'), pResp = wresp('precip'), nResp = wresp('ndvi_mean');
  // Reconciled releases use their saved quantiles; a missing interval remains missing.
  const lineCurve = x => {
    if (!x || x.slope_eb == null || axis !== 'enso') return null;
    // the band is the saved 80% slope quantiles, the level of the headline range (20 October 2026); the 95%
    // quantiles remain for releases that stored only those, and the plug-in SE for releases before the saved quantiles
    const q = Number.isFinite(x.slope_lo80) && Number.isFinite(x.slope_hi80) ? [x.slope_lo80,x.slope_hi80]
      : Number.isFinite(x.slope_lo) && Number.isFinite(x.slope_hi) ? [x.slope_lo,x.slope_hi]
      : !isReconciled() && Number.isFinite(x.se_eb) ? [x.slope_eb-1.96*x.se_eb,x.slope_eb+1.96*x.se_eb] : null;
    return {fn:v=>x.slope_eb*v,...(q?{lo:v=>Math.min(q[0]*v,q[1]*v),hi:v=>Math.max(q[0]*v,q[1]*v)}:{})};
  };
  // The shared horizontal axis: growing-season ENSO exposure of the record (relative Niño 3.4 by default) or harvest year.
  const ensoCol = index === 'std' ? 1 : 2; const expo = rec ? (rec.enso || []).filter(a => a[ensoCol] != null) : [];
  const historyYears=[hy,...(rec?.obs||[]).map(a=>a[0]),...(rec?.weather_history||[]).filter(a=>Number.isFinite(a[1])||Number.isFinite(a[2])).map(a=>a[0])];
  const xs = expo.map(a => a[ensoCol]); const x0 = axis === 'enso' ? (xs.length ? Math.floor(Math.min(...xs) * 2) / 2 : -2) : Math.min(hy-10,...historyYears), x1 = axis === 'enso' ? (xs.length ? Math.max(Math.ceil(Math.max(...xs) * 2) / 2,Math.floor(Math.min(...xs)*2)/2+.5) : 2.5) : Math.max(...historyYears);
  const xLabel = axis === 'enso' ? `Growing-season Niño 3.4${index === 'std' ? '' : ', relative'}, °C` : 'Harvest year';
  const ax = {mode: axis, x0, x1, xLabel, hy};
  const expCurve = (b0, l0, h0, coefficients=null) => {
    const b=Number.isFinite(coefficients?.slope_eb)?coefficients.slope_eb:Math.log1p(b0/100),curve={fn:x=>100*Math.expm1(b*x)};
    const q80=Number.isFinite(coefficients?.slope_lo80)&&Number.isFinite(coefficients?.slope_hi80);   // the 80% quantiles first (20 October 2026)
    const direct=q80||(Number.isFinite(coefficients?.slope_lo)&&Number.isFinite(coefficients?.slope_hi));
    if(direct||(Number.isFinite(l0)&&Number.isFinite(h0)&&l0>-100&&h0>-100)){
      const bl=q80?coefficients.slope_lo80:direct?coefficients.slope_lo:Math.log1p(l0/100),bh=q80?coefficients.slope_hi80:direct?coefficients.slope_hi:Math.log1p(h0/100);
      curve.lo=x=>100*Math.expm1(Math.min(bl*x,bh*x));curve.hi=x=>100*Math.expm1(Math.max(bl*x,bh*x));
    }
    return curve;
  };
  const components = responseComponents(rec,index).filter(a=>Number.isFinite(a[0]) && a[1]>0);
  const componentWeight = components.reduce((sum,a)=>sum+a[1],0);
  const curve = componentWeight>0 ? {fn:x=>100*components.reduce((sum,a)=>sum+a[1]*Math.expm1(a[0]*x),0)/componentWeight}
    : resp && resp.pct_eb != null ? expCurve(resp.pct_eb, resp.lo_eb, resp.hi_eb,resp)
    : region && !isNew() && stateRow && stateRow.pct_per_degC != null ? expCurve(stateRow.pct_per_degC, stateRow.lo, stateRow.hi) : null;
  // Each observed percentage uses its own year's trend yield as the baseline. The response and outlook are already
  // percentages, so all yield marks share the units of the headline and map. Missing percentages are not plotted as zero.
  const anomalies = (rec?.trend_anomaly || []).filter(a => Number.isFinite(a[3]));
  const rawYield = !anomalies.length && (rec?.obs||[]).some(a=>Number.isFinite(a[1]));
  const anomalyByYear = new Map(anomalies.map(a => [a[0], a]));
  const yWords = a => `${pct(a[3])} from trend; reported yield ${fmt(a[1], 2)} t/ha, trend ${fmt(a[2], 2)} t/ha`;
  let yieldPoints = axis === 'enso' ? expo.filter(a => anomalyByYear.has(a[0])).map(a => ({x: a[ensoCol], y: anomalyByYear.get(a[0])[3], year: a[0], label: `${a[0]}: ${yWords(anomalyByYear.get(a[0]))} at ${fmt(a[ensoCol], 2)} °C`}))
    : anomalies.map(a => ({x: a[0], y: a[3], year: a[0], label: `${a[0]}: ${yWords(a)}`}));
  if (rawYield) yieldPoints=(rec.obs||[]).filter(a=>Number.isFinite(a[1]) && (axis==='year' || expo.some(e=>e[0]===a[0]))).map(a=>({x:axis==='year'?a[0]:expo.find(e=>e[0]===a[0])[ensoCol],y:a[1],year:a[0],label:`${a[0]}: reported yield ${fmt(a[1],3)} t/ha; anomaly unavailable`}));
  const relationshipPoints = (variable, units, decimals) => (rec?.relationship_history || [])
    .filter(a=>a[0]===variable && a[1]===index && Number.isFinite(a[3]) && Number.isFinite(a[4]))
    .map(a=>({x:a[3],y:a[4],year:a[2],label:`${a[2]}: ${fmt(a[4],decimals,true)} ${units} from the fitted ENSO-neutral baseline at ${fmt(a[3],2)} °C`}));
  const fittedYieldPoints=relationshipPoints('ly','%',1);
  if (axis==='enso' && fittedYieldPoints.length) yieldPoints=fittedYieldPoints;
  const reportedHarvest=(rec?.obs||[]).find(a=>a[0]===hy && Number.isFinite(a[1]));
  const reportedItem=reportedHarvest ? {k:'Reported harvest',v:fmt(reportedHarvest[1],2)+' t/ha'} : {k:'Reported harvest',text:'Not available for this harvest year'};
  const stateMed = region && isNew() ? stateRow : null;
  const forecast = med && med.pct != null ? {y: med.pct, lo: med.lo, hi: med.hi, label: `Harvest ${hy}, from the ENSO outlook: ${pct(med.pct)} (${pct(med.lo)} to ${pct(med.hi)})`}
    : stateMed && stateMed.pct_mean != null ? {y: stateMed.pct_mean, lo: stateMed.pct_lo, hi: stateMed.pct_hi, label: `Harvest ${hy}, state outlook: ${pct(stateMed.pct_mean)} (${pct(stateMed.pct_lo)} to ${pct(stateMed.pct_hi)})`} : null;
  const sofarT = Number.isFinite(temp?.m.anom) ? {y: temp.m.anom, label: `So far this season: ${fmt(temp.m.anom, 2, true)} °C from the ${temp.m.n_years}-season mean, to ${longDate(temp.data_end)}`} : null;
  const sofarP = Number.isFinite(rain?.m.anom) ? {y: rain.m.anom, label: `So far this season: ${fmt(rain.m.anom, 0, true)} mm from the ${rain.m.n_years}-season mean, to ${longDate(rain.data_end)}`} : null;
  const sofarN = Number.isFinite(green?.m.anom) ? {y: green.m.anom, label: `So far this season: ${fmt(green.m.anom, 3, true)} NDVI from the ${green.m.n_years}-season mean, to ${longDate(green.data_end)}`} : null;
  const warmer = v => v == null ? '' : v > 0 ? 'warmer than usual' : v < 0 ? 'cooler than usual' : 'exactly the usual';
  const wetter = v => v == null ? '' : v > 0 ? 'wetter than usual' : v < 0 ? 'drier than usual' : 'exactly the usual';
  const rank = m => m?.pct_rank == null ? '' : `${ordinal(Math.round(100 * m.pct_rank))} percentile of ${m.n_years} seasons`;
  const pendingCurve = 'Seasonal history and the fitted ENSO curve: pending the environmental results tables';
  // The seasonal history of a weather metric (weather_history: complete seasons 1981-2025 as departures from the
  // series' own trend) as points on the shared axis, and the season's expectation from the ENSO outlook
  // (weather_expected: the fitted slope times the central path over the growing window) as the diamond.
  const expoByYear = new Map(expo.map(a => [a[0], a[ensoCol]]));
  const histPoints = (col, unitWord, d) => (rec?.weather_history || []).filter(h => h[col] != null && (axis !== 'enso' || expoByYear.has(h[0]))).map(h => ({x: axis === 'enso' ? expoByYear.get(h[0]) : h[0], y: h[col], year: h[0], open: col === 3 && h[4] === 1, label: `${h[0]}: ${fmt(h[col], d, true)} ${unitWord} from the trend${axis === 'enso' ? ` at ${fmt(expoByYear.get(h[0]), 2)} °C` : ''}`}));
  const wexp = v => { const a = rec?.weather_expected?.[v]; const cols = rec?.columns?.weather_expected; const row=a && cols ? Object.fromEntries(cols.map((c,i)=>[c,a[i]])) : null; return row?.harvest_year===hy ? row : null; };
  const tExp = wexp('tavg_mean'), pExp = wexp('precip'), nExp = wexp('ndvi_mean');
  const modelPoints=(variable,col,unit,decimals)=>{
    const fitted=axis==='enso' ? relationshipPoints(variable,unit,decimals) : [];
    return fitted.length ? fitted : histPoints(col,unit,decimals);
  };
  const tPoints = modelPoints('tavg_mean',1,'°C',2), pPoints = modelPoints('precip',2,'mm',0), nPoints = modelPoints('ndvi_mean',3,'NDVI',3);
  const expDiamond = (x, unitWord, d) => x && x.expected_central != null ? {y: x.expected_central, lo: x.expected_central, hi: x.expected_central, label: `This season from the ENSO outlook, central path: ${fmt(x.expected_central, d, true)} ${unitWord}`} : null;
  const weatherNote = (resp0, pts) => !s ? 'Not published at this level in this release' : isNew() ? (resp0 || pts.length ? null : `No fitted ENSO response for this ${level}`) : pendingCurve;
  // The three numbers of a row: the departure expected this season from ENSO, the season so far, and the updated
  // expectation once the season's own observations are in; a slot without a number says why in a few words.
  const fromEnso = (resp0, x, unitWord, d) => x && x.expected_central != null ? {k: 'From ENSO', v: `${fmt(x.expected_central, d, true)} ${unitWord}`}
    : resp0 ? {k: 'From ENSO', text: 'Historical relationship available; no current estimate'} : {k: 'From ENSO', text: s ? (isNew() ? `No fitted response for this ${level}` : 'Not yet estimated for this unit') : 'Not published at this level'};
  const fromIndexSoFar = (x, unitWord, d) => x && x.expected_todate != null ? {k: 'Index so far', v: `${fmt(x.expected_todate, d, true)} ${unitWord}`} : {k: 'Index so far', text: x ? 'No window month yet' : 'Not available'};
  const yieldNote = () => { if (rawYield) return yieldPoints.length ? null : 'Yield records are available in History; seasonal ENSO exposure is unavailable.'; if (!s && !region) return 'No yield record at this level'; if (curve || axis !== 'enso') return null; if (s && !s.state) return respWithheld ? 'Own estimate withheld: it would equal the pooling center' : 'No ENSO response published for this record'; return isNew() ? (s ? null : 'No state record in this release') : 'No fitted response at this level'; };
  const specs = [
    {label: 'Temperature', sub: 'season mean, °C from usual', drawn: !!(lineCurve(tResp) || sofarT || tPoints.length), chart: ({...ax, points: tPoints, curve: lineCurve(tResp), forecast: expDiamond(tExp, '°C', 2), sofar: sofarT, yLabel: 'temperature anomaly (°C)', note: weatherNote(tResp, tPoints), palette: TEMP_PALETTE, symbolFill: '#b2182b'}),
      items: [fromEnso(tResp, tExp, '°C', 2), temp ? {k: `So far, to ${shortDate(temp.data_end)}`, v: fmt(temp.m.anom, 1, true) + ' °C'} : {k: 'So far', text: s ? 'No season-to-date observations for this harvest' : 'Not published at this level'}, fromIndexSoFar(tExp, '°C', 2)]},
    {label: 'Rainfall', sub: 'season total, mm from usual', drawn: !!(lineCurve(pResp) || sofarP || pPoints.length), chart: ({...ax, points: pPoints, curve: lineCurve(pResp), forecast: expDiamond(pExp, 'mm', 0), sofar: sofarP, yLabel: 'rainfall anomaly (mm)', note: weatherNote(pResp, pPoints), palette: RAIN_PALETTE, symbolFill: '#01665e'}),
      items: [fromEnso(pResp, pExp, 'mm', 0), rain ? {k: `So far, to ${shortDate(rain.data_end)}`, v: fmt(rain.m.anom, 0, true) + ' mm'} : {k: 'So far', text: s ? 'No season-to-date observations for this harvest' : 'Not published at this level'}, fromIndexSoFar(pExp, 'mm', 0)]},
    {label: 'Greenness', sub: 'season mean NDVI, from usual', drawn: !!(lineCurve(nResp) || sofarN || nPoints.length), chart: ({...ax, points: nPoints, curve: lineCurve(nResp), forecast: expDiamond(nExp, 'NDVI', 3), sofar: sofarN, yLabel: 'greenness, NDVI', note: weatherNote(nResp, nPoints)}),
      items: [fromEnso(nResp, nExp, 'NDVI', 3), green ? {k: `So far, to ${shortDate(green.data_end)}`, v: fmt(green.m.anom, 3, true) + ' NDVI'} : {k: 'So far', text: s ? 'No season-to-date greenness for this harvest' : 'Not published at this level'}, fromIndexSoFar(nExp, 'NDVI', 3)]},
    {label: 'Yield', sub: `${cropLabel(p.crop_code)}, ${rawYield?'reported tonnes per hectare':axis==='enso'&&fittedYieldPoints.length?'% from the ENSO-neutral trend':'% from the fitted trend'}`, drawn: true, chart: ({...ax, points: yieldPoints, curve: axis === 'enso' && !rawYield ? curve : null, forecast:rawYield ? null : forecast, sofar: null, yLabel: rawYield ? 'reported yield (t/ha)' : 'yield anomaly (%)', note: yieldNote(), palette: YIELD_PALETTE, symbolFill: '#006837'}),
      items: us ? [med && med.pct != null ? {k: `From ENSO${med.usable ? '' : ' · conditional'}`, v: pct(med.pct)} : {k: 'From ENSO', text: preds.length ? 'Not estimated: no outlook row for this harvest' : (resp ? `No outlook for harvest ${hy} in this release` : 'Historical record available; no current outlook published')},
          reportedItem,
          wt && wt.usable && wt.pct != null ? {k: 'At harvest, with the weather so far', v: pct(wt.pct)} : {k: 'At harvest', text: wt && wt.pct != null ? 'Not yet available: the weather model fails its checks here' : 'Not yet available'}]
        : [stateMed && stateMed.pct_mean != null ? {k: 'From ENSO', v: pct(stateMed.pct_mean)} : {k: 'From ENSO', text: isNew() ? `No state outlook for harvest ${hy} in this release` : 'Not estimated at the state level in this release'}, reportedItem, {k: 'At harvest', text: 'Not yet available at the state level'}]}];
  const jointMode = Object.prototype.hasOwnProperty.call(rec || {}, 'joint_regions');
  if (jointMode) {
    const variables = ['tavg_mean','precip','ndvi_mean','ly'];
    specs.forEach((spec,i) => {
      const c = spec.chart;
      c.jointMode = true;
      c.curveDomain = [ax.x0,ax.x1];
      const candidate = (rec.joint_regions || []).find(j => j.variable === variables[i] && j.index === (axis==='enso'?index:'rel') && j.target_year === hy);
      if(candidate?.status==='available' && i<3)spec.items[0]={k:'From ENSO',v:`${fmt(candidate.center[1],i===0?2:i===1?0:3,true)} ${i===0?'°C':i===1?'mm':'NDVI'}`};
      if (axis !== 'enso') {
        if(i<3&&candidate?.status==='available')c.forecast={y:candidate.center[1],label:`Harvest ${hy}, central ENSO-associated response: ${spec.items[0].v}`};
        return;
      }
      c.joint = c.curve && candidate?.status === 'available' ? candidate : null;
      c.sofarReadout = c.sofar?.label || null;
      c.sofar = null;
      c.forecast = c.joint ? {x:c.joint.center[0], y:c.joint.center[1], label:`Harvest ${hy}, central ENSO-associated response: ${fmt(c.joint.center[1],i===2?3:2,true)}; growing-season index ${fmt(c.joint.center[0],2)} °C. CPC issued ${c.joint.issue_date}.`} : null;
      c.outlookMissing = !c.joint && c.curve ? (candidate?.reason || (index==='std' ? 'No matching conventional-index forecast distribution.' : 'Joint outlook unavailable for this harvest.')) : null;
    });
    const bounds = specs.filter(s=>s.chart.joint).map(s=>s.chart.joint.bounds95);
    if (bounds.length) {
      const lower = Math.min(ax.x0,...bounds.map(b=>b[0])), upper = Math.max(ax.x1,...bounds.map(b=>b[1]));
      const pad = Math.max(.05,(upper-lower)*.03);
      for (const spec of specs) {spec.chart.x0=lower-pad;spec.chart.x1=upper+pad;}
    }
  }
  if(layer==='historical') for(const spec of specs) {spec.chart.forecast=null;spec.chart.sofar=null;spec.chart.joint=null;spec.chart.sofarReadout=null;spec.chart.outlookMissing=null;}
  const shown = specs.filter(x => x.label === 'Yield' || x.drawn || x.items.some(it => it.v != null));
  const rows = shown.map((x, i) => row(x.label, x.sub, rowChart({...x.chart, compact: true, reader: true, width: 480,
    height: (shown.length > 3 ? 500 : 396) / shown.length + (i === shown.length - 1 ? 22 : 0), xAxis: i === shown.length - 1})));
  const numberBlock = `<div class="numbers">${shown.map((x, i) => `<div class="numrow" data-row="${esc(x.label)}"><span class="rl">${esc(x.label)}</span>${numbers(x.items)}</div>`).join('')}</div>`;
  // The caption under the stack, as under a figure: what each panel shows and what the marks are.
  const panelWords = {Temperature: 'the season mean temperature', Rainfall: 'the season rainfall', Greenness: 'the season greenness (crop-weighted NDVI)', Yield: `the ${cropLabel(p.crop_code)} yield`};
  const parts = shown.map(x => panelWords[x.label]);
  const dataEnd = (temp || rain || green)?.data_end;
  const caption = `The plots show ${rawYield ? 'reported yield in tonnes per hectare' : (axis==='enso'&&fittedYieldPoints.length ? "yield anomalies relative to the same fitted model’s ENSO-neutral trend" : "yield anomalies as a percentage of each year's fitted trend")}${shown.some(x=>x.label!=='Yield') ? ' and weather departures from their trends over complete seasons' : ''}, against ${axis==='enso' ? `the growing-season ${index==='std'?'standard':'relative'} Niño 3.4 index` : 'harvest year'}. ${axis==='enso'&&shown.some(x=>x.chart.curve) ? 'The line is the fitted relationship. ' : ''}${axis==='enso'&&shown.some(x=>x.chart.curve?.lo&&x.chart.curve?.hi) ? 'Gray shading shows the 80% response-fit intervals, the level of the headline range. ' : ''}${jointMode&&axis==='enso'&&shown.some(x=>x.chart.joint) ? 'Blue regions approximate 80% (solid) and 95% (dashed) of the modeled joint ENSO-exposure and response distribution. The open diamond is the fitted central outlook. These regions combine CPC input uncertainty and one-year bootstrap response uncertainty, conditional on the assumed seasonal path. Unexplained harvest variability is excluded. Season-to-date readouts use each source’s observation cutoff. ' : shown.some(x=>x.chart.forecast) ? `The open diamond is the central ENSO outlook for harvest ${hy}; the yield whisker is the 80% range of the ENSO effect. ` : ''}${shown.some(x=>x.chart.sofar) ? 'Open circles show season-to-date observations; each weather source has its own cutoff date.' : ''}`;
  // The notes: what the rows leave out, in a few sentences below them.
  const W = D.world, o = W.index.outlook; const notes = [];
  if (rec?.ndvi_history_source) notes.push('NDVI history is restored from the original environmental snapshot used by this release. Complete seasons are shown relative to their 2001–2025 trend; pre-2001 NDVI points are open circles because those sensor records are provisional. The current-season open circle uses the same elapsed window in its reference years.');
  if (rec?.ndvi_history_status) {
    const reason={seasonal_ndvi_not_extracted:'seasonal NDVI was not extracted for this reporting unit',calendar_mismatch:'the saved NDVI window differs from the current calendar',insufficient_complete_seasons:'no complete season meets the coverage requirement',fewer_than_ten_reference_seasons:'fewer than ten complete reference seasons are available',unavailable:'too few reporting units have eligible NDVI histories'}[rec.ndvi_history_status];
    notes.push(`NDVI history unavailable: ${reason || 'the source record is unavailable'}.`);
  }
  if(index==='std' && isReconciled()) notes.push(jointMode ? 'The historical relationships use conventional Niño 3.4. Joint outlook regions require a matching forecast index and are unavailable in this view. The map and conditional skill table use the saved relative-index model.' : 'The historical relationships on this page use conventional Niño 3.4. The mapped outlook, forecast markers and conditional skill table retain the saved relative Niño 3.4 model; switching the historical index does not refit that outlook.');
  if(shown.some(x=>x.chart.joint)) notes.push('The 80% yield range in Details integrates over ENSO uncertainty. The ellipse encloses paired ENSO and response values, so its vertical extent has a different probability interpretation.');
  const memberYears=[...new Set(shown.flatMap(x=>x.chart.joint?.member_harvest_years||[]))].sort();
  if(memberYears.length>1)notes.push(`This coming-harvest aggregate combines member harvest years ${memberYears.join(' and ')}. Each member retains its own growing window; the year in the page heading is the release’s representative harvest year.`);
  const poolOnlyCount=rec?.yield_response_pool_only_series_by_index?.[index]?.length || 0;
  if(poolOnlyCount) notes.push(`${poolOnlyCount} covered members have no separately identified local slope and use the pooled regional response. Those members are included in this aggregate curve, matching the saved outlook's reporting support.`);
  if (rawYield) notes.push('No trend or percentage anomaly is published for this record. The yield plot shows reported tonnes per hectare; the original observations are also listed below.');
  if (rec?.weather_history?.length && axis==='enso') {const omitted=rec.weather_history.filter(a=>(Number.isFinite(a[1])||Number.isFinite(a[2]))&&!expoByYear.has(a[0])).length;if(omitted) notes.push(`${omitted} weather years have no matching seasonal ENSO index. History shows those years.`);}
  if (national) notes.push('The map fill represents the national estimate for this crop and season. County boundaries provide geographic context; they do not indicate county-level estimates.');
  const nationalWeather = rec?.national_weather_context;
  if (nationalWeather) notes.push(`National weather history: ${esc(nationalWeather.temperature_source)} and ${esc(nationalWeather.rainfall_source)}, weighted by ${esc(nationalWeather.weighting)}. ${esc(nationalWeather.method)} Complete temperature seasons through ${nationalWeather.temperature_last_year ?? 'unavailable'}; rainfall through ${nationalWeather.rainfall_last_year ?? 'unavailable'}.`);
  if (us) notes.push(`Yield record: ${esc(sourceName(permission))}${isNew() && us.source !== permission ? ` via the ${esc(sourceName(us.source))}` : ''}, ${esc(cropLabel(us.crop_code))}, ${esc(seasonWords(us.season))}, ${us.n} years ${us.first}–${us.last}${us.basis && us.basis !== 'unknown' ? `, ${esc(us.basis)} area` : ''}${axis==='enso'&&fittedYieldPoints.length ? '; ENSO points use the neutral trend of the displayed response model' : rec?.trend ? `; descriptive trend ${pct(rec.trend.trend_pct_per_year, 2)} per year; History points show departure from that trend` : ''}${withheld ? `. Observations withheld under the source terms${sourceNote(permission) ? ` (${esc(sourceNote(permission))})` : ''}; the fitted relationship and the outlook are published` : ''}.`);
  else if (s) notes.push(`State average: the mean yield of the ${s.n_units} reporting units of ${esc(region.region_name)} weighted by harvested area, ${s.n} years ${s.first}–${s.last}${rec?.trend ? `, trend ${pct(rec.trend.trend_pct_per_year, 2)} per year` : ''}. ${componentWeight>0 ? 'The yield curve sums local responses with the same baseline-production weights as the outlook, evaluated at a common ENSO exposure. Historical points average available member anomalies and exposures for each year; their reporting support can change.' : 'The yield response is the fitted center of the state’s units.'}`);
  else if (region) notes.push(`${esc(region.region_name)} is a state-level aggregate of ${stateRow?.n_leaves ?? stateRow?.n_units ?? regionUnits.length} reporting units; its outlook is the production-weighted sum of their outlooks.`);
  const caRows = (unit ? [unit] : regionUnits.map(([, u]) => u)).map(u => u.crop_area?.[p.crop_family]).filter(Boolean);
  if (caRows.length) { const ha = caRows.reduce((s, x) => s + (x[0] || 0), 0), land = caRows.reduce((s, x) => s + (x[1] > 0 ? x[0] / x[1] : 0), 0); notes.push(`CROPGRIDS 2020: ${num(ha)} ha of ${FAMILY_LABEL[p.crop_family].toLowerCase()} harvested in ${esc(name)}${land > 0 ? `, ${fmt(100 * ha / land, 1)}% of its land${ha > land ? ' (harvested area counts every harvest of the year)' : ''}` : ''}; the weather rows weight the grid cells by this crop's area.`); }
  notes.push(win ? `Growing window for harvest ${hy}: planted ${longDate(win.plant_date)}, harvest ${longDate(win.harvest_date)} (${esc(calendarLabel(win))}).` : `No growing window for harvest ${hy} in the published calendar.`);
  const sens = [];
  if (resp && resp.pct_eb != null) sens.push(`yield ${pct(resp.pct_eb, 2)}${resp.lo_eb != null ? ` (${pct(resp.lo_eb, 2)} to ${pct(resp.hi_eb, 2)})` : ''}${resp.own_data_weight != null ? `, own-data weight ${fmt(resp.own_data_weight, 2)}` : ''}`);
  else if (respWithheld) sens.push('yield withheld: the series has no own slope, so its estimate would equal the pooling center');
  if (tResp && tResp.slope_eb != null) sens.push(`temperature ${fmt(tResp.slope_eb, 2, true)} °C`);
  if (pResp && pResp.slope_eb != null) sens.push(`rainfall ${fmt(pResp.slope_eb, 0, true)} mm`);
  if (sens.length) notes.push(`Fitted response per +1 °C of the ${index === 'std' ? 'standard' : 'relative'} Niño 3.4 over the window: ${sens.join('; ')}.`);
  const ranges = [];
  if (med && med.pct != null) ranges.push(`from ENSO ${pct(med.lo)} to ${pct(med.hi)}, the 80% range of the ENSO effect${med.beyond_fit ? ', beyond the fitted range' : ''}`);
  if (stateMed && stateMed.pct_mean != null) ranges.push(`from ENSO ${pct(stateMed.pct_lo)} to ${pct(stateMed.pct_hi)}, the 80% range of the ENSO effect`);
  if (wt && wt.usable && wt.pct != null) ranges.push(`at harvest with the weather so far ${pct(wt.lo)} to ${pct(wt.hi)}, the 95% interval of the fitted mean`);
  if (ranges.length) notes.push(`Ranges: ${ranges.join('; ')}.`);
  if (med && med.pct != null) notes.push(med.skill_vs_trend == null
    ? 'Conditional: forecast skill has not yet been assessed at this lead; this is not a validated forecast.'
    : med.usable && med.skill_vs_trend > 0 ? `Validated: in the leave-one-year-out tests with the observed full-season index, the ENSO model's skill against the trend is ${fmt(med.skill_vs_trend, 2, true)} and the 80% range of the country panel's skill lies above zero.`
    : `Conditional: ${med.skill_vs_trend <= 0 ? 'the ENSO model does not improve on the trend in the leave-one-year-out tests with the observed index' : 'the ENSO model has positive leave-one-year-out skill but the 80% range of the country panel\'s skill includes zero'} (skill ${fmt(med.skill_vs_trend, 2, true)}); this is not a validated forecast${wt && wt.usable ? '; the weather-based estimate is validated' : ''}.`);
  if (temp || rain) notes.push(`Season so far${temp ? `: temperature ${warmer(temp.m.anom)}${temp.m.pct_rank != null ? `, ${rank(temp.m)}` : ''}` : ''}${rain ? `${temp ? ';' : ':'} rainfall ${wetter(rain.m.anom)}${rain.m.pct_rank != null ? `, ${rank(rain.m)}` : ''}` : ''}, to ${longDate((temp || rain).data_end)}.`);
  const ctx = [];
  if (us && stateRow && isNew() && stateRow.pct_mean != null) ctx.push(`${esc(stateRow.region_name)} ${pct(stateRow.pct_mean)} (${pct(stateRow.pct_lo)} to ${pct(stateRow.pct_hi)}) over ${stateRow.n_leaves} units`);
  if (countryRow && isNew() && countryRow.pct_mean != null) ctx.push(`${esc(c.name)} ${pct(countryRow.pct_mean)} (${pct(countryRow.pct_lo)} to ${pct(countryRow.pct_hi)}) over ${countryRow.n_leaves} units`);
  if (ctx.length) notes.push(`Central outlook for harvest ${hy}: ${ctx.join('; ')}.`);
  notes.push(`ENSO outlook: ${esc(o.source)}, central December–February relative index ${fmt(W.index.scenario_rel_djf.medium, 2)} °C (${fmt(W.index.scenario_rel_djf.low, 2)} to ${fmt(W.index.scenario_rel_djf.high, 2)}). Index on this page: ${index === 'std' ? 'standard' : 'relative'} Niño 3.4 (<a href="${link(iso, key, {...q2, index: index === 'std' ? null : 'std'})}">${index === 'std' ? 'relative' : 'standard'} instead</a>).`);
  if(pathAssumptionLabel())notes.push('Future months follow the 2015–16 evolution scaled to the issued December–February outlook. Other seasonal targets can differ from CPC’s issued forecasts; uncertainty in that evolution pattern is excluded from the effect range.');

  // The local map (the user's design of 10 October 2026, evening): a window of fixed ground size centred on the place,
  // showing every reporting unit inside it from any country, each coloured by its own outlook and clickable, with
  // the place outlined; the charts stand beside it. The own country's units are drawn at once from the file already
  // loaded; the neighbours' files follow as they arrive.
  const members = region ? regionUnits.map(([k]) => k) : [key];
  const pts = members.map(k => units.units[k]).filter(u => u && u.lon != null && u.lat != null);
  const centre = pts.length ? [pts.reduce((a, u) => a + u.lon, 0) / pts.length, pts.reduce((a, u) => a + u.lat, 0) / pts.length] : null;
  const box = localView?.bounds || (national && geo ? countryBounds(geo,iso,units,p) : centre ? localWindow(centre[0], centre[1]) : null);
  const selected = region ? new Set(members) : key;
  const fc = geo ? unitCollection(geo, units, unitCell(units, p, layer, date, hy, us?.id,index, anomaly?.year), null, selected) : null;
  const calendarRange = layer === 'progress' ? harvestScale(fc) : null;
  const wordsFor = f => `<b>${esc(featureLabel(f,iso,units))}</b><br>${f.properties.words}`;
  const mappedSelection=!unit || geo?.features.some(f=>f.id===key);
  const localPlace = unitLabel(unit || {name, level:'region'}, iso, key);
  // Two notes shown above the rows (20 October 2026): the record asked for in the URL is not reported by this place, so
  // another record of the crop is shown; and the growing window is CONAB's second-crop window, which the release
  // assigns to Brazilian maize records where the safrinha is grown (the windows await an agronomic review).
  const askedSeason = r.q.get('season');
  const pageNotes = [];
  if (us && askedSeason && askedSeason !== p.season && requestedPanel?.season === askedSeason && requestedPanel.crop_code === p.crop_code) pageNotes.push(`${esc(name)} reports no ${esc(seasonWords(askedSeason))} record of ${esc(cropLabel(p.crop_code))}; the ${esc(seasonWords(p.season))} record is shown. <a href="${link(iso, null, {...q, crop: requestedPanel.crop_code, season: askedSeason, series: null, records: 1})}">Places with a ${esc(seasonWords(askedSeason))} record</a>.`);
  if (win && (win.calendar_source === 'conab_safrinha' || win.window_source === 'conab_safrinha')) pageNotes.push(`The growing window is the second-crop (safrinha) planting-to-harvest window of CONAB's calendar for the state, which the release assigns to this ${esc(seasonWords(p.season))} record in place of a first-crop window; the safrinha windows have not yet had an agronomic review.`);
  const scCols = rec?.columns?.scenario_contrast || [], scCentral = (rec?.scenario_contrast || []).map(a => Object.fromEntries(scCols.map((c, i) => [c, a[i]]))).find(r => r.scenario === 'central') || null;   // the chance of a 20% loss or gain at the central path (19 October 2026)
  const status = window.AtlasRegionalPage.headline({prediction: us ? med : stateMed, aggregate: !!region, chance: us && layer !== 'historical' ? scCentral : null,
    crop: cropLabel(p.crop_code), missing: historical ? (layer==='historical' && historical.historical_reason ? historical.historical_reason : 'Historical records only; current-harvest applicability has not been assessed.') : specs[2].items[0].text, withheld, beyondFit: med?.beyond_fit, cycleUnresolved: win?.cycle_unresolved,
    historical:resp,validation:historicalValidation,historicalView:layer==='historical'}) + (respWithheld && Number.isFinite(med?.pct) && layer==='outlook' ? '<p class="detail">This estimate uses the pooled regional response.</p>' : '');
  const issueDate = /^\d{4}-\d{2}$/.test(W.issue) ? new Date(W.issue + '-01T12:00:00Z').toLocaleDateString('en-GB', {month:'short',year:'numeric',timeZone:'UTC'}) : W.issue;
  const tLast=Math.max(0,...(rec?.weather_history||[]).filter(a=>Number.isFinite(a[1])).map(a=>a[0]));
  const pLast=Math.max(0,...(rec?.weather_history||[]).filter(a=>Number.isFinite(a[2])).map(a=>a[0]));
  const weatherDates = temp?.data_end && rain?.data_end && temp.data_end !== rain.data_end
    ? `Temperature through ${shortDate(temp.data_end)} · rainfall through ${shortDate(rain.data_end)}`
    : dataEnd ? `Weather through ${shortDate(dataEnd)}` : nationalWeather && (nationalWeather.temperature_last_year || nationalWeather.rainfall_last_year)
      ? `Historical temperature through ${nationalWeather.temperature_last_year ?? 'unavailable'} · rainfall through ${nationalWeather.rainfall_last_year ?? 'unavailable'}` : tLast||pLast ? `Historical temperature through ${tLast||'unavailable'} · rainfall through ${pLast||'unavailable'}` : 'Weather data unavailable for this record';
  const localStates = [[C.notEstimated,'Current estimate unavailable'],[C.none,`No ${FAMILY_LABEL[fam].toLowerCase()} records`]].concat(maskOn(r) ? [['#fbfaf7','Outside crop mask']] : []);
  const localLegend = mapLegend(layer, fam, maskOn(r), calendarRange, anomaly?.year);
  const relation = axis === 'enso' && shown.some(x => x.chart.curve);
  const source = D.catalog.sources?.[permission] ? readerSource(permission, D.catalog.sources[permission]) : null;
  view.innerHTML = `<article class="regional-page" data-place="${esc(key)}" data-series="${esc(us?.id || '')}" data-crop="${esc(p.crop_code)}" data-season="${esc(p.season)}" data-harvest="${hy}">
    <div class="regional-brand"><a href="${link(null,null,q)}">ENSO crop atlas</a></div>
    ${crumbs(trail)}<header class="regional-heading"><div><h1 data-calendar-title="preserve">${esc(localPlace)}</h1>
    <p class="regional-subtitle">${esc(cropLabel(p.crop_code).replace(/^./, c => c.toUpperCase()))} ${layer==='historical'?`· historical yield response${resp?.year_first?' · '+resp.year_first+'–'+resp.year_last:''}`:`yield · ${hy}`}${p.season && p.season !== 'main' ? ` · ${esc(seasonWords(p.season))}` : ''}</p></div>
    <div class="regional-map-key"><label>Map <select id="layer-sel" aria-label="Map layer">${mapChoices(r,layer)}</select></label>${anomaly ? yearControl(yearControlFor(anomaly, fam)) : ''}${localLegend}</div><div class="regional-axis" role="group" aria-label="Chart view"><button type="button" data-regional-axis="enso" aria-pressed="${axis === 'enso'}">ENSO relationship</button><button type="button" data-regional-axis="year" aria-pressed="${axis === 'year'}">History</button></div></header>
    ${pageNotes.map(x => `<p class="detail regional-note">${x}</p>`).join('')}
    <div class="local"><div class="local-map"><div id="cmap" class="map local" role="img" aria-label="Regional map; ${esc(localPlace)}${mappedSelection?' selected':' boundary unavailable'}"></div>${provenanceBlock(us, region)}${!mappedSelection?'<p class="detail">Boundary unavailable for this record; map shows surrounding places.</p>':''}</div>
    <div class="local-series" id="series" tabindex="-1"><div class="rows">${rows.join('')}</div>${axis==='year' && !region ? ensoHistory(index) : ''}
    <div class="regional-key" aria-label="Chart symbols">${shown.some(x => x.chart.points.length) ? '<span><b>·</b>Past years</span>' : ''}${relation ? '<span><i></i>Relationship</span>' : ''}${shown.some(x => x.chart.forecast) ? '<span><b>◇</b>ENSO outlook</span>' : ''}${shown.some(x=>x.chart.joint) ? '<span><i class="ellipse-key"></i>80% joint region</span><span><i class="ellipse-key outer"></i>95% joint region</span>' : ''}${shown.some(x => x.chart.sofar) ? '<span><b>○</b>Season to date</span>' : ''}</div>${jointMode&&axis==='enso'&&shown.some(x=>x.chart.joint)?'<p class="joint-scope">ENSO-associated full-season response · conditional on the forecast path'+(hy>=2027 && (D.release==='2026-10-19' || D.catalog?.model?.forward_input_assumption?.full_issued_seasonal_path===false) && shown.some(x=>x.chart.joint?.center?.[0]<0) ? '. Negative exposure follows the assumed 2015–16 post-peak path, not a separately issued seasonal forecast. The ellipse holds that path shape fixed.' : '')+'</p>':''}${status}</div></div>
    <footer class="regional-footer"><span class="regional-dates">${esc(weatherDates)} · ENSO outlook ${esc(issueDate)} · Release ${esc(D.release)}${D.catalog.candidate ? ' (candidate)' : ''}${intervalReviewLabel()?' · '+intervalReviewLabel():''}</span>
      <div class="regional-actions"><a href="${link(iso,null,{...q2,records:1,series:null,to:'watchlist',layer:'outlook'})}">Country watchlist</a><a href="${link(iso,null,{...q2,records:1,series:null})}">Browse records</a><button type="button" data-regional-panel="details" aria-controls="regional-details" aria-expanded="false">Details</button><button type="button" data-regional-panel="paper" aria-controls="regional-paper" aria-expanded="false">Methods and sources</button></div></footer>
    <section id="regional-details" class="regional-disclosure" hidden aria-label="Local supporting details"><h2>${esc(localPlace)}: supporting details</h2>
      ${panelChooser(r,iso,p)}${unit ? seriesChooser(unit,us) : ''}${numberBlock}<p class="caption detail">${caption}</p>
      <label class="regional-mask"><input type="checkbox" id="mask-chk"${maskOn(r) ? ' checked' : ''}> Show cropped land only (above ${MASK_THRESHOLD}% harvested)</label>
      <p class="detail">${esc(name)} outlined in violet. Fill colors show the selected quantity. Drag the map to move; click a reporting unit to update its plots and calendar without moving the map.${maskOn(r) ? maskWords + '.' : ''}</p>
      ${historical ? `<p class="detail">Historical association from older local records. Current-harvest applicability is unassessed.${historical.validation?.length ? ' The historical trial withheld each target year across all counties and supplied the observed seasonal ENSO index; it does not measure issued-forecast skill.' : ' No same-release withheld-year evaluation is attached to this historical supplement.'}</p>${historical.robustness?.length ? table(['Check','Index','Years#','Skill vs trend#'],historical.robustness.filter(x=>x.index===index).map(x=>[x.test==='terminal_five_years'?'Final five years held out':'Target and adjacent years held out',index,x.n,fmt(x.skill_vs_trend,3,true)])) : ''}` : ''}
      ${rec?.conditional_skill?.length ? `<h3>Known-ENSO prediction tests</h3><p class="detail">We withhold one harvest year across all locations and train on every other eligible year.${rec.conditional_skill.some(x=>x.design==='rolling')?' Earlier-years-only fits provide a separate comparison.':''} The tests use observed full-season relative Niño 3.4 and final-vintage yields. Positive scores improve on the trend-only reference. Issued-forecast skill remains unassessed.</p>${table(['Training design','Held harvests#','Improvement vs trend (%)#'],[...rec.conditional_skill].sort((a,b)=>(a.design==='loo'?0:1)-(b.design==='loo'?0:1)).map(x=>[x.design==='loo'?'Leave one year out':'Earlier harvests only',x.n,x.skill_eb==null?'Not estimated':fmt(100*x.skill_eb,2,true)]))}` : ''}
      <div class="notes">${notes.map(n => `<p class="detail">${n}</p>`).join('')}</div>
      <div class="regional-calendar-detail" id="regional-calendar-detail"></div>${recordTables(rec,preds,weather)}${skillDisclosure(p)}${placeDirectory(r,iso,units,p)}
    </section>
    <section id="regional-paper" class="regional-disclosure" hidden aria-label="Methods and sources"><h2>Methods and sources</h2><div class="prose">
      <p class="detail"><a href="${link(null,null,{...q,to:'methods'})}">About this release and the methods</a>: the estimator, the ranges, the validation and the known limitations. A data descriptor documenting the release is in draft and not yet published.</p>
      ${provenanceCredits(us)}<p class="detail">Yield: ${esc(us ? sourceName(permission) : s ? "the state's reporting units" : 'see the units of this state')}${source?.citation ? ` (${esc(source.citation)})` : ''}. Temperature: Berkeley Earth. Rainfall: ${esc(nationalWeather?.rainfall_source || 'CHIRPS')}. Greenness: NOAA STAR Blended Vegetation Health Product, weekly smoothed NDVI, crop-weighted per unit (cropland extract by Michael Foley). ENSO: ERSSTv5 Niño 3.4. Outlook: ${esc(o.source)}.</p>
      ${source ? `<p class="detail">Yield source terms: ${esc(source.permission?.license || source.license || 'license not recorded')}.${source.permission?.note ? ' ' + esc(source.permission.note) : ''}</p>` : ''}
      <p class="detail">Data access follows each source's license. <a href="${link(null,null,{...q,to:'credits'})}">Source register</a> · <a href="https://github.com/phuybers3/enso-yield-atlas">Code and release documentation</a>.</p>
    </div></section></article>`;
  if (fc && box) {
    // A click: the own country's unit opens as before; a neighbour opens with its country's panel of the same crop
    // family where it has one, else its country page.
    const openPlace = f => {
      const c2 = f.properties.country || iso;
      if (c2 === iso) { if (units.units[f.id] && f.id !== key && f.properties.selectable!==false) selectInLocalMap(link(iso, f.id, {...q2,series:null,crop:f.properties.crop_code||p.crop_code,season:f.properties.season||p.season,axis:null})); return; }
      const pk = D.worldUnits?.panels?.[fam]?.[c2]; const pp = f.properties.crop_code ? {crop_code:f.properties.crop_code,season:f.properties.season} : pk ? D.panelByKey.get(pk) : null;
      selectInLocalMap(pp && f.properties.level !== 'national' ? link(c2, f.id, {...q, crop: pp.crop_code, season: pp.season, axis: null}) : link(c2, null, {...q, axis: null}));
    };
    const onPan = map => {
      if (version !== renderVersion) return;
      const visibleBox = map.getBounds().toArray();
      if (layer === 'progress') {
        const range = harvestScale(map.__data);
        const legend=view.querySelector('.regional-map-key .legend');if(legend) legend.outerHTML = mapLegend(layer, fam, maskOn(r), range);
        map.getSource('u').setData(map.__data);
      }
      loadNeighbours('cmap', visibleBox, iso, fam, layer, version,Number(r.q.get('harvest'))||null, anomaly?.year).catch(() => {});
    };
    drawMap('cmap', fc, wordsFor, openPlace, box, null, null, {draggable:true, camera:localView?.camera, onPan, ...(maskOn(r) ? {mask: {tiles: MASK_TILES(fam)}} : {})});
  } else { const el = document.getElementById('cmap'); if (el) el.innerHTML = `<p class="map-note">${geo ? 'No reporting units to draw at this level.' : 'No boundary file for this country.'}</p>`; }
  window.AtlasRegionalPage.mount(view, {key: [D.release, iso, key, p.crop_code, p.season, hy].join('|'), specs: shown, chart: rowChart, bounds: box, camera:localView?.camera, map: () => maps.cmap});
}
// The window: a fixed ground size centred on the place. Its width is LOCAL_WINDOW_KM[0] along the parallel through the
// centre; its height follows the box's square proportion in Mercator units, so the drawn map fills the box and the
// scale is the same on every page (the user's choice of 10 October 2026: a constant scale over a proportional one).
const LOCAL_WINDOW_KM = [1000, 1000];
function localWindow(lon, lat) {
  const R = 6371, rad = Math.PI / 180;
  const halfLon = (LOCAL_WINDOW_KM[0] / 2) / (R * Math.cos(lat * rad)) / rad;
  const merc = f => Math.log(Math.tan(Math.PI / 4 + f * rad / 2)), inv = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / rad;
  const dy = halfLon * rad * (LOCAL_WINDOW_KM[1] / LOCAL_WINDOW_KM[0]); const y0 = merc(lat);
  return [[lon - halfLon, Math.max(-85, inv(y0 - dy))], [lon + halfLon, Math.min(85, inv(y0 + dy))]];
}
// The countries whose outline touches the window, from the bounding box of each polygon part of the world outlines
// (a country's single box would span the world for France, New Zealand or Fiji, whose islands sit on both sides of the
// antimeridian, and their files would load on every page).
async function countriesInWindow(box) {
  if (!D.countryBox) {
    const release=D.release; const w = await load(D.base + 'geometry/world.json');
    if (release!==D.release) return [];
    D.countryBox = new Map(w.features.map(f => [f.id, (f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry ? [f.geometry.coordinates] : []).map(ring => bounds({features: [{geometry: {coordinates: ring}}]})).filter(Boolean)]));
  }
  const hit = b => b[0][0] <= box[1][0] && b[1][0] >= box[0][0] && b[0][1] <= box[1][1] && b[1][1] >= box[0][1];
  return [...D.countryBox].filter(([iso, parts]) => D.catalog.countries[iso]?.geometry && parts.some(hit)).map(([iso]) => iso);
}
// The neighbours' units, coloured from world_units.json (the medium outlook of each country's largest panel of the
// family) and their national polygons from the world panels where a country reports nationally only; appended to the
// drawn map's source as each country file arrives.
async function loadNeighbours(id, box, iso, fam, layer, version, requestedYear, year = null) {
  const isos = (await countriesInWindow(box)).filter(x => x !== iso); if (!isos.length || version !== renderVersion) return;
  if (!D.worldUnits) {const release=D.release; const loaded=await load(D.base+'world_units.json').catch(()=>null);if(version!==renderVersion||release!==D.release)return;D.worldUnits=loaded;}
  const wu = D.worldUnits, vals = wu?.units?.[fam] || {}, cols = wu?.columns || [];
  const byIso = new Map(); for (const pp of D.panels.filter(x => x.crop_family === fam)) { const cur = byIso.get(pp.iso3); if (!cur || (pp.baseline_production_mt || 0) > (cur.baseline_production_mt || 0)) byIso.set(pp.iso3, pp); }
  await Promise.all(isos.map(async c2 => {
    const g = await load(D.base + `geometry/${c2}.json`).catch(() => null); if (!g || version !== renderVersion) return;
    if (layer !== 'outlook') {
      const p=panelFor({q:new URLSearchParams({crop:fam})},c2);
      if(p){const units=await loadUnits(c2,fam);if(version!==renderVersion)return;const fc=unitCollection(g,units,unitCell(units,p,layer,AtlasCalendar.todayISO(),requestedYear||p.harvest_year,null,indexFor(route()),year));for(const f of fc.features){f.properties.country=c2;f.properties.crop_code=p.crop_code;f.properties.season=p.season;}if(layer==='progress')harvestScale(fc);appendFeatures(id,fc.features);return;}
    }
    const local = g.features.some(f => f.properties.level !== 'national' && vals[f.id]);
    const feats = g.features.map(f => {
      const national = f.properties.level === 'national';
      let color, words, reporting = true, uncertaintyRow = null;
      if (national) { const pp = byIso.get(c2); if (local) { color = '#eef0ee'; words = ''; reporting = false; } else if (!pp) { color = C.none; words = `No ${FAMILY_LABEL[fam].toLowerCase()} records`; } else if (layer !== 'outlook' || pp.pct == null) { color = C.notEstimated; words = layer === 'outlook' ? 'Current estimate unavailable' : 'Calendar layers are drawn for the page\'s own country'; } else { color = outlookColor(pp.pct); words = `${esc(cropSeason(pp))}<br>Yield ${pct(pp.pct)} from usual (${pct(pp.lo)} to ${pct(pp.hi)}) · harvest ${pp.harvest_year}`; } }
      else { const v = vals[f.id] ? Object.fromEntries(cols.map((cc, i) => [cc, vals[f.id][i]])) : null; const pp = byIso.get(c2);
        if (layer !== 'outlook') { color = C.notEstimated; words = 'Calendar layers are drawn for the page\'s own country'; }
        else if (!v) { color = C.none; words = `No ${FAMILY_LABEL[fam].toLowerCase()} records for this season`; }
        else if (v.pct == null) { color = C.notEstimated; words = `${pp ? esc(cropSeason(pp)) + '<br>' : ''}Not estimated`; }
        else { color = outlookColor(v.pct); words = `${pp ? esc(cropSeason(pp)) + '<br>' : ''}Yield ${pct(v.pct)} from usual (${pct(v.lo)} to ${pct(v.hi)}) · harvest ${v.harvest_year}`; } }
      if (layer === 'outlook') uncertaintyRow = national ? (!local ? byIso.get(c2) : null) : vals[f.id] ? Object.fromEntries(cols.map((cc,i)=>[cc,vals[f.id][i]])) : null;
      const outlineOnly = !local && !national && byIso.has(c2);
      return {...f, properties: {...f.properties, country: c2, color, words:words+outlookIntervalNote(uncertaintyRow), zeroConsistent:!outlineOnly && zeroConsistent(uncertaintyRow), outlineOnly, reporting:reporting && !outlineOnly, selected: false, member: false}};
    });
    appendFeatures(id, layered(feats));
  }));
}
function appendFeatures(id, feats) {
  const map = maps[id]; if (!map || !feats.length) return;
  const apply = () => { const src = map.getSource && map.getSource('u'); if (!src || !src.setData) return; const data = map.__data || src._data || src.data; if (!data) return; const existing = new Set(data.features.map(f => f.id)); const added = feats.filter(f => !existing.has(f.id)); if (!added.length) return; data.features.push(...added); map.__data = data; src.setData(data); };
  if (map.getSource && map.getSource('u')) apply(); else map.on('load', apply);
}
const row = (label, sub, chart, nums) => `<section class="row"><div class="label">${esc(label)}<span class="detail">${esc(sub)}</span></div><div class="chart">${chart}</div>${nums ? `<div class="nums">${nums}</div>` : ''}</section>`;
const numbers = items => items.map(it => `<div class="num"><div class="k">${esc(it.k)}</div>${it.v != null ? `<div class="v">${esc(it.v)}</div>` : `<div class="v text">${esc(it.text)}</div>`}</div>`).join('');
// ---- the row chart: filled observed points, one fitted curve with one band, an open diamond for the forecast and an open circle for the season so far
function niceTicks(lo, hi, n = 4) { const span = hi - lo || 1; const raw = span / n; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6)); return out; }
function tickDecimals(ticks) {
  const step=ticks.length>1?Math.abs(ticks[1]-ticks[0]):1;
  let decimals=0;
  while(decimals<6 && Math.abs(step*10**decimals-Math.round(step*10**decimals))>1e-7)decimals++;
  return decimals;
}
function jointOutline(j, level, count=96) {
  const [xx,xy,yy]=j.shape, q=level===80?j.q80:j.q95;
  const a=Math.sqrt(Math.max(xx,0)), b=a>0?xy/a:0, c=Math.sqrt(Math.max(yy-b*b,0)), radius=Math.sqrt(q);
  return Array.from({length:count},(_,i)=>{const t=2*Math.PI*i/count;return [j.center[0]+radius*a*Math.cos(t),j.center[1]+radius*(b*Math.cos(t)+c*Math.sin(t))];});
}
function rowChart(o) {
  const compact = !!o.compact, showX = o.xAxis !== false, reader = !!o.reader;
  const W = reader ? Math.max(240, o.width || 480) : 660, H = reader ? (o.height || (showX ? 154 : 132)) : compact ? 215 : 200,
    L = reader ? 48 : compact ? 78 : 48, R = reader ? (o.mode === 'enso' && !o.jointMode ? 57 : 12) : o.mode === 'enso' && !o.jointMode ? 92 : 18,
    T = reader ? 23 : compact ? 10 : 16, B = showX ? 36 : reader ? 14 : 8, fill = o.symbolFill || '#111';
  const fs = reader ? 11 : compact ? 13 : 11, fl = reader ? 12 : compact ? 14 : 11;
  const ys = o.points.map(p => p.y); if (o.forecast) ys.push(o.forecast.lo ?? o.forecast.y, o.forecast.hi ?? o.forecast.y, o.forecast.y); if (o.sofar) ys.push(o.sofar.y);
  if(o.joint)ys.push(...o.joint.bounds95.slice(2));
  const domain=o.curveDomain || [o.x0,o.x1];
  const samples = o.curve ? Array.from({length: 61}, (_, i) => domain[0] + (domain[1] - domain[0]) * i / 60) : [];
  if (o.curve) for (const x of samples) { ys.push(o.curve.fn(x)); if (o.curve.lo) ys.push(o.curve.lo(x), o.curve.hi(x)); }
  let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; } const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = v => L + (v - o.x0) / (o.x1 - o.x0 || 1) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const xStrip = W - R / 2 + (reader ? 0 : 6);
  const xticks = o.mode === 'enso' ? niceTicks(o.x0, o.x1, reader ? 3 : 6) : niceTicks(o.x0, o.x1, reader ? 3 : 5).filter(v => Number.isInteger(v));
  let yt = niceTicks(y0, y1, reader ? 3 : 4);
  if (yt.length < 2) yt = niceTicks(y0, y1, 5);
  const yd=tickDecimals(yt), xd=tickDecimals(xticks);
  const seasonX = o.mode === 'enso' ? (o.jointMode ? X(o.forecast?.x ?? 0) : xStrip) : X(o.hy);
  let g = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.yLabel)} against ${esc(o.xLabel)}">`;
  if (reader) g += `<rect data-chart-frame="" x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}" fill="none" stroke="#e4e3dc" stroke-width=".7"/>`;
  g += yt.map(v => `<line x1="${L}" x2="${W - R + 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${v === 0 ? '#6f6c66' : '#e9e8e2'}"/><text x="${L - 6}" y="${(Y(v) + fs * 0.35).toFixed(1)}" font-size="${fs}" text-anchor="end" fill="#86847e">${fmt(v, yd, true)}</text>`).join('');
  if (!yt.includes(0)) g += `<line x1="${L}" x2="${W - R + 4}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" stroke="#6f6c66"/>`;   // the zero line on every panel
  if (showX) g += xticks.map(v => `<text x="${X(v).toFixed(1)}" y="${H - B + fs + 4}" font-size="${fs}" text-anchor="middle" fill="#86847e">${o.mode === 'enso' ? fmt(v, xd, true) : v}</text>`).join('');
  if (reader) g += `<text class="chart-y-label" x="${L}" y="13" font-size="12" fill="#111">${esc(o.yLabel.charAt(0).toUpperCase() + o.yLabel.slice(1))}</text>`;
  else if (compact) g += `<text transform="rotate(-90)" x="${(-(T + (H - T - B) / 2)).toFixed(1)}" y="${fl}" font-size="${fl}" text-anchor="middle" fill="#4f4e4a">${esc(o.yLabel)}</text>${o.letter ? `<text x="${L + 6}" y="${T + 14}" font-size="${fl}" font-weight="700" fill="#111">${esc(o.letter)}</text>` : ''}`;
  else g += `<text x="${L}" y="11" font-size="11" fill="#4f4e4a">${esc(o.yLabel)}</text>`;
  if (showX) g += `<text class="chart-x-label" x="${(L + (W - L - R) / 2).toFixed(1)}" y="${H - 3}" font-size="${reader ? 11 : fl}" text-anchor="middle" fill="#4f4e4a">${esc(reader && W < 360 ? o.xLabel.replace('Growing-season ', '') : o.xLabel)}</text>`;
  if (o.mode === 'enso' && !o.jointMode && (o.forecast || o.sofar)) g += reader ? `<text x="${xStrip}" y="13" font-size="11" text-anchor="middle" fill="#4f4e4a">${o.hy}</text>` : `<line x1="${W - R + 14}" x2="${W - R + 14}" y1="${T}" y2="${H - B}" stroke="#c4c3bb" stroke-dasharray="2 3"/>` + (showX ? `<text x="${xStrip}" y="${H - B + fs + 4}" font-size="${fs}" text-anchor="middle" fill="#86847e">this season</text>` : '');
  if(o.joint)for(const level of [95,80]) {
    const label=`${level}% joint region: growing-season ENSO and ${o.yLabel}; ${o.joint.scope}. ${o.joint.enso_input_fixed?'Growing-season ENSO is observed; response uncertainty remains.':`CPC issued ${o.joint.issue_date}.`} Harvest ${o.hy}.`;
    const points=jointOutline(o.joint,level).map(([x,y])=>`${X(x).toFixed(2)},${Y(y).toFixed(2)}`).join(' ');
    g+=`<polygon class="joint-region joint-${level}" points="${points}" fill="#276b9b" fill-opacity="${level===80?.10:.035}" stroke="#276b9b" stroke-width="${level===80?1.7:1.3}"${level===95?' stroke-dasharray="5 3"':''} tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></polygon>`;
  }
  if (o.curve) {
    if (o.curve.lo) { const band = samples.map(x => `${X(x).toFixed(1)},${Y(o.curve.hi(x)).toFixed(1)}`).concat(samples.slice().reverse().map(x => `${X(x).toFixed(1)},${Y(o.curve.lo(x)).toFixed(1)}`)).join(' '); g += `<polygon points="${band}" fill="#111" opacity=".09"><title>95% confidence band of the fitted response</title></polygon>`; }
    g += `<path d="${samples.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(o.curve.fn(x)).toFixed(1)}`).join(' ')}" fill="none" stroke="#111" stroke-width="1.6"/>`;
  }
  if (reader && o.mode === 'year' && o.points.length) g += `<path class="history-line" d="${o.points.slice().sort((a,b) => a.x-b.x).map((p,i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="#86847e" stroke-width=".8" opacity=".45"/>`;
  g += o.points.map(p => p.open ? `<circle class="pt provisional" data-year="${p.year}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${reader ? 2.6 : 3}" fill="#fff" stroke="${fill}" stroke-width="1" opacity=".85"><title>${esc(p.label)}</title></circle>`
    : `<circle class="pt" data-year="${p.year}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${reader ? 2.6 : 3}" fill="${fill}" opacity=".85"><title>${esc(p.label)}</title></circle>`).join('');
  if (o.sofar) g += `<circle class="pt open" data-year="${o.hy}" cx="${seasonX.toFixed(1)}" cy="${Y(o.sofar.y).toFixed(1)}" r="5" fill="#fff" stroke="${fill}" stroke-width="1.8"><title>${esc(o.sofar.label)}</title></circle>`;
  if (o.forecast) { const cy = Y(o.forecast.y); if(!(o.jointMode&&o.mode==='enso'))g += `<line x1="${seasonX.toFixed(1)}" x2="${seasonX.toFixed(1)}" y1="${Y(o.forecast.hi ?? o.forecast.y).toFixed(1)}" y2="${Y(o.forecast.lo ?? o.forecast.y).toFixed(1)}" stroke="${fill}" stroke-width="1.4"/>`; g += `<polygon class="pt open" data-year="${o.hy}" points="${seasonX},${cy - 6} ${seasonX + 6},${cy} ${seasonX},${cy + 6} ${seasonX - 6},${cy}" fill="#fff" stroke="${fill}" stroke-width="1.8"><title>${esc(o.forecast.label)}</title></polygon>`; }
  if (o.note) {
    const lines = reader ? o.note.match(new RegExp(`.{1,${Math.max(22,Math.floor((W-L-R)/6))}}(?:\\s|$)|\\S+`, 'g')) || [o.note] : [o.note];
    g += `<text x="${(L + (W - L - R) / 2).toFixed(1)}" y="${(T + (H - T - B) / 2 - (lines.length - 1) * 7).toFixed(1)}" font-size="${reader ? 11 : 12.5}" text-anchor="middle" class="pending" fill="#4f4e4a">${lines.map((line,i) => `<tspan x="${(L + (W-L-R)/2).toFixed(1)}" dy="${i ? 14 : 0}">${esc(line.trim())}</tspan>`).join('')}</text>`;
  }
  return g + '</svg>' + (o.sofarReadout ? `<p class="season-readout">${esc(o.sofarReadout)}</p>` : '') + (o.outlookMissing ? `<p class="season-readout">${esc(o.outlookMissing)}</p>` : '');
}
// A table whose numeric columns are marked with a trailing # in the header (the credits).
const NUMERIC_CELL = new RegExp('^[+\\u2212-]?[0-9]');
function table(head, rows) {
  const numeric = head.map(h => h.endsWith('#'));
  const th = head.map((h, i) => '<th' + (numeric[i] ? ' class="n"' : '') + '>' + esc(h.replace(/#$/, '')) + '</th>').join('');
  const body = rows.map(r => '<tr>' + r.map((v, i) => '<td' + (numeric[i] || (typeof v === 'string' && NUMERIC_CELL.test(v)) ? ' class="n"' : '') + '>' + (v == null ? '–' : esc(v)) + '</td>').join('') + '</tr>').join('');
  return '<table class="t"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
}
// ---- maps --------------------------------------------------------------------------------------------------------
// The cropped-land mask: Mercator tiles on the country and place maps; on the world map, which is drawn in its own plane,
// one image per family rendered in that plane and pinned to the corners of the box (top left, top right, bottom right,
// bottom left). The source is 'cropmask' because the world map's meridian masks already use 'mask'.
function addMask(map, m) {
  if (m.tiles) map.addSource('cropmask', {type: 'raster', tiles: [m.tiles], tileSize: 256, maxzoom: 6});
  else map.addSource('cropmask', {type: 'image', url: m.image, coordinates: [[WORLD_BOUNDS[0][0], WORLD_BOUNDS[1][1]], [WORLD_BOUNDS[1][0], WORLD_BOUNDS[1][1]], [WORLD_BOUNDS[1][0], WORLD_BOUNDS[0][1]], [WORLD_BOUNDS[0][0], WORLD_BOUNDS[0][1]]]});
  map.addLayer({id: 'crop-mask', type: 'raster', source: 'cropmask', paint: {'raster-opacity': 1, 'raster-resampling': 'nearest', 'raster-fade-duration': 0}});
}
// The tooltip sits below and right of the pointer, and flips to the other side when that would run past the map's edge
// (11 October 2026: sliding it into the corner put it over the unit being pointed at); it never covers the pointer.
function placeTip(tip, el, pt) {
  const w = tip.offsetWidth, h = tip.offsetHeight, gap = 12;
  const left = pt.x + gap + w + 6 <= el.clientWidth ? pt.x + gap : pt.x - gap - w;
  const top = pt.y + gap + h + 6 <= el.clientHeight ? pt.y + gap : pt.y - gap - h;
  tip.style.left = Math.max(6, left) + 'px'; tip.style.top = Math.max(6, top) + 'px';
}
function drawMap(id, fc, tipFn, clickFn, fit, regions, regionLink, opts = {}) {
  const el = document.getElementById(id); if (!el) return;
  if (!window.maplibregl) { el.innerHTML = '<p class="map-note">The map needs WebGL; Browse records and the place search provide access to the records.</p>'; return; }
  if (maps[id]) { try { maps[id].remove(); } catch (e) { /* ignore */ } delete maps[id]; }
  const map = new maplibregl.Map({container: id, style: {version: 8, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': fit === WORLD_BOUNDS ? '#fbfaf7' : '#dfe6ec'}}]}, attributionControl: false, renderWorldCopies: fit !== WORLD_BOUNDS && !!fit && (fit[0][0] < -180 || fit[1][0] > 180)});
  // Local maps can be dragged; scrolling continues to move the page rather than changing the map's zoom.
  for (const h of ['scrollZoom', 'boxZoom', 'dragRotate', 'dragPan', 'keyboard', 'doubleClickZoom', 'touchZoomRotate']) { try { if (h !== 'dragPan' || !opts.draggable) map[h]?.disable?.(); } catch (e) { /* stub */ } }
  if (opts.draggable) {
    el.title = 'Drag to move the map. Click a region to select it.';
    map.getCanvas().style.cursor = 'grab';
    map.on('dragstart', () => { map.getCanvas().style.cursor = 'grabbing'; if (map.__tip) map.__tip.style.display = 'none'; });
    map.on('dragend', () => { map.getCanvas().style.cursor = 'grab'; opts.onPan?.(map); });
  }
  map.on('load', () => {
    // Country files hold up to 5,400 polygons (Brazil, 8.5 MB); a coarser tile tolerance and a small buffer keep the
    // tiling worker under a few seconds until the geometry is tiled server side.
    if (fit === WORLD_BOUNDS) { map.addSource('frame', {type: 'geojson', data: {type: 'FeatureCollection', features: [worldFrame()]}}); map.addLayer({id: 'frame-fill', type: 'fill', source: 'frame', paint: {'fill-color': '#e6eaee'}}); }
    map.addSource('u', {type: 'geojson', data: fc, tolerance: 0.8, buffer: 16, maxzoom: 10}); map.__data = fc;
    map.addLayer({id: 'u-fill', type: 'fill', source: 'u', filter:['!=',['get','outlineOnly'],true], paint: {'fill-color': ['get', 'color'], 'fill-opacity': 0.95}});
    if (opts.mask) addMask(map, opts.mask);
    // Boundaries sit above the crop mask. Selection changes only the outline, preserving the fill's data value.
    // A transparent hit layer keeps historical districts selectable above a national fill.
    map.addLayer({id:'u-hit',type:'fill',source:'u',paint:{'fill-color':'#000','fill-opacity':0}});
    map.addLayer({id: 'u-line', type: 'line', source: 'u', paint: {'line-color': MAP_COLORS.local, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.15, 4, 0.5, 7, 0.85], 'line-opacity': 0.75}});
    map.addLayer({id: 'local-line', type: 'line', source: 'u', filter: ['==', ['get', 'localDetail'], true], paint: {'line-color': '#364d3c', 'line-width': 1.1, 'line-dasharray': [1, 2]}});
    // No wash over the units outside a state (the user's rule of 11 October 2026, afternoon): the political boundaries mark
    // the state well enough, and the washed colours read as a third class once the cropped-land mask was on.
    if (regions?.features?.length) {
      const outlined = regions.features.filter(f => f.geometry);
      if (outlined.length) { map.addSource('regions', {type: 'geojson', data: {type: 'FeatureCollection', features: outlined}}); map.addLayer({id: 'region-line', type: 'line', source: 'regions', paint: {'line-color': MAP_COLORS.local, 'line-width': 1.1, 'line-opacity': .9}}); }
      if (maplibregl.Marker && regionLink) for (const f of regions.features) { const href = regionLink(f.properties.name); if (!href || !f.properties.center) continue; const b = document.createElement('button'); b.className = 'region-label'; b.textContent = f.properties.name; b.type = 'button'; const fullName=unitLabel({name:f.properties.name,level:'region'},route().iso); b.title=fullName; b.setAttribute('aria-label', `Open ${fullName}`); b.onclick = () => { location.hash = href; }; new maplibregl.Marker({element: b}).setLngLat(f.properties.center).addTo(map); }
    }
    const nationalFilter = fit === WORLD_BOUNDS ? {} : {filter: ['==', ['get', 'level'], 'national']};
    map.addLayer({id: 'national-halo', type: 'line', source: 'u', ...nationalFilter, paint: {'line-color': MAP_COLORS.halo, 'line-width': fit === WORLD_BOUNDS ? 2.1 : 3.2, 'line-opacity': .9}});
    map.addLayer({id: 'national-line', type: 'line', source: 'u', ...nationalFilter, paint: {'line-color': MAP_COLORS.national, 'line-width': fit === WORLD_BOUNDS ? 1.1 : 1.8, 'line-opacity': 1}});
    map.addLayer({id: 'sel-halo', type: 'line', source: 'u', filter: ['==', ['get', 'selected'], true], paint: {'line-color': MAP_COLORS.halo, 'line-width': 4.8}});
    map.addLayer({id: 'sel-line', type: 'line', source: 'u', filter: ['==', ['get', 'selected'], true], paint: {'line-color': MAP_COLORS.selectionEdge, 'line-width': 2.6}});
    if (fit === WORLD_BOUNDS) { map.addSource('mask', {type: 'geojson', data: {type: 'FeatureCollection', features: worldMasks()}}); map.addLayer({id: 'mask-fill', type: 'fill', source: 'mask', paint: {'fill-color': '#fbfaf7'}}); }
    const b = fit || bounds(fc);
    if (!map.__cameraInitialized) { if (opts.camera) map.jumpTo(opts.camera); else if (b) map.fitBounds(b, {padding: fit === WORLD_BOUNDS ? 0 : 16, duration: 0, maxZoom: 9}); map.__cameraInitialized = true; }
    const tip = document.createElement('div'); tip.className = 'tooltip'; tip.style.display = 'none'; el.appendChild(tip);
    // MapLibre keeps only integer feature ids on rendered features, and ours are strings ("BRA", "BRA:10:1125"), so
    // a rendered feature arrives with a generated integer id (Brazil came back as 0); the handlers key on the id, so
    // take it from the properties, which the exporter writes on every feature.
    const withId = f => (f && f.properties && typeof f.id !== 'string') ? Object.assign(Object.create(Object.getPrototypeOf(f)), f, {id: f.properties.id ?? f.properties.country ?? f.id}) : f;
    // Under one pointer the country map can hold a reporting unit and the national polygon beneath it, which also
    // reports where the country has a national series; the local unit is the one the reader is pointing at.
    const pick = fs => withId(fs.find(f => (f.properties.selectable === true || f.properties.reporting === true) && f.properties.level !== 'national') || fs.find(f => f.properties.reporting === true) || fs[0]);
    // A finer layer may sit over this one (the world map's units); where it covers the pointer, its own handlers answer.
    const covered = e => map.__overlay && map.getLayer && map.getLayer(map.__overlay) && map.queryRenderedFeatures && map.queryRenderedFeatures(e.point, {layers: [map.__overlay]}).length > 0;
    map.on('mousemove', 'u-hit', e => { if (covered(e) || map.isMoving?.()) return; const f = pick(e.features); if (!f) return; tip.innerHTML = tipFn(f) + `<br><span class="muted">${opts.draggable ? 'Click to select · drag to move' : 'Click to open'}</span>`; tip.style.display = ''; placeTip(tip, el, e.point); map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'u-hit', () => { tip.style.display = 'none'; map.getCanvas().style.cursor = opts.draggable ? 'grab' : ''; });
    map.on('click', 'u-hit', e => { if (covered(e)) return; clickFn(pick(e.features)); });
    map.__tip = tip; map.__el = el; map.__withId = withId;
    opts.onPan?.(map);
  });
  maps[id] = map;
}
// A finer polygon layer over a drawn map, with its own tooltip and click: the world map's reporting units.
function overlayUnits(id, fc, tipFn, clickFn) {
  const map = maps[id]; if (!map || !fc.features.length) return;
  const add = () => {
    if (map.getSource && map.getSource('wu')) return;
    map.addSource('wu', {type: 'geojson', data: fc, tolerance: 0.6, buffer: 8, maxzoom: 8});
    // Opaque local fills preserve the reporting unit’s own effect above the national fill.
    const before=map.getLayer && map.getLayer('crop-mask') ? 'crop-mask' : map.getLayer?.('u-hit') ? 'u-hit' : 'u-line';
    map.addLayer({id: 'wu-fill', type: 'fill', source: 'wu', paint: {'fill-color': ['get', 'color'], 'fill-opacity': 1}}, before);
    map.addLayer({id: 'wu-line', type: 'line', source: 'wu', paint: {'line-color': MAP_COLORS.local, 'line-width': 0.2, 'line-opacity': 0.6}}, 'u-line');
    map.__overlay = 'wu-fill';
    // The rendered feature's id is MapLibre's integer (0 for the first), so the key is read from the properties at event
    // time; the id may not be attached by drawMap's load handler yet when this overlay is added.
    const tip = map.__tip, el = map.__el, withId = f => f && f.properties ? Object.assign(Object.create(Object.getPrototypeOf(f)), f, {id: f.properties.id ?? f.properties.country ?? f.id}) : f;
    map.on('mousemove', 'wu-fill', e => { const f = withId(e.features[0]); if (!f || !tip) return; tip.innerHTML = tipFn(f) + '<br><span class="muted">Click to open the country</span>'; tip.style.display = ''; placeTip(tip, el, e.point); map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'wu-fill', () => { if (tip) tip.style.display = 'none'; map.getCanvas().style.cursor = ''; });
    map.on('click', 'wu-fill', e => clickFn(withId(e.features[0])));
  };
  // loaded() becomes false during source tiling even after the one-shot load event.
  // The base layer is the readiness signal; waiting for a second load loses the overlay.
  if (map.getLayer?.('u-line')) add(); else map.on('load', add);
}
// Fit complete geometry, not quantiles of crop-reporting centroids. Use the contiguous US
// as its overview; outlying units remain reachable through record search.
function countryBounds(geo,iso,units,p) {
  const local=units&&p ? geo.features.filter(f=>f.properties.level!=='national'&&units.units[f.id]&&hasSeries(units.units[f.id],p)) : [];
  if(iso!=='USA'&&local.length) return countryExtent({features:local});
  let features=geo.features.filter(f=>f.properties.level==='national');
  if(!features.length)features=geo.features;
  const parts=features.flatMap(f=>(f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:f.geometry?[f.geometry.coordinates]:[]).map(c=>({type:'Feature',geometry:{type:'Polygon',coordinates:c}})));
  const selected=iso==='USA'?parts.filter(f=>{const b=bounds({features:[f]});return b&&b[0][0]>=-126&&b[1][0]<=-65&&b[0][1]>=24&&b[1][1]<=50;}):parts;
  return countryExtent({features:selected.length?selected:features});
}
function countryExtent(fc) {
  const box = bounds(fc); if (!box || box[1][0]-box[0][0] <= 180) return box;
  const longitudes = [];
  const walk = c => { if (typeof c[0] === 'number') longitudes.push((c[0]+360)%360); else c.forEach(walk); };
  fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates));
  const xs = [...new Set(longitudes)].sort((a,b)=>a-b);
  let gap=-1, after=0;
  for(let i=0;i<xs.length;i++) { const d=(i+1<xs.length?xs[i+1]:xs[0]+360)-xs[i]; if(d>gap){gap=d;after=(i+1)%xs.length;} }
  let west=xs[after], east=west+360-gap;
  if(west>180){west-=360;east-=360;}
  return [[west,box[0][1]],[east,box[1][1]]];
}
function bounds(fc) { let w = 180, s = 90, e = -180, n = -90, any = false; const walk = c => { if (typeof c[0] === 'number') { any = true; w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); }; fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates)); return any ? [[w, s], [e, n]] : null; }
// ---- the explanation, methods and credits below the world map ------------------------------------------------------
function methods(fam) {
  const W=D.world;
  if(D.release !== '2026-10-19' || route().q.get('to') === 'reference') return detailedMethods(fam);
  return collapseMethods(`<div class="prose" id="methods"><h2 id="about">About the atlas</h2>
  <p>The ENSO crop atlas shows how El Niño and La Niña have been associated with crop yields across countries and regions, and what those relationships imply under the current ENSO scenario. Select a crop and click the map to explore local yield records. Temperature, rainfall and satellite greenness (NDVI) updates help track the growing season where observations are available. Choose <b>ENSO relationship</b> to explore historical responses or <b>History</b> to follow changes through time.</p>
  <h2 id="reading">Reading the maps and charts</h2>
  <ul><li><b>Outlook:</b> Estimated ENSO-associated yield change relative to the trend for the selected harvest year. Brown indicates decreases; green indicates increases.</li>
  <li><b>Harvest history:</b> Reported yield departures from the fitted trend, reflecting weather and other influences.</li>
  <li><b>Crop calendar:</b> Typical harvest dates, coloured relative to today. Local calendar bars show planting and growth stages where available.</li>
  <li><b>Hatching:</b> The 80% interval for the ENSO effect includes zero.</li>
  <li><b>Local charts:</b> Points show past observations; the curve shows the fitted relationship. The diamond marks the central scenario. Ellipses show joint uncertainty in seasonal ENSO exposure and its estimated yield effect.</li></ul>
  <h2 id="estimation">Estimates and uncertainty</h2>
  <p>We estimate each crop’s response to ENSO during its growing season, accounting for long-term yield trends and drawing partly on regional records. Relationships and predictive skill vary by crop and region.</p>
  <p>Historical skill is assessed by withholding each harvest year across pooled locations, fitting the model to the remaining years, and comparing its prediction with the trend alone. These tests use the observed seasonal ENSO index; skill with an issued forecast remains a separate question.</p>
  <p>The displayed 80% range describes uncertainty in the ENSO-associated effect. Total harvest uncertainty also includes other influences on yield.</p>
  <p>Future ENSO months follow the shape of 2015–16, scaled to the outlook’s peak amplitude. This can produce negative exposure after the El Niño peak. The ranges hold that shape fixed and omit uncertainty about the timing of the transition.</p>
  <h2 id="credits">Data, sources and release</h2>
  <p>Crop records come from HarvestStat, the Hultgren compilation and agency extensions, and FAOSTAT. Weather and greenness come from Berkeley Earth/CPC, CHIRPS, ERA5 and NOAA satellite products. Calendars combine documented local sources with RiceAtlas, FAO GIEWS and other published calendars. Coverage and permissions vary by source.</p>
  <p class="detail">Release ${esc(D.release)} · ENSO outlook ${esc(W.issue)} · Weather through ${esc(longDate(W.data_end))}${intervalReviewLabel()?' · '+esc(intervalReviewLabel()):''}</p>
  <p><a href="../references.html">Data sources and references</a> · <a href="${link(null,null,{to:'reference',release:D.release})}">Detailed release documentation</a> · <a href="../acknowledgements.html">Acknowledgements</a> · <a href="https://github.com/phuybers3/enso-yield-atlas/issues">Report an issue</a></p>
  <h2 id="related">Related resources</h2>
  <p><a href="https://glam.nasaharvest.org/info"><b>NASA Harvest — Harvest GLAM</b></a> provides satellite-based crop monitoring tools, including vegetation and rainfall time series, to follow conditions during the growing season.</p>
  <p><a href="https://www.cropmonitor.org/about-the-reports"><b>GEOGLAM Crop Monitor</b></a> combines satellite observations, field reports and expert assessments in regular crop-condition bulletins.</p>
  <p><a href="https://fews.net/about"><b>FEWS NET — food-security early warning</b></a> assesses acute food insecurity using weather, harvest conditions, prices, trade, conflict and household livelihoods. Its outlooks help explain how agricultural shocks affect access to food.</p>
  <p><a href="https://www.fao.org/giews/country-analysis/en/"><b>FAO GIEWS</b></a> provides country assessments of harvest prospects, cereal production, trade and food prices.</p>
  <p><a href="https://agricultural-production-hotspots.ec.europa.eu/"><b>JRC ASAP</b></a> identifies agricultural production hotspots using weather and satellite vegetation observations.</p>
  <p><b>The ENSO crop atlas starts with reported harvest outcomes.</b> We assemble long subnational yield records from censuses, agricultural surveys and administrative statistics, then estimate and test their relationships with growing-season ENSO. Readers can inspect those records alongside weather and greenness updates. This combination complements the monitoring and food-security assessments above.</p></div>`);
}
function detailedMethods(fam) {
  const W = D.world, o = W.index.outlook;
  const fit = isReconciled()
    ? (D.catalog.model?.display_specification
      ? `Resolved harvests, the harvest years already reported from 1981 to 2025, enter one estimator for the map, the pages and the tests: each series' own slope of log yield on the growing-season relative Niño 3.4 index (RONI: the Niño 3.4 sea-surface temperature anomaly less the mean anomaly of the tropical oceans, so that a warming ocean does not read as a standing El Niño), with a linear trend, moved a quarter of the way toward the estimate of a hierarchical model that pools the series with its state and country; that quarter is the pooling fraction, ${fmt(D.catalog.model.display_specification.pooling_fraction, 2)}, and the fitting code and its date are the model version, ${esc(W.model_version || D.catalog.model?.model_version || '')}, named in the release files. Local intercepts and trends are fitted conditional on that slope, and the historical scatter points use the resulting ENSO-neutral trend. Outlook headlines sum the fitted local production changes, and their ranges come from shared uncertainty draws: one set of resampled harvest years and outlook values applied to every series, so that the sums are coherent. A state curve is a production-weighted sum of local curves. The exponentiated log-yield responses describe geometric-mean contrasts, and changes in residual yield variability are excluded from the central effect. An estimate is marked validated where the country panel's skill in full-record leave-one-year-out tests (each harvest year withheld in turn, every pooled location refitted without it, the observed full-season index supplied) has an 80% range above zero, and conditional otherwise, which means that the historical relationship is shown without evidence that it predicts; issued-forecast skill is not assessed. The chance of a 20% loss or gain on a unit page comes from the leave-one-year-out errors of the same estimator at the central index path, and is marked where that path lies beyond the fitted index range.`
      : `Resolved harvests from 1981–2025 enter the same partially pooled estimator used in the withheld-year tests. Local intercepts and time trends are fitted conditional on the local ENSO coefficient. The historical scatter points use that ENSO-neutral trend. Outlook headlines sum the fitted local production changes; shared uncertainty draws supply their ranges. A state curve is a production-weighted sum of local curves. These exponentiated log-yield responses describe geometric-mean contrasts; changes in residual yield variability are excluded from the central effect.`)
    : isNew()
    ? `For each series we fit a log-linear trend and, in one hierarchical model per crop, season and index (${esc(W.model_version || D.catalog.model?.model_version || '')}), the response of the trend departure to the ENSO index over the growing window, relative Niño 3.4 from ERSSTv5 by default; a unit's slope is shrunk toward the center of its state and country, and a unit with no own slope shows no estimate. Outlooks are sums of the unit predictions under production weights fixed at the issue.`
    : `For each series we fit a log-linear trend and the response of the trend departure to the ENSO index over the growing window, relative Niño 3.4 from ERSSTv5 by default; units with short records borrow strength from their state and country.`;
  const ranges = isReconciled()
    ? `The outlook carries a central 80% range of the ENSO effect, combining the uncertainty of the fitted responses with the spread of the issued outlook across its lower, central and higher paths. Full-harvest residual variation, area and baseline uncertainty are excluded, so the range is narrower than the uncertainty of a harvest. ${D.catalog.model.uncertainty_calibration?.width_review?.approved ? 'Independent simulations found conservative coverage, especially where few reporting units are available; nominal percentages are not exact coverage guarantees. ' : ''}The orange–purple colorbar shows the central effect on a continuous scale from −30% to +30%, with a pale center at zero. Orange marks losses and purple marks gains. The tooltip retains the effect range and whether the interval includes zero; historical skill is assessed separately. ${intervalReviewLabel()}`
    : isNew()
    ? 'A range beside an ENSO-outlook number is the central 80% range of the ENSO effect across replicate fits and outlook members, not a prediction interval for the harvest; a range beside a weather-based number is the 95% confidence interval of the fitted mean. The orange–purple colorbar shows the central effect from −30% to +30%; the outlook tooltip retains the exact value and uncertainty range. Predictive skill is assessed separately. An ENSO estimate remains conditional where skill is untested or the validation checks at that lead are not met.'
    : 'The intervals beside the yield numbers are 95% intervals of the fitted coefficient.';
  return collapseMethods(`<div class="prose" id="methods">${aboutRelease()}<h2 id="reading">How to read the map</h2>
  <p>Each place is coloured by ${isReconciled()?'the fitted ENSO-related change from the neutral yield trend for':'the expected departure from usual of'} its coming ${FAMILY_LABEL[fam].toLowerCase()} harvest under the central path of the ENSO outlook of ${esc(W.issue)}: orange for losses, purple for gains, and pale near zero. The colorbar uses a fixed linear scale from −30% to +30% for every crop and map level. Colors saturate at the endpoints; tooltips retain the exact values. The ColorBrewer PuOr palette is designed to accommodate color vision deficiencies. Where a country reports by region, its reporting units are drawn in place of the national colour. A click opens the country: its map shows the reporting units, and in the largest countries the states first, then the units of a state. A unit page shows its temperature, rainfall and yield against the growing-season ENSO index or the harvest year, with the season so far and the expectation from the outlook; a state page shows the same for the state's average. Country and local maps can be dragged and draw the reporting units of neighbouring countries as their files arrive; selecting another region updates its plots and calendar while preserving the map position. Scrolling moves the page without zooming the map. The world map is drawn in the Equal Earth projection, which keeps areas true, between 65°N and 57°S and east of 130°W.</p>
  <p>The outlook is the ${esc(o.source)}: a central December–February relative Niño 3.4 of ${fmt(W.index.scenario_rel_djf.medium, 2)} °C between a lower path of ${fmt(W.index.scenario_rel_djf.low, 2)} and a higher one of ${fmt(W.index.scenario_rel_djf.high, 2)}. The map shows the central path; the unit pages carry all three. ${pathAssumptionLabel() ? 'Future months follow the 2015–16 evolution scaled to that December–February target. This assumed path does not reproduce all other issued CPC seasonal targets, and its evolution uncertainty is excluded from the plotted ranges.' : ''}</p>
  <h2 id="calendars">Calendars</h2>
  <p>The crop-calendar map shows typical harvest dates for the selected crop and harvest year. Its rose-to-blue scale is centered on today, spanning six calendar months before and after. Dates outside that window take the endpoint colors; tooltips retain the full dates. Dates describe usual timing, not observed field operations this year. At world level the map uses national calendars; on a country or local map it uses each reporting unit’s calendar. The separate bar below a local map shows growing-season stages where documented.</p>
  <h2 id="anomaly">Harvest anomaly by year</h2>
  <p>The harvest-anomaly map shows, for a chosen harvest year, how far each reported yield fell from the series' own trend: 100 times the reported yield over the trend yield of that year, minus 100, the value the unit page plots. The trend is a log-linear fit over all the series' years, a growth rate per year and the yield at 2000. The departures are observations. They contain the ENSO signal, the weather, pests, prices and reporting changes alike, and the reference trend is fitted from the yield record. The colours saturate at ±${ANOMALY_LIMIT} percent, three times the outlook scale, because observed departures are far wider than the ENSO effect: among the drawn series since 1981 a tenth lie beyond ±50 percent. Each country is coloured by the national series of the panel the outlook map colours it by, or by its national series of the crop family where that panel has none, with the series named in the tooltip. Every reporting unit with a record of the crop family is drawn over it, by its series of the crop and season the outlook map uses for that country, or by its series of the family otherwise, whether or not the unit has a current outlook, so records that end before the outlook period, such as the Australian wheat states to 2008, still appear; a unit without a reported yield in that year is left undrawn so the national colour shows through. The year control opens on the latest year with at least half the family's peak coverage; coverage thins after 2015 as the sources lag. The timeline under the control shows, per harvest year, the December–February relative Niño 3.4 ending in it and the number of series with a value.</p>
  <h2 id="estimation">Methods and data</h2>
  <p>Yields are reported series from HarvestStat (Asia and Africa), the Hultgren et al. replication data and agency extensions, and FAOSTAT national totals, as the database frozen for the release stores them. ${fit} Season-to-date temperature uses the available Berkeley Earth/CPC record and rainfall uses CHIRPS, compared with the same part of earlier seasons. Greenness is the NOAA STAR Blended VHP weekly smoothed NDVI (AVHRR to 2012, VIIRS since), averaged over the cropland pixels of each reporting unit weighted by the harvested area of the crop, over the same growing window as the weather; its history is the departure from the unit\'s own mean and trend over the available record from 2001 onward, seasons before 2001 are drawn as open circles because the earlier satellites differ, and its ENSO response is fitted as the weather responses are. Calendars come from documented local sources where we have them and from RiceAtlas, FAO GIEWS and GGCMI otherwise. ${ranges} Observation points are shown where the recorded source permissions allow; records are served one place at a time, and no bulk file of a source whose terms are unrecorded is published. The release is ${esc(D.release)}, with weather to ${esc(longDate(W.data_end))} and the index to ${esc(W.index_last_month)}. Greenness is shown where the release has observations. A data descriptor documenting the release is in draft; until it is published, this page and the source register below describe the method.</p>
  <h2 id="credits">Credits</h2>
  ${credits(o)}</div>`);
}
// About this release (20 October 2026): the note to the atlas's first readers, for the release it describes; an earlier
// release points to the current one. The numbers are read from the release files where they are published there.
const ABOUT_RELEASE = '2026-10-19';
function aboutRelease() {
  const W = D.world, o = W.index.outlook, issues = 'https://github.com/phuybers3/enso-yield-atlas/issues';
  if (D.release !== ABOUT_RELEASE) return `<h2 id="about">About this release</h2><p>Release ${esc(D.release)} is an earlier export kept for comparison. The current release is <a href="${link(null, null, {to: 'methods'})}">${esc(D.releases.default)}</a>; the text below describes the release shown here.</p>`;
  const maize = (W.world || []).find(x => x.crop_family === 'maize' && x.method === 'index_outlook' && x.scenario === 'medium');
  const issueMonth = /^\d{4}-\d{2}$/.test(W.issue) ? `${monthName(Number(W.issue.slice(5, 7)))} ${W.issue.slice(0, 4)}` : W.issue;
  return `<h2 id="about">About this release</h2>
  <p>This is release ${esc(D.release)} of the ENSO crop atlas, the first shown outside the project. Its label says candidate because the release is in review, with interval calibration still under review; the label comes off when the review is recorded, with no change to the numbers. Please do not cite or redistribute the numbers yet; the data descriptor that documents them is in draft.</p>
  <p>Every page answers one question for one place: given the El Niño now under way, how far from usual is the coming harvest expected to be? The world map colours each country by the expected departure of the 2026–27 harvest from its trend, for one crop at a time, under the central outlook of the Climate Prediction Center issued in ${esc(issueMonth)}: a December-to-February relative Niño 3.4 index of ${fmt(o.medium, 2)}, with a 5th to 95th percentile range of ${fmt(o.low, 2)} to ${fmt(o.high, 2)}, which scaled to the atlas's own ERSSTv5-based index is a central path of ${fmt(W.index.scenario_rel_djf.medium, 2)} °C. A country page shows the same for its states or districts, and a place page shows the record behind the number: the yields as reported, the trend, the fitted response of yield to the growing-season index with its interval, and the season so far in temperature, rainfall and greenness.</p>
  <p>The estimate for a place is the slope of its own log yield on the growing season's relative Niño 3.4 index (RONI: the Niño 3.4 sea-surface temperature anomaly less the mean anomaly of the tropical oceans, so that a warming ocean does not read as a standing El Niño), with a linear trend, drawn one quarter of the way toward the pooled estimate for its region. The response record runs from 1981 where the yields allow. The range around the headline is the central 80 percent range of the ENSO effect from ${num(D.catalog.model?.replicates?.achieved || 4000)} draws that resample harvest years in blocks shared across every series, carry the error of the pooling, and redraw the outlook from its distribution; it describes the production change the ENSO effect implies, and not the whole uncertainty of a harvest, which the residual scatter of the years would widen.</p>
  <p>The atlas states where the relationship has been tested and where it has not. Each country panel carries a skill score from full-record leave-one-harvest-year-out tests of the displayed estimator against the trend alone: each harvest year is withheld in turn, every pooled location is refitted without it, and the observed growing-season index is supplied, so the score measures the relationship and not an issued forecast. A page is marked validated where the lower bound of the 80 percent range of that skill is above zero, which holds for a minority of the panels scored, among them South African and Zimbabwean maize, Australian wheat and sorghum, and Argentine rice, where El Niño moves growing-season rainfall. Elsewhere the response is shown as the historical relationship it is, marked conditional, and the outlook row says so.${maize ? ` The world maize figure is ${fmt(maize.dprod_mt, 1, true)} Mt (${pct(maize.pct)} of a ${num(maize.production_mt)} Mt baseline) with a range of ${fmt(maize.dprod_lo, 0, true)} to ${fmt(maize.dprod_hi, 0, true)} Mt; the 15 October release put it at +22.8 Mt on the same data, and the difference is the estimator, a quarter rather than the full shrinkage toward the regional centre, which is one of the choices we would like a reader's view on.` : ''}</p>
  <p>Weather observations end on ${esc(longDate(W.data_end))} and the monthly index in ${esc(/^\d{4}-\d{2}$/.test(W.index_last_month) ? `${monthName(Number(W.index_last_month.slice(5, 7)))} ${W.index_last_month.slice(0, 4)}` : W.index_last_month)}. The Brazilian maize record separates the first crop and the safrinha for the 475 municipalities that grow both, with safrinha windows from CONAB's calendar that have not yet had an agronomic review. Greenness before 2001 is provisional, and soil moisture is used in the validation but not shown. For HarvestStat Asia and the Hultgren et al. (2025) replication panels outside the agency countries, redistribution terms are unrecorded, so their points are shown one place at a time and are not offered in bulk. The release metadata retain an interval-calibration review flag.</p>
  <p>Comments are welcome as issues at <a href="${issues}">github.com/phuybers3/enso-yield-atlas/issues</a>: where a number is implausible, where a calendar is wrong for the crop, where a term is unexplained, and what one thing you would change on the first screen. The draft descriptor is available on request and names the source of every number.</p>`;
}
// The catalog carries the source register's working names and citations. The page shows the reader's form of the
// entries that name a script, a revision or a pipeline product, and says that the StableBound deposit is pending:
// the Zenodo record in the register is not registered (20 October 2026).
const READER_SOURCE = {
  hvstat: {citation: 'Foley et al., StableBound (ESSD, in review), dataset deposit pending, for India; FAO GAUL 2024/2025 boundaries (CC BY 4.0); Geolocet India boundaries, redistributed with permission, attribution required'},
  'cal:user_pairs': {name: 'Local crop calendars from the Hultgren et al. (2025) replication repository: validated planting and harvest date pairs per reporting unit', citation: 'Hultgren et al. (2025) replication package; pairs checked for this project'},
  'cal:user_windows': {name: 'Grain-filling windows derived from those calendars', citation: 'this project'},
  'cal:conab_safrinha': {name: 'CONAB Calendário de Plantio e Colheita de Grãos no Brasil, 2022 edition: second-crop (safrinha) maize planting and harvest months by state'},
  nino34: {name: 'Niño 3.4 from ERSSTv5, 1991–2020 base; the relative index of van Oldenborgh et al. (2021)'},
  cropgrids: {name: 'CROPGRIDS v1.08: harvested and crop area of 173 crops for 2020 at 0.05 degree; the crop weighting of grid cells within units per crop family'},
  cpc_global_temp: {name: 'CPC Global Unified daily TMAX and TMIN, 0.5 degree, gauge-based (NOAA PSL), adjusted per cell and calendar month to Berkeley Earth over 2015-01 to 2024-10; the temperature source from November 2024 onward'},
  chirps_prelim: {name: 'CHIRPS v2.0 daily precipitation for the current year: final files where released, preliminary monthly files after them; the rainfall source after 2025'},
};
const readerSource = (k, v) => ({...v, ...(READER_SOURCE[k] || {})});
// ---- provenance (21 October 2026): the organizations behind a series' observations, from the origins of the units file
// and catalog.origins; a release exported from a database without the origins table carries neither and prints nothing.
const VIA_LABEL = {hultgren: 'Hultgren et al. (2025)', hvstat: 'HarvestStat Asia', hvstat_africa: 'HarvestStat Africa', faostat: 'FAOSTAT'};
const originsOf = us => (us?.origins || []).map(([id, y0, y1, n]) => ({id, y0, y1, n, o: D.catalog.origins?.[id]})).filter(x => x.o);
function provenanceBlock(us, region) {
  if (region || !us) return '';
  const xs = originsOf(us); if (!xs.length) return '';
  const parts = xs.map(x => `${x.o.url ? `<a href="${esc(x.o.url)}" rel="noopener">${esc(x.o.agency_short || x.o.agency)}</a>` : esc(x.o.agency_short || x.o.agency)}`
    + `${x.o.document ? `, ${esc(x.o.document)}` : ''}, ${x.y0}${x.y1 !== x.y0 ? `–${x.y1}` : ''}${x.o.via ? ` <span>via ${esc(VIA_LABEL[x.o.via] || x.o.via)}</span>` : ''}`);
  return `<p class="regional-provenance" aria-label="Data provenance"><b>Yield data:</b> ${parts.join(' · ')}</p>`;
}
function provenanceCredits(us) {
  const xs = originsOf(us); if (!xs.length) return '';
  return `<p class="detail">Provenance of the yield record: ${xs.map(x => `${esc(x.o.credit || x.o.agency)}, ${x.n} ${x.n === 1 ? 'year' : 'years'} ${x.y0}–${x.y1}${x.o.licence ? ` (${esc(x.o.licence)})` : ''}`).join('; ')}.</p>`;
}
function originsTable() {
  const O = D.catalog.origins; if (!O) return '';
  const rows = Object.values(O).filter(o => o.n_obs > 0).sort((a, b) => (b.n_obs || 0) - (a.n_obs || 0))
    .map(o => [o.agency, o.iso3 || '', o.document || '', String(o.n_obs), o.first_year != null && o.last_year != null ? `${o.first_year}–${o.last_year}` : '', o.via ? (VIA_LABEL[o.via] || o.via) : 'direct']);
  return `<p>The organizations whose figures the records carry, with the observations attributed to each (the unit pages name them under the map):</p>${table(['Organization', 'Country', 'Document', 'Observations#', 'Years', 'Via'], rows)}`;
}
function credits(o) {
  const src = D.catalog.sources;
  if (!src) return `<p>ENSO crop atlas, Harvard University. Yields: HarvestStat; Hultgren et al. (2025) replication data and the agency series that extend it; FAOSTAT. Temperature: Berkeley Earth. Rainfall: CHIRPS. Greenness: NOAA STAR Blended Vegetation Health Product, weekly smoothed NDVI, crop-weighted per unit (cropland extract by Michael Foley). ENSO: NOAA ERSSTv5 and the ${esc(o.source)}. Boundaries: the sources' reporting units and Natural Earth. Map rendering: MapLibre GL.</p>`;
  const yields = Object.entries(src).filter(([, v]) => v.role === 'yield' && v.n_series);
  const rows = yields.map(([k, v0]) => { const v = readerSource(k, v0); return [v.name || k, v.citation, v.permission?.license || v.license, !v.permission?.display_points ? 'observation points withheld under the recorded source terms' : v.permission?.redistribute ? 'observations shown; rows may be redistributed' : `observations shown one place at a time; no bulk redistribution${v.permission?.note ? ' (' + v.permission.note + ')' : ''}`]; });
  const others = Object.entries(src).filter(([, v]) => v.role !== 'yield').map(([k, v0]) => { const v = readerSource(k, v0); return `${v.name || k}${v.citation ? ` (${v.citation})` : ''}`; });
  return `<p>ENSO crop atlas, Harvard University. The yield sources, their citations, licences and the rule applied to their observations:</p>${table(['Source', 'Citation', 'Licence', 'Observations'], rows)}${originsTable()}
  <p>Other data: ${esc(others.join('; '))}. Temperature: Berkeley Earth daily fields. Rainfall: CHIRPS. ENSO: NOAA ERSSTv5 and the ${esc(o.source)}. Boundaries: the sources' reporting units and Natural Earth. Map rendering: MapLibre GL.</p>`;
}
})();
