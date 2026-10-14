import hashlib
import io
import json
import pathlib
import re
import argparse
import urllib.request
import datetime
import subprocess
import zipfile

import openpyxl
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, required=True)
parser.add_argument('--door-output', type=pathlib.Path, required=True)
parser.add_argument('--fetch', action='store_true')
options = parser.parse_args()
source_dir = options.source_dir
output = options.output
urls = {
    'general.html': 'https://sos.ga.gov/november-3-2026-general-election',
    'candidates.zip': 'https://sos.ga.gov/sites/default/files/2026-09/November%202026%20Federal%20and%20State%20Candidates%202026.zip',
    'write-ins.pdf': 'https://sos.ga.gov/sites/default/files/forms/2026%20Certified%20Write-In%20Candidates_3.pdf',
    'measures.pdf': 'https://sos.ga.gov/sites/default/files/2026-09/2026%20Constitutional%20Summaries%20booklet%20FINAL.pdf',
}
if options.fetch:
    source_dir.mkdir(parents=True, exist_ok=True)
    for name, url in urls.items():
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read()
            assert response.status == 200
            source_dir.joinpath(name).write_bytes(raw)
            meta = {'requestedUrl': url, 'finalUrl': response.url, 'httpStatus': response.status, 'rawHash': hashlib.sha256(raw).hexdigest(), 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            source_dir.joinpath(name + '.meta.json').write_text(json.dumps(meta) + '\n')
publisher = 'Georgia Secretary of State, Elections Division'
election_id = 'ga-2026-11-03'
state_ocd = 'ocd-division/country:us/state:ga'
receipts = []

def evidence(name, description):
    raw = (source_dir / name).read_bytes()
    meta = json.loads((source_dir / (name + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash']
    receipts.append({**meta, 'publisher': publisher, 'sourceClass': 'ELECTION_AUTHORITY', 'reviewedEvidence': description})
    return raw, {'sourceUrl': meta['finalUrl'], 'sourceOrg': publisher, 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt'], 'doorId': 'fec-ga-chief'}

def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')

def division(office):
    for prefix, kind in [('U.S. House of Representatives, District ', 'cd'), ('State Senate, District ', 'sldu'), ('State House, District ', 'sldl')]:
        if office.startswith(prefix):
            return state_ocd + '/' + kind + ':' + str(int(office[len(prefix):]))
    return state_ocd

ballot = {'election': {'id': election_id, 'date': '2026-11-03', 'name': '2026 General Election', 'state': 'GA'}, 'contests': [], 'candidacies': [], 'measures': [], 'absences': [], 'coverageNotes': []}
contests = {}
evidence('general.html', 'Official November 3, 2026 general-election page: \"Please click here to view the list of candidates to appear on the November General Election Ballot.\" The linked roster and final certified write-in list are both acquired.')
raw, provenance = evidence('candidates.zip', 'The November general-election page links this federal and state ballot candidate spreadsheet. All in-scope spreadsheet rows are converted and the final certified write-in list is added separately.')
archive = zipfile.ZipFile(io.BytesIO(raw))
member = archive.namelist()[0]
workbook = openpyxl.load_workbook(io.BytesIO(archive.read(member)), data_only=True)
rows = list(workbook.active.values)
assert rows[0] == ('Office', 'Name on Ballot', 'Incumbent?', 'Party')
for office, name, incumbent, party in rows[1:]:
    office = office.strip()
    if office.startswith('District Attorney, '):
        continue
    assert isinstance(name, str) and name.strip()
    contest_id = 'ga-sos-2026-' + slug(office)
    if office not in contests:
        contests[office] = {'id': contest_id, 'electionId': election_id, 'ocdId': division(office), 'divisionVintage': 'TIGER_GENZ2025', 'title': office, 'type': 'CANDIDACY', 'voteFor': None, 'termYears': None, 'scopeNote': None, 'candidateListComplete': True, 'provenance': provenance}
    ballot['candidacies'].append({'id': contest_id + ':' + slug(name), 'contestId': contest_id, 'familyName': name.strip(), 'givenName': '', 'partyLabel': party, 'slogan': None, 'incumbent': {'Yes': True, 'No': False}[incumbent], 'websiteUrl': None, 'provenance': {**provenance, 'quote': name.strip()}})

raw, provenance = evidence('write-ins.pdf', 'Final list of certified write-in candidates for November 3, 2026; updated September 24, 2026. All 21 listed write-ins are parsed by office; the source gives no party, incumbency, or candidate website.')
text = subprocess.run(['pdftotext', '-layout', '-', '-'], input=raw, capture_output=True, check=True).stdout.decode()
assert 'FINAL LIST OF CERTIFIED WRITE-IN CANDIDATES' in text
active = None
for line in text.splitlines():
    line = line.strip()
    if line.startswith('Pursuant to O.C.G.A.'):
        break
    if line in ('U.S. Senate', 'Governor') or re.fullmatch(r'(U.S. House of Representatives|State Representative), District \d+', line):
        active = line.replace('State Representative,', 'State House,')
        assert active in contests
    elif active and line:
        contest_id = contests[active]['id']
        ballot['candidacies'].append({'id': contest_id + ':write-in:' + slug(line), 'contestId': contest_id, 'familyName': line, 'givenName': '', 'partyLabel': None, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': line}})
ballot['contests'] = list(contests.values())

raw, provenance = evidence('measures.pdf', 'Official constitutional-amendment booklet contains all three proposed amendments in full, their ballot questions, and official summaries for November 3, 2026.')
summary = PdfReader(io.BytesIO(raw)).pages[-1].extract_text()
sections = re.split(r'\n-\s*(\d)\s*-\s*\n', summary)
assert [sections[i] for i in range(1, len(sections), 2)] == ['1', '2', '3']
for index in range(1, len(sections), 2):
    number, section = sections[index:index + 2]
    title = re.sub(r'(?<=\d)\s*-\s*(?=\d)', '-', ' '.join(section.split('House Resolution No.')[0].split()))
    question_match = re.search(r'Shall\b[\s\S]+?\?', section)
    assert question_match
    question = ' '.join(question_match.group(0).split())
    question = re.sub(r'(?<=\d)\s*-\s*(?=\d)', '-', question)
    statement = re.sub(r'(?<=\d)\s*-\s*(?=\d)', '-', ' '.join(section.split('Summary', 1)[1].split()))
    contest_id = 'ga-sos-2026-constitutional-amendment-' + number
    ballot['contests'].append({'id': contest_id, 'electionId': election_id, 'ocdId': state_ocd, 'divisionVintage': 'TIGER_GENZ2025', 'title': 'Constitutional Amendment ' + number + ': ' + title, 'type': 'MEASURE', 'measureTextUrl': provenance['sourceUrl'], 'voteFor': None, 'termYears': None, 'scopeNote': None, 'provenance': provenance})
    ballot['measures'].append({'id': contest_id + ':question', 'contestId': contest_id, 'officialNumber': number, 'questionText': question, 'officialStatement': statement, 'provenance': {**provenance, 'quote': question}})
assert len(contests) == 261
assert len(ballot['candidacies']) == 463
assert {int(row['ocdId'].split(':')[-1]) for row in contests.values() if '/cd:' in row['ocdId']} == set(range(1, 15))
assert {int(row['ocdId'].split(':')[-1]) for row in contests.values() if '/sldu:' in row['ocdId']} == set(range(1, 57))
assert {int(row['ocdId'].split(':')[-1]) for row in contests.values() if '/sldl:' in row['ocdId']} == set(range(1, 181))
reviewed = max(row['retrievedAt'] for row in receipts)
package = {'contractId': 'ballot-contests', 'version': 'BL-12:GA:2026-11-03', 'sourceThrough': reviewed[:10], 'sourceReceipt': {'contractVersion': 1, 'reviewedAt': reviewed, 'reviewedBy': 'BL-12 scripted official-source conversion', 'sources': receipts}, 'payload': {'kind': 'ballot-contests', 'ballots': {'GA:' + election_id: ballot}}}
output.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
door = {'id': 'fec-ga-chief', 'covers': ['CANDIDATE_LIST', 'BALLOT_MEASURES'], 'candidateListUrls': [urls['general.html'], urls['candidates.zip'], urls['write-ins.pdf']], 'ballotMeasureUrls': [urls['measures.pdf']], 'electionPageUrl': urls['general.html'], 'access': {'status': 'open', 'detail': 'Official general-election candidate archive, final certified write-in list and all three full constitutional amendments acquired as exact HTTP 200 bytes.', 'checkedAt': reviewed[:10]}}
options.door_output.write_text(json.dumps(door, ensure_ascii=False, indent=2) + '\n')
print(len(ballot['contests']), len(ballot['candidacies']), len(ballot['measures']))
