/* One calculation path for map colors, panels and downloads. */
(function(root){
const M=typeof module!=='undefined'?require('../global/merged-model.js'):root.AtlasModel;
const RELEASE='2026-09-26-climate-v1',PERIODS={'1981-2024':[1981,2024],'1991-2020':[1991,2020],available:null};
function parse(hash){const s=M.parse(hash),q=new URLSearchParams(hash.split('?')[1]||'');return {...s,release:q.get('release')||RELEASE,crop:q.get('crop')||'maize',layer:['yield','precipitation'].includes(q.get('layer'))?q.get('layer'):'temperature',statistic:q.get('statistic')==='p95'?'p95':'mean',metric:['trend','enso'].includes(q.get('metric'))?q.get('metric'):'mean',period:Object.hasOwn(PERIODS,q.get('period'))?q.get('period'):'1981-2024',evidence:['interval','validated'].includes(q.get('evidence'))?q.get('evidence'):'all',rainUnits:q.get('rainUnits')==='native'?'native':'percent',common:q.get('common')==='1',window:'season',estimator:'individual'};}
function url(s){const base=M.url({...s,release:RELEASE});return base+'&layer='+s.layer+'&statistic='+s.statistic+'&common='+(s.common?'1':'0')+'&rainUnits='+(s.rainUnits||'percent');}
function key(s){return s.layer==='yield'?'yield':(s.layer==='temperature'?'t':'p')+(s.statistic==='p95'?'95':'mean');}
function relativeRain(s){return s.layer==='precipitation'&&s.metric!=='mean'&&s.rainUnits!=='native';}
function unit(s){return s.layer==='yield'?(s.metric==='enso'?'%':s.metric==='trend'?'t/ha per decade':'t/ha'):(s.layer==='temperature'?'°C':relativeRain(s)?'%':'mm/day')+(s.metric==='trend'?' per decade':'');}
// Normalize only the display contrast. Model coefficients and physical rainfall checks stay native.
function displayEstimate(result,s,baseline){
 if(!result||!relativeRain(s))return result;
 const factor=Number.isFinite(baseline)&&baseline>0?100/baseline:null;
 const out={...result,native:result,baseline:baseline??null,displayUnits:unit(s)};
 for(const k of ['value','se','lo','hi'])out[k]=factor!=null&&Number.isFinite(result[k])?result[k]*factor:null;
 if(factor==null)out.reason='Percent change unavailable: no positive observed average';
 return out;
}
function estimate(fit,model,x){
 const f=fit?.models?.[model];if(!f?.coef||!Number.isFinite(x))return null;
 const v=model==='linear'?[x]:[x,model==='quadratic'?x*x:Math.max(x,0)];
 const value=v.reduce((sum,z,i)=>sum+z*f.coef[i+2],0);
 const variance=f.cov?v.reduce((sum,z,i)=>sum+v.reduce((a,w,j)=>a+z*w*f.cov[i][j],0),0):null;
 const se=variance==null?null:Math.sqrt(Math.max(0,variance));
 return {x,value,se,lo:se==null?null:value-1.96*se,hi:se==null?null:value+1.96*se,interval:se!=null&&Math.abs(value)>1.96*se,validated:f.cv?.length===2&&f.cv.every(z=>Number.isFinite(z)&&z>0),extrapolated:x<fit.x_min||x>fit.x_max,neutral:f.neutral,scenarioLevel:f.neutral==null?null:f.neutral+value};
}
const emptyPeriods=()=>Object.fromEntries(Object.keys(PERIODS).map(p=>[p,{n:0,mean:null,first:null,last:null,completeness:0}]));
function select(meta,summary,s){const weather=s.layer!=='yield';return M.select(meta.map(r=>weather?{...r,comparable:true,periods:summary?.[r.sid]?.[key(s)]||emptyPeriods()}:r),{...s,metric:s.metric==='mean'?'yield':s.metric});}
function attach(rows,s,fitRecords,trendRecords,index){return rows.map(r=>{
 if(s.metric==='mean')return r;
 if(s.metric==='trend'){const t=displayEstimate(trendRecords?.[r.sid]?.[s.period],s,r.stats?.mean),enough=r.enough&&Number.isFinite(t?.value);return {...r,trend:t,enough:!!enough,value:enough?t.value:null,status:enough?'Observed trend':t?.reason||'Trend unavailable'};}
 const fit=fitRecords?.[r.sid]?.[s.period],exposure=M.scenario(r,s,index,null,fit),response=s.layer==='yield'?M.estimate(fit,s.model,exposure.x):displayEstimate(estimate(fit,s.model,exposure.x),s,r.stats?.mean);
 let status=fit?.reason||fit?.models?.[s.model]?.reason||'Fit unavailable for this exact selection';
 const invalidPrecip=s.layer==='precipitation'&&response?.scenarioLevel<0;
 if(response)status=invalidPrecip?'Model predicts a negative rainfall level; unsupported scenario':response.reason|| (response.extrapolated?'Outside observed ENSO range':'Fitted association');
 if(response&&s.evidence==='interval'&&!response.interval)status='95% interval includes zero or is unavailable';
 if(response&&s.evidence==='validated'&&!response.validated)status='No positive holdout skill in both layouts';
 if(response&&s.support==='observed'&&response.extrapolated)status='Scenario outside the observed range';
 const enough=r.enough&&Number.isFinite(response?.value)&&!invalidPrecip&&!(s.evidence==='interval'&&!response.interval)&&!(s.evidence==='validated'&&!response.validated)&&!(s.support==='observed'&&response.extrapolated);
 return {...r,fit,response,exposure,enough:!!enough,value:enough?response.value:null,status};
});}
function domain(rows,s){const values=rows.filter(r=>r.enough&&r.mapped&&Number.isFinite(r.value)).map(r=>r.value).sort((a,b)=>a-b);const diverging=s.metric!=='mean';if(!values.length)return {lo:diverging?-1:0,hi:1,diverging};if(diverging){const lim=Math.max(.01,...values.map(Math.abs));return {lo:-lim,hi:lim,diverging};}let lo=Math.min(0,values[0]),hi=values.at(-1);if(hi===lo)hi=lo+1;return {lo,hi,diverging};}
const SEQUENTIAL=['#f3f3cf','#b2d5b5','#68acaa','#397a91','#27496e'],DIVERGING=['#995d24','#d9b58a','#f1f2ed','#8ac4bf','#167c78'];
function color(value,d){if(!Number.isFinite(value))return '#dce1dd';const colors=d.diverging?DIVERGING:SEQUENTIAL,x=Math.max(0,Math.min(1,(value-d.lo)/(d.hi-d.lo)))*4,i=Math.min(3,Math.floor(x)),t=x-i;const rgb=h=>[1,3,5].map(j=>parseInt(h.slice(j,j+2),16));return '#'+rgb(colors[i]).map((a,j)=>Math.round(a*(1-t)+rgb(colors[i+1])[j]*t).toString(16).padStart(2,'0')).join('');}
function observations(rows,s){const col={tmean:1,t95:2,pmean:3,p95:4}[key(s)],period=PERIODS[s.period];return rows.filter(r=>(!period||r[0]>=period[0]&&r[0]<=period[1])&&Number.isFinite(r[col])).map(r=>[r[0],r[col]]);}
const api={RELEASE,PERIODS,parse,url,key,unit,relativeRain,displayEstimate,estimate,select,attach,domain,color,observations};if(typeof module!=='undefined')module.exports=api;else root.ClimateModel=api;
})(typeof window!=='undefined'?window:this);
