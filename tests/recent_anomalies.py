"""Check matched periods, missing rain and weekly availability with synthetic inputs."""
from pathlib import Path
import importlib.util
import numpy as np

spec = importlib.util.spec_from_file_location('recent',Path(__file__).parents[1]/'scripts/export_recent_anomalies.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

years=np.arange(2001,2026)
y=np.c_[2+.3*(years-2026),7-.2*(years-2026)]
y[0,1]=np.nan
ref,n=m.reference(years,y,2026)
np.testing.assert_allclose(ref,[2,7],atol=1e-12)
assert n.tolist()==[25,24]
assert np.isnan(m.reference(years[:9],y[:9],2026)[0]).all()

t=np.arange(int((np.datetime64('2026-10-01')-m.EPOCH).astype(int)),int((np.datetime64('2026-10-29')-m.EPOCH).astype(int)))
v=np.ones((28,2));v[10,1]=np.nan
obs,cov=m.aggregate(t,v,np.ones(28,int),np.datetime64('2026-10-01'),np.datetime64('2026-10-26'),mean=False,coverage=1)
assert obs[0]==25 and np.isnan(obs[1]) and cov[1]==24/25
v=np.ones((4,1));v[-1]=1000
obs,cov=m.aggregate(t[::7],v,np.full(4,7),np.datetime64('2026-10-01'),np.datetime64('2026-10-26'),mean=True,coverage=.8,available=np.datetime64('2026-10-26'))
assert obs[0]==1 and cov[0]==21/25, 'Unfinished composite must not leak into observations'
assert m.window(2024,2,28)[1]==np.datetime64('2024-02-29')
assert m.window(2025,2,29)[1]==np.datetime64('2025-03-01')
print('PASS: reference fit, minimum history, exact rainfall coverage, composite availability and leap-year windows')
