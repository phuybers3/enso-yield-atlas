// site/calendar.js against the calendar contract: the named cases of the fixture (Planting −20, +26 and 0, the
// harvest day and the day after, a December-to-January season, 29 February inside and outside the range, missing
// dates, the range ends and the two cycles of one unit), then every pilot row of the fixture at each fixture date.
// The expected values were written by 4_ag/analysis/lib/calendar_status.py (phase_at), the oracle.
// Run: node tests/site_calendar.cjs
const fs = require('fs'), path = require('path'), assert = require('assert');
const cal = require('../site/calendar.js');
const FIX = path.join(__dirname, '../site/fixtures/calendar_fixture.json');
const same = (a, b) => (a == null && b == null) || (typeof a === 'number' && typeof b === 'number' ? Object.is(a, b) || Math.abs(a - b) <= 1e-12 : a === b);
// The exact contract examples, independent of the fixture file.
const R = ['2023-03-09', '2027-12-31'], usa = {plant_date: '2026-05-06', harvest_date: '2026-09-25'};
assert.deepEqual(cal.phaseAt(usa, '2026-04-16', R), {phase: 'pre-planting', progress: null, days_from_planting: -20, days_from_harvest: -162});
assert.deepEqual(cal.phaseAt(usa, '2026-06-01', R), {phase: 'active', progress: (100 * 26) / 142, days_from_planting: 26, days_from_harvest: -116});
assert.deepEqual(cal.phaseAt(usa, '2026-05-06', R), {phase: 'active', progress: 0, days_from_planting: 0, days_from_harvest: -142});
assert.deepEqual(cal.phaseAt(usa, '2026-09-25', R), {phase: 'active', progress: 100, days_from_planting: 142, days_from_harvest: 0});
assert.deepEqual(cal.phaseAt(usa, '2026-09-26', R), {phase: 'post-harvest', progress: null, days_from_planting: 143, days_from_harvest: 1});
assert.deepEqual(cal.phaseAt({plant_date: '2026-12-01', harvest_date: '2027-01-31'}, '2027-01-01', R), {phase: 'active', progress: (100 * 31) / 61, days_from_planting: 31, days_from_harvest: -30});
assert.deepEqual(cal.phaseAt({plant_date: '2023-12-01', harvest_date: '2024-04-30'}, '2024-02-29', R), {phase: 'active', progress: (100 * 90) / 151, days_from_planting: 90, days_from_harvest: -61});
assert.equal(cal.phaseAt({plant_date: '2027-12-01', harvest_date: '2028-04-30'}, '2028-02-29', R).phase, 'unavailable', 'outside the range: unavailable, not clamped');
assert.equal(cal.phaseAt({plant_date: '2027-12-01', harvest_date: '2028-04-30'}, '2028-02-29', [R[0], '2028-12-31']).days_from_planting, 90);
assert.equal(cal.phaseAt({plant_date: null, harvest_date: '2027-04-30'}, '2027-03-15', R).phase, 'unavailable');
assert.equal(cal.phaseAt(usa, '2023-03-08', R).phase, 'unavailable'); assert.equal(cal.phaseAt(usa, '2028-01-01', R).phase, 'unavailable');
assert.equal(cal.phaseAt(usa, '2023-03-09', R).phase, 'pre-planting'); assert.equal(cal.phaseAt(usa, '2027-12-31', R).phase, 'post-harvest');
assert.equal(cal.phaseAt(usa, '2027-02-29', R).phase, 'unavailable', 'an impossible date is unavailable');
assert.equal(cal.phaseAt(usa, 'today', R).phase, 'unavailable');
assert.equal(cal.offsetLabel('Planting', -20), 'Planting −20 days'); assert.equal(cal.offsetLabel('Planting', 26), 'Planting +26 days');
assert.equal(cal.offsetLabel('Planting', 0), 'Planting day'); assert.equal(cal.offsetLabel('Harvest', 1), 'Harvest +1 day'); assert.equal(cal.offsetLabel('Planting', null), 'Planting date unavailable');
assert.equal(cal.offsetWords('planting', -20), '20 days before planting'); assert.equal(cal.offsetWords('harvest', 3), '3 days after harvest');
// Daylight-saving transitions in the local zone of the test machine cannot move a day: a season across a spring and an autumn transition.
assert.equal(cal.phaseAt({plant_date: '2026-03-01', harvest_date: '2026-11-30'}, '2026-11-30', R).days_from_planting, 274);
let checked = 17;
if (fs.existsSync(FIX)) {
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  for (const c of fx.cases) {
    const got = cal.phaseAt(c.row, c.date, c.range), exp = c.expected;
    for (const k of ['phase', 'progress', 'days_from_planting', 'days_from_harvest']) assert(same(got[k], exp[k]), `${c.name}: ${k} ${got[k]} != ${exp[k]} (${c.note})`);
    checked++;
  }
  const col = Object.fromEntries(fx.columns.map((c, i) => [c, i])), ecol = fx.expected_columns;
  fx.rows.forEach((r, i) => {
    const row = {plant_date: r[col.plant_date], harvest_date: r[col.harvest_date]};
    fx.dates.forEach((d, j) => {
      const got = cal.phaseAt(row, d, fx.published_range), exp = fx.expected[i][j];
      ecol.forEach((k, m) => assert(same(got[k], exp[m]), `row ${r[col.series_id]} (${r[col.unit_key]}, ${r[col.harvest_year]}) at ${d}: ${k} ${got[k]} != ${exp[m]}`));
      checked++;
    });
  });
  console.log(`PASS calendar: contract examples, ${fx.cases.length} named cases and ${fx.rows.length} fixture rows at ${fx.dates.length} dates (${checked} checks), range ${fx.published_range.join(' to ')}`);
} else console.log(`PASS calendar: contract examples (${checked} checks); fixture ${FIX} not present, fixture rows skipped`);
