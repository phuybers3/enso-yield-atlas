"""Export issued LSPA estimates separately from municipal outcomes and model fits."""
from pathlib import Path
import argparse,json,sqlite3,sys,hashlib
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data/pipelines'))
from refresh_brazil_pam import norm,write,STATES
PRODUCTS={'39432':('rice','annual'),'39441':('maize','safra'),'39442':('maize','safrinha'),'39443':('soybean','annual'),'39444':('sorghum','annual'),'39445':('wheat','annual'),'39467':('cassava','annual')}
VARS={'109':'planted_ha','216':'harvested_ha','35':'production_t','36':'yield_kg_ha'}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--release',required=True);a=ap.parse_args()
 c=sqlite3.connect(f'file:{ROOT}/data/releases/enso_ag_{a.release}.sqlite?mode=ro',uri=True)
 raw=pd.read_sql_query('select * from brazil_lspa_estimates',c);units=pd.read_sql_query("select distinct region_key,region_name from unit_regions where iso3='BRA'",c);c.close()
 regions={norm(r.region_name):r.region_key for r in units.itertuples()}
 d=raw[raw.D4C.isin(PRODUCTS)&raw.D2C.isin(VARS)].copy();d['value']=pd.to_numeric(d.V.replace({'-':'0'}),errors='coerce')
 rows=[]
 for (geo,name,period,prod),g in d.groupby(['D1C','D1N','D3C','D4C']):
  values=dict(zip(g.D2C,g.value));fam,season=PRODUCTS[prod]
  key='BRA' if geo=='1' else regions.get(norm(STATES.get(int(geo),name)))
  row=dict(geo_key=key,ibge_geography=geo,geography_name=name,geography_level='national' if geo=='1' else 'state',reference_month=period[:4]+'-'+period[4:],crop_family=fam,season=season,status='provisional',**{v:(float(values[k]) if k in values and pd.notna(values[k]) else None) for k,v in VARS.items()})
  row['yield_t_ha']=row.pop('yield_kg_ha');row['yield_t_ha']=None if row['yield_t_ha'] is None else row['yield_t_ha']/1000
  # SIDRA uses '-' for absolute zero, including yield cells for absent crops.
  # A zero-area entry has no yield denominator; retain its area/production zeros.
  if row['harvested_ha'] is not None and row['harvested_ha']<=0:
   row['yield_t_ha']=None
   row['yield_status']='not applicable: no harvested area'
  rows.append(row)
 folder=ROOT/'atlas/site/data/agency-estimates';dest=folder/a.release/'BRA.json';dest.parent.mkdir(parents=True,exist_ok=True)
 retrieved=sorted(raw.retrieved_date.dropna().unique())
 assert len(retrieved)==1, 'Review mixed retrieval vintages before export'
 write(dest,dict(release=a.release,iso3='BRA',provider='IBGE',product='Levantamento Sistemático da Produção Agrícola (LSPA)',url='https://sidra.ibge.gov.br/tabela/6588',source_reference_month=sorted(d.D3C.unique())[-1],retrieved=retrieved[0],publication_date=None,scope='Provisional national/state estimates. Excluded from municipal observations and ENSO regression training. Yield is per harvested hectare; absent harvested area has no displayed yield.',rows=rows))
 registry=folder/'index.json';r=json.loads(registry.read_text()) if registry.exists() else dict(releases={});r['releases'].setdefault(a.release,{})['BRA']=f'{a.release}/BRA.json';write(registry,r)
 print('Exported',len(rows),'LSPA crop/geography estimates for',a.release)
if __name__=='__main__':main()
