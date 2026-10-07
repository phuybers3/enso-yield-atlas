/* El Niño Crop Watch: three screens per country, crop and season, from the data release in data/<issue>/. */
(() => {
const ISSUE = new URLSearchParams(location.search).get('issue') || '2026-10-06';
const BASE = `data/${ISSUE}/`; const RED = '#e34948', BLUE = '#2a78d6', ORANGE = '#eb6834', GREY = '#898781';
const BROWN = '#7f3b08', GREEN = '#006837', NO_ESTIMATE = '#d5d6d2';
const MAP_PALETTE = [BROWN, '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', GREEN];
const WORLD_LIMIT = 10, RAIN_LIMIT = 30, TMAX_LIMIT = 1.5;
const cache = new Map(); const D = {};
const CROPS = ['maize', 'rice', 'wheat', 'soybean', 'sorghum', 'cassava'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = (v, d = 1, sign = false) => v == null || !isFinite(v) ? '–' : (sign && v > 0 ? '+' : '') + Number(v).toFixed(d);
const pct = (v, d = 0) => v == null ? '–' : fmt(v, d, true) + '%';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
async function load(path) {
  if (!cache.has(path)) cache.set(path, (async () => {
    const r = await fetch(path); if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
    return path.endsWith('.gz') ? JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()) : r.json();
  })().catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}
// ---- colour scales -------------------------------------------------------------------------------------------------
function mix(a, b, t) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((x, i) => Math.round(x + (B[i] - x) * t)).join(',')})`; }
function diverging(v, lim, neg, pos) { if (v == null || !isFinite(v)) return '#ece9e3'; const t = Math.max(-1, Math.min(1, v / lim)); return t < 0 ? mix('#f6f5f2', neg, -t) : mix('#f6f5f2', pos, t); }
function mapColor(v, lim) {
  if (v == null || !Number.isFinite(v)) return NO_ESTIMATE;
  const x = (Math.max(-1, Math.min(1, v / lim)) + 1) * 3;
  const i = Math.min(5, Math.floor(x));
  return mix(MAP_PALETTE[i], MAP_PALETTE[i + 1], x - i);
}
const colExpected = v => mapColor(v, WORLD_LIMIT), colRain = v => mapColor(v, RAIN_LIMIT), colTmax = v => mapColor(v, TMAX_LIMIT);
function legend(title, lim, unit) {
  const stops = MAP_PALETTE.map((c, i) => `${c} ${100 * i / 6}%`).join(',');
  return `<div class="legend"><span class="legend-title">${esc(title)}</span><div class="legend-scale"><div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="legend-ticks"><span>≤ −${lim}${unit}</span><span>0</span><span>≥ +${lim}${unit}</span></div></div><span class="legend-missing"><i style="background:${NO_ESTIMATE}"></i> No estimate</span></div>`;
}
// ---- routing ----------------------------------------------------------------------------------------------------------
function route() { const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); const parts = path.split('/').filter(Boolean); return { kind: parts[0] || 'world', arg: parts[1], q: new URLSearchParams(q || '') }; }
function link(kind, arg, q) { const s = q ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v]) => v != null))).toString() : ''; return `#/${kind}${arg ? '/' + arg : ''}${s}`; }
window.addEventListener('hashchange', render); window.addEventListener('DOMContentLoaded', init);
async function init() {
  [D.summary, D.countries, D.panels] = await Promise.all([load(BASE + 'summary.json'), load(BASE + 'countries.json'), load(BASE + 'panels.json')]);
  D.byIso = Object.fromEntries(D.countries.map(c => [c.iso3, c]));
  const releaseNote = document.getElementById('release-note');
  if (releaseNote) releaseNote.innerHTML = D.summary.refresh
    ? `<b>Scientific review release · ${esc(D.summary.refresh.published_date)}</b> · ${esc(D.summary.refresh.summary)} <a href="#/methods">Release details</a>`
    : `<b>Archived September issue.</b> Some seasons harvested in 2027 used weather from the preceding year. <a href="?issue=2026-10-06">Open the corrected 6 October release</a>.`;
  document.getElementById('issue-tag').textContent = `issue ${D.summary.issue} · data to ${D.summary.data_end} · index to ${D.summary.index_last_month}`;
  const ban = document.getElementById('issue-banner'); if (ban) ban.innerHTML = `<b>Issue ${esc(D.summary.issue)}</b> · weather to <b>${esc(D.summary.data_end)}</b> · relative Niño 3.4 observed through <b>${esc(D.summary.index_last_month)}</b> (${fmt(D.summary.index_last_rel, 2, true)} °C) · scenarios on the CPC September outlook · <a href="../climate/">Historical relationships: climate & crop atlas</a> · <a href="../global/">Yield atlas</a>`;
  const w = D.summary.world;
  document.getElementById('intro-text').innerHTML = `Issue <b>${esc(D.summary.issue)}</b>: the relative Niño 3.4 index stood at <b>${fmt(D.summary.index_last_rel, 2, true)} °C</b> in ${esc(D.summary.index_last_month)} and the outlook's median peak is a very strong event. Across ${D.summary.counts.countries} countries and ${D.summary.counts.panels} crop seasons, the fitted responses for the 2026–27 harvests imply maize ${pct(w.maize?.pct_medium, 1)}, rice ${pct(w.rice?.pct_medium, 1)}, wheat ${pct(w.wheat?.pct_medium, 1)} and soybean ${pct(w.soybean?.pct_medium, 1)}. Percentages refer to production covered by fitted responses. Weather to ${esc(D.summary.data_end)} has been scored against the El Niño expectation for ${D.summary.counts.panels_scored} seasons.${D.summary.headline && D.summary.headline.panels ? ` Over the ${D.summary.headline.panels} seasons with a usable weather-implied estimate (${fmt(D.summary.headline.production_mt, 0)} Mt in ${D.summary.headline.countries} countries), the season's weather so far implies <b>${pct(D.summary.headline.weather_implied_pct, 1)}</b> of trend where the index alone implied ${pct(D.summary.headline.index_implied_pct, 1)}; a production-weighted mixture of crops, not a global food-supply estimate.` : ''} Pick a country below, or read <a href="#/methods">how to read this</a>.`;
  render();
}
async function render() {
  const r = route(); document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === (r.kind === 'country' ? 'world' : r.kind)));
  document.getElementById('intro').style.display = r.kind === 'world' ? '' : 'none';
  const view = document.getElementById('view'); view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (r.kind === 'country') await renderCountry(view, r.arg, r.q); else if (r.kind === 'table') renderTable(view, r.q); else if (r.kind === 'ledger') await renderLedger(view);
    else if (r.kind === 'methods') renderMethods(view); else if (r.kind === 'downloads') await renderDownloads(view); else await renderWorld(view, r.q);
  } catch (e) { view.innerHTML = `<p class="card">Something did not load: ${esc(e.message)}</p>`; }
  window.scrollTo(0, 0);
}
// ---- world -------------------------------------------------------------------------------------------------------------
async function renderWorld(view, q) {
  const crop = q.get('crop') || 'all';
  const val = c => crop === 'all' ? c.expected.pct_medium : (c.by_crop[crop]?.pct_medium ?? null);
  const mt = c => crop === 'all' ? c.expected.mt_medium : (c.by_crop[crop]?.mt_medium ?? null);
  const rows = D.countries.filter(c => crop === 'all' || c.by_crop[crop]).sort((a, b) => (mt(a) ?? 0) - (mt(b) ?? 0));
  view.innerHTML = `<div class="card"><div class="controls"><label>Crop <select id="crop-sel">${['all', ...CROPS].map(c => `<option value="${c}"${c === crop ? ' selected' : ''}>${c === 'all' ? 'All staples' : cap(c)}</option>`).join('')}</select></label>
      <span class="muted">Map and table: the expected change in the 2026–27 harvests under the outlook's median, as a share of production covered by fitted responses. Click a country.</span></div>
    <div class="row"><div><div id="wmap" class="map tall"></div>${legend('Expected change', WORLD_LIMIT, '%')}</div>
    <div style="max-height:560px;overflow:auto"><table class="t"><thead><tr><th>Country</th><th class="num">Expected %</th><th class="num">Range %</th><th class="num">Mt</th><th>Season so far</th><th class="num">Shocks</th></tr></thead><tbody>
    ${rows.map(c => { const v = val(c); const lo = crop === 'all' && c.production_mt ? 100 * c.expected.mt_low / c.production_mt : null, hi = crop === 'all' && c.production_mt ? 100 * c.expected.mt_high / c.production_mt : null;
      const vc = c.verdict_counts || {}; const seas = Object.keys(vc).length ? Object.entries(vc).map(([k, n]) => `<span class="chip ${k === 'as expected' ? 'blue' : k === 'against expectation' ? 'red' : 'grey'}" title="${esc(k)}">${n} ${k === 'as expected' ? 'as expected' : k === 'against expectation' ? 'against' : k === 'mixed' ? 'mixed' : 'no signal'}</span>`).join('') : `<span class="muted">${c.status_counts['not planted'] ? 'not planted' : '–'}</span>`;
      return `<tr><td><a href="${link('country', c.iso3, { crop: crop === 'all' ? undefined : crop })}">${esc(c.name)}</a>${c.hotspot ? ' <span class="chip orange" title="FAO–WFP hunger hotspot">●</span>' : ''}</td><td class="num" style="color:${v < -3 ? BROWN : v > 3 ? GREEN : 'inherit'}">${pct(v, 1)}</td><td class="num muted">${lo == null ? '' : `${fmt(lo, 0, true)} to ${fmt(hi, 0, true)}`}</td><td class="num">${fmt(mt(c), 2, true)}</td><td>${seas}</td><td class="num">${c.ledger?.count ?? ''}</td></tr>`; }).join('')}
    </tbody></table></div></div></div>`;
  document.getElementById('crop-sel').onchange = e => { location.hash = link('world', null, e.target.value === 'all' ? {} : { crop: e.target.value }); };
  const world = await load(`../global/data/${D.summary.geometry_release}/world.json`);
  const feats = world.features.map(f => ({ ...f, properties: { ...f.properties, v: val(D.byIso[f.properties.country] || { expected: {}, by_crop: {} }), color: colExpected(val(D.byIso[f.properties.country] || { expected: {}, by_crop: {} })) } }));
  drawMap('wmap', { type: 'FeatureCollection', features: feats }, f => { const c = D.byIso[f.properties.country]; return c ? `<b>${esc(c.name)}</b><br>${crop === 'all' ? 'staples' : crop}: ${pct(f.properties.v, 1)} expected · ${fmt(mt(c), 2, true)} Mt` : esc(f.properties.name); }, f => { if (D.byIso[f.properties.country]) location.hash = link('country', f.properties.country, crop === 'all' ? {} : { crop }); }, [[-170, -56], [180, 75]]);
}
// ---- country ------------------------------------------------------------------------------------------------------------
async function renderCountry(view, iso, q) {
  const c = D.byIso[iso]; if (!c) { view.innerHTML = `<p class="card">No country ${esc(iso)} in this issue.</p>`; return; }
  const panels = D.panels.filter(p => p.iso3 === iso); const crops = CROPS.filter(k => panels.some(p => p.crop_family === k));
  const crop = crops.includes(q.get('crop')) ? q.get('crop') : (crops.sort((a, b) => (c.by_crop[b]?.production_mt || 0) - (c.by_crop[a]?.production_mt || 0))[0]);
  const ps = panels.filter(p => p.crop_family === crop).sort((a, b) => (b.production_mt || 0) - (a.production_mt || 0));
  const L = c.ledger; const chips = L ? [L.fert != null ? `<span class="chip ${L.fert >= 15 ? 'orange' : 'grey'}">Gulf nitrogen ${fmt(L.fert, 0)}% of use</span>` : '', L.bsea != null ? `<span class="chip ${L.bsea >= 15 ? 'blue' : 'grey'}">Black Sea grain ${fmt(L.bsea, 0)}% of supply</span>` : '', L.ships != null && L.ships > 0 ? `<span class="chip ${L.ships >= 15 ? 'blue' : 'grey'}">Panama/Hormuz ${fmt(L.ships, 0)}%</span>` : '', L.people != null ? `<span class="chip grey">undernourished ${fmt(L.people, 0)}%</span>` : '', c.hotspot ? '<span class="chip orange">FAO–WFP hotspot</span>' : ''].join('') : '';
  view.innerHTML = `<div class="card"><p class="muted"><a href="#/">Countries</a> › ${esc(c.name)}</p><h2 style="font-size:22px">${esc(c.name)}</h2><p class="verdict">${esc(c.headline)}</p><div class="chips">${chips}</div>
    <div class="tabs">${crops.map(k => `<a href="${link('country', iso, { crop: k })}" class="${k === crop ? 'active' : ''}">${cap(k)} <span class="muted">${fmt(c.by_crop[k]?.production_mt, 1)} Mt</span></a>`).join('')}</div></div>
    ${screen1(ps, iso, crop)}${screen2(ps)}${screen3(ps)}`;
  const units = await load(BASE + `units/${iso}.json`).catch(() => null); const geo = await load(`../global/data/${D.summary.geometry_release}/geometry/${iso}.json.gz`).catch(() => null);
  if (units && geo) {
    const U = units.crops[crop] || {};
    const vals = Object.values(U).filter(u => Number.isFinite(u.e)).map(u => Math.abs(u.e)).sort((a, b) => a - b);
    const q75 = vals.length ? vals[Math.floor(0.75 * (vals.length - 1))] : 0;
    const limE = [1, 2, 3, 5, 7.5, 10].find(l => l >= q75) || 10;
    const colE = v => mapColor(v, limE); const legE = document.getElementById('map1-legend'); if (legE) legE.innerHTML = legend(`Expected change, median path (scale set by this crop's units)`, limE, '%');
    const unitFor = f => U[f.properties.id] || U[f.id];
    // The shared geometry contains multiple sources and a national polygon.
    // Draw the national context first, then only this crop's reporting units.
    const shown = [...geo.features.filter(f => f.properties.level === 'national' && !unitFor(f)), ...geo.features.filter(f => unitFor(f))];
    const build = (key, col) => ({ type: 'FeatureCollection', features: shown.map(f => { const u = unitFor(f) || {}; return { ...f, properties: { ...f.properties, u, color: col(u[key]) } }; }) });
    const tip = f => { const u = typeof f.properties.u === 'string' ? JSON.parse(f.properties.u) : (f.properties.u || {}); return `<b>${esc(u.n || f.properties.name)}</b><br>expected ${pct(u.e, 0)} (${pct(u.lo, 0)} to ${pct(u.hi, 0)})${u.b ? ' · beyond fitted range' : ''}<br>season so far: rain ${pct(u.r, 0)}, TMAX ${fmt(u.t, 1, true)} °C${u.f != null ? ` · ${Math.round(100 * u.f)}% of window` : ''}`; };
    drawMap('map1', build('e', colE), tip); drawMap('map2', build('r', colRain), tip);
    const sel = document.getElementById('map2-var'); if (sel) sel.onchange = () => { drawMap('map2', build(sel.value === 't' ? 't' : 'r', sel.value === 't' ? colTmax : colRain), tip); document.getElementById('map2-legend').innerHTML = sel.value === 't' ? legend('Mean TMAX anomaly', TMAX_LIMIT, ' °C') : legend('Rainfall anomaly', RAIN_LIMIT, '%'); };
  } else { for (const id of ['map1', 'map2']) { const el = document.getElementById(id); if (el) el.innerHTML = '<p class="muted" style="padding:12px">No unit geometry for this country; the table carries the numbers.</p>'; } }
}
const statusChip = p => `<span class="chip ${p.status === 'harvested' ? 'ink' : p.status === 'in the ground' ? 'blue' : 'grey'}" title="${esc(p.status_note || '')}">${esc(p.status)}${p.status === 'in the ground' && p.started_share != null && p.started_share < 0.9 ? ` · ${Math.round(100 * p.started_share)}% of output` : ''}${p.frac_elapsed && p.status === 'in the ground' ? ` · ${Math.round(100 * p.frac_elapsed)}% run` : ''}</span>`;
const gradeChip = p => `<span class="grade ${p.expected.grade}" title="${esc(p.expected.grade_note)}">${p.expected.grade}</span>`;
const plabel = p => `${esc(cap(p.crop_code.replace(/_/g, ' ')))}${p.season && !['main', 'Annual', 'annual'].includes(p.season) ? `, ${esc(p.season.toLowerCase())}` : ''}`;
function screen1(ps, iso, crop) {
  const bars = barChart(ps.map(p => ({ label: plabel(p), lo: p.expected.pct_low, mid: p.expected.pct_medium, hi: p.expected.pct_high, note: `${fmt(p.expected.mt_medium, 2, true)} Mt` })), 'Expected change in the 2026–27 harvest (%): median path (dot) and ENSO scenario range (bar, 5th to 95th percentile paths; not a yield prediction interval)');
  return `<div class="card"><div class="screen-head"><span class="n">1</span><h2>What usually happens here in an El Niño of the forecast strength</h2></div>
    <p class="muted">The yield response fitted on 1981–2025 to the relative Niño 3.4 index over each season's window, applied to the index path of the Climate Prediction Center's September outlook. The range is the ENSO scenario range, the outlook's 5th to 95th percentile paths through the same fit; it carries no regression uncertainty and no unexplained yield variation, so it is not a yield prediction interval. The letter is an evidence checklist (A: four conditions met, D: one or none): 25 years of record, a slope distinguishable from zero at 10 percent, 10 reporting units, and a forecast inside the fitted range for at least half of production. It is not a calibrated reliability score.</p>
    <div class="row"><div>${ps.map(p => `<div class="panel-block"><div class="chips">${gradeChip(p)} <b>${plabel(p)}</b> ${statusChip(p)} <span class="chip grey">${fmt(p.production_mt, 1)} Mt</span></div><p class="verdict">${esc(p.sentences.expected)}</p></div>`).join('')}${bars}</div>
    <div><div id="map1" class="map"></div><div id="map1-legend">${legend('Expected change, median path', WORLD_LIMIT, '%')}</div></div></div></div>`;
}
function screen2(ps) {
  const rows = ps.filter(p => p.season_so_far).map(p => { const s = p.season_so_far; return `<tr><td>${plabel(p)}</td><td class="num">${pct(s.rain_obs_pct, 0)}</td><td class="num muted">${pct(s.rain_exp_pct, 0)}</td><td class="num">${s.rain_percentile == null ? '–' : Math.round(100 * s.rain_percentile)}</td><td class="num">${fmt(s.tmax_obs, 1, true)}</td><td class="num muted">${fmt(s.tmax_exp, 1, true)}</td><td class="num">${s.tmax_percentile == null ? '–' : Math.round(100 * s.tmax_percentile)}</td><td>${verdictChip(s.verdict)}</td></tr>`; }).join('');
  return `<div class="card"><div class="screen-head"><span class="n">2</span><h2>What has happened this season so far</h2></div>
    <p class="muted">Season-to-date rainfall and temperature over each season's window to ${esc(D.summary.data_end)}, against the series' own 1981–2025 reference for the same days, and against what the fitted El Niño response expected given the index observed so far. Percentile: where this year sits in the distribution the expectation leaves.</p>
    <div class="row"><div>${ps.map(p => `<div class="panel-block"><div class="chips"><b>${plabel(p)}</b> ${statusChip(p)} ${p.season_so_far ? verdictChip(p.season_so_far.verdict) : ''}</div><p class="verdict">${esc(p.sentences.season)}</p></div>`).join('')}
      ${rows ? `<table class="t small"><thead><tr><th>Season</th><th class="num">Rain</th><th class="num">expected</th><th class="num">pctile</th><th class="num">TMAX °C</th><th class="num">expected</th><th class="num">pctile</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>` : ''}</div>
    <div><div class="controls"><label>Map <select id="map2-var"><option value="r">Rainfall, percent of reference</option><option value="t">Mean TMAX, °C above reference</option></select></label></div><div id="map2" class="map"></div><div id="map2-legend">${legend('Rainfall anomaly', RAIN_LIMIT, '%')}</div></div></div></div>`;
}
function screen3(ps) {
  const items = ps.filter(p => p.implied.usable).map(p => ({ label: plabel(p), now: p.implied.nowcast_pct, se: p.implied.nowcast_se_pct, idx: p.implied.index_medium_pct, obs: p.implied.index_observed_pct }));
  const skillRows = ps.filter(p => p.hindcast).map(p => `<tr><td>${plabel(p)}</td><td class="num">${p.hindcast.years ?? '–'}</td><td class="num">${fmt(p.hindcast.rmse_trend_pct, 1)}</td><td class="num">${fmt(p.hindcast.rmse_weather_pct, 1)}</td><td class="num" style="color:${p.hindcast.skill_vs_trend > 0 ? '#1f6f3f' : RED}">${fmt(p.hindcast.skill_vs_trend, 2, true)}</td><td class="num">${fmt(p.hindcast.skill_enso_vs_trend, 2, true)}</td><td class="num">${fmt(p.hindcast.skill_vs_enso, 2, true)}</td><td class="num">${fmt(p.hindcast.skill_block, 2, true)}</td><td class="num">${fmt(p.hindcast.corr, 2)}</td></tr>`).join('');
  return `<div class="card"><div class="screen-head"><span class="n">3</span><h2>What that implies for the harvest</h2></div>
    <p class="muted">For seasons at least half run, the yield anomaly implied by the season's weather so far (a second regression of detrended yield on the season-to-date metrics, 1981–2025), beside the index-implied median scenario. The ± is one standard error of the regression estimate from the coefficient covariance; it does not include unexplained yield variation, so it is not a prediction interval. An estimate is shown only where a leave-one-year-out hindcast at the same fraction of the season beat the trend-only baseline; the skill scores are printed with each season. Seasons not yet planted carry the index alone.</p>
    ${ps.map(p => `<div class="panel-block"><div class="chips"><b>${plabel(p)}</b> ${statusChip(p)}</div><p class="verdict">${esc(p.sentences.implied)}</p></div>`).join('')}
    ${items.length ? dotChart(items) : ''}
    ${skillRows ? `<h3>Hindcast at this fraction of the season</h3><p class="muted">Leave-one-year-out over 1981–2025: each past year predicted from the others with the detrending and coefficients refitted. Skill is one minus the ratio of mean squared errors to the trend-only baseline; the block column holds out the neighbouring years too. RMSE in percent of trend.</p><table class="t small"><thead><tr><th>Season</th><th class="num">Years</th><th class="num">RMSE trend</th><th class="num">RMSE weather</th><th class="num">Skill vs trend</th><th class="num">Index-only skill</th><th class="num">Weather vs index</th><th class="num">Block</th><th class="num">r</th></tr></thead><tbody>${skillRows}</tbody></table>` : ''}</div>`;
}
const verdictChip = v => v ? `<span class="chip ${v === 'as expected' ? 'blue' : v === 'against expectation' ? 'red' : 'grey'}">${esc(v)}</span>` : '';
// ---- charts (inline SVG) -------------------------------------------------------------------------------------------------
function barChart(items, title) {
  if (!items.length) return ''; const W = 560, rowH = 26, left = 190, right = 70, top = 28; const H = top + rowH * items.length + 30;
  const lim = Math.max(10, ...items.flatMap(i => [Math.abs(i.lo || 0), Math.abs(i.hi || 0), Math.abs(i.mid || 0)])) * 1.1; const x = v => left + (W - left - right) * (0.5 + v / (2 * lim));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim].map(v => Math.round(v));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><text x="0" y="14" font-size="12" fill="#52514e">${esc(title)}</text>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 24}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${x(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#898781">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
    ${items.map((it, i) => { const y = top + rowH * i + rowH / 2; const col = it.mid < 0 ? BROWN : GREEN; return `<text x="${left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#0b0b0b">${esc(it.label)}</text>
      ${it.lo != null && it.hi != null ? `<line x1="${x(it.lo)}" x2="${x(it.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>` : ''}
      ${it.mid != null ? `<circle cx="${x(it.mid)}" cy="${y}" r="5" fill="${col}"/>` : ''}<text x="${W - right + 6}" y="${y + 4}" font-size="11" fill="#52514e">${esc(it.note)}</text>`; }).join('')}</svg>`;
}
function dotChart(items) {
  const W = 560, rowH = 26, left = 190, right = 20, top = 62; const H = top + rowH * items.length + 30;
  const lim = Math.max(10, ...items.flatMap(i => [Math.abs(i.now) + 2 * (i.se || 0), Math.abs(i.idx || 0)])) * 1.1; const x = v => left + (W - left - right) * (0.5 + v / (2 * lim));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim].map(v => Math.round(v));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weather-implied and index-implied yield anomalies"><text x="0" y="14" font-size="12" fill="#52514e">Yield anomaly, percent of trend</text>
    <circle cx="8" cy="30" r="5" fill="#0b0b0b"/><text x="18" y="34" font-size="11" fill="#52514e">weather so far (bar: ±2 standard errors of the regression estimate, not a prediction interval)</text>
    <circle cx="8" cy="50" r="5" fill="none" stroke="${ORANGE}" stroke-width="2"/><text x="18" y="54" font-size="11" fill="#52514e">index alone, median scenario</text><line x1="230" x2="230" y1="44" y2="56" stroke="${BLUE}" stroke-width="2"/><text x="238" y="54" font-size="11" fill="#52514e">direct slope × index observed so far</text>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 24}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${x(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#898781">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
    ${items.map((it, i) => { const y = top + rowH * i + rowH / 2; return `<text x="${left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#0b0b0b">${esc(it.label)}</text><line x1="${x(it.now - 2 * it.se)}" x2="${x(it.now + 2 * it.se)}" y1="${y}" y2="${y}" stroke="#c3c2b7" stroke-width="2"/>
      ${it.obs != null ? `<line x1="${x(it.obs)}" x2="${x(it.obs)}" y1="${y - 7}" y2="${y + 7}" stroke="${BLUE}" stroke-width="2"/>` : ''}${it.idx != null ? `<circle cx="${x(it.idx)}" cy="${y}" r="5" fill="none" stroke="${ORANGE}" stroke-width="2"/>` : ''}<circle cx="${x(it.now)}" cy="${y}" r="5" fill="#0b0b0b"/>`; }).join('')}</svg>`;
}
// ---- maps (MapLibre, no basemap) ----------------------------------------------------------------------------------------------
const maps = {};
function drawMap(id, fc, tipFn, clickFn, fit) {
  const el = document.getElementById(id); if (!el || !window.maplibregl) return;
  if (maps[id]) { try { maps[id].remove(); } catch (e) { /* ignore */ } delete maps[id]; }
  const map = new maplibregl.Map({ container: id, style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f3f2ef' } }] }, attributionControl: false, interactive: true, renderWorldCopies: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('load', () => {
    map.addSource('u', { type: 'geojson', data: fc }); map.addLayer({ id: 'u-fill', type: 'fill', source: 'u', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.95 } }); map.addLayer({ id: 'u-line', type: 'line', source: 'u', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.15, 6, 0.6], 'line-opacity': 0.6 } });
    const b = fit || bounds(fc); if (b) map.fitBounds(b, { padding: 20, duration: 0, maxZoom: 7 });
    const tip = document.createElement('div'); tip.className = 'tooltip'; tip.style.display = 'none'; el.appendChild(tip);
    map.on('mousemove', 'u-fill', e => { const f = e.features[0]; tip.innerHTML = tipFn(f); tip.style.display = ''; tip.style.left = (e.point.x + 12) + 'px'; tip.style.top = (e.point.y + 12) + 'px'; map.getCanvas().style.cursor = clickFn ? 'pointer' : ''; });
    map.on('mouseleave', 'u-fill', () => { tip.style.display = 'none'; map.getCanvas().style.cursor = ''; });
    if (clickFn) map.on('click', 'u-fill', e => clickFn(e.features[0]));
  });
  maps[id] = map;
}
function bounds(fc) { let w = 180, s = 90, e = -180, n = -90, any = false; const walk = c => { if (typeof c[0] === 'number') { any = true; w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); }; fc.features.forEach(f => f.geometry && walk(f.geometry.coordinates)); return any ? [[w, s], [e, n]] : null; }
// ---- all seasons table -----------------------------------------------------------------------------------------------------
function renderTable(view, q) {
  const crop = q.get('crop') || 'all', status = q.get('status') || 'all', minmt = parseFloat(q.get('min') || '1');
  const rows = D.panels.filter(p => (crop === 'all' || p.crop_family === crop) && (status === 'all' || p.status === status) && (p.production_mt || 0) >= minmt).sort((a, b) => (a.expected.mt_medium ?? 0) - (b.expected.mt_medium ?? 0));
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  view.innerHTML = `<div class="card"><h2>Every crop season in the 2026–27 horizon</h2><div class="controls"><label>Crop ${sel('t-crop', [['all', 'All'], ...CROPS.map(c => [c, cap(c)])], crop)}</label><label>Status ${sel('t-status', [['all', 'All'], ['harvested', 'Harvested'], ['in the ground', 'In the ground'], ['not planted', 'Not planted']], status)}</label><label>Minimum production ${sel('t-min', [['0', 'any'], ['1', '1 Mt'], ['5', '5 Mt'], ['20', '20 Mt']], String(minmt))}</label><span class="muted">${rows.length} seasons, sorted by expected change in tonnes</span></div>
    <div style="overflow:auto"><table class="t small"><thead><tr><th>Country</th><th>Crop, season</th><th>Status</th><th class="num">Production Mt</th><th class="num">Expected %</th><th class="num">Range %</th><th class="num">Mt</th><th>Grade</th><th class="num">Rain so far %</th><th class="num">TMAX so far °C</th><th>Verdict</th><th class="num">Weather-implied % (± 1 s.e.)</th></tr></thead><tbody>
    ${rows.map(p => { const s = p.season_so_far || {}; return `<tr><td><a href="${link('country', p.iso3, { crop: p.crop_family })}">${esc(p.country)}</a></td><td>${plabel(p)}</td><td>${statusChip(p)}</td><td class="num">${fmt(p.production_mt, 1)}</td><td class="num" style="color:${p.expected.pct_medium < -3 ? BROWN : p.expected.pct_medium > 3 ? GREEN : 'inherit'}">${pct(p.expected.pct_medium, 1)}</td><td class="num muted">${p.expected.pct_low == null ? '' : `${fmt(p.expected.pct_low, 0, true)} to ${fmt(p.expected.pct_high, 0, true)}`}</td><td class="num">${fmt(p.expected.mt_medium, 2, true)}</td><td>${gradeChip(p)}</td><td class="num">${pct(s.rain_obs_pct, 0)}</td><td class="num">${fmt(s.tmax_obs, 1, true)}</td><td>${verdictChip(s.verdict)}</td><td class="num">${p.implied.usable ? `${fmt(p.implied.nowcast_pct, 1, true)} ± ${fmt(p.implied.nowcast_se_pct, 1)}` : '–'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  for (const [id, key] of [['t-crop', 'crop'], ['t-status', 'status'], ['t-min', 'min']]) document.getElementById(id).onchange = e => { const o = Object.fromEntries(q); o[key] = e.target.value; location.hash = link('table', null, o); };
}
// ---- ledger -------------------------------------------------------------------------------------------------------------------
async function renderLedger(view) {
  const L = await load(BASE + 'ledger.json'); const rows = L.filter(r => r.count != null && ((r.pop ?? 0) >= 10 || r.hotspot || ['USA', 'ARG', 'BRA', 'RUS', 'UKR'].includes(r.iso3))).sort((a, b) => (b.count - a.count) || ((a.enso ?? 0) - (b.enso ?? 0)));
  const cell = (v, lim, col, thr) => v == null ? '<td class="num muted">–</td>' : `<td class="num" style="background:${mix('#ffffff', col, Math.min(1, Math.abs(v) / lim))};color:${Math.abs(v) / lim > 0.6 ? '#fff' : '#0b0b0b'};${thr && Math.abs(v) >= thr ? 'outline:1.5px solid #0b0b0b;outline-offset:-1.5px' : ''}">${fmt(v, 0)}</td>`;
  view.innerHTML = `<div class="card"><h2>Where the El Niño loss meets the other shocks</h2><p class="muted">One row per country of at least ten million people, plus every FAO–WFP hunger hotspot and the five exporters, one column per shock, each on its own scale: the medium-scenario El Niño change in staple output; Gulf nitrogen as a share of nitrogen use; Russian and Ukrainian wheat and maize as a share of supply; staple trade through the Panama Canal or Hormuz; the prevalence of undernourishment. Outlined cells exceed the thresholds (a 3 percent loss; 15 percent for the trade columns); the count sorts the rows. ° marks an El Niño estimate whose fitted staples cover under half of cereal output. Sources: this work; FAOSTAT and UN Comtrade 2021–2024; FAO–WFP hotspots.</p>
    <div style="overflow:auto"><table class="t small"><thead><tr><th>Country</th><th class="num">El Niño %</th><th class="num">Gulf N %</th><th class="num">Black Sea %</th><th class="num">Ships %</th><th class="num">Undernourished %</th><th class="num">Count</th><th class="num">Pop. M</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.name)}${r.hotspot ? ' <span class="chip orange">●</span>' : ''}</td>${r.enso == null ? '<td class="num muted">–</td>' : `<td class="num" style="background:${r.enso_partial ? '#fff' : diverging(r.enso, 25, RED, BLUE)};${!r.enso_partial && r.enso <= -3 ? 'outline:1.5px solid #0b0b0b;outline-offset:-1.5px' : ''};color:${r.enso_partial ? '#898781' : '#0b0b0b'}">${fmt(r.enso, 0, true)}${r.enso_partial ? '°' : ''}</td>`}${cell(r.fert, 60, ORANGE, 15)}${cell(r.bsea, 60, BLUE, 15)}${r.ships_kind === 'Black Sea corridor' ? `<td class="num" style="background:#1baf7a;color:#fff">corridor</td>` : cell(r.ships, 60, '#1baf7a', 15)}${cell(r.people, 40, '#7a7873')}<td class="num"><b>${r.count}</b></td><td class="num muted">${fmt(r.pop, 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
// ---- methods ------------------------------------------------------------------------------------------------------------------
function renderMethods(view) {
  view.innerHTML = `<div class="card prose"><h2>How to read this</h2>
  ${D.summary.refresh ? `<h3>Update ${esc(D.summary.refresh.published_date)}</h3><p>${esc(D.summary.refresh.summary)}</p><ul>${D.summary.refresh.changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>Temperature source through ${esc(D.summary.refresh.temperature_source_end)}; rainfall and matched crop-season analysis through ${esc(D.summary.data_end)}; ENSO observations through ${esc(D.summary.index_last_month)}; official outlook issued ${esc(D.summary.refresh.outlook_date)}. <a href="?issue=2026-09">September archive</a> · <a href="data/${esc(ISSUE)}/changes.json">Changes in individual crop seasons</a></p>` : ''}
  <p>The Watch answers three questions for every country, crop and season in the 2026–27 harvests, in the order a reader needs them. <b>What usually happens here</b> is the yield response to El Niño fitted on 1981–2025 and applied to the index path of the Climate Prediction Center's current outlook. <b>What has happened this season so far</b> is the rainfall and temperature over the part of each season that has run, set against the series' own history and against what the fitted response expected. <b>What that implies for the harvest</b> is the yield anomaly the season's weather so far implies, beside the index-implied one. All three are associations and scenarios fitted to past seasons, not forecasts of yields, and the intervals and grades say how far to trust each.</p>
  <h2>The database</h2><p>Yields come from HarvestStat Asia on stable boundaries (to 2025), the Hultgren et al. (2025) subnational panels extended with USDA NASS (to 2025), and FAOSTAT national series (to 2024): 1.79 million observations on 14,750 reporting units, each with a growing-season calendar. The database, its exports and its change log are described in the working paper and its repository.</p>
  <h2>The index and the scenarios</h2><p>The response is fitted to the relative Niño 3.4 index (Niño 3.4 minus the tropical mean), the index the Climate Prediction Center forecasts, averaged over each season's calendar window. The scenario paths join the observed index to the 2015–16 event's monthly shape scaled so the December–February mean equals the outlook's 5th, 50th and 95th percentiles (1.48, 2.27 and 3.06 in RONI, divided by 1.18 to the relative index). The 95th percentile lies beyond the fitted range for most seasons, and the grade says when.</p>
  <h2>Screen 1: the expected change</h2>${D.summary.coverage ? `<p>${esc(D.summary.coverage.definition)}</p>` : ""}<p>For each country, crop and season we fit a common slope on the within-unit variation (unit intercepts and trends removed), with standard errors clustered by harvest year. Each subnational series uses its state's partially pooled slope, falling back to the country panel; national-only countries use a national fit. We convert the fitted log-yield change to a percentage using 100 × [exp(slope × exposure) − 1], then aggregate with production weights. The range shown with it is the ENSO scenario range: the same fit evaluated on the outlook's 5th and 95th percentile index paths. It is not a yield prediction interval, because it carries neither the regression uncertainty of the slope nor the yield variation the index does not explain. The letter A to D is an evidence checklist, not a calibrated reliability score; it counts four conditions: at least 25 years of record, a slope distinguishable from zero at 10 percent, at least 10 reporting units (or 40 years of a national series), and a forecast inside the fitted range for at least half of production.</p>
  <h2>Screen 2: the season so far</h2><p>Daily temperature (Berkeley Earth, then CPC adjusted to it) and rainfall (CHIRPS) are averaged over each unit's cropland and summarized over the part of the current window that has run, and over the same calendar days in every year since 1981. The anomaly is the departure from the unit's own mean and trend for those days. The expectation is the panel's regression of that anomaly on the index, applied to the index observed so far; the percentile places this year in the spread that regression leaves. A season is "as expected" when every measure with a visible El Niño signal sits between the 10th and 90th percentiles, "against" when none does, "mixed" otherwise, and "no expected signal" when the regression predicts no anomaly as large as half the year-to-year spread.</p>
  <h2>Screen 3: the implied harvest</h2><p>For seasons at least half run, detrended yield is regressed on the season-to-date measures over 1981–2025 and applied to this year's. The ± printed with each estimate is one standard error from the coefficient covariance (clustered by harvest year); it does not include the yield variation the measures do not explain, so a prediction interval would be wider. Before an estimate is shown, it is tested: every past year is predicted from the other years with the detrending, the within-unit transformation and the coefficients refitted without it, at the same fraction of the season that has run today, and compared with a trend-only baseline (anomaly zero) and with the index-only estimate. Skill is one minus the ratio of mean squared errors to the trend-only baseline. Estimates are shown only where that skill is positive, and the skill table is printed with each season. The models explain a small share of variance for most seasons, so the country rows carry wide intervals and the aggregate over many seasons is the robust statement. Where a measure lies outside its 1981–2025 range the estimate is an extrapolation and is marked.</p>
  <h2>Compound exposure</h2><p>The ledger sets the El Niño change beside three other shocks of 2026: nitrogen from the Gulf after the closure of Hormuz, Black Sea grain after the loss of Russia's export capacity, and staple trade through the Panama Canal and Hormuz, with the prevalence of undernourishment as the measure of who cannot absorb a price rise. Dependence shares are built from FAOSTAT and UN Comtrade for every country; the working paper gives the construction and the reconciliation with published figures.</p>
  <h2>What this is not</h2><p>Not a yield forecast: the fits are associations with the index and with season weather, and the scenarios follow the outlook. Not a food-security assessment: the FAO–WFP hotspots and the FEWS NET and JRC monitors do that, and the ledger links to them rather than replacing them. Not a measure of farm-level conditions: a reporting unit is a district or a state. Where our numbers and the GEOGLAM Crop Monitor's El Niño composites differ, the composite averages past events while the fit scales with the event's strength; where they agree, two methods say the same thing.</p>
  <h2>Issues</h2><p>The Watch is reissued on the Climate Prediction Center's monthly update. Each issue keeps its data release under its own tag (<code>data/${esc(ISSUE)}/</code>) with a manifest of file hashes; the previous issue stays reachable by adding <code>?issue=</code> to the address.</p></div>`;
}
async function renderDownloads(view) {
  const m = await load(BASE + 'manifest.json'); const files = Object.entries(m.files);
  view.innerHTML = `<div class="card prose"><h2>Data for issue ${esc(ISSUE)}</h2><p>Every file behind the pages, with its SHA-256. The unit files carry one record per reporting unit and crop; <code>panels.json</code> carries every country-crop-season with its three screens and sentences; <code>countries.json</code> the country summaries and the ledger row; <code>index_path.json</code> the observed index and the scenario paths.</p>
    <table class="t small"><thead><tr><th>File</th><th class="num">Bytes</th><th>SHA-256</th></tr></thead><tbody>${files.map(([f, v]) => `<tr><td><a href="${BASE + f}">${esc(f)}</a></td><td class="num">${v.bytes.toLocaleString()}</td><td class="muted" style="font-family:monospace;font-size:11px">${v.sha256.slice(0, 16)}…</td></tr>`).join('')}</tbody></table>
    <p>Licences. Our derived files are released under CC BY 4.0. They are built from sources with their own terms, which continue to apply to onward use: HarvestStat Asia (consortium package; the Indian boundaries are redistributed with Geolocet's permission and require attribution), the Hultgren et al. (2025) replication package, FAOSTAT (CC BY 4.0 IGO, with dataset-specific exceptions and FAO's additional terms), Berkeley Earth, CHIRPS, ERA5 (Copernicus licence), NOAA CPC and ERSST (public domain), SPAM 2010 (CC BY), Natural Earth (public domain), UN Comtrade (UN terms). The geometry the maps use is the merged release's and is archived with the data deposit so the Watch can be rebuilt without this site.</p>
    <p>The working paper, the season tracker's issue notes and the database exports (Parquet and CSV, with a manifest) are in the project repository; the database itself (997 MB) and the geometry are in the Zenodo deposit named on the methods page once it is published.</p></div>`;
}
})();
