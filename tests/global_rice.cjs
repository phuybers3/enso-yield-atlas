const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../global/model.js'),R=require('../global/response.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'../global/data',p)));
const cat=read('2026-09-26/catalog.json'),climate=read('enso/2026-09-26/nino34.json');
const metadata=read('rice-conversion.json');assert.equal(metadata.milled_per_paddy_ratio,M.RICE_RECOVERY);
const summary=M.RICE_SOURCES.flatMap(c=>read('2026-09-26/'+c+'.json'));
const snapshot=JSON.stringify(summary),rows=M.riceRows(summary),catalog=M.riceCatalog(cat);
assert.equal(rows.length,1643);assert.equal(rows.filter(r=>r.periods.available.n).length,1559);
assert.equal(rows.filter(r=>r.country==='KR').length,10);assert(rows.filter(r=>r.country==='KR').every(r=>r.source_crop==='rice-paddy'));
assert.equal(new Set(rows.map(M.fitKey)).size,rows.length);
const byProduct=Object.fromEntries(M.RICE_SOURCES.map(c=>[c,read('fits/2026-09-26/'+c+'.json')]));
const fitSnapshot=JSON.stringify(byProduct),fits=M.riceFits(rows,byProduct);
let obsCount=0,fitCount=0;
for(const [country,meta] of Object.entries(cat.countries)){
  const raw=M.RICE_SOURCES.filter(c=>meta.crops[c]).flatMap(c=>read(`2026-09-26/observations/${country}-${c}.json`).series);
  for(const r of M.riceRows(raw)){
    const source=raw.find(s=>s.crop===r.source_crop&&M.fitKey(s)===M.fitKey(r));
    const factor=r.source_crop==='rice-milled'?1/.67:1;
    assert.equal(r.conversion_factor,factor);
    for(let i=0;i<r.observations.length;i++){
      const a=r.observations[i],b=source.observations[i];
      assert.equal(a[0],b[0]);assert.equal(a[1],b[1]*factor);assert.equal(a[2],b[2]);assert.equal(a[3],b[3]*factor);assert.equal(a[4],b[4]);
      assert(Math.abs(a[1]-a[3]/a[2])<1e-5*Math.max(1,a[1]));obsCount++;
    }
    assert.deepEqual(r.original_observations,source.observations);
    const index=M.ensoSeries(r,climate);assert.deepEqual(index,M.ensoSeries(source,climate),'Conversion must not alter crop windows or ENSO observations');
    for(const [period,limits] of Object.entries(cat.periods)){
      const observations=r.observations.filter(v=>!limits||v[0]>=limits[0]&&v[0]<=limits[1]);
      assert.equal(r.periods[period].n,observations.length);
      if(observations.length)assert(Math.abs(r.periods[period].mean-observations.reduce((a,v)=>a+v[1],0)/observations.length)<1e-10);
      else assert.equal(r.periods[period].mean,null);
      const f=fits[M.fitKey(r)]?.[period],original=byProduct[r.source_crop][M.fitKey(r)]?.[period];
      if(!f?.models)continue;
      for(const model of ['linear','quadratic','hinge']){
        assert.deepEqual(f.models[model].coef.slice(1),original.models[model].coef.slice(1));
        assert.equal(f.models[model].coef[0],original.models[model].coef[0]+Math.log(factor));
        assert.deepEqual(f.models[model].cov,original.models[model].cov);
        assert.deepEqual(f.models[model].cv,original.models[model].cv);
        for(const n of [-3,-1,0,1,3])assert.deepEqual(M.estimate(f,model,n),M.estimate(original,model,n));
        const adjusted=R.observations(r,index,f,model),old=R.observations(source,index,original,model);
        for(let i=0;i<old.length;i++)assert(Math.abs(adjusted[i].adjusted-old[i].adjusted)<1e-12);
        fitCount++;
      }
    }
  }
}
for(const period of M.PERIODS)for(const basis of ['default','planted','harvested']){
  const state={...M.parse(''),crop:'rice',period,basis};
  const selection=M.select(rows,state);assert.equal(new Set(selection.map(r=>r.id)).size,selection.length);
  assert.deepEqual(M.parse(M.url(state)),state);
  if(period==='available'&&basis==='default')assert.equal(new Set(selection.filter(r=>r.enough).map(r=>r.country)).size,9);
}
// Empty paddy records must not hide a usable milled series; valid zero stays zero.
const p=summary.find(r=>r.country==='KR'&&r.crop==='rice-paddy'),m=summary.find(r=>r.country==='KR'&&r.crop==='rice-milled'&&M.fitKey(r)===M.fitKey(p));
const empty={...p,periods:{...p.periods,available:{...p.periods.available,n:0,mean:null}}};
assert.equal(M.riceRows([empty,m])[0].source_crop,'rice-milled');
assert.equal(M.riceRows([{...m,observations:[[2000,0,1,0,false]]}])[0].observations[0][1],0);
assert.equal(JSON.stringify(summary),snapshot);assert.equal(JSON.stringify(byProduct),fitSnapshot);
assert(catalog.countries.IN.crops.rice.length&&catalog.countries.ID.crops.rice.length);assert(!cat.products.rice);
console.log(`PASS: unified rice across nine countries; ${obsCount} converted observations and ${fitCount} fits checked, source preservation, 10 overlaps removed, exact-period means, unchanged ENSO responses/intervals/CV and fit residuals.`);
