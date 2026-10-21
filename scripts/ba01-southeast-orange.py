"""Replay Orange's countywide contests and exact Circuit 9 county membership.

The composite is not a countywide denominator. Each countywide fact below is
also checked against all 330 full precinct ballot styles before publication.
"""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def capture(folder, key):
    path = folder / key
    raw = path.read_bytes() if path.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
    return raw, meta


def normalized(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def replay(folder, write=False):
    raw, meta = capture(folder, 'fl-orange-composite')
    composite = subprocess.check_output(['pdftotext', '-raw', '-', '-'], input=raw).decode()
    precinct_meta = json.loads((folder / 'fl-orange-precincts.meta.json').read_text())
    precinct_raw = gzip.decompress((folder / 'fl-orange-precincts.raw.txt.gz').read_bytes())
    assert precinct_meta['httpStatus'] == 200
    assert hashlib.sha256(precinct_raw).hexdigest() == precinct_meta['convertedTextHash']
    styles = precinct_raw.decode().split('Official General Election Ballot')[1:]
    assert len(styles) == 330
    county = 'ocd-division/country:us/state:fl/county:orange'
    district = 'ocd-division/country:us/state:fl/circuit_court:9'
    canonical, _ = capture(folder, 'ocd-us')
    assert district + ',FL State Circuit Court - 9th District,' in canonical.decode()
    statute_raw, statute_meta = capture(folder, 'fl-circuit-statute')
    statute = ' '.join(html.unescape(re.sub('<[^>]+>', ' ', statute_raw.decode())).split())
    scope_quote = 'The ninth circuit is composed of Orange and Osceola Counties.'
    assert scope_quote in statute
    offices = [
        ('clerk-of-courts', 'Clerk of Courts', county, 'Clerk of Courts\n(Vote for One)\nRoberta Walton Johnson DEM\nTerrell Thomas NPA', [('Roberta Walton Johnson', 'DEM'), ('Terrell Thomas', 'NPA')]),
        ('county-mayor', 'County Mayor', county, 'County Mayor\n(Vote for One)\nChris Messina\nTiffany Moore Russell', [('Chris Messina', None), ('Tiffany Moore Russell', None)]),
        ('circuit-9-group-1', 'Circuit Judge, 9th Judicial Circuit — Group 1', district, 'Circuit Judge, 9th Judicial Circuit\nGroup 1\n(Vote for One)\nTemika Hampton-Johnson\nCharles Hart', [('Temika Hampton-Johnson', None), ('Charles Hart', None)]),
    ]
    for _, _, _, snippet, candidates in offices:
        assert snippet in composite
        for style in styles:
            # Precinct styles insert Spanish translations between the English
            # heading and voting instruction; candidate blocks remain intact.
            heading = snippet.split('\n(Vote for One)', 1)[0]
            candidate_block = snippet.split('(Vote for One)\n', 1)[1]
            assert normalized(heading) in normalized(style)
            assert normalized(candidate_block) in normalized(style)
            assert '(Vote for One) (Vote por Uno)' in style.split(heading, 1)[1][:220]
    question = ' '.join(composite.split('School Board Question\n', 1)[1].split('Shall the School Board of Orange County,', 1)[1].split('Yes for Approval', 1)[0].split())
    question = 'Shall the School Board of Orange County, ' + question
    assert question.endswith('citizens of Orange County?')
    for style in styles:
        assert normalized(question) in normalized(style)
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    old = {key: len(ballot[key]) for key in ['contests', 'candidacies', 'measures']}
    membership_before = len(ballot.get('districtMemberships', []))
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Orange County Supervisor of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': max(meta['retrievedAt'], precinct_meta['retrievedAt'])}
    for slug, title, division, snippet, candidates in offices:
        ident = 'fl-orange-2026-' + slug
        if any(row['id'] == ident for row in ballot['contests']):
            continue
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'CANDIDACY', 'voteFor': 1, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': ' | '.join(snippet.splitlines()) + ' | Repeated in all 330 official precinct styles; Circuit 9 includes exactly Orange and Osceola counties under Florida Statutes 26.021.'}})
        for name, party in candidates:
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': party, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': title + ' | ' + name + ((' | ' + party) if party else '')}})
    measure_id = 'fl-orange-2026-school-board-millage'
    if not any(row['id'] == measure_id for row in ballot['contests']):
        title = 'Orange County — School Board Question — Florida Ad Valorem Millage Election'
        ballot['contests'].append({'id': measure_id, 'electionId': ballot['election']['id'], 'ocdId': county, 'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'MEASURE', 'voteFor': 1, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title + ' | Full English question verified unchanged across all 330 official precinct styles.'}})
        ballot['measures'].append({'id': measure_id + '-measure', 'contestId': measure_id, 'questionText': question, 'officialStatement': None, 'provenance': {**provenance, 'quote': question}})
    held = {(row['memberOcdId'], row['districtOcdId']) for row in ballot.get('districtMemberships', [])}
    for name in ['orange', 'osceola']:
        member = 'ocd-division/country:us/state:fl/county:' + name
        if (member, district) not in held:
            ballot.setdefault('districtMemberships', []).append({'id': 'fl-circuit-9-county-2026-' + name, 'memberOcdId': member, 'districtOcdId': district, 'provenance': {'sourceUrl': statute_meta['finalUrl'], 'sourceOrg': 'Florida Legislature', 'collectedAt': statute_meta['retrievedAt'], 'verifiedAt': statute_meta['retrievedAt'], 'quote': scope_quote}})
    for source_meta, publisher, source_class, reviewed in [
        (meta, 'Orange County Supervisor of Elections', 'ELECTION_AUTHORITY', 'Exact county clerk, county mayor, Circuit 9 Group 1 candidate lists and full school-tax question from the official November 3 composite. Composite explicitly warns that individual ballots contain only applicable races.'),
        (precinct_meta, 'Orange County Supervisor of Elections', 'ELECTION_AUTHORITY', 'All 330 full official November precinct ballot styles replayed. Each imported countywide candidate and the complete English school-tax question occurs in every style. Soil, district commissioner, school-board district and CDD races are not widened to the county.'),
        (statute_meta, 'Florida Legislature', 'OFFICIAL_PUBLISHER', 'Florida Statutes 26.021(9) explicitly establishes exactly Orange and Osceola as whole-county members of Circuit 9. Canonical circuit_court:9 is independently verified in the complete current OCD registry.'),
    ]:
        receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
        if receipt not in package['sourceReceipt']['sources']:
            package['sourceReceipt']['sources'].append(receipt)
    package['sourceReceipt']['reviewedAt'] = max(package['sourceReceipt']['reviewedAt'], provenance['verifiedAt'])
    package['sourceReceipt']['reviewedBy'] = 'BA-01 Orange all-style and Circuit 9 statutory membership replay'
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'FL', 'added': {key: len(ballot[key]) - count for key, count in old.items()}, 'addedDistrictMemberships': len(ballot['districtMemberships']) - membership_before, 'officialFullStyles': len(styles), 'countywideContests': 3, 'regionalContests': 1, 'regionalCounties': ['Orange', 'Osceola'], 'deferredPartialScopes': ['County Commission 2/4/6/7/8', 'School Board 3', 'Soil and Water 1/3/5', 'Vista Lakes CDD 3']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
