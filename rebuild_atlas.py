"""Rebuild the offline atlas from frozen inputs using the standard library."""
from pathlib import Path
import gzip,json,hashlib
ROOT=Path(__file__).resolve().parent
with gzip.open(ROOT/'source/atlas_payload.json.gz','rt') as f:
    payload=json.load(f)
assert len(payload['rows'])==len(payload['observations'])==8738
html=(ROOT/'source/atlas_template.html').read_text()
html=html.replace('__PAYLOAD__',json.dumps(payload,separators=(',',':')).replace('</','<\\/'))
html=html.replace('__EXPLORER_SCRIPT__',(ROOT/'source/atlas_explorer.js').read_text())
assert '__PAYLOAD__' not in html and '__EXPLORER_SCRIPT__' not in html
(ROOT/'index.html').write_text(html)
print('Built index.html:',hashlib.sha256(html.encode()).hexdigest())
