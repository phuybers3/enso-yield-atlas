/* Shared selection and summary rules, also used by the numerical tests. */
(function (root) {
  const PERIODS = ['available', '1991-2020', '2001-2020', '2011-2020', '2015-2024'];
  // A fixed display harmonization, not a measured recovery rate for each source.
  const RICE_RECOVERY = 0.67;
  const RICE_SOURCES = ['rice-paddy','rice-milled'];
  function riceCatalog(catalog) {
    return {...catalog,products:{...catalog.products,rice:'Rice (paddy equivalent)'},countries:Object.fromEntries(
      Object.entries(catalog.countries).map(([cc,c])=>[cc,{...c,crops:{...c.crops,
        rice:[...new Set(RICE_SOURCES.flatMap(crop=>c.crops[crop]||[]))].sort()}}]))};
  }
  function riceRows(rows) {
    // Pick an entire source series before selecting a period. Never splice
    // reporting forms across years, or count paddy and milled twice.
    const chosen=new Map();
    for(const r of rows){
      if(!RICE_SOURCES.includes(r.crop))continue;
      const key=fitKey(r),old=chosen.get(key);
      const score=Number(r.periods.available.n>0)*2+Number(r.crop==='rice-paddy');
      const oldScore=old?Number(old.periods.available.n>0)*2+Number(old.crop==='rice-paddy'):-1;
      if(score>oldScore)chosen.set(key,r);
    }
    return [...chosen.values()].map(r=>{
      const factor=r.crop==='rice-milled'?1/RICE_RECOVERY:1;
      return {...r,crop:'rice',source_crop:r.crop,rice_recovery:RICE_RECOVERY,conversion_factor:factor,
        periods:Object.fromEntries(Object.entries(r.periods).map(([p,s])=>[p,{...s,mean:s.mean==null?null:s.mean*factor}])),
        ...(r.observations?{original_observations:r.observations,observations:r.observations.map(v=>[v[0],v[1]*factor,v[2],v[3]*factor,v[4]])}:{})};
    });
  }
  function riceFits(rows,byProduct) {
    return Object.fromEntries(rows.map(r=>{
      const key=fitKey(r),periods=byProduct[r.source_crop]?.[key];
      return [key,periods?Object.fromEntries(Object.entries(periods).map(([p,f])=>[p,{...f,
        ...(f.models?{models:Object.fromEntries(Object.entries(f.models).map(([model,m])=>[model,{...m,
          ...(m.coef?{coef:[m.coef[0]+Math.log(r.conversion_factor),...m.coef.slice(1)]}:{})}]))}:{})}])):null];
    }));
  }
  function parse(hash) {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').map(decodeURIComponent), q = new URLSearchParams(query);
    const kind = ['country', 'region'].includes(parts[0]) ? parts[0] : 'world';
    return { kind, view: q.get('view') === 'world' ? 'world' : 'country', country: kind === 'world' ? '' : parts[1] || '', unit: kind === 'region' ? parts[2] || '' : '',
      crop: q.get('crop') || 'wheat', season: q.get('season') || 'default',
      period: PERIODS.includes(q.get('period')) ? q.get('period') : 'available',
      metric: ['coverage','enso'].includes(q.get('metric')) ? q.get('metric') : 'yield',
      model: ['quadratic','hinge'].includes(q.get('model')) ? q.get('model') : 'linear',
      exposure: q.get('exposure') === 'event' ? 'event' : 'season',
      amplitude: number(q.get('amplitude'), 1, -3.5, 3.5),
      peak: number(q.get('peak'), 3, 0, 3.5),
      peakYear: Math.round(number(q.get('peakYear'), 2026, 1900, 2100)),
      peakMonth: Math.round(number(q.get('peakMonth'), 11, 1, 12)),
      harvest: q.get('harvest') === '1' ? '1' : '0',
      evidence: ['interval','validated'].includes(q.get('evidence')) ? q.get('evidence') : 'all',
      support: q.get('support') === 'observed' ? 'observed' : 'all',
      basis: ['planted','harvested'].includes(q.get('basis')) ? q.get('basis') : 'default',
      minimum: q.get('minimum') === '80' ? '80' : '1', release: q.get('release') || '2026-09-26' };
  }
  function url(s) {
    const path = s.kind === 'world' ? '/' : `/${s.kind}/${encodeURIComponent(s.country)}${s.kind === 'region' ? '/' + encodeURIComponent(s.unit) : ''}`;
    const keys=['crop', 'season', 'period', 'metric', 'minimum', 'basis', 'release', 'view'];
    if(s.metric==='enso')keys.push('model','exposure','amplitude','peak','peakYear','peakMonth','harvest','evidence','support');
    const q = new URLSearchParams(Object.fromEntries(keys.filter(k=>s[k]!=null).map(k => [k, s[k]])));
    return '#' + path + '?' + q;
  }
  function mapContext(s) {
    if (s.kind !== 'region') return s;
    return {...s, kind:s.view === 'world' ? 'world' : 'country', country:s.view === 'world' ? '' : s.country, unit:''};
  }
  function defaultSeason(rows, crop) {
    const count = new Map();
    rows.forEach(r => { const n = r.periods.available.n; if (n) count.set(r.season, (count.get(r.season) || 0) + n); });
    for (const season of ['Annual', 'Calendar Year', 'All (Season)', ...(crop === 'wheat' ? ['Rabi'] : [])]) {
      if (count.has(season)) return season;
    }
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || '';
  }
  function defaultBasis(rows, season) {
    const count = new Map();
    rows.filter(r=>r.season===season).forEach(r=>{if(r.periods.available.n)count.set(r.basis,(count.get(r.basis)||0)+r.periods.available.n);});
    return [...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0] || 'unknown';
  }
  function select(rows, s) {
    const groups = new Map();
    for (const r of rows) { if (!groups.has(r.country)) groups.set(r.country, []); groups.get(r.country).push(r); }
    const seasons = Object.fromEntries([...groups].map(([c, rs]) => [c, s.season === 'default' ? defaultSeason(rs, s.crop) : s.season]));
    const bases = Object.fromEntries([...groups].map(([c, rs]) => [c, s.basis === 'default' ? defaultBasis(rs, seasons[c]) : s.basis]));
    return rows.filter(r => r.season === seasons[r.country] && r.basis === bases[r.country]).map(r => {
      const stats = r.periods[s.period];
      const enough = stats.n > 0 && (s.minimum !== '80' || stats.completeness >= 0.8);
      return { ...r, stats, enough, value: enough ? (s.metric === 'coverage' ? stats.n : stats.mean) : null,
        status: !stats.n ? 'No eligible observations in this period' : !enough ? 'Less than 80% of years reported' : 'Observed' };
    });
  }
  function csv(rows) {
    return rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
  }
  function ensoSeries(series, climate) {
    const window = climate?.windows[[series.country,series.source_crop||series.crop,series.season].join('|')];
    if (!window || !series.observations.length) return {window:null,values:[]};
    const first=series.observations[0][0],last=series.observations.at(-1)[0],values=[];
    for(let year=first;year<=last;year++){
      const months=[];
      for(let m=window.start_relative_month;m<=window.end_relative_month;m++){
        const absolute=year*12+m-1,y=Math.floor(absolute/12),month=absolute-y*12+1;
        months.push(climate.monthly[`${y}-${String(month).padStart(2,'0')}`]);
      }
      values.push([year,months.length&&months.every(Number.isFinite)?months.reduce((a,b)=>a+b,0)/months.length:null]);
    }
    return {window,values};
  }
  function comparisonScale(observations, enso) {
    const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
    const sd=a=>{const m=mean(a);return Math.sqrt(mean(a.map(x=>(x-m)**2)))};
    const index=new Map(enso),pairs=observations.filter(r=>Number.isFinite(r[1])&&Number.isFinite(index.get(r[0])));
    const yields=observations.map(r=>r[1]).filter(Number.isFinite),indices=enso.map(r=>r[1]).filter(Number.isFinite);
    const y=pairs.map(r=>r[1]),e=pairs.map(r=>index.get(r[0]));
    const matched=pairs.length>=2&&sd(y)>1e-12&&sd(e)>1e-12;
    const yCenter=mean(y.length?y:yields.length?yields:[0]),eCenter=mean(e.length?e:indices.length?indices:[0]);
    // For constant or single-year records no variability ratio is identifiable.
    const factor=matched?sd(y)/sd(e):Math.max(...yields,1)*.15/Math.max(sd(indices.length?indices:[0]),1);
    const project=value=>yCenter+(value-eCenter)*factor;
    const plotted=[...yields,...indices.map(project)];
    if(indices.length)plotted.push(project(0));
    const extent=plotted.length?plotted:[0,1],lo=Math.min(...extent),hi=Math.max(...extent);
    const pad=Math.max(hi-lo,Math.abs(yCenter)*.05,.1)*.1;
    return {matched, factor, yCenter, eCenter, lo:lo-pad, hi:hi+pad,
      project, indexAt:value=>eCenter+(value-yCenter)/factor};
  }
  function number(value, fallback, lo, hi) {
    const n=value==null||value===''?NaN:Number(value);
    return Number.isFinite(n)?Math.max(lo,Math.min(hi,n)):fallback;
  }
  function fitKey(r) {return [r.country,r.id,r.season,r.basis].join('|');}
  function scenario(r,s,climate,methods) {
    const window=climate?.windows[[r.country,r.source_crop||r.crop,r.season].join('|')];
    if(s.exposure!=='event')return {x:s.amplitude,window};
    const profile=methods?.event_profile;
    if(!profile||!window)return {x:null,window};
    const reportingYear=s.peakYear+Number(s.harvest), values=[];
    const shift=s.peakYear*12+s.peakMonth-(profile.peak_year*12+profile.peak_month);
    for(let m=window.start_relative_month;m<=window.end_relative_month;m++){
      const absolute=reportingYear*12+m-1-shift,y=Math.floor(absolute/12),month=absolute-y*12+1;
      const raw=profile.values[`${y}-${String(month).padStart(2,'0')}`];
      if(!Number.isFinite(raw))return {x:null,window,reportingYear};
      values.push(raw*s.peak/profile.peak);
    }
    return {x:values.reduce((a,b)=>a+b,0)/values.length,window,reportingYear};
  }
  function estimate(fit,model,x) {
    const f=fit?.models?.[model];
    if(!f?.coef||!Number.isFinite(x))return null;
    const v=model==='linear'?[x]:[x,model==='quadratic'?x*x:Math.max(x,0)];
    const log=v.reduce((sum,z,i)=>sum+z*f.coef[2+i],0);
    const variance=f.cov?v.reduce((sum,z,i)=>sum+v.reduce((a,w,j)=>a+z*w*f.cov[i][j],0),0):null;
    const se=variance==null?null:Math.sqrt(Math.max(0,variance));
    const percent=z=>{const p=100*Math.expm1(z);return Number.isFinite(p)?p:null;};
    const lo=se==null?null:percent(log-1.96*se),hi=se==null?null:percent(log+1.96*se);
    return {x,log,se,value:percent(log),lo,hi,
      interval:lo!=null&&hi!=null&&(lo>0||hi<0),
      validated:f.cv.length===2&&f.cv.every(v=>v!=null&&v>0),
      extrapolated:x<fit.x_min||x>fit.x_max};
  }
  function attachFits(rows,s,records,climate,methods) {
    return rows.map(r=>{
      const fit=records?.[fitKey(r)]?.[s.period], exposure=scenario(r,s,climate,methods);
      const response=estimate(fit,s.model,exposure.x);
      let status=r.status;
      if(r.enough){
        if(!records)status='ENSO fit data unavailable';
        else if(!fit)status='No fit for this exact series and period';
        else if(!response)status=fit.reason||fit.models?.[s.model]?.reason||'Scenario lies outside the monthly profile';
        else if(response.value==null)status='Response exceeds numerical range';
        else if(s.support==='observed'&&response.extrapolated)status='Scenario outside the observed ENSO range';
        else if(s.evidence==='interval'&&!response.interval)status='95% pointwise interval overlaps zero or is unavailable';
        else if(s.evidence==='validated'&&!response.validated)status='No positive holdout skill in both block layouts';
        else status=response.extrapolated?'Extrapolated association':'Fitted association';
      }
      const enough=r.enough&&response?.value!=null&&!(s.support==='observed'&&response.extrapolated)&&
        !(s.evidence==='interval'&&!response.interval)&&!(s.evidence==='validated'&&!response.validated);
      return {...r,fit,response,exposure,enough:!!enough,value:enough?response.value:null,status};
    });
  }
  const api = { PERIODS, RICE_RECOVERY, RICE_SOURCES, riceCatalog, riceRows, riceFits, parse, url, mapContext, defaultSeason, defaultBasis, select, csv, ensoSeries, comparisonScale, fitKey, scenario, estimate, attachFits };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AtlasModel = api;
})(typeof window !== 'undefined' ? window : this);
