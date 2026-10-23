"""Compare held district races with the ZIP references actually used by readers."""
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = '78f82a232dd1d0545a46835e7716032ff3807425'


def baseline(path):
    return json.loads(subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT))


def read(path, old=False):
    return baseline(path) if old else json.loads((ROOT / path).read_text())


def unreachable(state, old):
    index = read('data/derived/zip-divisions/index.json', old)
    reached = set()
    for prefix in index['statesToShards'].get(state, []):
        shard = read(f'data/derived/zip-divisions/{prefix}.json', old)
        for refs in shard['zips'].values():
            reached.update(shard['divisions'][n] for n in refs)
    # The normal resolver includes OCD ancestors (county, state, country).
    for division in list(reached):
        parts = division.split('/')
        reached.update('/'.join(parts[:n]) for n in range(2, len(parts)))
    data = read(f'data/ballot/2026-general/{state.lower()}.json', old)
    memberships = [m for ballot in data['ballots'].values() for m in ballot.get('districtMemberships', [])]
    while True:
        more = {m['districtOcdId'] for m in memberships if m['memberOcdId'] in reached}
        if more <= reached:
            break
        reached.update(more)
    return [{'id': c['id'], 'title': c['title'], 'district': c['ocdId']}
            for ballot in data['ballots'].values()
            for c in ballot.get('contests', []) + ballot.get('heldContests', [])
            if c['ocdId'] not in reached and not re.search(r'/(?:cd|sldu|sldl):', c['ocdId'])]


rows = []
for path in sorted((ROOT / 'data/ballot/2026-general').glob('*.json')):
    if path.stem in ('index',):
        continue
    state = path.stem.upper()
    try:
        before, after = unreachable(state, True), unreachable(state, False)
    except (KeyError, subprocess.CalledProcessError):
        continue
    if before or after:
        rows.append({'state': state, 'before': len(before), 'after': len(after), 'remaining': after})
report = {'step': 'BL-02', 'baselineRevision': BASE,
          'scope': 'Held non-congressional/non-state-legislative contests against actual referenced static ZIP entries and transitive districtMemberships. BL-01 supplies published Census election geography for legislative bridges.',
          'before': sum(r['before'] for r in rows), 'after': sum(r['after'] for r in rows),
          'states': rows,
          'remainingMeaning': 'A missing static ZIP route is not proof of a missing exact-address route. Legislative district bridges are checked separately by BL-01.'}
(ROOT / 'data/ballot/reports/bl02-reachability.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'before': report['before'], 'after': report['after'],
                  'remaining': {r['state']: r['after'] for r in rows if r['after']}}))
