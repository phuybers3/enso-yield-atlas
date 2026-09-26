const assert=require('assert'),fs=require('fs'),path=require('path');
const M=require('../global/model.js'),R=require('../global/response.js');
const read=p=>JSON.parse(fs.readFileSync(path.join(__dirname,'../global/data',p)));
const climate=read('enso/2026-09-26/nino34.json'),methods=read('fits/2026-09-26/methods.json'),fits=read('fits/2026-09-26/wheat.json');
const rows=read('2026-09-26/wheat.json');
const f={x_min:-1,x_max:1,models:{quadratic:{coef:[0,0,.2,-.1],cov:[[.01,.002],[.002,.003]],cv:[.2,.1]}}};
let e=M.estimate(f,'quadratic',2);assert(Math.abs(e.log)<1e-15);assert(Math.abs(e.se**2-(4*.01+16*.003+16*.002))<1e-12);assert(e.extrapolated&&e.validated);
assert.equal(M.estimate(f,'quadratic',0).value,0);assert.equal(M.estimate(f,'quadratic',0).se,0);
f.models.hinge={coef:[0,0,-.2,.5],cov:[[.01,0],[0,.01]],cv:[-.2,.1]};assert.equal(M.estimate(f,'hinge',-2).log,.4);assert.equal(M.estimate(f,'hinge',2).log,.6);assert(!M.estimate(f,'hinge',2).validated);
let s=M.parse('#/region/IN/IN.ADM2.00267?crop=wheat&metric=enso&model=quadratic&amplitude=3&view=world');
assert.deepEqual(M.parse(M.url(s)),s);
let result=M.attachFits(M.select(rows,s),s,fits,climate,methods),nanded=result.find(r=>r.id===s.unit);
assert(nanded.enough&&nanded.response.extrapolated);assert(nanded.response.value<0);assert(nanded.response.lo<nanded.response.value&&nanded.response.hi>nanded.response.value);
s={...s,exposure:'event',peak:3,peakYear:2026,peakMonth:11,harvest:'1'};
e=M.scenario(nanded,s,climate,methods);
const expected=['1997-11','1997-12','1998-01','1998-02','1998-03','1998-04'].reduce((a,k)=>a+climate.monthly[k]*3/1.85,0)/6;
assert(Math.abs(e.x-expected)<1e-12);assert.notEqual(e.x,3);assert.equal(e.reportingYear,2027);
assert(Math.abs(M.scenario(nanded,{...s,peakYear:2030},climate,methods).x-expected)<1e-12,'Rebasing the year must preserve scenario exposure');
assert.notEqual(M.scenario(nanded,{...s,peakMonth:8},climate,methods).x,expected,'Changing event timing must change the crop exposure');
for(const period of ['1991-2020','2001-2020']){
 const rr=M.attachFits(M.select(rows,{...s,period}),{...s,period},fits,climate,methods);
 assert(rr.filter(r=>r.fit?.models).every(r=>r.fit.years.every(y=>y>=+period.slice(0,4)&&y<=+period.slice(5))));
}
const short=M.attachFits(M.select(rows,{...s,period:'2015-2024'}),{...s,period:'2015-2024'},fits,climate,methods);assert(short.every(r=>!r.enough));assert(short.some(r=>r.status.includes('Needs 20')));
const safe=M.attachFits(M.select(rows,s),{...s,exposure:'season',amplitude:3,support:'observed'},fits,climate,methods);assert(safe.filter(r=>r.enough).every(r=>!r.response.extrapolated));
const series=read('2026-09-26/observations/IN-wheat.json').series.find(r=>r.id===nanded.id&&r.season===nanded.season&&r.basis===nanded.basis);
const enso=M.ensoSeries(series,climate),points=R.observations(series,enso,nanded.fit,'quadratic');assert.equal(points.length,nanded.fit.n);assert(points.every(p=>Number.isFinite(p.adjusted)));
const html=R.panel(series,enso,nanded,{...s,exposure:'season'},methods);assert.equal((html.match(/class="fit-observation"/g)||[]).length,25);assert(!html.includes('NaN'));assert(html.includes('Outside observed ENSO range'));
console.log('PASS: nonlinear contrasts/covariance, peak versus seasonal exposure, event timing/rebasing, fixed-period eligibility, extrapolation filter, and observed regression data.');
