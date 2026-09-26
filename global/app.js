'use strict';
const $ = id => document.getElementById(id), M = AtlasModel;
const RELEASE = '2026-09-26', BASE = `data/${RELEASE}/`;
const COLORS = ['#f2efb8', '#bbd79f', '#79b791', '#388b7e', '#146052', '#123c39'];
const cache = new Map();
let catalog, world, map, mapReady, state, rows = [], selected = [], shapes, generation = 0, lastPlace = '', lastPage = '', lastMapData = '', lastHandledHash = '', detailSeries, overlayUnits = [], overlayFocus = false, openerUnit = '', lastOverlayUnit = '';
const mapViews = new Map();
const mapContext = () => M.mapContext(state);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const level = r => r === 'ADM2' ? 'Stable district groups' : r === 'ADM0' ? 'National reporting' : 'Stable province / state groups';
const emptyGeo = () => ({type: 'FeatureCollection', features: []});
function load(path) {
  if (!cache.has(path)) cache.set(path, fetch(BASE + path).then(r => { if (!r.ok) throw new Error(`Could not load ${path} (${r.status}).`); return r.json(); }).catch(e => {cache.delete(path); throw e;}));
  return cache.get(path);
}
function rememberMapView() {
  const place=lastPlace || lastPage;
  if (!place) return;
  mapViews.set(place, {camera: map ? {center:map.getCenter().toArray(),zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()} : null,
    scroll:window.scrollY || 0, search:$('search').value, listScroll:$('locations').scrollTop});
}
function routeChanged() {
  if (lastHandledHash === location.hash) return;
  lastHandledHash = location.hash;
  return render();
}
function go(next, replace = false) {
  if (M.url(next) === location.hash) return;
  rememberMapView();
  const continuing = state?.kind === 'region' && next.kind === 'region';
  const marker = next.kind === 'region' ? continuing ? history.state : {atlasOverlayReturn:M.url(state)} : null;
  history[replace || continuing ? 'replaceState' : 'pushState'](marker, '', M.url(next));
  return routeChanged();
}
function navigate(changes) { return go({...state, ...changes}); }
function openRegion(country, unit) { return navigate({kind:'region',country,unit,view:mapContext().kind}); }
function closeRegion() {
  if (state.kind !== 'region') return;
  openerUnit = state.unit;
  if (history.state?.atlasOverlayReturn) history.back();
  else return go(mapContext(), true); // A direct regional link has no in-app map history to return to.
}
function overlayChrome() {
  const opened = state.kind === 'region', wasOpen = !$('region-overlay').hidden;
  $('region-overlay').hidden = !opened;
  $('detail').hidden = !opened;
  if (!opened) {lastOverlayUnit='';return;}
  overlayFocus = !wasOpen;
  if(lastOverlayUnit!==state.unit)$('region-overlay').scrollTop=0;
  lastOverlayUnit=state.unit;
  overlayUnits = shapes.features.filter(f=>f.properties.country===state.country).sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
  const feature = overlayUnits.find(f=>f.id===state.unit), i=overlayUnits.findIndex(f=>f.id===state.unit);
  $('region-title').textContent = feature?.properties.name || 'Region not found';
  $('region-country').textContent = countryName(state.country)+' · '+catalog.products[state.crop];
  $('region-select').innerHTML = overlayUnits.map(f=>option(f.id,f.properties.name,state.unit)).join('');
  $('region-select').value = state.unit;
  $('previous-region').disabled = i <= 0;
  $('next-region').disabled = i < 0 || i >= overlayUnits.length-1;
  $('region-select').disabled = !overlayUnits.length;
}
function finishOverlay() {
  if (state.kind === 'region') {
    if (overlayFocus) {$('close-region').focus({preventScroll:true});overlayFocus=false;}
  } else if (openerUnit) {
    const a=[...document.querySelectorAll('#locations a')].find(a=>a.dataset.unit===openerUnit);
    (a || map?.getCanvas())?.focus({preventScroll:true});openerUnit='';
  }
}
function countryName(c) { return catalog.countries[c]?.name || world.features.find(f => f.properties.country === c)?.properties.name || c; }
function selectedBasis(c) { return state.basis === 'default' ? M.defaultBasis(rows.filter(r => r.country === c), selectedSeason(c)) : state.basis; }
function option(value, label, chosen) { return `<option value="${escape(value)}"${value === chosen ? ' selected' : ''}>${escape(label)}</option>`; }
function link(changes) { return escape(M.url({...state, ...changes})); }
function selectedSeason(c) { return state.season === 'default' ? M.defaultSeason(rows.filter(r => r.country === c), state.crop) : state.season; }
function bounds(features) {
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];let count=0;
  function walk(c) { if (typeof c[0] === 'number') {count++;for(let i=0;i<2;i++){lo[i]=Math.min(lo[i],c[i]);hi[i]=Math.max(hi[i],c[i]);}} else c.forEach(walk); }
  features.forEach(f => walk(f.geometry.coordinates));
  return count ? [lo,hi] : null;
}
function zoomTo(features) { const b = bounds(features); if (b && map) map.fitBounds(b, {padding: 42, duration: 0, maxZoom: 8}); }
function worldExtent() { map?.fitBounds([[-175,-58],[180,80]], {padding: 12, duration: 0}); }
function initializeMap() {
  try {
    map = new maplibregl.Map({container: 'map', style: {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#eaf0f1'}}]}, center:[32, 18], zoom: 0.8, renderWorldCopies: false, attributionControl: false});
    map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
    map.addControl(new maplibregl.AttributionControl({compact: true, customAttribution: 'Natural Earth · Geolocet · FAO GAUL'}));
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
    mapReady = new Promise(resolve => map.on('load', () => {
      map.addSource('world', {type:'geojson', data:world});
      map.addLayer({id:'countries', type:'fill', source:'world', paint:{'fill-color':'#e1e4dd'}});
      map.addLayer({id:'country-lines', type:'line', source:'world', paint:{'line-color':'#b3c1b8','line-width':0.7}});
      map.addSource('units', {type:'geojson', data:emptyGeo()});
      map.addLayer({id:'units', type:'fill', source:'units', paint:{'fill-color':'#e1e4dd'}});
      map.addLayer({id:'unit-lines', type:'line', source:'units', paint:{'line-color':'#698b78','line-width':['interpolate',['linear'],['zoom'],1,0.15,6,0.5]}});
      map.addLayer({id:'selected-unit', type:'line', source:'units', filter:['==',['get','id'],''], paint:{'line-color':'#ca741b','line-width':2.7}});
      const popup = new maplibregl.Popup({closeButton:false, closeOnClick:false, maxWidth:'300px'});
      map.on('mousemove', e => {
        const feature = map.queryRenderedFeatures(e.point, {layers:['units','countries']})[0];
        if (!feature) {popup.remove();map.getCanvas().style.cursor='';return;}
        map.getCanvas().style.cursor='pointer';
        const p = feature.properties, record = selected.find(r => r.id === p.id), cc = p.country;
        let html = `<strong>${escape(p.name)}</strong><br>${escape(countryName(cc))}`;
        if (record) html += `<br>${record.enough ? fmt(record.stats.mean) + ' t/ha' : escape(record.status)}<br>${record.stats.n} years${record.stats.n ? ' · ' + record.stats.first + '–' + record.stats.last : ''}<br>${escape(record.season)} · ${escape(record.basis)} area`;
        else html += '<br>' + (catalog.countries[cc] ? 'No mapped value for this selection' : 'Agricultural records not yet included');
        html += `<br><small>${p.id ? 'Open regional records' : 'Open country'}</small>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseout', () => popup.remove());
      map.on('click', e => {
        const f = map.queryRenderedFeatures(e.point, {layers:['units','countries']})[0]; if (!f) return;
        popup.remove();const p = f.properties;
        if (p.id) openRegion(p.country,p.id);
        else navigate({kind:'country',country:p.country,unit:''});
      });
      resolve();
    }));
  } catch (e) {
    $('map').innerHTML = '<p class="empty">The map needs WebGL support. All country and regional records remain accessible through the location list.</p>';
    map = null;mapReady = Promise.resolve();
  }
}
function controls() {
  const view=mapContext();
  for (const k of ['crop','metric','period','minimum','basis']) $(k).value = state[k];
  const context = view.kind === 'world' ? rows : rows.filter(r => r.country === view.country);
  const seasons = [...new Set(context.filter(r => r.periods.available.n).map(r => r.season))].sort();
  $('season').innerHTML = option('default', view.kind === 'world' ? 'Local default' : `Default${selectedSeason(view.country) ? ': ' + selectedSeason(view.country) : ''}`, state.season) + seasons.map(s => option(s,s,state.season)).join('') + (!['default',...seasons].includes(state.season) ? option(state.season,state.season+' · no records here',state.season) : '');
  const country = view.kind === 'world' ? null : catalog.countries[view.country];
  // A crop remains selectable when it has observations, even if it has no eligible ENSO model.
  $('crop').innerHTML = Object.entries(catalog.products).filter(([id])=>!country||country.crops[id]?.length||id===state.crop).map(([id,name]) => option(id, name + (country && !country.crops[id]?.length ? ' · no records here' : ''), state.crop)).join('');
}
function heading() {
  const view=mapContext();
  const name = view.kind === 'world' ? '' : countryName(view.country);
  const rec = selected.find(r => r.id === state.unit), feature = shapes?.features.find(f => f.id === state.unit);
  $('title').textContent = view.kind === 'world' ? 'Global crop yields' : view.kind === 'country' ? name : rec?.name || feature?.properties.name || 'Regional records';
  document.title = (state.kind==='region' ? (rec?.name || feature?.properties.name || 'Regional records')+' · ' : '') + $('title').textContent + ' · Agricultural atlas';
  $('breadcrumbs').innerHTML = view.kind === 'world' ? 'WORLD / OBSERVATIONS' : `<a href="${link({kind:'world',country:'',unit:''})}">World</a><span>/</span>${view.kind === 'region' ? `<a href="${link({kind:'country',unit:''})}">${escape(name)}</a><span>/</span>Region` : escape(name)}`;
  $('subtitle').textContent = view.kind === 'world' ? 'Explore observed yields at the reporting resolution available, then open a country and its regions.' : catalog.countries[view.country] ? `${name} · ${level(catalog.countries[view.country].level)} · ${catalog.products[state.crop]}` : `${name} · Agricultural records are not yet included in this release.`;
  $('map-heading').textContent = `${state.metric === 'yield' ? 'Observed average yield' : 'Years with eligible observations'} · ${catalog.products[state.crop]}`;
  const basis = [...new Set(selected.filter(r => r.stats.n && (view.kind === 'world' || r.country === view.country)).map(r => r.basis))];
  $('selection-note').textContent = (state.period === 'available' ? 'Available record: actual dates differ by region.' : `Requested period ${state.period.replace('-', '–')}; the requested window is retained in every region.`) + ` ${basis.length > 1 ? 'Both planted- and harvested-area yields are present; each region identifies its basis.' : basis.length ? 'Yield per hectare of ' + basis[0] + ' area.' : ''}`;
  $('map-instruction').textContent = view.kind === 'world' ? 'Click a colored reporting unit for its observations, or a country outline to explore its regions.' : 'Click a region to open its observations over the map. Close the panel to continue exploring.';
}
function renderLocations() {
  const view=mapContext();
  const term = $('search').value.trim().toLowerCase();
  const container = $('locations');
  if (view.kind === 'world') {
    const countries = [...new Map(world.features.map(f => [f.properties.country, f.properties])).values()];
    countries.sort((a,b) => (Number(!!catalog.countries[b.country]) - Number(!!catalog.countries[a.country])) || countryName(a.country).localeCompare(countryName(b.country)));
    const filtered = countries.filter(c => (countryName(c.country)+' '+c.country).toLowerCase().includes(term));
    $('list-title').textContent = 'Countries';$('list-count').textContent = `${Object.keys(catalog.countries).length} in database`;
    $('search').placeholder = 'Search countries…';
    container.innerHTML = filtered.map(c => {
      const cc = c.country, rs = selected.filter(r=>r.country===cc), n=rs.filter(r=>r.enough).length, meta=catalog.countries[cc];
      return `<a class="location" href="${link({kind:'country',country:cc,unit:''})}"><div class="row"><b>${escape(countryName(cc))}</b><span class="value">${n ? n+' regions' : '—'}</span></div><small>${meta ? (selectedSeason(cc) || 'No '+catalog.products[state.crop]+' records') + ' · ' + level(meta.level) : 'Records not yet included'}</small>${meta ? `<small>${rs.length ? n+' of '+rs.length+' source series mapped' : 'Choose another crop to explore available records'}</small>` : ''}</a>`;
    }).join('') || '<p class="empty">No countries match this search.</p>';
  } else {
    const units = shapes?.features || [];
    const records = new Map(selected.filter(r=>r.country===view.country).map(r=>[r.id,r]));
    const filtered = units.filter(f => (f.properties.name+' '+f.id).toLowerCase().includes(term)).sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
    $('list-title').textContent = 'Reporting regions';$('list-count').textContent = `${units.length} boundaries`;
    $('search').placeholder = 'Search regions…';
    container.innerHTML = filtered.map(f => {
      const r=records.get(f.id), st=r?.stats;
      return `<a data-unit="${escape(f.id)}" class="location${f.id===state.unit?' selected':''}" href="${link({kind:'region',country:f.properties.country,unit:f.id,view:view.kind})}"><div class="row"><b>${escape(f.properties.name)}</b><span class="value">${r?.enough ? state.metric==='yield' ? fmt(st.mean)+' t/ha' : st.n+' years' : '—'}</span></div><small>${st?.n ? st.first+'–'+st.last+' · '+st.n+' years · '+Math.round(st.completeness*100)+'% complete' : 'No eligible observations for this selection'}</small><small>${r ? escape(r.season)+' · '+escape(r.basis)+' area'+(!r.enough&&st.n?' · Below coverage filter':'') : 'Open region to inspect other selections'}</small></a>`;
    }).join('') || `<p class="empty">${catalog.countries[view.country] ? 'No regions match this search.' : 'This country awaits the expanding database. Return to the world view or open a country with records.'}</p>`;
  }
}
function legendAndMap() {
  const values = selected.filter(r=>r.enough).map(r=>r.value), max = Math.max(...values, 1);
  $('legend-title').textContent = state.metric === 'yield' ? 'Average yield · tonnes per hectare' : 'Coverage · years observed';
  $('legend-ticks').innerHTML = [0,0.25,0.5,0.75,1].map(f=>`<span>${fmt(f*max,state.metric==='yield'?1:0)}</span>`).join('');
  $('legend-note').textContent = 'Same scale across countries for this selection. No clipping.';
  if (!map) return;
  const view=mapContext(), place=view.kind+':'+view.country;
  const dataKey=[place,state.crop,state.season,state.basis,state.period,state.metric,state.minimum,shapes.features.length].join('|');
  if(lastMapData!==dataKey){
    const lookup = new Map(selected.map(r=>[r.id,r]));
    const data = {type:'FeatureCollection', features:shapes.features.map(f=>({...f,properties:{...f.properties,value:lookup.get(f.id)?.value ?? -1}}))};
    map.getSource('units').setData(data);
    map.setPaintProperty('units','fill-color',['case',['<',['get','value'],0],'#e1e4dd',['interpolate',['linear'],['get','value'],...COLORS.flatMap((c,i)=>[i*max/(COLORS.length-1),c])]]);
    lastMapData=dataKey;
  }
  map.setFilter('selected-unit',['==',['get','id'],state.kind==='region'?state.unit:'']);
  if (lastPlace!==place) {
    const saved=mapViews.get(place);
    if(saved?.camera)map.jumpTo(saved.camera);
    else if (view.kind==='world') worldExtent();
    else if (shapes.features.length) zoomTo(shapes.features);
    else zoomTo(world.features.filter(f=>f.properties.country===view.country));
    lastPlace=place;
  }
}
function chart(series) {
  const obs = series.observations;
  if (!obs.length) return '<p class="empty">No eligible observations in this source series.</p>';
  const first=obs[0][0],last=obs.at(-1)[0], max=Math.max(...obs.map(r=>r[1]))*1.13 || 1, years=catalog.periods[state.period];
  const x=y=>48+(y-first)/(last-first||1)*452,y=v=>218-v/max*185;
  const inPeriod = r => !years || r[0]>=years[0]&&r[0]<=years[1];
  let content='';
  for (let i=0;i<=4;i++) {const v=max*i/4;content+=`<line x1="48" x2="500" y1="${y(v)}" y2="${y(v)}" stroke="#dce5de"/><text x="38" y="${y(v)+4}" text-anchor="end">${fmt(v,1)}</text>`;}
  const step=last-first>35?10:5, gap=Math.max(2,(last-first)*.085);
  const ticks=[first,...Array.from({length:last-first+1},(_,i)=>first+i).filter(n=>n%step===0&&n-first>=gap&&last-n>=gap),...(last>first?[last]:[])];
  for (const t of ticks) content+=`<text x="${x(t)}" y="241" text-anchor="middle">${t}</text>`;
  obs.forEach((r,i)=>{
    if (i&&r[0]===obs[i-1][0]+1) content+=`<line x1="${x(obs[i-1][0])}" y1="${y(obs[i-1][1])}" x2="${x(r[0])}" y2="${y(r[1])}" stroke="${inPeriod(r)&&inPeriod(obs[i-1])?'#237762':'#bdcec5'}" stroke-width="1.6"/>`;
    content+=`<circle cx="${x(r[0])}" cy="${y(r[1])}" r="${inPeriod(r)?4:3}" fill="${inPeriod(r)?'#176957':'#bdcec5'}"><title>${r[0]}: ${fmt(r[1],3)} t/ha${r[4]?' (corrected)':''}</title></circle>`;
  });
  return `<svg viewBox="0 0 520 255" role="img" aria-label="Observed yield over time for ${escape(series.name)}. Values are available in the observation table." style="font:12px var(--font);fill:#64746f"><text x="48" y="17">Observed yield (t/ha)</text>${content}</svg>`;
}
function download(name, text, type='text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function detail(token) {
  $('detail').hidden=state.kind!=='region';detailSeries=null;
  if(state.kind!=='region')return;
  $('detail').innerHTML='<p class="empty" role="status">Loading regional observations…</p>';
  const meta=catalog.countries[state.country], feature=shapes.features.find(f=>f.id===state.unit);
  if(!meta||!feature){$('detail').innerHTML='<h2>Region not found</h2><p>Return to the country view to choose an available reporting unit.</p>';return;}
  const cropSeasons=meta.crops[state.crop];
  const data = cropSeasons ? await load(`observations/${state.country}-${state.crop}.json`) : {series:[]};
  if(token!==generation)return;
  const series=data.series.find(s=>s.id===state.unit&&s.season===selectedSeason(state.country)&&s.basis===selectedBasis(state.country));
  if(!series){
    const available=data.series.filter(s=>s.id===state.unit&&s.periods.available.n);
    $('detail').innerHTML=`<h2>${escape(feature.properties.name)}</h2><p>No ${escape(catalog.products[state.crop])} records for the selected season and area basis.</p>${available.length?'<p>Series with observations: '+available.map(s=>`<a href="${link({season:s.season,basis:s.basis})}">${escape(s.season)} · ${escape(s.basis)} area</a>`).join(', ')+'.</p>':'<p>Choose another crop or return to the country view.</p>'}`;return;
  }
  detailSeries=series;
  const summary=series.periods[state.period], period=catalog.periods[state.period], obs=series.observations.filter(r=>!period||r[0]>=period[0]&&r[0]<=period[1]);
  const meets=summary.n>0&&(state.minimum!=='80'||summary.completeness>=.8);
  $('detail').innerHTML=`<div class="detail-head"><div><h2>The observations behind the map</h2><p>${escape(series.name)} · ${escape(catalog.products[state.crop])} · ${escape(series.season)} · ${escape(series.basis)} area</p></div><button id="download">Download selected observations ↓</button></div>
  <div class="stats"><div class="stat"><strong>${fmt(summary.mean)}<small> t/ha</small></strong><small>Arithmetic mean${!meets&&summary.n?' · below map coverage filter':''}</small></div><div class="stat"><strong>${summary.n}</strong><small>Observed years in selection</small></div><div class="stat"><strong>${summary.n?summary.first+'–'+summary.last:'—'}</strong><small>Actual record dates</small></div><div class="stat"><strong>${Math.round(summary.completeness*100)}%</strong><small>Years reported in requested span</small></div></div>
  <div class="chart-box">${chart(series)}</div><p class="chart-note">Dark points fall within the selected period; pale points show the remaining record. Gaps interrupt the line. Every point is an observation. Short records remain available here even when they cannot support an ENSO regression.</p>
  <details><summary>Observed values · ${obs.length} years in selection</summary><div class="table-wrap"><table><thead><tr><th>Year</th><th>Yield (t/ha)</th><th>${escape(series.basis)} area (ha)</th><th>Production (t)</th><th>Record</th></tr></thead><tbody>${obs.map(r=>`<tr><td>${r[0]}</td><td>${fmt(r[1],3)}</td><td>${fmt(r[2],1)}</td><td>${fmt(r[3],1)}</td><td>${r[4]?'Verified correction':'Source record'}</td></tr>`).join('')}</tbody></table>${!obs.length?'<p class="empty">No eligible observations within the requested period. The complete history remains visible above.</p>':''}</div></details>
  <p class="source-note">${escape(series.id)} · ${level(series.level)} · ${feature.properties.members} source administrative unit${feature.properties.members===1?'':'s'} · Boundary base year ${series.base_year}.<br>Members: ${escape(series.members)}.<br>Source: ${escape(series.source)}. ${series.country==='JP'?'Japanese production is derived from planted area × published yield. ':''}Source rows excluded across the full record: ${Object.entries(series.excluded).map(([reason,n])=>n+' '+escape(reason)).join('; ')||'none'}.<br>Release ${RELEASE}. <a href="${BASE}observations/${series.country}-${series.crop}.json">Download complete country–crop records (JSON)</a>.</p>`;
  $('download').onclick=()=>download(`${RELEASE}_${series.id}_${series.crop}_${series.basis}_${series.season.replaceAll(' ','-')}_${state.period}.csv`,M.csv([
    ['release','region_id','country','unit_name','crop','season','yield_basis','requested_period','year','yield_t_ha','area_ha','production_t','corrected','source'],
    ...obs.map(r=>[RELEASE,series.id,series.country,series.name,catalog.products[series.crop],series.season,series.basis,state.period,...r,series.source])
  ]));
}
async function render() {
  const token=++generation;
  rememberMapView();
  try {
    const previous=state;
    state=M.parse(location.hash);
    if(previous?.kind==='region'&&state.kind!=='region')openerUnit=previous.unit;
    const view=mapContext(), page=view.kind+':'+view.country;
    const listPosition=page===lastPage?$('locations').scrollTop:mapViews.get(page)?.listScroll || 0;
    if(page!==lastPage)$('search').value=mapViews.get(page)?.search || '';
    if(state.kind!=='region'){$('region-overlay').hidden=true;$('detail').hidden=true;}
    if(state.release!==RELEASE)throw new Error(`Release ${state.release} is unavailable. Open the current release using the Agricultural atlas home link.`);
    if(!catalog.products[state.crop])throw new Error('Unknown crop in this link. Open the Agricultural atlas home link to reset the selection.');
    $('status').className='';$('status').textContent='Loading selected records…';
    const data=await load(state.crop+'.json');if(token!==generation)return;rows=data;
    selected=M.select(rows,state);
    const cs=view.kind==='world'? [...new Set([...selected.filter(r=>r.stats.n).map(r=>r.country), ...(state.kind==='region'&&catalog.countries[state.country]?[state.country]:[])])]: catalog.countries[view.country]?[view.country]:[];
    const geos=await Promise.all(cs.map(c=>load('geometry/'+c+'.json')));if(token!==generation)return;
    shapes={type:'FeatureCollection',features:geos.flatMap(g=>g.features)};
    controls();heading();renderLocations();$('locations').scrollTop=listPosition;overlayChrome();
    await mapReady;if(token!==generation)return;legendAndMap();
    const context=selected.filter(r=>view.kind==='world'||r.country===view.country),valid=context.filter(r=>r.enough);
    $('status').textContent=view.kind!=='world'&&!catalog.countries[view.country] ? 'Agricultural records for this country await the expanding database.' : `${valid.length.toLocaleString()} reporting regions mapped · ${context.reduce((n,r)=>n+r.stats.n,0).toLocaleString()} eligible annual observations in the selected source series. ${view.kind==='world'?'Open a country to see actual dates and resolution.':selectedSeason(view.country)?'Season: '+selectedSeason(view.country)+' · '+selectedBasis(view.country)+' area.':'Choose another crop to explore the available records.'}`;
    await detail(token);
    if(token!==generation)return;
    if(page!==lastPage){window.scrollTo({top:mapViews.get(page)?.scroll || 0,behavior:'instant'});lastPage=page;}
    finishOverlay();
    if(!location.hash)history.replaceState(null,'',M.url(state));
  } catch(e) { if(token!==generation)return; $('status').className='error';$('status').textContent=e.message; if(state?.kind==='region')$('detail').innerHTML='<p class="empty">'+escape(e.message)+'</p>'; }
}
async function start() {
  try {
    [catalog,world]=await Promise.all([load('catalog.json'),load('world.json')]);
    initializeMap();
    document.querySelector('.skip').onclick=e=>{e.preventDefault();$('workspace').tabIndex=-1;$('workspace').focus();$('workspace').scrollIntoView({block:'start'});};
    $('controls').onsubmit=e=>e.preventDefault();
    for(const k of ['crop','metric','period','season','minimum','basis']) $(k).onchange=()=>navigate({[k]:$(k).value,...(k==='crop'?{season:'default'}:{})});
    $('search').oninput=renderLocations;
    $('world-view').onclick=()=>{worldExtent();};
    $('data-view').onclick=()=>zoomTo(shapes.features.filter(f=>state.kind==='region'?f.id===state.unit:selected.some(r=>r.id===f.id&&r.enough)));
    $('share').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('share').textContent='Link copied';}catch{$('share').textContent='Copy this page’s address';}setTimeout(()=>$('share').textContent='Copy view link',2200);};
    document.addEventListener('click',e=>{
      const a=e.target.closest('a[href^="#/"]');
      if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
      e.preventDefault();go(M.parse(a.getAttribute('href')));
    });
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state?.kind==='region'){e.preventDefault();closeRegion();}});
    $('close-region').onclick=closeRegion;
    $('region-select').onchange=()=>openRegion(state.country,$('region-select').value);
    for(const [id,step] of [['previous-region',-1],['next-region',1]])$(id).onclick=()=>{
      const next=overlayUnits[overlayUnits.findIndex(f=>f.id===state.unit)+step];if(next)openRegion(state.country,next.id);
    };
    history.scrollRestoration='manual';
    window.addEventListener('popstate',routeChanged);
    window.addEventListener('hashchange',routeChanged);
    lastHandledHash=location.hash;
    await render();
  } catch(e) {$('status').className='error';$('status').textContent=e.message;}
}
start();
