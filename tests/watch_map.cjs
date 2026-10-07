// Exercise the real renderer with release geometry, including overlapping sources.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { parseHTML } = require('linkedom');
const ROOT = path.join(__dirname, '../watch');
const { window: domWindow } = parseHTML(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
const document = domWindow.document, handlers = {}, maps = {};
const window = { addEventListener: (name, fn) => { handlers[name] = fn; }, scrollTo() {} };
Object.defineProperty(domWindow.HTMLSelectElement.prototype, 'value', {
  get() { return this._value ?? this.querySelector('option')?.value ?? ''; },
  set(v) { this._value = v; }, configurable: true
});
class MapStub {
  constructor(options) { maps[options.container] = this; this.sources = {}; this.events = {}; this.canvas = document.createElement('canvas'); }
  on(name, layer, callback) { this.events[name] = callback || layer; if (name === 'load') setTimeout(layer, 0); }
  addSource(id, source) { this.sources[id] = source; }
  addLayer() {} addControl() {} fitBounds() {} remove() {}
  getCanvas() { return this.canvas; }
}
const maplibregl = { Map: MapStub, NavigationControl: class {} };
window.maplibregl = maplibregl;
const location = { search: '', hash: '#/country/IND?crop=rice' };
const context = vm.createContext({ window, document, location, maplibregl, URLSearchParams, Response, DecompressionStream,
  fetch: async p => new Response(fs.readFileSync(path.join(ROOT, p))), console });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), context);
const ready = async id => {
  for (let i = 0; i < 200 && !maps[id]?.sources.u; i++) await new Promise(r => setTimeout(r, 5));
  assert(maps[id]?.sources.u, `map ${id} loaded`);
  return maps[id].sources.u.data.features;
};
(async () => {
  await handlers.DOMContentLoaded();
  for (const iso of ['IND', 'IDN', 'USA']) {
    if (iso !== 'IND') {
      delete maps.map1; delete maps.map2;
      location.hash = `#/country/${iso}?crop=rice`; await handlers.hashchange();
    }
    const features = await ready('map1'); await ready('map2');
    const units = JSON.parse(fs.readFileSync(path.join(ROOT, `data/2026-10-06/units/${iso}.json`))).crops.rice;
    assert.equal(features[0].properties.level, 'national', 'national context must be underneath local data');
    assert.equal(features.length, Object.keys(units).length + 1, 'only matching reporting units plus national context');
    for (const f of features.slice(1)) {
      assert(units[f.properties.id], 'no overlapping alternative-source geometry');
      assert.equal(f.properties.u.e, units[f.properties.id].e, 'unclipped numerical response retained');
    }
    const sample = features.find(f => f.properties.u.e != null);
    maps.map1.events.mousemove({ point: { x: 10, y: 10 }, features: [{ ...sample, properties: { ...sample.properties, u: JSON.stringify(sample.properties.u) } }] });
    const tooltip = document.querySelector('#map1 .tooltip').textContent;
    assert(tooltip.includes(sample.properties.u.n));
    const value = sample.properties.u.e;
    assert(tooltip.includes(`expected ${value > 0 ? '+' : ''}${value.toFixed(0)}%`), 'serialized map properties still show exact values');
  }
  const select = document.getElementById('map2-var'); select.value = 't'; select.onchange();
  await ready('map2');
  assert(document.getElementById('map2-legend').textContent.includes('−1.5 °C'));
  select.value = 'r'; select.onchange(); await ready('map2');
  assert(document.getElementById('map2-legend').textContent.includes('−30%'));
  console.log('PASS Watch map layering, source selection, unaltered unit values, serialized tooltips and weather legends');
})().catch(e => { console.error(e); process.exitCode = 1; });
