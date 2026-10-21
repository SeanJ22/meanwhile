#!/usr/bin/env python3
"""Replay of qualified general countywide and district-court choices."""
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone
import copy, gzip, hashlib, json, os, re, runpy, unicodedata

ROOT = Path(os.environ.get('BA01_WEST_ROOT', Path(__file__).resolve().parents[1]))
COMMON = runpy.run_path(str(ROOT / 'scripts/ba01-west-court-county.py'))
CAPTURES = Path(os.environ.get('BA01_WEST_NM_LOCAL_CAPTURES', ROOT / 'data/ballot/ba01-west-evidence/nm-local-captures'))


def county_id(value):
    plain = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return 'de_baca' if plain == 'debaca' else plain.replace(' ', '_')


def quote(rows):
    fields = {0: 'contest', 1: 'classification', 2: 'district', 3: 'county', 4: 'name', 8: 'party', 21: 'status'}
    return '2026 General Election Contest/Candidate List\n' + '\n'.join(json.dumps(
        {label: row[index] for index, label in fields.items()}, ensure_ascii=False, separators=(',', ':')) for row in rows)


def snapshot(name):
    source = next(r for r in json.loads((CAPTURES / 'manifest.json').read_text()) if r['name'] == name)
    raw = gzip.decompress((CAPTURES / source['file']).read_bytes())
    text = (CAPTURES / source['textSnapshot']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == source['rawHash']
    assert hashlib.sha256(text).hexdigest() == source['textHash']
    return text.decode(), source


def import_counties(package):
    raw, _ = COMMON['state_capture']('nm-rows.json')
    rows = [r for r in json.loads(raw) if len(r) > 22 and r[21] == 'Qualified']
    original, source = COMMON['state_capture']('nm')
    assert b'2026 General Election Contest/Candidate List' in original and len(rows) == 503
    runpy.run_path(str(ROOT / 'scripts/ba01-west-html-proof.py'))['prove_rows'](original, rows, [0, 1, 2, 3, 4, 8, 21])
    ballot = next(iter(package['ballots'].values()))
    before = {key: len(ballot.get(key, [])) for key in ['contests', 'candidacies']}
    publisher = 'New Mexico Secretary of State'
    local = [r for r in rows if r[1] in {'County Sheriff', 'County Assessor', 'Probate Judge', 'County Clerk',
        'County Treasurer', 'County Commissioner At Large'}]
    assert len(local) == 140 and len({r[3] for r in local}) == 33
    grouped = defaultdict(list)
    for r in local:
        assert r[3] and not r[2]
        grouped[(r[3], r[0])].append(r)
    assert len(grouped) == 103
    population_order = ['Bernalillo', 'Dona Ana', 'Doña Ana', 'Santa Fe', 'Sandoval', 'San Juan', 'Valencia', 'Lea', 'McKinley', 'Otero', 'Chaves']
    denominators = defaultdict(lambda: {'contests': 0, 'namedChoices': 0})
    for (county, office), candidates in sorted(grouped.items(), key=lambda kv: (
            population_order.index(kv[0][0]) if kv[0][0] in population_order else 99, kv[0][0], kv[0][1])):
        identifier = 'nm-' + county_id(county) + '-general-2026-' + COMMON['slug'](office)
        denominators[county]['contests'] += 1
        denominators[county]['namedChoices'] += len(candidates)
        prior = next((r for r in ballot['contests'] if r['id'] == identifier), None)
        if prior:
            assert {r['familyName'] for r in ballot['candidacies'] if r['contestId'] == identifier} == {r[4] for r in candidates}
            continue
        COMMON['race'](package, identifier, office, 'ocd-division/country:us/state:nm/county:' + county_id(county),
            [(r[4], r[8] or None) for r in candidates], source, publisher, quote(candidates))
        if candidates[0][1] == 'County Commissioner At Large':
            # The certified roster proves countywide scope, but does not supply the number of available seats.
            next(r for r in ballot['contests'] if r['id'] == identifier)['voteFor'] = None
    judges = [r for r in rows if r[1] == 'District Court Judge' or r[1].startswith('Judicial Retention District Court Judge')]
    assert len(judges) == 46 and len({r[0] for r in judges}) == 45
    directory, scope = COMMON['captured']('nm-courts-districts')
    directory = re.sub(r'\s+', ' ', directory)
    ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth', 'Thirteenth']
    court_groups = defaultdict(list)
    for row in judges:
        court_groups[row[0]].append(row)
    for office, candidates in court_groups.items():
        district_label = candidates[0][2].split(' JUDICIAL DISTRICT')[0]
        number = int(re.match(r'^(\d+)', district_label)[1]) if re.match(r'^(\d+)', district_label) else ordinals.index(district_label.title()) + 1
        district_name = ordinals[number - 1]
        assert all(r[2].startswith(district_label + ' JUDICIAL DISTRICT') for r in candidates)
        court = 'ocd-division/country:us/state:nm/judicial_district:' + str(number)
        if number == 2:
            identifier = 'nm-bernalillo-general-2026-' + COMMON['slug'](office)
        else:
            identifier = 'nm-general-2026-' + COMMON['slug'](office)
        prior = next((r for r in ballot['contests'] if r['id'] == identifier), None)
        if prior:
            assert {r['familyName'] for r in ballot['candidacies'] if r['contestId'] == identifier} == {r[4] for r in candidates}
            continue
        COMMON['race'](package, identifier, office, court, [(r[4], r[8] or None) for r in candidates], source, publisher,
            quote(candidates), retention=office.startswith('Judicial Retention'))
        match = re.search(re.escape(district_name) + r' Judicial District (?:For|Serving) (.*?) View More', directory)
        assert match, district_name
        counties = match[1].replace(' County', '')
        members = [county for county in re.split(r',\s*(?:and\s+)?|\s+and\s+', counties) if county]
        for county in members:
            COMMON['member'](package, 'nm', county_id(county), court, scope, 'New Mexico Courts',
                match[0].removesuffix(' View More'))
    COMMON['receipt'](package, source, publisher,
        'Qualified general roster:103countywide offices/140names acrossall33counties, including explicit AtLarge commissioner classifications; '
        '45district judicial contests/46names acrossall13judicialdistricts. ExistingBernalillo26contests/28names preserved. '
        'Excluded commissioner-by-district and all magistrate divisions until their exact election electorates are verified; no blank write-ins invented.')
    COMMON['receipt'](package, scope, 'New Mexico Courts',
        'Official CourtsByDistrict directory explicitly lists every whole county in all13 judicial districts. Residence/chambers county in candidate list is not used as an electoral boundary.', 'OFFICIAL_PUBLISHER')
    constitution, law = snapshot('nm-constitution')
    assert 'Each district judge shall be subject' in constitution and 'nonpartisan ballot' in constitution
    COMMON['receipt'](package, law, 'New Mexico Secretary of State',
        'Official2025Constitution incorporates amendments through2024; ArticleVI12 establishes district judges for each judicial district; '
        'VI33 explicitly identifies district-judge nonpartisan retention. Qualified roster independently labels each retention.', 'OFFICIAL_PUBLISHER')
    return {'added': {key: len(ballot.get(key, [])) - before[key] for key in before},
        'countyDenominators': dict(denominators), 'countyContests': 103, 'countyCandidates': 140,
        'judicialContests': 45, 'judicialCandidates': 46}


if __name__ == '__main__':
    package = json.loads((ROOT / 'data/ballot/2026-general/nm.json').read_text())
    before = copy.deepcopy(package)
    result = import_counties(package)
    prior = next(iter(before['ballots'].values()))
    ballot = next(iter(package['ballots'].values()))
    for key in ['contests', 'candidacies', 'measures', 'heldContests']:
        current = {r['id']: r for r in ballot.get(key, [])}
        assert all(current.get(r['id']) == r for r in prior.get(key, []))
    package['sourceReceipt']['reviewedAt'] = max([datetime.now(timezone.utc)] +
        [datetime.fromisoformat(r['retrievedAt'].replace('Z', '+00:00')) for r in package['sourceReceipt']['sources']]).isoformat()
    (ROOT / 'data/ballot/2026-general/nm.json').write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'data/ballot/ba01-west-evidence/nm-county-denominators.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'countyDenominators'}))
