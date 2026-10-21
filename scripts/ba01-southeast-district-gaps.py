"""Replay two exact local districts supported by official maps and OCD IDs.

No county-wide fallback is used for a council district. Source documents and
metadata are captured by name; --write updates only MD/NC ballot data.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def capture(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    return raw, meta


def replay(folder, state, write=False):
    path = ROOT / f'data/ballot/2026-general/{state}.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    raw, meta = capture(folder, 'md-local-browser-ua' if state == 'md' else 'nc-1')
    registry, registry_meta = capture(folder, f'ocd-{state}-county')
    records = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    if state == 'md':
        division = 'ocd-division/country:us/state:md/county:montgomery/council_district:7'
        assert division + ',Montgomery County MD County Council District 7' in registry.decode()
        scope, scope_meta = capture(folder, 'md-montgomery-council7')
        features = json.loads(scope)['features']
        assert len(features) == 1 and features[0]['properties']['COUNCIL'] == '7'
        assert features[0]['geometry']['type'] in ['Polygon', 'MultiPolygon']
        rows = [r for r in records if r['Office Name'] == 'County Council' and r['Contest Run By District Name and Number'] == 'Councilmanic District 7' and r['Candidate Residential Jurisdiction'] == 'Montgomery County' and r['Candidate Status'] == 'Active']
        assert len(rows) == 2
        title, seats, years = 'County Council — Montgomery County, Councilmanic District 7', 1, None
        candidates = [(r['Candidate First Name and Middle Name'], r['Candidate Ballot Last Name and Suffix'], r['Office Political Party'] or None, r['Website'] or None, 'Declared write-in' if r['Filing Type and Date'].startswith('Write-In') else None) for r in rows]
        publisher, map_publisher = 'Maryland State Board of Elections', 'Montgomery County Government'
    else:
        division = 'ocd-division/country:us/state:nc/county:mecklenburg/council_district:4'
        assert division + ',Mecklenburg County NC Board of County Commissioners District 4' in registry.decode()
        scope, scope_meta = capture(folder, 'nc-meck-maps')
        assert b'https://mecknc.widen.net/s/nk2nkvqqxd/county-commission-districts-filing-2023' in scope
        rows = [r for r in records if r['election_dt'] == '11/03/2026' and r['county_name'] == 'MECKLENBURG' and r['contest_name'] == 'MECKLENBURG COUNTY BOARD OF COMMISSIONERS DISTRICT 04']
        assert len(rows) == 1
        title, seats, years = rows[0]['contest_name'], int(rows[0]['vote_for']), int(rows[0]['term'])
        candidates = [('', r['name_on_ballot'], r['party_candidate'] or None, None, None) for r in rows]
        publisher = map_publisher = 'Mecklenburg County Board of Elections'
        publisher = 'North Carolina State Board of Elections'
    existing = next((c for c in ballot['contests'] if c['ocdId'] == division and c['title'] == title), None)
    if existing:
        return {'state': state.upper(), 'addedContests': 0, 'addedCandidacies': 0, 'ocdId': division}
    ident = state + '-local-2026-' + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': publisher, 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'CANDIDACY', 'voteFor': seats, 'termYears': years, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title}})
    for given, family, party, website, slogan in candidates:
        ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(json.dumps([given, family, party]).encode()).hexdigest()[:16], 'contestId': ident, 'givenName': given, 'familyName': family, 'partyLabel': party, 'slogan': slogan, 'incumbent': None, 'websiteUrl': website, 'provenance': {**provenance, 'quote': ' | '.join([title, given, family, party or ''])}})
    for source_meta, source_publisher, source_class, reviewed in [
        (meta, publisher, 'ELECTION_AUTHORITY', 'Exact current general-election candidate row or rows, parties, websites when provided, and seat counts, scoped only to the specific council district.'),
        (scope_meta, map_publisher, 'OFFICIAL_PUBLISHER', 'Official council district geography verified without widening a district election to county scope. Canonical division name separately checked against the saved Open Civic Data registry.')]:
        receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': source_publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
        if receipt not in package['sourceReceipt']['sources']:
            package['sourceReceipt']['sources'].append(receipt)
    package['sourceReceipt']['reviewedAt'] = max(meta['retrievedAt'], scope_meta['retrievedAt'])
    package['sourceReceipt']['reviewedBy'] = 'BA-01 official local district replay'
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': state.upper(), 'addedContests': 1, 'addedCandidacies': len(candidates), 'ocdId': division, 'officialMap': scope_meta['finalUrl'], 'canonicalRegistry': registry_meta['finalUrl']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--state', choices=['md', 'nc'], required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.state, args.write), indent=2))
