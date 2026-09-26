'use strict';
const $ = id => document.getElementById(id), M = AtlasModel;
const RELEASE = M.RELEASE, BASE = `data/${M.BASE_RELEASE}/`, CHECK_BASE = `data/${RELEASE}/`;
const COLORS = ['#f2efb8', '#bbd79f', '#79b791', '#388b7e', '#146052', '#123c39'];
const RESPONSE_COLORS = ['#8c510a', '#d8b365', '#f5f5ed', '#5ab4ac', '#01665e'];
const cache = new Map();
let catalog, world, map, mapReady, state, rows = [], selected = [], shapes, generation = 0, lastPlace = '', lastPage = '', lastMapData = '', lastHandledHash = '', detailSeries, overlayUnits = [], overlayFocus = false, openerUnit = '', lastOverlayUnit = '';
const mapViews = new Map();
let robustRecords=null,robustMethods=null;
let fitRecords=null,fitMethods=null,fitClimate=null,indexRegistry=null,trendRecords=null;
const responseValue=r=>r?.value==null?'—':(r.value>0?'+':'')+fmt(r.value,1)+'%';
let panelReturnScroll = null;
const mapContext = () => M.mapContext(state);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const level = r => r === 'ADM2' ? 'District / county records' : r === 'ADM0' ? 'National reporting' : r==='mixed'?'National and regional records':'Province / state records';
const nice=s=>String(s??'').replaceAll('_',' ').replace(/\b[a-z]/g,c=>c.toUpperCase());
const sourceName=s=>({hvstat:'HarvestStat Asia',gmfd:'GMFD / Hultgren',faostat:'FAOSTAT'}[s]||s);
const unitFeatures=()=>selected.filter(r=>r.country===(state.kind==='region'?state.country:mapContext().country)).map(r=>({id:r.id,properties:{country:r.country,name:r.name}}));
const emptyGeo = () => ({type: 'FeatureCollection', features: []});
function load(path) {
  if (!cache.has(path)) {
    if(cache.size>45){const key=[...cache.keys()].find(k=>k.includes('fits/')||k.includes('observations/')||k.includes('robustness/'));if(key)cache.delete(key);}
    cache.set(path, fetchData(path).catch(e=>{cache.delete(path);throw new Error(path+': '+e.message);}));
  }
  return cache.get(path);
}
async function fetchData(path){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch((path.startsWith("robustness/")||path==="robust-methods.json"?CHECK_BASE:BASE)+(path==="robust-methods.json"?"methods.json":path));
      if(!r.ok){const error=new Error(`Could not load ${path} (${r.status}).`);error.permanent=r.status<500;throw error;}
      return path.endsWith('.gz')?JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text()):await r.json();
    }catch(e){if(e.permanent||attempt===2)throw e;await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));}
  }
}
async function mapLimited(items,fn){const result=Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{while(cursor<items.length){const i=cursor++;result[i]=await fn(items[i]);}}));return result;}
async function summaries(crop){return load(crop+'.json.gz');}
async function observationsFor(country,crop){return catalog.countries[country]?.crops[crop]?.length?load(`observations/${country}-${crop}.json.gz`):{series:[]};}
async function fitsFor(crop){return load(`fits/${state.index}/${state.window}/${crop}.json.gz`);}
function riceNote(r){return r.crop!=='rice'?'':r.comparable?`Original weight basis: ${r.source_crop.replace("rice_","")}. Yield and production × ${fmt(r.conversion_factor,3)} to paddy equivalent; area unchanged.`:'Original rice weight basis is unspecified. Absolute yields are excluded from comparable maps; relative ENSO responses remain available.';}

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
  overlayUnits = unitFeatures().sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
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
function countryName(c) { return nice(world.features.find(f=>f.properties.country===c)?.properties.name||catalog.countries[c]?.name||c); }
function selectedBasis(c) {return [...new Set(selected.filter(r=>r.country===c).map(r=>r.basis))].join(' / ');}
function option(value, label, chosen) { return `<option value="${escape(value)}"${value === chosen ? ' selected' : ''}>${escape(label)}</option>`; }
function link(changes) { return escape(M.url({...state, ...changes})); }
function selectedLevel(c){return [...new Set(selected.filter(r=>r.country===c).map(r=>level(r.level)))].join(' / ')||'No records in this selection';}
function selectedSeason(c) {return [...new Set(selected.filter(r=>r.country===c).map(r=>r.season))].join(' / ');}
function bounds(features) {
  const lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];let count=0;
  function walk(c) { if (typeof c[0] === 'number') {count++;for(let i=0;i<2;i++){lo[i]=Math.min(lo[i],c[i]);hi[i]=Math.max(hi[i],c[i]);}} else c.forEach(walk); }
  features.filter(f=>f.geometry).forEach(f => walk(f.geometry.coordinates));
  return count ? [lo,hi] : null;
}
function zoomTo(features) { const b = bounds(features); if (b && map) map.fitBounds(b, {padding: 42, duration: 0, maxZoom: 8}); }
function worldExtent() { map?.fitBounds([[-175,-58],[180,80]], {padding: 12, duration: 0}); }
function initializeMap() {
  try {
    map = new maplibregl.Map({container: 'map', style: {version: 8, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#eaf0f1'}}]}, center:[32, 18], zoom: 0.8, renderWorldCopies: false, attributionControl: false});
    map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
    map.addControl(new maplibregl.AttributionControl({compact: true, customAttribution: 'Natural Earth · Hultgren et al. · Geolocet · FAO GAUL'}));
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
    mapReady = new Promise(resolve => map.on('load', () => {
      map.addSource('world', {type:'geojson', data:world});
      map.addLayer({id:'countries', type:'fill', source:'world', paint:{'fill-color':'#e1e4dd'}});
      map.addLayer({id:'country-lines', type:'line', source:'world', paint:{'line-color':'#b3c1b8','line-width':0.7}});
      map.addSource('units', {type:'geojson', data:emptyGeo()});
      map.addLayer({id:'units', type:'fill', source:'units', paint:{'fill-color':'#e1e4dd'}});
      map.addLayer({id:'unit-lines', type:'line', source:'units', paint:{'line-color':'#747a78','line-width':['interpolate',['linear'],['zoom'],0,0.07,3,0.12,7,0.5],'line-opacity':['interpolate',['linear'],['zoom'],0,0.15,2,0.2,5,0.45,8,0.7]}});
      // At world scale county-sized polygons can be narrower than an outline.
      // Keep support flags neutral and reserve their outlines for regional zoom.
      map.addLayer({id:'extrapolated-units', type:'line', source:'units', minzoom:4, filter:['==',['get','extrapolated'],true], paint:{'line-color':'#505452','line-width':['interpolate',['linear'],['zoom'],4,0.35,6,0.85,9,1.1],'line-opacity':['interpolate',['linear'],['zoom'],4,0.35,6,0.7,9,0.85],'line-dasharray':[3,2]}});
      map.addLayer({id:'selected-unit', type:'line', source:'units', filter:['==',['get','id'],''], paint:{'line-color':'#263f50','line-width':['interpolate',['linear'],['zoom'],1,1,5,2,8,2.7]}});
      const popup = new maplibregl.Popup({closeButton:false, closeOnClick:false, maxWidth:'300px'});
      map.on('mousemove', e => {
        const feature = map.queryRenderedFeatures(e.point, {layers:['units','countries']})[0];
        if (!feature) {popup.remove();map.getCanvas().style.cursor='';return;}
        map.getCanvas().style.cursor='pointer';
        const p = feature.properties, record = selected.find(r => r.id === p.id), cc = p.country;
        let html = `<strong>${escape(p.name)}</strong><br>${escape(countryName(cc))}`;
        if (record) html += `<br>${record.enough ? state.metric==='trend'?fmt(record.value)+' t/ha per decade':state.metric==='latest'?'Last harvest '+record.stats.last:state.metric==='resolution'?level(record.level):state.metric==='coverage'?record.stats.n+' observed years':state.metric==='enso'?responseValue(record.response):fmt(record.stats.mean)+' t/ha' : escape(record.status)}<br>${record.stats.n} years${record.stats.n ? ' · ' + record.stats.first + '–' + record.stats.last : ''}<br>${escape(record.season)} · ${escape(record.basis)} area`;
        else html += '<br>' + (catalog.countries[cc] ? 'No mapped value for this selection' : 'Agricultural records not yet included');
        if(state.metric==='enso'&&record?.response)html+=`<br><b>ENSO response: ${responseValue(record.response)}</b><br>${fmt(record.response.x,2)} ${escape(fitClimate.units)} exposure · ${escape(state.model)}<br>95% interval ${fmt(record.response.lo,1)} to ${fmt(record.response.hi,1)}%<br>${escape(record.status)}`;
        html += `<br><small>${p.id ? 'Open regional records' : 'Open country'}</small>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseout', () => popup.remove());
      map.on('click', e => {
        const f = map.queryRenderedFeatures(e.point, {layers:['units','countries']})[0]; if (!f) return;
        popup.remove();const p = f.properties;
        if (p.id&&!(p.tier===3&&mapContext().kind==='world')) openRegion(p.country,p.id);
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
  const view=mapContext(),context=view.kind==='world'?rows:rows.filter(r=>r.country===view.country),country=catalog.countries[view.country];
  for(const k of ['metric','period','minimum','basis','resolution','index','window','scale'])$(k).value=state[k];
  $('index').innerHTML=Object.entries(indexRegistry).map(([key,v])=>option(key,v.label,state.index)).join('');
  const seasons=[...new Set(context.filter(r=>r.periods.available.n).map(r=>r.season))].sort();
  $('season').innerHTML=option('default','Local default per region',state.season)+seasons.map(v=>option(v,v,state.season)).join('')+(!['default',...seasons].includes(state.season)?option(state.season,state.season+' · unavailable here',state.season):'');
  $('crop').innerHTML=Object.entries(catalog.products).filter(([id])=>!country||country.crops[id]?.length||id===state.crop).map(([id,name])=>option(id,(id==='rice'?'Rice (paddy eq.)':name)+(country&&!country.crops[id]?.length?' · unavailable here':''),state.crop)).join('');
  const sources=[...new Set(context.map(r=>r.source))];
  $('source').innerHTML=option('auto','Merged priority',state.source)+sources.map(v=>option(v,sourceName(v),state.source)).join('')+(!['auto',...sources].includes(state.source)?option(state.source,sourceName(state.source)+' · unavailable here',state.source):'');
  $('enso-controls').hidden=state.metric!=='enso';
  for(const k of ['model','exposure','amplitude','peak','peakYear','peakMonth','harvest','evidence','support','estimator'])$(k).value=String(state[k]);
  const scope=AtlasReliability.inScope(state);
  $('estimator').querySelector('[value="pooled"]').disabled=!scope;
  $('evidence').querySelector('[value="stable"]').disabled=!scope;
  $('reliability-scope').textContent=scope?'Trend and episode checks available. Pooling borrows 50% from a jointly fitted state/province curve; individual estimates remain the default.':'Trend/event checks and pooling are prepared for 1981–2024 crop-season Niño 3.4. This selection retains its original fits.';
  $('field-note').textContent=`Field FDR uses Benjamini–Yekutieli at 0.10 over ${selected[0]?.fieldN??0} mapped, source-selected units worldwide for this crop and specification, before evidence or support filters. Zooming keeps that family fixed. Browsing other specifications creates separate tests.`;
  $('event-controls').hidden=state.exposure!=='event';$('peak-control').hidden=state.exposure!=='event';$('amplitude-control').hidden=state.exposure==='event';
  $('event-preset').hidden=!fitClimate.supports_peak;$('exposure').querySelector('[value="event"]').disabled=!fitClimate.supports_peak;
  $('scale').disabled=state.exposure==='event';
  $('amplitude-label').textContent=state.scale==='sd'?'Exposure in local standard deviations':`${fitClimate.label} (${fitClimate.units})`;
  $('index-description').textContent=`${fitClimate.product} · baseline ${fitClimate.baseline}`;
  for(const o of $('window').options){o.disabled=!context.some(r=>r.windows[o.value]);}
  $('index-note').textContent=fitClimate.definition+'. '+fitClimate.aggregation+'.';
  $('harvest').innerHTML=option('0',`${state.peakYear} · peak year`,state.harvest)+option('1',`${state.peakYear+1} · following year`,state.harvest);
  displayMode();
}
function displayMode() {
  // Display mode changes presentation only; shared links keep their full specification.
  document.body.dataset.mode=state.mode;
  $('simple-mode').setAttribute('aria-pressed',String(state.mode==='simple'));
  $('advanced-mode').setAttribute('aria-pressed',String(state.mode==='advanced'));
  $('scenario-control').hidden=state.metric!=='enso'||state.mode==='advanced';
  const units=fitClimate.units;
  const choices=[[-2,'La Niña'],[-1,'La Niña'],[0,'Neutral'],[1,'El Niño'],[2,'El Niño'],[3,'El Niño']].map(([n,phase])=>({key:`mean:${n}`,label:`${phase} · ${n>0?'+':''}${n} ${units} window mean`}));
  if(fitClimate.supports_peak)choices.push({key:'event:3',label:'El Niño · 3 °C event peak'});
  const key=state.exposure==='event'?`event:${state.peak}`:state.scale==='native'?`mean:${state.amplitude}`:'custom';
  $('scenario').innerHTML=choices.map(c=>option(c.key,c.label,key)).join('')+(!choices.some(c=>c.key===key)?option('custom',`Custom · ${state.exposure==='event'?state.peak+' °C peak':state.amplitude+' '+(state.scale==='sd'?'local SD':units)}`, 'custom'):'');
  $('scenario').value=choices.some(c=>c.key===key)?key:'custom';
  const text=id=>$(id).selectedOptions[0]?.textContent||state[id];
  const parts=[state.period==='available'?'Available record':state.period.replace('-','–'),state.source==='auto'?'Preferred available source':sourceName(state.source)];
  if(state.season!=='default')parts.push(state.season);
  if(state.basis!=='default')parts.push(text('basis'));
  if(state.resolution!=='best')parts.push(text('resolution'));
  if(state.minimum!=='1')parts.push(text('minimum'));
  if(state.metric==='enso'){
    parts.push(fitClimate.label,text('window'),AtlasResponse.names[state.model]+' fit'+(state.estimator==='pooled'?' · partially pooled':''));
    if(state.exposure==='event')parts.push(`${state.peak} °C peak · ${text('peakMonth')} ${state.peakYear} · ${state.peakYear+Number(state.harvest)} harvest`);
    else parts.push(`${state.amplitude>0?'+':''}${state.amplitude} ${state.scale==='sd'?'local SD':units} window mean`);
    if(state.evidence!=='all')parts.push(text('evidence'));
    if(state.support!=='all')parts.push(text('support'));
  }
  $('view-summary').textContent=parts.join(' · ');
  $('interpretation').textContent=state.metric==='enso'?'Brown means lower yield; teal means higher yield, relative to neutral ENSO. Open a region for observations and uncertainty. Scenario estimates are not yield forecasts.':state.metric==='trend'?'Change in observed yield per decade. Open a region for its time series and trend uncertainty.':state.metric==='yield'?'Average of the observed harvests in each reporting region. Open a region to see yields and ENSO through time.':'Open a region for its observed yields and ENSO through time.';
}
function heading() {
  const view=mapContext();
  const name = view.kind === 'world' ? '' : countryName(view.country);
  const rec = selected.find(r => r.id === state.unit), feature = shapes?.features.find(f => f.id === state.unit);
  $('title').textContent = view.kind === 'world' ? 'Global crop yields' : view.kind === 'country' ? name : rec?.name || feature?.properties.name || 'Regional records';
  document.title = (state.kind==='region' ? (rec?.name || feature?.properties.name || 'Regional records')+' · ' : '') + $('title').textContent + ' · Agricultural atlas';
  $('breadcrumbs').innerHTML = view.kind === 'world' ? 'WORLD / OBSERVATIONS' : `<a href="${link({kind:'world',country:'',unit:''})}">World</a><span>/</span>${view.kind === 'region' ? `<a href="${link({kind:'country',unit:''})}">${escape(name)}</a><span>/</span>Region` : escape(name)}`;
  $('subtitle').textContent = view.kind === 'world' ? 'Explore observed yields at the reporting resolution available, then open a country and its regions.' : catalog.countries[view.country] ? `${name} · ${selectedLevel(view.country)} · ${catalog.products[state.crop]}` : `${name} · Agricultural records are not yet included in this release.`;
  $('map-heading').textContent = `${state.metric === 'enso' ? 'ENSO yield response'+(state.mode==='advanced'?' · '+state.model:'') : state.metric === 'yield' ? 'Observed average yield' : state.metric==='trend'?'Observed yield trend':state.metric==='latest'?'Last observed harvest':state.metric==='resolution'?'Reporting resolution':'Years with eligible observations'} · ${catalog.products[state.crop]}`;
  const basis = [...new Set(selected.filter(r => r.stats.n && (view.kind === 'world' || r.country === view.country)).map(r => r.basis))];
  $('selection-note').textContent = (state.period === 'available' ? 'Available record: actual dates differ by region.' : `Requested period ${state.period.replace('-', '–')}; the requested window is retained in every region.`) + ` ${basis.length > 1 ? 'Yield denominators in this selection: '+basis.join(', ')+'. Each region identifies its source basis.' : basis.length ? basis[0]==='unknown'?'The source does not specify the yield-area denominator.':'Yield per hectare of ' + basis[0] + ' area.' : ''}`;
  if(state.crop==='rice')$('selection-note').textContent+=` Known rice forms use paddy equivalents (milled ÷ 0.67; brown ÷ 0.80). Unknown forms remain available for relative responses, but not absolute-yield comparisons.`;
  if(state.metric==='enso')$('selection-note').textContent+=`${state.estimator==='pooled'?' Partially pooled estimates.':' Individual estimates.'} `;
  if(state.metric==='enso')$('selection-note').textContent+=state.exposure==='event'?` Scenario: ${state.peak} °C peak in ${state.peakYear}-${String(state.peakMonth).padStart(2,'0')}; crop reporting year ${state.peakYear+Number(state.harvest)}. Each crop window has its own mean exposure.`:` Response at ${state.amplitude>0?'+':''}${state.amplitude} ${state.scale==='sd'?'local standard deviations':fitClimate.units} of ${fitClimate.label}, relative to zero. Window: ${$('window').selectedOptions[0]?.textContent}. All indices use matched years.`;
  $('map-instruction').textContent = view.kind === 'world' ? 'Click a colored reporting unit for its observations, or a country outline to explore its regions.' : 'Click a region to open its observations over the map. Close the panel to continue exploring.';
}
function renderLocations() {
  const view=mapContext();
  const term = $('search').value.trim().toLowerCase();
  const container = $('locations');
  if (view.kind === 'world') {
    const countries = [...new Set([...world.features.map(f=>f.properties.country),...Object.keys(catalog.countries)])].map(country=>({country}));
    countries.sort((a,b) => (Number(!!catalog.countries[b.country]) - Number(!!catalog.countries[a.country])) || countryName(a.country).localeCompare(countryName(b.country)));
    const filtered = countries.filter(c => (countryName(c.country)+' '+c.country).toLowerCase().includes(term));
    $('list-title').textContent = 'Countries';$('list-count').textContent = `${Object.keys(catalog.countries).length} in database`;
    $('search').placeholder = 'Search countries…';
    container.innerHTML = filtered.map(c => {
      const cc = c.country, rs = selected.filter(r=>r.country===cc), n=rs.filter(r=>r.enough&&r.mapped).length, meta=catalog.countries[cc];
      return `<a class="location" href="${link({kind:'country',country:cc,unit:''})}"><div class="row"><b>${escape(countryName(cc))}</b><span class="value">${n ? n+' regions' : '—'}</span></div><small>${meta ? (selectedSeason(cc) || 'No '+catalog.products[state.crop]+' records') + ' · ' + selectedLevel(cc) : 'Records not yet included'}</small>${meta ? `<small>${rs.length ? n+' of '+rs.length+' source series mapped' : 'Choose another crop to explore available records'}</small>` : ''}</a>`;
    }).join('') || '<p class="empty">No countries match this search.</p>';
  } else {
    const units = unitFeatures();
    const records = new Map(selected.filter(r=>r.country===view.country).map(r=>[r.id,r]));
    const filtered = units.filter(f => (f.properties.name+' '+f.id).toLowerCase().includes(term)).sort((a,b)=>a.properties.name.localeCompare(b.properties.name));
    $('list-title').textContent = 'Reporting regions';$('list-count').textContent = `${units.length} reporting units`;
    $('search').placeholder = 'Search regions…';
    container.innerHTML = filtered.map(f => {
      const r=records.get(f.id), st=r?.stats;
      return `<a data-unit="${escape(f.id)}" class="location${f.id===state.unit?' selected':''}" href="${link({kind:'region',country:f.properties.country,unit:f.id,view:view.kind})}"><div class="row"><b>${escape(f.properties.name)}</b><span class="value">${r?.enough ? state.metric==='enso'?responseValue(r):state.metric==='yield' ? fmt(st.mean)+' t/ha' : state.metric==='trend'?fmt(r.value)+' t/ha/decade':state.metric==='latest'?String(st.last):state.metric==='resolution'?r.level:st.n+' years' : '—'}</span></div><small>${st?.n ? st.first+'–'+st.last+' · '+st.n+' years · '+Math.round(st.completeness*100)+'% complete' : 'No eligible observations for this selection'}</small><small>${r ? (r.mapped?'':'No matched boundary · ')+sourceName(r.source)+' · '+escape(r.season)+' · '+escape(r.basis)+' area'+(state.metric==='enso'?' · '+escape(r.status):!r.enough&&st.n?' · '+escape(r.status):'') : 'Open region to inspect other selections'}</small></a>`;
    }).join('') || `<p class="empty">${catalog.countries[view.country] ? 'No regions match this search.' : 'This country awaits the expanding database. Return to the world view or open a country with records.'}</p>`;
  }
}
function legendAndMap() {
  const isEnso=state.metric==='enso',diverging=isEnso||state.metric==='trend', values=selected.filter(r=>r.enough&&r.mapped).map(r=>r.value),max=Math.max(...values,1),lim=isEnso?50:Math.max(...values.map(Math.abs),.1),min=state.metric==='latest'?Math.min(...values,2024):0;
  $('legend-title').textContent = isEnso?'Yield change from neutral · %':state.metric === 'yield' ? (state.crop==='rice'?'Paddy-equivalent yield · t/ha':'Average yield · tonnes per hectare') : state.metric==='trend'?'Yield trend · t/ha per decade':state.metric==='latest'?'Latest observed harvest year':state.metric==='resolution'?'Reporting resolution':'Coverage · years observed';
  $('legend-ramp').style.background=diverging?`linear-gradient(90deg,${RESPONSE_COLORS.join(',')})`:'';
  $('legend-ticks').innerHTML = diverging?[-1,-.5,0,.5,1].map(f=>`<span>${isEnso&&f===-1?'≤ ':isEnso&&f===1?'≥ ':''}${fmt(f*lim,isEnso?0:2)}</span>`).join(''):state.metric==='resolution'?['National','Province / state','District / county'].map(s=>`<span>${s}</span>`).join(''):[0,.25,.5,.75,1].map(f=>`<span>${state.metric==='latest'?Math.round(min+f*(max-min)):fmt(min+f*(max-min),state.metric==='yield'?1:0)}</span>`).join('');
  if(state.metric==='resolution')$('legend-ramp').style.background=`linear-gradient(90deg,${COLORS[0]} 0%,${COLORS[0]} 33.33%,${COLORS[2]} 33.33%,${COLORS[2]} 66.67%,${COLORS[5]} 66.67%,${COLORS[5]} 100%)`;
  $('legend-note').textContent = isEnso?(state.mode==='simple'?'Colors saturate beyond ±50%. Dashed gray edges at close zoom flag extrapolation.':'Fill color = yield response; values beyond ±50% use end colors. Dashed gray boundaries mark extrapolation when zoomed in. Gray fill = unavailable or filtered.'):'Same scale across countries for this selection. No clipping.';
  if (!map) return;
  const view=mapContext(), place=view.kind+':'+view.country;
  const dataKey=[place,M.url({...state,kind:'world',unit:'',country:'',view:'country'}),!!fitRecords,shapes.features.length].join('|');
  if(lastMapData!==dataKey){
    const lookup = new Map(selected.map(r=>[r.id,r]));
    const data = {type:'FeatureCollection', features:shapes.features.map(f=>({...f,properties:{...f.properties,value:lookup.get(f.id)?.value ?? 0,valid:lookup.get(f.id)?.value!=null,extrapolated:isEnso&&!!lookup.get(f.id)?.enough&&!!lookup.get(f.id)?.response?.extrapolated}}))};
    map.getSource('units').setData(data);
    map.setPaintProperty('units','fill-color',['case',['!', ['get','valid']],'#e1e4dd',['interpolate',['linear'],['get','value'],...(diverging?RESPONSE_COLORS.flatMap((c,i)=>[-lim+i*lim/2,c]):COLORS.flatMap((c,i)=>[min+i*Math.max(max-min,.1)/(COLORS.length-1),c]))]]);
    if(state.metric==='resolution')map.setPaintProperty('units','fill-color',['case',['!',['get','valid']],'#e1e4dd',['match',['get','value'],0,COLORS[0],1,COLORS[2],2,COLORS[5],'#e1e4dd']]);
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
function chart(series, enso, scale) {
  const obs=series.observations;
  if(!obs.length)return '<p class="empty">No eligible observations in this source series.</p>';
  const first=obs[0][0],last=obs.at(-1)[0],period=catalog.periods[state.period];
  const x=year=>58+(year-first)/(last-first||1)*410,y=value=>225-(value-scale.lo)/(scale.hi-scale.lo)*185;
  const inPeriod=year=>!period||year>=period[0]&&year<=period[1];
  const hasEnso=enso.values.some(r=>Number.isFinite(r[1])),zero=y(scale.project(0));
  let content='<g class="chart-axes">';
  for(let i=0;i<=4;i++){
    const value=scale.lo+(scale.hi-scale.lo)*i/4,Y=y(value),ev=scale.indexAt(value);
    content+=`<line x1="58" x2="468" y1="${Y}" y2="${Y}" stroke="#dce5de"/><text x="48" y="${Y+4}" text-anchor="end" fill="#176957">${fmt(value,2)}</text>`;
    if(hasEnso&&Math.abs(Y-zero)>14)content+=`<text x="478" y="${Y+4}" fill="#a44c17">${fmt(ev,1)}</text>`;
  }
  if(hasEnso)content+=`<line class="enso-zero" x1="58" x2="468" y1="${zero}" y2="${zero}" stroke="#bc662b" stroke-opacity=".45" stroke-dasharray="3 5"/><text x="478" y="${zero+4}" fill="#a44c17">0</text>`;
  const step=last-first>35?10:5,gap=Math.max(2,(last-first)*.1);
  const ticks=[first,...Array.from({length:last-first+1},(_,i)=>first+i).filter(n=>n%step===0&&n-first>=gap&&last-n>=gap),...(last>first?[last]:[])];
  for(const t of ticks)content+=`<text x="${x(t)}" y="249" text-anchor="middle">${t}</text>`;
  content+='</g><g class="enso-series">';
  enso.values.forEach((r,i)=>{
    if(!Number.isFinite(r[1]))return;
    const previous=enso.values[i-1],Y=y(scale.project(r[1])),X=x(r[0]),opacity=inPeriod(r[0])?1:.28;
    if(previous&&Number.isFinite(previous[1])&&r[0]===previous[0]+1)content+=`<line x1="${x(previous[0])}" y1="${y(scale.project(previous[1]))}" x2="${X}" y2="${Y}" stroke="#bc662b" stroke-width="1.8" stroke-dasharray="5 3" opacity="${inPeriod(r[0])&&inPeriod(previous[0])?1:.28}"/>`;
    content+=`<path class="enso-point" data-year="${r[0]}" data-value="${r[1]}" d="M${X},${Y-3}l3,3l-3,3l-3,-3Z" fill="#bc662b" opacity="${opacity}"><title>${r[0]}: ${escape(fitClimate.label)} ${fmt(r[1],3)} ${escape(fitClimate.units)} · ${escape(enso.window.label)}</title></path>`;
  });
  content+='</g><g class="yield-series">';
  obs.forEach((r,i)=>{
    if(i&&r[0]===obs[i-1][0]+1)content+=`<line x1="${x(obs[i-1][0])}" y1="${y(obs[i-1][1])}" x2="${x(r[0])}" y2="${y(r[1])}" stroke="${inPeriod(r[0])&&inPeriod(obs[i-1][0])?'#237762':'#bdcec5'}" stroke-width="1.6"/>`;
    content+=`<circle cx="${x(r[0])}" cy="${y(r[1])}" r="${inPeriod(r[0])?3.5:2.5}" fill="${inPeriod(r[0])?'#176957':'#bdcec5'}"><title>${r[0]}: ${fmt(r[1],3)} t/ha${r[4]?' (corrected)':''}</title></circle>`;
  });
  content+='</g>';
  return `<svg viewBox="0 0 540 268" role="img" aria-label="Observed yield${hasEnso?' and '+escape(fitClimate.label):''} over time for ${escape(series.name)}. Values are available in the observation table." style="font:12px var(--font);fill:#64746f"><text x="58" y="20" fill="#176957">${series.crop==='rice'&&series.comparable?'Paddy eq. (t/ha)':'Yield (t/ha)'}</text>${hasEnso?`<text class="enso-axis-title" x="528" y="20" text-anchor="end" fill="#a44c17">${escape(fitClimate.label)} (${escape(fitClimate.units)})</text>`:''}${content}</svg>`;
}
function download(name, text, type='text/csv;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadResponses(){
  const view=mapContext(),context=selected.filter(r=>view.kind==='world'||r.country===view.country);
  download(`enso_${state.crop}_${state.index}_${state.window}_${state.model}_${state.period}.csv`,M.csv([
    ['release','series_key','country','unit_id','name','crop','season','area_basis','source','resolution','period','index','index_version','native_units','window','scale','model','exposure_native','response_pct','lo95_pct','hi95_pct','fitted_years','first','last','extrapolated','holdout_skill1','holdout_skill2','bootstrap_draws','shown_on_map','status','calendar_version','exposure_sample_mean','exposure_sample_sd','reference_value','estimator','field_p','field_q_BY','field_family_n','trend_response_pct','max_event_trend_change_pp','checks_complete','checks_stable','pool_group','pool_units','borrow_fraction'],
    ...context.map(r=>{const f=r.fit,m=f?.models?.[state.model],e=r.exposure,v=r.response;return [RELEASE,r.series_key,r.country,r.id,r.name,r.crop,r.season,r.basis,r.source,r.level,state.period,state.index,fitClimate.version,fitClimate.units,state.window,state.scale,state.model,e?.x,v?.value,v?.lo,v?.hi,f?.n,f?.first,f?.last,v?.extrapolated,m?.cv?.[0],m?.cv?.[1],m?.boot_n,r.enough&&r.mapped,r.status,r.calendar_version,f?.x_mean,f?.x_sd,0,state.estimator,r.fieldP,r.fieldQ,r.fieldN,r.reliability?.trend?.value,r.reliability?.maxChange,r.reliability?.complete,r.reliability?.stable,r.check?.group,r.check?.group_units,state.estimator==='pooled'?r.check?.borrow:0];})
  ]));
}
async function detail(token) {
  $('detail').hidden=state.kind!=='region';detailSeries=null;
  if(state.kind!=='region')return;
  $('detail').innerHTML='<p class="empty" role="status">Loading regional observations…</p>';
  const meta=catalog.countries[state.country],record=selected.find(r=>r.id===state.unit);
  if(!meta){$('detail').innerHTML='<p>Country not found. Return to the world map.</p>';return;}
  const data=await observationsFor(state.country,state.crop);if(token!==generation)return;
  const series=data.series.find(r=>r.sid===record?.sid);
  if(!series){
    const alternatives=data.series.filter(r=>r.id===state.unit);
    $('detail').innerHTML='<h2>No series for this selection</h2><p>Choose a source or season with records:</p>'+alternatives.map(r=>`<p><a href="${link({source:r.source,season:r.season,basis:r.basis,resolution:r.level==='ADM0'?'national':'subnational'})}">${escape(r.season)} · ${escape(r.basis)} · ${sourceName(r.source)}</a></p>`).join('');return;
  }
  detailSeries=series;
  if(state.metric==='enso'&&record.check){
    const checkDetails=await load(`robustness/details/${state.crop}/${state.country}.json.gz`);if(token!==generation)return;
    record.check=checkDetails[series.sid];
    record.reliability=AtlasReliability.assess(record.check,state.model,state.estimator,record.exposure.x,record.response);
  }
  const climate=fitClimate,enso=M.ensoSeries(series,climate,state.window),index=new Map(enso.values),scale=M.comparisonScale(series.observations,enso.values),hasIndex=enso.values.some(r=>Number.isFinite(r[1]));
  const summary=series.periods[state.period],period=catalog.periods[state.period],inside=y=>!period||y>=period[0]&&y<=period[1],obs=series.observations.filter(r=>inside(r[0])),raw=series.records.filter(r=>inside(r[0])),trend=record.trend;
  const rawExcluded=raw.filter(r=>!r[9]).length;
  $('detail').innerHTML=`<div class="detail-head"><h2>Observed yield and ENSO</h2><p>${escape(series.season)} · ${escape(series.basis)} area · ${sourceName(series.source)}</p></div>
    <div class="chart-key"><span class="yield-key">● Observed yield · left axis</span>${hasIndex?`<span class="enso-key">◆ ${escape(climate.label)} · right axis</span>`:''}</div>
    <div class="chart-box observed-chart">${chart(series,enso,scale)}</div>
    <div class="stats"><div class="stat"><strong>${fmt(summary.mean)}<small> t/ha</small></strong><small>${series.comparable?'Arithmetic mean':'Source rice basis unknown'}</small></div><div class="stat"><strong>${summary.n}</strong><small>Eligible observed years</small></div><div class="stat"><strong>${summary.n?summary.first+'–'+summary.last:'—'}</strong><small>Actual harvest dates</small></div><div class="stat"><strong>${Math.round(summary.completeness*100)}%</strong><small>Requested span reported</small></div></div>
    ${state.metric==='enso'?AtlasResponse.panel(series,enso,record,state,fitMethods):''}
    ${state.metric==='trend'?`<div class="response-card"><strong>${trend?.value!=null?fmt(trend.value)+' t/ha per decade':'Trend unavailable'}</strong><p>${trend?.value!=null?`95% interval ${fmt(trend.lo)} to ${fmt(trend.hi)}; ${trend.n} observed years. This is the raw-yield trend, separate from the time term in the ENSO model.`:escape(trend?.reason||record.status)}</p></div>`:''}
    <details class="observation-notes"><summary>Observation details and downloads</summary>
    <button id="download">Download observations and QC ↓</button>
    <p class="source-badge">${sourceName(series.source)} · ${level(series.level)} · ${series.mapped?'Matched reporting boundary':'Boundary unavailable; original records retained'}${series.area_weight_ha?` · reference crop area ${fmt(series.area_weight_ha,0)} ha (not annual area)`:''}</p>
    ${series.crop==='rice'?`<p class="rice-note chart-note">${escape(riceNote(series))} Original weights are preserved in the source table and download.</p>`:''}
    ${series.records.some(r=>r[8].some(f=>f.startsWith('lag_alignment:')))?`<p class="chart-note">Harvest-year alignment is flagged by an upstream comparison with national yields. We retain the documented year labels. <a href="${BASE}alignment-summary.json">View the ±1-year sensitivity audit</a>; a stronger ENSO association does not establish the correct calendar.</p>`:''}
    <p class="chart-note">Dark points fall inside the selected period; pale points show the remaining record. Missing years break the lines. The plot retains eligible zero yields, although the log-yield model cannot fit them.</p>
    <p class="chart-note">${hasIndex?`${escape(enso.window.label)} · ${escape(enso.window.note)} ${scale.matched?'One index standard deviation is matched to one yield standard deviation over paired displayed years.':'Automatic right-axis scaling: too little variation to match standard deviations.'} The right axis remains in ${escape(climate.units)}. ${escape(climate.aggregation)}.`:'This index/window lacks complete coverage for the record. Yield observations remain visible.'}</p>
    </details>
    <details><summary>Eligible observations · ${obs.length} years</summary><div class="table-wrap"><table><thead><tr><th>Harvest year</th><th>Yield (t/ha)</th><th>${escape(climate.label)} (${escape(climate.units)})</th><th>Annual area (ha)</th><th>Production (t)</th></tr></thead><tbody>${obs.map(r=>`<tr><td>${r[0]}</td><td>${fmt(r[1],3)}</td><td>${fmt(index.get(r[0]),3)}</td><td>${fmt(r[2],1)}</td><td>${fmt(r[3],1)}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Original source rows and quality flags · ${raw.length} rows, ${rawExcluded} excluded</summary><p>Values below use the original reporting form. Duplicate harvest years are quarantined together; error flags and invalid yields are excluded. Yield-only records are retained when supported by the source. Warnings remain visible. Source year labels are preserved alongside aligned harvest years.</p><div class="table-wrap"><table><thead><tr><th>Source year</th><th>Harvest year</th><th>Original yield</th><th>Used</th><th>QC flags</th></tr></thead><tbody>${raw.map(r=>`<tr><td>${escape(r[5])}</td><td>${r[0]}</td><td>${fmt(r[1],3)}</td><td>${r[9]?'Yes':'No'}${r[4]?' · corrected':''}</td><td>${escape([...r[8],...(r[10]||[])].join('; ')||'None')}</td></tr>`).join('')}</tbody></table></div></details>
    <details><summary>Calendar, provenance, and exclusions</summary><p>Stable series key: ${escape(series.series_key)}. ${level(series.level)}; ${series.members} source administrative member(s). Boundary base year: ${series.base_year??'not specified'}. The source series is never spliced with another reporting tier.</p><p>Calendar source: ${escape(series.calendar.calendar_source||'unassigned')}; planting month ${series.calendar.plant_month??'—'}, harvest month ${series.calendar.harvest_month??'—'}; source year → harvest year offset ${series.calendar.harvest_year_offset??0}. Calendar version ${series.calendar_version}.</p><p>Excluded rows across the full series: ${Object.entries(series.excluded).map(([k,n])=>n+' '+escape(k)).join('; ')||'none'}. Only statistical-outlier errors are restored in the optional fit sensitivity calculation; other exclusions remain.</p><p>${escape(climate.product)}; baseline ${escape(climate.baseline)}; index version ${climate.version}. ${escape(climate.definition)}.</p><p><a href="${BASE}observations/${series.country}-${series.crop}.json.gz">Full country–crop records (compressed JSON)</a> · <a href="${BASE}fits/${state.index}/${state.window}/${series.crop}.json.gz">Complete fit bundle (compressed JSON)</a> · <a href="${BASE}indices.json">Index registry and values</a> · <a href="${BASE}sources.json">Source lineage and corrections</a> · Release ${RELEASE}</p></details>`;
  $('download').onclick=()=>download(`${series.sid}_${state.period}_observations.csv`,M.csv([
    ['release','series_key','source','crop','source_crop','weight_basis','conversion_factor','area_basis','harvest_year','original_yield','annual_area','original_production','corrected','source_year','complete','yield_source','qc_flags','eligible','exclusion_reasons','upstream_primary','source_area_flag','source_production_flag','source_yield_flag','display_yield','display_production','index','index_version','index_units','window','exposure','calendar_version'],
    ...raw.map(r=>[RELEASE,series.series_key,series.source,series.crop,series.source_crop,series.weight_basis,series.conversion_factor,series.basis,...r.slice(0,8),r[8].join('; '),r[9],(r[10]||[]).join('; '),r[11],r[12],r[13],r[14],r[1]==null?null:r[1]*series.conversion_factor,r[3]==null?null:r[3]*series.conversion_factor,state.index,climate.version,climate.units,state.window,index.get(r[0]),series.calendar_version])
  ]));
  if($('show-diagnostics'))$('show-diagnostics').onclick=async()=>{await navigate({mode:'advanced'});document.querySelector('.advanced-diagnostics')?.setAttribute('open','');document.querySelector('.advanced-diagnostics')?.scrollIntoView({block:'nearest'});};
  if($('download-checks'))$('download-checks').onclick=()=>download(`${series.sid}_robustness.json`,JSON.stringify({release:RELEASE,series_key:series.series_key,selection:state,methods:robustMethods,checks:record.check,field:{p:record.fieldP,q:record.fieldQ,family_n:record.fieldN}},null,2));
  if($('download-fit'))$('download-fit').onclick=()=>{
    const f=record.fit,m=f.models[state.model],v=record.response;
    download(`${series.sid}_${state.index}_${state.window}_${state.model}_fit.csv`,M.csv([
      ['release','series_key','index','index_version','units','window','period','model','year','yield','exposure','adjusted_log_yield','intercept','time_coefficient_per_decade','beta','curvature_or_hinge','scenario_exposure','response_pct','lo95','hi95','bootstrap_draws','calendar_version','estimator'],
      ...AtlasResponse.observations(series,enso,f,state.model).map(p=>[RELEASE,series.series_key,state.index,climate.version,climate.units,state.window,state.period,state.model,p.year,p.yield,p.x,p.adjusted,...m.coef.slice(0,3),m.coef[3]??'',v.x,v.value,v.lo,v.hi,m.boot_n,series.calendar_version,state.estimator])
    ]));
  };
}

async function render() {
  const token=++generation;
  const startingPage=lastPage, startingScroll=window.scrollY || 0;
  rememberMapView();
  try {
    const previous=state;
    state=M.parse(location.hash);
    if(state.country.length===2){
      const alias=catalog.aliases[state.unit],country=alias?.split(':')[0]||Object.entries(catalog.aliases).find(([id])=>id.startsWith(state.country+'.'))?.[1].split(':')[0];
      if(country){state.country=country;state.unit=alias||state.unit;history.replaceState(history.state,'',M.url(state));lastHandledHash=location.hash;}
    }
    if(['rice-paddy','rice-milled'].includes(state.crop)){
      state.crop='rice';history.replaceState(history.state,'',M.url(state));lastHandledHash=location.hash;
    }
    if(previous?.kind==='region'&&state.kind!=='region')openerUnit=previous.unit;
    const view=mapContext(), page=view.kind+':'+view.country;
    const listPosition=page===lastPage?$('locations').scrollTop:mapViews.get(page)?.listScroll || 0;
    if(page!==lastPage)$('search').value=mapViews.get(page)?.search || '';
    if(state.kind!=='region'){$('region-overlay').hidden=true;$('detail').hidden=true;}
    if(state.release!==RELEASE)throw new Error(`Release ${state.release} is unavailable. Open the current release using the Agricultural atlas home link.`);
    if(!indexRegistry[state.index])throw new Error('Unknown climate index in this release. Open the Agricultural atlas home link to reset the selection.');
    if(!catalog.products[state.crop])throw new Error('Unknown crop in this link. Open the Agricultural atlas home link to reset the selection.');
    $('status').className='';$('status').textContent='Loading selected records…';
    const data=await summaries(state.crop);if(token!==generation)return;rows=data;
    selected=M.select(rows,state);
    fitClimate=indexRegistry[state.index];fitMethods={...await load('methods.json'),event_profile:fitClimate.event_profile,index_label:fitClimate.label};
    if(!fitClimate.supports_peak&&state.exposure==='event'){state.exposure='season';history.replaceState(history.state,'',M.url(state));lastHandledHash=location.hash;}
    fitRecords=null;trendRecords=null;robustRecords=null;
    if(state.metric==='trend'){trendRecords=await load(`trends/${state.crop}.json.gz`);if(token!==generation)return;selected=M.attachTrends(selected,state,trendRecords);}
    if(state.metric==='enso'){
      try{fitRecords=await fitsFor(state.crop);}catch{fitRecords=null;}
      if(token!==generation)return;
      if(AtlasReliability.inScope(state)){robustRecords=await load(`robustness/${state.crop}.json.gz`);if(token!==generation)return;}
      fitMethods={...fitMethods,robustness:robustMethods};
      selected=M.attachFits(selected,state,fitRecords,fitClimate,fitMethods,robustRecords);
    }
    const cs=view.kind==='world'? [...new Set([...selected.filter(r=>r.stats.n).map(r=>r.country), ...(state.kind==='region'&&catalog.countries[state.country]?[state.country]:[])])]: catalog.countries[view.country]?[view.country]:[];
    // Reuse the loaded national outlines for national records at world scale.
    // Only countries with selected regional records need detailed geometry.
    const nationalIds=new Set(selected.filter(r=>r.level==='ADM0').map(r=>r.id));
    const useWorld=view.kind==='world';
    const needsDetail=c=>!useWorld||selected.some(r=>r.country===c&&r.level!=='ADM0');
    const geos=await mapLimited(cs.filter(c=>catalog.countries[c]?.geometry&&needsDetail(c)),c=>load('geometry/'+c+'.json.gz'));if(token!==generation)return;
    const chosenIds=new Set(selected.map(r=>r.id));
    const national=useWorld?world.features.filter(f=>nationalIds.has(f.id)).map(f=>({...f,properties:{...f.properties,id:f.id,tier:3,level:'ADM0'}})):[];
    shapes={type:'FeatureCollection',features:[...national,...geos.flatMap(g=>g.features).filter(f=>chosenIds.has(f.id))]};
    controls();heading();renderLocations();$('locations').scrollTop=listPosition;overlayChrome();
    await mapReady;if(token!==generation)return;legendAndMap();
    const context=selected.filter(r=>view.kind==='world'||r.country===view.country),valid=context.filter(r=>r.enough&&r.mapped);
    $('status').textContent=view.kind!=='world'&&!catalog.countries[view.country] ? 'Agricultural records for this country await the expanding database.' : `${valid.length.toLocaleString()} reporting regions mapped · ${context.reduce((n,r)=>n+r.stats.n,0).toLocaleString()} eligible annual observations in the selected source series. ${view.kind==='world'?'Open a country to see actual dates and resolution.':selectedSeason(view.country)?'Season: '+selectedSeason(view.country)+' · '+selectedBasis(view.country)+' area.':'Choose another crop to explore the available records.'}`;
    if(state.metric==='enso')$('status').textContent=!fitRecords?'ENSO fit data could not be loaded. Regional yield records remain available.':`${valid.length.toLocaleString()} regions mapped · ${context.filter(r=>r.response).length.toLocaleString()} eligible fits · ${valid.filter(r=>r.response?.extrapolated).length.toLocaleString()} mapped estimates extrapolate. ${state.period==='2011-2020'||state.period==='2015-2024'?'This 10-year period is too short for a 20-year ENSO fit. Choose a longer period; observations remain available.':'Open a region for its fitted years, uncertainty, and holdout skill.'}`;
    await detail(token);
    if(token!==generation)return;
    if(page!==lastPage){window.scrollTo({top:mapViews.get(page)?.scroll || 0,behavior:'instant'});lastPage=page;}
    if(state.kind==='region'&&(previous?.kind!=='region'||page!==startingPage)){
      // A shared link or a selection from a list below the map should still show
      // the map behind the panel. Preserve an already-visible map without moving it.
      const rect=$('map').getBoundingClientRect();
      const visibleBottom=window.innerWidth<=800 ? $('region-overlay').getBoundingClientRect().top : window.innerHeight;
      if(rect.top>=visibleBottom-60||rect.bottom<=60){
        if(page===startingPage)panelReturnScroll={page,scroll:startingScroll};
        window.scrollTo({top:Math.max(0,(window.scrollY||0)+document.querySelector('.legend').getBoundingClientRect().top),behavior:'instant'});
      }
    } else if(state.kind!=='region'&&panelReturnScroll){
      if(panelReturnScroll.page===page)window.scrollTo({top:panelReturnScroll.scroll,behavior:'instant'});
      panelReturnScroll=null;
    }
    finishOverlay();
    if(!location.hash)history.replaceState(null,'',M.url(state));
  } catch(e) { if(token!==generation)return; $('status').className='error';$('status').textContent=e.message; if(state?.kind==='region')$('detail').innerHTML='<p class="empty">'+escape(e.message)+'</p>'; }
}
async function start() {
  try {
    [catalog,world]=await Promise.all([load('catalog.json'),load('world.json')]);
    indexRegistry=await load('indices.json');robustMethods=await load('robust-methods.json');
    initializeMap();
    document.querySelector('.skip').onclick=e=>{e.preventDefault();$('workspace').tabIndex=-1;$('workspace').focus();$('workspace').scrollIntoView({block:'start'});};
    $('controls').onsubmit=e=>e.preventDefault();
    $('quick-controls').onsubmit=e=>e.preventDefault();
    $('enso-controls').onsubmit=e=>e.preventDefault();
    for(const mode of ['simple','advanced'])$(mode+'-mode').onclick=()=>navigate({mode});
    $('settings-link').onclick=e=>{e.preventDefault();$('advanced-settings').focus({preventScroll:true});$('advanced-settings').scrollIntoView({block:'start'});};
    $('return-map').onclick=e=>{e.preventDefault();$('workspace').tabIndex=-1;$('workspace').focus({preventScroll:true});$('workspace').scrollIntoView({block:'start'});};
    $('scenario').onchange=()=>{
      if($('scenario').value==='custom')return;
      const [type,value]=$('scenario').value.split(':');
      return navigate(type==='event'?{exposure:'event',peak:Number(value)}:{exposure:'season',amplitude:Number(value),scale:'native'});
    };
    for(const k of ['crop','metric','period','season','minimum','basis','index','window','scale','resolution','source']) $(k).onchange=()=>navigate({[k]:$(k).value,...(k==='crop'?{season:'default'}:{})});
    for(const k of ['model','exposure','amplitude','peak','peakYear','peakMonth','harvest','evidence','support','estimator'])$(k).onchange=()=>{
      if($(k).checkValidity&&!$(k).checkValidity()){$(k).reportValidity();return;}
      navigate({[k]:$(k).value});
    };
    $('event-preset').onclick=()=>navigate({exposure:'event',peak:3});
    $('download-responses').onclick=downloadResponses;
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
