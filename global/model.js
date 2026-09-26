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
  const api = { PERIODS, parse, url, mapContext, defaultSeason, defaultBasis, select, csv };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AtlasModel = api;
})(typeof window !== 'undefined' ? window : this);
