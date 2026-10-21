"""Replay official CA appellate electorates and Los Angeles final local lists.

Candidate fields are checked uniformly against each entire contest in the final
qualified list. City/district council and school/special-district races stay open
until their exact electorates are established. No production connection is used.
"""
import gzip
import hashlib
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/sources/ba-01/ca-local'
STATE = 'ocd-division/country:us/state:ca'
PUBLISHER = 'Los Angeles County Registrar-Recorder/County Clerk'


def slug(value):
    return re.sub(r'[^a-z0-9]+', '_', value.lower()).strip('_')


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []

    def handle_data(self, value):
        if value.strip():
            self.rows.append(value.strip())


def source(name):
    meta = json.loads((EVIDENCE / (name + '.meta.json')).read_text())
    raw = gzip.decompress((EVIDENCE / meta['file']).read_bytes())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
    if name.endswith('.pdf'):
        assert raw.startswith(b'%PDF')
    return meta, raw


def provenance(meta, publisher, quote):
    return dict(sourceUrl=meta['finalUrl'], sourceOrg=publisher,
                collectedAt=meta['retrievedAt'], verifiedAt=meta['retrievedAt'], quote=quote)


def receipt(data, meta, publisher, source_class='ELECTION_AUTHORITY'):
    row = dict(requestedUrl=meta['url'], finalUrl=meta['finalUrl'], publisher=publisher,
               sourceClass=source_class, httpStatus=meta['httpStatus'], retrievedAt=meta['retrievedAt'],
               rawHash=meta['rawHash'], reviewOutcome='SUPPORTED',
               reviewedEvidence='Saved exact official response; BA-01 replay checks the complete cited office or published jurisdiction list.')
    identity = lambda item: tuple(item.get(key) for key in ('requestedUrl', 'finalUrl', 'rawHash', 'retrievedAt'))
    if not any(identity(old) == identity(row) for old in data['sourceReceipt']['sources']):
        data['sourceReceipt']['sources'].append(row)


def court_memberships(data, ballot):
    meta, raw = source('appeal-home.html')
    election, election_raw = source('appeal-retention.html')
    parser = Text()
    parser.feed(raw.decode())
    election_parser = Text()
    election_parser.feed(election_raw.decode())
    election_quote = next(row for row in election_parser.rows if 'voters in each district alone decide whether to retain them' in row)
    membership = ballot.setdefault('districtMemberships', [])
    existing = {row['id'] for row in membership}
    county_sets = {}
    for number, ordinal in enumerate(['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'], 1):
        index = parser.rows.index(ordinal + ' Appellate District', parser.rows.index('Your Court of Appeal Districts'))
        quote = parser.rows[index + 1]
        assert quote.startswith('We serve ') and quote.endswith(' counties.')
        names = quote[len('We serve '):-len(' counties.')].replace(', and ', ', ').split(', ')
        county_sets[number] = names
        for name in names:
            key = f'ca-ba01-county-appeal-{number}-' + slug(name)
            if key not in existing:
                membership.append(dict(id=key, memberOcdId=STATE + '/county:' + slug(name),
                    districtOcdId=STATE + '/court_of_appeals:' + str(number),
                    provenance=provenance(meta, 'Judicial Council of California', quote),
                    electorateProvenance=provenance(election, 'Judicial Council of California', election_quote)))
                existing.add(key)
    all_counties = [name for names in county_sets.values() for name in names]
    assert len(all_counties) == len(set(all_counties)) == 58
    receipt(data, meta, 'Judicial Council of California', 'OFFICIAL_PUBLISHER')
    receipt(data, election, 'Judicial Council of California', 'OFFICIAL_PUBLISHER')
    return county_sets


def candidate_sections():
    source('la-candidates.pdf')
    text = (EVIDENCE / 'la-candidates.txt').read_text()
    assert 'Election Date: 11/03/26' in text and 'FINAL LIST OF QUALIFIED CANDIDATES TO APPEAR ON THE BALLOT' in text
    starts = list(re.finditer(r'^(\d{4,6})-(.+)$', text, re.M))
    result = []
    for index, start in enumerate(starts):
        header = start[2]
        title = re.split(r'\s{2,}Vote for ', header)[0].strip()
        chunk = text[start.end():starts[index + 1].start() if index + 1 < len(starts) else len(text)]
        if not re.search(r'(?:ELECTION (?:Mayor|City Clerk|City Treasurer|City Attorney)$|^SHERIFF$|^JUDGE OF THE SUPERIOR COURT)', title):
            continue
        assert re.search(r'Vote for 1\s*$', header) and 'NON PARTISAN' in chunk
        count = re.search(r'Total Number of Candidates for this Contest: (\d+)', chunk)
        lines = chunk.splitlines()
        names = []
        for line_number, line in enumerate(lines):
            if not re.match(r'^ {20}\S', line):
                continue
            value = re.split(r'\s{2,}', line.strip())[0]
            if value.upper() == value and re.search('[A-Z]', value):
                names.append((line_number, value))
        assert count and len(names) == int(count[1]), (title, names)
        candidates = []
        for position, (line_number, name) in enumerate(names):
            block = '\n'.join(lines[line_number:names[position + 1][0] if position + 1 < len(names) else len(lines)])
            # Inspect the same available fields for every choice, using only the
            # candidate's own filed block; no name or party inference is made.
            website = re.search(r'WEB - (\S+)', block)
            website = website[1] if website else None
            if website and not re.match(r'https?://', website):
                website = 'https://' + website
            designation_line = lines[line_number + 1] if line_number + 1 < len(lines) else ''
            designation = re.split(r'\s{2,}', designation_line.strip())[0] if re.match(r'^ {20}\S', designation_line) else None
            candidates.append(dict(name=name.lstrip('*'), websiteUrl=website,
                incumbent=True if designation and ('Incumbent' in designation or designation in {'Mayor', 'Burbank City Clerk', 'Sheriff of Los Angeles County'}) else None,
                ballotDesignation=designation))
        result.append(dict(number=start[1], title=title, candidates=candidates))
    assert len(result) == 34 and sum(len(row['candidates']) for row in result) == 54
    return result, len({row[1] for row in starts})


def measure_sections():
    source('la-measures.pdf')
    text = (EVIDENCE / 'la-measures.txt').read_text()
    jurisdiction, current, result = None, None, []
    for line in text.splitlines():
        heading = re.match(r'^\s*(.+?)(?:\s*Continued\s*)?\s*[–-]\s*\((\d+)\)\s*$', line)
        if heading:
            jurisdiction = heading[1].strip()
            continue
        row = re.match(r'^\s*([A-Z]{1,3})\s{2,}(\S.+)$', line)
        if row:
            current = dict(jurisdiction=jurisdiction, number=row[1], lines=[row[2]])
            result.append(current)
        elif current and line.strip() and not re.match(r'^\s*(?:VOTE PASSAGE|\d+\s*\||LOCAL JURISDICTION|COUNTY MEASURES|STATE MEASURES)', line):
            current['lines'].append(line.strip())
    for row in result:
        row['questionText'] = ' '.join(row.pop('lines')).split('Supporters:')[0].strip()
        assert '?' in row['questionText']
    assert len(result) == 68
    return result


def main():
    path = ROOT / 'data/ballot/2026-general/ca.json'
    data = json.loads(path.read_text())
    ballot = next(iter(data['ballots'].values()))
    counts = lambda: {key: len(ballot[key]) for key in ('contests', 'candidacies', 'measures')}
    before = counts()
    previous = {key: {row['id']: row for row in ballot[key]} for key in ('contests', 'candidacies', 'measures')}
    county_sets = court_memberships(data, ballot)
    candidate_meta, _ = source('la-candidates.pdf')
    measure_meta, _ = source('la-measures.pdf')
    index_meta, _ = source('la-index.html')
    sections, source_races = candidate_sections()
    for row in sections:
        title = row['title']
        city = re.match(r'^(?:CITY OF (.+?)|(.+?) CITY) (?:GENERAL MUNICIPAL|PRIMARY NOMINATING) ELECTION (.+)$', title)
        division = STATE + '/place:' + slug(city[1] or city[2]) if city else STATE + '/county:los_angeles'
        office = city[3] if city else title
        contest_id = 'ca-ba01-la-' + row['number']
        prov = provenance(candidate_meta, PUBLISHER, title + ' | NON PARTISAN | ' + ' | '.join(c['name'] for c in row['candidates']))
        if contest_id not in previous['contests']:
            ballot['contests'].append(dict(id=contest_id, electionId=ballot['election']['id'], ocdId=division,
                divisionVintage='2026', title=(city[1] or city[2]).title() + ' — ' + office if city else office,
                type='CANDIDACY', voteFor=1, termYears=None, scopeNote=None, candidateListComplete=True,
                provenance=prov, filingIndexProvenance=provenance(index_meta, PUBLISHER, 'Final List of Qualified Candidates to Appear on the Ballot')))
        for candidate in row['candidates']:
            key = contest_id + ':' + hashlib.sha256(candidate['name'].encode()).hexdigest()[:16]
            if key not in previous['candidacies']:
                ballot['candidacies'].append(dict(id=key, contestId=contest_id, givenName='', familyName=candidate['name'],
                    partyLabel=None, slogan=None, incumbent=candidate['incumbent'], websiteUrl=candidate['websiteUrl'],
                    ballotDesignation=candidate['ballotDesignation'], filingPartyStatus='NON PARTISAN', provenance=prov))
    measures = measure_sections()
    selected = [row for row in measures if row['jurisdiction'] == 'LOS ANGELES COUNTY' or row['jurisdiction'].startswith('CITY OF ')]
    assert len(selected) == 54
    for row in selected:
        city = row['jurisdiction'].removeprefix('CITY OF ') if row['jurisdiction'].startswith('CITY OF ') else None
        division = STATE + '/place:' + slug(city) if city else STATE + '/county:los_angeles'
        contest_id = 'ca-ba01-la-measure-' + slug(row['jurisdiction']) + '-' + row['number'].lower()
        prov = provenance(measure_meta, PUBLISHER, row['jurisdiction'] + ' | ' + row['number'] + ' | ' + row['questionText'])
        if contest_id not in previous['contests']:
            ballot['contests'].append(dict(id=contest_id, electionId=ballot['election']['id'], ocdId=division,
                divisionVintage='2026', title=row['jurisdiction'].title() + ' — Measure ' + row['number'], type='MEASURE',
                voteFor=None, termYears=None, scopeNote=None, measureTextUrl=measure_meta['finalUrl'], provenance=prov))
        key = contest_id + ':question'
        if key not in previous['measures']:
            ballot['measures'].append(dict(id=key, contestId=contest_id, officialNumber=row['number'], questionText=row['questionText'],
                officialStatement=None, provenance=prov))
    for meta in (candidate_meta, measure_meta, index_meta):
        receipt(data, meta, PUBLISHER)
    data['sourceReceipt']['reviewedAt'] = max(row['retrievedAt'] for row in data['sourceReceipt']['sources'])
    for key in previous:
        actual = {row['id']: row for row in ballot[key]}
        assert all(actual[row_id] == row for row_id, row in previous[key].items()), key
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    report = dict(candidateSourceRaces=source_races, added={key: counts()[key] - before[key] for key in before}, current=counts(),
        verifiedLocalCandidateRaces=34, verifiedLocalChoices=54, localMeasureSourceCount=68, countyAndCityMeasuresHeld=54,
        appellateMembershipCounties=58, countiesByDistrict=county_sets,
        heldSourceRaceIds=[row['number'] for row in sections],
        remaining='293 other candidate-list contests require district/at-large scope or reconciliation with held core races; 14 school/college measure electorates remain. This is not a full Los Angeles sample-ballot or live ZIP completeness claim.')
    (ROOT / 'data/ballot/reports/ba01-california-local.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('added', 'current', 'appellateMembershipCounties')}))


if __name__ == '__main__':
    main()
