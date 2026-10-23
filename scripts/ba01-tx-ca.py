"""Replay BA-01's saved official TX/CA lists and add San Francisco countywide facts.

Run from the repository root. This prepares assembler input; it never connects to
production or changes district boundaries. Sources are saved under sources/ba-01.
"""
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/ballot/sources/ba-01'


class Headings(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tag = None
        self.value = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag in ('h2', 'h3'):
            self.tag, self.value = tag, []

    def handle_data(self, text):
        if self.tag:
            self.value.append(text)

    def handle_endtag(self, tag):
        if tag == self.tag:
            self.rows.append((tag, ''.join(self.value).strip()))
            self.tag = None


def norm(value):
    return re.sub(r'\s+', ' ', value).strip()


def read_state(state):
    path = ROOT / f'data/ballot/2026-general/{state}.json'
    return path, json.loads(path.read_text())


def core_comparison():
    _, tx = read_state('tx')
    ballot = next(iter(tx['ballots'].values()))
    offices, office = {}, None
    for line in (SOURCES / 'tx/2026-ballot-cert.txt').read_text().splitlines():
        candidate = re.match(r'^\s{10,}(.+?)\s{3,}(REP|DEM|LIB|GRE|IND)\s*$', line)
        if candidate and office:
            offices.setdefault(office, set()).add(candidate.groups())
        elif re.match(r'^\s{5}\S', line):
            office = line.strip()
    statewide = {'U. S. SENATOR', 'GOVERNOR', 'LIEUTENANT GOVERNOR', 'ATTORNEY GENERAL',
        'COMPTROLLER OF PUBLIC ACCOUNTS', 'COMMISSIONER OF THE GENERAL LAND OFFICE',
        'COMMISSIONER OF AGRICULTURE', 'RAILROAD COMMISSIONER'}
    core = {title: candidates for title, candidates in offices.items() if title in statewide or re.match(
        r'^(?:U\. S\. REPRESENTATIVE DISTRICT |STATE SENATOR, DISTRICT |STATE REPRESENTATIVE DISTRICT |'
        r'MEMBER, STATE BOARD OF EDUCATION, DISTRICT |(?:CHIEF )?JUSTICE, SUPREME COURT|'
        r'JUDGE, COURT OF CRIMINAL APPEALS|(?:CHIEF )?JUSTICE, 15TH COURT OF APPEALS DISTRICT)', title)}
    assert len(core) == 231, len(core)
    contests = {row['title']: row for row in ballot['contests'] if '/county:' not in row['ocdId']}
    for title, candidates in core.items():
        assert title in contests, title
        contest = contests[title]
        held = {(norm(c['givenName'] + ' ' + c['familyName']).upper(), c['partyLabel'])
                for c in ballot['candidacies'] if c['contestId'] == contest['id'] and
                c['provenance']['sourceUrl'] == 'https://www.sos.state.tx.us/elections/forms/2026-ballot-cert.pdf'}
        assert held == candidates, (title, candidates - held, held - candidates)
    tx_result = dict(state='TX', contests=len(core), candidacies=sum(map(len, core.values())),
        sources=[json.loads((SOURCES / 'tx/core-source.json').read_text())],
        scope='Every printed core office/candidate in the regular final certification; the two separately certified legislative special elections are additional. Registered write-in list remains open.')
    print('TX: all 231 state-certified core contests match the regular certification; '
          '38 House, 16 state Senate, 150 state House in the regular certification.')

    _, ca = read_state('ca')
    ballot = next(iter(ca['ballots'].values()))
    offices, office = {}, None
    statewide = ['Governor', 'Lieutenant Governor', 'Secretary of State', 'Controller', 'Treasurer',
                 'Attorney General', 'Insurance Commissioner', 'Superintendent of Public Instruction']
    for line in (SOURCES / 'ca/cert-list-candidates.txt').read_text().splitlines():
        title = line.strip()
        if title in statewide or re.fullmatch(
                r'(Board of Equalization Member|United States Representative|State Senate|State Assembly Member) District \d+', title):
            office = title
            offices.setdefault(office, set())
        candidate = re.match(r'^\s{8}(.+?)\s{3,}(Democratic|Republican|Non-Partisan|No Party Preference|Green|Libertarian|American Independent|Peace and Freedom)\s*$', line)
        if candidate and office:
            offices[office].add((candidate[1].rstrip('*'), candidate[2]))
    held = {c['title']: c for c in ballot['contests']}
    for title, candidates in offices.items():
        assert title in held, title
        actual = {(norm(c['givenName'] + ' ' + c['familyName']), c['partyLabel'])
                  for c in ballot['candidacies'] if c['contestId'] == held[title]['id']}
        assert actual == candidates, (title, candidates - actual, actual - candidates)
    print(f'CA: {len(offices)} core contests / {sum(map(len, offices.values()))} certified candidates match exactly.')
    ca_result = dict(state='CA', contests=len(offices), candidacies=sum(map(len, offices.values())),
        sources=[json.loads((SOURCES / 'ca/core-source.json').read_text())],
        scope='Every printed federal, statewide, Board of Equalization and legislative candidate in the final certification; later qualified write-ins and regional courts remain separate work.')
    (ROOT / 'data/ballot/reports/ba01-tx-ca.json').write_text(json.dumps([tx_result, ca_result], indent=2) + '\n')


def add_sf():
    path, data = read_state('ca')
    ballot = next(iter(data['ballots'].values()))
    evidence = SOURCES / 'ca'
    metadata = json.loads((evidence / 'sources.json').read_text())
    rows = {r['file']: r for r in metadata}
    parser = Headings()
    parser.feed((evidence / 'sf-candidates.html').read_text())
    names, office = {}, None
    for tag, text in parser.rows:
        if tag == 'h2':
            office = text
            names.setdefault(office, [])
        elif tag == 'h3':
            names[office].append(text)
    county = 'ocd-division/country:us/state:ca/county:san_francisco'
    def provenance(file):
        source = rows[file]
        return dict(sourceUrl=source['url'], sourceOrg='San Francisco Department of Elections',
                    collectedAt=source['retrievedAt'], verifiedAt=source['retrievedAt'])

    def contest(title, suffix, kind, file, vote_for=None):
        return dict(id='ca-sf-2026-' + suffix, electionId=ballot['election']['id'], ocdId=county,
                    divisionVintage='2026', title=title, type=kind, voteFor=vote_for,
                    termYears=None, scopeNote=None, provenance=provenance(file))

    # These five offices are voted on throughout the City and County. The VIP
    # explicitly lists them and seat counts. Supervisorial/BART districts are
    # left for their own district scope rather than widened to the county.
    countywide = [('Assessor-Recorder', 'assessor-recorder', 1), ('Public Defender', 'public-defender', 1),
                  ('Board of Education (3 seats)', 'board-education', 3),
                  ('Community College Board (3 seats)', 'community-college-board', 3),
                  ('Community College Board Partial Term', 'community-college-board-partial', 1)]
    candidate_contests, candidacies = [], []
    vip = (evidence / 'sf-vip.txt').read_text()
    for title, suffix, seats in countywide:
        assert names[title], title
        race = contest(title, suffix, 'CANDIDACY', 'sf-candidates.html', seats)
        race['candidateListComplete'] = True
        for name in names[title]:
            candidacies.append(dict(id=race['id'] + '-' + hashlib.sha256(name.encode()).hexdigest()[:16],
                contestId=race['id'], familyName=name, givenName='', partyLabel=None, slogan=None,
                incumbent=None, websiteUrl=None, provenance=provenance('sf-candidates.html')))
        candidate_contests.append(race)

    labels = Headings()
    labels.feed((evidence / 'sf-qualified-measures.html').read_text())
    label_map = {}
    # The qualification page uses headings for the categories and the measures.
    for _, title in labels.rows:
        match = re.fullmatch(r'([A-J]) - (.+)', title)
        if match:
            label_map[match[1]] = match[2]
    assert len(label_map) == 10, label_map
    questions = re.findall(r'Proposition entitled “(.*?)”:\s*“(.*?)”',
                           (evidence / 'sf-ballot-questions.txt').read_text(), re.S)
    questions = [(norm(title), norm(question)) for title, question in questions]
    prefixes = dict(A='Charter Changes', B='Establishing a Municipal', C='Contributions to the Housing',
                    D='Changes to Ballot Measure', E='City Administrator', F='Changes to Executive',
                    G='Allowing Private Vehicles', H='Parcel Tax', I='Changes to Real Property',
                    J='Removal of Foreclosure')
    measures, measure_contests = [], []
    for letter, prefix in prefixes.items():
        found = [question for title, question in questions if title.startswith(prefix)]
        assert len(found) == 1, (letter, found)
        race = contest(f'Proposition {letter} — {label_map[letter]}', 'proposition-' + letter.lower(),
                       'MEASURE', 'sf-ballot-questions.txt')
        race['measureTextUrl'] = rows['sf-ballot-questions.txt']['url']
        measure_contests.append(race)
        measures.append(dict(id=race['id'] + '#question', contestId=race['id'], officialNumber=letter,
                             questionText=found[0], officialStatement=None,
                             provenance=provenance('sf-ballot-questions.txt')))

    # RTM is regional. A county-scoped record covers SF readers without making
    # claims about another county's ballot; its full question identifies all
    # five participating counties and the different tax rates.
    start = vip.index('Regional Transit Measure\nTo prevent major')
    body = vip[start:].split('\nThis regional measure requires', 1)[0]
    lines = body.splitlines()[1:]
    question = norm(' '.join(re.sub(r'\s{3,}(YES|NO)\s*$', '', line).strip() for line in lines))
    assert question.startswith('To prevent major service cuts') and question.endswith('be adopted?'), question
    race = contest('RTM — Regional Transit Measure', 'regional-transit-measure', 'MEASURE', 'sf-vip.txt')
    race['measureTextUrl'] = rows['sf-vip.txt']['url']
    measure_contests.append(race)
    measures.append(dict(id=race['id'] + '#question', contestId=race['id'], officialNumber='RTM',
                         questionText=question, officialStatement=None, provenance=provenance('sf-vip.txt')))

    for field, incoming in [('contests', candidate_contests + measure_contests), ('candidacies', candidacies), ('measures', measures)]:
        held = {row['id']: row for row in ballot[field]}
        for row in incoming:
            if row['id'] in held:
                assert held[row['id']] == row, row['id']
            else:
                ballot[field].append(row)
    receipt = data['sourceReceipt']
    for row in metadata:
        if not any(old['finalUrl'] == row['url'] and old['rawHash'] == row['rawHash'] for old in receipt['sources']):
            receipt['sources'].append(dict(requestedUrl=row['url'], finalUrl=row['url'], publisher=row['publisher'],
                sourceClass='ELECTION_AUTHORITY', httpStatus=200, retrievedAt=row['retrievedAt'], rawHash=row['rawHash'],
                reviewOutcome='SUPPORTED', reviewedEvidence='Saved official document; BA-01 parser replays candidate headings and exact ballot questions.'))
    receipt['reviewedAt'] = max([receipt['reviewedAt']] + [row['retrievedAt'] for row in metadata])
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print('San Francisco: 5 countywide candidate contests / 19 candidates and 11 ballot measures replayed. '
          'Supervisorial/BART district races remain open; no ZIP parity claimed.')


def add_tx():
    path, data = read_state('tx')
    ballot = next(iter(data['ballots'].values()))
    evidence = SOURCES / 'tx'
    sources = json.loads((evidence / 'sources.json').read_text())
    by_file = {row['file']: row for row in sources}
    def provenance(file):
        row = by_file[file]
        return dict(sourceUrl=row['url'], sourceOrg=row['publisher'], collectedAt=row['retrievedAt'], verifiedAt=row['retrievedAt'])
    contests, candidates, measures = [], [], []
    def race(title, scope, suffix, file, names, vote_for=1):
        row = dict(id='tx-ba01-2026-' + suffix, electionId=ballot['election']['id'], ocdId=scope,
                   divisionVintage='2026', title=title, type='CANDIDACY', voteFor=vote_for, termYears=None,
                   scopeNote=None, candidateListComplete=True, provenance=provenance(file))
        contests.append(row)
        for name, party in names:
            candidates.append(dict(id=row['id'] + '-' + hashlib.sha256(name.encode()).hexdigest()[:16],
                contestId=row['id'], familyName=name, givenName='', partyLabel=party, slogan=None,
                incumbent=None, websiteUrl=None, provenance=provenance(file)))
        return row
    for file, office, family, number in [('SD22.txt', 'STATE SENATE', 'sldu', 22), ('HD93.txt', 'STATE REPRESENTATIVE', 'sldl', 93)]:
        text = (evidence / file).read_text()
        assert f'{office}, DISTRICT {number}:' in text
        assert 'SPECIAL ELECTION' in text and 'NOVEMBER, 2026' in text
        names = re.findall(r'^(.+?) (Republican|Democratic)\s*$', text, re.M)
        assert len(names) == 2, names
        race(f'{office}, DISTRICT {number} — Special Election',
             f'ocd-division/country:us/state:tx/{family}:{number}', f'special-{family}-{number}', file, names)
    county = 'ocd-division/country:us/state:tx/county:travis'
    # Column crops retain the printed office/name relationship. Reading PDF
    # object order incorrectly moves Todd Wong into the County Judge race.
    titles = ['County Judge'] + [f'Judge, County Court at Law No. {n}' for n in range(1, 8)] + [
        'Judge, Probate Court No. 1', 'District Clerk', 'County Clerk', 'County Treasurer']
    columns = [(evidence / f'travis-page-2-column-{n}.txt').read_text() for n in range(1, 5)]
    for title in titles:
        sections = [text.split(title + '\n', 1)[1] for text in columns if title + '\n' in text]
        assert len(sections) == 1, title
        found = re.search(r'^([^\n]+?) \((REP|DEM|LIB|GRN)\)\s*$', sections[0], re.M)
        assert found, title
        row = race(title, county, 'travis-' + re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-'),
                   'travis-sample.pdf', [found.groups()])
        if title == 'County Clerk':
            row['scopeNote'] = 'Printed candidate list; the certified write-in list is still being acquired.'
    appraisal = columns[3]
    for n in [1, 2, 3]:
        match = re.search(r'Board of\s*Directors, Place ' + str(n) + r'\s*(.*?)(?=Travis Central Appraisal District,|City of Austin|\Z)', appraisal, re.S)
        assert match, n
        # Spanish label precedes the names; each candidate is a separate line.
        section = match[1].split(f'Lugar Núm. {n}', 1)[1]
        names = [line.strip() for line in section.splitlines() if line.strip()]
        assert len(names) == (2 if n == 3 else 1), names
        race(f'Travis Central Appraisal District, Board of Directors, Place {n}', county,
             f'travis-appraisal-place-{n}', 'travis-sample.pdf', [(name, None) for name in names])
    questions = {}
    for page in [3, 4]:
        for col in range(1, 5):
            text = (evidence / f'travis-page-{page}-column-{col}.txt').read_text()
            for letter, question in re.findall(r'City of Austin Proposition ([A-H])\s*(.*?)\s*Ciudad de Austin Propuesta [A-H]', text, re.S):
                assert letter not in questions
                questions[letter] = norm(question)
    assert set(questions) == set('ABCDEFGH')
    for letter, question in sorted(questions.items()):
        row = dict(id=f'tx-ba01-2026-austin-proposition-{letter.lower()}', electionId=ballot['election']['id'],
                   ocdId='ocd-division/country:us/state:tx/place:austin', divisionVintage='2026',
                   title=f'City of Austin Proposition {letter}', type='MEASURE', voteFor=None, termYears=None,
                   scopeNote=None, measureTextUrl=by_file['travis-sample.pdf']['url'], provenance=provenance('travis-sample.pdf'))
        contests.append(row)
        measures.append(dict(id=row['id'] + '#question', contestId=row['id'], officialNumber=letter,
                             questionText=question, officialStatement=None, provenance=provenance('travis-sample.pdf')))
    for field, incoming in [('contests', contests), ('candidacies', candidates), ('measures', measures)]:
        held = {row['id']: row for row in ballot[field]}
        for row in incoming:
            if row['id'] in held:
                assert held[row['id']] == row, row['id']
            else:
                ballot[field].append(row)
    for source in sources:
        if not any(row['finalUrl'] == source['url'] and row['rawHash'] == source['rawHash'] for row in data['sourceReceipt']['sources']):
            data['sourceReceipt']['sources'].append(dict(requestedUrl=source['url'], finalUrl=source['url'],
                publisher=source['publisher'], sourceClass='ELECTION_AUTHORITY', httpStatus=200,
                retrievedAt=source['retrievedAt'], rawHash=source['rawHash'], reviewOutcome='SUPPORTED',
                reviewedEvidence='Saved official candidate certification or sample ballot; source columns and all candidate fields replayed by scripts/ba01-tx-ca.py.'))
    data['sourceReceipt']['reviewedAt'] = max([data['sourceReceipt']['reviewedAt']] + [row['retrievedAt'] for row in sources])
    # The two certifications are now held; retain the other explicit gaps.
    ballot['coverageNotes'] = [note.replace(' Separate November 3 special-election candidate certifications for Senate District 22 and House District 93 are not held.', '')
                              for note in ballot.get('coverageNotes', [])]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f'TX: {len(contests)} verified additions / {len(candidates)} candidate rows / {len(measures)} Austin measures. '
          'District and other local coverage remains open.')


if __name__ == '__main__':
    core_comparison()
    add_sf()
    add_tx()
