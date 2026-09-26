const assert=require('assert'),fs=require('fs'),zlib=require('zlib'),path=require('path');
const M=require('../global/merged-model.js'),R=require('../global/merged-reliability.js'),V=require('../global/merged-response.js');
const root=path.join(__dirname,'../global/data'),base=path.join(root,M.BASE_RELEASE),next=path.join(root,M.RELEASE);
const read=(dir,f)=>JSON.parse(f.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(path.join(dir,f))):fs.readFileSync(path.join(dir,f)));
assert(Math.abs(R.normalP(1.96)-.0499957903)<1e-7);assert.equal(R.normalP(0),1);assert(R.normalP(8)<2e-15);
const a=R.byAdjust([{key:'a',p:.001},{key:'b',p:.02},{key:'c',p:.3}]);
assert(Math.abs(a.q.get('a')-.0055)<1e-12);assert(Math.abs(a.q.get('b')-.055)<1e-12);
const state=M.parse('#/country/USA?crop=wheat&metric=enso&estimator=pooled&evidence=fdr');
assert.equal(M.parse(M.url(state)).estimator,'pooled');assert.equal(M.parse(M.url(state)).evidence,'fdr');
const data=read(base,'wheat.json.gz'),fits=read(base,'fits/nino34/season/wheat.json.gz'),checks=read(next,'robustness/wheat.json.gz'),climate=read(base,'indices.json').nino34;
const resolve=s=>M.attachFits(M.select(data,s),s,fits,climate,{},checks);
const world=resolve({...state,kind:'world',country:'',evidence:'all'}),country=resolve({...state,evidence:'all'});
assert(world.some(r=>r.response&&r.fieldN>100));
for(let i=0;i<world.length;i++){assert.equal(world[i].fieldN,country[i].fieldN);assert.equal(world[i].fieldQ,country[i].fieldQ);}
const filtered=resolve(state),supported=resolve({...state,support:'observed'});
for(let i=0;i<filtered.length;i++){assert.equal(world[i].fieldQ,filtered[i].fieldQ);assert.equal(world[i].fieldQ,supported[i].fieldQ);if(filtered[i].enough)assert(filtered[i].fieldQ<=.1);}
const ordinary=resolve({...state,estimator:'individual',evidence:'all'});
const picked=ordinary.find(r=>r.country==='USA'&&r.check?.models?.linear?.pooled?.coef);assert(picked);
const detailed=read(next,'robustness/details/wheat/USA.json.gz')[picked.sid];
picked.check=detailed;picked.reliability=R.assess(detailed,'linear','individual',picked.response.x,picked.response);
const html=V.reliabilityPanel(picked,{...state,estimator:'individual'},{robustness:read(next,'methods.json')});
assert(html.includes('Reliability of this response'));assert(html.includes('Matched holdout skill'));assert(html.includes('50%'));assert(html.includes('Event omissions'));assert(!html.includes('undefined'));assert(!html.includes('NaN'));
const pooled=country.find(r=>r.sid===picked.sid);assert(pooled.fit.models.linear.coef[2]===detailed.models.linear.pooled.coef[2]);
const unavailable=resolve({...state,period:'1991-2020',evidence:'all'});assert(!unavailable.some(r=>r.enough));assert(unavailable.some(r=>r.status.includes('1981–2024')));
const example={models:{linear:{individual:{trend:{coef:[0,0,-.1]},events:[{event:'e',fit:{coef:[0,0,.1]}}]}}}};
assert(R.assess(example,'linear','individual',1,{value:10}).signChanged);
example.models.linear.individual.events[0].fit=null;assert(!R.assess(example,'linear','individual',1,{value:10}).complete);
console.log('PASS pooled selection and URL, unavailable scope, scenario stability, BY reference values, zoom/filter-invariant test families, full regional checks.');
