"""Save +3°C event-profile and crop-season-mean comparisons for all fitted units."""
import csv, math
from pathlib import Path
HERE=Path(__file__).resolve().parent

def run():
    with open(HERE.parent/'results/monthly_indices.csv') as f:
        profile={r['date'][:7]:float(r['n34']) for r in csv.DictReader(f) if r['date'][:4] in ['1996','1997','1998','1999'] and r['n34']}
    peak=max(v for k,v in profile.items() if k.startswith('1997'))
    out=[]
    with open(HERE/'unit_results.csv') as f:
        for r in csv.DictReader(f):
            for mode,offset in [('scaled_1997_98_profile',0),('scaled_1997_98_profile',1),('direct_season_average',0)]:
                values=[]
                for m in range(int(r['start_relative_month']),int(r['end_relative_month'])+1):
                    y,month=divmod(12*(1997+offset)+m-1,12)
                    values.append(profile[f'{y}-{month+1:02}']*3/peak)
                x=3 if mode=='direct_season_average' else sum(values)/len(values)
                beta,q,delta,cold,warm=[float(r[k]) for k in ['beta','quadratic_beta','curvature','cold_beta','warm_beta']]
                effects=[beta*x,q*x+delta*x*x,(cold if x<0 else warm)*x]
                d={k:r[k] for k in ['panel','stable_id','country_name','crop','season','unit_name','window_note']}
                d.update(scenario=mode,peak_or_average_C=3,peak_year=2026 if mode=='scaled_1997_98_profile' else '',reporting_year=2026+offset if mode=='scaled_1997_98_profile' else '',exposure_C=x)
                d.update(zip(['linear_pct','quadratic_pct','warm_cold_pct'],[100*math.expm1(v) for v in effects]))
                d.update(observed_min_C=r['x_min'],observed_max_C=r['x_max'],extrapolation=not float(r['x_min'])<=x<=float(r['x_max']))
                assert all(math.isfinite(d[k]) for k in ['linear_pct','quadratic_pct','warm_cold_pct'])
                out.append(d)
    with open(HERE/'scenario_3C_results.csv','w') as f:
        w=csv.DictWriter(f,fieldnames=list(out[0]));w.writeheader();w.writerows(out)
    print('Saved',len(out),'scenario rows')

if __name__=='__main__':run()
