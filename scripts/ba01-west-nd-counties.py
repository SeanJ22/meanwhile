#!/usr/bin/env python3
"""Replay: countywide offices and district judges from ND's official general list."""
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone
import copy, gzip, hashlib, json, os, re, runpy

ROOT = Path(os.environ.get('BA01_WEST_ROOT', Path(__file__).resolve().parents[1]))
COMMON = runpy.run_path(str(ROOT / 'scripts/ba01-west-court-county.py'))
CAPTURES = Path(os.environ.get('BA01_WEST_ND_LOCAL_CAPTURES', ROOT / 'data/ballot/ba01-west-evidence/nd-local-captures'))


def snapshot(name):
    source = next(r for r in json.loads((CAPTURES / 'manifest.json').read_text()) if r['name'] == name)
    raw = gzip.decompress((CAPTURES / source['file']).read_bytes())
    text = (CAPTURES / source['textSnapshot']).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == source['rawHash']
    assert hashlib.sha256(text).hexdigest() == source['textHash']
    return re.sub(r'\s+', ' ', text.decode()), source


def source_quote(rows):
    # Candidate mailing addresses and contacts are not ballot fields.
    keys = {0: 'contest', 2: 'classification', 3: 'district', 4: 'county', 5: 'name', 9: 'party'}
    return '2026 General Election\n' + '\n'.join(json.dumps({label: row[index] for index, label in keys.items()},
        ensure_ascii=False, separators=(',', ':')) for row in rows)


def import_counties(package):
    raw, _ = COMMON['state_capture']('nd-all-rows.json')
    official, source = COMMON['state_capture']('nd-all')
    assert b'2026 General Election' in official
    rows = [r for r in json.loads(raw) if len(r) == 19 and r[2] != 'Contest']
    runpy.run_path(str(ROOT / 'scripts/ba01-west-html-proof.py'))['prove_rows'](official, rows, [0, 2, 3, 4, 5, 9])
    publisher = 'North Dakota Secretary of State'
    ballot = next(iter(package['ballots'].values()))
    before = {key: len(ballot.get(key, [])) for key in ['contests', 'candidacies', 'heldContests']}
    county = [r for r in rows if r[2].startswith('County') and r[2] != 'County Commissioner By District']
    garrison = [r for r in rows if r[2] == 'Director, Garrison Diversion Conservancy']
    assert len(county) == 437 and sum(bool(r[5]) for r in county) == 432
    assert len({r[4] for r in county}) == 53
    assert len(garrison) == 12 and sum(bool(r[5]) for r in garrison) == 11
    grouped = defaultdict(list)
    for row in county + garrison:
        assert row[4] and row[4] != 'STATE'
        if row[2] == 'County Commissioner':
            assert row[3] == '', 'Unspecified commissioner district cannot be widened'
        if row[2] != 'County Commissioner At Large By District':
            assert row[3] == '', 'Unverified district cannot be widened'
        grouped[(row[4], row[0])].append(row)
    assert len(grouped) == 331
    population_order = ['Cass', 'Burleigh', 'Grand Forks', 'Ward', 'Williams', 'Stark', 'Morton', 'Stutsman']
    ordered = sorted(grouped.items(), key=lambda kv: (
        population_order.index(kv[0][0]) if kv[0][0] in population_order else 99, kv[0][0], kv[0][1]))
    existing_cass = {
        "County State's Attorney": 'nd-cass-general-2026-county-state-s-attorney',
        'County Sheriff': 'nd-cass-general-2026-county-sheriff',
        'Director, Garrison Diversion Conservancy': 'nd-cass-general-2026-director-garrison-diversion-conservancy',
        'County Official Newspaper': 'nd-cass-general-2026-county-official-newspaper',
        'County Commissioner Cass District 2': 'nd-cass-general-2026-commissioner-2',
        'County Commissioner Cass District 4': 'nd-cass-general-2026-commissioner-4',
    }
    denominators = defaultdict(lambda: {'contests': 0, 'namedChoices': 0, 'emptyContests': 0})
    for (county_name, office), candidates in ordered:
        county_id = county_name.lower().replace(' ', '_')
        identifier = existing_cass.get(office) if county_name == 'Cass' else None
        identifier = identifier or f'nd-{county_id}-general-2026-' + COMMON['slug'](office)
        ocd_id = 'ocd-division/country:us/state:nd/county:' + county_id
        names = [(row[5], row[9] or None) for row in candidates if row[5]]
        assert len(names) == len(set(name for name, _ in names))
        denominators[county_name]['contests'] += 1
        denominators[county_name]['namedChoices'] += len(names)
        if not names:
            denominators[county_name]['emptyContests'] += 1
            proof = COMMON['provenance'](source, publisher, source_quote(candidates))
            COMMON['add'](package, 'heldContests', {'id': identifier, 'electionId': ballot['election']['id'],
                'ocdId': ocd_id, 'title': office, 'provenance': proof,
                'reason': 'No candidate appears on the official general election candidate list'})
            continue
        prior_contest = next((r for r in ballot['contests'] if r['id'] == identifier), None)
        if prior_contest:
            held_names = {r['familyName'] for r in ballot['candidacies'] if r['contestId'] == identifier}
            assert held_names == {name for name, _ in names}, (identifier, held_names, names)
            continue
        COMMON['race'](package, identifier, office, ocd_id, names, source, publisher, source_quote(candidates))
        contest = next(r for r in ballot['contests'] if r['id'] == identifier)
        if candidates[0][2] in {'County Commissioner', 'County Commissioner At Large By District'}:
            # Seat count is not supplied by the candidate table. Sample-specific vote instructions remain separate.
            contest['voteFor'] = None
    county_text, law = snapshot('nd-county-election-law')
    assert 'The required officers must be chosen by the qualified electors of the respective counties' in county_text
    COMMON['receipt'](package, law, 'North Dakota Legislative Assembly',
        'NDCC11-10-02 assigns required county offices to qualified electors of their respective counties. '
        'Official general-list classifications explicitly separate by-district commissioners from countywide and at-large-by-district commissioners.', 'OFFICIAL_PUBLISHER')
    garrison_text, garrison_source = COMMON['captured']('nd-garrison-code')
    assert 'A director of the Garrison Diversion Conservancy District must be nominated and elected in each county in the district.' in re.sub(r'\s+', ' ', garrison_text)
    COMMON['receipt'](package, garrison_source, 'North Dakota Legislative Assembly',
        'NDCC61-24-03 explicitly elects one Garrison director in each county of the district.', 'OFFICIAL_PUBLISHER')
    judges = [r for r in rows if r[2].startswith('Judge of the District Court')]
    assert len(judges) == 20 and len({r[0] for r in judges}) == 19
    scope_text, scope = COMMON['captured']('nd-east-central-rule')
    scope_text = re.sub(r'\s+', ' ', scope_text)
    judiciary = defaultdict(list)
    for row in judges:
        assert row[4] == 'STATE' and row[3]
        judiciary[row[0]].append(row)
    for office, candidates in judiciary.items():
        district_name = candidates[0][3]
        assert all(r[3] == district_name for r in candidates)
        number = int(re.search(r'No\. (\d+)', office)[1])
        district_id = district_name.lower().replace(' ', '_')
        court = 'ocd-division/country:us/state:nd/judicial_district:' + district_id
        identifier = f'nd-{COMMON["slug"](district_name)}-general-2026-judge-{number}'
        prior = next((r for r in ballot['contests'] if r['id'] == identifier), None)
        if prior:
            assert {r['familyName'] for r in ballot['candidacies'] if r['contestId'] == identifier} == {r[5] for r in candidates}
            continue
        COMMON['race'](package, identifier, office, court, [(r[5], r[9] or None) for r in candidates], source, publisher, source_quote(candidates))
        quote = re.search(re.escape(district_name) + r' Judicial District consists of the counties of .*?\.', scope_text)[0]
        counties = quote.split('counties of ')[1].rstrip('.')
        for county_name in re.split(r',\s*(?:and\s+)?|\s+and\s+', counties):
            if county_name:
                COMMON['member'](package, 'nd', county_name.lower().replace(' ', '_'), court, scope, 'North Dakota Supreme Court', quote)
    court_text, court_law = snapshot('nd-district-court-law')
    assert 'There must be elected in each judicial district of this state the number of judges for such district provided for by law.' in court_text
    COMMON['receipt'](package, court_law, 'North Dakota Legislative Assembly',
        'NDCC27-05-02 elects judges in each judicial district; official general list supplies every filed general candidate and named judicial district.', 'OFFICIAL_PUBLISHER')
    COMMON['receipt'](package, scope, 'North Dakota Supreme Court',
        'AdministrativeRule6 names the whole counties comprising every judicial district, including all six districts with general judicial races.', 'OFFICIAL_PUBLISHER')
    COMMON['receipt'](package, source, publisher,
        'Official2026General list:331countywide county/Garrison contests,443named choices,6empty candidate rows across53counties; '
        '19district judge contests/20names including6already sample-verified EastCentral races. '
        'Excluded all40district-only commissioner races/56names and55remaining soil-district rows pending exact scope. '
        'CountyCommissioner voteFor remains unknown without sample instructions. Existing Cass sample facts preserved.')
    return {'added': {key: len(ballot.get(key, [])) - before[key] for key in before},
        'countyDenominators': dict(denominators), 'judicialContests': 19, 'judicialCandidates': 20,
        'excludedDistrictOnlyCommissionerContests': 40, 'excludedDistrictOnlyCommissionerNames': 56}


if __name__ == '__main__':
    file = ROOT / 'data/ballot/2026-general/nd.json'
    package = json.loads(file.read_text())
    before = copy.deepcopy(package)
    result = import_counties(package)
    prior = next(iter(before['ballots'].values()))
    ballot = next(iter(package['ballots'].values()))
    for key in ['contests', 'candidacies', 'measures', 'heldContests']:
        current = {r['id']: r for r in ballot.get(key, [])}
        assert all(current.get(r['id']) == r for r in prior.get(key, []))
    package['sourceReceipt']['reviewedAt'] = max([datetime.now(timezone.utc)] +
        [datetime.fromisoformat(r['retrievedAt'].replace('Z', '+00:00')) for r in package['sourceReceipt']['sources']]).isoformat()
    file.write_text(json.dumps(package, indent=2, ensure_ascii=False) + '\n')
    (ROOT / 'data/ballot/ba01-west-evidence/nd-county-denominators.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'countyDenominators'}))
