/* Presentation of the regional page. The release supplies every estimate and validation result. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasRegionalPage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const pct = x => finite(x) ? (x > 0 ? '+' : '') + x.toFixed(1).replace('-', '−') + '%' : 'Unavailable';
  let cleanup = () => {}, lastKey = null, openPanel = null;

  function skillStatus(prediction, aggregate = false) {
    if (aggregate) return 'Forecast skill not yet assessed for this aggregate.';
    if (!finite(prediction?.skill_vs_trend)) return 'Forecast skill not yet assessed.';
    if (prediction.skill_vs_trend <= 0) return 'No improvement on the trend-only estimate in the leave-one-year-out tests with the observed index.';
    if (!prediction.usable) return 'Positive leave-one-year-out skill, but the 80% range of the country panel\'s skill includes zero; shown as conditional.';
    return 'Improves on the trend-only estimate in the leave-one-year-out tests, with the 80% range of the country panel\'s skill above zero.';
  }

  const chanceLine = chance => chance && finite(chance.p_loss20) && finite(chance.p_gain20)   // the scenario contrasts at the central path (19 October 2026)
    ? `<p class="regional-chance">Chance of a 20% loss ${(100 * chance.p_loss20).toFixed(0)}% · of a 20% gain ${(100 * chance.p_gain20).toFixed(0)}%${chance.extrapolated ? ' · beyond the fitted index range' : ''} <span>· from the leave-one-year-out errors</span></p>` : '';
  function headline({prediction, aggregate, crop, missing, withheld, beyondFit, cycleUnresolved, historical, validation, historicalView, chance = null}) {
    if(historicalView && finite(historical?.pct_eb)) {
      const skill=validation?.skill_vs_trend;
      return `<section class="regional-estimate" aria-label="Historical yield response"><div class="regional-estimate-top"><span class="regional-value">${pct(historical.pct_eb)}</span><span>Historical yield response per +1 °C Niño 3.4</span></div>
        <p class="regional-interval">${pct(historical.lo_eb)} to ${pct(historical.hi_eb)} <span>· 95% interval</span></p>
        <p class="regional-skill">${finite(skill) ? (skill>0 ? `${(100*skill).toFixed(1)}% lower squared error than trend only in held-year tests.` : 'No improvement over trend only in held-year tests.') : 'Held-year skill not assessed for this record.'}</p>
        <p class="regional-qualification">${finite(historical.year_first)&&finite(historical.year_last)?historical.year_first+'–'+historical.year_last+' · ':''}${finite(skill)?'Observed ENSO index used in testing. ':''}${historical.historical_only ? 'Current-harvest applicability unassessed.' : 'Current outlook shown separately.'}</p></section>`;
    }
    const value = aggregate ? prediction?.pct_mean : prediction?.pct;
    const lo = aggregate ? prediction?.pct_lo : prediction?.lo;
    const hi = aggregate ? prediction?.pct_hi : prediction?.hi;
    const available = finite(value);
    return `<section class="regional-estimate" aria-label="Yield estimate">
      <div class="regional-estimate-top"><span class="regional-value">${available ? pct(value) : historicalView ? 'Historical response unavailable' : 'Current estimate unavailable'}</span><span>ENSO effect on ${esc(crop.toLowerCase())} yield</span></div>
      ${available ? `<p class="regional-interval">${finite(lo) && finite(hi) ? `${pct(lo)} to ${pct(hi)} <span>· 80% range</span>` : 'ENSO-effect range unavailable.'}</p><p class="regional-qualification">Range for the ENSO effect, not the full harvest uncertainty.</p><p class="regional-skill">${skillStatus(prediction, aggregate)}</p>${chanceLine(chance)}` : `<p class="regional-skill">${esc(missing || 'No ENSO outlook for this harvest in the selected release.')}</p>`}
      ${beyondFit && available ? '<p class="regional-alert">Outside the historical ENSO range.</p>' : ''}
      ${withheld ? '<p class="regional-alert">Yield observations withheld under source terms.</p>' : ''}
      ${cycleUnresolved ? '<p class="regional-alert">Crop cycle unresolved; seasonal timing is uncertain.</p>' : ''}
    </section>`;
  }

  function reset() { cleanup(); cleanup = () => {}; }

  function mount(view, options) {
    reset();
    const page = view.querySelector('.regional-page');
    if (!page) return;
    if (lastKey !== options.key) { openPanel = null; lastKey = options.key; }
    const buttons = [...page.querySelectorAll('[data-regional-panel]')];
    function showPanel(name) {
      openPanel = name;
      for (const button of buttons) {
        const open = button.dataset.regionalPanel === name;
        button.setAttribute('aria-expanded', String(open));
        page.querySelector('#' + button.getAttribute('aria-controls')).hidden = !open;
      }
    }
    for (const button of buttons) button.onclick = () => showPanel(openPanel === button.dataset.regionalPanel ? null : button.dataset.regionalPanel);
    showPanel(openPanel);

    const mapBox = page.querySelector('#cmap'), rows = page.querySelector('.rows');
    let observer, frame = null, drawnWidth = null, removed = false;
    const win = view.ownerDocument.defaultView;
    function layout() {
      frame = null;
      if (removed || !page.isConnected || !mapBox?.getBoundingClientRect || !rows?.getBoundingClientRect) return;
      const width = rows.getBoundingClientRect().width;
      if (!width) return; // No layout in the DOM-only release tests.
      if (width !== drawnWidth) {
        drawnWidth = width;
        const charts = [...rows.querySelectorAll('.row > .chart')];
        options.specs.forEach((spec, i) => {
          charts[i].innerHTML = options.chart({...spec.chart, compact: true, reader: true, width,
            height: (charts.length > 3 ? 500 : 396) / charts.length + (i === charts.length - 1 ? 22 : 0), xAxis: i === charts.length - 1});
        });
      }
      const frames = [...rows.querySelectorAll('[data-chart-frame]')];
      if (!frames.length) return;
      const grid = page.querySelector('.local');
      const stacked = win.getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length === 1;
      const first = frames[0].getBoundingClientRect(), last = frames[frames.length - 1].getBoundingClientRect();
      const offset = stacked ? 0 : first.top - rows.getBoundingClientRect().top;
      const height = stacked ? mapBox.getBoundingClientRect().width : last.bottom - first.top;
      const oldHeight = mapBox.getBoundingClientRect().height;
      mapBox.style.marginTop = offset + 'px';
      mapBox.style.height = height + 'px';
      const map = options.map();
      if (map && (Math.abs(oldHeight - height) > .5 || map.__regionalWidth !== width)) {
        map.__regionalWidth = width;
        map.resize?.();
        if (!map.__cameraInitialized) {
          if (options.camera) map.jumpTo(options.camera);
          else if (options.bounds) map.fitBounds(options.bounds, {padding:16, duration:0, maxZoom:9});
          map.__cameraInitialized = true;
        }
      }
    }
    const schedule = () => {
      if (removed || frame != null) return;
      if (win?.requestAnimationFrame) frame = win.requestAnimationFrame(layout);
      else layout();
    };
    if (win?.ResizeObserver) { observer = new win.ResizeObserver(schedule); observer.observe(rows); }
    layout();
    cleanup = () => { removed = true; observer?.disconnect(); if (frame != null) win?.cancelAnimationFrame?.(frame); };
  }
  return {headline, skillStatus, mount, reset};
});
