/* The one calendar function of the atlas: the phase, progress and signed offsets of a calendar row at a date.
   It reproduces phase_at of 4_ag/analysis/lib/calendar_status.py (the oracle) and the contract of
   4_ag/platform/SCHEMA.md: dates are whole calendar days compared with Date.UTC arithmetic so a daylight-saving
   transition cannot shift a day; a date outside the published range, or a row without both dates, is unavailable
   and is never clamped. tests/site_calendar.cjs asserts every named case and every row of
   site/fixtures/calendar_fixture.json against this file. Loaded as a browser global (AtlasCalendar) and as a
   CommonJS module. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AtlasCalendar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PHASES = ['unavailable', 'pre-planting', 'active', 'post-harvest'];
  const DAY = 86400000;
  // A whole-day number (days since the epoch, UTC) from an ISO date string; null for anything that is not one.
  function day(v) {
    if (v == null) return null;
    const s = String(v).slice(0, 10), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);                       // reject 2027-02-29 and the like: the components must round-trip
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return Math.round(t / DAY);
  }
  function phaseAt(row, date, range) {
    const out = {phase: 'unavailable', progress: null, days_from_planting: null, days_from_harvest: null};
    const d = day(date), plant = day(row && row.plant_date), harvest = day(row && row.harvest_date);
    const lo = range ? day(range[0]) : null, hi = range ? day(range[1]) : null;
    if (d == null || plant == null || harvest == null || lo == null || hi == null || d < lo || d > hi) return out;
    const dfp = d - plant, dfh = d - harvest;
    out.days_from_planting = dfp; out.days_from_harvest = dfh;
    if (d < plant) out.phase = 'pre-planting';
    else if (d > harvest) out.phase = 'post-harvest';
    else { out.phase = 'active'; out.progress = (100 * dfp) / (harvest - plant); }
    return out;
  }
  // "Planting −20 days", "Planting day", "Harvest +3 days": the signed offset spelled the way the legend does.
  function offsetLabel(anchor, n) {
    if (n == null || !Number.isFinite(n)) return `${anchor} date unavailable`;
    if (n === 0) return `${anchor} day`;
    return `${anchor} ${n < 0 ? '−' : '+'}${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}`;
  }
  // The same offset in words a legend can use: "20 days before planting".
  function offsetWords(anchor, n) {
    if (n == null || !Number.isFinite(n)) return `${anchor} date unavailable`;
    if (n === 0) return `${anchor} day`;
    return `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n < 0 ? 'before' : 'after'} ${anchor}`;
  }
  function todayISO(now) { const d = now || new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  // Calendar months, with month-end clamping (31 August -> 28/29 February).
  function rollingWindow(date = todayISO()) {
    const mid = day(date);
    if (mid == null) return null;
    const d = new Date(mid * DAY);
    const shifted = months => {
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last)) / DAY;
    };
    return {lo:shifted(-6), mid, hi:shifted(6)};
  }
  // Give the two six-month intervals equal screen width so today is exactly central.
  function windowFraction(value, range) {
    return value <= range.mid ? .5 * (value - range.lo) / (range.mid - range.lo)
      : .5 + .5 * (value - range.mid) / (range.hi - range.mid);
  }
  return {PHASES, day, phaseAt, offsetLabel, offsetWords, todayISO, rollingWindow, windowFraction};
});
