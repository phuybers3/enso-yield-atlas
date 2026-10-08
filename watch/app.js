/* El Niño Crop Watch: yield estimates and season weather from data/<issue>/. */
(() => {
const LATEST_ISSUE = '2026-10-06';
const PARAMS = new URLSearchParams(location.search);
const ISSUE = PARAMS.get('issue') || LATEST_ISSUE;
const RESPONSE = ISSUE === LATEST_ISSUE ? (PARAMS.get('response') || (PARAMS.has('issue') ? 'pooled' : 'regional-v1')) : 'pooled';
const REGIONAL = `regional/${ISSUE}-v1/`;
const BASE = `data/${ISSUE}/`; const RED = '#e34948', BLUE = '#2a78d6', ORANGE = '#eb6834', GREY = '#898781';
const BROWN = '#7f3b08', GREEN = '#006837', NO_ESTIMATE = '#d5d6d2';
const MAP_PALETTE = [BROWN, '#b36b20', '#dfc27d', '#f5f5ef', '#b2d99c', '#4a9a55', GREEN];
const WEATHER_PALETTE = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'];
const WORLD_LIMIT = 10, RAIN_LIMIT = 30, TMAX_LIMIT = 1.5;
const cache = new Map(); const D = {}; let renderVersion = 0;
const VIEWS = [['yield', 'Yield outlook'], ['weather', 'Season weather']];
const seasonKey = p => p.crop_code + '|' + p.season;
// Old patterns/yields bookmarks both open the combined yield view.
const selectedView = q => q.get('view') === 'weather' ? 'weather' : 'yield';
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
function mapColor(v, lim, palette = MAP_PALETTE) {
  if (v == null || !Number.isFinite(v)) return NO_ESTIMATE;
  const x = (Math.max(-1, Math.min(1, v / lim)) + 1) * 3;
  const i = Math.min(5, Math.floor(x));
  return mix(palette[i], palette[i + 1], x - i);
}
const colExpected = v => mapColor(v, WORLD_LIMIT);
// Rainfall reverses sign so wetter and cooler observations share the blue endpoint.
const colRain = v => mapColor(Number.isFinite(v) ? -v : v, RAIN_LIMIT, WEATHER_PALETTE);
const colTmax = v => mapColor(v, TMAX_LIMIT, WEATHER_PALETTE);
function legend(title, lim, unit, palette = MAP_PALETTE, labels = [`≤ −${lim}${unit}`, '0', `≥ +${lim}${unit}`]) {
  const stops = palette.map((c, i) => `${c} ${100 * i / 6}%`).join(',');
  return `<div class="legend"><span class="legend-title">${esc(title)}</span><div class="legend-scale"><div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="legend-ticks"><span>${esc(labels[0])}</span><span>${esc(labels[1])}</span><span>${esc(labels[2])}</span></div></div><span class="legend-missing"><i style="background:${NO_ESTIMATE}"></i> No estimate</span></div>`;
}
function weatherLegend(k) {
  return k === 't'
    ? legend('Daily maximum temperature anomaly', TMAX_LIMIT, ' °C', WEATHER_PALETTE, [`≤ −${TMAX_LIMIT} °C · cooler`, '0', `≥ +${TMAX_LIMIT} °C · warmer`])
    : legend('Rainfall anomaly', RAIN_LIMIT, '%', WEATHER_PALETTE, [`≥ +${RAIN_LIMIT}% · wetter`, '0', `≤ −${RAIN_LIMIT}% · drier`]);
}
// ---- routing ----------------------------------------------------------------------------------------------------------
function route() { const h = location.hash.replace(/^#\/?/, ''); const [path, q] = h.split('?'); const parts = path.split('/').filter(Boolean); return { kind: parts[0] || 'world', arg: parts[1], q: new URLSearchParams(q || '') }; }
function link(kind, arg, q) { const s = q ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([,v]) => v != null))).toString() : ''; return `#/${kind}${arg ? '/' + arg : ''}${s}`; }
window.addEventListener('hashchange', render); window.addEventListener('DOMContentLoaded', () => init().catch(e => { document.getElementById('view').innerHTML = `<p class="card">Could not load this issue: ${esc(e.message)}. <a href="https://phuybers3.github.io/enso-yield-atlas/watch/">Open the published dashboard</a>.</p>`; }));
async function init() {
  [D.summary, D.countries, D.panels] = await Promise.all([load(BASE + 'summary.json'), load(BASE + 'countries.json'), load(BASE + 'panels.json')]);
  D.byIso = Object.fromEntries(D.countries.map(c => [c.iso3, c]));
  const releaseNote = document.getElementById('release-note');
  if (releaseNote) releaseNote.innerHTML = D.summary.refresh
    ? `<b>Scientific review release · ${esc(D.summary.refresh.published_date)}</b> · ${esc(D.summary.refresh.summary)} The October 7 interface adds season-specific maps, calendar review flags and country summaries calculated before rounding tonnes. <a href="#/methods">Release details</a>`
    : `<b>Archived September issue.</b> Some seasons harvested in 2027 used weather from the preceding year. <a href="?issue=2026-10-06">Open the corrected 6 October release</a>.`;
  document.getElementById('issue-tag').textContent = `issue ${D.summary.issue} · data to ${D.summary.data_end} · index to ${D.summary.index_last_month}`;
  const ban = document.getElementById('issue-banner'); if (ban) ban.innerHTML = `<b>Issue ${esc(D.summary.issue)}</b> · weather to <b>${esc(D.summary.data_end)}</b> · relative Niño 3.4 observed through <b>${esc(D.summary.index_last_month)}</b> (${fmt(D.summary.index_last_rel, 2, true)} °C) · scenarios on the CPC September outlook`;
  D.context = ISSUE === LATEST_ISSUE ? await load('context/2026-10-07.json') : null;
  if(!['pooled','regional-v1'].includes(RESPONSE))throw new Error('Unknown response model');
  D.mapNotes = ISSUE === '2026-10-06' && RESPONSE === 'pooled' ? await load('context/map-notes-2026-10-06.json') : null;
  if(RESPONSE === 'regional-v1') {
    D.regional = await load(REGIONAL+'model.json');
    const panelByKey = new Map(D.regional.panels.map(p=>[p.iso3+'|'+seasonKey(p),p]));
    for(const p of D.panels){p.expected=panelByKey.get(p.iso3+'|'+seasonKey(p)).expected;p.implied.index_medium_pct=p.expected.pct_medium;}
    for(const c of D.regional.countries)Object.assign(D.byIso[c.iso3],c);
    D.context.rows=D.regional.rows;
    if(releaseNote)releaseNote.innerHTML=`<b>Regional response model · scientific review</b> · Local fits retain spatial differences, with unpooled state/province fallbacks. Weather cutoff and ENSO paths are unchanged. <a href="#/methods">Methods and comparison with the pooled release</a>`;
  }
  document.getElementById('issue-tag').textContent += D.regional ? ' · local / regional fits' : ' · pooled fits';
  document.getElementById('intro-text').innerHTML = `El Niño Crop Watch explores how the 2026–27 El Niño may affect major food crops. Choose a crop and country to compare <b>yield estimates</b> from the ENSO outlook and observed weather, or explore <b>season weather</b> alongside historical El Niño relationships. The estimates carry uncertainty; they do not measure total harvests or food security.`;

  return render();
}
async function render() {
  const version = ++renderVersion;
  Object.values(maps).forEach(m => m.remove()); Object.keys(maps).forEach(k => delete maps[k]);
  const r = route(), section = {country:'world',table:'world',ledger:'context',downloads:'methods'}[r.kind] || r.kind;
  document.querySelectorAll('.nav a').forEach(a => { const active = a.dataset.route === section; a.classList.toggle('active', active); if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current'); });
  document.getElementById('intro').style.display = r.kind === 'world' ? '' : 'none';
  const view = document.getElementById('view'); view.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (r.kind === 'country') await renderCountry(view, r.arg, r.q, version); else if (r.kind === 'table') renderTable(view, r.q); else if (r.kind === 'ledger') await renderLedger(view);
    else if (r.kind === 'context') renderContext(view); else if (r.kind === 'methods') renderMethods(view); else if (r.kind === 'downloads') await renderDownloads(view); else await renderWorld(view, r.q, version);
  } catch (e) { view.innerHTML = `<p class="card">Something did not load: ${esc(e.message)}</p>`; }
  if (version === renderVersion) { bindControls(r); window.scrollTo(0, 0); }
}
// View, season and issue are encoded in links so a shared page preserves its meaning.
function viewButtons(q) {
  return `<div class="view-buttons" role="group" aria-label="Explore yields or weather">${VIEWS.map(([k,l]) => `<button type="button" data-view="${k}" aria-pressed="${selectedView(q) === k}">${l}</button>`).join('')}</div>`;
}
function shareControls(selection) {
  const url = new URL('https://phuybers3.github.io/enso-yield-atlas/watch/'); url.hash = selection || location.hash || '#/';
  const latest = url.href; url.searchParams.set('issue', ISSUE); url.searchParams.set('response',RESPONSE);
  return `<div class="share"><a id="issue-link" href="${esc(url.href)}" hidden>Link to this issue</a><button type="button" id="copy-link">Copy link to this view</button>${ISSUE!==LATEST_ISSUE?`<a href="${esc(latest)}">Open latest issue</a>`:''}<span id="copy-status" role="status"></span></div>`;
}
function bindControls(r) {
  document.querySelectorAll('[data-view]').forEach(b => { b.onclick = () => { location.hash = link(r.kind, r.arg, {...Object.fromEntries(r.q), view: b.dataset.view}); }; });
  const copy = document.getElementById('copy-link'); if (copy) copy.onclick = async () => {
    const target = document.getElementById('issue-link').href;
    try { await navigator.clipboard.writeText(target); document.getElementById('copy-status').textContent = 'Link copied'; }
    catch { const status = document.getElementById('copy-status'); status.innerHTML = `<label>Select and copy: <input readonly aria-label="Issue link" value="${esc(target)}"></label>`; status.querySelector('input').select(); }
  };
}
function cropRows() {
  if (D.context) return D.context.rows;
  return D.countries.flatMap(c => Object.entries(c.by_crop).map(([crop,a]) => {
    const ps = D.panels.filter(p => p.iso3 === c.iso3 && p.crop_family === crop), w = ps.reduce((a,p) => a+p.production_mt,0);
    return {iso3:c.iso3, country:c.name, crop, years:[...new Set(ps.map(p=>p.target_year))], seasons:ps.map(seasonKey), values:{medium:a.pct_medium, low:w ? 100*ps.reduce((a,p)=>a+p.expected.mt_low,0)/w : null, high:w ? 100*ps.reduce((a,p)=>a+p.expected.mt_high,0)/w : null}, production_mt:w};
  }));
}
function evidenceNotes(row) {
  if(row.response_model)return [`${Math.round(100*row.local_share)}% local fits`,`${Math.round(100*row.uncertain_share)}% with slope interval spanning zero`,row.beyond_share>0?'Some exposures beyond history':'',row.calendar_issues?'Calendar review':''].filter(Boolean).join(' · ');
  return [row.calendar_issues ? 'Calendar review' : '', row.beyond_share > 0 ? `${row.beyond_share<.01?'<1':Math.round(100*row.beyond_share)}% beyond historical exposure` : '', row.weak_evidence ? 'Some responses uncertain' : '', row.national_only ? 'National relationship' : ''].filter(Boolean).join(' · ') || 'See season evidence';
}
function scenarioTable(rows) {
  return `<div class="table-scroll"><table class="t scenario-table"><caption>Yield change relative to the trend / neutral-ENSO baseline. Lower, central and higher describe ENSO strength; these columns are not yield prediction intervals. Negative values indicate losses; positive values indicate gains.</caption><thead><tr><th>Country</th><th>Crop</th><th>Harvest years</th><th class="num">Lower ENSO</th><th class="num">Central</th><th class="num">Higher ENSO</th><th>Evidence / limits</th></tr></thead><tbody>${rows.map(row => `<tr><td><a href="${link('country',row.iso3,{crop:row.crop,season:'all',view:'yield'})}">${esc(row.country)}</a></td><td>${esc(cap(row.crop))}</td><td>${row.years.join(' / ')}</td>${['low','medium','high'].map(k => `<td class="num" style="color:${row.values[k] < 0 ? BROWN : row.values[k] > 0 ? GREEN : 'inherit'}">${pct(row.values[k],1)}</td>`).join('')}<td class="muted">${esc(evidenceNotes(row))}</td></tr>`).join('')}</tbody></table></div>`;
}
async function renderWorld(view, q, version) {
  const crop = ['all',...CROPS].includes(q.get('crop')) ? q.get('crop') : 'all', mode = selectedView(q);
  const rows = cropRows().filter(r => crop === 'all' || r.crop === crop).sort((a,b) => a.country.localeCompare(b.country) || a.crop.localeCompare(b.crop));
  view.innerHTML = `<div class="card"><div class="controls"><label>Crop <select id="crop-sel">${['all',...CROPS].map(c=>`<option value="${c}"${c===crop?' selected':''}>${c==='all'?'All staples':cap(c)}</option>`).join('')}</select></label><span class="muted">Select a country on the map or in a table for growing-season details.</span></div><div class="view-toolbar">${viewButtons(q)}${shareControls(link('world',null,{...Object.fromEntries(q),crop,view:mode}))}</div></div><div id="world-content"></div>`;
  document.getElementById('crop-sel').onchange = e => { location.hash = link('world',null,{...Object.fromEntries(q),crop:e.target.value}); };
  const content = document.getElementById('world-content');
  if (mode === 'yield') {
    const val = c => { const rs=cropRows().filter(r=>r.iso3===c.iso3&&(crop==='all'||r.crop===crop)); const w=rs.reduce((s,r)=>s+r.production_mt,0); return w ? rs.reduce((s,r)=>s+r.values.medium*r.production_mt,0)/w : null; };
    content.innerHTML = `<div class="card"><h2>Yield outlook</h2><p>We estimate yield changes in two ways: from the ENSO outlook and from weather observed so far. Country pages put both estimates side by side. Each uses historical relationships; the two estimates are shown separately, without combining them.</p><h3>From the ENSO outlook · central scenario</h3><p class="muted"> ${crop === 'all' ? 'The map combines covered staples with fixed production weights. The table keeps each crop separate.' : `Map: ${esc(crop)}, all covered seasons combined.`} ${D.regional?'Local and regional fits retain spatial differences.':'Pooled fits.'} Select a country to inspect uncertainty and response geography.</p><div id="wmap" class="map"></div>${legend('Conditional yield change',WORLD_LIMIT,'%')}</div><div class="card"><h2>Conditional yield losses and gains</h2><p class="muted">Issue ${esc(ISSUE)} · ${rows.length} country–crop entries. <a href="${link('table',null,{crop,min:'0'})}">See individual growing seasons</a>${D.context ? ` · <a href="${D.context.bulletin}">${bulletinLabel()}</a>` : ''}</p>${crop==='all'&&D.context?`<h3>${D.regional?'Selected countries and crops':'Selected examples from the bulletin'}</h3>${scenarioTable(D.context.bulletin_selection.map(k=>rows.find(r=>r.iso3+'|'+r.crop===k)))}<details><summary>Browse all ${rows.length} country–crop entries</summary>${scenarioTable(rows)}</details>`:scenarioTable(rows)}<details class="weather-comparison"><summary>Compare ENSO and observed-weather yield estimates by growing season</summary><p class="muted">Both estimates are relative to trend. Weather estimates require at least half the season elapsed and positive historical test skill. ± is one standard error; full yield uncertainty is larger. A dash means no estimate passes the checks.</p>${seasonOverview(D.panels.filter(p=>crop==='all'||p.crop_family===crop).sort((a,b)=>a.country.localeCompare(b.country)||a.label.localeCompare(b.label)),'yield')}</details></div>`;
    const world = await load(`../global/data/${D.summary.geometry_release}/world.json`); if (version !== renderVersion) return;
    const feats = world.features.map(f => { const v=val(D.byIso[f.properties.country] || {expected:{},by_crop:{}}); return {...f,properties:{...f.properties,v,color:colExpected(v)}}; });
    drawMap('wmap',{type:'FeatureCollection',features:feats}, f => `<b>${esc(D.byIso[f.properties.country]?.name || f.properties.name)}</b><br>Conditional yield change: ${pct(f.properties.v,1)}`, f => { if(D.byIso[f.properties.country]) location.hash=link('country',f.properties.country,{crop:crop==='all'?undefined:crop,view:mode}); },[[-170,-56],[180,75]]);
  } else {
    const ps=D.panels.filter(p=>crop==='all'||p.crop_family===crop).sort((a,b)=>a.country.localeCompare(b.country)||a.label.localeCompare(b.label));
    content.innerHTML=`${weatherGuide(crop)}<div class="card"><h2>Observed weather by growing season</h2><p class="muted">Weather through ${esc(D.summary.data_end)}. Rainfall and daily maximum temperature are compared with historical conditions for the same part of the season. Open a country to compare observations with the weather expected from its historical ENSO relationship.</p>${seasonOverview(ps,'weather')}</div>`;
  }
  if(D.context) content.insertAdjacentHTML('beforeend', `<div class="card"><h2>Food-security context</h2><p>Crop yields are one part of food security. <a href="#/context">Compare with the dated FEWS NET assessment and read the timing and methods notes</a>.</p></div>`);
}
function calendarIssue(p) { return D.context?.season_qc[p.iso3]?.[seasonKey(p)]?.calendar_issues > 0; }
function seasonOverview(ps,mode) {
  return `<div class="table-scroll"><table class="t"><thead><tr><th>Country</th><th>Crop / season</th><th>Harvest</th><th>Status</th>${mode==='weather'?'<th class="num">Rain anomaly</th><th class="num">TMAX anomaly</th>':'<th class="num">Central ENSO</th><th class="num">Weather estimate ± SE</th>'}<th>Evidence / availability</th></tr></thead><tbody>${ps.map(p=>{const qc=calendarIssue(p), w=p.season_so_far;return `<tr><td><a href="${link('country',p.iso3,{crop:p.crop_family,season:seasonKey(p),view:mode})}">${esc(p.country)}</a></td><td>${plabel(p)}</td><td>${(D.context?.season_qc[p.iso3]?.[seasonKey(p)]?.years||[p.target_year]).join(' / ')}</td><td>${statusChip(p)}</td>${mode==='weather'?`<td class="num">${qc?'–':pct(w?.rain_obs_pct,1)}</td><td class="num">${qc?'–':fmt(w?.tmax_obs,2,true)+' °C'}</td>`:`<td class="num">${pct(p.expected.pct_medium,1)}</td><td class="num">${!qc&&p.implied.usable?pct(p.implied.nowcast_pct,1)+' ± '+fmt(p.implied.nowcast_se_pct,1):'–'}</td>`}<td>${qc?'Weather withheld: calendar review':p.hindcast?`Historical skill vs trend: ${pct(100*p.hindcast.skill_vs_trend,0)}${p.hindcast.skill_block<0?' · negative skill with adjacent years held out':''}`:p.status==='not planted'?'Season ahead':w?'Weather available; yield test unavailable':'Insufficient matched weather'}${w?.metrics_beyond_range>0?' · weather outside historical range':''}</td></tr>`;}).join('')}</tbody></table></div>`;
}
async function renderCountry(view,iso,q,version) {
  const c=D.byIso[iso]; if(!c){view.innerHTML=`<p class="card">No country ${esc(iso)} in this issue.</p>`;return;}
  const panels=D.panels.filter(p=>p.iso3===iso), crops=CROPS.filter(k=>panels.some(p=>p.crop_family===k)).sort((a,b)=>(c.by_crop[b]?.production_mt||0)-(c.by_crop[a]?.production_mt||0));
  const crop=crops.includes(q.get('crop'))?q.get('crop'):crops[0], mode=selectedView(q);
  const all=panels.filter(p=>p.crop_family===crop).sort((a,b)=>b.production_mt-a.production_mt);
  const key=q.get('season') || seasonKey(all[0]);
  const ps=key==='all'?all:all.filter(p=>seasonKey(p)===key);
  const pack=ISSUE===LATEST_ISSUE?await load(D.regional?`${REGIONAL}countries/${iso}.json`:`season-data/${ISSUE}/${iso}.json`).catch(()=>null):null;
  if(version!==renderVersion)return;
  const selected=pack?.seasons[key];
  const qc=ps.some(p=>pack?.seasons[seasonKey(p)]?.calendar_issues>0);
  const years=[...new Set(ps.flatMap(p=>pack?.seasons[seasonKey(p)]?.years||[p.target_year]))].sort();
  const summaryRows=cropRows().filter(r=>r.iso3===iso&&r.crop===crop);
  view.innerHTML=`<div class="card"><p class="muted"><a href="${link('world',null,{crop,view:mode})}">Countries</a> › ${esc(c.name)}</p><h1>${esc(c.name)} · ${esc(cap(crop))}</h1><div class="tabs" aria-label="Choose crop">${crops.map(k=>`<a href="${link('country',iso,{crop:k,view:mode})}"${k===crop?' aria-current="true" class="active"':''}>${cap(k)}</a>`).join('')}</div><div class="controls"><label>Growing season <select id="season-sel"><option value="all"${key==='all'?' selected':''}>All covered seasons (summary)</option>${all.map(p=>`<option value="${esc(seasonKey(p))}"${seasonKey(p)===key?' selected':''}>${esc(cap(p.crop_code.replace(/_/g,' ')))} · ${esc(p.season)} · harvest ${(pack?.seasons[seasonKey(p)]?.years||[p.target_year]).join(' / ')}</option>`).join('')}</select></label></div><div class="view-toolbar">${viewButtons(q)}${shareControls(link('country',iso,{...Object.fromEntries(q),crop,season:key,view:mode}))}</div><p class="muted">Harvest years: ${years.join(' / ') || 'unknown'}. ${years.length>1?'Local calendars cross different harvest years; map tooltips identify each unit’s dates.':''} </p></div>`;
  document.getElementById('season-sel').onchange=e=>{location.hash=link('country',iso,{...Object.fromEntries(q),crop,season:e.target.value,view:mode});};
  if(!ps.length){view.insertAdjacentHTML('beforeend','<p class="card">This season is unavailable for the selected crop. Choose a growing season above.</p>');return;}
  if(qc)view.insertAdjacentHTML('beforeend','<p class="banner">Calendar review: some tracker windows end after their assigned harvest year. Weather estimates for affected seasons are withheld until those dates are reconciled. The historical ENSO scenario is retained and flagged for review.</p>');
  if(key==='all'&&mode==='yield')view.insertAdjacentHTML('beforeend',`<div class="card"><h2>All covered seasons combined</h2>${scenarioTable(summaryRows)}<p class="muted">Choose one growing season above to map comparable units.</p></div>`);
  view.insertAdjacentHTML('beforeend',mode==='yield'?yieldOutlook(ps,iso,crop):`${weatherGuide(crop,iso)}${qc?'<div class="card"><h2>This season’s weather</h2><p>Weather display withheld pending calendar review.</p></div>':seasonWeather(ps)}`);
  if(D.context)view.insertAdjacentHTML('beforeend',foodContext(iso));
  const ids=mode==='yield'?['map1']:mode==='weather'&&!qc?['map2']:[];
  if(!ids.length)return;
  if(!selected || key==='all') {ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=`<p class="map-note">${key==='all'?'Select one growing season to display its map.':'Season-specific maps are unavailable for this issue. The table carries the estimates.'}</p>`;});return;}
  const geo=await load(`../global/data/${D.summary.geometry_release}/geometry/${iso}.json.gz`).catch(()=>null); if(version!==renderVersion)return;
  if(!geo){ids.forEach(id=>{document.getElementById(id).innerHTML='<p class="map-note">No matching geometry. Use the season table.</p>';});return;}
  const U=selected.units;
  const unitFor=f=>U[f.properties.id]||U[f.id];
  const estimated=geo.features.filter(f=>unitFor(f));
  const shown=[...geo.features.filter(f=>f.properties.level==='national'&&!unitFor(f)),...estimated];
  // National context can cross the date line (USA); frame the selected reporting units.
  const fit=bounds({features:estimated});
  const build=(k,lim)=>({type:'FeatureCollection',features:shown.map(f=>{const u=unitFor(f)||{},v=(k==='r'||k==='t')&&u.calendar_issue?null:u[k];return {...f,properties:{...f.properties,u,color:k==='r'?colRain(v):k==='t'?colTmax(v):mapColor(v,lim)}};})});
  const unitData=f=>typeof f.properties.u==='string'?JSON.parse(f.properties.u):(f.properties.u||{});
  const detail=f=>{const u=unitData(f);return `<b>${esc(u.n||f.properties.name)}</b>${u.s?`<br>${esc(ps[0].season)} · harvest ${u.year}<br>Conditional yield (ENSO scenario): ${pct(u.e,1)} (${pct(u.lo,1)} / ${pct(u.hi,1)}; lower / higher ENSO)${D.regional?`<br>95% fitted-response interval: ${pct(u.ci_lo,1)} to ${pct(u.ci_hi,1)}<br>Sensitivity: ${pct(u.sensitivity,1)} per +1 °C (${pct(u.sensitivity_lo,1)} to ${pct(u.sensitivity_hi,1)})<br>Fit: ${u.fit_n??'unknown'} years${u.fit_first?' · '+u.fit_first+'–'+u.fit_last:''}<br>${u.uncertain?'Slope interval spans zero':'Slope interval excludes zero'}${u.large?'<br>Large fitted response; inspect uncertainty':''}`:''}<br>${u.start?esc(u.start)+' to '+esc(u.end):'Detailed weather calendar unavailable'}<br>Relationship: ${esc((u.response_level||'').replace(/_/g,' '))}${u.region?' · '+esc(u.region):''}${u.b?'<br>Beyond historical exposure':''}${u.calendar_issue?'<br>Calendar review; weather withheld':`<br>Rain ${pct(u.r,1)} · TMAX ${fmt(u.t,2,true)} °C`}`:'<br>No estimate'}`;};
  const tip=f=>{const u=unitData(f),sensitive=q.get('measure')==='sensitivity';return D.regional&&mode==='yield'&&u.s?`<b>${esc(u.n||f.properties.name)}</b><br>${sensitive?'Sensitivity '+pct(u.sensitivity,1)+' per +1 °C':'Conditional yield (ENSO scenario): '+pct(u.e,1)}<br>95% fitted-response interval: ${pct(sensitive?u.sensitivity_lo:u.ci_lo,1)} to ${pct(sensitive?u.sensitivity_hi:u.ci_hi,1)}<br>${esc(u.response_level||'No estimate')}${u.uncertain?' · interval spans zero':''}<br>Click for fit and calendar details`:detail(f);};
  if(mode==='yield'){
    const measure=D.regional&&q.get('measure')==='sensitivity'?'sensitivity':'e';
    const vals=Object.values(U).filter(u=>Number.isFinite(u[measure])).map(u=>Math.abs(u[measure])).sort((a,b)=>a-b);
    const limit=[1,2,3,5,7.5,10].find(l=>l>=(vals[Math.floor(.75*(vals.length-1))]||0))||10;
    const label=measure==='sensitivity'?'Yield sensitivity per +1 °C of growing-season relative Niño 3.4':'Conditional yield change, central scenario';
    document.getElementById('map1-legend').innerHTML=legend(label,limit,'%');
    drawMap('map1',build(measure,limit),tip,D.regional?f=>{const el=document.getElementById('unit-detail');el.hidden=false;el.innerHTML=`<h3>Selected region</h3><p>${detail(f)}</p><p class="muted">Pointwise coefficient uncertainty at fixed ENSO exposure. Full yield uncertainty is larger. ${esc(unitData(f).uncertainty||'')}</p>`;}:null,fit);
    const sel=document.getElementById('map1-var');if(sel){sel.value=measure;sel.onchange=()=>{location.hash=link('country',iso,{...Object.fromEntries(q),crop,season:key,view:mode,measure:sel.value});};}
  }
  if(mode==='weather'){
    const sel=document.getElementById('map2-var');sel.value=q.get('weather')==='t'?'t':'r';
    const t=sel.value==='t';drawMap('map2',build(t?'t':'r',t?TMAX_LIMIT:RAIN_LIMIT),tip,null,fit);document.getElementById('map2-legend').innerHTML=weatherLegend(sel.value);
    sel.onchange=()=>{location.hash=link('country',iso,{...Object.fromEntries(q),crop,season:key,view:mode,weather:sel.value});};
  }
}
function foodContext(iso) {
  const f=D.context.fews, region=f.regions.find(r=>r.countries.includes(iso));
  return `<aside class="card context-box"><h2>Food-security context</h2><p>${esc(f.context)} ${region?esc(region.note):''}</p><p><a href="${f.url}">FEWS NET assessment · ${f.date}</a> · <a href="#/context">Comparison, timing and interpretation</a></p></aside>`;
}
function renderContext(view) {
  if(!D.context){view.innerHTML='<p class="card">This context accompanies the October 6 numerical issue. <a href="?issue=2026-10-06#/context">Open that issue</a>.</p>';return;}
  const f=D.context.fews;
  view.innerHTML=`<div class="card prose"><h1>Crop yields and food-security context</h1><p><a href="${f.url}">${esc(f.title)}</a> · published ${f.date} · context added ${D.context.updated}</p><p>${esc(f.summary)} ${esc(f.context)}</p><h2>From weather to the lean season</h2><ol class="timeline"><li><b>Growing season</b><span>Weather affects crop establishment and development.</span></li><li><b>Harvest</b><span>Yield and harvested area determine production.</span></li><li><b>Lean season</b><span>Stocks, income and market access influence food availability.</span></li></ol><p>${esc(f.timing)} This timing is FEWS NET’s assessment; our crop models do not estimate assistance needs.</p><h2>Historical production and current yield scenarios</h2><p>Different quantities are compared below. Historical production includes changes in harvested area. Crop Watch holds production weights fixed and estimates yield changes under this event’s central ENSO scenario. Agreement is a plausibility check, with shared source data possible.</p><div class="table-scroll"><table class="t"><thead><tr><th>Country / crop</th><th class="num">FEWS NET historical production departure</th><th class="num">Crop Watch conditional yield change</th></tr></thead><tbody>${f.comparison.map(x=>{const r=D.context.rows.find(r=>r.iso3===x.iso3&&r.crop===x.crop);return `<tr><td><a href="${link('country',r.iso3,{crop:r.crop,season:'all'})}">${esc(r.country)} · ${r.crop}</a></td><td class="num">${pct(x.historical_production_pct,1)}</td><td class="num">${pct(r.values.medium,1)}</td></tr>`;}).join('')}</tbody></table></div><p class="muted">FEWS NET Table 1: event-average departures from trend. Crop Watch: ${esc(ISSUE)}, covered growing seasons. The figures use different years, baselines and area assumptions.</p><p><a href="#/ledger">Explore crop losses alongside trade, fertilizer and food-access exposure</a></p><h2>Checks before interpretation</h2><p>We checked scenario aggregation and matched series and weather windows. The archived numerical files remain unchanged. Country summaries now calculate percentages before rounding tonnes, correcting distortion for small crops. Calendar warnings identify windows that require review; affected weather displays are withheld. We retain weak-skill and extrapolation labels. Independent scientific review and a harmonized comparison using the same crop years, trend method and ENSO definition remain pending.</p><p><a href="${D.context.bulletin}">${bulletinLabel()}</a> · <a href="season-data/${ISSUE}/manifest.json">Season-map checks and source hashes</a></p></div>`;
}
const statusChip = p => `<span class="chip ${p.status === 'harvested' ? 'ink' : p.status === 'in the ground' ? 'blue' : 'grey'}" title="${esc(p.status_note || '')}">${esc(p.status)}${p.status === 'in the ground' && p.started_share != null && p.started_share < 0.9 ? ` · ${Math.round(100 * p.started_share)}% of output` : ''}${p.frac_elapsed && p.status === 'in the ground' ? ` · ${Math.round(100 * p.frac_elapsed)}% run` : ''}</span>`;
const gradeChip = p => p.expected.response_model ? `<span class="chip grey">Local / regional fits</span>` : `<span class="grade ${p.expected.grade}" title="${esc(p.expected.grade_note)}">${p.expected.grade}</span>`;
const plabel = p => `${esc(cap(p.crop_code.replace(/_/g, ' ')))}${p.season && !['main', 'Annual', 'annual'].includes(p.season) ? `, ${esc(p.season.toLowerCase())}` : ''}`;
function weatherGuide(crop,iso) {
  const q = new URLSearchParams({mode:'simple',metric:'enso',layer:'precipitation',statistic:'mean',...(crop!=='all'?{crop}:{} )});
  const href = `../climate/#/${iso?'country/'+encodeURIComponent(iso):''}?${q}`;
  return `<div class="card weather-guide"><h2>Season weather</h2><p>Compare rain and temperature observed this season with the weather associated with El Niño in past years.</p><div class="comparison-grid"><section><h3>Observed this season</h3><p>Weather through ${esc(D.summary.data_end)}, measured against historical conditions for the same growing-season days. Country pages also show the anomaly expected from the ENSO index observed so far.</p></section><section><h3>Historical El Niño weather</h3><p>Explore how rainfall and temperature have varied with ENSO across countries and growing seasons.</p><a class="atlas-link" href="${esc(href)}">Explore historical weather relationships ↗</a><p class="muted">Opens the climate atlas${iso?' for '+esc(D.byIso[iso].name):''}${crop!=='all'?' · '+esc(crop):''}, with its own season and scenario controls.</p></section></div></div>`;
}
function weatherYieldReason(p) {
  if(calendarIssue(p))return 'Weather-based yield estimate withheld pending calendar review.';
  if(p.status==='not planted')return 'The growing season is ahead; no weather-based yield estimate is available.';
  return 'No estimate passes the coverage, elapsed-season, uncertainty and historical-skill checks.';
}
function yieldOutlook(ps,iso,crop) {
  const bars=barChart(ps.map(p=>({label:plabel(p),lo:p.expected.pct_low,mid:p.expected.pct_medium,hi:p.expected.pct_high,note:`${fmt(p.expected.mt_medium,2,true)} Mt`})), 'Conditional yield change (%); central scenario and ENSO-strength range');
  return `<div class="card"><h2>Yield outlook</h2><p>Both estimates use historical relationships to estimate yield changes relative to trend. One uses the ENSO outlook; the other uses weather observed so far. We show them separately, without combining them.</p>
    ${ps.map(p=>`<div class="panel-block"><div class="chips"><b>${plabel(p)}</b> ${statusChip(p)}</div><div class="comparison-grid yield-comparison"><section><h3>From the ENSO outlook</h3><p class="estimate">${pct(p.expected.pct_medium,1)}</p><p>Central ENSO scenario · lower ENSO ${pct(p.expected.pct_low,1)}, higher ENSO ${pct(p.expected.pct_high,1)}.</p><p class="muted">${gradeChip(p)} ${esc(p.expected.grade_note)}.${p.expected.beyond_share>0?` ${Math.round(100*p.expected.beyond_share)}% of covered production is beyond historical ENSO exposure.`:''}</p></section><section><h3>From observed weather</h3>${!calendarIssue(p)&&p.implied.usable?`<p class="estimate">${pct(p.implied.nowcast_pct,1)} <span>± ${fmt(p.implied.nowcast_se_pct,1)}</span></p><p>Weather through ${esc(D.summary.data_end)} · ± one standard error, in percentage points.</p><p class="muted">${p.hindcast?.skill_vs_trend<.1?'Historical skill improvement is small. ':''}${p.hindcast?.skill_block<0?'Skill is negative when adjacent years are held out. ':''}${p.season_so_far?.metrics_beyond_range>0?'Some weather measures are outside their historical range.':''}</p>`:`<p class="estimate unavailable">Unavailable</p><p>${esc(weatherYieldReason(p))}</p>`}<a href="${link('country',iso,{crop,season:seasonKey(p),view:'weather'})}">View season weather →</a></section></div></div>`).join('')}
    <p class="muted">Lower and higher ENSO describe event strength, not the full uncertainty in yields. The weather estimate’s standard error also excludes unexplained yield variation. <a href="#/methods">Methods and uncertainty</a>.</p>${yieldEvidence(ps)}</div>
    <div class="card country-map-card"><h2>${D.regional?'Regional yield responses':'Conditional yield change'} within ${esc(D.byIso[iso].name)}</h2><p class="muted">Historical yield relationships applied to the central ENSO scenario. The initial view fits the selected reporting units.</p>${mapInterpretation(ps)}${D.regional?`<div class="controls"><label>Map measure <select id="map1-var"><option value="e">Conditional yield change, central ENSO scenario</option><option value="sensitivity">Yield sensitivity per +1 °C relative Niño 3.4</option></select></label><span class="muted">Click a region for uncertainty and fit details.</span></div>`:''}<div id="map1" class="map country-map"></div><div id="map1-legend">${legend('Conditional yield change, central ENSO scenario',WORLD_LIMIT,'%')}</div><div id="unit-detail" class="unit-detail" aria-live="polite" hidden></div><details class="scenario-detail"><summary>Scenario range and production equivalent</summary>${bars}<p class="muted">Chart: central estimates with bars spanning lower and higher ENSO scenarios. Tonnes use fixed production weights.</p></details></div>`;
}
function modelLink(response) {
  const q=new URLSearchParams({issue:ISSUE,response});
  return '?'+q.toString()+(location.hash||'#/');
}
function bulletinLabel() { return D.regional?'Earlier bulletin · pooled model (PDF)':'Two-page bulletin + methods appendix (PDF)'; }
function mapInterpretation(ps) {
  if(D.regional){const w=ps.reduce((s,p)=>s+p.production_mt,0),share=k=>ps.reduce((s,p)=>s+p.production_mt*p.expected.shares[k],0)/w;
    return `<aside class="map-interpretation"><p><b>Local responses retained.</b> ${fmt(100*share('local'),0)}% of covered production uses the reporting unit’s own fit; ${fmt(100*share('state'),0)}% uses an unpooled state/province fit. Remaining production uses country fits. Local fits require 20 valid years.</p><p>${fmt(100*share('uncertain'),0)}% of production has a 95% slope interval spanning zero. Select a region for its estimate, interval, record length and fallback. ${share('large')>0?'Some fitted changes exceed 50%; inspect their uncertainty and exposure.':''}</p><details><summary>Response model and uncertainty</summary><p>${esc(D.regional.methods.uncertainty)}</p><p>Country totals aggregate these same regional responses. <a href="${modelLink('pooled')}">Compare the earlier pooled model</a> · <a href="#/downloads">Download responses and methods</a></p></details></aside>`;
  }
  const notes=ps.map(p=>D.mapNotes?.panels[`${p.iso3}|${p.crop_code}|${p.season}`]).filter(Boolean);
  return notes.length?notes.map(n=>`<aside class="map-interpretation"><p>${esc(n.summary)}</p><details><summary>Why the common sensitivity?</summary><p>${esc(n.explanation)}</p></details></aside>`).join(''):'<p class="muted">Colors show a conditional yield change, not sensitivity per degree of ENSO. Local boundaries share relationships estimated at state or country level; calendars determine their ENSO exposure.</p>';
}
function seasonWeather(ps) {
  const rows=ps.filter(p=>p.season_so_far).map(p=>{const w=p.season_so_far;return `<tr><td>${plabel(p)}</td><td>Rainfall</td><td class="num">${pct(w.rain_obs_pct,1)}</td><td class="num">${pct(w.rain_exp_pct,1)}</td></tr><tr><td></td><td>Daily maximum temperature</td><td class="num">${fmt(w.tmax_obs,2,true)} °C</td><td class="num">${fmt(w.tmax_exp,2,true)} °C</td></tr>`;}).join('');
  return `<div class="card"><h2>This season’s weather</h2><p class="muted">Rainfall and daily maximum temperature through ${esc(D.summary.data_end)}, compared with historical conditions for the same days of the growing season. Blue means wetter or cooler; red means drier or warmer. White marks zero anomaly. These colors describe weather, not whether conditions benefit crops.</p><div class="country-map-layout"><div>${ps.map(p=>`<div class="panel-block"><div class="chips"><b>${plabel(p)}</b> ${statusChip(p)} ${p.season_so_far?verdictChip(p.season_so_far.verdict):''}</div><p>${p.season_so_far?`Matched weather covers ${fmt(100*p.coverage_share,0)}% of this panel’s production.`:esc(p.status==='not planted'?'The growing season is ahead for most covered production.':'Insufficient matched weather for this season.')}</p></div>`).join('')}
    ${rows?`<div class="table-scroll"><table class="t"><caption>Observed anomalies beside those expected from the historical ENSO relationship, using the index observed so far.</caption><thead><tr><th>Season</th><th>Weather</th><th class="num">Observed</th><th class="num">ENSO expected</th></tr></thead><tbody>${rows}</tbody></table></div><details><summary>How unusual are these observations?</summary><p class="muted">Percentiles place the observations within the historical variation around the ENSO expectation. The middle 80% lies between the 10th and 90th percentiles.</p>${ps.filter(p=>p.season_so_far).map(p=>`<p>${plabel(p)}: rain percentile ${fmt(p.season_so_far.rain_percentile==null?null:100*p.season_so_far.rain_percentile,0)}; temperature percentile ${fmt(p.season_so_far.tmax_percentile==null?null:100*p.season_so_far.tmax_percentile,0)}.</p>`).join('')}</details>`:''}</div><div><div class="controls"><label>Map <select id="map2-var"><option value="r">Rainfall anomaly, %</option><option value="t">Daily maximum temperature anomaly, °C</option></select></label></div><div id="map2" class="map country-map"></div><div id="map2-legend">${weatherLegend('r')}</div></div></div></div>`;
}
function yieldEvidence(ps) {
  const usable=ps.filter(p=>!calendarIssue(p)&&p.implied.usable);
  const items=usable.map(p=>({label:plabel(p),now:p.implied.nowcast_pct,se:p.implied.nowcast_se_pct,idx:p.expected.pct_medium}));
  const tested=ps.filter(p=>p.hindcast&&!calendarIssue(p));
  if(!tested.length&&!items.length)return '';
  return `<details class="yield-evidence"><summary>Uncertainty and performance in historical tests</summary><p class="muted">Weather estimates require at least half the season elapsed and positive historical test skill. The plotted bars show ±2 standard errors of the regression estimate; full yield uncertainty is larger.</p>${items.length?dotChart(items):''}${tested.length?`<p class="muted">In leave-one-year-out tests over 1981–2025, each past year is predicted from the others with trends and coefficients refitted. Positive skill means a smaller mean squared error than the trend-only baseline. The block test also holds out adjacent years. ${D.regional?'These tests describe the unchanged weather model. Predictive skill of the local ENSO responses has not been established.':''}</p><div class="table-scroll"><table class="t"><thead><tr><th>Season</th><th class="num">Years</th><th class="num">RMSE trend, %</th><th class="num">RMSE weather, %</th><th class="num">Skill vs trend</th>${D.regional?'':'<th class="num">ENSO skill</th><th class="num">Weather vs ENSO</th>'}<th class="num">Block skill</th><th class="num">Correlation</th></tr></thead><tbody>${tested.map(p=>`<tr><td>${plabel(p)}</td><td class="num">${p.hindcast.years??'–'}</td>${['rmse_trend_pct','rmse_weather_pct','skill_vs_trend',...(D.regional?[]:['skill_enso_vs_trend','skill_vs_enso']),'skill_block','corr'].map(k=>`<td class="num">${fmt(p.hindcast[k],2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}</details>`;
}
const verdictChip = v => v ? `<span class="chip ${v === 'as expected' ? 'blue' : v === 'against expectation' ? 'red' : 'grey'}">${esc(v)}</span>` : '';
// ---- charts (inline SVG) -------------------------------------------------------------------------------------------------
function barChart(items, title) {
  if (!items.length) return ''; const W = 560, rowH = 26, left = 190, right = 70, top = 28; const H = top + rowH * items.length + 30;
  const lim = Math.max(10, ...items.flatMap(i => [Math.abs(i.lo || 0), Math.abs(i.hi || 0), Math.abs(i.mid || 0)])) * 1.1; const x = v => left + (W - left - right) * (0.5 + v / (2 * lim));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim].map(v => Math.round(v));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}"><text x="0" y="14" font-size="12" fill="#52514e">Conditional yield change (%)</text>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 24}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${x(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#898781">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
    ${items.map((it, i) => { const y = top + rowH * i + rowH / 2; const col = it.mid < 0 ? BROWN : GREEN; return `<text x="${left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#0b0b0b">${esc(it.label)}</text>
      ${it.lo != null && it.hi != null ? `<line x1="${x(it.lo)}" x2="${x(it.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>` : ''}
      ${it.mid != null ? `<circle cx="${x(it.mid)}" cy="${y}" r="5" fill="${col}"/>` : ''}<text x="${W - right + 6}" y="${y + 4}" font-size="11" fill="#52514e">${esc(it.note)}</text>`; }).join('')}</svg>`;
}
function dotChart(items) {
  const W = 560, rowH = 26, left = 190, right = 20, top = 62; const H = top + rowH * items.length + 30;
  const lim = Math.max(10, ...items.flatMap(i => [Math.abs(i.now) + 2 * (i.se || 0), Math.abs(i.idx || 0)])) * 1.1; const x = v => left + (W - left - right) * (0.5 + v / (2 * lim));
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim].map(v => Math.round(v));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yield estimates from observed weather and the ENSO outlook"><text x="0" y="14" font-size="12" fill="#52514e">Yield anomaly, percent of trend</text>
    <circle cx="8" cy="30" r="5" fill="#0b0b0b"/><text x="18" y="34" font-size="11" fill="#52514e">Weather so far (bar: ±2 standard errors; full uncertainty is larger)</text>
    <circle cx="8" cy="50" r="5" fill="none" stroke="${ORANGE}" stroke-width="2"/><text x="18" y="54" font-size="11" fill="#52514e">ENSO outlook, central scenario</text>
    ${ticks.map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - 24}" stroke="${v === 0 ? '#898781' : '#e1e0d9'}"/><text x="${x(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="#898781">${v > 0 ? '+' : ''}${v}%</text>`).join('')}
    ${items.map((it, i) => { const y = top + rowH * i + rowH / 2; return `<text x="${left - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="#0b0b0b">${esc(it.label)}</text><line x1="${x(it.now - 2 * it.se)}" x2="${x(it.now + 2 * it.se)}" y1="${y}" y2="${y}" stroke="#c3c2b7" stroke-width="2"/>
      ${it.idx != null ? `<circle cx="${x(it.idx)}" cy="${y}" r="5" fill="none" stroke="${ORANGE}" stroke-width="2"/>` : ''}<circle cx="${x(it.now)}" cy="${y}" r="5" fill="#0b0b0b"/>`; }).join('')}</svg>`;
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
    map.on('mousemove', 'u-fill', e => { const f = e.features[0]; tip.innerHTML = tipFn(f); tip.style.display = ''; tip.style.left = Math.max(6, Math.min(e.point.x + 12, el.clientWidth - tip.offsetWidth - 6)) + 'px'; tip.style.top = Math.max(6, Math.min(e.point.y + 12, el.clientHeight - tip.offsetHeight - 6)) + 'px'; map.getCanvas().style.cursor = clickFn ? 'pointer' : ''; });
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
  view.innerHTML = `<div class="card"><p class="muted"><a href="${link('world',null,{crop,view:'yield'})}">Back to yield outlook</a></p><h2>Every crop season in the 2026–27 horizon</h2><div class="controls"><label>Crop ${sel('t-crop', [['all', 'All'], ...CROPS.map(c => [c, cap(c)])], crop)}</label><label>Status ${sel('t-status', [['all', 'All'], ['harvested', 'Harvested'], ['in the ground', 'In the ground'], ['not planted', 'Not planted']], status)}</label><label>Minimum production ${sel('t-min', [['0', 'any'], ['1', '1 Mt'], ['5', '5 Mt'], ['20', '20 Mt']], String(minmt))}</label><span class="muted">${rows.length} seasons, sorted by expected change in tonnes</span></div>
    <div style="overflow:auto"><table class="t small"><thead><tr><th>Country</th><th>Crop, season</th><th>Status</th><th class="num">Production Mt</th><th class="num">Expected %</th><th class="num">Range %</th><th class="num">Mt</th><th>${D.regional?'Response model':'Grade'}</th><th class="num">Rain so far %</th><th class="num">TMAX so far °C</th><th>Verdict</th><th class="num">Weather-implied % (± 1 s.e.)</th></tr></thead><tbody>
    ${rows.map(p => { const s = calendarIssue(p) ? {} : (p.season_so_far || {}); return `<tr><td><a href="${link('country', p.iso3, { crop: p.crop_family, season: seasonKey(p) })}">${esc(p.country)}</a></td><td>${plabel(p)}</td><td>${statusChip(p)}</td><td class="num">${fmt(p.production_mt, 1)}</td><td class="num" style="color:${p.expected.pct_medium < -3 ? BROWN : p.expected.pct_medium > 3 ? GREEN : 'inherit'}">${pct(p.expected.pct_medium, 1)}</td><td class="num muted">${p.expected.pct_low == null ? '' : `${fmt(p.expected.pct_low, 0, true)} to ${fmt(p.expected.pct_high, 0, true)}`}</td><td class="num">${fmt(p.expected.mt_medium, 2, true)}</td><td>${gradeChip(p)}</td><td class="num">${pct(s.rain_obs_pct, 0)}</td><td class="num">${fmt(s.tmax_obs, 1, true)}</td><td>${calendarIssue(p)?'Calendar review':verdictChip(s.verdict)}</td><td class="num">${!calendarIssue(p) && p.implied.usable ? `${fmt(p.implied.nowcast_pct, 1, true)} ± ${fmt(p.implied.nowcast_se_pct, 1)}` : '–'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  for (const [id, key] of [['t-crop', 'crop'], ['t-status', 'status'], ['t-min', 'min']]) document.getElementById(id).onchange = e => { const o = Object.fromEntries(q); o[key] = e.target.value; location.hash = link('table', null, o); };
}
// ---- ledger -------------------------------------------------------------------------------------------------------------------
async function renderLedger(view) {
  const L = D.regional ? D.regional.ledger : await load(BASE + 'ledger.json'); const rows = L.filter(r => r.count != null && ((r.pop ?? 0) >= 10 || r.hotspot || ['USA', 'ARG', 'BRA', 'RUS', 'UKR'].includes(r.iso3))).sort((a, b) => (b.count - a.count) || ((a.enso ?? 0) - (b.enso ?? 0)));
  const cell = (v, lim, col, thr) => v == null ? '<td class="num muted">–</td>' : `<td class="num" style="background:${mix('#ffffff', col, Math.min(1, Math.abs(v) / lim))};color:${Math.abs(v) / lim > 0.6 ? '#fff' : '#0b0b0b'};${thr && Math.abs(v) >= thr ? 'outline:1.5px solid #0b0b0b;outline-offset:-1.5px' : ''}">${fmt(v, 0)}</td>`;
  view.innerHTML = `<div class="card"><p class="muted"><a href="#/context">Back to food-security context</a></p><h2>Where the El Niño loss meets the other shocks</h2><p class="muted">One row per country of at least ten million people, plus every FAO–WFP hunger hotspot and the five exporters, one column per shock, each on its own scale: the medium-scenario El Niño change in staple output; Gulf nitrogen as a share of nitrogen use; Russian and Ukrainian wheat and maize as a share of supply; staple trade through the Panama Canal or Hormuz; the prevalence of undernourishment. Outlined cells exceed the thresholds (a 3 percent loss; 15 percent for the trade columns); the count sorts the rows. ° marks an El Niño estimate whose fitted staples cover under half of cereal output. Sources: this work; FAOSTAT and UN Comtrade 2021–2024; FAO–WFP hotspots.</p>
    <div style="overflow:auto"><table class="t small"><thead><tr><th>Country</th><th class="num">El Niño %</th><th class="num">Gulf N %</th><th class="num">Black Sea %</th><th class="num">Ships %</th><th class="num">Undernourished %</th><th class="num">Count</th><th class="num">Pop. M</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.name)}${r.hotspot ? ' <span class="chip orange">●</span>' : ''}</td>${r.enso == null ? '<td class="num muted">–</td>' : `<td class="num" style="background:${r.enso_partial ? '#fff' : diverging(r.enso, 25, RED, BLUE)};${!r.enso_partial && r.enso <= -3 ? 'outline:1.5px solid #0b0b0b;outline-offset:-1.5px' : ''};color:${r.enso_partial ? '#898781' : '#0b0b0b'}">${fmt(r.enso, 0, true)}${r.enso_partial ? '°' : ''}</td>`}${cell(r.fert, 60, ORANGE, 15)}${cell(r.bsea, 60, BLUE, 15)}${r.ships_kind === 'Black Sea corridor' ? `<td class="num" style="background:#1baf7a;color:#fff">corridor</td>` : cell(r.ships, 60, '#1baf7a', 15)}${cell(r.people, 40, '#7a7873')}<td class="num"><b>${r.count}</b></td><td class="num muted">${fmt(r.pop, 0)}</td></tr>`).join('')}</tbody></table></div></div>`;
}
// ---- methods ------------------------------------------------------------------------------------------------------------------
function renderMethods(view) {
  view.innerHTML = `<div class="card prose"><h1>About &amp; data</h1><p><a href="#/downloads">Download issue data</a>${D.context?` · <a href="${D.context.bulletin}">${bulletinLabel()}</a>`:''} · <a href="../global/">Explore historical yield relationships ↗</a></p>
  ${D.summary.refresh ? `<h3>Update ${esc(D.summary.refresh.published_date)}</h3><p>${esc(D.summary.refresh.summary)}</p><ul>${D.summary.refresh.changes.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>Temperature source through ${esc(D.summary.refresh.temperature_source_end)}; rainfall and matched crop-season analysis through ${esc(D.summary.data_end)}; ENSO observations through ${esc(D.summary.index_last_month)}; official outlook issued ${esc(D.summary.refresh.outlook_date)}. <a href="?issue=2026-09">September archive</a> · <a href="data/${esc(ISSUE)}/changes.json">Changes in individual crop seasons</a></p>` : ''}
  <h2>Two views of the same growing season</h2><p><b>Yield outlook</b> brings together estimates from the ENSO outlook and from observed weather. Both apply relationships estimated from historical yields. The ENSO estimate uses a scenario for the index over the growing season; the weather estimate uses rain and temperature observed so far, where coverage and historical tests support an estimate. They are separate conditional estimates, not a combined yield forecast.</p><p><b>Season weather</b> compares observations with historical conditions and the anomalies expected from ENSO. Its historical-weather link opens the climate atlas for further exploration. Crop Watch retains the selected crop and growing season when switching between yield and weather views.</p><p>“Fitted response” in the downloadable files means an estimated historical relationship. We apply those relationships to the ENSO scenarios or to observed weather; unexplained yield variation and changes in the relationships remain sources of uncertainty.</p>
  <h2>The database</h2><p>Yields come from HarvestStat Asia on stable boundaries (to 2025), the Hultgren et al. (2025) subnational panels extended with USDA NASS (to 2025), and FAOSTAT national series (to 2024): 1.79 million observations on 14,750 reporting units, each with a growing-season calendar. The database, its exports and its change log are described in the working paper and its repository.</p>
  <h2>The index and the scenarios</h2><p>The response is fitted to the relative Niño 3.4 index (Niño 3.4 minus the tropical mean), averaged over each season's calendar window. We convert the Climate Prediction Center's variance-rescaled RONI outlook to this relative index. The scenario paths join the observed index to the 2015–16 event's monthly shape scaled so the December–February mean equals the outlook's 5th, 50th and 95th percentiles (1.48, 2.27 and 3.06 in RONI, divided by 1.18 to the relative index). The higher scenario can exceed historical exposure; the tables and maps carry exposure-range flags.</p>
  ${D.regional?`<h2>Local and regional response model</h2><p>${esc(D.regional.methods.description)}</p><p>${esc(D.regional.methods.fit_period)}</p><p>${esc(D.regional.methods.uncertainty)}</p><p>${esc(D.regional.methods.aggregation)}</p><p>${esc(D.regional.methods.limitations)}</p><p><a href="${modelLink('pooled')}">Open the earlier pooled model</a> · <a href="${REGIONAL}manifest.json">Regional model manifest</a></p>`:ISSUE===LATEST_ISSUE?`<p><a href="${modelLink('regional-v1')}">Explore the local and regional response model</a></p>`:''}
  <h2>${D.regional?'Earlier pooled model (comparison archive)':'Yield estimates from the ENSO outlook'}</h2>${D.summary.coverage ? `<p>${esc(D.summary.coverage.definition)}</p>` : ""}<p>For each country, crop and season we fit a common slope on the within-unit variation (unit intercepts and trends removed), with standard errors clustered by harvest year. Each subnational series uses its state's partially pooled slope, falling back to the country panel; national-only countries use a national fit. We convert the fitted log-yield change to a percentage using 100 × [exp(slope × exposure) − 1], then aggregate with production weights. The range shown with it is the ENSO scenario range: the same fit evaluated on the outlook's 5th and 95th percentile index paths. It is not a yield prediction interval, because it carries neither the regression uncertainty of the slope nor the yield variation the index does not explain. The letter A to D is an evidence checklist, not a calibrated reliability score; it counts four conditions: at least 25 years of record, a slope distinguishable from zero at 10 percent, at least 10 reporting units (or 40 years of a national series), and a forecast inside the fitted range for at least half of production.</p>
  <h2>Observed and ENSO-expected weather</h2><p>Daily temperature (Berkeley Earth, then CPC adjusted to it) and rainfall (CHIRPS) are averaged over each unit's cropland and summarized over the part of the current window that has run, and over the same calendar days in every year since 1981. The anomaly is the departure from the unit's own mean and trend for those days. The expectation is the panel's regression of that anomaly on the index, applied to the index observed so far; the percentile places this year in the spread that regression leaves. A season is "as expected" when every measure with a visible El Niño signal sits between the 10th and 90th percentiles, "against" when none does, "mixed" otherwise, and "no expected signal" when the regression predicts no anomaly as large as half the year-to-year spread.</p>
  <h2>Yield estimates from observed weather</h2><p>For seasons at least half run, detrended yield is regressed on the season-to-date measures over 1981–2025 and applied to this year's. The ± printed with each estimate is one standard error from the coefficient covariance (clustered by harvest year); it does not include the yield variation the measures do not explain, so a prediction interval would be wider. Before an estimate is shown, it is tested: every past year is predicted from the other years with the detrending, the within-unit transformation and the coefficients refitted without it, at the same fraction of the season that has run today, and compared with a trend-only baseline (anomaly zero). The archived tests also compare with the earlier pooled index-only estimate. Skill is one minus the ratio of mean squared errors to the trend-only baseline. Estimates are shown only where that skill is positive, and the skill table is printed with each season. Historical skill is weak for many seasons. Aggregating estimates does not remove shared model errors or establish reliability. Where a measure lies outside its 1981–2025 range the estimate is an extrapolation and is marked.</p>
  <h2>Compound exposure</h2><p>The ledger sets the El Niño change beside three other shocks of 2026: nitrogen from the Gulf after the closure of Hormuz, Black Sea grain after the loss of Russia's export capacity, and staple trade through the Panama Canal and Hormuz, with the prevalence of undernourishment as the measure of who cannot absorb a price rise. Dependence shares are built from FAOSTAT and UN Comtrade for every country; the working paper gives the construction and the reconciliation with published figures.</p>
  <h2>What this is not</h2><p>Not a yield forecast: the fits are associations with the index and with season weather, and the scenarios follow the outlook. Not a food-security assessment: the FAO–WFP hotspots and the FEWS NET and JRC monitors do that, and the ledger links to them rather than replacing them. Not a measure of farm-level conditions: a reporting unit is a district or a state. Where our numbers and the GEOGLAM Crop Monitor's El Niño composites differ, the composite averages past events while the fit scales with the event's strength; where they agree, two methods say the same thing.</p>
  <h2>Issues</h2><p>Each issue identifies its observation cutoff and the Climate Prediction Center outlook used. Updates require new data and validation; this page does not refresh the numerical results automatically. Each issue keeps its data release under its own tag (<code>data/${esc(ISSUE)}/</code>) with a manifest of file hashes; the previous issue stays reachable by adding <code>?issue=</code> to the address. Local and regional responses are a separate versioned model in <code>regional/2026-10-06-v1/</code>. Copied links preserve both the issue and response model; earlier issue links without a model retain pooled results.</p></div>`;
}
async function renderDownloads(view) {
  const m = await load(BASE + 'manifest.json'); const files = Object.entries(m.files);
  view.innerHTML = `<div class="card prose"><p class="muted"><a href="#/methods">Back to about &amp; data</a></p><h2>Data for issue ${esc(ISSUE)}</h2>${D.regional?`<h3>Local and regional response model</h3><p><a href="${REGIONAL}scenario-summary.csv">Current scenario summary (CSV)</a> · <a href="${REGIONAL}unit-responses.csv.gz">All regional fits, intervals and scenario values (CSV.gz)</a> · <a href="${REGIONAL}model.json">Current panels, country totals and methods (JSON)</a> · <a href="${REGIONAL}changes.json">Changes from pooled estimates</a> · <a href="${REGIONAL}manifest.json">Source hashes and all country files</a></p><p>${esc(D.regional.methods.uncertainty)}</p><h3>Frozen weather inputs and earlier pooled exports</h3>`:''}${D.context?`<p><a href="${D.context.bulletin}">${bulletinLabel()}</a> · <a href="context/2026-10-07.json">Shared summary table and FEWS NET context (JSON)</a> · <a href="context/scenario-summary-2026-10-07.csv">Scenario summary (CSV)</a> · <a href="bulletins/enso_comparison_2026-10-07.png">ENSO comparison figure (PNG)</a> · <a href="season-data/${ISSUE}/manifest.json">Season-specific maps: manifest and QC</a></p>`:""}<p>Every file behind the pages, with its SHA-256. The original pooled unit files carry one representative season per reporting unit and crop; season-specific map files are listed below; <code>panels.json</code> carries every country-crop-season with its ENSO estimates, weather observations and weather-based yield estimates; <code>countries.json</code> the country summaries and the ledger row; <code>index_path.json</code> the observed index and the scenario paths.</p>
    <table class="t small"><thead><tr><th>File</th><th class="num">Bytes</th><th>SHA-256</th></tr></thead><tbody>${files.map(([f, v]) => `<tr><td><a href="${BASE + f}">${esc(f)}</a></td><td class="num">${v.bytes.toLocaleString()}</td><td class="muted" style="font-family:monospace;font-size:11px">${v.sha256.slice(0, 16)}…</td></tr>`).join('')}</tbody></table>
    <p>Licences. Our derived files are released under CC BY 4.0. They are built from sources with their own terms, which continue to apply to onward use: HarvestStat Asia (consortium package; the Indian boundaries are redistributed with Geolocet's permission and require attribution), the Hultgren et al. (2025) replication package, FAOSTAT (CC BY 4.0 IGO, with dataset-specific exceptions and FAO's additional terms), Berkeley Earth, CHIRPS, ERA5 (Copernicus licence), NOAA CPC and ERSST (public domain), SPAM 2010 (CC BY), Natural Earth (public domain), UN Comtrade (UN terms). The geometry the maps use is the merged release's and is archived with the data deposit so the Watch can be rebuilt without this site.</p>
    <p>The working paper, the season tracker's issue notes and the database exports (Parquet and CSV, with a manifest) are in the project repository; the full database is maintained locally. The files linked here are the public exports for this issue.</p></div>`;
}
})();
