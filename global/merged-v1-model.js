/* Shared selection and summary rules, also used by the numerical tests. */
(function (root) {
  const PERIODS = ['1981-2024','available','1991-2020','2001-2020','2011-2020','2015-2024'];
  const RELEASE='2026-09-26-merged-v1';
  function parse(hash) {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').map(decodeURIComponent), q = new URLSearchParams(query);
    const kind = ['country', 'region'].includes(parts[0]) ? parts[0] : 'world';
    return { kind, view: q.get('view') === 'world' ? 'world' : 'country', country: kind === 'world' ? '' : parts[1] || '', unit: kind === 'region' ? parts[2] || '' : '',
      crop: q.get('crop') || 'wheat', season: q.get('season') || 'default',
      period: PERIODS.includes(q.get('period')) ? q.get('period') : '1981-2024',
      metric: ['coverage','enso','trend','latest','resolution'].includes(q.get('metric')) ? q.get('metric') : 'yield',
      model: ['quadratic','hinge'].includes(q.get('model')) ? q.get('model') : 'linear',
      exposure: q.get('exposure') === 'event' ? 'event' : 'season',
      amplitude: number(q.get('amplitude'), 1, -3.5, 3.5),
      peak: number(q.get('peak'), 3, 0, 3.5),
      peakYear: Math.round(number(q.get('peakYear'), 2026, 1900, 2100)),
      peakMonth: Math.round(number(q.get('peakMonth'), 11, 1, 12)),
      harvest: q.get('harvest') === '1' ? '1' : '0',
      evidence: ['interval','validated'].includes(q.get('evidence')) ? q.get('evidence') : 'all',
      support: q.get('support') === 'observed' ? 'observed' : 'all',
      basis: ['planted','harvested','unknown'].includes(q.get('basis')) ? q.get('basis') : 'default',
      index: q.get('index')||'nino34',
      window: ['preseason','calyear','djf','fill'].includes(q.get('window'))?q.get('window'):'season',
      scale:q.get('scale')==='sd'?'sd':'native',
      resolution:['national','subnational'].includes(q.get('resolution'))?q.get('resolution'):'best',
      source:q.get('source')||'auto',
      minimum: q.get('minimum') === '80' ? '80' : '1', release: q.get('release') || RELEASE };
  }
  function url(s) {
    const path = s.kind === 'world' ? '/' : `/${s.kind}/${encodeURIComponent(s.country)}${s.kind === 'region' ? '/' + encodeURIComponent(s.unit) : ''}`;
    const keys=['crop', 'season', 'period', 'metric', 'minimum', 'basis', 'release', 'view','index','window','scale','resolution','source'];
    keys.push('model','exposure','amplitude','peak','peakYear','peakMonth','harvest','evidence','support');
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
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || rows.map(r=>r.season).sort()[0] || '';
  }
  function defaultBasis(rows, season) {
    const count = new Map();
    rows.filter(r=>r.season===season).forEach(r=>{if(r.periods.available.n)count.set(r.basis,(count.get(r.basis)||0)+r.periods.available.n);});
    return [...count].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0] || rows.find(r=>r.season===season)?.basis || 'unknown';
  }
  function select(rows, s) {
    const groups=new Map(),output=[];
    for(const r of rows){if(!groups.has(r.country))groups.set(r.country,[]);groups.get(r.country).push(r);}
    for(const rs of groups.values()){
      let candidates=rs.filter(r=>(s.resolution!=='national'||r.level==='ADM0')&&(s.resolution!=='subnational'||r.level!=='ADM0')&&(s.source==='auto'||r.source===s.source));
      if(s.season!=='default')candidates=candidates.filter(r=>r.season===s.season);
      if(s.basis!=='default')candidates=candidates.filter(r=>r.basis===s.basis);
      // Choose an entire reporting layer, never splice annual rows across tiers.
      const usable=candidates.filter(r=>r.periods[s.period]?.n&&(!['yield','trend'].includes(s.metric)||r.comparable));
      const tier=Math.min(...(usable.length?usable:candidates).map(r=>r.tier));
      candidates=candidates.filter(r=>r.tier===tier);
      const units=new Map();for(const r of candidates){if(!units.has(r.id))units.set(r.id,[]);units.get(r.id).push(r);}
      for(let list of units.values()){
        const local=list.filter(r=>r.periods[s.period]?.n);
        const season=s.season==='default'?defaultSeason(local.length?local:list,s.crop):s.season;
        list=list.filter(r=>r.season===season);
        const basis=s.basis==='default'?defaultBasis(list,season):s.basis;
        list=list.filter(r=>r.basis===basis);
        list.sort((a,b)=>Number(b.comparable)-Number(a.comparable)||Number(b.source_crop==='rice_paddy')-Number(a.source_crop==='rice_paddy')||b.periods[s.period].n-a.periods[s.period].n||a.sid.localeCompare(b.sid));
        const r=list[0];if(!r)continue;
        const stats=r.periods[s.period],enough=stats.n>0&&(s.minimum!=='80'||stats.completeness>=.8)&&(!['yield','trend'].includes(s.metric)||r.comparable);
        output.push({...r,stats,enough,value:enough?(s.metric==='coverage'?stats.n:s.metric==='latest'?stats.last:s.metric==='resolution'?Number(r.level.replace('ADM','')):stats.mean):null,
          status:!stats.n?'No eligible observations in this period':!r.comparable&&['yield','trend'].includes(s.metric)?'Rice reporting form unknown; absolute yields not comparable':!enough?'Less than 80% of years reported':'Observed'});
      }
    }
    return output;
  }
  function attachTrends(rows,s,records){return rows.map(r=>{
    const trend=records?.[r.sid]?.[s.period],enough=r.enough&&trend?.value!=null;
    return {...r,trend,enough:!!enough,value:enough?trend.value:null,status:!r.enough?r.status:trend?.reason||'Observed yield trend'};
  });}
  function csv(rows) {
    return rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
  }
  function windowText(w){
    if(!w)return '';
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month=m=>months[((m-1)%12+12)%12],offset=m=>Math.floor((m-1)/12);
    const suffix=y=>y===0?'of harvest year':y===-1?'before harvest year':y<0?`${-y} years before harvest`:`${y} years after harvest`;
    const a=w.start_relative_month,b=w.end_relative_month;
    return offset(a)===offset(b)?`${month(a)}–${month(b)} ${suffix(offset(a))}`:`${month(a)} ${suffix(offset(a))}–${month(b)} ${suffix(offset(b))}`;
  }
  function ensoSeries(series, climate, name='season') {
    const window = series.windows?.[name];
    if (!window || !series.observations.length) return {window:null,values:[]};
    const first=series.observations[0][0],last=series.observations.at(-1)[0],values=[];
    for(let year=first;year<=last;year++){
      const months=[];
      for(let m=window.start_relative_month;m<=window.end_relative_month;m++){
        const absolute=year*12+m-1,y=Math.floor(absolute/12),month=absolute-y*12+1;
        months.push(climate?.values[`${y}-${String(month).padStart(2,'0')}`]);
      }
      values.push([year,months.length&&months.every(Number.isFinite)?months.reduce((a,b)=>a+b,0)/months.length:null]);
    }
    return {window:window?{...window,label:window.label+' · '+windowText(window),note:'Aligned to the recorded harvest year.'}:null,values,index:climate};
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
  function fitKey(r) {return r.sid;}
  function scenario(r,s,climate,methods,fit) {
    const window=r.windows?.[s.window];
    if(s.exposure!=='event')return {x:s.scale==='sd'?(fit?.x_sd==null?null:s.amplitude*fit.x_sd):Number(s.amplitude),window};
    const profile=climate?.supports_peak?climate.event_profile:null;
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
      const fit=records?.[fitKey(r)]?.[s.period], exposure=scenario(r,s,climate,methods,fit);
      const response=estimate(fit,s.model,exposure.x);
      let status=r.status;
      if(r.enough){
        if(!records)status='Index fit data unavailable';
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
  const api = { PERIODS, RELEASE, parse, url, mapContext, defaultSeason, defaultBasis, select, attachTrends, csv, windowText, ensoSeries, comparisonScale, fitKey, scenario, estimate, attachFits };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AtlasModel = api;
})(typeof window !== 'undefined' ? window : this);
