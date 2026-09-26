"""Independent weighted solves, joint resampling, and held-out-year isolation."""
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/merged'))
import robustness as r
from fit import draws

rng=np.random.default_rng(7301)
year=np.arange(1981,2025)
x=rng.normal(size=len(year))
records=[]
for i in range(4):
    keep=rng.random(len(year))>.08
    yy=year[keep];xx=x[keep]+rng.normal(0,.08,keep.sum())
    logy=1+.04*(yy-2000)/10+(.1+i*.02)*xx+.025*xx**2+rng.normal(0,.12,keep.sum())
    records.append(dict(year=yy,x=xx,y=logy,window=dict(start_relative_month=-2,end_relative_month=4)))

for model in r.MODELS:
    for qt in (False,True):
        st,pool=r.group_fit(records,model,qt,bootstrap=True)
        for i,s in enumerate(st):
            z,f=r.basis(records[i]['year'],records[i]['x'],model,qt);X=np.c_[z,f]
            blocks,counts=draws(1981,2024)
            for b in (0,1,39,173,399):
                w=np.ones(len(z)) if b==0 else counts[b-1,np.searchsorted(blocks,(records[i]['year']-1980)//3)]
                direct=np.linalg.lstsq(X*np.sqrt(w[:,None]),records[i]['y']*np.sqrt(w),rcond=None)[0]
                np.testing.assert_allclose(s['beta'][b],direct[z.shape[1]:],atol=2e-10)
                # Independent stacked within-unit regression for the common curve.
                fs=[];ys=[]
                for rec in records:
                    zz,ff=r.basis(rec['year'],rec['x'],model,qt)
                    ww=np.ones(len(zz)) if b==0 else counts[b-1,np.searchsorted(blocks,(rec['year']-1980)//3)]
                    zw=zz*np.sqrt(ww[:,None]);fw=ff*np.sqrt(ww[:,None]);yw=rec['y']*np.sqrt(ww)
                    fs.append(fw-zw@np.linalg.lstsq(zw,fw,rcond=None)[0]);ys.append(yw-zw@np.linalg.lstsq(zw,yw,rcond=None)[0])
                common=np.linalg.lstsq(np.vstack(fs),np.concatenate(ys),rcond=None)[0]
                np.testing.assert_allclose(pool[i][b],.5*(s['beta'][b]+common),atol=2e-10)
        # Shared draws preserve common noise in the pooled interval.
        copy=[dict(records[0]) for _ in range(4)]
        ss,bb=r.group_fit(copy,model,qt,bootstrap=True)
        np.testing.assert_allclose(bb[0],ss[0]['beta'],atol=2e-10)

s,p=r.group_fit(records[:2],'linear');assert np.isnan(p[0]).all()
# Mutating held-out outcomes in every peer cannot change training predictions.
edge=2000;keep=[(a['year']<edge-1)|(a['year']>edge+5) for a in records]
altered=[dict(a,y=np.where(k,a['y'],a['y']+10000)) for a,k in zip(records,keep)]
s,p=r.group_fit(records,'quadratic',keeps=keep)
s2,p2=r.group_fit(altered,'quadratic',keeps=keep)
for a,b in zip(p,p2):np.testing.assert_equal(a,b)
# Cross-year crop windows must omit the following harvest of a winter episode.
mask=r.event_keep(np.array([1996,1997,1998,1999]),dict(start_relative_month=-2,end_relative_month=4),dict(start=1997*12+5,end=1998*12+3))
np.testing.assert_equal(mask,[True,True,False,True])
# A constant unit conversion affects only the intercept, including pooling.
shift=[dict(a,y=a['y']+np.log(1/.67)) for a in records]
s,p=r.group_fit(records,'hinge',bootstrap=True);s2,p2=r.group_fit(shift,'hinge',bootstrap=True)
for a,b in zip(p,p2):np.testing.assert_allclose(a,b,atol=2e-10)
print('PASS independent weighted individual/common solves, common bootstrap uncertainty, joint holdout isolation, cross-year omission, rice scale invariance.')
