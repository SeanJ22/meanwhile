"""Replay explicit countywide offices from Texas's saved final certification.

Precinct, district and city offices are excluded from this county projection.
All candidates printed for a selected office receive the same fields. Existing
Travis sample-ballot identities remain intact. Run from the repository root.
"""
import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/sources/ba-01/tx'


def slug(text):
    return re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')


def office_key(text):
    return re.sub(r'[^A-Z0-9]', '', text.upper())


def certification():
    groups = defaultdict(list)
    county, office = None, None
    for line in (EVIDENCE / '2026-ballot-cert.txt').read_text().splitlines():
        header = re.match(r'^County\s+(.+?)\s*$', line)
        candidate = re.match(r'^\s{10,}(.+?)\s{3,}(REP|DEM|LIB|GRE|IND)\s*$', line)
        if header:
            county, office = header[1], None
        elif candidate and office:
            row = candidate.groups()
            assert row not in groups[(county, office)], (county, office, row)
            groups[(county, office)].append(row)
        elif re.match(r'^\s{5}\S', line):
            office = line.strip()
    assert len({county for county, _ in groups}) == 254
    return groups


def countywide(county, office):
    title = re.sub(r' \(UNEXPIRED TERM\)$', '', office)
    return any(re.fullmatch(pattern, title) for pattern in [
        r'COUNTY (?:JUDGE|CLERK|TREASURER|SURVEYOR|ATTORNEY)',
        r'DISTRICT (?:AND COUNTY )?CLERK',
        r'JUDGE, COUNTY (?:COURT AT LAW|CRIMINAL COURT)(?: NO\. \d+)?',
        r'JUDGE, PROBATE COURT NO\. \d+',
        r'CRIMINAL DISTRICT (?:JUDGE #\d+|ATTORNEY) ' + re.escape(county) + r' COUNTY',
    ])


def write_ins(data, ballot):
    metadata = json.loads((EVIDENCE / 'write-in-source.json').read_text())
    assert hashlib.sha256((EVIDENCE / metadata['textFile']).read_bytes()).hexdigest() == metadata['textHash']
    assert hashlib.sha256(gzip.decompress((EVIDENCE / '2026-write-in-cert.pdf.gz').read_bytes())).hexdigest() == metadata['rawHash']
    pairs = re.findall(r'^(U\.S\. Senator|U\.S\. Representative, District \d+|Governor|Lieutenant Governor|'
        r'Member, State Board of Education, District \d+|State Representative, District \d+|'
        r'Criminal District Attorney Dallas County)\s{2,}(.+?)\s*$', (EVIDENCE / metadata['textFile']).read_text(), re.M)
    assert len(pairs) == 15
    core_count = 0
    for office, name in pairs:
        if office == 'Criminal District Attorney Dallas County':
            contest = next(row for row in ballot['contests'] if row['ocdId'] == 'ocd-division/country:us/state:tx/county:dallas'
                and row['title'] == 'CRIMINAL DISTRICT ATTORNEY DALLAS COUNTY')
            candidate_id = contest['id'] + ':write-in:' + slug(name)
            if not any(row['id'] == candidate_id for row in ballot['candidacies']):
                provenance = dict(sourceUrl=metadata['url'], sourceOrg='Texas Secretary of State',
                    collectedAt=metadata['retrievedAt'], verifiedAt=metadata['retrievedAt'], quote=f'{office} {name}')
                ballot['candidacies'].append(dict(id=candidate_id, contestId=contest['id'], familyName=name,
                    givenName='', partyLabel=None, slogan=None, incumbent=None, websiteUrl=None, provenance=provenance))
        else:
            matches = [row for row in ballot['contests'] if office_key(row['title']) == office_key(office)]
            assert len(matches) == 1, office
            candidates = [row for row in ballot['candidacies'] if row['contestId'] == matches[0]['id'] and
                office_key(row['givenName'] + ' ' + row['familyName']) == office_key(name)]
            assert len(candidates) == 1, (office, name)
            assert candidates[0]['partyLabel'] is None, (office, name)
            assert candidates[0]['provenance']['sourceUrl'] == metadata['url']
            core_count += 1
    assert core_count == 14
    if not any(row['finalUrl'] == metadata['url'] and row['retrievedAt'] == metadata['retrievedAt']
               for row in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append(dict(requestedUrl=metadata['url'], finalUrl=metadata['url'],
            httpStatus=200, rawHash=metadata['rawHash'], retrievedAt=metadata['retrievedAt'],
            sourceClass='ELECTION_AUTHORITY', publisher='Texas Secretary of State', reviewOutcome='SUPPORTED',
            reviewedEvidence='All14 core certified write-ins match prior held candidates; Dallas criminal district attorney Eric Reed added. The2regional judicial write-ins remain owed until their exact district scope is held.'))
    return dict(source=metadata['url'], retrievedAt=metadata['retrievedAt'], coreCandidacies=core_count,
                countyCandidacies=1, unmappedRegionalJudicialCandidacies=2)


def main():
    metadata = json.loads((EVIDENCE / 'core-source.json').read_text())
    assert hashlib.sha256((EVIDENCE / metadata['textFile']).read_bytes()).hexdigest() == metadata['textHash']
    raw_file = EVIDENCE / '2026-ballot-cert.pdf.gz'
    assert hashlib.sha256(gzip.decompress(raw_file.read_bytes())).hexdigest() == metadata['rawHash']
    path = ROOT / 'data/ballot/2026-general/tx.json'
    data = json.loads(path.read_text())
    ballot = next(iter(data['ballots'].values()))
    # Reuse held official county names/FIPS, then the reader's county slug rule.
    reference = json.loads((ROOT / 'data/reference/national_county_time_zones.json').read_text())
    counties = {office_key(name.removesuffix(' County')): (fips, name.removesuffix(' County'))
                for fips, state, name, _ in reference['counties'] if state == 'TX'}
    source = certification()
    selected = {key: value for key, value in source.items() if countywide(*key)}
    priority = ['HARRIS', 'DALLAS', 'TARRANT', 'BEXAR', 'TRAVIS']
    ordered = sorted(selected, key=lambda key: (priority.index(key[0]) if key[0] in priority else len(priority), key))
    added_contests, added_candidates, retained = 0, 0, 0
    report = defaultdict(lambda: {'candidateContests': 0, 'candidacies': 0})
    for county, office in ordered:
        assert office_key(county) in counties, county
        fips, name = counties[office_key(county)]
        division = f'ocd-division/country:us/state:tx/county:{slug(name)}'
        candidates = selected[(county, office)]
        existing = [row for row in ballot['contests'] if row['ocdId'] == division and office_key(row['title']) == office_key(office)]
        assert len(existing) <= 1, (county, office)
        provenance = dict(sourceUrl=metadata['url'], sourceOrg='Texas Secretary of State',
                          collectedAt=metadata['retrievedAt'], verifiedAt=metadata['retrievedAt'],
                          quote=f'County {county}\n{office}\n' + '\n'.join(f'{candidate} {party}' for candidate, party in candidates))
        if existing:
            contest = existing[0]
            held = [row for row in ballot['candidacies'] if row['contestId'] == contest['id']]
            printed = [row for row in held if row['provenance']['sourceUrl'] != 'https://www.sos.state.tx.us/elections/forms/2026-write-In-ballot-cert.pdf']
            assert {office_key(row['givenName'] + ' ' + row['familyName']) for row in printed} == {office_key(row[0]) for row in candidates}, (county, office)
            retained += 1
        else:
            contest = dict(id=f'tx-ba01-2026-county-{fips}-{slug(office)}', electionId=ballot['election']['id'],
                           ocdId=division, divisionVintage='2026', title=office, type='CANDIDACY',
                           candidateListComplete=True, voteFor=1, termYears=None,
                           scopeNote='Every printed candidate on the saved final certification is included. Later certified write-in lists remain separate acquisition work.',
                           provenance=provenance)
            ballot['contests'].append(contest)
            added_contests += 1
            for candidate, party in candidates:
                ballot['candidacies'].append(dict(id=contest['id'] + ':' + slug(candidate), contestId=contest['id'],
                    familyName=candidate, givenName='', partyLabel=party, slogan=None, incumbent=None,
                    websiteUrl=None, provenance=provenance))
                added_candidates += 1
        report[county]['candidateContests'] += 1
        report[county]['candidacies'] += len(candidates)
    if not any(row['finalUrl'] == metadata['url'] and row['retrievedAt'] == metadata['retrievedAt']
               for row in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append(dict(requestedUrl=metadata['url'], finalUrl=metadata['url'],
            httpStatus=200, rawHash=metadata['rawHash'], retrievedAt=metadata['retrievedAt'],
            sourceClass='ELECTION_AUTHORITY', publisher='Texas Secretary of State', reviewOutcome='SUPPORTED',
            reviewedEvidence='All 254 county sections replayed from the final certification; only explicitly countywide offices imported by scripts/ba01-tx-counties.py.'))
    write_in_report = write_ins(data, ballot)
    data['sourceReceipt']['reviewedAt'] = max(data['sourceReceipt']['reviewedAt'], metadata['retrievedAt'], write_in_report['retrievedAt'])
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    result = dict(source=metadata['url'], retrievedAt=metadata['retrievedAt'], rawHash=metadata['rawHash'],
        scope='Printed final-certification candidates for explicitly countywide offices; not complete county sample ballots or a later write-in census.',
        countyCount=len(report), candidateContests=len(selected), candidacies=sum(map(len, selected.values())), writeIns=write_in_report,
        remaining='Precinct offices, judicial districts, municipal offices, local questions and later write-in certifications remain open.', counties=report)
    (ROOT / 'data/ballot/reports/ba01-tx-counties.json').write_text(json.dumps(result, indent=2) + '\n')
    print(f'TX countywide certification: {len(report)} counties; {len(selected)} contests; {sum(map(len, selected.values()))} candidates; added {added_contests}/{added_candidates}, retained {retained}.')


if __name__ == '__main__':
    main()
