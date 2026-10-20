/* Add the calendar below the local map without changing the map renderer or crop mask. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.AtlasCalendarPage = api; api.install(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SOURCES = {riceatlas:'RiceAtlas',user_pairs:'Hultgren local calendar',user_windows:'Hultgren local calendar',hultgren_median:'Hultgren median dates',giews:'FAO GIEWS',fao_cc:'FAO crop calendar',geoglam:'GEOGLAM',asap:'ASAP',hvstat_derived:'HarvestStat',hvstat_literature:'HarvestStat literature calendar',ggcmi:'GGCMI'};
  function route(hash) {
    const [path, query] = hash.replace(/^#\/?/, '').split('?');
    let parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    if (['season','response','record'].includes(parts[0])) parts = parts.slice(1);
    return {iso:parts[0], key:parts[1], q:new URLSearchParams(query || '')};
  }
  function normalizedHash(hash) {
    const i = hash.indexOf('?');
    if (i < 0) return hash;
    const q = new URLSearchParams(hash.slice(i + 1));
    if (!['planting','harvest','calendar'].includes(q.get('layer'))) return hash;
    q.set('layer','progress');
    return hash.slice(0,i) + '?' + q.toString();
  }
  function selection(D, r) {
    const crop = r.q.get('crop');
    const family = D.catalog.crops[crop]?.family || (D.catalog.families.includes(crop) ? crop : 'maize');
    const ps = (D.availablePanels || D.panels).filter(p => p.iso3 === r.iso && p.crop_family === family)
      .sort((a,b) => (b.baseline_production_mt || 0) - (a.baseline_production_mt || 0));
    const season = r.q.get('season');
    const panel = ps.find(p => p.crop_code === crop && p.season === season) || ps.find(p => p.season === season) || ps.find(p => p.crop_code === crop) || ps[0];
    return {family, panel, year:Number(r.q.get('harvest')) || panel?.harvest_year};
  }
  function seriesFor(unit, panel) {
    return unit.series.filter(s => s.crop_code === panel.crop_code && s.season === panel.season)
      .sort((a,b) => a.tier-b.tier || (b.n || 0)-(a.n || 0))[0];
  }
  function calendarRow(units, series, year, family) {
    const modern = !!units.columns.calendar;
    const columns = modern ? units.columns.calendar : units.columns.windows;
    if (!columns) return null;
    const rows = (modern ? series.calendar : series.windows) || [];
    let row = rows.map(a => Object.fromEntries(columns.map((c,i) => [c,a[i]]))).find(w => w.harvest_year === year);
    if (!row || modern) return row || null;
    return {...row,plant_date:row.start_date,harvest_date:row.end_date,calendar_source:row.source,
      cycle_unresolved:units.iso3 === 'BRA' && family === 'maize' && ['first','second'].includes(row.cycle) && ['main','Annual'].includes(series.season)};
  }
  function install(win) {
    const doc = win.document, cache = new Map();
    const detailBase = doc.currentScript?.dataset.calendarBase || 'data/calendar-details';
    let hosting;
    async function dataURL(path) {
      if (win.location.hostname !== 'phuybers3.github.io') return path;
      if (!hosting) hosting = win.fetch('hosting.json').then(r => {
        if (!r.ok) throw new Error('Calendar deployment metadata unavailable');
        return r.json();
      }).then(h => {
        if (!/^https:\/\/raw\.githubusercontent\.com\/phuybers3\/enso-yield-atlas\/[0-9a-f]{40}\/site\/$/.test(h.data_base)) throw new Error('Invalid calendar deployment location');
        return h.data_base;
      });
      return (await hosting) + path;
    }
    async function read(path) {
      // The atlas has already read a unit file before drawing its heading.
      if (win.__atlas?.cache.has(path)) return win.__atlas.cache.get(path);
      if (!cache.has(path)) cache.set(path, dataURL(path).then(url => win.fetch(url)).then(r => r.ok ? r.json() : null).catch(() => null));
      return cache.get(path);
    }
    function normalizeRoute() {
      const h = normalizedHash(win.location.hash);
      if (h !== win.location.hash) win.history.replaceState(null,'',win.location.pathname + win.location.search + h);
    }
    function simplifyControls(view) {
      const select = view.querySelector('#layer-sel');
      if (!select || select.dataset.cropCalendar) return;
      select.dataset.cropCalendar = '1';
      for (const option of Array.from(select.querySelectorAll('option'))) {
        if (['planting','harvest'].includes(option.value)) option.remove();
        if (option.value === 'progress') option.textContent = 'Crop calendar';
      }
    }
    async function enhance() {
      const view = doc.getElementById('view');
      if (!view) return;
      simplifyControls(view);
      if (doc.getElementById('crop-calendar-slot')) return;
      const h = view.querySelector('h1'), mapColumn = view.querySelector('.local-map'), D = win.__atlas?.D;
      if (!h || !D?.panels || !mapColumn) return;
      const hash = win.location.hash, release = D.release, r = route(hash);
      let {family,panel,year} = selection(D,r);
      const selectedPage=view.querySelector('.regional-page');
      if(selectedPage?.dataset.crop) {panel={...panel,crop_code:selectedPage.dataset.crop,season:selectedPage.dataset.season};year=Number(selectedPage.dataset.harvest);family=D.catalog.crops[panel.crop_code]?.family || family;}
      if (!panel) return;
      const key = r.key || r.iso;
      const slot = doc.createElement('div');
      slot.id = 'crop-calendar-slot';
      const mapLegend = mapColumn.querySelector('.legend');
      (mapLegend || mapColumn.firstElementChild).after(slot);
      const current = () => slot.isConnected && win.location.hash === hash && D.release === release;
      const path = D.contract === '2026-10-09' ? 'data/' + release + '/units/' + r.iso + '.json' : 'display/' + release + '/units/' + r.iso + '-' + family + '.json';
      const units = await read(path), unit = units?.units[key];
      // A state aggregate can contain different local calendars. Never borrow one county's dates.
      if (!unit) { slot.hidden = true; return; }
      const series = unit.series.find(s=>String(s.id)===selectedPage?.dataset.series) || seriesFor(unit,panel);
      let row = series ? calendarRow(units,series,year,family) : null;
      const columns = units.columns.calendar || units.columns.windows || [];
      let calendarRows = series ? [...new Set((series.calendar || series.windows || []).map(a=>a[columns.indexOf('harvest_year')]))]
        .map(y=>calendarRow(units,series,y,family)).filter(Boolean) : [];
      const render = () => {
        if (!current()) return;
        const place = h.textContent.split(':')[0];
        if (h.dataset.calendarTitle !== 'preserve') h.textContent = win.AtlasCalendarBar.title(place,family,year);
        slot.innerHTML = win.AtlasCalendarBar.render({row,rows:calendarRows,year,crop:family,
          season:panel.season === 'main' ? 'Main season' : panel.season === 'Annual' ? 'Annual record' : panel.season + ' season',
          sourceLabel:row && SOURCES[row.calendar_source]});
        const provenance = view.querySelector('#regional-calendar-detail');
        if (provenance) {
          slot.querySelector('.crop-calendar')?.classList.toggle('single-year', slot.querySelectorAll('.crop-calendar-year').length === 1);
          provenance.replaceChildren();
          const source = slot.querySelector('.crop-calendar-source');
          if (source) provenance.appendChild(source);
          const explanation = doc.createElement('p');
          explanation.textContent = "The calendar gives typical timing, not observations of this year's field operations. The window runs six months either side of today and includes published seasons crossing it. Documented stage windows can overlap.";
          provenance.appendChild(explanation);
        }
      };
      render();
      const available = await read(detailBase + '/releases.json');
      if (!series || !available?.releases.includes(release) || !current()) return;
      const details = await read(detailBase + '/' + release + '/' + r.iso + '.json');
      if (details?.release === release && details.series) {
        row = win.AtlasCalendarBar.mergeDetails(row,details.series[String(series.id)],details.columns);
        calendarRows = calendarRows.map(r=>win.AtlasCalendarBar.mergeDetails(r,details.series[String(series.id)],details.columns));
        render();
      }
    }
    // Run before the renderer reads the route, including saved links to the former date-offset maps.
    normalizeRoute();
    win.addEventListener('hashchange',normalizeRoute,true);
    const start = () => {
      const view = doc.getElementById('view');
      if (!view) return;
      const update = () => enhance().catch(e => win.console.warn('Crop calendar unavailable',e.message));
      new win.MutationObserver(update).observe(view,{childList:true,subtree:true});
      update();
    };
    if (doc.readyState === 'loading') win.addEventListener('DOMContentLoaded',start);
    else start();
  }
  return {route,normalizedHash,selection,seriesFor,calendarRow,install};
});
