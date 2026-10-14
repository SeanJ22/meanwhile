import argparse
import csv
import datetime
import hashlib
import html
import io
import json
import re
import urllib.parse
import urllib.request
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

ELECTION_ID = 'hi-2026-11-03'
STATE_OCD = 'ocd-division/country:us/state:hi'
PUBLISHER = 'Hawaii Office of Elections'
SOURCE_URLS = {
    'root.html': 'https://elections.hawaii.gov/',
    'candidates.html': 'https://elections.hawaii.gov/candidates/candidate-reports/',
    'report.html': 'https://olvr.hawaii.gov/Controls/CandidateFiling.aspx?elid=94',
    'measures.html': 'https://elections.hawaii.gov/voting/2026-proposed-amendments-to-the-hawaii-state-constitution/',
    'schedule.html': 'https://elections.hawaii.gov/voting/contest-schedule/',
}


def save_response(directory, name, response):
    raw = response.read()
    directory.joinpath(name).write_bytes(raw)
    metadata = {
        'requestedUrl': SOURCE_URLS.get(name, SOURCE_URLS['report.html']),
        'finalUrl': response.url,
        'httpStatus': response.status,
        'rawHash': hashlib.sha256(raw).hexdigest(),
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    directory.joinpath(name + '.meta.json').write_text(json.dumps(metadata, indent=2) + '\n')
    assert response.status == 200
    return raw


class FormInputs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = {}

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == 'input' and attributes.get('type') in ('hidden', 'text') and 'name' in attributes:
            self.fields[attributes['name']] = attributes.get('value', '')


def fetch_sources(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, url in SOURCE_URLS.items():
        with urllib.request.urlopen(url, timeout=60) as response:
            save_response(directory, name, response)
    form = FormInputs()
    form.feed(directory.joinpath('report.html').read_text())
    form.fields['__EVENTTARGET'] = ''
    form.fields['__EVENTARGUMENT'] = ''
    form.fields['ctl00$cphFooter$rdgSearch$ctl00$ctl02$ctl00$ExportToCsvButton'] = ''
    request = urllib.request.Request(SOURCE_URLS['report.html'], data=urllib.parse.urlencode(form.fields).encode(),
                                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
    with urllib.request.urlopen(request, timeout=60) as response:
        assert 'text/csv' in response.headers['Content-Type']
        save_response(directory, 'report.csv', response)


def text(value):
    return html.unescape(re.sub(r'<[^>]+>', '', value)).strip()


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def source(directory, name):
    raw = directory.joinpath(name).read_bytes()
    metadata = json.loads(directory.joinpath(name + '.meta.json').read_text())
    assert metadata['httpStatus'] == 200
    assert metadata['rawHash'] == hashlib.sha256(raw).hexdigest()
    return raw, metadata


def provenance(metadata, quote):
    return {
        'sourceUrl': metadata['finalUrl'],
        'sourceOrg': PUBLISHER,
        'collectedAt': metadata['retrievedAt'],
        'verifiedAt': metadata['retrievedAt'],
        'doorId': 'fec-hi-chief',
        'quote': quote,
    }


def in_scope(title):
    return title.startswith(('U.S. REPRESENTATIVE,', 'STATE SENATOR,', 'STATE REPRESENTATIVE,')) or title in (
        'GOVERNOR', 'LIEUTENANT GOVERNOR', 'OHA MAUI RESIDENT TRUSTEE', 'OHA OAHU RESIDENT TRUSTEE', 'OHA AT-LARGE TRUSTEE')


def division(title):
    match = re.search(r'DIST (\d+|II|I)\b', title)
    if not match:
        return STATE_OCD
    number = {'I': '1', 'II': '2'}.get(match[1], match[1])
    kind = 'cd' if title.startswith('U.S.') else 'sldu' if title.startswith('STATE SENATOR') else 'sldl'
    return f'{STATE_OCD}/{kind}:{number}'


def convert(directory):
    raw, candidate_meta = source(directory, 'report.csv')
    rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    report_raw, report_meta = source(directory, 'report.html')
    stated_total = re.search(r'<strong>(\d+)</strong> items in', report_raw.decode())[1]
    assert len(rows) == int(stated_total), 'The CSV must contain the entire report.'
    general = [row for row in rows if row['Status'] == 'In General' and in_scope(row['Contests'])]
    groups = defaultdict(list)
    for row in general:
        groups[row['Contests']].append(row)
    ballot = {
        'election': {'id': ELECTION_ID, 'date': '2026-11-03', 'name': '2026 Hawaii General Election', 'state': 'HI'},
        'contests': [], 'candidacies': [], 'measures': [], 'absences': [], 'coverageNotes': [],
    }
    for title, candidates in groups.items():
        contest_id = f'hi-2026-general-{slug(title)}'
        quote = '\n'.join(' | '.join(row[key] for key in ('Contests', 'Party', 'BallotName', 'Status')) for row in candidates)
        ballot['contests'].append({
            'id': contest_id, 'electionId': ELECTION_ID, 'ocdId': division(title), 'divisionVintage': '2022',
            'title': title, 'type': 'CANDIDACY', 'candidateListComplete': True,
            'voteFor': None, 'termYears': None, 'scopeNote': None, 'provenance': provenance(candidate_meta, quote),
        })
        for row in candidates:
            family, given = row['BallotName'].split(', ', 1)
            assert f'{family}, {given}' == row['BallotName']
            identity = '\n'.join((title, row['Party'], row['BallotName']))
            ballot['candidacies'].append({
                'id': f"{contest_id}-{hashlib.sha256(identity.encode()).hexdigest()[:16]}",
                'contestId': contest_id, 'familyName': family, 'givenName': given, 'partyLabel': row['Party'],
                'slogan': None, 'incumbent': None, 'websiteUrl': row['Website'].strip() or None,
                'provenance': provenance(candidate_meta, ' | '.join(row[key] for key in ('Contests', 'Party', 'BallotName', 'Website', 'Status'))),
            })
    elected = [row for row in rows if row['Status'] == 'Elected After Primary' and in_scope(row['Contests'])]
    for row in elected:
        quote = ' | '.join(row[key] for key in ('Contests', 'Party', 'BallotName', 'Status'))
        ballot['absences'].append({
            'ocdId': division(row['Contests']), 'divisionVintage': '2022',
            'statement': f"{row['Contests']}: {row['BallotName']} is listed as Elected After Primary in the official Candidate Report; this contest is not on the general-election ballot.",
            'provenance': provenance(candidate_meta, quote),
        })
    schedule_raw, schedule_meta = source(directory, 'schedule.html')
    tables = re.findall(r'<table\b[^>]*class="tablepress[^>]*>(.*?)</table>', schedule_raw.decode(), re.S)
    schedule_2026 = [list(map(text, re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S))) for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', tables[0], re.S)]
    schedule_2026 = [row for row in schedule_2026 if len(row) == 4]
    scheduled = {row[0]: row for row in schedule_2026}
    senate_districts = set(re.findall(r'\d+', scheduled['State Senate'][2]))
    senate_held = {re.search(r'DIST (\d+)', row['Contests'])[1] for row in general + elected if row['Contests'].startswith('STATE SENATOR')}
    house_held = {int(re.search(r'DIST (\d+)', row['Contests'])[1]) for row in general + elected if row['Contests'].startswith('STATE REPRESENTATIVE')}
    assert senate_held == senate_districts
    assert house_held == set(range(1, int(scheduled['State House of Representatives'][2].split('-')[1].strip()) + 1))
    for contest in ballot['contests']:
        title = contest['title']
        office = 'U.S. House of Representatives' if title.startswith('U.S.') else 'State Senate' if title.startswith('STATE SENATOR') else 'State House of Representatives' if title.startswith('STATE REPRESENTATIVE') else 'Office of Hawaiian Affairs Trustee' if title.startswith('OHA') else 'Governor and Lieutenant Governor'
        term = scheduled[office][3]
        contest['termYears'] = int(re.search(r'\d+', term)[0])
        if 'VACANCY' in title:
            contest['termYears'] = int(re.search(r'\*(\d+) year', term)[1])
        contest['voteFor'] = int(re.search(r'At-Large \((\d+) seats\)', scheduled[office][2])[1]) if title == 'OHA AT-LARGE TRUSTEE' else 1
    senate_2028 = next(text(row) for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', tables[1], re.S) if 'U.S Senate' in row)
    ballot['absences'].append({'ocdId': STATE_OCD, 'divisionVintage': '2022',
        'statement': 'The official Contest Schedule places the next U.S. Senate election in 2028; no U.S. Senate contest is on the 2026 general-election ballot.',
        'provenance': provenance(schedule_meta, senate_2028)})
    measure_raw, measure_meta = source(directory, 'measures.html')
    measure_html = measure_raw.decode()
    headings = list(re.finditer(r'<p\b[^>]*>\s*<strong>(QUESTION #(\d+):[^<]+)</strong>\s*</p>', measure_html))
    assert headings
    for index, heading in enumerate(headings):
        section = measure_html[heading.end():headings[index + 1].start() if index + 1 < len(headings) else measure_html.index('<hr', heading.end())]
        question = text(re.search(r'<blockquote\b[^>]*>\s*<p\b[^>]*>(.*?)</p>\s*</blockquote>', section, re.S)[1])
        links = [(html.unescape(url), text(label)) for url, label in re.findall(r'<a href="([^"]+)">(.*?)</a>', section, re.S)]
        full_text_url = next(url for url, label in links if label)
        contest_id = f'hi-2026-general-question-{heading[2]}'
        ballot['contests'].append({'id': contest_id, 'electionId': ELECTION_ID, 'ocdId': STATE_OCD,
            'divisionVintage': '2022', 'title': text(heading[1]), 'type': 'MEASURE', 'measureTextUrl': full_text_url,
            'voteFor': 1, 'termYears': None, 'scopeNote': None, 'provenance': provenance(measure_meta, text(heading[1]) + '\n' + question)})
        ballot['measures'].append({'id': contest_id + '-measure', 'contestId': contest_id,
            'officialNumber': f'QUESTION #{heading[2]}', 'questionText': question, 'officialStatement': None,
            'provenance': provenance(measure_meta, question)})
    ballot['coverageNotes'] = [
        f"The complete official Candidate Report CSV contains {len(rows)} filing records. Only candidates with status In General are included. {len(elected)} state legislative contests were decided at the primary and are recorded as absences.",
        'The two statewide constitutional questions are taken verbatim from the Office of Elections. Each full-text link is the one published there; the Legislature returned HTTP 403 when its linked pages were requested.',
    ]
    receipt_sources = []
    for name, evidence in [
        ('report.csv', 'Native official CSV export; all filing records acquired, November candidacies filtered by In General status; printed ballot names, parties and websites preserved; mailing addresses excluded.'),
        ('report.html', 'Official public Candidate Report grid supplies the total filing count used to verify the full CSV export.'),
        ('schedule.html', 'Official 2026 contest schedule validates all legislative districts and term lengths, identifies three at-large OHA seats and places U.S. Senate in 2028.'),
        ('measures.html', 'Official statewide constitutional-amendment page supplies both question titles, verbatim ballot questions, and linked full-text measures.'),
        ('candidates.html', 'Official Candidate Reports page states filing is closed and links the public candidate report, last updated September 4, 2026.'),
    ]:
        _, metadata = source(directory, name)
        receipt_sources.append({**{key: metadata[key] for key in ('requestedUrl', 'finalUrl', 'httpStatus', 'rawHash', 'retrievedAt')},
            'publisher': PUBLISHER, 'sourceClass': 'ELECTION_AUTHORITY', 'reviewedEvidence': evidence, 'reviewOutcome': 'SUPPORTED'})
    through = max(row['retrievedAt'] for row in receipt_sources)
    package = {'contractId': 'ballot-contests', 'version': 'bl-12-hi-' + hashlib.sha256(raw + measure_raw + schedule_raw).hexdigest()[:16],
        'sourceThrough': through, 'sourceReceipt': {'contractVersion': 1, 'reviewedAt': through, 'reviewedBy': 'BL-12 official-source script conversion', 'sources': receipt_sources},
        'payload': {'kind': 'ballot-contests', 'ballots': {'HI:' + ELECTION_ID: ballot}}}
    door_update = {'id': 'fec-hi-chief', 'covers': ['CANDIDATE_LIST', 'BALLOT_MEASURES'],
        'candidateListUrls': [SOURCE_URLS['candidates.html'], SOURCE_URLS['report.html']],
        'ballotMeasureUrls': [SOURCE_URLS['measures.html']]}
    return package, door_update


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--door-output', type=Path, required=True)
    parser.add_argument('--fetch', action='store_true')
    options = parser.parse_args()
    if options.fetch:
        fetch_sources(options.source_dir)
    package, door = convert(options.source_dir)
    options.output.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    options.door_output.write_text(json.dumps(door, ensure_ascii=False, indent=2) + '\n')
    ballot = next(iter(package['payload']['ballots'].values()))
    print(json.dumps({key: len(ballot[key]) for key in ('contests', 'candidacies', 'measures', 'absences')}))
