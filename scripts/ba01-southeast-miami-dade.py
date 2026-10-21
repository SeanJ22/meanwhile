"""Replay Miami-Dade's complete official November 3, 2026 master ballot.

Only exact districts, county-wide and independently established municipal scopes are projected.
Run --captures DIR [--write]; captured originals and SHA256 metadata are required.
"""
import argparse
import gzip
import hashlib
import json
import html
import pathlib
import re
import subprocess
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]


def captured(folder, key):
    file = folder / key
    raw = file.read_bytes() if file.exists() else gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    return raw, meta


def captured_text(folder, key):
    converted = folder / (key + '.layout.txt.gz')
    if converted.exists():
        meta = json.loads((folder / (key + '.meta.json')).read_text())
        raw = gzip.decompress(converted.read_bytes())
        assert hashlib.sha256(raw).hexdigest() == meta['convertedTextHash'] and meta['httpStatus'] == 200
        return raw.decode(), meta
    raw, meta = captured(folder, key)
    if raw.startswith(b'%PDF'):
        return subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode(), meta
    return html.unescape(re.sub('<[^>]+>', ' ', raw.decode())), meta


def normalized(value):
    return re.sub('[^a-z0-9]', '', value.lower())


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    raw, meta = captured(folder, 'fl-miami-master')
    text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode()
    pages = text.split('\f')
    assert len(pages) == 74 and 'November 3, 2026' in pages[0] and 'Page 73 of 73' in pages[72]
    registry = json.loads((ROOT / 'data/derived/registration/fl.json').read_text())['divisions']
    places = {normalized(re.sub(r' (city|town|village)$', '', d[3])): d[0] for d in registry if d[1] == 'place' and re.search(r' (city|town|village)$', d[3])}
    county = 'ocd-division/country:us/state:fl/county:miami_dade'
    assert any(d[0] == county for d in registry)
    old = [len(ballot[k]) for k in ['contests', 'candidacies', 'measures']]
    existing = {(c['ocdId'], c['title']) for c in ballot['contests']}
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Miami-Dade County Supervisor of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}

    def contest(division, title, kind, seats, quote):
        if (division, title) in existing:
            return None
        ident = 'fl-miami-dade-2026-' + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:20]
        row = {'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'OCD_CURRENT' if any(part in division for part in ['/council_district:', '/school_board_district:']) else 'TIGER_GENZ2025', 'title': title, 'type': kind, 'voteFor': seats, 'termYears': None, 'scopeNote': None, 'provenance': {**provenance, 'quote': quote}}
        if kind == 'CANDIDACY':
            row['candidateListComplete'] = True
        else:
            row['measureTextUrl'] = meta['finalUrl']
        ballot['contests'].append(row)
        existing.add((division, title))
        return ident

    measures = []
    extra_blocks = {26: 2, 27: 2, 32: 2, 33: 2, 36: 2, 53: 3, 64: 2, 65: 2, 66: 2, 67: 2, 68: 2, 69: 2}
    for page_num in range(19, 74):
        page = re.sub(r'^\s*FINAL\s*\n', '', pages[page_num - 1])
        blocks = [b.strip() for b in re.split(r'\n\s*\n', page) if b.strip()]
        heading = blocks[0].splitlines()[0].strip()
        title = ' '.join(blocks[1].split())
        count = extra_blocks.get(page_num, 1)
        question = '\n\n'.join(' '.join(b.split()) for b in blocks[2:2 + count])
        assert question.endswith('?'), (page_num, question)
        assert not any(x in question for x in ['¿', 'Èske', 'Enmienda a la Carta'])
        if heading.startswith('County Referendum'):
            division = county
            title = 'Miami-Dade County — ' + heading + ' — ' + title
        elif heading == 'School Board Referendum':
            division = county
            title = 'Miami-Dade County — School Board Referendum — ' + title
        else:
            place = heading.split(' Referendum')[0]
            division = places[normalized(place)]
            title = heading + ' — ' + title
        measures.append((division, title, question, page_num))
        ident = contest(division, title, 'MEASURE', 1, heading + ' | ' + title)
        if ident:
            ballot['measures'].append({'id': ident + ':question', 'contestId': ident, 'questionText': question, 'officialStatement': None, 'provenance': {**provenance, 'quote': f'Master ballot page {page_num} of 73'}})
    assert len(measures) == 55 and sum(d == county for d, *_ in measures) == 7
    # The same official question explicitly establishes the present at-large
    # Palmetto Bay electorate and proposes switching to districts in 2028/2030.
    assert any('The Charter currently provides at large elections for Mayor, Vice Mayor, and Councilmembers.' in q for _, _, q, _ in measures)

    # A single circuit comprises Miami-Dade County, confirmed by Florida statute.
    statute, statute_meta = captured(folder, 'fl-circuit-statute')
    statute_text = ' '.join(re.sub('<[^>]+>', ' ', statute.decode()).split())
    assert re.search(r'eleventh circuit is composed of Miami-Dade County', statute_text, re.I)
    safe_councils = {'Biscayne Park - Commissioner', 'Key Biscayne - Village Council', 'Medley - for Council Member', 'Opa-locka - Commissioners', 'Virginia Gardens - Council', 'Palmetto Bay - Councilmember - Seat 1', 'Palmetto Bay - Councilmember - Seat 3'}
    scope_sources = []
    for scope_key, municipality, proof in [
        ('fl-doral-atlarge', 'Doral', 'All Members of the Council are elected at-large'),
        ('fl-coral-commission', 'Coral Gables', 'These city-wide elections'),
        ('fl-hialeah-atlarge', 'Hialeah', 'The Council members are elected at large'),
        ('fl-sunny-isles-atlarge', 'Sunny Isles Beach', 'Each Commissioner is elected “at large”'),
        ('fl-pinecrest-charter', 'Pinecrest', 'Each Councilmember and the Mayor shall be elected at-large'),
        ('fl-cutler-charter', 'Cutler Bay', 'the mayor, vice-mayor and each council member shall be elected at-large'),
        ('fl-south-miami-atlarge', 'South Miami', 'All elected officials are elected "at large"'),
        ('fl-nmb-audit', 'North Miami Beach', 'They are elected at large by all qualified electors of the City.')]:
        scope_text, scope_meta = captured_text(folder, scope_key)
        assert proof in ' '.join(scope_text.split()), municipality
        scope_sources.append((scope_meta, municipality))
    canonical, _ = captured(folder, 'ocd-fl-county')
    district_scopes = {}
    district_sources = []
    for title, suffix, key, proof, publisher in [
        ('County Commissioner, District 5', 'council_district:5', 'fl-dade-commission5-map', 'COMMISSION DISTRICT 5', 'Miami-Dade County Government'),
        ('School Board Member, District 1', 'school_board_district:1', 'fl-dade-school1-map', 'School Board District 1', 'Miami-Dade County Public Schools')]:
        division = 'ocd-division/country:us/state:fl/county:miami-dade/' + suffix
        assert division + ',' in canonical.decode()
        scope_text, scope_meta = captured_text(folder, key)
        assert normalized(proof) in normalized(scope_text)
        district_scopes[title] = division
        district_sources.append((scope_meta, publisher, proof))
    lines = text.splitlines()
    official_local = []
    added_candidate_scopes = Counter()
    skipped = []
    for i, line in enumerate(lines):
        if not line.strip().startswith('(Vote for'):
            continue
        start = i - 1
        while start >= 0 and lines[start].strip():
            start -= 1
        header = [h.strip() for h in lines[start + 1:i] if h.strip()]
        if not header:
            continue
        rows, j = [], i + 1
        while j < len(lines):
            if re.fullmatch(r'\s*Page \d+ of 73\s*', lines[j]) or lines[j].strip() == 'FINAL':
                j += 1
                continue
            match = re.fullmatch(r'\s*(.+?)\s{2,}(\d{2,3})\s*', lines[j])
            if match:
                rows.append((match[1], int(match[2])))
            elif rows and lines[j].strip():
                break
            j += 1
        if not rows or min(n for _, n in rows) < 86:
            continue
        title = header[0]
        if title == 'Circuit Judge, 11th Judicial Circuit':
            group = next(h.split(' / ')[0] for h in header if h.startswith('Group '))
            title += ' — ' + group
        elif title.endswith(' - Residential Area'):
            title += ' ' + header[1]
        official_local.append((title, rows))
        division = None
        if title in district_scopes:
            division = district_scopes[title]
        elif title.startswith('Circuit Judge, 11th Judicial Circuit'):
            division = county
        elif title.endswith(' - Mayor') or ' - for Mayor - ' in title or title in safe_councils or any(title.startswith(city + ' - ') for city in ['Doral', 'Coral Gables', 'Hialeah', 'Sunny Isles Beach', 'Pinecrest', 'Cutler Bay', 'South Miami', 'North Miami Beach']):
            division = places[normalized(title.split(' - ')[0])]
        if division is None:
            skipped.append({'title': title, 'candidacies': len(rows)})
            continue
        seats = int(re.search(r'Vote for (?:up to )?(\d+)', line)[1])
        ident = contest(division, title, 'CANDIDACY', seats, title + ' | ' + line.strip())
        if ident:
            for name, number in rows:
                ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': None, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': title + ' | ' + name + ' | ballot selection ' + str(number)}})
            added_candidate_scopes[division] += len(rows)
    assert len(official_local) == 45, (len(official_local), sum(len(r) for _, r in official_local))
    assert sum(len(r) for _, r in official_local) == 116, sum(len(r) for _, r in official_local)
    if any(len(ballot[k]) > before for k, before in zip(['contests', 'candidacies', 'measures'], old)):
        for source_meta, publisher, source_class, reviewed in [
            (meta, 'Miami-Dade County Supervisor of Elections', 'ELECTION_AUTHORITY', 'Replayed all 55 complete local referendum questions from official master pages 19–73, exact printed local candidate names and vote limits. Only established county-wide, municipal mayor and at-large scopes projected; district or residential-area offices remain separate.'),
            (statute_meta, 'Florida Legislature', 'OFFICIAL_PUBLISHER', 'Florida Statutes 26.021 states that the eleventh judicial circuit is composed of Miami-Dade County.')] + [(m, city + ' municipal government', 'OFFICIAL_PUBLISHER', 'The official municipal government or charter expressly establishes that all councilmembers or commissioners are elected at large, including seats with candidate residential-area requirements.') for m, city in scope_sources] + [(m, publisher, 'OFFICIAL_PUBLISHER', 'Official current map establishes ' + proof + '; the exact canonical OCD division is separately checked against the saved registry. No district contest is widened to the county.') for m, publisher, proof in district_sources]:
            receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max([package['sourceReceipt']['reviewedAt'], meta['retrievedAt'], statute_meta['retrievedAt']] + [m['retrievedAt'] for m, _ in scope_sources] + [m['retrievedAt'] for m, _, _ in district_sources])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Miami-Dade full official master ballot replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'FL', 'added': dict(zip(['contests', 'candidacies', 'measures'], [len(ballot[k]) - before for k, before in zip(['contests', 'candidacies', 'measures'], old)])), 'officialLocalCandidateContests': len(official_local), 'officialLocalPrintedCandidacies': sum(len(r) for _, r in official_local), 'officialLocalQuestions': len(measures), 'remainingLocalCandidateContests': skipped, 'addedCandidateScopes': dict(added_candidate_scopes)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
