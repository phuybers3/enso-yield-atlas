/* Scenario-specific checks and field testing, independent of map navigation. */
(function(root){
  function inScope(s){return s.index==='nino34'&&s.window==='season'&&s.period==='1981-2024';}
  function contrast(f,model,x){
    if(!f?.coef||!Number.isFinite(x))return null;
    const v=model==='linear'?[x]:[x,model==='quadratic'?x*x:Math.max(x,0)];
    const log=v.reduce((a,z,i)=>a+z*f.coef[2+i],0),value=100*Math.expm1(log);
    return Number.isFinite(value)?{log,value,extrapolated:x<f.x_min||x>f.x_max}:null;
  }
  function assess(check,model,estimator,x,base){
    const c=check?.models?.[model]?.[estimator];
    if(!c||!base)return null;
    const trend=contrast(c.trend,model,x),events=(c.events||[]).map(e=>({...e,response:contrast(e.fit,model,x)}));
    const valid=events.filter(e=>e.response),worst=valid.slice().sort((a,b)=>Math.abs(b.response.value-base.value)-Math.abs(a.response.value-base.value))[0];
    const threshold=Math.max(5,.5*Math.abs(base.value));
    const complete=!!trend&&events.length>0&&valid.length===events.length;
    const signChanged=[trend,...valid.map(e=>e.response)].filter(Boolean).some(r=>r.value*base.value<0);
    const maxChange=Math.max(...[trend,...valid.map(e=>e.response)].filter(Boolean).map(r=>Math.abs(r.value-base.value)),0);
    return {trend,events,worst,complete,signChanged,maxChange,threshold,stable:complete&&!signChanged&&maxChange<=threshold};
  }
  // Two-sided standard normal p, with a stable erfc approximation in the tails.
  function normalP(z){
    if(!Number.isFinite(z))return Math.abs(z)===Infinity?0:null;
    const x=Math.abs(z)/Math.SQRT2,t=1/(1+.5*x);
    return Math.min(1,t*Math.exp(-x*x-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277))))))))));
  }
  function byAdjust(pairs){
    const sorted=pairs.filter(r=>Number.isFinite(r.p)&&r.p>=0&&r.p<=1).slice().sort((a,b)=>a.p-b.p),n=sorted.length;
    let harmonic=0;for(let i=1;i<=n;i++)harmonic+=1/i;
    let q=1;const result=new Map();
    for(let i=n-1;i>=0;i--){q=Math.min(q,sorted[i].p*n*harmonic/(i+1));result.set(sorted[i].key,Math.min(1,q));}
    return {q:result,n};
  }
  function field(rows,s){
    const pairs=[];
    for(const r of rows){const v=r.response;
      const p=v?.se>0?normalP(v.log/v.se):v?.log===0&&v?.se===0?1:null;
      r.fieldP=p;
      if(r.mapped&&v?.value!=null&&p!=null)pairs.push({key:r.sid,p});
    }
    const adjusted=byAdjust(pairs);
    return rows.map(r=>{
      const q=adjusted.q.get(r.sid)??null,fdr=q!=null&&q<=.1;
      let enough=r.enough,status=r.status;
      if(s.evidence==='fdr'&&!fdr){enough=false;status='Not selected at field FDR 0.10';}
      if(s.evidence==='stable'&&!r.reliability?.stable){enough=false;status=r.reliability?'Trend/event checks are sensitive or incomplete':'Trend/event checks unavailable for this selection';}
      return {...r,fieldQ:q,fieldN:adjusted.n,fieldSignificant:fdr,enough,value:enough?r.response?.value??r.value:null,status};
    });
  }
  const api={inScope,contrast,assess,normalP,byAdjust,field};
  if(typeof module!=='undefined')module.exports=api;else root.AtlasReliability=api;
})(typeof window!=='undefined'?window:this);
