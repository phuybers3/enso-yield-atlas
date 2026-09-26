"""Versioned climate index registry and crop-window alignment in native units."""
import calendar
import hashlib
import json
from pathlib import Path

WINDOWS = {'season':'Crop season','preseason':'Three months before planting',
           'calyear':'Harvest calendar year','djf':'DJF preceding harvest','fill':'Grain filling'}


def window(cal, name, lag=0):
    p, h, offset = cal.get('plant_month'), cal.get('harvest_month'), cal.get('season_start_offset')
    if name == 'calyear': start, end = 1, 12
    elif name == 'djf': start, end = 0, 2
    elif name == 'fill':
        p, h, offset = cal.get('fill_start_month'), cal.get('fill_end_month'), cal.get('fill_start_year_offset')
        if p is None or h is None: return None
        start = int(p) + 12 * int(offset or 0)
        end = start + (int(h)-int(p)) % 12
    else:
        if p is None or h is None or offset is None: return None
        start, end = int(p) + 12*int(offset), int(h)
        if name == 'preseason': start, end = start-3, start-1
    if end < start or end-start > 23: return None
    return {'start_relative_month':start-lag,'end_relative_month':end-lag,
            'label':WINDOWS[name], 'calendar_source':cal.get('calendar_source'),
            'note':f"Inclusive relative months {start-lag} to {end-lag}; harvest-year aligned."}


def mean(year, w, index):
    if not w: return None
    values=[]
    # MEI retains overlapping two-month periods. We average the published
    # periods whose END month lies in the requested window, with equal weight.
    # Thus the first MEI period includes one month before the window; no
    # interpolation to independent monthly SST observations is implied.
    for m in range(w['start_relative_month'], w['end_relative_month']+1):
        y, mo = divmod(int(year)*12+m-1, 12)
        v=index['values'].get(f'{y:04d}-{mo+1:02d}')
        if v is None: return None
        values.append(v)
    return sum(values)/len(values) if values else None


def registry(con, mei_path):
    rows=con.execute('SELECT * FROM enso_monthly').fetchall()
    result={}
    for key,label,col in [('nino34','Niño 3.4','nino34'),('relative','Relative Niño 3.4','nino34_rel')]:
        vals={f"{r['year']:04d}-{r['month']:02d}":r[col] for r in rows}
        result[key]={'id':key,'label':label,'units':'°C','cadence':'monthly','period_months':1,
            'product':'ERSSTv5; merged database','baseline':'1991–2020',
            'definition':'Niño 3.4 SST anomaly' if key=='nino34' else 'Niño 3.4 minus tropical-mean SST anomaly; unscaled local relative index, not official RONI',
            'source_url':'https://psl.noaa.gov/data/gridded/data.noaa.ersst.v5.html',
            'positive_phase':'El Niño','reference':0,'aggregation':'Equal mean of complete monthly values',
            'values':vals,'supports_peak':True}
    vals={}
    for line in Path(mei_path).read_text().splitlines():
        fields=line.split()
        if len(fields)!=13 or not fields[0].isdigit():continue
        y=int(fields[0])
        for m,s in enumerate(fields[1:],1):
            v=float(s)
            vals[f'{y:04d}-{m:02d}']=v if v>-900 else None
    result['mei']={'id':'mei','label':'MEI.v2','units':'index units','cadence':'overlapping two-month periods',
        'period_months':2,'product':'NOAA PSL MEI.v2 · JRA3Q','baseline':'1980–2018',
        'definition':'Standardized ocean–atmosphere multivariate index; DJ is assigned January as its end month',
        'source_url':'https://psl.noaa.gov/enso/mei/','positive_phase':'El Niño','reference':0,
        'aggregation':'Mean of published two-month periods ending within the crop window; first period includes the preceding month; no extra smoothing',
        'values':vals,'supports_peak':False,'source_sha256':hashlib.sha256(Path(mei_path).read_bytes()).hexdigest()}
    for r in result.values():
        r['version']=hashlib.sha256(json.dumps(r,sort_keys=True).encode()).hexdigest()[:16]
        r['first']=min(k for k,v in r['values'].items() if v is not None)
        r['last']=max(k for k,v in r['values'].items() if v is not None)
        r['observations']=[]
        for k,v in r['values'].items():
            y,m=map(int,k.split('-'));sy,sm=divmod(y*12+m-r['period_months'],12)
            r['observations'].append([f'{sy:04d}-{sm+1:02d}-01',f'{k}-{calendar.monthrange(y,m)[1]}',k,v])
        if r['supports_peak']:
            profile={k:v for k,v in r['values'].items() if '1996-01'<=k<='1999-12' and v is not None}
            peak=max((k for k in profile if k.startswith('1997')),key=profile.get)
            r['event_profile']={'values':profile,'peak':profile[peak],'peak_year':1997,'peak_month':int(peak[-2:])}
    return result
