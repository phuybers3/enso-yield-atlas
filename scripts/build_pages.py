"""Assemble Pages without duplicating the new atlas's frozen data on that host.

All data stay in Git, served from the exact deployment commit on raw.githubusercontent.com.
Existing archive URLs retain byte-identical files. Local previews use their local data.
"""
import argparse, json, os, re, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def build(out,sha):
    if not re.fullmatch('[0-9a-f]{40}',sha):raise ValueError('A full commit SHA is required')
    out=Path(out).resolve()
    if out.exists():raise ValueError('Use a new output directory')
    out.mkdir(parents=True)
    names=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    total=0;count=0
    for name in names:
        if not name or name.startswith(('site/data/','site/display/','.github/','scripts/','tests/','.git')) or name=='ATLAS_OVERNIGHT_STATUS.json':continue
        p=ROOT/name
        if p.is_symlink():raise ValueError('Unexpected symlink '+name)
        q=out/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);total+=p.stat().st_size;count+=1
    base=f'https://raw.githubusercontent.com/phuybers3/enso-yield-atlas/{sha}/site/'
    (out/'site/hosting.json').write_text(json.dumps({'commit':sha,'data_base':base})+'\n')
    assert not (out/'site/data').exists() and not (out/'site/display').exists()
    assert total<1024**3, f'Pages payload exceeds 1 GiB: {total}'
    print(json.dumps({'files':count,'bytes':total,'commit':sha,'data_base':base}))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);ap.add_argument('--sha',default=os.environ.get('GITHUB_SHA'));a=ap.parse_args();build(a.output,a.sha)
