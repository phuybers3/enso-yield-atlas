/* Rendering for the one selected ENSO model; calculation rules live in model.js. */
(function(root){
  const M=typeof module!=='undefined'?require('./merged-model.js'):root.AtlasModel;
  const R=typeof module!=='undefined'?require('./merged-reliability.js'):root.AtlasReliability;
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
    if(!r||!m?.coef)return `<section class="response-block"><h3>ENSO response</h3><p class="fit-note">${esc(record?.status||'Fit unavailable for this selection')}. The observed record is shown above. Fits require at least 20 positive-yield years and five warm and five cold seasons, for this exact area basis and period.</p><details class="advanced-only advanced-diagnostics"><summary>Advanced fit diagnostics</summary>${reliabilityPanel(record,state,methods)}</details></section>`;
    return `<section class="response-block"><h3>ENSO response · ${names[state.model]}</h3><div class="response-card"><strong class="response-value ${r.value<0?'response-decrease':'response-increase'}">${signed(r.value)}</strong><p>Fitted yield change from neutral at ${fmt(r.x,3)} ${units} ${label} exposure.</p><p>95% pointwise interval: ${signed(r.lo)} to ${signed(r.hi)}${r.se==null?' · insufficient usable bootstrap draws':''}.</p>${r.extrapolated?'<span class="response-flag">Outside observed ENSO range</span>':''}${!record.enough?`<p>Not colored on map: ${esc(record.status)}.</p>`:''}</div>
      <p class="fit-note response-confidence">${!Number.isFinite(r.lo)||!Number.isFinite(r.hi)?'The uncertainty interval is unavailable.':r.x===0?'The neutral scenario is zero by definition.':r.lo<=0&&r.hi>=0?'The interval includes zero: a yield increase or decrease is not resolved.':'The pointwise interval excludes zero.'} ${r.validated?'This model improves on a trend-only prediction in both holdout checks.':'Predictive improvement over a trend-only model is not established in both holdout checks.'} These intervals describe the fitted association, not a future harvest.</p>
      <h4 class="fit-chart-title">Yield and ${label}</h4><div class="chart-box">${fitPlot(series,enso,record,state)}</div><p class="fit-note">Points are the actual fitted observations after removing the selected model’s linear time trend, relative to its neutral-ENSO yield. The percent axis has log spacing. One selected curve; shaded 95% pointwise interval; dashed curve outside observed ENSO; diamond marks the scenario. Raw yields and ENSO through time are shown above.</p>
      ${state.exposure==='event'?`<details><summary>Event timing and crop exposure</summary>${profilePlot(record,state,methods)}</details>`:''}
      <button id="show-diagnostics" class="simple-only">Show advanced fit checks</button>
      <details class="advanced-only advanced-diagnostics"><summary>Advanced fit diagnostics</summary>
      ${reliabilityPanel(record,state,methods)}
      <p class="fit-note">${fit.n} fitted years (${fit.first}–${fit.last}); ${fit.warm} warm, ${fit.cold} cold. Observed ${label}: ${fmt(fit.x_min,2)} to ${fmt(fit.x_max,2)} ${units}. ${esc(enso.window?.label||'')}. Sample mean ${fmt(fit.x_mean,3)}; SD ${fmt(fit.x_sd,3)} ${units}. ${state.scale==='sd'?'The selected SD scenario uses this sample scale and a zero-index reference.':''}</p>
      <details><summary>Fit checks and uncertainty</summary><p>${m.cv.every(v=>v!=null)?`Holdout skill relative to a trend-only model: ${m.cv.map(v=>fmt(100*v)+'%').join(' and ')} in the two block layouts. ${r.validated?'Both are positive.':'The ENSO model does not improve predictions in both layouts.'}`:'Too few eligible holdout blocks to assess predictive skill in both layouts.'} Skill is 1 − model error / trend-only error in squared log-yield units.</p><p>${m.boot_n} of 400 three-year block resamples usable. Normal intervals are calculated in log response from the bootstrap coefficient covariance, then transformed to percent. They describe uncertainty in the fitted association; they are not future-yield prediction intervals. Intervals are pointwise. The separate field-adjusted q value accounts for testing the mapped units in this selection.</p><p>Selected period: ${esc(state.period)}; ${esc(series.basis)} area only. All models and indices use identical eligible positive-yield years with complete exposure for every registered index. Original and excluded source rows are available below. A short or missing calendar window can limit the fitted sample. The linear time trend controls gradual change but does not establish an ENSO causal effect.</p><p>Original individual linear-model ENSO slope with a quadratic time trend: ${fmt(fit.quadratic_time_beta,4)} log-yield per ${units}. ${fit.outlier_sensitivity?`Restoring ${fit.outlier_sensitivity.restored} statistical-outlier-only records changes the linear ENSO slope by ${fmt(fit.outlier_sensitivity.delta_beta,4)}.`:'No additional eligible statistical-outlier-only records in this window.'}</p></details></details><button id="download-fit">Download fitted observations and coefficients ↓</button></section>`;
  }
  function reliabilityPanel(record,state,methods){
    const c=record?.check,rel=record?.reliability,model=c?.models?.[state.model],raw=record?.individualFit;
    const sci=x=>x==null?'unavailable':x<.001?x.toExponential(1):fmt(x,3);
    const skill=v=>v?.every(x=>x!=null)?v.map(x=>fmt(100*x)+'%').join(' / '):'unavailable';
    const field=`<p class="field-result">Pointwise p: ${sci(record?.fieldP)} · field-adjusted q: ${sci(record?.fieldQ)} · ${record?.fieldN??0} mapped units in the worldwide comparison. ${record?.fieldSignificant?'Selected at field FDR 0.10.':'Not selected at field FDR 0.10.'} Field testing uses the selected scenario and remains fixed when zooming.</p>`;
    if(!R.inScope(state)||!c)return `<section class="reliability"><h4>Reliability</h4><p>Trend/event checks and pooling ${R.inScope(state)?'are unavailable for this source series.':'cover 1981–2024 crop-season Niño 3.4; this selection has no additional checks.'}</p>${field}</section>`;
    const x=record?.exposure?.x,individual=M.estimate(raw,state.model,x),poolFit=model?.pooled?.coef?{...raw,models:{...raw.models,[state.model]:model.pooled}}:null,pooled=M.estimate(poolFit,state.model,x);
    const responseCell=v=>v?`${signed(v.value)} [${signed(v.lo)}, ${signed(v.hi)}]`:'unavailable';
    const labels=new Map((methods?.robustness?.events||[]).map(e=>[e.id,e.label]));
    const improvement=model?.comparison?.individual?.every((v,i)=>v!=null&&model.comparison.pooled[i]!=null&&model.comparison.pooled[i]>v);
    const rows=rel?.events||[];
    return `<section class="reliability"><h4>Reliability of this response</h4>
      <div class="reliability-grid"><div><small>Yield trend check</small><strong>${rel?.trend?signed(rel.trend.value):'Unavailable'}</strong><span>Response with a quadratic time trend; selected estimate ${signed(record?.response?.value)}.</span></div>
      <div><small>Largest event-omission change</small><strong>${rel?.worst?fmt(Math.abs(rel.worst.response.value-record.response.value))+' percentage points':'Unavailable'}</strong><span>${rel?.worst?esc(labels.get(rel.worst.event)||rel.worst.event):'No estimable event omission.'}</span></div>
      <div><small>Trend / event stability</small><strong>${!rel?.complete?'Incomplete':rel.stable?'Stable under these checks':'Sensitive under these checks'}</strong><span>${rel?.signChanged?'At least one check reverses the response sign. ':''}Stable means no sign reversal and every change ≤ max(5 percentage points, 50% of the selected response). This is a sensitivity rule, separate from significance.</span></div>
      <div><small>Observed exposure support</small><strong>${!record?.response?'Response unavailable':record.response.extrapolated?'Extrapolated':'Within observed range'}</strong><span>${fmt(raw?.x_min,2)} to ${fmt(raw?.x_max,2)} °C; ${raw?.n??0} fitted years (${raw?.first??'—'}–${raw?.last??'—'}).</span></div></div>
      ${field}
      <div class="table-wrap"><table class="pool-comparison"><thead><tr><th>Estimator</th><th>Scenario response [95% interval]</th><th>Matched holdout skill</th></tr></thead><tbody><tr><td>Individual region</td><td>${responseCell(individual)}</td><td>${skill(model?.comparison?.individual)}</td></tr><tr><td>Partially pooled</td><td>${responseCell(pooled)}</td><td>${skill(model?.comparison?.pooled)}</td></tr></tbody></table></div>
      <p>${pooled?`${esc(c.group_name)} · ${c.group_units} units. The pooled curve borrows ${fmt(100*c.borrow,0)}% from the jointly fitted state/province curve, including this unit. Each unit retains its own intercept and trend. ${improvement?'Pooling improves held-out predictions in both layouts.':'Pooling has not improved held-out predictions in both layouts.'}`:'Pooling requires at least three eligible units in one state/province with the same source, crop, season and area basis.'} Individual estimates remain the default. Matched skill compares both estimators with a trend-only prediction on the same held-out years, withheld across all peers.</p>
      <details><summary>Event omissions · ${rows.filter(e=>e.response).length} of ${rows.length} estimable</summary><p>We omit all harvests whose assigned crop-season window overlaps a major episode. Episode dates come from the frozen Niño 3.4 record. Missing refits remain explicitly unavailable; pooled refits also remove overlapping harvests from peers.</p><div class="table-wrap"><table><thead><tr><th>Omitted episode</th><th>Harvest years omitted here</th><th>Response</th><th>Remaining support</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(labels.get(e.event)||e.event)}</td><td>${e.removed_years.join(', ')||'Peers only'}</td><td>${signed(e.response?.value)}</td><td>${!e.response?'Insufficient years, phase support or rank':e.response.extrapolated?'Scenario beyond remaining observations':'Within remaining observations'}</td></tr>`).join('')}</tbody></table></div></details>
      <button id="download-checks">Download robustness checks ↓</button></section>`;
  }
  const api={panel,observations,names,reliabilityPanel};
  if(typeof module!=='undefined')module.exports=api;else root.AtlasResponse=api;
})(typeof window!=='undefined'?window:this);
