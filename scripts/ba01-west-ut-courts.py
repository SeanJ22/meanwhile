#!/usr/bin/env python3
"""Replay of the state's explicit regional court retention certification."""
from pathlib import Path
from datetime import datetime, timezone
import copy, json, re, runpy

ROOT = Path(__file__).resolve().parents[1]
COMMON = runpy.run_path(str(ROOT / 'scripts/ba01-west-court-county.py'))


def import_courts(package):
    raw, source = COMMON['state_capture']('ut-alternate')
    assert raw.startswith(b'%PDF')
    text, _ = COMMON['state_capture']('ut.txt')
    text = re.sub(r'\s+', ' ', text.decode())
    region = text.split('First Judicial District.')[1].split('Justice Courts.')[0]
    region = 'First Judicial District.' + region
    pattern = r'(First|Second|Third|Fourth|Fifth|Sixth|Seventh) Judicial District\. The \1 Judicial District consists of (.*?) Counties\.'
    heads = list(re.finditer(pattern, region))
    assert len(heads) == 7
    ballot = next(iter(package['ballots'].values()))
    before = {key: len(ballot[key]) for key in ['contests', 'candidacies']}
    counts = []
    for i, match in enumerate(heads):
        ordinal, counties = match[1], match[2]
        number = i + 1
        section = region[match.end():heads[i + 1].start() if i + 1 < len(heads) else len(region)]
        questions = re.findall(r'Shall (.*?) be retained in the office of (.*?)\?', section)
        assert questions
        court = f'ocd-division/country:us/state:ut/judicial_district:{number}'
        for name, office in questions:
            assert re.fullmatch(r'[A-Z .-]+', name), 'Every name is copied from the official certification'
            assert 'Judge of the' in office and (ordinal + ' Judicial' in office or ordinal + ' Juvenile' in office)
            court_type = 'Juvenile Court' if 'Juvenile' in office else 'District Court'
            title = f'{ordinal} Judicial District — {court_type} — {name} — Retention'
            identifier = 'ut-general-2026-' + COMMON['slug'](ordinal) + '-district-retention-' + COMMON['slug'](name)
            COMMON['race'](package, identifier, title, court, [(name, None)], source, 'Utah Lieutenant Governor Elections',
                f'Shall {name} be retained in the office of {office}?\nYes / No', retention=True)
        members = [county for county in re.split(r',\s*(?:and\s+)?|\s+and\s+', counties) if county]
        for county in members:
            COMMON['member'](package, 'ut', county.lower().replace(' ', '_'), court, source,
                'Utah Lieutenant Governor Elections', match[0])
        counts.append({'district': number, 'counties': members, 'contests': len(questions), 'names': [name for name, _ in questions]})
    assert [row['contests'] for row in counts] == [1, 6, 7, 5, 3, 2, 1]
    COMMON['receipt'](package, source, 'Utah Lieutenant Governor Elections',
        'Amended2026GeneralCertification pages19-21 explicitly prints all25regional district/juvenile retention decisions, '
        'their25names,and each district whole-county membership. SevenThirdDistrict names independently appear in officialSaltLakeBT1. '
        'Municipal/countyjustice courts remain separate until exact political-subdivision electorates are verified.')
    return {'added': {key: len(ballot[key]) - before[key] for key in before}, 'districts': counts}


if __name__ == '__main__':
    package = json.loads((ROOT / 'data/ballot/2026-general/ut.json').read_text())
    before = copy.deepcopy(package)
    result = import_courts(package)
    ballot, prior = next(iter(package['ballots'].values())), next(iter(before['ballots'].values()))
    for key in ['contests', 'candidacies', 'measures', 'heldContests']:
        current = {row['id']: row for row in ballot.get(key, [])}
        assert all(current.get(row['id']) == row for row in prior.get(key, []))
    package['sourceReceipt']['reviewedAt'] = max([datetime.now(timezone.utc)] +
        [datetime.fromisoformat(row['retrievedAt'].replace('Z', '+00:00')) for row in package['sourceReceipt']['sources']]).isoformat()
    (ROOT / 'data/ballot/2026-general/ut.json').write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'data/ballot/ba01-west-evidence/ut-courts-denominator.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
