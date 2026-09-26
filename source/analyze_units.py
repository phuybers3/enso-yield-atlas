"""Fit each unit/crop/season independently, without resampling or uncertainty estimates."""
from pathlib import Path
import hashlib, json, sys
import numpy as np
import pandas as pd

HERE=Path(__file__).resolve().parent
BASE=HERE.parent
DATA=BASE.parent
sys.path.insert(0,str(BASE/'scripts'))
from analyze import SPECS, complete

def design(t,x,model,trend2=False):
    z=[np.ones(len(t)),(t-2000)/10]
    if trend2: z.append(((t-2000)/10)**2)
    if model!='trend': z.append(x)
    if model=='quadratic': z.append(x*x)
    if model=='hinge': z.append(np.maximum(x,0))
    return np.column_stack(z)

def regress(a,y):
    if np.linalg.matrix_rank(a)<a.shape[1]: return None
    return np.linalg.lstsq(a,y,rcond=None)[0]

def validation(t,x,y,offset,trend2=False):
    models=['trend','linear','quadratic','hinge']
    matrices={m:design(t,x,m,trend2) for m in models}
    predictions=np.full((len(t),4),np.nan)
    foldwins=[]
    blocks=np.floor_divide(t-(1980+offset),5)
    for b in np.unique(blocks):
        lo=1980+offset+5*b
        test=blocks==b
        train=(t<lo-1)|(t>lo+5)
        if train.sum()<12 or (x[train]>0).sum()<3 or (x[train]<0).sum()<3: continue
        betas=[regress(matrices[m][train],y[train]) for m in models]
        if any(v is None for v in betas): continue
        for j,m in enumerate(models): predictions[test,j]=matrices[m][test]@betas[j]
        errors=np.mean((y[test,None]-predictions[test])**2,axis=0)
        foldwins.append(errors[2:]<errors[1])
    ok=np.isfinite(predictions).all(axis=1)
    losses=np.mean((y[ok,None]-predictions[ok])**2,axis=0) if ok.any() else np.full(4,np.nan)
    if ok.sum()<15 or len(foldwins)<3: losses[:]=np.nan
    return losses,int(ok.sum()),np.mean(foldwins,axis=0) if foldwins else [np.nan,np.nan],predictions

def window(cc,crop,season,calendar,presets):
    if (cc,crop,season) in presets:
        a,b=presets[cc,crop,season]
        return a,b,'prior_panel_window','Established panel window; see original report for calendar caveats.'
    if crop.startswith('Rice,') and (cc,'Rice, paddy',season) in presets:
        a,b=presets[cc,'Rice, paddy',season]
        return a,b,'rice_family_window','Same climate window as the corresponding paddy-rice panel; processed forms and rice components remain separate, overlapping views.'
    c=calendar[(calendar.country_code==cc)&(calendar.season_name==season)]
    if len(c) and pd.notna(c.iloc[0].planting_month):
        r=c.iloc[0]
        return int(r.planting_month+12*r.planting_year_offset),int(r.harvest_month+12*r.harvest_year_offset),'supplied_season_calendar',r.source
    if cc=='IN' and season=='Whole Year':
        return 13,24,'annual_following_year_assumption','January–December following reported sowing year. Crop-dependent harvest assignment remains unresolved.'
    return 1,12,'calendar_year_assumption','January–December of reported year. Annual aggregation or missing crop calendar; crop-specific window remains unresolved.'

def exposure(idx,years,a,b):
    out={}
    for y in years:
        dates=pd.date_range(pd.Timestamp(int(y),1,1)+pd.DateOffset(months=a-1),pd.Timestamp(int(y),1,1)+pd.DateOffset(months=b-1),freq='MS')
        v=idx.reindex(dates)
        out[int(y)]=float(v.mean()) if v.notna().all() else np.nan
    return out

def run():
    calendar=pd.read_csv(DATA/'v0.2/season_calendar_asia_v0.2.csv')
    idx=pd.read_csv(BASE/'results/monthly_indices.csv',index_col=0,parse_dates=True).n34
    presets={(cc,crop,season):(a,b) for name,cc,crop,season,a,b,n in SPECS}
    correction=json.loads((BASE/'latex_extension/results/verified_correction.json').read_text())
    rows=[]; inventory=[]; panels=[]; observations=[]; folds=[]; hashes=[]
    for path in sorted(DATA.glob('v*/*/hvstat_asia_??_v*.csv')):
        d=pd.read_csv(path); cc=d.country_code.iloc[0]
        hashes.append({'path':str(path.relative_to(DATA)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        d['season_name']=d.season_name.str.replace('Summer Rice','Autumn Rice',regex=False)
        assert not d.duplicated(['stable_id','product','season_name','year']).any()
        dc=complete(d.area_planted_complete).where(d.yield_basis.eq('planted'),complete(d.area_harvested_complete))
        d['valid']=dc&complete(d.production_complete)&np.isfinite(d.yield_mt_ha)&d.yield_mt_ha.gt(0)
        d['corrected']=False
        if cc=='ID':
            m=d.stable_id.eq(correction['stable_id'])&d['product'].eq('Rice, paddy')&d.year.eq(2017)
            assert m.sum()==1
            d.loc[m,'yield_mt_ha']=correction['verified_yield_t_ha'];d.loc[m,'corrected']=True
        print(cc,flush=True)
        for (crop,season),g in d.groupby(['product','season_name'],dropna=False,sort=True):
            if pd.isna(crop) or pd.isna(season): raise ValueError('Unlabelled crop/season')
            pid=cc+'_'+hashlib.sha256((crop+'|'+season).encode()).hexdigest()[:12]
            a,b,kind,note=window(cc,crop,season,calendar,presets)
            ex=exposure(idx,range(int(g.year.min()),int(g.year.max())+1),a,b)
            meta=dict(panel=pid,country=cc,country_name=g.country.iloc[0],crop=crop,season=season,start_relative_month=a,end_relative_month=b,window_type=kind,window_note=note)
            accepted=0
            for uid,u in g.groupby('stable_id',sort=True):
                v=u[u.valid].sort_values('year').copy(); v['x']=v.year.map(ex);v=v[np.isfinite(v.x)]
                reason='included' if len(v)>=20 else 'fewer_than_20_complete_positive_years'
                inv=dict(**meta,stable_id=uid,unit_name=u.unit_name.iloc[0],raw_years=len(u),valid_years=len(v),status=reason)
                if len(v)<20:inventory.append(inv);continue
                t=v.year.to_numpy();x=v.x.to_numpy();y=np.log(v.yield_mt_ha.to_numpy())
                if min((x>0).sum(),(x<0).sum())<5:
                    inv['status']='fewer_than_5_years_of_either_ENSO_sign';inventory.append(inv);continue
                coefs={m:regress(design(t,x,m),y) for m in ['trend','linear','quadratic','hinge']}
                if any(c is None for c in coefs.values()):
                    inv['status']='rank_deficient_design';inventory.append(inv);continue
                inventory.append(inv);accepted+=1
                ss={m:float(np.sum((y-design(t,x,m)@coef)**2)) for m,coef in coefs.items()}
                r=dict(**meta,stable_id=uid,unit_name=u.unit_name.iloc[0],n=len(v),first_year=int(t.min()),last_year=int(t.max()),warm_years=int((x>0).sum()),cold_years=int((x<0).sum()),x_min=x.min(),x_max=x.max(),yield_basis=';'.join(sorted(v.yield_basis.unique())),corrected_rows=int(v.corrected.sum()),extreme_yield_rows=int(((v.yield_mt_ha<.05)|(v.yield_mt_ha>30)).sum()))
                r.update(beta=coefs['linear'][2],sensitivity_pct=100*np.expm1(coefs['linear'][2]),partial_r2=1-ss['linear']/ss['trend'],quadratic_beta=coefs['quadratic'][2],curvature=coefs['quadratic'][3],cold_beta=coefs['hinge'][2],warm_beta=coefs['hinge'][2]+coefs['hinge'][3],hinge_delta=coefs['hinge'][3],quadratic_partial_r2=1-ss['quadratic']/ss['trend'],hinge_partial_r2=1-ss['hinge']/ss['trend'])
                r['trend2_beta']=regress(design(t,x,'linear',True),y)[3]
                r['trend2_same_sign']=r['beta']*r['trend2_beta']>0
                for offset in [0,2]:
                    loss,ncv,wins,pred=validation(t,x,y,offset)
                    r[f'cv_years_{offset}']=ncv
                    for j,m in enumerate(['linear','quadratic','hinge'],1):
                        r[f'{m}_skill_{offset}']=1-loss[j]/loss[0]
                        if m!='linear':
                            r[f'{m}_gain_{offset}']=1-loss[j]/loss[1]
                            r[f'{m}_fold_fraction_{offset}']=wins[j-2]
                    for i,year in enumerate(t):
                        folds.append(dict(panel=pid,stable_id=uid,year=int(year),offset=offset,log_yield=float(y[i]),trend_prediction=pred[i,0],linear_prediction=pred[i,1],quadratic_prediction=pred[i,2],hinge_prediction=pred[i,3]))
                loss2,_,_,_=validation(t,x,y,0,True)
                for j,m in [(2,'quadratic'),(3,'hinge')]:
                    r[f'{m}_trend2_gain']=1-loss2[j]/loss2[1]
                    r[f'{m}_repeat_gain']=min(r[f'{m}_gain_0'],r[f'{m}_gain_2']) if np.isfinite([r[f'{m}_gain_0'],r[f'{m}_gain_2']]).all() else np.nan
                    r[f'{m}_candidate']=bool(r[f'{m}_repeat_gain']>0 and r[f'{m}_skill_0']>0 and r[f'{m}_skill_2']>0)
                    r[f'{m}_trend_robust_candidate']=bool(r[f'{m}_candidate'] and r[f'{m}_trend2_gain']>0 and (1-loss2[j]/loss2[0])>0)
                r['nonlinear_candidate']=r['quadratic_candidate'] or r['hinge_candidate']
                r['trend_robust_candidate']=r['quadratic_trend_robust_candidate'] or r['hinge_trend_robust_candidate']
                rows.append(r)
                residual=y-design(t,x,'linear')[:,:2]@coefs['linear'][:2]
                for i in range(len(v)): observations.append(dict(panel=pid,stable_id=uid,year=int(t[i]),n34=x[i],log_yield=y[i],linear_trend_adjusted_log_yield=residual[i]))
            panels.append(dict(**meta,source_units=g.stable_id.nunique(),included_units=accepted))
    result=pd.DataFrame(rows)
    result.to_csv(HERE/'unit_results.csv',index=False)
    pd.DataFrame(inventory).to_csv(HERE/'series_inventory.csv',index=False)
    pd.DataFrame(panels).to_csv(HERE/'panel_inventory.csv',index=False)
    pd.DataFrame(observations).to_csv(HERE/'observations.csv.gz',index=False)
    pd.DataFrame(folds).to_csv(HERE/'heldout_predictions.csv.gz',index=False)
    for h in hashes: assert hashlib.sha256((DATA/h['path']).read_bytes()).hexdigest()==h['sha256']
    (HERE/'source_hashes.json').write_text(json.dumps(hashes,indent=2))
    (HERE/'verified_correction.json').write_text(json.dumps(correction,indent=2))
    summary=result.groupby('country').agg(series=('stable_id','size'),units=('stable_id','nunique'),panels=('panel','nunique'),negative=('beta',lambda v:int((v<0).sum())),nonlinear_candidates=('nonlinear_candidate','sum'),trend_robust_candidates=('trend_robust_candidate','sum'))
    summary.to_csv(HERE/'country_summary.csv')
    print(summary.to_string());print('Total',len(result),flush=True)

if __name__=='__main__':run()
