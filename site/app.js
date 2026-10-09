/* ENSO yield atlas: three views (record, response, season) over the units of one release, read from data/<release>/.
   The page formats and draws. It does not aggregate, pool, convert units or decide significance: every number shown is a
   field of a results row written by scripts/export_release.py, and tests/numerics.py checks those fields against the
   results folder. Routes: #/<view>/<ISO3>/<unit>?crop=&season=&release=&index= */
(() => {
const VIEWS = [['season', 'This season'], ['response', 'El Niño relationships'], ['record', 'Yield history']];
const METHOD_LABEL = {trend: 'Trend only', index_perfect: 'ENSO, future index known', index_todate: 'Index to date', index_outlook: 'Index outlook', weather_todate: 'Weather to date'};
const METHOD_COLOR = {trend: '#898781', index_perfect: '#b36b20', index_todate: '#eb6834', weather_todate: '#2a78d6', index_outlook: '#01665e'};
const SCENARIO_LABEL = {low: 'Lower ENSO', medium: 'Central', high: 'Higher ENSO', observed: 'Observed'};
const NO_ESTIMATE = '#d5d6d2';
// Brown to green for the ENSO response (the global atlas's convention), brown to green for the conditional yield of the
// season (the Watch's), a sequential green ramp for observed yields.
const RESPONSE_PALETTE = ['#7f3b08', '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', '#006837'];
const SCENARIO_PALETTE = ['#7f3b08', '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', '#006837'];
const YIELD_PALETTE = ['#f7fbf5', '#e3f1df', '#c7e9c0', '#9fd49a', '#74c476', '#238b45', '#00441b'];
// Rainfall anomalies in brown to teal (mm relative to the series' own history), temperature in blue to red.
const RAIN_PALETTE = ['#8c510a', '#bf812d', '#d8b365', '#f5f5ed', '#5ab4ac', '#35978f', '#01665e'];
const TEMP_PALETTE = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'];
const RESPONSE_LIMIT = 8, SCENARIO_LIMIT = 10, ANOMALY_LIMIT = 30, RAIN_Z_LIMIT = 100, TMAX_LIMIT = 1.5;
const METRIC_LABEL = {tavg_mean: ['Mean temperature', '°C'], tmax_mean: ['Mean daily maximum', '°C'], tmin_mean: ['Mean daily minimum', '°C'], gdd: ['Growing degree days', '°C d'], edd30: ['Degree days above 30 °C', '°C d'],
  kdd31: ['Degree days above 31 °C, per cell', '°C d'], tmax_p95_days: ['Days above the 95th-percentile maximum', 'd'], txx: ['Hottest day', '°C'], precip: ['Rainfall', 'mm'], wet_days: ['Wet days', 'd'],
  precip_p95_days: ['Very wet days', 'd'], rx1day: ['Wettest day', 'mm'], rx5day: ['Wettest five days', 'mm'], cdd: ['Longest dry spell', 'd']};
const LAYERS = [['scenario', 'Yield change: central ENSO scenario'], ['rain', 'Rainfall anomaly to date, mm'], ['tmax', 'Daily maximum temperature anomaly, °C']];
const verdictChip = v => v ? `<span class="chip ${v === 'as expected' ? 'blue' : v === 'against expectation' ? 'red' : 'grey'}">${esc(v)}</span>` : '';
const GATES = {frac_started: ['half the window run', v => v >= 0.5, v => fmt(100 * v, 0) + '% run'], coverage_share: ['a quarter of production scored', v => v >= 0.25, v => fmt(100 * v, 0) + '% of production'],
               se_panel: ['standard error under 40 points', v => v < 40, v => '± ' + fmt(v, 1)], skill_vs_trend: ['positive hindcast skill at this lead', v => v > 0, v => fmt(v, 2, true)]};
const HOSTING = {base:''};
const dataURL = path => HOSTING.base && /^(data|display)\//.test(path) ? HOSTING.base+path : path;
const cache = new Map(); const D = {release: null}; const maps = {}; let renderVersion = 0;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const fmt = (v, d = 1, sign = false) => v == null || !isFinite(v) ? '–' : (sign && v > 0 ? '+' : '') + Number(v).toFixed(d);
const pct = (v, d = 1) => v == null || !isFinite(v) ? '–' : fmt(v, d, true) + '%';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const cropLabel = code => D.catalog?.crops[code]?.label || String(code).replace(/_/g, ' ');
const seasonLabel = s => s === 'main' ? 'main season' : /^planted_m(\d+)$/.test(s) ? 'Planted in '+['January','February','March','April','May','June','July','August','September','October','November','December'][Number(s.slice(9))-1] : s;
const panelKey = (iso, crop, season) => `${iso}|${crop}|${season}`;
const statusChip = s => `<span class="chip ${s === 'complete' ? 'ink' : s === 'in the ground' ? 'blue' : 'grey'}">${esc(s)}</span>`;
async function load(path) {
  if (!cache.has(path)) cache.set(path, (async () => { const r = await fetch(dataURL(path)); if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`); return r.json(); })().catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}
// ---- colour scales ---------------------------------------------------------------------------------------------------
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; }
function diverging(v, lim, palette) { if (v == null || !Number.isFinite(v)) return NO_ESTIMATE; const x = (Math.max(-1, Math.min(1, v / lim)) + 1) * 3; const i = Math.min(5, Math.floor(x)); return mix(palette[i], palette[i + 1], x - i); }
function sequential(v, lo, hi, palette = YIELD_PALETTE) { if (v == null || !Number.isFinite(v)) return NO_ESTIMATE; const x = Math.max(0, Math.min(1, hi > lo ? (v - lo) / (hi - lo) : 0.5)) * 6; const i = Math.min(5, Math.floor(x)); return mix(palette[i], palette[i + 1], x - i); }
function legend(title, labels, palette, missing = 'No value') {
  const stops = palette.map((c, i) => `${c} ${100 * i / (palette.length - 1)}%`).join(',');
  return `<div class="legend"><span class="legend-title">${esc(title)}</span><div class="legend-scale"><div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="legend-ticks">${labels.map(l => `<span>${esc(l)}</span>`).join('')}</div></div><span class="legend-missing"><i style="background:${NO_ESTIMATE}"></i> ${esc(missing)}</span></div>`;
}
// ---- routing ---------------------------------------------------------------------------------------------------------
function route() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const view = ['record', 'response', 'season', 'about'].includes(parts[0]) ? parts[0] : 'season';
  return {view, iso: parts[1] || null, unit: parts[2] || null, q: new URLSearchParams(q || '')};
}
function link(view, iso, unit, q) {
  const params = Object.fromEntries(Object.entries(q || {}).filter(([, v]) => v != null && v !== ''));
  const s = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  return `#/${view}${iso ? '/' + encodeURIComponent(iso) : ''}${unit ? '/' + encodeURIComponent(unit) : ''}${s}`;
}
const qobj = (r, extra = {}) => ({crop: r.q.get('crop'), season: r.q.get('season'), index: r.q.get('index'), layer: r.q.get('layer'), measure: r.q.get('measure'), year:r.q.get('year'), production:r.q.get('production'), release: r.q.get('release') || D.release, ...extra});
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', () => init().catch(e => { document.getElementById('view').innerHTML = `<p class="card">Could not start: ${esc(e.message)}</p>`; }));
async function init() {
  if(location.hostname==='phuybers3.github.io'){const h=await fetch('hosting.json').then(r=>{if(!r.ok)throw new Error('Deployment metadata is unavailable');return r.json();});if(!/^https:\/\/raw\.githubusercontent\.com\/phuybers3\/enso-yield-atlas\/[0-9a-f]{40}\/site\/$/.test(h.data_base))throw new Error('Invalid deployment data location');HOSTING.base=h.data_base;}
    D.releases = await load('data/releases.json');
  const sel = document.getElementById('release-sel');
  sel.innerHTML = D.releases.releases.map(r => `<option value="${esc(r.release)}">${esc(r.release)}</option>`).join('');
  sel.onchange = () => { const r = route(); location.hash = link(r.view, r.iso, r.unit, qobj(r, {release: sel.value === D.releases.default ? null : sel.value})); };
  return render();
}
async function ensureRelease(release) {
  if (D.release === release) return;
  const base = `data/${release}/`;
  const [catalog, world, panels, display] = await Promise.all([load(base + 'catalog.json'), load(base + 'world.json'), load(base + 'panels.json'),load(`display/${release}/summary.json`)]);
  Object.assign(D, {release, base, catalog, world, panels, display, panelByKey: new Map(panels.map(p => [p.key, p]))});
  document.getElementById('release-tag').textContent = `release ${release} · index to ${catalog.results.index_last_month} · weather to ${catalog.results.data_end}`;
  document.getElementById('release-sel').value = release;
}
// ---- selection: crop and season --------------------------------------------------------------------------------------
function selection(r, iso) {
  const crops = iso ? Object.keys(D.catalog.countries[iso]?.crops || {}) : Object.keys(D.catalog.crops);
  const order = D.catalog.families; const rank = c => order.indexOf(D.catalog.crops[c]?.family) * 100 + (c === D.catalog.crops[c]?.family ? 0 : 1);
  crops.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const wanted = r.q.get('crop');
  const family=D.catalog.crops[wanted]?.family || wanted || 'maize';
  const candidates=crops.filter(c => D.catalog.crops[c]?.family===family);
  // A family selection follows the highest-priority local series; an exact subtype remains explicit.
  const priority=c => Math.max(0,...Object.entries(D.display.coverage).filter(([k])=>k.startsWith(`${iso}|${c}|`)).map(([,v])=>v.local));
  candidates.sort((a,b)=>priority(b)-priority(a)||a.localeCompare(b));
  const crop = iso ? (wanted && wanted!==family && crops.includes(wanted) ? wanted : candidates[0] || wanted || 'maize') : (wanted || 'maize');
  const seasons = iso ? (D.catalog.countries[iso]?.crops[crop] || []) : [...new Set(D.panels.filter(p => p.crop_family===family).map(p=>p.season))].sort();
  const ws = r.q.get('season');
  const available=D.panels.filter(p=>p.iso3===iso&&p.crop_code===crop).sort((a,b)=>b.production_mt-a.production_mt);
  const season = iso ? (seasons.includes(ws) ? ws : (r.view==='season'&&available.length ? available[0].season : seasons.includes('main') ? 'main' : seasons[0] || null)) : (seasons.includes(ws) ? ws : 'all');
  const index = r.q.get('index') === 'std' ? 'std' : 'rel';
  return {crops, crop, family, seasons, season, index, key: iso && season ? panelKey(iso, crop, season) : null};
}
function controls(r, s, iso, extra = '') {
  const cropOpts = D.catalog.families.map(c => `<option value="${esc(c)}"${c === s.family ? ' selected' : ''}>${esc(cap(c))}</option>`).join('');
  const seasonOpts = (iso ? s.seasons : ['all', ...s.seasons]).map(x => `<option value="${esc(x)}"${x === s.season ? ' selected' : ''}>${x === 'all' ? 'Separate seasonal panels' : esc(seasonLabel(x))}</option>`).join('');
  const variants=s.crops.filter(c=>D.catalog.crops[c]?.family===s.family);
  return `<div class="controls"><label>Crop <select id="crop-sel">${cropOpts}</select></label>${iso&&variants.length>1?`<label>Crop type <select id="type-sel">${variants.map(c=>`<option value="${c}"${c===s.crop?' selected':''}>${esc(cap(cropLabel(c)))}</option>`).join('')}</select></label>`:''}<label>Season <select id="season-sel">${seasonOpts}</select></label><label>Find a country <input id="country-search" list="country-list" placeholder="Name or country code"><datalist id="country-list">${Object.entries(D.catalog.countries).map(([i,c])=>`<option value="${esc(c.name)}" label="${i}"></option>`).join('')}</datalist></label>${extra}</div>${r.view === 'response' ? `<details class="advanced"><summary>Index options</summary><label>Index <select id="index-sel"><option value="rel"${s.index === 'rel' ? ' selected' : ''}>Relative Niño 3.4</option><option value="std"${s.index === 'std' ? ' selected' : ''}>Niño 3.4</option></select></label><p class="muted">We estimate the relationship between ENSO and past yields after accounting for long-term yield trends. The relative index removes the tropical mean temperature anomaly.</p></details>` : ''}`;
}
function bindControls(r, iso, unit) {
  const go = extra => { location.hash = link(r.view, iso, unit, qobj(r, extra)); };
  const c = document.getElementById('crop-sel'); if (c) c.onchange = () => go({crop: c.value, season: null});
  const ct=document.getElementById('type-sel');if(ct)ct.onchange=()=>go({crop:ct.value,season:null});
  const cs=document.getElementById('country-search');if(cs)cs.onchange=()=>{const entry=Object.entries(D.catalog.countries).find(([i,c])=>[i.toLowerCase(),c.name.toLowerCase()].includes(cs.value.trim().toLowerCase()));if(entry)location.hash=link(r.view,entry[0],null,qobj(r,{season:null}));};
  const s = document.getElementById('season-sel'); if (s) s.onchange = () => go({season: s.value === 'all' ? null : s.value});
  const i = document.getElementById('index-sel'); if (i) i.onchange = () => go({index: i.value === 'rel' ? null : i.value});
  const u = document.getElementById('series-sel'); if (u) u.onchange = () => { const [crop, season] = u.value.split('|'); go({crop, season}); };
  const l = document.getElementById('layer-sel'); if (l) l.onchange = () => go({layer: l.value === 'scenario' ? null : l.value});
  const m = document.getElementById('measure-sel'); if (m) m.onchange = () => go({measure: m.value === 'yield' ? null : m.value});
  const y=document.getElementById('year-sel');if(y)y.onchange=()=>go({year:y.value});
  const po=document.getElementById('production-overlay');if(po)po.onchange=()=>go({production:po.checked?'1':null});
  bindUtilities(r);
}
function crumbs(r, iso, unit, name, unitName) {
  const q = qobj(r);
  return `<p class="crumbs"><a href="${link(r.view, null, null, q)}">World</a>${iso ? ` › <a href="${link(r.view, iso, null, q)}">${esc(name)}</a>` : ''}${unit ? ` › ${esc(unitName)}` : ''}</p>`;
}
function viewTabs(r, iso, unit) {
  return '';
}
// ---- render ----------------------------------------------------------------------------------------------------------
async function render() {
  const version = ++renderVersion;
  Object.values(maps).forEach(m => { try { m.remove(); } catch (e) { /* ignore */ } }); Object.keys(maps).forEach(k => delete maps[k]);
  const r = route(); const view = document.getElementById('view'); view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const release = r.q.get('release') || D.releases.default;
    if (!D.releases.releases.some(x => x.release === release)) throw new Error(`Unknown release ${release}`);
    await ensureRelease(release); if (version !== renderVersion) return;
    document.querySelectorAll('#view-nav a').forEach(a => { const active = a.dataset.view === r.view; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); a.href = link(a.dataset.view, a.dataset.view === 'about' ? null : r.iso, a.dataset.view === 'about' ? null : r.unit, qobj(r)); });
    if (r.view === 'about') renderAbout(view);
    else if (!r.iso) await renderWorld(view, r, version);
    else if (!r.unit) await renderCountry(view, r, version);
    else await renderUnit(view, r, version);
  } catch (e) { view.innerHTML = `<p class="card">Something did not load: ${esc(e.message)}</p>`; }
  if(version===renderVersion){if(r.view!=='about'){const chosen=selection(r,r.iso);r.q.set('crop',chosen.crop);if(chosen.season&&chosen.season!=='all')r.q.set('season',chosen.season);else r.q.delete('season');}document.querySelectorAll('#view-nav a').forEach(a=>a.href=link(a.dataset.view,a.dataset.view==='about'?null:r.iso,a.dataset.view==='about'?null:r.unit,qobj(r)));bindControls(r,r.iso,r.unit);window.scrollTo(0,0);}
}
// ---- world -----------------------------------------------------------------------------------------------------------
async function renderWorld(view, r, version) {
  const s = selection(r, null); const q = qobj(r, {crop: s.crop, season: s.season === 'all' ? null : s.season});
  const head = `${intro()}${changeStrip()}<p class="small"><a href="bulletin-${D.release}.html">Read the release bulletin</a> (<a href="bulletin-${D.release}.pdf">PDF</a>) · <a href="reporters.html">A guide for reporters</a></p><div class="card">${crumbs(r, null, null)}<h1>${VIEWS.find(v => v[0] === r.view)[1]} · world</h1>${viewTabs(r, null, null)}${controls(r, s, null)}</div>`;
  let body = '', colorOf = () => NO_ESTIMATE, tip = f => `<b>${esc(f.properties.name)}</b>`, leg = '',targets=new Map();
  if (r.view === 'record') {
    const rows = Object.entries(D.catalog.countries).filter(([iso]) => coverageFor(iso,s).units>0).map(([iso,c])=>({iso,...c,...coverageFor(iso,s)}));
    rows.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
    const has = new Set(rows.map(x => x.iso)); colorOf = f => has.has(f.id) ? sequential(Math.log1p(coverageFor(f.id,s).local),0,Math.log1p(5000)) : NO_ESTIMATE;
    tip = f => `<b>${esc(f.properties.name)}</b><br>${has.has(f.id) ? `${coverageFor(f.id,s).local} local units with the selected crop and season` : 'No series in this release'}`;
    body = `<div class="card"><h2>Reporting units with ${esc(cropLabel(s.crop))} records</h2><p class="muted">Counts refer to the selected crop family and season. Open a country to explore local records. Crop types and overlapping seasonal panels remain separate.</p><div class="table-scroll"><table class="t"><thead><tr><th>Country</th><th class="num">Units</th><th class="num">Series (selected crop)</th><th>Seasons of ${esc(cropLabel(s.crop))}</th></tr></thead><tbody>${rows.map(x => `<tr><td><a href="${link('record', x.iso, null, q)}">${esc(x.name)}</a></td><td class="num">${x.units}</td><td class="num">${x.series}</td><td>${Object.entries(x.crops).filter(([c])=>D.catalog.crops[c]?.family===s.family).map(([c,seasons])=>esc(cropLabel(c))+': '+seasons.map(seasonLabel).map(esc).join(', ')).join('; ')}</td></tr>`).join('')}</tbody></table></div></div>`;
    leg = legend('Local reporting units for this crop · logarithmic scale', ['0 · national only', '70', '5,000'], YIELD_PALETTE, 'No series');
  } else if (r.view === 'response') {
    const rows = D.display.responses.filter(x => x.index===s.index && x.crop_family === s.family && (s.season === 'all' || x.season === s.season)).sort((a, b) => a.pct_per_degC - b.pct_per_degC);
    // The map colours each country by one results row: the selected season's, or, over all seasons, the row with the largest production weight.
    const byIso = new Map(); for (const x of rows) { const cur = byIso.get(x.iso3); if (!cur || (x.production_t || 0) > (cur.production_t || 0)) byIso.set(x.iso3, x); }
    targets=byIso;
    colorOf = f => diverging(byIso.get(f.id)?.pct_per_degC, RESPONSE_LIMIT, RESPONSE_PALETTE);
    tip = f => { const x = byIso.get(f.id); return `<b>${esc(f.properties.name)}</b>${x ? `<br>${esc(seasonLabel(x.season))}: ${pct(x.pct_per_degC)} per +1 °C (${pct(x.lo)} to ${pct(x.hi)})<br>${x.n_units} units · ${x.n_years} years` : '<br>No fitted response'}`; };
    body = `<div class="card"><h2>Yield response to the growing-season index, by country</h2><p class="muted">Historical country estimate, growing season, ${s.index === 'rel' ? 'relative Niño 3.4' : 'Niño 3.4'}: percent change in yield per +1 °C with its 95% interval; q is the false-discovery-adjusted p-value within the index and window. ${rows.length} panels. The map uses the largest production panel for each country; seasonal panels remain separate below.</p><details><summary>Ranked country relationship chart</summary>${barChart(rows.map(x => ({label: `${x.country} · ${cropLabel(x.crop_code)}${s.season === 'all' ? ' · ' + seasonLabel(x.season) : ''}`, mid: x.pct_per_degC, lo: x.lo, hi: x.hi, note: `${x.n_units} u · ${x.n_years} y`, href: link('response', x.iso3, null, qobj(r, {crop: x.crop_code, season: x.season}))})), 'Percent per +1 °C', RESPONSE_PALETTE)}</details><div class="table-scroll"><table class="t"><thead><tr><th>Country</th><th>Season</th><th class="num">% per °C</th><th class="num">95% interval</th><th class="num">p</th><th class="num">q</th><th class="num">Units</th><th class="num">Years</th></tr></thead><tbody>${rows.map(x => `<tr><td><a href="${link('response', x.iso3, null, qobj(r, {crop: x.crop_code, season: x.season}))}">${esc(x.country)} · ${esc(cropLabel(x.crop_code))}</a></td><td>${esc(seasonLabel(x.season))}</td><td class="num">${pct(x.pct_per_degC, 2)}</td><td class="num">${pct(x.lo)} to ${pct(x.hi)}</td><td class="num">${fmt(x.p, 3)}</td><td class="num">${fmt(x.q, 3)}</td><td class="num">${x.n_units}</td><td class="num">${x.n_years} (${x.year_first}–${x.year_last})</td></tr>`).join('')}</tbody></table></div></div>`;
    leg = legend('Response, percent per +1 °C of the season index', [`≤ −${RESPONSE_LIMIT}%`, '0', `≥ +${RESPONSE_LIMIT}%`], RESPONSE_PALETTE, 'No fitted response');

  } else {
    const family = s.family;
    const ps = D.panels.filter(p => p.crop_family === family && (s.season === 'all' || p.season === s.season)).sort((a, b) => (b.production_mt || 0) - (a.production_mt || 0));
    const byIso = new Map(); for (const p of ps) { const cur = byIso.get(p.iso3); if (!cur || (p.production_mt || 0) > (cur.production_mt || 0)) byIso.set(p.iso3, p); }
    const med = p => p.predictions.find(x => x.method === 'index_outlook' && x.scenario === 'medium');
    targets=byIso;
    colorOf = f => diverging(med(byIso.get(f.id) || {predictions: []})?.pct, SCENARIO_LIMIT, SCENARIO_PALETTE);
    tip = f => { const p = byIso.get(f.id); const m = p && med(p); return `<b>${esc(f.properties.name)}</b>${p ? `<br>${esc(p.label)} · ${esc(p.status)}<br>Index outlook, central: ${pct(m?.pct)} (${pct(m?.lo)} to ${pct(m?.hi)})` : '<br>No panel in the horizon'}`; };
    const W = D.world, hl = W.headline, wrows = W.world.filter(x => x.crop_family === family || family == null);
    body = `<div class="card"><h2>The current assessment</h2><p>Across all six crops in release ${esc(D.release)}: over the ${hl.panels} panels with enough seasonal coverage and positive weather-model skill (${fmt(hl.production_mt, 1)} Mt), the weather so far implies <b>${pct(hl.weather_implied_pct, 2)}</b> of trend where the index alone implies <b>${pct(hl.index_implied_pct, 2)}</b>. Outlook: ${esc(W.index.outlook.source)}, DJF quantiles ${fmt(W.index.outlook.low, 2)} / ${fmt(W.index.outlook.medium, 2)} / ${fmt(W.index.outlook.high, 2)} RONI, ${fmt(W.index.scenario_rel_djf.low, 2)} / ${fmt(W.index.scenario_rel_djf.medium, 2)} / ${fmt(W.index.scenario_rel_djf.high, 2)} on the relative index; index observed through ${esc(W.index_last_month)}, weather through ${esc(W.data_end)}.</p>
      <details><summary>ENSO observations, scenarios and historical comparisons</summary>${indexPathCard(W)}${historicalIndexCard()}</details>
      ${worldSummary()}<details><summary>All country coverage and scenario totals</summary><h3>Production changes over the modeled coverage</h3><div class="table-scroll"><table class="t"><thead><tr><th>Crop family</th><th>Method</th><th>Scenario</th><th class="num">Change, Mt</th><th class="num">%</th><th class="num">Interval, %</th><th class="num">Production, Mt</th><th class="num">Coverage</th></tr></thead><tbody>${W.world.map(x => `<tr${x.crop_family === family ? ' style="background:#f4f6f1"' : ''}><td>${esc(x.crop_family)}</td><td>${esc(METHOD_LABEL[x.method] || x.method)}</td><td>${esc(SCENARIO_LABEL[x.scenario] || x.scenario)}</td><td class="num">${fmt(x.dprod_mt, 2, true)}</td><td class="num">${pct(x.pct, 2)}</td><td class="num">${pct(x.lo)} to ${pct(x.hi)}</td><td class="num">${fmt(x.production_mt, 1)}</td><td class="num">${fmt(100 * x.coverage_share, 0)}%</td></tr>`).join('')}</tbody></table></div></details></div>
`;
    leg = legend('Index outlook, central scenario (largest seasonal panel; seasons shown separately)', [`≤ −${SCENARIO_LIMIT}%`, '0', `≥ +${SCENARIO_LIMIT}%`], SCENARIO_PALETTE, 'No panel');
  }
  view.innerHTML = `${head}${r.view==='season'?`<div class="card"><h2>${esc(cap(s.family))}: country and seasonal outlooks</h2>${panelTable(D.panels.filter(p=>p.crop_family===s.family&&(s.season==='all'||p.season===s.season)).sort((a,b)=>b.production_mt-a.production_mt),r)}</div>`:''}<div class="card"><div id="wmap" class="map world"></div>${leg}<p class="muted">Select a country on the map or in the list. Dotted borders mark countries with local historical records for this crop and season.</p></div>${body}`;
  const world = await load(D.base + 'geometry/world.json'); if (version !== renderVersion) return;
  const fc = {type: 'FeatureCollection', features: world.features.map(f => ({...f, properties: {...f.properties, color: colorOf(f), localDetail:coverageFor(f.id,s).local>0}}))};
  drawMap('wmap', fc, tip, f => { if (D.catalog.countries[f.id]) location.hash = link(r.view,f.id,null,targets.has(f.id)?{...q,crop:targets.get(f.id).crop_code,season:targets.get(f.id).season}:q); }, [[-170, -56], [180, 75]]);
}
function panelTable(ps,r) {
  const get=(p,scenario)=>p.predictions.find(x=>x.method==='index_outlook'&&x.scenario===scenario);
  return `<p class="muted">Country totals are shown as separate crop types and seasonal panels. We do not add overlapping panels. The map uses the largest production panel per country; each row links to its exact season.</p><div class="table-scroll"><table class="t"><thead><tr><th>Country / crop / season</th><th>Harvest and status</th><th>Production, Mt</th><th>Central change</th><th>Lower / higher ENSO</th><th>Weather so far</th><th>Evidence and local detail</th></tr></thead><tbody>${ps.map(p=>{const m=get(p,'medium'),lo=get(p,'low'),hi=get(p,'high'),w=p.weather,cv=D.display.coverage[p.key],rl=D.display.reliability[p.key];return `<tr><td><a href="${link('season',p.iso3,null,qobj(r,{crop:p.crop_code,season:p.season}))}">${esc(p.country)} · ${esc(cropLabel(p.crop_code))}<small>${esc(seasonLabel(p.season))}</small></a></td><td>${p.harvest_year} ${statusChip(p.status)}</td><td>${fmt(p.production_mt,1)}</td><td>${pct(m?.pct)}<small>Coefficient bounds ${pct(m?.lo)} to ${pct(m?.hi)}</small></td><td>${pct(lo?.pct)} / ${pct(hi?.pct)}</td><td>${w?pct(w.pct_panel):'Unavailable'}<small>${w?(w.usable_panel?'Meets weather checks':w.skill_vs_trend==null?'Skill not evaluated':'Weather checks not met'):'No weather estimate'}</small></td><td>${cv?.local?`<span class="chip green">${cv.local.toLocaleString()} local records</span>`:'<span class="chip grey">National estimate</span>'}<small>${cv?.current||0} current units · ENSO checks: ${fmt(100*(rl?.usable??m?.usable_share),0)}% of production${rl?.beyond_fit>0?' · extrapolation':''}</small></td></tr>`;}).join('')}</tbody></table></div>`;
}
// ---- country ---------------------------------------------------------------------------------------------------------
async function recordsData(iso) { const s=selection(route(),iso);return load(`display/${D.release}/records/${iso}-${s.family}.json`); }
async function countryData(iso) {
  const s=selection(route(),iso);
  const [country, units, geo, regions] = await Promise.all([load(D.base + `countries/${iso}.json`), load(`display/${D.release}/units/${iso}-${s.family}.json`).catch(()=>({units:{},columns:{responses:[],predictions:[],windows:[]}})), D.catalog.countries[iso].geometry ? load(D.base + `geometry/${iso}.json`).catch(() => null) : null,load(`display/${D.release}/regions/${iso}.json`).catch(()=>null)]);
  return {country, units, geo, regions};
}
// The series of a unit for a crop and season; where a unit carries several (area basis, source), the longest record.
function seriesFor(unit, crop, season) {
  const c = unit.series.filter(x => x.crop_code === crop && x.season === season); if (!c.length) return null;
  return c.sort((a, b) => a.tier-b.tier || (b.n || 0) - (a.n || 0))[0];
}
const col = (file, table, name) => file.columns[table].indexOf(name);
function rowsOf(file, table, arr) { const cols = file.columns[table]; return arr.map(a => Object.fromEntries(cols.map((c, i) => [c, a[i]]))); }
async function renderCountry(view, r, version) {
  const iso = r.iso, cat = D.catalog.countries[iso];
  if (!cat) { view.innerHTML = `<p class="card">No country ${esc(iso)} in release ${esc(D.release)}.</p>`; return; }
  const s = selection(r, iso); const q = qobj(r, {crop: s.crop, season: s.season});
  const {country, units, geo, regions} = await countryData(iso); if (version !== renderVersion) return;
  const head = `<div class="card">${crumbs(r, iso, null, cat.name)}<h1>${esc(cat.name)} · ${esc(cropLabel(s.crop))}${s.season ? ', ' + esc(seasonLabel(s.season)) : ''}</h1>${viewTabs(r, iso, null)}${controls(r, s, iso)}</div>`;
  const U = units.units; const picked = {}; for (const [k, u] of Object.entries(U)) { const x = seriesFor(u, s.crop, s.season); if (x) picked[k] = x; }
  if(!Object.keys(picked).length){view.innerHTML=head+`<p class="banner">No ${esc(cropLabel(s.crop))} records are available for this country and season. Choose another crop or country; your requested crop has been retained.</p>`;return;}
  let body = '', colorOf = () => NO_ESTIMATE, tip = f => `<b>${esc(f.properties.name)}</b>`, leg = '', mapTitle = '', mapControls = '';
  const predictionFor=x=>rowsOf(units,'predictions',x.predictions).find(p=>p.method==='index_outlook'&&p.scenario==='medium');
  if (r.view === 'record') {
    const records = await recordsData(iso); if (version !== renderVersion) return;
    const measure = r.q.get('measure') === 'anomaly' ? 'anomaly' : 'yield';
    const years=[...new Set(Object.values(picked).flatMap(x=>(records.series[x.id]?.obs||[]).map(o=>o[0])))].sort((a,b)=>b-a);const wantedYear=r.q.get('year');const year=wantedYear==='latest'?null:years.includes(Number(wantedYear))?Number(wantedYear):years[0];
    r.q.set('year',year||'latest');
    const latest = {}, anom = {}, trend = {};
    for (const [k, x] of Object.entries(picked)) { const rec = records.series[x.id]; if (!rec) continue; const selected=rec.obs.filter(o=>!year||o[0]===year); if(selected.length)latest[k]=selected[selected.length-1]; const af=rec.trend_anomaly.filter(o=>!year||o[0]===year);if(af.length)anom[k]=af[af.length-1]; if (rec.trend) trend[k] = rec.trend; }
    const vals = Object.values(latest).map(o => o[1]).sort((a, b) => a - b); const lo = vals[0] ?? 0, hi = vals[vals.length - 1] ?? 1;
    colorOf = f => measure === 'anomaly' ? diverging(anom[f.id]?.[3], ANOMALY_LIMIT, SCENARIO_PALETTE) : latest[f.id]?sequential(Math.log1p(latest[f.id][1]),Math.log1p(lo),Math.log1p(hi)):NO_ESTIMATE;
    tip = f => { const x = picked[f.id], o = latest[f.id], a = anom[f.id], t = trend[f.id]; return `<b>${esc(U[f.id]?.name || f.properties.name)}</b>${x ? `<br>Latest: ${o ? `${fmt(o[1], 2)} t/ha in ${o[0]}` : 'no observation'}${a ? `<br>Anomaly from trend in ${a[0]}: ${pct(a[3])}` : ''}${t ? `<br>Trend ${pct(t.trend_pct_per_year, 2)} per year, ${t.year_first}–${t.year_last}` : ''}<br>${x.n} years, ${x.first}–${x.last} · ${esc(x.source)}${x.basis !== 'unknown' ? ' · ' + esc(x.basis) + ' area' : ''}` : '<br>No series for this crop and season'}`; };
    const rows = Object.entries(picked).sort((a,b)=>(anom[a[0]]?.[3]??Infinity)-(anom[b[0]]?.[3]??Infinity));
    mapTitle = measure === 'anomaly' ? 'Yield anomaly from trend' : 'Observed yield';
    leg = measure === 'anomaly' ? legend('Latest yield anomaly from the series trend ', [`≤ −${ANOMALY_LIMIT}%`, '0', `≥ +${ANOMALY_LIMIT}%`], SCENARIO_PALETTE, 'No fitted trend') : legend(`Observed yield, t/ha · logarithmic scale · ${year||'latest available (mixed years)'}`, [fmt(lo, 1), fmt(Math.expm1((Math.log1p(lo)+Math.log1p(hi))/2), 1), fmt(hi, 1)], YIELD_PALETTE, 'No series');
    mapControls = `<div class="controls"><label>Harvest year <select id="year-sel">${years.map(y=>`<option${y===year?' selected':''}>${y}</option>`).join('')}<option value="latest"${!year?' selected':''}>Latest available (mixed years)</option></select></label><label>Map <select id="measure-sel"><option value="yield"${measure === 'yield' ? ' selected' : ''}>Observed yield</option><option value="anomaly"${measure === 'anomaly' ? ' selected' : ''}>Latest anomaly from the fitted trend</option></select></label></div>`;
    body = `<div class="card"><h2>${rows.length} reporting units with ${esc(cropLabel(s.crop))}, ${esc(seasonLabel(s.season))}</h2><p class="muted">We use the highest-priority source and then the longest record for each place. Map and table use ${year||'each record’s latest available year; these dates differ'}. Grey indicates no observation for the selected year. Open a unit for its record year by year.</p><div class="table-scroll"><table class="t"><thead><tr><th>Unit</th><th>Region</th><th>Source</th><th class="num">Years</th><th class="num">First–last</th><th class="num">Latest yield, t/ha</th><th class="num">Trend, % per year</th><th class="num">Latest anomaly</th></tr></thead><tbody>${rows.map(([k, x]) => { const o = latest[k], a = anom[k], t = trend[k]; return `<tr><td><a href="${link('record', iso, k, q)}">${esc(U[k].name)}</a></td><td>${esc(U[k].region_name || '')}</td><td>${esc(x.source)}</td><td class="num">${x.n}</td><td class="num">${x.first}–${x.last}</td><td class="num">${o ? `${fmt(o[1], 2)} (${o[0]})` : '–'}</td><td class="num">${t ? pct(t.trend_pct_per_year, 2) : '–'}</td><td class="num">${a ? `${pct(a[3])} (${a[0]})` : '–'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  } else if (r.view === 'response') {
    const idx = s.index; const iI = col(units, 'responses', 'index');
    const resp = {}; for (const [k, x] of Object.entries(picked)) { const row = x.responses.find(a => a[iI] === idx); if (row) resp[k] = rowsOf(units, 'responses', [row])[0]; }
    colorOf = f => diverging(resp[f.id]?.pct_best, RESPONSE_LIMIT, RESPONSE_PALETTE);
    tip = f => { const x = resp[f.id]; return `<b>${esc(U[f.id]?.name || f.properties.name)}</b>${x ? `<br>Selected estimate: ${pct(x.pct_best)} per +1 °C (${pct(x.lo_best)} to ${pct(x.hi_best)})<br>Level: ${esc(x.response_level)} · ${x.n_years} years${x.pct_raw != null ? `<br>Own fit: ${pct(x.pct_raw)} (${pct(x.lo_raw)} to ${pct(x.hi_raw)}), p ${fmt(x.p_raw, 3)}` : ''}` : '<br>No response row'}`; };
    const crows = country.responses.filter(x => x.crop_code === s.crop && x.season === s.season && x.index === idx);
    const regs = country.regions.filter(x => x.crop_code === s.crop && x.season === s.season && x.index === idx).sort((a,b)=>a.pct_per_degC-b.pct_per_degC);
    const levels = {}; for (const x of Object.values(resp)) levels[x.response_level] = (levels[x.response_level] || 0) + 1;
    mapTitle = 'Local yield relationships'; leg = legend('Selected estimate, percent per +1 °C of the season index', [`≤ −${RESPONSE_LIMIT}%`, '0', `≥ +${RESPONSE_LIMIT}%`], RESPONSE_PALETTE, 'No response row');
    body = `<div class="card"><h2>Separately fitted country relationship ( ${idx === 'rel' ? 'relative Niño 3.4' : 'Niño 3.4'})</h2>${crows.length ? `<div class="table-scroll"><table class="t"><thead><tr><th>Window</th><th class="num">% per °C</th><th class="num">95% interval</th><th class="num">p</th><th class="num">q</th><th class="num">Units</th><th class="num">Years</th></tr></thead><tbody>${crows.map(x => `<tr><td>${esc(x.window)}</td><td class="num">${pct(x.pct_per_degC, 2)}</td><td class="num">${pct(x.lo)} to ${pct(x.hi)}</td><td class="num">${fmt(x.p, 3)}</td><td class="num">${fmt(x.q, 3)}</td><td class="num">${x.n_units}</td><td class="num">${x.n_years} (${x.year_first}–${x.year_last})</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No country row for this crop, season and index.</p>'}</div>
      <div class="card"><h2>Regions, ranked by their own estimates</h2><p class="muted">The chart shows each region’s own estimate and 95% coefficient interval. Regional estimates use a separate regression; they are not averages of the map. Pooled alternatives appear in the table. ${regs.length} regions.</p>${regs.length ? barChart(regs.map(x => ({label: x.region_name, mid:x.pct_per_degC,lo:x.lo,hi:x.hi, note: `${x.n_units} u · ${x.n_years} y`})), 'Regional estimate, percent per +1 °C', RESPONSE_PALETTE) : ''}${regs.length ? `<div class="table-scroll"><table class="t"><thead><tr><th>Region</th><th class="num">Shrunk, % per °C</th><th class="num">Interval</th><th class="num">Unpooled</th><th class="num">Interval</th><th class="num">p</th><th class="num">Units</th><th class="num">Years</th></tr></thead><tbody>${regs.map(x => `<tr><td>${esc(x.region_name)}</td><td class="num">${pct(x.pct_shrunk, 2)}</td><td class="num">${pct(x.lo_shrunk)} to ${pct(x.hi_shrunk)}</td><td class="num">${pct(x.pct_per_degC, 2)}</td><td class="num">${pct(x.lo)} to ${pct(x.hi)}</td><td class="num">${fmt(x.p, 3)}</td><td class="num">${x.n_units}</td><td class="num">${x.n_years}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
      <div class="card"><h2>Local coverage</h2><p class="muted">${Object.keys(resp).length} unit rows: ${Object.entries(levels).map(([l, n]) => `${n} with the selected estimate from the ${l}`).join(', ')}. The level is the analysis layer's choice (the unit's own fit with twenty years, else the state's, else the country's). Select a unit on the map for its row.</p><div id="unit-detail" class="banner" hidden></div></div>`;
  } else {
    const p = D.panelByKey.get(s.key);
    const iM = col(units, 'predictions', 'method'), iS = col(units, 'predictions', 'scenario');
    const layer = ['rain', 'tmax'].includes(r.q.get('layer')) ? r.q.get('layer') : 'scenario';
    const pred = {}; for (const [k, x] of Object.entries(picked)) { const med = x.predictions.find(a => a[iM] === 'index_outlook' && a[iS] === 'medium'); const wx = x.predictions.find(a => a[iM] === 'weather_todate'); if (med || wx) pred[k] = {med: med && rowsOf(units, 'predictions', [med])[0], w: wx && rowsOf(units, 'predictions', [wx])[0]}; }
    // season-to-date weather per unit: the chirps row for rain, the best row for temperature (weather_todate_anomaly)
    const wx = {}; for (const [k, x] of Object.entries(picked)) { const rain = x.weather.find(a => a.product === 'chirps'), temp = x.weather.find(a => a.product === 'best'); if (rain || temp) wx[k] = {rain, temp, frac: (rain || temp).frac_elapsed, year: (rain || temp).harvest_year}; }
    const F = units.columns.weather_metrics, iZ = F.indexOf('z'), iA = F.indexOf('anom'), iV = F.indexOf('value'), iR = F.indexOf('reference'), iK = F.indexOf('pct_rank');
    const rainZ = k => wx[k]?.rain?.metrics.precip?.[iA], tmaxA = k => wx[k]?.temp?.metrics.tmax_mean?.[iA];
    colorOf = f => layer === 'rain' ? diverging(rainZ(f.id), RAIN_Z_LIMIT, RAIN_PALETTE) : layer === 'tmax' ? diverging(tmaxA(f.id), TMAX_LIMIT, TEMP_PALETTE) : diverging(pred[f.id]?.med?.pct, SCENARIO_LIMIT, SCENARIO_PALETTE);
    tip = f => { const x = pred[f.id], w = wx[f.id], pr = w?.rain?.metrics.precip, tm = w?.temp?.metrics.tmax_mean; return `<b>${esc(U[f.id]?.name || f.properties.name)}</b>${x?.med ? `<br>Index outlook, central: ${pct(x.med.pct)} (${pct(x.med.lo)} to ${pct(x.med.hi)})<br>${x.med.harvest_year} harvest · ${fmt(100 * x.med.frac_elapsed, 0)}% of window run${x.med.beyond_fit ? ' · beyond the fitted range' : ''}` : ''}${x?.w ? `<br>Weather to date: ${pct(x.w.pct)} ± ${fmt(x.w.se, 1)} · ${x.w.usable ? 'usable' : 'not usable'}` : ''}${pr ? `<br>Rain to date: ${fmt(pr[iV], 0)} mm against ${fmt(pr[iR], 0)}, ${fmt(pr[iA], 0, true)} mm (z ${fmt(pr[iZ], 2, true)}, percentile ${fmt(100 * pr[iK], 0)})` : ''}${tm ? `<br>Daily maximum to date: ${fmt(tm[iA], 2, true)} °C (z ${fmt(tm[iZ], 2, true)}, percentile ${fmt(100 * tm[iK], 0)})` : ''}${!x && !w ? '<br>No prediction or weather row' : ''}`; };
    mapTitle = LAYERS.find(l => l[0] === layer)[1];
    leg = layer === 'rain' ? legend('Season-to-date rainfall anomaly, mm (brown drier, teal wetter)', [`≤ −${RAIN_Z_LIMIT} mm`, '0', `≥ +${RAIN_Z_LIMIT} mm`], RAIN_PALETTE, 'No weather row')
      : layer === 'tmax' ? legend('Season-to-date daily maximum temperature anomaly', [`≤ −${TMAX_LIMIT} °C · cooler`, '0', `≥ +${TMAX_LIMIT} °C · warmer`], TEMP_PALETTE, 'No weather row')
      : legend('Conditional yield change, central scenario', [`≤ −${SCENARIO_LIMIT}%`, '0', `≥ +${SCENARIO_LIMIT}%`], SCENARIO_PALETTE, 'No prediction');
    mapControls = `<div class="controls"><label>Map <select id="layer-sel">${LAYERS.map(([k, l]) => `<option value="${k}"${k === layer ? ' selected' : ''}>${l}</option>`).join('')}</select></label><span class="muted">${Object.keys(wx).length} units carry season-to-date weather.</span></div>`;
    body = p ? panelCard(p,r) + await skillCard(p.key,version) + seasonWeatherCard(p) + `<details><summary>ENSO scenario paths</summary>${indexPathCard(D.world)}</details>` : `<div class="card"><p>No prediction panel for ${esc(cat.name)} ${esc(cropLabel(s.crop))}, ${esc(seasonLabel(s.season))} in this release's horizon.</p></div>`;
    if (version !== renderVersion) return;
  }
  view.innerHTML = `${head}${countryIntro(r,s,picked,units)}<div class="card"><h2>${esc(mapTitle)} within ${esc(cat.name)}</h2>${mapControls}<label class="small"><input type="checkbox" id="production-overlay"${r.q.get('production')==='1'?' checked':''}> Show production weights (circle area; includes area-based proxies)</label><div id="cmap" class="map"></div>${leg}<p class="muted">Select a unit for its history, ENSO relationship and current season. Dashed dark outlines mark scenarios beyond the fitted ENSO range; grey means no estimate. Map colors saturate at the labeled endpoints.</p></div>${body}${r.view!=='record'?localTable(r,s,picked,units):''}`;
  if (!geo) { document.getElementById('cmap').innerHTML = '<p class="map-note">No boundaries are mapped for this country in the release; the tables carry its values.</p>'; return; }
  const inSel = f => picked[f.id]; const shown = [...geo.features.filter(f => f.properties.level === 'national' && !inSel(f)), ...geo.features.filter(inSel)];
  const fc = {type: 'FeatureCollection', features: shown.map(f => ({...f, properties: {...f.properties, color: inSel(f) ? colorOf(f) : '#eceae4', reporting:!!inSel(f), name:U[f.id]?.name||f.properties.name, beyond:r.view==='season'&&!!(picked[f.id]&&predictionFor(picked[f.id])?.beyond_fit)}}))};
  const focus=shown.filter(f=>inSel(f)&&(iso!=='USA'||(U[f.id]?.lon>-126&&U[f.id]?.lon<-66&&U[f.id]?.lat>24&&U[f.id]?.lat<50)));const fit=bounds({features:focus})||bounds(geo);
  drawMap('cmap', fc, f => inSel(f) ? tip(f) : `<b>${esc(f.properties.name)}</b><br>National outline`, f => {
    if (!inSel(f)) return;
    if (r.view === 'response') { const el = document.getElementById('unit-detail'); el.hidden = false; el.innerHTML = `${tip(f)}<br><a href="${link('response', iso, f.id, q)}">Open the unit</a>`; }
    else location.hash = link(r.view, iso, f.id, q);
  }, fit,regions,r.q.get('production')==='1'?Object.entries(picked).filter(([k,x])=>U[k].lon!=null&&U[k].lat!=null&&predictionFor(x)?.production_t>0).map(([k,x])=>({type:'Feature',geometry:{type:'Point',coordinates:[U[k].lon,U[k].lat]},properties:{name:U[k].name,production:predictionFor(x).production_t}})):[]);
}
function panelCard(p,r) {
  const find=(m,sc)=>p.predictions.find(x=>x.method===m&&(sc==null||x.scenario===sc));
  const med=find('index_outlook','medium'),lo=find('index_outlook','low'),hi=find('index_outlook','high'),td=find('index_todate'),wt=find('weather_todate'),w=p.weather,rel=D.display.reliability[p.key],common=D.display.common[p.key];
  const gate=(label,value,pass)=>`<li class="${value==null?'gate-unknown':pass?'gate-pass':'gate-fail'}">${label}: ${value==null?'not evaluated':value}${value==null?'':pass?' · meets check':' · does not meet check'}</li>`;
  const gates=w?gate('At least half the season observed',w.frac_started==null?null:fmt(100*w.frac_started,0)+'%',w.frac_started>=.5)+gate('At least a quarter of production covered',w.coverage_share==null?null:fmt(100*w.coverage_share,0)+'%',w.coverage_share>=.25)+gate('Standard error below 40 percentage points',w.se_panel==null?null:fmt(w.se_panel,1)+' points',w.se_panel<40)+gate('Improves on a trend-only estimate in historical tests',w.skill_vs_trend==null?null:fmt(w.skill_vs_trend,2),w.skill_vs_trend>0):'';
  return `<div class="card estimates-card"><div class="chips"><b>${esc(p.label)}</b> ${statusChip(p.status)} <span class="chip grey">harvest ${p.harvest_year}</span><span class="chip grey">${fmt(p.production_mt,1)} Mt · ${p.n_series} series</span></div>
    <div class="estimate-grid"><section><h2>ENSO outlook</h2><p class="estimate">${pct(med?.pct)}</p><p>Central scenario · coefficient-uncertainty bounds <b>${pct(med?.lo)} to ${pct(med?.hi)}</b>.</p><p>Lower ENSO: ${pct(lo?.pct)}. Higher ENSO: ${pct(hi?.pct)}.</p><p class="muted">September outlook scenarios describe different ENSO paths. Their order need not match the order of yield losses. The bounds average local 95% coefficient limits with the release’s production weights. They are not a calibrated national 95% interval or a full forecast interval.</p>${rel?`<p class="reliability">${fmt(100*rel.usable,0)}% of production meets the index method’s checks. ${rel.skill_missing>0?`${fmt(100*rel.skill_missing,0)}% has no finite skill assessment. `:''}${rel.skill_nonpositive>0?`${fmt(100*rel.skill_nonpositive,0)}% shows no improvement over trend in the test with the future ENSO index known. `:''}${rel.beyond_fit>0?`${fmt(100*rel.beyond_fit,0)}% extends beyond the fitted ENSO range.`:''}</p>`:''}<details><summary>Lower and higher scenarios, with uncertainty</summary><p>Lower ENSO: ${pct(lo?.pct)}, interval ${pct(lo?.lo)} to ${pct(lo?.hi)}. Higher ENSO: ${pct(hi?.pct)}, interval ${pct(hi?.lo)} to ${pct(hi?.hi)}.</p></details></section>
    <section><h2>Weather observed so far</h2>${w?`<p class="estimate${w.usable_panel?'':' unavailable'}">${pct(w.pct_panel)} <span>± ${fmt(w.se_panel,1)}</span></p><p>± one standard error. ${wt?`95% coefficient interval ${pct(wt.lo)} to ${pct(wt.hi)}.`:''} Lead ${w.lead} months · ${w.n_series} series${wt?` · ${fmt(wt.production_mt,1)} Mt`:''}.</p><p><b>${w.usable_panel?'Meets the weather checks':'Does not yet meet all weather checks'}</b></p><ul class="gates">${gates}</ul><p class="muted">Positive skill means smaller squared errors than a trend-only estimate in historical tests. Missing skill means untested; a negative value means worse historical performance.</p>`:'<p class="estimate unavailable">No estimate</p><p>There is no weather-to-date row for this crop and season. Seasonal status: '+esc(p.status)+'.</p>'}</section></div>
    ${common?`<details><summary>Compare both methods over the same places</summary><p>Over ${common.n_series} matched series and ${fmt(common.production_mt,1)} Mt, the production-weighted mean of unit estimates is ${pct(common.index_pct)} for the central ENSO scenario and ${pct(common.weather_pct)} for weather so far. ${common.weather_usable?'The weather panel meets its checks.':'The weather panel does not meet all checks.'}</p><p class="muted">${esc(D.display.methods.common)}</p></details>`:''}
    <details><summary>Alternative: the index observed so far, with neutral conditions afterward</summary><p>${pct(td?.pct)} relative to trend; interval ${pct(td?.lo)} to ${pct(td?.hi)}. This alternative sets future index anomalies to zero.</p></details>
    ${timingCard(p)}<p class="muted">The selected yield relationships supply the ENSO scenarios, including regional or national fallbacks where needed. We fit the country relationship separately. <a href="${link('response',p.iso3,null,qobj(r,{crop:p.crop_code,season:p.season}))}">Explore local relationships and their uncertainty</a>.</p></div>`;
}
function seasonWeatherCard(p) {
  const w=p.season_weather;
  if(!w)return `<div class="card"><h2>Weather and historical ENSO expectations</h2><p>There is no season-to-date weather row for this panel. Status: ${esc(p.status)}.</p></div>`;
  const row=(m)=>{const x=w.metrics[m],unit=METRIC_LABEL[m]?.[1]||'';return `<tr><td>${esc(METRIC_LABEL[m]?.[0]||m)}</td><td>${fmt(x.value,1)} ${unit}</td><td>${fmt(x.anom,2,true)} ${unit}</td><td>${fmt(x.expected,2,true)} ${unit}<small>${x.signal?'Historical ENSO signal detected':'Historical ENSO signal not established'}${x.beyond_range?' · beyond fitted range':''}</small></td></tr>`;};
  const primary=['precip','tmax_mean'].filter(m=>w.metrics[m]?.product),others=D.catalog.weather_metrics.filter(m=>w.metrics[m]?.product&&!primary.includes(m));
  const table=ms=>`<div class="table-scroll"><table class="t"><thead><tr><th>Weather measure</th><th>Observed so far</th><th>Departure from history</th><th>Expected from observed ENSO</th></tr></thead><tbody>${ms.map(row).join('')}</tbody></table></div>`;
  return `<div class="card"><h2>Weather and historical ENSO expectations</h2><div class="chips">${verdictChip(w.verdict)}<span class="chip grey">${fmt(100*w.frac_elapsed,0)}% of window run to ${esc(w.data_end)}</span><span class="chip grey">${w.n_series} series · ${fmt(100*w.coverage_share,0)}% of production</span></div><p>We compare this season’s weather with historical conditions over the same part of the growing season, and with the weather associated with the ENSO index observed so far. Weather can differ from the ENSO expectation.</p>${table(primary)}<details><summary>Other weather measures and interpretation</summary>${table(others)}<p>${w.metrics_concordant} of the ${w.metrics_with_signal} metrics with an expected signal fall as expected, using ${w.n_years} historical years. The stored assessment is ${esc(w.verdict)}. Heat and rain metrics are correlated; the metric count is not a set of independent tests.</p></details></div>`;
}
function indexPathCard(W) {
  const rows = (W.index_path || []).filter(x => x.index === 'rel');
  if (!rows.length) return '';
  return `<div class="card"><h2>ENSO observations and scenario paths</h2><p class="muted">Relative Niño 3.4 by month: observed through ${esc(W.index_last_month)} (filled), then the outlook's lower, central and higher paths (open). Scenario DJF means ${fmt(W.index.scenario_rel_djf.low, 2)}, ${fmt(W.index.scenario_rel_djf.medium, 2)} and ${fmt(W.index.scenario_rel_djf.high, 2)} °C.</p>${indexPathChart(rows)}</div>`;
}
async function skillCard(key, version) {
  const skill = await load(D.base + 'skill.json'); if (version !== renderVersion) return '';
  const rows = skill.panels[key] || [];
  if (!rows.length) return `<div class="card"><h2>Hindcast skill by lead</h2><p class="muted">No evaluation rows for this panel.</p></div>`;
  const methods = [...new Set(rows.map(x => x.method))].filter(m => m !== 'trend');
  const weather = rows.filter(x => x.method === 'weather_todate'), tr = rows.filter(x => x.method === 'trend');
  const currentLead=D.panelByKey.get(key)?.weather?.lead; const best=weather.find(x=>x.lead===currentLead);
  return `<div class="card"><h2>Historical prediction skill by lead</h2><p class="muted">Rolling-origin hindcasts of harvest years 1991 onward, the target year and its neighbours excluded from training; skill is 1 − MSE/MSE of the trend-only baseline at the same lead (months before the window end). Trend-only RMSE ${tr.length ? fmt(tr[0].rmse, 1) + '% over ' + tr[0].n_years + ' years' : '–'}.${best ? ` At the current lead of ${best.lead} months, weather-to-date has: skill ${fmt(best.skill_vs_trend, 2)}, RMSE ${fmt(best.rmse, 1)}%, correlation ${fmt(best.corr, 2)}, 80% coverage ${fmt(100 * best.coverage_80, 0)}%.` : ''}</p>${skillChart(rows, methods,currentLead)}
    <details><summary>Skill table</summary><div class="table-scroll"><table class="t"><thead><tr><th>Method</th><th class="num">Lead</th><th class="num">Years</th><th class="num">RMSE, %</th><th class="num">MAE, %</th><th class="num">Skill vs trend</th><th class="num">Correlation</th><th class="num">80% coverage</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(METHOD_LABEL[x.method] || x.method)}</td><td class="num">${x.lead}</td><td class="num">${x.n_years}</td><td class="num">${fmt(x.rmse, 2)}</td><td class="num">${fmt(x.mae, 2)}</td><td class="num">${fmt(x.skill_vs_trend, 3)}</td><td class="num">${fmt(x.corr, 2)}</td><td class="num">${fmt(x.coverage_80, 2)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}
// ---- unit ------------------------------------------------------------------------------------------------------------
async function renderUnit(view, r, version) {
  const iso = r.iso, cat = D.catalog.countries[iso]; if (!cat) { view.innerHTML = `<p class="card">No country ${esc(iso)}.</p>`; return; }
  const {country, units} = await countryData(iso); if (version !== renderVersion) return;
  const u = units.units[r.unit]; if (!u) { view.innerHTML = `<p class="card">No unit ${esc(r.unit)} in ${esc(cat.name)}. <a href="${link(r.view, iso, null, qobj(r))}">Back to ${esc(cat.name)}</a></p>`; return; }
  const s = selection(r, iso); const q = qobj(r, {crop: s.crop, season: s.season});
  const options = u.series.map(x => ({v: `${x.crop_code}|${x.season}`, l: `${cap(cropLabel(x.crop_code))} · ${seasonLabel(x.season)}`})).filter((x, i, a) => a.findIndex(y => y.v === x.v) === i);
  const cur = `${s.crop}|${s.season}`; const chosen = cur;
  const [crop, season] = (chosen || '|').split('|'); const x = seriesFor(u, crop, season);
  const others = u.series.filter(y => y.crop_code === crop && y.season === season && y !== x);
  const head = `<div class="card">${crumbs(r, iso, r.unit, cat.name, u.name)}<h1>${esc(u.name)}${u.region_name ? `, ${esc(u.region_name)}` : ''} · ${esc(cropLabel(crop))}, ${esc(seasonLabel(season))}</h1>${viewTabs(r, iso, r.unit)}<div class="controls"><label>Series <select id="series-sel">${options.map(o => `<option value="${esc(o.v)}"${o.v === chosen ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label><span class="muted">${esc(u.level)} · ${esc(r.unit)}${others.length ? ` · ${others.length} further series of this crop and season (${others.map(y => esc(y.source + (y.basis !== 'unknown' ? ', ' + y.basis : ''))).join('; ')}) are listed in the catalog` : ''}</span></div></div>`;
  if (!x) { view.innerHTML = head + '<p class="card">This unit has no series of the selected crop and season.</p>'; return; }
  let body = '';
  if (r.view === 'record') {
    const records = await recordsData(iso); if (version !== renderVersion) return;
    const rec = records.series[x.id] || {obs: [], trend: null, trend_anomaly: []}; const t = rec.trend; const fitted = new Map(rec.trend_anomaly.map(a => [a[0], a]));
    body = `<div class="card"><h2>Observed yield, ${x.first}–${x.last}</h2><p class="muted">${x.n} years from ${esc(x.source)}${x.basis !== 'unknown' ? ` on ${esc(x.basis)} area` : ''}.${t ? ` Log-linear trend ${pct(t.trend_pct_per_year, 2)} per year over ${t.year_first}–${t.year_last} (${t.n_years} years). The dashed line shows that trend.` : ' No fitted trend is available for this series.'}</p><details><summary>Source record identifier</summary><p>Database series ${esc(x.id)}. ${esc(u.name_source||'Source place name')}.</p></details>${yieldChart(rec.obs,rec.trend_anomaly,rec.enso)+anomalyChart(rec.trend_anomaly)+qcNote(rec)}<details><summary>Observation table</summary><div class="table-scroll"><table class="t"><thead><tr><th>Harvest year</th><th class="num">Yield, t/ha</th><th class="num">Fitted, t/ha</th><th class="num">Anomaly</th></tr></thead><tbody>${rec.obs.map(o => { const a = fitted.get(o[0]); return `<tr><td>${o[0]}</td><td class="num">${fmt(o[1], 3)}</td><td class="num">${a ? fmt(a[2], 3) : '–'}</td><td class="num">${a ? pct(a[3]) : '–'}</td></tr>`; }).join('')}</tbody></table></div></details></div>`;
  } else if (r.view === 'response') {
    const rows = rowsOf(units, 'responses', x.responses);
    const reg = country.regions.filter(y => y.crop_code === crop && y.season === season && y.region_key === u.region_key);
    const cro = country.responses.filter(y => y.crop_code === crop && y.season === season && y.window === 'season');
    body = `<div class="card"><h2>Local ENSO relationships</h2>${rows.length ? `<div class="table-scroll"><table class="t"><thead><tr><th>Index</th><th class="num">Years</th><th class="num">Own fit, % per °C</th><th class="num">Interval</th><th class="num">p</th><th class="num">Selected estimate</th><th class="num">Interval</th><th class="num">p</th><th>Level</th><th class="num">Shrink weight</th></tr></thead><tbody>${rows.map(y => `<tr><td>${y.index === 'rel' ? 'Relative Niño 3.4' : 'Niño 3.4'}</td><td class="num">${y.n_years}</td><td class="num">${pct(y.pct_raw, 2)}</td><td class="num">${pct(y.lo_raw)} to ${pct(y.hi_raw)}</td><td class="num">${fmt(y.p_raw, 3)}</td><td class="num">${pct(y.pct_best, 2)}</td><td class="num">${pct(y.lo_best)} to ${pct(y.hi_best)}</td><td class="num">${fmt(y.p_best, 3)}</td><td>${esc(y.response_level)}</td><td class="num">${fmt(y.shrink_weight, 2)}</td></tr>`).join('')}</tbody></table></div><p class="muted">The selected estimate is the unit's own fit where the record has twenty years (classical error, t interval), else the state's slope with its clustered error, else the country's; the level column records which.</p>` : '<p class="muted">No response row: the series has fewer than ten fitted years.</p>'}
      ${reg.length ? `<h3>Region ${esc(u.region_name)} (separate regional fit)</h3><div class="table-scroll"><table class="t"><thead><tr><th>Index</th><th class="num">Shrunk, % per °C</th><th class="num">Interval</th><th class="num">Unpooled</th><th class="num">Interval</th><th class="num">p</th><th class="num">Units</th><th class="num">Years</th></tr></thead><tbody>${reg.map(y => `<tr><td>${y.index}</td><td class="num">${pct(y.pct_shrunk, 2)}</td><td class="num">${pct(y.lo_shrunk)} to ${pct(y.hi_shrunk)}</td><td class="num">${pct(y.pct_per_degC, 2)}</td><td class="num">${pct(y.lo)} to ${pct(y.hi)}</td><td class="num">${fmt(y.p, 3)}</td><td class="num">${y.n_units}</td><td class="num">${y.n_years}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${cro.length ? `<h3>${esc(cat.name)} (separate country fit)</h3><div class="table-scroll"><table class="t"><thead><tr><th>Index</th><th class="num">% per °C</th><th class="num">Interval</th><th class="num">p</th><th class="num">q</th><th class="num">Units</th><th class="num">Years</th></tr></thead><tbody>${cro.map(y => `<tr><td>${y.index}</td><td class="num">${pct(y.pct_per_degC, 2)}</td><td class="num">${pct(y.lo)} to ${pct(y.hi)}</td><td class="num">${fmt(y.p, 3)}</td><td class="num">${fmt(y.q, 3)}</td><td class="num">${y.n_units}</td><td class="num">${y.n_years}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
  } else {
    const rows = rowsOf(units, 'predictions', x.predictions), wins = rowsOf(units, 'windows', x.windows);
    const p = D.panelByKey.get(panelKey(iso, crop, season));
    body = `<div class="card"><h2>Conditional yield estimates</h2>${rows.length ? `<div class="table-scroll"><table class="t"><thead><tr><th>Method</th><th>Scenario</th><th>Harvest</th><th class="num">Lead</th><th class="num">%</th><th class="num">Interval</th><th class="num">s.e.</th><th class="num">Window run</th><th>Usable</th><th class="num">Skill vs trend</th><th class="num">Production, t</th><th>Beyond fit</th></tr></thead><tbody>${rows.map(y => `<tr><td>${esc(METHOD_LABEL[y.method] || y.method)}</td><td>${esc(SCENARIO_LABEL[y.scenario] || y.scenario)}</td><td>${y.harvest_year}</td><td class="num">${y.lead}</td><td class="num">${pct(y.pct, 2)}</td><td class="num">${pct(y.lo)} to ${pct(y.hi)}</td><td class="num">${fmt(y.se, 2)}</td><td class="num">${fmt(100 * y.frac_elapsed, 0)}%</td><td>${y.usable ? 'yes' : 'no'}</td><td class="num">${fmt(y.skill_vs_trend, 3)}</td><td class="num">${fmt(y.production_t, 0)}</td><td>${y.beyond_fit ? 'yes' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No prediction rows for this series.</p>'}
      ${x.weather.length ? `<h3>Weather observed during this growing season</h3><p class="muted">The series' metrics over the part of the window that has run, against its own mean and trend over the same days since 1981; z and the percentile place this year in that history.</p><div class="table-scroll"><table class="t"><thead><tr><th>Product</th><th>Metric</th><th class="num">Observed</th><th class="num">Reference</th><th class="num">Anomaly</th><th class="num">z</th><th class="num">Percentile</th><th class="num">Years</th></tr></thead><tbody>${x.weather.flatMap(wr => Object.entries(wr.metrics).map(([m, v]) => `<tr><td>${esc(wr.product)} · ${fmt(100 * wr.frac_elapsed, 0)}% run</td><td>${esc(METRIC_LABEL[m]?.[0] || m)}</td><td class="num">${fmt(v[0], 1)} ${METRIC_LABEL[m]?.[1] || ''}</td><td class="num">${fmt(v[1], 1)}</td><td class="num">${fmt(v[2], 2, true)}</td><td class="num">${fmt(v[3], 2, true)}</td><td class="num">${fmt(100 * v[4], 0)}</td><td class="num">${fmt(v[5], 0)}</td></tr>`)).join('')}</tbody></table></div>` : ''}
      ${wins.length ? `<h3>Planting and harvest windows</h3><table class="t"><thead><tr><th>Harvest year</th><th>Start</th><th>End</th><th>Calendar source</th><th>Cycle</th></tr></thead><tbody>${wins.map(y => `<tr><td>${y.harvest_year}</td><td>${esc(y.start_date)}</td><td>${esc(y.end_date)}</td><td>${esc(y.source)}</td><td>${esc(y.cycle)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
      ${p ? panelCard(p, r) + await skillCard(p.key, version) : ''}`;
    if (version !== renderVersion) return;
  }
  view.innerHTML = head + body;
}
// ---- about -----------------------------------------------------------------------------------------------------------
function renderAbout(view) {
  view.innerHTML=`<div class="card prose"><h1>Methods, sources and data</h1><p>We show crop records, historical ENSO relationships and conditional yield changes for the 2026–27 harvest horizon. The release is ${esc(D.release)}. Weather observations end ${esc(D.world.data_end)} and the outlook issue is ${esc(D.world.issue)}. A new interface date does not imply newer weather or a newer forecast.</p>
  <h2>Reading the estimates</h2><p>Yield history shows observed tonnes per hectare and departures from a fitted log-linear trend. We shade each harvest year using the ENSO exposure over that crop’s growing window. The ±0.5 °C shading threshold describes warm and cool seasonal exposure; official ENSO episodes use other persistence criteria. Missing years break the line. Stored QC flags and duplicate observations remain visible.</p><p>El Niño relationships describe the estimated percent yield change for a +1 °C increase in the selected ENSO index after accounting for yield trends. We keep local fits where the analysis selects them and label regional or national fallbacks. Separately fitted regional and country estimates need not equal an average of local map values. The default regional chart shows unpooled estimates; pooled alternatives remain available in the detailed table.</p><p>This season applies lower, central and higher ENSO paths to the selected historical relationships. Those scenarios describe ENSO strength, so their ordering need not match the ordering of yield losses. Country and world scenario bounds are weighted averages of local coefficient limits; they are not calibrated aggregate 95% intervals. The separate historical regressions retain their fitted 95% coefficient intervals. Future weather, pests, management and other harvest drivers add uncertainty beyond those intervals. The weather estimate uses observed weather over the elapsed growing window. Skill tests compare historical prediction errors with a trend-only baseline at the same lead; untested and failed checks are distinguished. The index-outlook checks use a test with the future ENSO index known, which measures a potential relationship rather than the skill of an operational ENSO forecast.</p>
  <h2>Coverage and aggregation</h2><p>World maps use the largest production panel per country and link to that exact crop type and season. The table keeps seasonal panels separate to avoid adding overlapping Annual and seasonal records or mixing rice measurement conventions. Local-coverage badges count the selected records. Map colors saturate at the labeled endpoints. Dashed outlines mean a scenario extends beyond the fitted ENSO range; grey means missing estimates. Region outlines are unions of available reporting-unit polygons, so gaps in the source coverage remain visible.</p><p>${esc(D.display.methods.common)} The matched-footprint comparison appears separately from the country regression estimate. HarvestStat weights use 2018–2022 reported production shares; Hultgren weights use the package’s cropped-area shares. Both allocate a 2019–2023 mean FAOSTAT national total. National FAOSTAT panels use that total directly. Allocated tonnes are proxies, not observations of current local production. The optional circles depict these weights (10 px radius represents 1 Mt). Crop-family totals are copied from the analysis release and retain its coverage and measurement conventions; they are not estimates of global food supply.</p>
  <h2>Data sources and stable boundaries</h2><p>We prioritize HarvestStat v0.1 and v0.2, then the Hultgren replication data and agency extensions, then FAOSTAT national series. India uses HarvestStat’s merged districts to retain stable boundaries. Crop calendars use the detailed Hultgren windows, FAO/GIEWS and RiceAtlas where available, with the actual source shown on each unit page. Temperature comes from BEST and rainfall from CHIRPS. ENSO indices come from ERSSTv5; the relative index removes the tropical mean anomaly. ${esc(D.display.methods.names)}</p>
  <h2>Downloads and reproducibility</h2><p>Use the CSV buttons to export tables, the figure buttons to export SVG charts, and “Print / save country brief” to save the selected page. Shared links include the release, crop, season and view. Cite “ENSO yield atlas, release ${esc(D.release)},” together with the source and coverage shown on the page.</p><p><a href="${D.base}manifest.json" download>Frozen data manifest</a> · <a href="${D.base}panels.json" download>All seasonal panel estimates</a> · <a href="${D.base}skill.json" download>Historical skill</a> · <a href="display/${D.release}/summary.json" download>Coverage, both indices, matched-footprint comparisons and change record</a> · <a href="display/${D.release}/manifest.json" download>Display supplement manifest</a> · <a href="bulletin-${D.release}.html">Release bulletin</a> · <a href="reporters.html">Reporter walkthrough</a></p>
  <details><summary>Technical data contract</summary><p>The browser does not aggregate, pool, convert units or decide significance. We copy the frozen analysis rows with scripts/export_release.py and generate separately hashed display files with scripts/export_display.py. Country and crop-family shards carry exact series IDs as strings. Numerical tests compare the frozen release to the database and Parquet results; independent display tests verify the additional means, exposure joins and selected-coverage counts.</p><p>Original tables include response_unit, response_region, response_country, prediction_series, prediction_panel, prediction_world, evaluation_skill, trend_series and trend_anomaly. Display means have no newly estimated aggregate interval.</p></details>
  <h2>Food-security context</h2><p>Yield estimates cover one part of food security. Stocks, trade, prices, incomes, conflict and preceding shocks also affect access to food. The <a href="https://fews.net/global/special-report/october-2026">FEWS NET October 2026 special report</a> supplies a separate regional assessment. Its qualitative findings and historical production comparisons are not the atlas’s conditional yield estimates.</p>
  <h2>Archive</h2><p>Earlier releases remain at the <a href="../global/">global yield atlas</a>, <a href="../climate/">climate atlas</a> and <a href="../watch/">Crop Watch</a>. Those pages use earlier datasets and methods. <a href="#/season">Open the latest atlas release</a>.</p></div>`;
}
// ---- charts (inline SVG) -----------------------------------------------------------------------------------------------
function intro() {
  return `<section class="intro"><p class="eyebrow">EL NIÑO CROP WATCH · 2026–27</p><h1>ENSO, weather and the harvest</h1><p>Explore how crop yields have varied with El Niño and La Niña, and what this season’s conditions may mean for upcoming harvests. Choose a crop and country, then explore local results where available.</p><p class="muted">We compare historical yield relationships with observed weather and ENSO scenarios. The estimates carry uncertainty and do not measure global food supply. Observations end ${esc(D.world.data_end)}; outlook issued ${esc(D.world.issue)}.</p></section>`;
}
function coverageFor(iso,s) {return D.display.family_coverage?.[`${iso}|${s.family}|${s.season||'all'}`]||{units:0,local:0,series:0};}
function localTable(r,s,picked,units) {
  const U=units.units;
  const rows=Object.entries(picked).map(([key,x])=>({key,x,p:rowsOf(units,'predictions',x.predictions).find(p=>p.method==='index_outlook'&&p.scenario==='medium'),a:rowsOf(units,'responses',x.responses).find(a=>a.index===s.index)})).sort((a,b)=>(b.p?.production_t||0)-(a.p?.production_t||0));
  return `<div class="card"><h2>Explore local reporting units</h2><p class="muted">Sorted by the scenario production weight where available. Search a place or region, or change the sort. Weights allocate the national production total across units. Hultgren weights use cropped-area shares and are proxies, not measured local production; HarvestStat uses reported production shares. Map color describes the yield relationship.</p><div class="table-scroll"><table class="t local-table"><thead><tr><th>Place</th><th>Region</th><th>Production weight, Mt</th><th>ENSO relationship, % / °C</th><th>Central scenario</th><th>Record years</th><th>Source</th></tr></thead><tbody>${rows.map(({key,x,p,a})=>`<tr data-region="${esc(U[key].region_name||'National')}"><td><a href="${link(r.view,r.iso,key,qobj(r,{crop:s.crop,season:s.season}))}">${esc(U[key].name)}</a></td><td>${esc(U[key].region_name||'National')}</td><td>${fmt(p?.production_t/1e6,3)}</td><td>${pct(a?.pct_best)}<small>${pct(a?.lo_best)} to ${pct(a?.hi_best)} · ${esc(a?.response_level||'unavailable')}</small></td><td>${pct(p?.pct)}${p?.beyond_fit?' · beyond fitted range':''}</td><td>${x.first}–${x.last}</td><td>${esc(x.source)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function changeStrip() {
  const c=D.display.changes,counts=c.summary?.counts||{},causes=c.summary?.causes||{};
  return `<details class="change-strip"><summary>What changed in this release · ${counts.moved||0} revised panels, ${counts.added||0} added</summary><p>Comparison supplied with the rebuilt analysis: ${causes.method||0} changes attributed to methods, ${causes.new_data||0} to new data, ${causes.series_set||0} to coverage, and ${causes.calendar||0} to calendars. The previous and current builds share the date ${esc(c.previous)}; these are build revisions, not daily weather changes.</p><a href="display/${D.release}/summary.json" download>Download the full change record and display methods</a></details>`;
}
function worldSummary() {
  return `<h3>Six crops at a glance</h3><p class="muted">Percent change relative to trend over each method’s modeled coverage. Weather and ENSO totals can cover different places. We keep country seasons and rice measurement conventions separate in the detailed rows.</p><div class="table-scroll"><table class="t"><thead><tr><th>Crop</th><th>Central ENSO</th><th>Weather so far</th><th>Weather production coverage</th></tr></thead><tbody>${D.catalog.families.map(f=>{const a=D.world.world.find(x=>x.crop_family===f&&x.method==='index_outlook'&&x.scenario==='medium'),w=D.world.world.find(x=>x.crop_family===f&&x.method==='weather_todate');return `<tr><td><a href="${link('season',null,null,{crop:f,release:D.release})}">${cap(f)}</a></td><td>${pct(a?.pct)}<small>${pct(a?.lo)} to ${pct(a?.hi)}</small></td><td>${pct(w?.pct)}<small>${w?'Panels meeting weather checks':'No eligible panels'}</small></td><td>${w?`${fmt(w.production_mt,1)} Mt · ${fmt(100*w.coverage_share,0)}%`:'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function countryIntro(r,s,picked,units) {
  const p=D.panelByKey.get(s.key),m=p?.predictions.find(x=>x.method==='index_outlook'&&x.scenario==='medium');
  const n=Object.keys(picked).length,local=Object.keys(picked).filter(k=>units.units[k].level!=='national').length;
  const hist=Object.entries(D.display.coverage).filter(([k,v])=>k.startsWith(`${r.iso}|`)&&D.catalog.crops[k.split('|')[1]]?.family===s.family&&v.local>0).sort((a,b)=>b[1].local-a[1].local)[0];
  const alt=D.panels.filter(x=>x.iso3===r.iso&&x.crop_family===s.family).sort((a,b)=>b.production_mt-a.production_mt);
  let verdict=r.view==='season'?(p?(p.weather?.usable_panel?`Weather so far implies ${pct(p.weather.pct_panel)} relative to trend and meets the seasonal coverage and historical-skill checks. The separate ENSO scenario implies ${pct(m?.pct)} relative to trend; uncertainty spans ${pct(m?.lo)} to ${pct(m?.hi)}.`:`The ENSO scenario implies ${pct(m?.pct)} relative to trend, with an interval of ${pct(m?.lo)} to ${pct(m?.hi)}. ${p.weather?'The weather-based estimate does not meet all reliability checks yet.':'A weather-based estimate is not available for this season.'}`):'No current estimate is available for the selected crop type and season.'):
    r.view==='response'?`We estimate the relationship between ENSO and past yields after accounting for long-term yield trends. Local estimates retain geographic differences; some short records use a regional or national fallback.`:`Compare yields for the same harvest year, then open a place to see its yield history alongside crop-season ENSO conditions.`;
  return `<section class="country-intro"><p class="verdict">${verdict}</p><div class="chips"><span class="chip ${local?'green':'grey'}">${local?`${local.toLocaleString()} local reporting units`:`${n} national reporting unit${n===1?'':'s'}`}</span><span class="chip grey">${esc(cropLabel(s.crop))} · ${esc(seasonLabel(s.season))}</span></div>${r.view==='season'&&!p&&alt.length?`<p class="banner">A current panel is available for <a href="${link('season',r.iso,null,qobj(r,{crop:alt[0].crop_code,season:alt[0].season}))}">${esc(cropLabel(alt[0].crop_code))}, ${esc(seasonLabel(alt[0].season))}</a>. The historical selection remains available in Yield history.</p>`:''}${r.view==='season'&&!local&&hist?`<p class="banner">This season’s estimate has national coverage. Historical local records remain available for <a href="${link('record',r.iso,null,qobj(r,{crop:hist[0].split('|')[1],season:hist[0].split('|')[2]}))}">${hist[1].local.toLocaleString()} local units, ${esc(seasonLabel(hist[0].split('|')[2]))}</a>.</p>`:''}</section>`;
}
function timingCard(p) {
  const t=D.display.timing[p.key];if(!t)return '';
  return `<div class="season-timing"><h3>Growing season and observation cutoff</h3><p>Planting-window starts: ${esc(t.start_min)}${t.start_max!==t.start_min?' to '+esc(t.start_max):''}. Harvest-window ends: ${esc(t.end_min)}${t.end_max!==t.end_min?' to '+esc(t.end_max):''}.</p><div class="progress" role="img" aria-label="${fmt(100*t.frac_elapsed,0)} percent of the growing window observed"><span style="width:${Math.max(0,Math.min(100,100*t.frac_elapsed))}%"></span></div><p class="muted">${fmt(100*t.frac_elapsed,0)}% of the production-weighted window has elapsed by ${esc(D.world.data_end)}. Calendar sources: ${t.sources.map(esc).join(', ')}. Dates vary among reporting units; individual pages show the exact window.</p></div>`;
}
function historicalIndexCard() {
  const rows=D.display.monthly||[],yr=Number(D.world.index_last_month.slice(0,4)),month=Number(D.world.index_last_month.slice(5)),years=[yr,2023,2015,1997,1982];
  return `<div class="card"><h3>This year alongside earlier events</h3><p class="muted">Same calendar month and same index definition in each year; monthly values are not winter-peak forecasts.</p><table class="t"><thead><tr><th>Year</th><th>Month</th><th>Niño 3.4, °C</th><th>Relative Niño 3.4, °C</th></tr></thead><tbody>${years.map(y=>{const r=rows.find(r=>r.year===y&&r.month===month);return `<tr><td>${y}${y===yr?' (current)':''}</td><td>${month}</td><td>${fmt(r?.nino34,2,true)}</td><td>${fmt(r?.nino34_rel,2,true)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
function anomalyChart(rows) {
  if(!rows?.length)return '';
  const W=640,H=145,left=50,right=16,years=rows.map(r=>r[0]),first=Math.min(...years),last=Math.max(...years),lim=Math.max(10,...rows.map(r=>Math.abs(r[3]||0)));
  const x=y=>left+(y-first)/Math.max(1,last-first)*(W-left-right),height=a=>Math.abs(a)/lim*48;
  return `<h3>Yield departures from the fitted trend</h3><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Annual yield anomalies as bars"><line x1="${left}" x2="${W-right}" y1="70" y2="70" stroke="#777"/><text x="0" y="24" font-size="11">+${fmt(lim,0)}%</text><text x="0" y="120" font-size="11">−${fmt(lim,0)}%</text>${rows.map(a=>`<rect x="${x(a[0])-2}" y="${a[3]>0?70-height(a[3]):70}" width="${Math.max(1,(W-left-right)/(last-first+1)-1)}" height="${height(a[3])}" fill="${a[3]<0?'#b36b20':'#238b45'}"><title>${a[0]}: ${pct(a[3])}</title></rect>`).join('')}<text x="${left}" y="140" font-size="11">${first}</text><text x="${W-right}" y="140" text-anchor="end" font-size="11">${last}</text></svg>`;
}
function qcNote(rec) {
  const years=new Set(),duplicates=new Set();for(const o of rec.obs){if(years.has(o[0]))duplicates.add(o[0]);years.add(o[0]);}
  return `${duplicates.size?`<p class="banner">Multiple source observations occur in ${[...duplicates].join(', ')}. We retain both values for review.</p>`:''}<details><summary>Data quality and source notes (${rec.qc?.length||0} flags)</summary><p>QC flags identify observations to inspect; a flag does not establish that a value is wrong. The source record and stable unit boundaries are retained.</p>${rec.qc?.length?`<table class="t"><thead><tr><th>Source year</th><th>Check</th><th>Severity</th><th>Note</th></tr></thead><tbody>${rec.qc.map(a=>`<tr>${a.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p>No stored QC flags for this series.</p>'}</details>`;
}
function downloadText(name,text,type='text/csv;charset=utf-8') {
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadMap(el,r) {
  const map=maps[el.id];if(!map)return;
  const original=map.getCanvas(),canvas=document.createElement('canvas'),dpr=original.width/el.clientWidth||1;
  canvas.width=original.width;canvas.height=original.height+Math.ceil(175*dpr);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(original,0,0);ctx.scale(dpr,dpr);
  const box=el.getBoundingClientRect();ctx.font='10px Helvetica';ctx.textAlign='center';
  for(const label of el.querySelectorAll('.region-label')){const b=label.getBoundingClientRect(),x=b.left-box.left+b.width/2,y=b.top-box.top+10;if(x<0||x>el.clientWidth||y<0||y>el.clientHeight)continue;ctx.lineWidth=3;ctx.strokeStyle='white';ctx.strokeText(label.textContent,x,y);ctx.fillStyle='#48544d';ctx.fillText(label.textContent,x,y);}
  ctx.textAlign='left';ctx.fillStyle='#203329';ctx.font='14px Helvetica';
  ctx.fillText(document.querySelector('#view h1')?.textContent||'ENSO yield atlas',14,el.clientHeight+24);
  const legend=el.parentElement.querySelector('.legend'),palette=r.view==='response'?RESPONSE_PALETTE:r.view==='record'?(r.q.get('measure')==='anomaly'?SCENARIO_PALETTE:YIELD_PALETTE):r.q.get('layer')==='rain'?RAIN_PALETTE:r.q.get('layer')==='tmax'?TEMP_PALETTE:SCENARIO_PALETTE;
  const width=Math.min(270,el.clientWidth-30),gradient=ctx.createLinearGradient(14,0,14+width,0);palette.forEach((c,i)=>gradient.addColorStop(i/(palette.length-1),c));ctx.fillStyle=gradient;ctx.fillRect(14,el.clientHeight+37,width,10);
  ctx.fillStyle='#203329';ctx.font='11px Helvetica';const ticks=[...legend?.querySelectorAll('.legend-ticks span')||[]];ticks.forEach((t,i)=>{ctx.textAlign=i===0?'left':i===ticks.length-1?'right':'center';ctx.fillText(t.textContent,14+width*i/Math.max(1,ticks.length-1),el.clientHeight+61);});ctx.textAlign='left';
  ctx.fillText(legend?.querySelector('.legend-title')?.textContent||'',14,el.clientHeight+82);
  ctx.fillText(`Release ${D.release} · ${r.view} · ${r.q.get('crop')} · ${r.q.get('season')||'seasonal panels'} · ${r.q.get('index')==='std'?'Niño 3.4':'relative Niño 3.4'}`,14,el.clientHeight+104);
  ctx.fillText('Conditional estimate; sources and uncertainty: phuybers3.github.io/enso-yield-atlas/site/',14,el.clientHeight+125);
  ctx.fillText('ENSO yield atlas · HarvestStat / Hultgren / FAOSTAT; BEST / CHIRPS. Grey: no estimate.',14,el.clientHeight+146);
  const a=document.createElement('a');a.download=`enso-map-${r.iso||'world'}-${D.release}.png`;a.href=canvas.toDataURL('image/png');a.click();
}
function bindUtilities(r) {
  const view=document.getElementById('view');
  view.querySelectorAll('a[download]').forEach(a=>a.href=dataURL(a.getAttribute('href')));
  const tools=document.createElement('div');tools.className='page-tools';
  const brief=r.view==='season'&&r.iso&&!r.unit; tools.innerHTML=`<button id="copy-link">Copy this view’s link</button><button id="print-brief">${brief?'Print / save country brief':'Print selected view'}</button><span id="share-status" role="status"></span>`;
  view.prepend(tools);const citation=document.createElement('p');citation.className='print-source';citation.style.display='none';citation.textContent=`ENSO yield atlas · release ${D.release} · weather through ${D.world.data_end}. Sources: HarvestStat, Hultgren replication and agency extensions, FAOSTAT; ERSSTv5 ENSO indices; BEST temperature and CHIRPS rainfall. Conditional estimates relative to trend; intervals omit future weather and other drivers. https://phuybers3.github.io/enso-yield-atlas/site/${link(r.view,r.iso,r.unit,qobj(r))}`;view.appendChild(citation);
  document.getElementById('copy-link').onclick=async()=>{const hash=link(r.view,r.iso,r.unit,qobj(r));const url=location.href.split('#')[0]+hash;try{await navigator.clipboard.writeText(url);document.getElementById('share-status').textContent='Link copied, including release and selection.';}catch{document.getElementById('share-status').textContent=url;}};
  document.getElementById('print-brief').onclick=()=>{if(brief)document.body.classList.add('printing-brief');const cards=[...view.querySelectorAll(':scope > .card')];if(cards[0])cards[0].classList.add('brief-head');const map=document.getElementById('cmap')?.closest('.card');if(map)map.classList.add('brief-map');window.print();document.body.classList.remove('printing-brief');};
  document.querySelectorAll('table.t').forEach((table,i)=>{
    const controls=document.createElement('div');controls.className='table-tools';
    controls.innerHTML=`<label>Search this table <input type="search" aria-label="Search table ${i+1}" placeholder="Place, crop, season…"></label><label>Sort <select aria-label="Sort table ${i+1}"><option value="">Default order</option>${[...table.querySelectorAll('thead th')].map((th,j)=>`<option value="${j}">${esc(th.textContent)}</option>`).join('')}</select></label><button>Download CSV</button><span class="muted table-count"></span>`;
    table.parentElement.insertBefore(controls,table);
    const rows=[...table.querySelectorAll('tbody tr')],input=controls.querySelector('input'),count=controls.querySelector('.table-count');
    let region=null;if(table.classList.contains('local-table')){const label=document.createElement('label');label.textContent='Region ';region=document.createElement('select');region.setAttribute('aria-label','Filter by region');region.innerHTML='<option value="">All regions</option>'+[...new Set(rows.map(row=>row.dataset.region))].sort().map(x=>`<option>${esc(x)}</option>`).join('');label.appendChild(region);controls.appendChild(label);}
    const filter=()=>{let n=0;for(const row of rows){const match=row.textContent.toLowerCase().includes(input.value.toLowerCase())&&(!region?.value||row.dataset.region===region.value);row.hidden=!match;if(match)n++;}count.textContent=`${n.toLocaleString()} rows`;};input.oninput=filter;if(region)region.onchange=filter;filter();
    const sort=controls.querySelector('select');sort.onchange=()=>{const col=Number(sort.value);const get=row=>row.children[col]?.textContent.trim()||'';const numeric=v=>/^[-+−]?\d/.test(v)?Number(v.replace(/−/g,'-').replace(/[,％%]/g,'').match(/^[-+]?\d*\.?\d+/)?.[0]):NaN;const sorted=sort.value===''?rows:[...rows].sort((a,b)=>{const aa=get(a),bb=get(b),an=numeric(aa),bn=numeric(bb);return Number.isFinite(an)&&Number.isFinite(bn)?bn-an:aa.localeCompare(bb);});sorted.forEach(row=>table.querySelector('tbody').appendChild(row));};
    controls.querySelector('button').onclick=()=>{const cell=v=>{let t=String(v);if(/^[=+@-]/.test(t)&&!/^[-+]?\d/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};const csv=[['ENSO yield atlas',`Release ${D.release}`,`Weather through ${D.world.data_end}`],['View',location.href],['Interpretation','Conditional changes relative to trend; uncertainty and geographic coverage accompany each estimate.'],...[...table.querySelectorAll('tr')].filter(tr=>!tr.hidden).map(tr=>[...tr.children].map(c=>c.textContent.trim()))].map(row=>row.map(cell).join(',')).join('\r\n');downloadText(`enso-${r.iso||'world'}-${r.view}-${D.release}-${i+1}.csv`,csv);};
  });
  document.querySelectorAll('.map').forEach(el=>{const b=document.createElement('button');b.className='figure-download';b.textContent='Download map (PNG)';b.onclick=()=>downloadMap(el,r);el.after(b);});
  document.querySelectorAll('svg.chart').forEach((svg,i)=>{const b=document.createElement('button');b.className='figure-download';b.textContent='Download figure (SVG)';b.onclick=()=>downloadText(`enso-${r.iso||'world'}-${D.release}-${i+1}.svg`,svg.outerHTML.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ').replace('>',`><metadata>ENSO yield atlas; release ${D.release}; ${esc(r.iso||'world')}; ${esc(r.q.get('crop'))}; ${esc(r.q.get('season'))}. Sources and uncertainty: https://phuybers3.github.io/enso-yield-atlas/site/#/about?release=${D.release}</metadata>`),'image/svg+xml');svg.after(b);});
}
function barChart(items, title, palette) {
  if (!items.length) return ''; const W = 640, rowH = 22, left = 210, right = 90, top = 28; const H = top + rowH * items.length + 30;
  // The axis spans the central estimates; an interval beyond it is drawn to the edge (the table carries its value).
  const lim = Math.max(5, ...items.map(i => Math.abs(i.mid || 0))) * 1.05; const x = v => left + (W - left - right) * (0.5 + Math.max(-lim, Math.min(lim, v)) / (2 * lim));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim].map(v => Math.round(v));
  const neg = palette[0], pos = palette[palette.length - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><text x="0" y="14" font-size="12" fill="#52514e">${esc(title)}</text>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 24}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${x(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#898781">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
    ${items.map((it, i) => { const y = top + rowH * i + rowH / 2; const col = it.mid < 0 ? neg : pos; const label = `<text x="${left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#0b0b0b">${esc(it.label)}</text>`; return `${it.href ? `<a href="${esc(it.href)}">${label}</a>` : label}
      ${it.lo != null && it.hi != null ? `<line x1="${x(Math.max(-lim, it.lo))}" x2="${x(Math.min(lim, it.hi))}" y1="${y}" y2="${y}" stroke="${col}" stroke-opacity=".35" stroke-width="7" stroke-linecap="round"/>` : ''}
      ${it.mid != null ? `<circle cx="${x(it.mid)}" cy="${y}" r="4.5" fill="${col}"/>` : ''}<text x="${W - right + 6}" y="${y + 4}" font-size="10" fill="#52514e">${esc(it.note || '')}</text>`; }).join('')}</svg>`;
}
function yieldChart(obs, fit = [], exposure = []) {
  if (!obs.length) return '<p class="muted">No observations.</p>';
  const W = 640, H = 280, left = 50, right = 16, top = 22, bottom = 30; const years = obs.map(o => o[0]), vals = obs.map(o => o[1]).concat(fit.map(a => a[2]));
  const y0 = Math.min(...years), y1 = Math.max(...years), v1 = Math.max(...vals) * 1.05 || 1, v0 = 0;
  const x = yr => left + (yr - y0) / (y1 - y0 || 1) * (W - left - right), y = v => top + (1 - (v - v0) / (v1 - v0)) * (H - top - bottom);
  const vt = [0, 0.25, 0.5, 0.75, 1].map(f => v0 + f * (v1 - v0)); const step = y1 - y0 > 40 ? 10 : 5; const yt = years.filter(yr => yr % step === 0).filter((yr, i, a) => a.indexOf(yr) === i);
  const path = obs.map((o, i) => `${i === 0 || o[0] !== obs[i - 1][0] + 1 ? 'M' : 'L'}${x(o[0]).toFixed(1)},${y(o[1]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Observed yield by harvest year"><text x="${left}" y="14" font-size="12" fill="#52514e">Yield, t/ha</text>
    ${exposure.filter(a=>a[1]!=null&&Math.abs(a[1])>=.5&&a[0]>=y0&&a[0]<=y1).map(a=>`<rect x="${x(a[0]-.5)}" y="${top}" width="${(W-left-right)/(y1-y0||1)}" height="${H-top-bottom}" fill="${a[1]>0?'#d8b365':'#80cdc1'}" opacity=".25"><title>${a[0]} crop-season Niño 3.4: ${fmt(a[1],2)} °C</title></rect>`).join('')}
    ${vt.map(v => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="#e1e0d9"/><text x="${left - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#898781">${fmt(v, 1)}</text>`).join('')}
    ${yt.map(yr => `<text x="${x(yr)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#898781">${yr}</text>`).join('')}
    <path d="${path}" fill="none" stroke="#237762" stroke-width="1.6"/>${obs.map(o => `<circle cx="${x(o[0]).toFixed(1)}" cy="${y(o[1]).toFixed(1)}" r="2.6" fill="#176957"><title>${o[0]}: ${fmt(o[1], 3)} t/ha</title></circle>`).join('')}
    ${fit.length ? `<path class="trend" d="${fit.map((a, i) => `${i ? 'L' : 'M'}${x(a[0]).toFixed(1)},${y(a[2]).toFixed(1)}`).join(' ')}" fill="none" stroke="#b36b20" stroke-width="2" stroke-dasharray="6 3"/><text x="${W - right}" y="14" font-size="11" text-anchor="end" fill="#b36b20">fitted trend</text>` : ''}</svg><p class="muted">Brown / teal shading marks warm / cool crop-season Niño 3.4 exposure (±0.5 °C), matched to this crop’s harvest year and growing window. This is a seasonal exposure label, not an official El Niño / La Niña episode classification. Unshaded years can be neutral or lack a matched index observation. Gaps in the yield record break the line.</p>`;
}
function indexPathChart(rows) {
  const W = 640, H = 220, left = 46, right = 16, top = 22, bottom = 30;
  const months = [...new Set(rows.map(r => `${r.year}-${String(r.month).padStart(2, '0')}`))].sort();
  const vals = rows.map(r => r.value); const v0 = Math.min(-1, ...vals), v1 = Math.max(1, ...vals);
  const x = m => left + months.indexOf(m) / Math.max(1, months.length - 1) * (W - left - right), y = v => top + (1 - (v - v0) / (v1 - v0)) * (H - top - bottom);
  const key = r => `${r.year}-${String(r.month).padStart(2, '0')}`;
  const colors = {low: '#5ab4ac', medium: '#0b0b0b', high: '#b2182b'};
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scenario index paths by month"><text x="${left}" y="14" font-size="12" fill="#52514e">Relative Niño 3.4, °C</text>
    ${[v0, 0, v1].map(v => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${left - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#898781">${fmt(v, 1)}</text>`).join('')}
    ${months.filter(m => m.endsWith('-01') || m.endsWith('-07')).map(m => `<text x="${x(m)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#898781">${m}</text>`).join('')}
    ${['low', 'medium', 'high'].map(sc => { const pts = rows.filter(r => r.scenario === sc).sort((a, b) => key(a).localeCompare(key(b))); return `<polyline fill="none" stroke="${colors[sc]}" stroke-width="${sc === 'medium' ? 2 : 1.4}" points="${pts.map(r => `${x(key(r)).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ')}"/>${pts.map(r => `<circle cx="${x(key(r)).toFixed(1)}" cy="${y(r.value).toFixed(1)}" r="3" fill="${r.observed ? colors[sc] : '#fff'}" stroke="${colors[sc]}" stroke-width="1.5"><title>${key(r)} ${esc(SCENARIO_LABEL[sc])}: ${fmt(r.value, 2, true)} °C${r.observed ? ' (observed)' : ''}</title></circle>`).join('')}`; }).join('')}
    ${['low', 'medium', 'high'].map((sc, i) => `<rect x="${left + 130 * i}" y="${H - 2}" width="10" height="3" fill="${colors[sc]}"/><text x="${left + 130 * i + 14}" y="${H + 2}" font-size="10" fill="#52514e">${esc(SCENARIO_LABEL[sc])}</text>`).join('')}</svg>`;
}
function skillChart(rows, methods,currentLead) {
  const W = 640, H = 240, left = 50, right = 16, top = 22, bottom = 30; const leads = [...new Set(rows.map(x => x.lead))].sort((a, b) => b - a);
  const vals = rows.filter(x => methods.includes(x.method) && Number.isFinite(x.skill_vs_trend)).map(x => x.skill_vs_trend);
  const v0 = Math.min(-0.5, ...vals.map(v => Math.max(v, -2))), v1 = Math.max(0.5, ...vals); const x = l => left + leads.indexOf(l) / Math.max(1, leads.length - 1) * (W - left - right), y = v => top + (1 - (Math.max(v, v0) - v0) / (v1 - v0)) * (H - top - bottom);
  const ticks = [v0, (v0 + 0) / 2, 0, v1 / 2, v1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hindcast skill against the trend-only baseline by lead"><text x="${left}" y="14" font-size="12" fill="#52514e">Skill against trend (1 − MSE/MSE trend), by lead in months before the window end</text>
    ${ticks.map(v => `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${left - 6}" y="${y(v) + 4}" font-size="10" text-anchor="end" fill="#898781">${fmt(v, 2)}</text>`).join('')}
    ${currentLead!=null?`<line x1="${x(currentLead)}" x2="${x(currentLead)}" y1="${top}" y2="${H-bottom}" stroke="#333" stroke-dasharray="3 3"/><text x="${x(currentLead)-4}" y="${top+12}" text-anchor="end" font-size="11">Current lead</text>`:''}
    ${leads.map(l => `<text x="${x(l)}" y="${H - 10}" font-size="10" text-anchor="middle" fill="#898781">${l}</text>`).join('')}
    ${methods.map(m => { const pts = rows.filter(r => r.method === m && Number.isFinite(r.skill_vs_trend)).sort((a, b) => b.lead - a.lead); return `<polyline fill="none" stroke="${METHOD_COLOR[m] || '#0b0b0b'}" stroke-width="2" points="${pts.map(p => `${x(p.lead).toFixed(1)},${y(p.skill_vs_trend).toFixed(1)}`).join(' ')}"/>${pts.map(p => `<circle cx="${x(p.lead).toFixed(1)}" cy="${y(p.skill_vs_trend).toFixed(1)}" r="3" fill="${METHOD_COLOR[m] || '#0b0b0b'}"><title>${esc(METHOD_LABEL[m] || m)}, lead ${p.lead}: skill ${fmt(p.skill_vs_trend, 3)}, RMSE ${fmt(p.rmse, 2)}%</title></circle>`).join('')}`; }).join('')}
    ${methods.map((m, i) => `<rect x="${left + 150 * i}" y="${H - 2}" width="10" height="3" fill="${METHOD_COLOR[m] || '#0b0b0b'}"/><text x="${left + 150 * i + 14}" y="${H + 2}" font-size="10" fill="#52514e">${esc(METHOD_LABEL[m] || m)}</text>`).join('')}</svg>`;
}
// ---- maps (MapLibre, no basemap) -------------------------------------------------------------------------------------
function drawMap(id, fc, tipFn, clickFn, fit,regions,production=[]) {
  const el = document.getElementById(id); if (!el) return;
  if (!window.maplibregl) { el.innerHTML = '<p class="map-note">The map needs WebGL; the tables carry the same values.</p>'; return; }
  if (maps[id]) { try { maps[id].remove(); } catch (e) { /* ignore */ } delete maps[id]; }
  const map = new maplibregl.Map({container: id, style: {version: 8, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#f3f2ef'}}]}, attributionControl: false, interactive: true, renderWorldCopies: false, canvasContextAttributes:{preserveDrawingBuffer:true}});
  map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
  map.on('load', () => {
    map.addSource('u', {type: 'geojson', data: fc}); map.addLayer({id: 'u-fill', type: 'fill', source: 'u', paint: {'fill-color': ['get', 'color'], 'fill-opacity': 0.95}}); map.addLayer({id: 'u-line', type: 'line', source: 'u', paint: {'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.15, 6, 0.6], 'line-opacity': 0.6}});
    if(regions?.features.length){map.addSource('regions',{type:'geojson',data:regions});map.addLayer({id:'region-line',type:'line',source:'regions',paint:{'line-color':'#4c5b50','line-width':1.1,'line-opacity':.6}});if(maplibregl.Marker)for(const f of regions.features){const label=document.createElement('span');label.className='region-label';label.textContent=f.properties.name;new maplibregl.Marker({element:label}).setLngLat(f.properties.center).addTo(map);label.setAttribute('aria-hidden','true');label.removeAttribute('role');label.tabIndex=-1;}}
    map.addLayer({id:'local-detail-line',type:'line',source:'u',filter:['==',['get','localDetail'],true],paint:{'line-color':'#364d3c','line-width':1.2,'line-dasharray':[1,2]}});
    map.addLayer({id:'beyond-line',type:'line',source:'u',filter:['==',['get','beyond'],true],paint:{'line-color':'#58433a','line-width':1.3,'line-dasharray':[2,2]}});
    if(production.length){map.addSource('production',{type:'geojson',data:{type:'FeatureCollection',features:production}});map.addLayer({id:'production-dots',type:'circle',source:'production',paint:{'circle-radius':['*',10,['sqrt',['/',['get','production'],1000000]]],'circle-color':'#323c32','circle-opacity':.13,'circle-stroke-color':'#26352c','circle-stroke-width':.6}});}
    const b = fit || bounds(fc); if (b) map.fitBounds(b, {padding: 20, duration: 0, maxZoom: 7});
    const tip = document.createElement('div'); tip.className = 'tooltip'; tip.style.display = 'none'; el.appendChild(tip);
    map.on('mousemove', 'u-fill', e => { const f = e.features.find(f=>f.properties.reporting===true)||e.features[0]; if(!f)return; tip.innerHTML = tipFn(f)+'<br><span class="muted">Click to open this place</span>'; tip.style.display = ''; tip.style.left = Math.max(6, Math.min(e.point.x + 12, el.clientWidth - tip.offsetWidth - 6)) + 'px'; tip.style.top = Math.max(6, Math.min(e.point.y + 12, el.clientHeight - tip.offsetHeight - 6)) + 'px'; map.getCanvas().style.cursor = clickFn ? 'pointer' : ''; });
    map.on('mouseleave', 'u-fill', () => { tip.style.display = 'none'; map.getCanvas().style.cursor = ''; });
    if (clickFn) map.on('click', 'u-fill', e => clickFn(e.features.find(f=>f.properties.reporting===true)||e.features[0]));
  });
  maps[id] = map;
}
function bounds(fc) { let w = 180, s = 90, e = -180, n = -90, any = false; const walk = c => { if (typeof c[0] === 'number') { any = true; w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); }; fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates)); return any ? [[w, s], [e, n]] : null; }
})();
