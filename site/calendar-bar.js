/* Isolated calendar component. It reads published dates and never estimates a crop stage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calendar.js'));
  else root.AtlasCalendarBar = factory(root.AtlasCalendar);
})(typeof self !== 'undefined' ? self : this, function (calendar) {
  'use strict';
  const DAY = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STAGES = {
    growing: {label: 'Growing season', color: '#abb99e'},
    planting: {label: 'Planting', color: '#c39432'},
    filling: {label: 'Grain filling', color: '#8772b2'},
    harvest: {label: 'Harvest', color: '#3a887a'}
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function day(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t / DAY : null;
  }
  function dateWords(value, monthly) {
    if (day(value) == null) return '';
    const p = value.slice(0, 10).split('-').map(Number);
    return (monthly ? '' : p[2] + ' ') + MONTHS[p[1] - 1] + ' ' + p[0];
  }
  function rangeWords(a, b, monthly) {
    const left = dateWords(a, monthly), right = dateWords(b, monthly);
    return left === right ? left : left + ' – ' + right;
  }
  function mergeDetails(row, entry, columns) {
    if (!row || !entry) return row;
    const a = entry.rows.find(a => a[0] === row.harvest_year);
    if (!a) return row;
    const details = Object.fromEntries(columns.map((c, i) => [c, a[i]]));
    // A later database revision must not silently alter a frozen release's calendar.
    if (details.plant_date !== row.plant_date || details.harvest_date !== row.harvest_date || entry.source !== row.calendar_source) return row;
    return Object.assign({}, row, details, {fill_source: entry.fill_source || null});
  }
  function stages(row) {
    if (!row || row.cycle_unresolved || day(row.plant_date) == null || day(row.harvest_date) == null || day(row.harvest_date) < day(row.plant_date)) return [];
    return [
      ['growing', 'plant_date', 'harvest_date'],
      ['planting', 'plant_start_date', 'plant_end_date'],
      ['filling', 'fill_start_date', 'fill_end_date'],
      ['harvest', 'harvest_start_date', 'harvest_end_date']
    ].flatMap(([kind, first, last]) => {
      const a = day(row[first]), b = day(row[last]);
      return a != null && b != null && b >= a && b - a <= 400
        ? [Object.assign({kind, start: row[first], end: row[last]}, STAGES[kind])] : [];
    });
  }
  function annualTimeline(row, fallbackYear) {
    const spans = stages(row), dates = spans.flatMap(s => [s.start, s.end]);
    const first = dates.length ? Math.min(...dates.map(s => Number(s.slice(0, 4)))) : Number(fallbackYear);
    const last = dates.length ? Math.max(...dates.map(s => Number(s.slice(0, 4)))) : first;
    if (!Number.isInteger(first) || last - first > 2) return [];
    return Array.from({length: last - first + 1}, (_, i) => {
      const year = first + i, start = day(year + '-01-01'), end = day((year + 1) + '-01-01'), n = end - start;
      const bands = spans.flatMap(s => {
        const lo = Math.max(start, day(s.start)), hi = Math.min(end, day(s.end) + 1);
        return hi > lo ? [Object.assign({}, s, {left: 100 * (lo - start) / n, width: 100 * (hi - lo) / n})] : [];
      });
      const months = MONTHS.map((label, m) => ({label, left: 100 * (day(year + '-' + String(m + 1).padStart(2, '0') + '-01') - start) / n}));
      return {year, start, days: n, bands, months};
    });
  }
  function rollingTimeline(rows, date = calendar.todayISO()) {
    const range = calendar.rollingWindow(date);
    if (!range) return null;
    const position = d => 100 * calendar.windowFraction(d, range);
    const bands = rows.flatMap(row => stages(row).flatMap(stage => {
      const lo = Math.max(range.lo, day(stage.start)), hi = Math.min(range.hi, day(stage.end) + 1);
      return hi > lo ? [{...stage, monthly:row.confidence === 'monthly', left:position(lo), width:position(hi)-position(lo)}] : [];
    }));
    const months = [];
    const begin = new Date(range.lo * DAY);
    for (let m = new Date(Date.UTC(begin.getUTCFullYear(),begin.getUTCMonth(),1)); m.getTime()/DAY < range.hi; m = new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth()+1,1))) {
      const start = Math.max(m.getTime()/DAY,range.lo), next = Date.UTC(m.getUTCFullYear(),m.getUTCMonth()+1,1)/DAY;
      const end = Math.min(next,range.hi);
      months.push({label:MONTHS[m.getUTCMonth()] + (m.getUTCMonth() === 0 ? ' ’' + String(m.getUTCFullYear()).slice(-2) : ''),
        left:position(start), center:position((start+end)/2), showLabel:end-start >= 14});
    }
    return {...range, bands, months};
  }
  function title(place, crop, year) {
    return place + ': predicted ' + crop.toLowerCase() + ' yield ' + year;
  }
  function render(options) {
    const row = options.row || {}, markerDate = options.date || calendar.todayISO();
    const timeline = rollingTimeline(options.rows || [row], markerDate);
    if (!timeline) return '';
    const visible = timeline.bands, detailed = visible.some(s => s.kind !== 'growing');
    const source = options.sourceLabel || row.calendar_source || '';
    const iso = d => new Date(d * DAY).toISOString().slice(0,10);
    let html = '<section class="crop-calendar crop-calendar-rolling" data-calendar-start="' + iso(timeline.lo) + '" data-calendar-end="' + iso(timeline.hi) + '" aria-label="' + esc(options.crop + ' crop calendar, ' + dateWords(iso(timeline.lo)) + ' to ' + dateWords(iso(timeline.hi))) + '">';
    html += '<div class="crop-calendar-heading"><span>Typical ' + esc(options.crop.toLowerCase()) + ' calendar</span>';
    html += '<span class="crop-calendar-season">' + esc(options.season || 'main season') + '</span></div>';
    html += '<div class="crop-calendar-year"><div class="crop-calendar-plot">';
    html += '<div class="crop-calendar-months">' + timeline.months.filter(m=>m.showLabel).map(m => '<span style="left:' + m.center + '%">' + m.label + '</span>').join('') + '</div>';
    html += '<div class="crop-calendar-track">';
    html += timeline.months.slice(1).map(m => '<span class="crop-calendar-grid" style="left:' + m.left + '%"></span>').join('');
    visible.forEach(b => {
      const label = b.label + ': ' + rangeWords(b.start, b.end, b.kind === 'growing' && b.monthly);
      const rail = detailed && b.kind !== 'growing' ? ' crop-calendar-rail-' + b.kind : '';
      html += '<span class="crop-calendar-band' + rail + '" tabindex="0" role="img" aria-label="' + esc(label) + '" style="left:' + b.left + '%;width:' + b.width + '%;background:' + b.color + '"><span class="crop-calendar-tip">' + esc(label) + '</span></span>';
    });
    const markerLabel = options.date ? 'Selected date' : 'Today';
    html += '<span class="crop-calendar-marker" style="left:50%" aria-label="' + markerLabel + ': ' + esc(dateWords(markerDate)) + '"><span>' + markerLabel + '</span></span>';
    html += '</div></div></div>';
    if (visible.length) {
      const key = [...new Map(visible.map(s => [s.kind,s])).values()];
      html += '<div class="crop-calendar-key">' + key.map(s => '<span><i style="background:' + s.color + '"></i>' + s.label + '</span>').join('') + '</div>';
      if (!detailed) html += '<p class="crop-calendar-dates">Stage dates unavailable in this window.</p>';
    } else html += '<p class="crop-calendar-dates">' + (row.cycle_unresolved ? 'Crop cycle unresolved; stage timing unavailable.' : stages(row).length ? 'No published growing season in this window.' : 'Calendar unavailable for this crop and season.') + '</p>';
    const precision = row.confidence === 'monthly' ? 'Months only' : row.confidence === 'approximate' ? 'Approximate timing' : '';
    if (source || precision || row.fill_source) html += '<details class="crop-calendar-source"><summary>Calendar source</summary><p>' + esc([source, precision, row.fill_source ? 'Grain filling: ' + row.fill_source : ''].filter(Boolean).join(' · ')) + '</p></details>';
    html += '</section>';
    return html;
  }
  return {day, dateWords, rangeWords, mergeDetails, stages, annualTimeline, rollingTimeline, render, title, STAGES};
});
