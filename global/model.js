/* Shared selection and summary rules, also used by the numerical tests. */
(function (root) {
  const PERIODS = ['available', '1991-2020', '2001-2020', '2011-2020', '2015-2024'];
  function parse(hash) {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').map(decodeURIComponent), q = new URLSearchParams(query);
    const kind = ['country', 'region'].includes(parts[0]) ? parts[0] : 'world';
    return { kind, view: q.get('view') === 'world' ? 'world' : 'country', country: kind === 'world' ? '' : parts[1] || '', unit: kind === 'region' ? parts[2] || '' : '',
      crop: q.get('crop') || 'wheat', season: q.get('season') || 'default',
      period: PERIODS.includes(q.get('period')) ? q.get('period') : 'available',
      metric: q.get('metric') === 'coverage' ? 'coverage' : 'yield',
      basis: ['planted','harvested'].includes(q.get('basis')) ? q.get('basis') : 'default',
      minimum: q.get('minimum') === '80' ? '80' : '1', release: q.get('release') || '2026-09-26' };
  }
  function url(s) {
    const path = s.kind === 'world' ? '/' : `/${s.kind}/${encodeURIComponent(s.country)}${s.kind === 'region' ? '/' + encodeURIComponent(s.unit) : ''}`;
    const q = new URLSearchParams(Object.fromEntries(['crop', 'season', 'period', 'metric', 'minimum', 'basis', 'release', 'view'].map(k => [k, s[k]])));
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
    const window = climate?.windows[[series.country,series.crop,series.season].join('|')];
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
  const api = { PERIODS, parse, url, mapContext, defaultSeason, defaultBasis, select, csv, ensoSeries, comparisonScale };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AtlasModel = api;
})(typeof window !== 'undefined' ? window : this);
