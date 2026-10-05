// Checks on a Crop Watch data release: internal consistency, season assignments, scenario ranges, aggregation and the
// reproducibility of the headline from the exported panels. Run: node tests/watch_data.cjs [issue]
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const issue = process.argv[2] || '2026-09';
const base = path.join(__dirname, '..', 'watch', 'data', issue);
const J = f => JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'));
const summary = J('summary.json'), countries = J('countries.json'), panels = J('panels.json'), ledger = J('ledger.json'), ip = J('index_path.json'), manifest = J('manifest.json');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// 1. counts in the summary are the counts in the files
assert.strictEqual(summary.counts.panels, panels.length, 'panel count');
assert.strictEqual(summary.counts.countries, countries.length, 'country count');
assert.strictEqual(summary.counts.panels_scored, panels.filter(p => p.season_so_far).length, 'scored count');
assert.strictEqual(summary.counts.panels_with_nowcast, panels.filter(p => p.implied.usable).length, 'nowcast count');
assert.strictEqual(summary.headline.panels, panels.filter(p => p.implied.usable).length, 'headline population');
// 2. no NaN leaked into JSON, and every panel has the three sentences
const raw = fs.readFileSync(path.join(base, 'panels.json'), 'utf8'); assert.ok(!/\bNaN\b|Infinity/.test(raw), 'NaN or Infinity in panels.json');
for (const p of panels) { assert.ok(p.sentences.expected && p.sentences.season && p.sentences.implied, `sentences missing for ${p.label}`); }
// 3. season and year assignments
for (const p of panels) {
  assert.ok([2026, 2027].includes(p.target_year), `target year ${p.target_year} for ${p.label}`);
  assert.ok(['harvested', 'in the ground', 'not planted'].includes(p.status), `status ${p.status}`);
  if (p.status === 'not planted') assert.ok(!p.frac_elapsed || p.frac_elapsed <= 0, `not planted with elapsed window: ${p.label}`);
  if (p.status === 'harvested') assert.ok(p.frac_elapsed >= 0.999, `harvested with partial window: ${p.label}`);
  if (p.status === 'in the ground') assert.ok(p.frac_elapsed > 0 && p.frac_elapsed < 0.999, `in the ground outside (0,1): ${p.label}`);
  if (p.implied.usable) { assert.ok(p.frac_elapsed >= 0.5, `usable nowcast before half the window: ${p.label}`); assert.ok(p.implied.nowcast_se_pct < 40, `usable nowcast with s.e. ${p.implied.nowcast_se_pct}: ${p.label}`); assert.ok(p.hindcast && p.hindcast.skill_vs_trend > 0, `usable nowcast without positive hindcast skill: ${p.label}`); }
}
// 4. scenario ranges bracket the median and are ordered with the index (a monotone response)
for (const p of panels) {
  const e = p.expected; if (e.pct_medium == null) continue;
  const lo = Math.min(e.pct_low, e.pct_high), hi = Math.max(e.pct_low, e.pct_high);
  assert.ok(lo - 1e-6 <= e.pct_medium && e.pct_medium <= hi + 1e-6, `median outside scenario range: ${p.label} ${e.pct_low} ${e.pct_medium} ${e.pct_high}`);
  assert.ok(near(e.mt_medium, e.pct_medium / 100 * p.production_mt, 0.002 + 0.0006 * p.production_mt + 0.01 * Math.abs(e.mt_medium)), `tonnes and percent disagree: ${p.label}`); // pct is rounded to 0.1
}
// 5. country aggregates are sums over their panels, with no double counting
const byIso = {}; for (const p of panels) { (byIso[p.iso3] ||= []).push(p); }
for (const c of countries) {
  const ps = byIso[c.iso3] || []; const prod = ps.reduce((s, p) => s + (p.production_mt || 0), 0), mt = ps.reduce((s, p) => s + (p.expected.mt_medium || 0), 0);
  assert.strictEqual(c.panels, ps.length, `panel count for ${c.iso3}`);
  assert.ok(near(c.production_mt, prod, 0.01 + 0.001 * prod), `production for ${c.iso3}: ${c.production_mt} vs ${prod}`);
  assert.ok(near(c.expected.mt_medium, mt, 0.01 + 0.001 * Math.abs(mt)), `expected tonnes for ${c.iso3}`);
  const keys = ps.map(p => `${p.crop_code}|${p.season}`); assert.strictEqual(new Set(keys).size, keys.length, `duplicate crop-season in ${c.iso3}`);
}
// 6. the headline reproduces from the panels
const use = panels.filter(p => p.implied.usable); const w = use.reduce((s, p) => s + p.production_mt, 0);
const wi = use.reduce((s, p) => s + p.implied.nowcast_pct * p.production_mt, 0) / w, ii = use.reduce((s, p) => s + (p.implied.index_medium_pct || 0) * p.production_mt, 0) / w;
assert.ok(near(summary.headline.weather_implied_pct, wi, 0.02), `headline weather-implied ${summary.headline.weather_implied_pct} vs ${wi}`);
assert.ok(near(summary.headline.index_implied_pct, ii, 0.02), `headline index-implied ${summary.headline.index_implied_pct} vs ${ii}`);
assert.ok(near(summary.headline.production_mt, w, 0.5), 'headline production');
// 7. unit files: every panel country has a file, keys unique, values finite or null, expected within scenario bounds
const unitDir = path.join(base, 'units'); let nUnits = 0;
for (const iso of Object.keys(byIso)) {
  const f = path.join(unitDir, `${iso}.json`); assert.ok(fs.existsSync(f), `missing units/${iso}.json`);
  const u = JSON.parse(fs.readFileSync(f, 'utf8')); assert.strictEqual(u.iso3, iso);
  for (const [cf, recs] of Object.entries(u.crops)) { for (const [k, r] of Object.entries(recs)) { nUnits++; for (const v of ['e', 'lo', 'hi', 'r', 't', 'rr', 'tr', 'f']) if (r[v] != null) assert.ok(Number.isFinite(r[v]), `non-finite ${v} in ${iso}/${cf}/${k}`); if (r.e != null && r.lo != null && r.hi != null) assert.ok(Math.min(r.lo, r.hi) - 1e-6 <= r.e && r.e <= Math.max(r.lo, r.hi) + 1e-6, `unit expected outside range ${iso}/${cf}/${k}`); if (r.rr != null) assert.ok(r.rr >= 0 && r.rr <= 1, `rank out of [0,1] ${iso}/${cf}/${k}`); } }
}
// 8. ledger and index path
assert.ok(ledger.length > 100 && ledger.every(r => 'count' in r), 'ledger rows'); assert.ok(ip.months.length === ip.observed_rel.length && ip.months.includes(summary.index_last_month), 'index path months');
// 9. manifest covers every file with a matching hash
const crypto = require('crypto'); let checked = 0;
for (const [f, m] of Object.entries(manifest.files)) { const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(base, f))).digest('hex'); assert.strictEqual(h, m.sha256, `hash mismatch ${f}`); checked++; }
// 10. geometry referenced by the release exists
const geo = path.join(__dirname, '..', 'global', 'data', summary.geometry_release, 'geometry'); assert.ok(fs.existsSync(geo), 'geometry release present');
for (const iso of Object.keys(byIso).slice(0, 200)) { const g = path.join(geo, `${iso}.json.gz`); if (fs.existsSync(g)) { zlib.gunzipSync(fs.readFileSync(g)); } }
console.log(`PASS watch ${issue}: ${panels.length} panels, ${countries.length} countries, ${nUnits} unit records, ${use.length} usable nowcasts, headline ${summary.headline.weather_implied_pct}% vs ${summary.headline.index_implied_pct}% over ${summary.headline.production_mt} Mt, ${checked} files hashed`);
