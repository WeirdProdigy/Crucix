"""Read-only GitHub review snapshot. Never execute downloaded PR content."""
import concurrent.futures
import json
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'upstream-review'
OUT.mkdir(parents=True, exist_ok=True)
REPO = 'repos/calesthio/Crucix'

def api(path, diff=False):
    cmd = ['gh', 'api', path]
    if diff:
        cmd += ['-H', 'Accept: application/vnd.github.diff']
    else:
        cmd += ['--paginate', '--slurp']
    result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', check=True)
    if diff:
        return result.stdout
    pages = json.loads(result.stdout)
    return [item for page in pages for item in page] if pages and isinstance(pages[0], list) else pages[0]

prs = [i for page in json.loads((pathlib.Path(tempfile.gettempdir()) / 'crucix-prs.json').read_text(encoding='utf-8-sig')) for i in page]
issues = [i for page in json.loads((pathlib.Path(tempfile.gettempdir()) / 'crucix-issues.json').read_text(encoding='utf-8-sig')) for i in page if 'pull_request' not in i]
(OUT / 'index.json').write_text(json.dumps({'prs': prs, 'issues': issues}, ensure_ascii=False, indent=2), encoding='utf-8')

def collect(item, kind):
    number = item['number']
    path = OUT / f'{kind}-{number}.json'
    if path.exists():
        return f'{kind} #{number}: cached'
    data = {'item': item, 'comments': api(f'{REPO}/issues/{number}/comments?per_page=100')}
    if kind == 'pr':
        data['details'] = api(f'{REPO}/pulls/{number}')
        data['files'] = api(f'{REPO}/pulls/{number}/files?per_page=100')
        data['reviews'] = api(f'{REPO}/pulls/{number}/reviews?per_page=100')
        data['reviewComments'] = api(f'{REPO}/pulls/{number}/comments?per_page=100')
        try:
            data['diff'] = api(f'{REPO}/pulls/{number}', diff=True)
        except subprocess.CalledProcessError as error:
            # GitHub refuses exceptionally large diffs; get the exact trees,
            # without checkout or execution of the downloaded contribution.
            subprocess.run(['git', 'fetch', 'origin', f'refs/pull/{number}/head:refs/review/pr-{number}'], cwd=ROOT, check=True, capture_output=True)
            base = data['details']['base']['sha']
            subprocess.run(['git', 'fetch', 'origin', base], cwd=ROOT, check=True, capture_output=True)
            merge_base = subprocess.run(['git', 'merge-base', base, f'refs/review/pr-{number}'], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
            data['diff'] = subprocess.run(['git', 'diff', merge_base, f'refs/review/pr-{number}'], cwd=ROOT, check=True, capture_output=True, text=True, encoding='utf-8').stdout
            data['diffMethod'] = 'local git diff, API diff unavailable'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return f'{kind} #{number}: downloaded'

print(f'Snapshot: {len(prs)} PRs, {len(issues)} issues', flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures = [pool.submit(collect, i, k) for k, items in [('pr', prs), ('issue', issues)] for i in items]
    for future in concurrent.futures.as_completed(futures):
        try:
            print(future.result(), flush=True)
        except Exception as error:
            print(f'FAILED: {error}', flush=True)
