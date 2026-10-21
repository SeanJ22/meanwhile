"""Replay Maine's regular, special-county and current declared-write-in lists."""
import argparse
import collections
import datetime
import hashlib
import importlib.util
from html.parser import HTMLParser
import json
import pathlib
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/ballot/sources/ba01-northeast'
SPEC = importlib.util.spec_from_file_location('ba01_northeast', ROOT / 'scripts/ba01-northeast.py')
COMMON = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMMON)
BASE = 'ocd-division/country:us/state:me'
COUNTIES = dict(zip('AND ARO CUM FRA HAN KEN KNO LIN OXF PEN PIS SAG SOM WAL WAS YOR'.split(),
                    'androscoggin aroostook cumberland franklin hancock kennebec knox lincoln oxford penobscot piscataquis sagadahoc somerset waldo washington york'.split()))
TITLES = {'JP': 'Judge of Probate', 'RP': 'Register of Probate', 'CT': 'County Treasurer',
          'RD': 'Register of Deeds', 'SH': 'Sheriff', 'DA': 'District Attorney',
          'CC': 'County Commissioner', 'KBC': 'County Budget Committee', 'KCB': 'County Budget Committee',
          'ACC': 'County Charter Commission'}


def workbook_rows(path):
    ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as archive:
        strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', ns)]
        records = []
        for row in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//s:row', ns):
            values = {}
            for cell in row:
                value = cell.find('s:v', ns)
                if value is not None:
                    values[re.sub(r'\d', '', cell.get('r'))] = (strings[int(value.text)] if cell.get('t') == 's' else value.text).strip()
            if values:
                records.append(values)
    headers = records.pop(0)
    return [{headers[col]: value for col, value in row.items() if col in headers} for row in records if row.get('A')]


def writein_rows(path):
    """Use table columns; a blank party stays blank. Residence is never extracted."""
    ns = {'x': 'http://www.w3.org/1999/xhtml'}
    with tempfile.NamedTemporaryFile(suffix='.xml') as target:
        subprocess.run(['pdftotext', '-bbox-layout', str(path), target.name], check=True)
        pages = ET.parse(target.name).findall('.//x:page', ns)
    rows = []
    for page in pages:
        lines = [(float(line.get('xMin')), float(line.get('yMin')), ' '.join(w.text or '' for w in line))
                 for line in page.findall('.//x:line', ns)]
        words = [(float(word.get('xMin')), float(word.get('yMin')), word.text or '') for word in page.findall('.//x:word', ns)]
        for x, y, code in lines:
            if x >= 45 or code not in {'US', 'CG', 'GOV', 'SR', 'CT', 'CC', 'KCB'}:
                continue
            cells = [(px, text) for px, py, text in words if abs(py-y) < 1]
            def cell(low, high):
                return ' '.join(text for px, text in cells if low <= px < high) or None
            rows.append({'Office': code, 'Dist': cell(45, 73), 'County': cell(73, 95),
                         'Party': cell(95, 180), 'Name': cell(180, 285)})
    return rows


def local_rows():
    rows = []
    for filename in ['me-final-current.xlsx', 'me-special-county-candidates.xlsx']:
        for row in workbook_rows(SOURCES / filename):
            if row['Office'] not in TITLES:
                continue
            row['Name'] = ' '.join(row.get(key, '') for key in ['First Name', 'Middle Name', 'Last Name', 'Suffix']).strip()
            row['Name'] = ' '.join(row['Name'].split())
            row['sourceFile'] = filename
            rows.append(row)
    for row in writein_rows(SOURCES / 'me-writeins-2026-10-15.pdf'):
        if row['Office'] in TITLES:
            row['sourceFile'] = 'me-writeins-2026-10-15.pdf'
            rows.append(row)
    return rows


def group_key(row):
    return row['Office'].replace('KCB', 'KBC'), row.get('Dist'), row.get('County')


def scope(row):
    code, district, county = group_key(row)
    if code == 'DA':
        return BASE + '/prosecutorial_district:' + district
    county = 'KNO' if code == 'KBC' else 'ARO' if code == 'ACC' else county
    result = BASE + '/county:' + COUNTIES[county]
    if code in {'CC', 'ACC'}:
        return result + '/council_district:' + district
    if code == 'KBC':
        return result + '/budget_committee_district:' + district
    if code == 'RD' and district:
        return result + '/registry_district:' + {'N': 'northern', 'S': 'southern'}[district]
    return result


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in {'script', 'style'}:
            self.skip -= 1
        if tag in {'p', 'div'}:
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.skip:
            self.parts.append(value)


def html_text(path):
    parser = PlainText()
    parser.feed(path.read_text())
    return re.sub(r'[^\S\n]+', ' ', ''.join(parser.parts))


def statutory_members():
    """Parse only whole municipalities. Partial census-block clauses never widen."""
    text = html_text(SOURCES / 'me-county-districts.html')
    counties = re.split(r'Creation of (\w+) County Commissioner Districts\.', text)[1:]
    result = {}
    for county, body in zip(counties[::2], counties[1::2]):
        # Franklin's earlier three districts ended November 5, 2024.
        if county == 'Franklin':
            body = body.split('Beginning November 5, 2024,', 1)[1]
        for district, paragraph in re.findall(r'Commissioner District Number (\d+) (consists of .*?)(?=\n\s*\[PL)', body, re.S):
            quote = ' '.join(('Commissioner District Number ' + district + ' ' + paragraph).split())
            names = []
            if 'following census units' not in paragraph:
                match = re.search(r'consists of the minor civil divisions(?: and unorganized territories)? of (.*?)\. The term', paragraph, re.S)
                if match:
                    names += re.split(r', | and ', match[1])
            else:
                # Whole places before a partial municipality, or after its census list.
                prefix = re.search(r'^consists of the minor civil divisions(?: and unorganized territories)? of (.*?) and the following census units', paragraph, re.S)
                suffix = re.search(r'; and the minor civil divisions of (.*?)\. The term', paragraph, re.S)
                for match in [prefix, suffix]:
                    if match:
                        names += re.split(r', | and ', match[1])
            result[(county.lower(), district)] = {'members': names, 'quote': quote}
    return result


def normalized(value):
    value = re.sub(r'\bSt\.?(?=\s|$)', 'Saint', value.replace('_', ' '), flags=re.I)
    value = re.sub(r'\b(town|city|plantation|township|ut)\b', '', value, flags=re.I)
    return re.sub(r'[^a-z0-9]', '', value.lower())


def memberships():
    divisions = set()
    for shard in ['03', '04']:
        divisions.update(d for d in json.loads((ROOT / f'data/derived/zip-divisions/{shard}.json').read_text())['divisions'] if d.startswith(BASE+'/county:') and '/place:' in d)
    aliases = collections.defaultdict(list)
    for division in divisions:
        county = division.split('/county:')[1].split('/')[0]
        aliases[county, normalized(division.split('/place:')[1])].append(division)
    available = {scope(row) for row in local_rows()}
    output, unresolved = [], []
    for (county, district), record in statutory_members().items():
        target = BASE + '/county:' + county + '/council_district:' + district
        if target not in available:
            continue
        for name in record['members']:
            found = aliases[county, normalized(name)]
            if not found:
                unresolved.append({'county': county, 'district': district, 'name': name})
            for division in found:
                output.append({'memberOcdId': division, 'districtOcdId': target, 'quote': record['quote'], 'sourceFile': 'me-county-districts.html'})
    da_text = ' '.join(html_text(SOURCES / 'me-da-districts.html').split())
    da_counties = {1: ['york'], 2: ['cumberland'], 3: ['oxford', 'franklin', 'androscoggin'],
                   4: ['kennebec', 'somerset'], 5: ['penobscot', 'piscataquis'],
                   6: ['sagadahoc', 'lincoln', 'knox', 'waldo'], 7: ['hancock', 'washington'], 8: ['aroostook']}
    for district, counties in da_counties.items():
        quote = re.search(rf'{district}\. Prosecutorial District Number {district}\. (.*?section 251\s*\.)', da_text)[0]
        for county in counties:
            assert county in quote.lower()
            output.append({'memberOcdId': BASE+'/county:'+county, 'districtOcdId': BASE+'/prosecutorial_district:'+str(district),
                           'quote': quote, 'sourceFile': 'me-da-districts.html'})
    budget = ' '.join(html_text(SOURCES / 'me-knox-budget-districts757.html').split())
    for district, places in [(6, ['Appleton', 'Union', 'Washington']), (8, ['Thomaston', 'Cushing'])]:
        quote = re.search(rf'District {district} consists of .*?elects one member\.', budget)[0]
        for place in places:
            assert place in quote
            for division in aliases['knox', normalized(place)]:
                output.append({'memberOcdId': division, 'districtOcdId': BASE+'/county:knox/budget_committee_district:'+str(district),
                               'quote': quote, 'sourceFile': 'me-knox-budget-districts757.html'})
    return output, unresolved


def metadata(filename):
    meta = json.loads((SOURCES / (filename+'.capture.json')).read_text())
    assert meta['httpStatus'] == 200
    assert meta['rawHash'] == hashlib.sha256((SOURCES / filename).read_bytes()).hexdigest()
    return meta


def provenance(filename, at, quote):
    meta = metadata(filename)
    publisher = 'Maine Legislature' if filename in {'me-county-districts.html', 'me-da-districts.html', 'me-knox-budget-districts757.html', 'me-aroostook-registry-law.html'} else 'Maine Secretary of State, Division of Elections'
    return {'sourceUrl': meta.get('finalUrl', meta.get('url')), 'sourceOrg': publisher,
            'collectedAt': meta['retrievedAt'], 'verifiedAt': at, 'quote': quote}


def update(at):
    path = ROOT / 'data/ballot/2026-general/me.json'
    data = json.loads(path.read_text()); ballot = next(iter(data['ballots'].values()))
    before = len(ballot['contests']), len(ballot['candidacies'])
    source_files = ['me-final-current.xlsx', 'me-special-county-candidates.xlsx', 'me-writeins-2026-10-15.pdf',
                    'me-office-code-order.pdf', 'me-county-office-cycle.pdf', 'me-county-districts.html', 'me-da-districts.html',
                    'me-knox-budget-districts757.html', 'me-aroostook-charter-guide.pdf', 'me-ethics-active-candidates.pdf',
                    'me-aroostook-registry-law.html', 'me-upcoming-index.html']
    for filename in source_files:
        meta = metadata(filename); proof = provenance(filename, at, '')
        source = COMMON.receipt(SOURCES/filename, meta['requestedUrl'], proof['sourceOrg'], meta['retrievedAt'],
            'Actual official HTTP response. Maine source replay checks regular and special candidate lists, October15 write-ins, office titles and whole-division statutory memberships. No residential addresses enter reader records.')
        source['finalUrl'] = meta.get('finalUrl', meta.get('url'))
        COMMON.add_receipt(data, source, at, captured=True)
    rows = local_rows()
    groups = collections.defaultdict(list)
    for row in rows:
        groups[group_key(row)].append(row)
    for (code, district, county), candidates in groups.items():
        contest_id = 'me-sos-2026-local-' + '-'.join(str(x).lower() for x in [code, county, district] if x)
        title = (COUNTIES.get(county, 'knox' if code=='KBC' else 'aroostook').title()+' County '+TITLES[code].removeprefix('County ')) if code != 'DA' else TITLES[code]
        if district:
            title += ' – ' + ({'N':'Northern Registry District', 'S':'Southern Registry District'}.get(district) or 'District '+district)
        quote = ' | '.join(str(v) for v in [code, district, county] if v)
        source = max(candidates, key=lambda r: datetime.datetime.fromisoformat(metadata(r['sourceFile'])['retrievedAt'].replace('Z','+00:00')))['sourceFile']
        proof = provenance(source, at, quote)
        contest = next((c for c in ballot['contests'] if c['id']==contest_id), None)
        if contest is None:
            contest = {'id': contest_id, 'electionId': ballot['election']['id'], 'ocdId': scope(candidates[0]), 'divisionVintage': '2026',
                       'title': title, 'type': 'CANDIDACY', 'voteFor': 2 if code=='ACC' else 1, 'termYears': None, 'scopeNote': None,
                       'candidateListComplete': True}
            ballot['contests'].append(contest)
        contest['provenance'] = proof
        for row in candidates:
            candidate_id = contest_id+':'+re.sub(r'[^a-z0-9]+','-',row['Name'].lower()).strip('-')
            candidate = next((c for c in ballot['candidacies'] if c['id']==candidate_id), None)
            if candidate is None:
                candidate = {'id': candidate_id, 'contestId': contest_id, 'givenName': '', 'familyName': row['Name'],
                             'partyLabel': row.get('Party'), 'slogan': None, 'incumbent': None, 'websiteUrl': None}
                ballot['candidacies'].append(candidate)
            candidate['provenance'] = provenance(row['sourceFile'], at, quote+' | '+row['Name']+(' | '+row['Party'] if row.get('Party') else ''))
    history_path = ROOT / 'data/ballot/reports/ba01-northeast-me-local.json'
    history = json.loads(history_path.read_text()).get('supersedingOfficialValues', []) if history_path.exists() else []
    for row in writein_rows(SOURCES/'me-writeins-2026-10-15.pdf'):
        if row['Office'] in TITLES:
            continue
        candidate = next(c for c in ballot['candidacies'] if COMMON.words(c['givenName']+' '+c['familyName']) == COMMON.words(row['Name']))
        if candidate['partyLabel'] != row['Party']:
            history.append({'candidateId': candidate['id'], 'field': 'partyLabel', 'previousValue': candidate['partyLabel'],
                            'previousProvenance': candidate['provenance'], 'currentValue': row['Party'],
                            'supersedingProvenance': provenance('me-writeins-2026-10-15.pdf', at, row['Name']+' | '+row['Party'])})
        candidate.update(partyLabel=row['Party'], provenance=provenance('me-writeins-2026-10-15.pdf', at, row['Name']+' | '+row['Party']))
        contest = next(c for c in ballot['contests'] if c['id']==candidate['contestId'])
        contest['provenance'] = provenance('me-writeins-2026-10-15.pdf', at, 'Declared Write-in Candidates for the November 3, 2026 General Election')
    member_rows, unresolved = memberships()
    prefix = 'me-2026-membership:'
    ballot['districtMemberships'] = [m for m in ballot.get('districtMemberships', []) if not m['id'].startswith(prefix)] + [
        {'id': prefix+r['memberOcdId'].removeprefix(BASE)+'->'+r['districtOcdId'].removeprefix(BASE),
         'memberOcdId':r['memberOcdId'], 'districtOcdId':r['districtOcdId'], 'provenance':provenance(r['sourceFile'],at,r['quote'])} for r in member_rows]
    ballot['coverageNotes'] = ['Maine state and federal candidate lists include the current October15 declared write-ins. County and other local coverage includes88 contests and108 candidates from regular, special-election and write-in sources.',
        'The official county office-cycle list contains86 county races;85 have named candidates in these sources. Washington County Treasurer still needs sample-ballot confirmation. Municipal contests and local measures remain incomplete.',
        'Whole-municipality commissioner and county prosecutorial memberships are included. Partial census-block districts and Aroostook registry address matching remain open.']
    report = {'state':'ME','before':before,'after':(len(ballot['contests']),len(ballot['candidacies'])), 'localContests':len(groups),'localCandidacies':len(rows),
              'countyOfficeCycleContests':86,'namedCountyContests':85,'remainingCycleOffice':'Washington County Treasurer',
              'districtMemberships':len(member_rows),'unresolvedCanonicalPlaces':unresolved,'supersedingOfficialValues':history,
              'sources':[{**metadata(filename),'sourceFile':filename} for filename in source_files],
              'remaining':'Municipal contests and questions, partial census-block memberships, Aroostook registry matching and live delivery remain open.'}
    return path,data,report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    path,data,report=update(datetime.datetime.now(datetime.timezone.utc).isoformat())
    if args.write:
        path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
        (ROOT/'data/ballot/reports/ba01-northeast-me-local.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report))
