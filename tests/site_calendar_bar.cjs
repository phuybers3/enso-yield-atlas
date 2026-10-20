const assert = require('node:assert/strict');
const fs = require('node:fs');
const cal = require('../site/calendar-bar.js');
const clock = require('../site/calendar.js');
clock.todayISO = () => '2026-10-11';
const row = {harvest_year:2026, plant_date:'2026-05-15', harvest_date:'2026-10-15'};
assert.equal(cal.day('2027-02-29'), null);
assert.equal(cal.annualTimeline({...row,plant_date:'2024-02-29',harvest_date:'2024-03-01'},2024)[0].days,366);
assert.equal(cal.stages(row).length,1,'Missing stages must not be invented');
assert.equal(cal.stages({...row,cycle_unresolved:true}).length,0);
assert.equal(cal.annualTimeline({...row,plant_date:'2025-10-23',harvest_date:'2026-05-01'},2026).length,2,'Keep both actual calendar years');
assert.match(cal.render({row:{...row,confidence:'monthly'},year:2026,crop:'rice'}),/Growing season: May 2026 – Oct 2026/);
assert.doesNotMatch(cal.render({row:{...row,confidence:'monthly'},year:2026,crop:'rice'}),/15 May/,'Do not imply daily source precision for a monthly calendar');
assert.equal(cal.title('Butte, California','rice',2026),'Butte, California: predicted rice yield 2026');
assert.equal(cal.stages({...row,fill_start_date:'2026-09-01',fill_end_date:'2026-08-01'}).length,1,'Invalid stage range withheld');
const calendarRelease=process.argv[2]||'2026-10-10';
const d = JSON.parse(fs.readFileSync(require('node:path').join(__dirname,`../site/data/calendar-details/${calendarRelease}/USA.json`)));
const e = d.series['26885501949759214'];
const full = cal.mergeDetails({...row,calendar_source:'riceatlas'},e,d.columns);
assert.equal(cal.stages(full).length,4,'Butte carries three documented stages plus growing season');
assert.equal(full.plant_start_date,'2026-04-15');
assert.equal(full.fill_start_date,'2026-09-06');
assert.equal(cal.mergeDetails({...row,calendar_source:'different'},e,d.columns).fill_start_date,undefined,'Reject a different source version');
assert.equal(cal.mergeDetails({...row,calendar_source:'riceatlas',harvest_date:'2026-10-14'},e,d.columns).fill_start_date,undefined,'Reject mismatched dated windows');
assert.match(cal.render({row:full,year:2026,crop:'rice',season:'Main season'}),/data-calendar-start="2026-04-11"/);
assert.match(cal.render({row:full,year:2026,crop:'rice',season:'Main season'}),/data-calendar-end="2027-04-11"/);
assert.match(cal.render({row:full,year:2026,crop:'rice'}),/crop-calendar-marker" style="left:50%" aria-label="Today/);
console.log('PASS: source alignment, cross-year seasons, leap days, fallback, monthly precision, real Butte stages, and heading.');

const w=clock.rollingWindow('2026-10-11');
assert.deepEqual(w,{lo:clock.day('2026-04-11'),mid:clock.day('2026-10-11'),hi:clock.day('2027-04-11')});
assert.equal(clock.windowFraction(w.mid,w),.5);assert.equal(clock.windowFraction(w.lo,w),0);assert.equal(clock.windowFraction(w.hi,w),1);
assert.equal(clock.rollingWindow('2024-08-31').lo,clock.day('2024-02-29'));
assert.equal(clock.rollingWindow('2026-08-31').hi,clock.day('2027-02-28'));
const windows=cal.rollingTimeline([
  {...row,plant_date:'2025-10-23',harvest_date:'2026-05-01'},
  {...row,harvest_year:2027,plant_date:'2026-10-23',harvest_date:'2027-05-01'}
],'2026-10-11');
assert.equal(windows.bands.length,2,'Keep both published seasons that overlap the rolling window');
assert.equal(windows.bands[0].left,0);assert.equal(windows.bands[1].left+windows.bands[1].width,100);
assert(windows.bands.every(b=>b.left>=0&&b.width>0&&b.left+b.width<=100));
assert.equal(cal.rollingTimeline([row],'2028-10-11').bands.length,0,'Do not invent future seasons');
console.log('PASS rolling window: exact center, six calendar months, leap/month-end dates, clipped cross-year stages and no invented recurrence.');
