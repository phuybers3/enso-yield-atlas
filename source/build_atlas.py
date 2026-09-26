"""Create a self-contained map atlas and scientific figures from unit estimates."""
from pathlib import Path
import json, sys, shutil
import numpy as np
import pandas as pd
import geopandas as gpd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
HERE=Path(__file__).resolve().parent
BASE=HERE.parent; DATA=BASE.parent
sys.path.insert(0,str(BASE/'scripts'))
from analyze import SPECS
from atlas_observations import enrich
OUT=Path('/Users/phuybers/Documents/Codex/2026-09-22/ple/outputs')

def geom_path(geom,bounds):
    xmin,ymin,xmax,ymax=bounds
    scale=min(470/(xmax-xmin),285/(ymax-ymin))
    dx=(500-(xmax-xmin)*scale)/2;dy=(315-(ymax-ymin)*scale)/2
    pieces=[]
    for poly in ([geom] if geom.geom_type=='Polygon' else geom.geoms):
        if poly.geom_type!='Polygon':continue
        for ring in [poly.exterior,*poly.interiors]:
            points=[f'{dx+(x-xmin)*scale:.2f},{315-dy-(y-ymin)*scale:.2f}' for x,y,*_ in ring.coords]
            pieces.append('M'+'L'.join(points)+'Z')
    return ''.join(pieces)

def run():
    r=pd.read_csv(HERE/'unit_results.csv')
    panels=pd.read_csv(HERE/'panel_inventory.csv').fillna('')
    shapes={}; geos={}
    for p in DATA.glob('v*/*/*boundary*.gpkg'):
        cc=p.parent.name;g=gpd.read_file(p).to_crs(4326)
        lon=(g.total_bounds[0]+g.total_bounds[2])/2;lat=(g.total_bounds[1]+g.total_bounds[3])/2
        g=g.to_crs(f'+proj=laea +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m +no_defs')
        g.geometry=g.geometry.simplify(800,preserve_topology=True)
        bounds=g.total_bounds;geos[cc]=g
        shapes[cc]=[dict(id=row.stable_id,name=row.unit_name,path=geom_path(row.geometry,bounds)) for row in g.itertuples()]
        assert set(r.loc[r.country==cc,'stable_id'])<=set(g.stable_id)
    (HERE/'map_shapes.json').write_text(json.dumps(shapes,separators=(',',':')))
    cols=['panel','stable_id','unit_name','n','first_year','last_year','beta','sensitivity_pct','partial_r2','quadratic_beta','curvature','cold_beta','warm_beta','hinge_delta','x_min','x_max','warm_years','cold_years','quadratic_repeat_gain','hinge_repeat_gain','linear_skill_0','linear_skill_2','quadratic_gain_0','quadratic_gain_2','hinge_gain_0','hinge_gain_2','quadratic_candidate','hinge_candidate','trend_robust_candidate','trend2_same_sign','corrected_rows','extreme_yield_rows','quadratic_trend2_gain','hinge_trend2_gain']
    o=pd.read_csv(HERE/'observations.csv.gz')
    rugs={}
    for (pid,uid),g in o.groupby(['panel','stable_id']):rugs[pid+'|'+uid]=g.n34.round(3).tolist()
    payload=dict(columns=cols,rows=json.loads(r[cols].round(7).to_json(orient='values')),panels=panels.to_dict('records'),shapes=shapes,rugs=rugs)
    payload=enrich(payload)
    template=(HERE/'atlas_template.html').read_text().replace('__EXPLORER_SCRIPT__',(HERE/'atlas_explorer.js').read_text())
    text=template.replace('__PAYLOAD__',json.dumps(payload,separators=(',',':')).replace('</','<\\/'))
    (HERE/'ENSO_unit_atlas.html').write_text(text)
    if OUT.exists():shutil.copy2(HERE/'ENSO_unit_atlas.html',OUT/'ENSO_unit_atlas.html')
    figdir=HERE/'figures';figdir.mkdir(exist_ok=True)
    plt.rcParams.update({'font.size':10,'svg.fonttype':'none'})
    for name,cc,crop,season,*_ in SPECS:
        sub=r[(r.country==cc)&(r.crop==crop)&(r.season==season)]
        if sub.empty:continue
        g=geos[cc].merge(sub,on='stable_id',how='left',suffixes=('','_result'))
        fig,axes=plt.subplots(2,2,figsize=(11,8.2))
        settings=[('sensitivity_pct','Yield sensitivity (% per +1°C Niño 3.4)',-20,20,'RdBu'),('partial_r2','Variance explained beyond linear trend (%)',0,50,'viridis'),('quadratic_repeat_gain','Quadratic: smaller gain across two CV layouts (%)',-20,20,'RdBu'),('hinge_repeat_gain','Warm/cold slopes: smaller gain across layouts (%)',-20,20,'RdBu')]
        for ax,(col,label,vmin,vmax,cmap) in zip(axes.flat,settings):
            v=g[col]*(1 if col=='sensitivity_pct' else 100)
            g.assign(value=v).plot(column='value',ax=ax,cmap=cmap,vmin=vmin,vmax=vmax,edgecolor='#555555',linewidth=.18,missing_kwds={'color':'#dddddd'})
            ax.set_axis_off();ax.set_title(label,fontsize=10)
            fig.colorbar(plt.cm.ScalarMappable(norm=Normalize(vmin,vmax),cmap=cmap),ax=ax,orientation='horizontal',fraction=.045,pad=.01,extend='both' if vmin<0 else 'max')
        fig.suptitle(f'{sub.country_name.iloc[0]} · {crop} · {season}\n{sub.shape[0]} independently fitted units; ≥20 complete positive-yield years',fontsize=14)
        fig.text(.5,.015,'Gray: no eligible estimate. Fixed color limits; extreme values saturate. Nonlinear gains are descriptive, with no uncertainty or significance tests.',ha='center',fontsize=8)
        fig.tight_layout(h_pad=2.8,rect=(0,.04,1,.93));fig.savefig(figdir/f'{name}.png',dpi=150);fig.savefig(figdir/f'{name}.svg');fig.savefig(figdir/f'{name}.pdf');plt.close(fig)
    print('Built atlas and',len(list(figdir.glob('*.png'))),'map sheets',flush=True)

if __name__=='__main__':run()
