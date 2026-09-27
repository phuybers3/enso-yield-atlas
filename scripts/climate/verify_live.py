"""Compare selected live Pages files with the checked local release."""
import argparse,hashlib,json,time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request,urlopen
from build_weather import ROOT,OUT,write

FILES=['climate/index.html','climate/app.js','climate/model.js','climate/style.css',
 f'climate/data/{OUT.name}/catalog.json',f'climate/data/{OUT.name}/manifest.json',f'climate/data/{OUT.name}/methods.json',
 f'climate/data/{OUT.name}/observations/ARG-wheat.json.gz',f'climate/data/{OUT.name}/observations/IND-maize.json.gz',
 f'climate/data/{OUT.name}/fits/nino34/tmean/wheat.json.gz',f'climate/data/{OUT.name}/fits/mei/p95/rice.json.gz',
 'global/index.html','global/merged-app.js','global/merged-model.js']

def check(name,base):
 request=Request(base.rstrip('/')+'/'+name+'?verify='+str(int(time.time())),headers={'User-Agent':'enso-atlas-release-verification','Accept-Encoding':'identity'})
 with urlopen(request,timeout=90) as response:data=response.read()
 local=(ROOT/name).read_bytes();a=hashlib.sha256(data).hexdigest();b=hashlib.sha256(local).hexdigest()
 assert a==b,(name,'live checksum differs')
 return {'file':name,'bytes':len(data),'sha256':a,'passed':True}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--base',default='https://phuybers3.github.io/enso-yield-atlas');a=p.parse_args()
 with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda name:check(name,a.base),FILES))
 write(ROOT/'provenance/climate/live-verification.json',{'base':a.base,'checked_utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'passed':True,'files':results})
 print('PASS live checksums',len(results),'files,',sum(r['bytes'] for r in results),'bytes')
