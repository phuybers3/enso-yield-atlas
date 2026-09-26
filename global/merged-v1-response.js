/* Rendering for the one selected ENSO model; calculation rules live in model.js. */
(function(root){
  const M=typeof module!=='undefined'?require('./merged-v1-model.js'):root.AtlasModel;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(x,n=1)=>x==null?'—':Number(x).toLocaleString('en',{maximumFractionDigits:n,minimumFractionDigits:n});
  const signed=x=>x==null?'—':(x>0?'+':'')+fmt(x)+'%';
  const names={linear:'Linear',quadratic:'Quadratic',hinge:'Separate warm / cold slopes'};
  function observations(series,enso,fit,model){
    const index=new Map(enso.values), years=new Set(fit.years),coef=fit.models[model].coef;
    return series.observations.filter(r=>years.has(r[0])).map(r=>({year:r[0],yield:r[1],x:index.get(r[0]),
      adjusted:Math.log(r[1])-coef[0]-coef[1]*(r[0]-2000)/10}));
  }
  function fitPlot(series,enso,record,state){
    const label=esc(enso.index.label),units=esc(enso.index.units);
    const f=record.fit, response=record.response;
    const points=observations(series,enso,f,state.model);
    const xmin=Math.min(f.x_min,response.x,0)-.1,xmax=Math.max(f.x_max,response.x,0)+.1;
    const curve=Array.from({length:101},(_,i)=>M.estimate(f,state.model,xmin+(xmax-xmin)*i/100));
    const ys=[0,...points.map(p=>p.adjusted),...curve.flatMap(r=>[r.log-(r.se??0)*1.96,r.log+(r.se??0)*1.96])];
    const low=Math.min(...ys),high=Math.max(...ys),pad=Math.max(high-low,.1)*.08;
    const ylo=low-pad,yhi=high+pad;
    const x=v=>64+414*(v-xmin)/(xmax-xmin),y=v=>222-177*(v-ylo)/(yhi-ylo);
    let svg='';
    for(let i=0;i<=4;i++){
      const v=ylo+(yhi-ylo)*i/4,xx=xmin+(xmax-xmin)*i/4;
      const percent=100*Math.expm1(v),label=Math.abs(percent)>10000?percent.toExponential(1):fmt(percent,0);
      svg+=`<line x1="64" x2="478" y1="${y(v)}" y2="${y(v)}" stroke="#e1e8e0"/><text x="58" y="${y(v)+4}" text-anchor="end">${label}%</text><text x="${x(xx)}" y="242" text-anchor="middle">${fmt(xx,1)}</text>`;
    }
    svg+=`<line x1="64" x2="478" y1="${y(0)}" y2="${y(0)}" stroke="#758d83" stroke-dasharray="3 3"/>`;
    if(curve.every(r=>r.se!=null)){
      const band=[...curve.map(r=>`${x(r.x)},${y(r.log+1.96*r.se)}`),...curve.slice().reverse().map(r=>`${x(r.x)},${y(r.log-1.96*r.se)}`)];
      svg+=`<polygon points="${band.join(' ')}" fill="#bdd5d0" opacity=".5"/>`;
    }
    points.forEach(p=>{svg+=`<circle class="fit-observation" cx="${x(p.x)}" cy="${y(p.adjusted)}" r="3" fill="#657c70" opacity=".75"><title>${p.year}: observed ${fmt(p.yield,3)} t/ha; ${label} ${fmt(p.x,3)} ${units}; trend-adjusted ${signed(100*Math.expm1(p.adjusted))}</title></circle>`;});
    for(let i=1;i<curve.length;i++){
      const a=curve[i-1],b=curve[i];
      svg+=`<line class="fit-curve" x1="${x(a.x)}" y1="${y(a.log)}" x2="${x(b.x)}" y2="${y(b.log)}" stroke="#00796d" stroke-width="2"${a.extrapolated||b.extrapolated?' stroke-dasharray="5 3"':''}/>`;
    }
    svg+=`<line x1="${x(response.x)}" x2="${x(response.x)}" y1="45" y2="222" stroke="#aa6c2c" stroke-dasharray="2 3"/><path class="scenario-point" d="M${x(response.x)},${y(response.log)-5}l5,5l-5,5l-5,-5Z" fill="#aa6c2c"><title>Selected scenario: ${fmt(response.x,3)} ${units}; ${signed(response.value)}</title></path>`;
    return `<svg viewBox="0 0 540 273" role="img" aria-label="Observed trend-adjusted yields and ${esc(names[state.model])} fit against ${label} for ${esc(series.name)}" style="font:11px var(--font);fill:#64746f"><text x="64" y="20">Yield relative to fitted neutral (%)</text>${svg}<text x="272" y="264" text-anchor="middle">${label} exposure (${units})</text></svg>`;
  }
  function profilePlot(record,state,methods){
    if(state.exposure!=='event'||!methods?.event_profile||!record.exposure?.window)return '';
    const p=methods.event_profile,w=record.exposure.window,shift=state.peakYear*12+state.peakMonth-(p.peak_year*12+p.peak_month);
    const vals=Object.entries(p.values).map(([k,v])=>({month:Number(k.slice(0,4))*12+Number(k.slice(5))-1+shift,value:v*state.peak/p.peak}));
    const first=vals[0].month,last=vals.at(-1).month,x=m=>42+(m-first)/(last-first)*450;
    const ymin=Math.min(-.5,...vals.map(v=>v.value)),ymax=Math.max(.5,...vals.map(v=>v.value)),y=v=>103-(v-ymin)/(ymax-ymin)*73;
    const start=record.exposure.reportingYear*12+w.start_relative_month-1,end=record.exposure.reportingYear*12+w.end_relative_month;
    const path=vals.map((v,i)=>(i?'L':'M')+x(v.month)+','+y(v.value)).join(' ');
    const ticks=vals.filter(v=>v.month%12===0).map(v=>`<text x="${x(v.month)}" y="122" text-anchor="middle">${Math.floor(v.month/12)}</text>`).join('');
    return `<div class="profile-box"><svg viewBox="0 0 540 135" role="img" aria-label="Illustrative monthly ENSO event with the crop exposure window shaded" style="font:11px var(--font);fill:#64746f"><rect x="${x(start)}" y="27" width="${x(end)-x(start)}" height="79" fill="#dce7d3"/><text x="42" y="16">Monthly ${esc(methods.index_label||"Niño 3.4")} (°C) · crop window shaded</text><text x="35" y="${y(ymax)+4}" text-anchor="end">${fmt(ymax)}</text><text x="35" y="${y(ymin)+4}" text-anchor="end">${fmt(ymin)}</text><line x1="42" x2="492" y1="${y(0)}" y2="${y(0)}" stroke="#aab8ac" stroke-dasharray="3 3"/><path d="${path}" fill="none" stroke="#aa6c2c" stroke-width="2"/>${ticks}</svg><p>${fmt(state.peak)} °C peak in ${state.peakYear}-${String(state.peakMonth).padStart(2,'0')}; crop reporting year ${record.exposure.reportingYear}. Shaded months average ${fmt(record.exposure.x,3)} °C. Scaled 1997–98 profile; not a forecast.</p></div>`;
  }
  function panel(series,enso,record,state,methods){
    const label=esc(enso.index?.label||'Index'),units=esc(enso.index?.units||'index units');
    if(state.metric!=='enso')return '';
    const fit=record?.fit,r=record?.response,m=fit?.models?.[state.model];
    if(!r||!m?.coef)return `<section class="response-block"><h3>ENSO response</h3><p class="fit-note">${esc(record?.status||'Fit unavailable for this selection')}. The observed record remains below. Fits require at least 20 positive-yield years and five warm and five cold seasons, for this exact area basis and period.</p></section>`;
    return `<section class="response-block"><h3>ENSO response · ${names[state.model]}</h3><div class="response-card"><strong class="response-value ${r.value<0?'response-decrease':'response-increase'}">${signed(r.value)}</strong><p>Fitted yield change from neutral at ${fmt(r.x,3)} ${units} ${label} exposure.</p><p>95% pointwise interval: ${signed(r.lo)} to ${signed(r.hi)}${r.se==null?' · insufficient usable bootstrap draws':''}.</p>${r.extrapolated?'<span class="response-flag">Outside observed ENSO range</span>':''}${!record.enough?`<p>Not colored on map: ${esc(record.status)}.</p>`:''}</div>
      ${profilePlot(record,state,methods)}
      <p class="fit-note">${fit.n} fitted years (${fit.first}–${fit.last}); ${fit.warm} warm, ${fit.cold} cold. Observed ${label}: ${fmt(fit.x_min,2)} to ${fmt(fit.x_max,2)} ${units}. ${esc(enso.window?.label||'')}. Sample mean ${fmt(fit.x_mean,3)}; SD ${fmt(fit.x_sd,3)} ${units}. ${state.scale==='sd'?'The selected SD scenario uses this sample scale and a zero-index reference.':''}</p>
      <div class="chart-box">${fitPlot(series,enso,record,state)}</div><p class="fit-note">Points are the actual fitted observations after removing the selected model’s linear time trend, relative to its neutral-ENSO yield. The percent axis has log spacing. One selected curve; shaded 95% pointwise interval; dashed curve outside observed ENSO; diamond marks the scenario. Raw yields and ENSO through time follow below.</p>
      <details><summary>Fit checks and uncertainty</summary><p>${m.cv.every(v=>v!=null)?`Holdout skill relative to a trend-only model: ${m.cv.map(v=>fmt(100*v)+'%').join(' and ')} in the two block layouts. ${r.validated?'Both are positive.':'The ENSO model does not improve predictions in both layouts.'}`:'Too few eligible holdout blocks to assess predictive skill in both layouts.'} Skill is 1 − model error / trend-only error in squared log-yield units.</p><p>${m.boot_n} of 400 three-year block resamples usable. Normal intervals are calculated in log response from the bootstrap coefficient covariance, then transformed to percent. They describe uncertainty in the fitted association; they are not future-yield prediction intervals. Intervals are pointwise, without correction for testing many regions.</p><p>Selected period: ${esc(state.period)}; ${esc(series.basis)} area only. All models and indices use identical eligible positive-yield years with complete exposure for every registered index. Original and excluded source rows are available below. A short or missing calendar window can limit the fitted sample. The linear time trend controls gradual change but does not establish an ENSO causal effect.</p><p>Linear ENSO slope with a quadratic time trend: ${fmt(fit.quadratic_time_beta,4)} log-yield per ${units}. ${fit.outlier_sensitivity?`Restoring ${fit.outlier_sensitivity.restored} statistical-outlier-only records changes the linear ENSO slope by ${fmt(fit.outlier_sensitivity.delta_beta,4)}.`:'No additional eligible statistical-outlier-only records in this window.'}</p></details><button id="download-fit">Download fitted observations and coefficients ↓</button></section>`;
  }
  const api={panel,observations,names};
  if(typeof module!=='undefined')module.exports=api;else root.AtlasResponse=api;
})(typeof window!=='undefined'?window:this);
