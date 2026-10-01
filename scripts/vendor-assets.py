"""Download explicitly pinned dashboard assets; --verify performs no network I/O."""
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'dashboard' / 'public'
LEDGER = ROOT / 'vendor' / 'manifest.json'
ASSETS = [
 ('vendor/gsap-3.12.5.min.js', 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js', 'GSAP 3.12.5'),
 ('vendor/d3-7.9.0.min.js', 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js', 'ISC'),
 ('vendor/topojson-client-3.1.0.min.js', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js', 'ISC'),
 ('vendor/globe.gl-2.33.0.min.js', 'https://cdn.jsdelivr.net/npm/globe.gl@2.33.0/dist/globe.gl.min.js', 'MIT and bundled dependency notices'),
 ('vendor/countries-110m-2.0.2.json', 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json', 'ISC / Natural Earth public domain data'),
 ('vendor/earth-night-2.33.0.jpg', 'https://cdn.jsdelivr.net/npm/three-globe@2.33.0/example/img/earth-night.jpg', 'three-globe MIT example asset'),
 ('vendor/earth-topology-2.33.0.png', 'https://cdn.jsdelivr.net/npm/three-globe@2.33.0/example/img/earth-topology.png', 'three-globe MIT example asset'),
 ('vendor/licenses/gsap-3.12.5-reference.md', 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/README.md', 'GSAP 3.12.5 licence reference; retained banner in distribution'),
 ('vendor/licenses/d3.txt', 'https://cdn.jsdelivr.net/npm/d3@7.9.0/LICENSE', 'ISC'),
 ('vendor/licenses/topojson-client.txt', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/LICENSE', 'ISC'),
 ('vendor/licenses/globe.gl.txt', 'https://cdn.jsdelivr.net/npm/globe.gl@2.33.0/LICENSE', 'MIT'),
 ('vendor/licenses/world-atlas.txt', 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/LICENSE', 'ISC'),
 ('vendor/licenses/three-globe.txt', 'https://cdn.jsdelivr.net/npm/three-globe@2.33.0/LICENSE', 'MIT'),
 ('vendor/licenses/ibm-plex-mono.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt', 'SIL OFL 1.1'),
 ('vendor/licenses/space-grotesk.txt', 'https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/OFL.txt', 'SIL OFL 1.1'),
]

def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()

def record(path, data, source, licence):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {'path': '/' + path, 'source': source, 'licence': licence, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

if '--verify' in sys.argv:
    ledger = json.loads(LEDGER.read_text(encoding='utf-8'))
    for asset in ledger['assets']:
        data = (ROOT / asset['path'].lstrip('/')).read_bytes()
        assert hashlib.sha256(data).hexdigest() == asset['sha256'], asset['path']
    print(f"Verified {len(ledger['assets'])} pinned assets")
else:
    records = []
    for path, url, licence in ASSETS:
        records.append(record(path, download(url), url, licence))
        print(path, flush=True)
    world = json.loads((ROOT / 'vendor/countries-110m-2.0.2.json').read_bytes())
    wrapper = ('window.__CRUCIX_WORLD_GEOMETRY__ = ' + json.dumps(world, separators=(',', ':')).replace('<', '\\u003c') + ';\n').encode()
    records.append(record('vendor/countries-110m-2.0.2.js', wrapper, ASSETS[4][1] + ' (generated inert JSON wrapper for file:// compatibility)', 'ISC / Natural Earth public domain data'))
    font_url = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Space+Grotesk:wght@300;400;500;600;700&display=swap'
    css = download(font_url).decode('utf-8')
    for url in dict.fromkeys(re.findall(r'url\((https://[^)]+)\)', css)):
        path = 'vendor/fonts/' + hashlib.sha256(url.encode()).hexdigest()[:20] + '.' + url.rsplit('.', 1)[-1]
        records.append(record(path, download(url), url, 'SIL OFL 1.1; see font licences'))
        css = css.replace(url, 'fonts/' + Path(path).name)
    records.append(record('vendor/fonts.css', css.encode(), font_url, 'SIL OFL 1.1; see font licences'))
    LEDGER.write_text(json.dumps({'schema': 1, 'assets': records}, indent=2) + '\n', encoding='utf-8')
    print(f"Stored {len(records)} assets with SHA-256 ledger")
