"""Replay all Kansas 2026 district/magistrate judge nominees and exact electorates."""
from pathlib import Path
import argparse
import csv
import hashlib
import html
import io
import json
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument('--evidence', type=Path)
parser.add_argument('--output', type=Path)
parser.add_argument('--registry', type=Path)
args = parser.parse_args()
ROOT = args.root
EVIDENCE = args.evidence or ROOT / 'data/ballot/evidence/ba01-south/ks-judicial'
STATE = ROOT / 'data/ballot/2026-general/ks.json'
OUTPUT = args.output or STATE


def document(stem):
    raw = (EVIDENCE / (stem + '.html')).read_bytes()
    meta = json.loads((EVIDENCE / (stem + '.source.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['sha256'], stem
    return raw.decode(), meta


def clean(s):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', s)).split())


def prov(meta, org, quote):
    return {'sourceUrl': meta['finalUrl'], 'sourceOrg': org, 'collectedAt': meta['retrievedAt'],
            'verifiedAt': meta['retrievedAt'], 'quote': quote}


source_path = ROOT / 'data/ballot/evidence/ba01-south/ks-all-2026.html'
source_meta = json.loads(source_path.with_suffix('.source.json').read_text())
raw = source_path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == source_meta['sha256']
assert '2026 General' in raw.decode()
rows = []
for block in re.findall(r'<tr[^>]*>(.*?)</tr>', raw.decode(), re.S | re.I):
    cells = [clean(cell) for cell in re.findall(r'<td[^>]*>(.*?)</td>', block, re.S | re.I)]
    if len(cells) == 25 and cells[1] in {'District Court Judge', 'District Magistrate Judge'}:
        rows.append(cells)
assert len(rows) == 99
assert len([row for row in rows if row[1] == 'District Court Judge']) == 72
assert len({tuple(row[1:5]) for row in rows}) == 98
assert all(row[2].isdigit() and row[3].isdigit() and row[4].isdigit() for row in rows)
assert all(row[5] in {'', 'Democratic', 'Republican'} for row in rows)

# The current Judicial Branch names the exact districts using retention. Party
# blanks alone never decide the race type.
selection, selection_meta = document('merit-selection')
section = re.search(r'<h2>Merit-selection districts</h2>(.*?)(?=<h2>Retention)', selection, re.S)
assert section
merit_districts = set(re.findall(r'>(\d+)(?:st|nd|rd|th) Jud(?:icial|cial) District<', section[1]))
assert merit_districts == {'1','2','3','4','5','6','7','8','9','10','11','12','21','25','28','30','31'}
assert all((not row[5]) == (row[2] in merit_districts) for row in rows)

# Constitution and statutes explicitly distinguish district and county electorates.
constitution, constitution_meta = document('constitution-article3-section6')
constitution_quote = 'The district judges shall be elected by the electors of the respective judicial districts unless the electors of a judicial district have adopted and not subsequently rejected a method of nonpartisan selection.'
assert constitution_quote in clean(constitution)
retention, retention_meta = document('retention-statute')
retention_quote = "If a declaration is filed, the judge's name shall be submitted at the next general election to the electors of the judicial district, if the judge is a district judge, or to the electors of the county, if the judge is a district magistrate judge."
assert retention_quote in clean(retention)
magistrate, magistrate_meta = document('magistrate-election-statute')
magistrate_quote = "Each district magistrate judge shall be elected by the electors of the county where the judge's position is located."
assert magistrate_quote in clean(magistrate)

# The official statewide map names each entire county in exactly one district.
index, index_meta = document('district-courts')
county_labels = {(number, county): label for label, number, county in re.findall(r'aria-label="(Kansas (\d+)(?:st|nd|rd|th) Judicial District: ([^"]+) County)"', index)}
county_pairs = set(county_labels)
assert len(county_pairs) == 105
county_to_district = {county: number for number, county in county_pairs}
assert len(county_to_district) == 105
by_district = {number: sorted(county for d, county in county_pairs if d == number) for number in map(str, range(1, 32))}
assert all(by_district.values())

# Canonical OCD identifiers, checked against an archived exact registry extract.
registry_path = args.registry or EVIDENCE / 'ocd-ks-judicial.csv'
registry = registry_path.read_text()
registry_ids = {row['id'] for row in csv.DictReader(io.StringIO(registry))}
if not args.registry:
    registry_meta = json.loads(registry_path.with_suffix('.source.json').read_text())
    assert hashlib.sha256(registry_path.read_bytes()).hexdigest() == registry_meta['sourceTextSha256']

# For multi-county districts a judge's official directory entry names the exact
# magistrate county. Matching uses published first and family names in both
# independent official sources; all middle-name variations remain in quotes.
# Districts 10, 18 and 19 each contain exactly one whole county, so no person join
# or judge-residence inference is needed there.
magistrate_counties = {}
magistrate_evidence = {}
for number in sorted({row[2] for row in rows if row[1] == 'District Magistrate Judge'}, key=int):
    page, meta = document('district-' + number)
    if len(by_district[number]) == 1:
        for row in rows:
            if row[1] == 'District Magistrate Judge' and row[2] == number:
                key = tuple(row[1:5])
                magistrate_counties[key] = by_district[number][0]
                magistrate_evidence[key] = (index_meta, 'Kansas Judicial Branch', county_labels[(number, by_district[number][0])])
        continue
    section = re.search(r'<h2>District Magistrate Judges?</h2>(.*?)(?=<h2|<div class="col)', page, re.S | re.I)
    assert section, number
    entries = [clean(part).strip('\u200b ') for part in re.split(r'<br\s*/?>|</p>', section[1], flags=re.I)]
    entries = [entry for entry in entries if 'County' in entry]
    for row in rows:
        if row[1] != 'District Magistrate Judge' or row[2] != number:
            continue
        first, family = row[7], row[9]
        matches = [entry for entry in entries if re.search(r'\b' + re.escape(first) + r'\b', entry) and re.search(r'\b' + re.escape(family) + r'\b', entry)]
        # A challenger shares exactly the same Secretary of State office tuple as
        # the incumbent. Never use a candidate's home address as electorate proof.
        if not matches:
            assert row[0] == 'Travis Phillips' and tuple(row[1:5]) == ('District Magistrate Judge', '23', '3', '0')
            continue
        assert len(matches) == 1, (row[0], matches)
        county_match = re.search(r'(?:,| -)\s*([^,]+) County$', matches[0])
        assert county_match, matches
        county = county_match[1]
        assert county in by_district[number]
        key = tuple(row[1:5])
        assert key not in magistrate_counties or magistrate_counties[key] == county
        magistrate_counties[key] = county
        magistrate_evidence[key] = (meta, 'Kansas Judicial Branch', matches[0])
assert len(magistrate_counties) == 26
assert magistrate_counties[('District Magistrate Judge', '23', '3', '0')] == 'Trego'

# Source fields and office tuples are used uniformly for every candidate.
data = json.loads(STATE.read_text())
ballot = data['ballots']['KS:ks-2026-11-03']
memberships = ballot.setdefault('districtMemberships', [])
added_contests = added_candidates = added_memberships = 0
groups = {}
for row in rows:
    groups.setdefault(tuple(row[1:5]), []).append(row)
for key, candidates in groups.items():
    office, number, position, division = key
    if office == 'District Court Judge':
        ident = f'ks-ba01-2026-district-court-{number}-division-{division}'
        ocd = f'ocd-division/country:us/state:ks/district_court:{number}'
        title = f'District Court Judge, District {number}'
        if division != '0':
            title += f', Division {division}'
    else:
        county = magistrate_counties[key]
        ocd = 'ocd-division/country:us/state:ks/county:' + county.lower().replace(' ', '_')
        ident = f'ks-ba01-2026-magistrate-{number}-position-{position}'
        title = f'District Magistrate Judge, District {number}'
        if position != '0':
            title += f', Position {position}'
    assert ocd in registry_ids, ocd
    assert all(bool(row[5]) == bool(candidates[0][5]) for row in candidates)
    retention_type = not candidates[0][5]
    assert not retention_type or len(candidates) == 1
    quote = '\n'.join(' | '.join(row[:6]) for row in candidates)
    provenance = prov(source_meta, 'Kansas Secretary of State', quote)
    if not any(row['id'] == ident for row in ballot['contests']):
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': ocd,
            'divisionVintage': 'OCD_CURRENT', 'title': title, 'type': 'RETENTION' if retention_type else 'CANDIDACY',
            'voteFor': None if retention_type else 1, 'termYears': None, 'scopeNote': None,
            'candidateListComplete': True, 'provenance': provenance})
        added_contests += 1
        for row in candidates:
            assert ' '.join(part for part in row[7:11] if part) == row[0], row[0]
            slug = re.sub(r'[^a-z0-9]+', '-', row[0].lower()).strip('-')
            candidate_provenance = prov(source_meta, 'Kansas Secretary of State', ' | '.join(row[:6]) + (' | WebAddress: ' + row[21] if row[21] else ''))
            site = row[21] or None
            if site and not re.match(r'https?://', site, re.I):
                site = 'https://' + site
            ballot['candidacies'].append({'id': ident + '-' + slug, 'contestId': ident,
                'familyName': ' '.join(part for part in row[8:11] if part), 'givenName': row[7],
                'partyLabel': row[5] or None, 'slogan': None, 'incumbent': None,
                'websiteUrl': site, 'provenance': candidate_provenance})
            added_candidates += 1
    published = [row for row in ballot['contests'] if row['id'] == ident]
    assert len(published) == 1 and published[0]['ocdId'] == ocd
    assert published[0]['type'] == ('RETENTION' if retention_type else 'CANDIDACY')
    actual = [row for row in ballot['candidacies'] if row['contestId'] == ident]
    expected = {(row[7], ' '.join(part for part in row[8:11] if part), row[5] or None) for row in candidates}
    assert len(actual) == len(candidates)
    assert {(row['givenName'], row['familyName'], row['partyLabel']) for row in actual} == expected

# County membership propagates only into the whole judicial district. Magistrate
# races remain county-scoped and cannot leak into other district counties.
selected_districts = {row[2] for row in rows if row[1] == 'District Court Judge'}
for number in sorted(selected_districts, key=int):
    district = 'ocd-division/country:us/state:ks/district_court:' + number
    for county in by_district[number]:
        member = 'ocd-division/country:us/state:ks/county:' + county.lower().replace(' ', '_')
        assert member in registry_ids and district in registry_ids
        ident = 'ks-ba01-county-' + county.lower().replace(' ', '_') + '-district-court-' + number
        if not any(row['id'] == ident for row in memberships):
            memberships.append({'id': ident, 'memberOcdId': member, 'districtOcdId': district,
                'provenance': prov(index_meta, 'Kansas Judicial Branch', county_labels[(number, county)])})
            added_memberships += 1

# Save every court/statute source used by the replay, including county scope
# sources for magistrates, in the publication receipt.
used = [(index_meta, 'Kansas Judicial Branch'), (selection_meta, 'Kansas Judicial Branch'), (constitution_meta, 'Kansas Legislature'),
        (retention_meta, 'Kansas Legislature'), (magistrate_meta, 'Kansas Legislature')]
used += [(meta, org) for meta, org, _quote in magistrate_evidence.values()]
for meta, org in used:
    receipt = {'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'], 'retrievedAt': meta['retrievedAt'],
        'httpStatus': meta['httpStatus'], 'rawHash': meta['sha256'], 'publisher': org,
        'sourceClass': 'OFFICIAL_PUBLISHER', 'reviewOutcome': 'SUPPORTED',
        'reviewedEvidence': 'scripts/ba01-south-ks-judicial.py replays the exact 2026 Secretary of State office tuples and names, judicial district whole-county map, current constitutional/statutory electorate rules, and magistrate county assignments. No candidate residential contact fields are published.'}
    if not any(row.get('finalUrl') == receipt['finalUrl'] and row.get('rawHash') == receipt['rawHash'] for row in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append(receipt)
    data['sourceReceipt']['reviewedAt'] = max(data['sourceReceipt']['reviewedAt'], meta['retrievedAt'])
note = 'The official 2026 General candidate table now matches all 247 candidate/retention contests and 362 candidate rows. All district-judge electorates are verified whole-county judicial districts; all magistrate electorates are verified individual counties. County/city/school/special-district contests and local measures still need comparison.'
if note not in ballot['coverageNotes']:
    ballot['coverageNotes'].append(note)
OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
report = {'added_contests': added_contests, 'added_candidacies': added_candidates, 'added_memberships': added_memberships,
    'contests': len(ballot['contests']), 'candidacies': len(ballot['candidacies']),
    'district_judge_races': len([key for key in groups if key[0] == 'District Court Judge']),
    'magistrate_races': len(magistrate_counties), 'magistrate_counties': [dict(office=key[0], district=key[1], position=key[2], county=county, proof=magistrate_evidence[key][2], sourceUrl=magistrate_evidence[key][0]['finalUrl']) for key, county in magistrate_counties.items()]}
print(json.dumps(report, ensure_ascii=False, indent=2))
