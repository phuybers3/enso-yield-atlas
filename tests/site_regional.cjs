// Distinguish missing skill from a failed test, including aggregates and incomplete validation.
const assert = require('node:assert/strict');
const regional = require('../site/regional-page.js');
const {parseHTML} = require('linkedom');
const read = args => parseHTML(regional.headline({crop:'Rice', ...args})).document;
for (const usable of [true, false]) {
  assert.match(regional.skillStatus({usable, skill_vs_trend:null}), /not yet assessed/);
  assert.match(regional.skillStatus({usable, skill_vs_trend:-.2}), /No improvement/);
}
assert.match(regional.skillStatus({usable:true,skill_vs_trend:.2}), /^Improves/);
assert.match(regional.skillStatus({usable:false,skill_vs_trend:.2}), /shown as conditional/);   // the wording of the leave-one-year-out gate (release 2026-10-19)
assert.match(regional.skillStatus({usable:true,skill_vs_trend:.2},true), /not yet assessed for this aggregate/);
let d = read({prediction:{pct:0,lo:-2,hi:2,skill_vs_trend:null}});
assert.equal(d.querySelector('.regional-value').textContent,'0.0%');
assert.match(d.querySelector('.regional-interval').textContent,/−2.0% to \+2.0%/);
assert.match(d.querySelector('.regional-qualification').textContent,/ENSO effect.*full harvest uncertainty/);
d = read({prediction:{pct:2,lo:null,hi:null},withheld:true,beyondFit:true,cycleUnresolved:true});
assert.match(d.querySelector('.regional-interval').textContent,/unavailable/);
assert.equal(d.querySelectorAll('.regional-alert').length,3);
d = read({prediction:null,missing:'No outlook for this harvest'});
assert.equal(d.querySelector('.regional-value').textContent,'Current estimate unavailable');
assert.equal(d.querySelector('.regional-interval'),null);
d = read({prediction:{pct_mean:-1.5,pct_lo:-4,pct_hi:2},aggregate:true});
assert.equal(d.querySelector('.regional-value').textContent,'−1.5%');
assert.match(d.querySelector('.regional-skill').textContent,/aggregate/);
console.log('PASS regional presentation: unknown, failed and incomplete skill; aggregates; zero and absent estimates; uncertainty and exceptions.');
