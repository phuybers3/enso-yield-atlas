// Validate every prepared summary against its observation slice without map code.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const M=require('../global/model.js'),root=path.join(__dirname,'../global/data/2026-09-26');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const cat=read('catalog.json'),manifest=read('manifest.json');
for(const [name,hash] of Object.entries(manifest.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash,name);
let summaries=0,observations=0;
const key=s=>[s.country,s.id,s.crop,s.season,s.basis].join('|');
for(const crop of Object.keys(cat.products)) {
  const prepared=read(crop+'.json'),lookup=new Map(prepared.map(s=>[key(s),s]));assert.equal(lookup.size,prepared.length);
  for(const [cc,country] of Object.entries(cat.countries)) {
    if(!country.crops[crop])continue;
    const geom=new Set(read('geometry/'+cc+'.json').features.map(f=>f.id));
    for(const s of read('observations/'+cc+'-'+crop+'.json').series) {
      assert(geom.has(s.id));assert.equal(new Set(s.observations.map(r=>r[0])).size,s.observations.length);
      for(const r of s.observations){assert(r[1]>=0&&r[2]>0&&r[3]>=0);assert(Math.abs(r[1]-r[3]/r[2])<1e-5*Math.max(1,r[1]));observations++;}
      for(const [period,range] of Object.entries(cat.periods)) {
        const rows=s.observations.filter(r=>!range||r[0]>=range[0]&&r[0]<=range[1]),a=lookup.get(key(s)).periods[period];
        assert.equal(a.n,rows.length);
        if(rows.length){const mean=rows.reduce((v,r)=>v+r[1],0)/rows.length;assert(Math.abs(mean-a.mean)<1e-10);assert.equal(a.first,rows[0][0]);assert.equal(a.last,rows.at(-1)[0]);assert(Math.abs(a.completeness-rows.length/(range?range[1]-range[0]+1:a.last-a.first+1))<1e-10);}
        else assert.equal(a.mean,null);
        summaries++;
      }
    }
  }
  for(const period of M.PERIODS)for(const metric of ['yield','coverage'])for(const minimum of ['1','80'])for(const basis of ['default','planted','harvested']) {
    const state={...M.parse(''),crop,period,metric,minimum,basis};
    assert.deepEqual(M.parse(M.url(state)),state);
    const chosen=M.select(prepared,state);assert.equal(new Set(chosen.map(r=>r.id)).size,chosen.length,'No overlapping seasonal/basis rows');
    for(const r of chosen)if(r.enough){assert(r.stats.n>0);if(minimum==='80')assert(r.stats.completeness>=.8);}
  }
}
const wheat=read('wheat.json'),state={...M.parse(''),crop:'wheat'};
const japan=M.select(wheat,state).filter(r=>r.country==='JP'&&r.enough);
assert(japan.length>0);assert(japan.every(r=>r.stats.n<20),'Short wheat records remain visible');
assert.equal(M.select(wheat,state).filter(r=>r.country==='IN').every(r=>r.season==='Rabi'),true);
const zero={...wheat[0],basis:'planted',periods:{available:{n:1,mean:0,first:2000,last:2000,completeness:1}}};
assert.equal(M.select([zero],state)[0].value,0,'Zero yield must be distinct from missing');
assert.equal(M.select([{...zero,periods:{available:{n:0,mean:null,first:null,last:null,completeness:0}}}],state)[0]?.value??null,null);
assert.equal(M.csv([['Peru, coast','"quoted"']]),'"Peru, coast","""quoted"""\r\n');
console.log(`PASS: ${observations} observed rows, ${summaries} period summaries, release checksums, all crops/periods/bases, unique geography, short Japanese wheat records, zero vs missing, and shareable routes.`);
