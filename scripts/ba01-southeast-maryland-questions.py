"""Replay every remaining Maryland county question from every certified ballot style.

The web question index identifies each question; the certified sample supplies the
complete wording and printed title where the index abbreviates or mistitles it.
"""
import argparse
import gzip
import hashlib
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
COUNTIES = {
    'Baltimore County': ('BaltimoreCounty', 'ABCDEFGHIJKLMN'),
    'Baltimore City': ('BaltimoreCity', 'ABCDEFGHI'),
    'Anne Arundel': ('AnneArundel', 'ABC'),
    'Howard': ('Howard', 'AB'),
    'Frederick': ('Frederick', 'A'),
    'Wicomico': ('Wicomico', 'ABCD'),
    'Cecil': ('Cecil', 'A'),
    'Dorchester': ('Dorchester', 'ABCD'),
}


def normalized(text):
    return re.sub('[^a-z0-9]', '', text.lower())


def capture(folder, key, converted=False):
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    suffix = '.raw.txt.gz' if converted else '.gz'
    direct = folder / key
    raw = gzip.decompress((folder / (key + suffix)).read_bytes()) if converted or not direct.exists() else direct.read_bytes()
    assert meta['httpStatus'] == 200
    assert hashlib.sha256(raw).hexdigest() == meta['convertedTextHash' if converted else 'rawHash']
    return raw, meta


def start_in_raw(text, prefix):
    positions = [i for i, ch in enumerate(text) if ch.lower() in 'abcdefghijklmnopqrstuvwxyz0123456789']
    flat = ''.join(text[i].lower() for i in positions)
    target = normalized(prefix)[:80]
    assert len(target) >= 7 and flat.count(target) == 1, target
    position = positions[flat.index(target)]
    if prefix.startswith('#') and position > 0 and text[position - 1] == '#':
        position -= 1
    return position


def style_questions(style, expected, prefixes):
    # Headers can be printed between two question columns. Remove only ballot
    # furniture; the wording and its explanatory for/against paragraphs stay.
    clean = re.sub(r'Official Ballot\nGubernatorial General Election\nNovember 3, 2026\nState of Maryland, [^\n]+\nBS \d+\n[^\n]+\nPage \d+ of \d+\n', '', style)
    clean = re.sub(r'(?m)^(?:Vote All Sides|End of Ballot)\s*$', '', clean)
    headings = list(re.finditer(r'(?m)^Question ([A-Z])\s*$', clean))
    assert ''.join(m[1] for m in headings) == expected
    result = {}
    for i, heading in enumerate(headings):
        code = heading[1]
        block = clean[heading.end():headings[i + 1].start() if i + 1 < len(headings) else len(clean)]
        body_start = start_in_raw(block, prefixes[code])
        title_lines = [line.strip() for line in block[:body_start].splitlines() if line.strip()]
        assert title_lines[0] in ('Charter Amendment', 'County Ordinance', 'Bond Issue'), title_lines
        title = ' '.join(line for line in title_lines[1:] if not re.fullmatch(r'\(Bill [^)]+\)', line))
        body = block[body_start:].strip()
        # Remove the two selectable choices, retaining every preceding word.
        choices = re.search(r'\nFor(?: the Charter Amendment)?\nAgainst(?: the Charter Amendment)?\s*$', body)
        assert choices, (code, body[-200:])
        body = ' '.join(body[:choices.start()].split())
        assert body and 'Official Ballot' not in body and 'End of Ballot' not in body
        result[code] = {'title': title, 'body': body}
    return result


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/md.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    index_raw, index_meta = capture(folder, 'md-questions')
    index = html.unescape(index_raw.decode())
    registry = json.loads((ROOT / 'data/derived/registration/md.json').read_text())['divisions']
    divisions = {normalized(row[3].removesuffix(' County')): row[0] for row in registry if row[1] == 'county'}
    existing = {row['id'] for row in ballot['contests']}
    old = {key: len(ballot[key]) for key in ['contests', 'measures']}
    verified, sources, differences = {}, [], []
    for county, (file, expected) in COUNTIES.items():
        section = re.search(r'<summary>' + re.escape(county) + r'</summary>(.*?)</details>', index, re.S)[1]
        rows = re.findall(r'<h2[^>]*>\s*Question\s+([A-Z])\s*</h2>(.*?)(?=<h2[^>]*>\s*Question|$)', section, re.S | re.I)
        assert ''.join(code for code, _ in rows) == expected
        prefixes, index_titles = {}, {}
        for code, body in rows:
            english = body.split('<div lang="es">')[0]
            paragraphs = [' '.join(re.sub('<[^>]+>', ' ', p).split()) for p in re.findall(r'<p[^>]*>(.*?)</p>', english, re.S)]
            start = 3 if county == 'Anne Arundel' else 2
            prefixes[code] = paragraphs[start]
            index_titles[code] = paragraphs[start - 1]
        sample_raw, meta = capture(folder, 'md-question-' + file, True)
        text = sample_raw.decode().replace('\x0c', '\n')
        headers = list(re.finditer(r'Official Ballot\n.{0,200}?BS (\d+)\n', text, re.S))
        starts = [m for i, m in enumerate(headers) if i == 0 or m[1] != headers[i - 1][1]]
        assert len(starts) == text.count('End of Ballot')
        styles = [text[m.start():starts[i + 1].start() if i + 1 < len(starts) else len(text)] for i, m in enumerate(starts)]
        parsed = [style_questions(style, expected, prefixes) for style in styles]
        questions = parsed[0]
        for style in parsed[1:]:
            assert {code: normalized(json.dumps(value)) for code, value in style.items()} == {code: normalized(json.dumps(value)) for code, value in questions.items()}, county
        county_name = county if county.startswith('Baltimore') else county + ' County'
        division = divisions[normalized(county.removesuffix(' County'))]
        verified[county_name] = {'styles': len(styles), 'questions': len(expected), 'matchedQuestions': len(expected)}
        provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Maryland State Board of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
        sources.append(meta)
        for code, row in questions.items():
            if normalized(row['title']) != normalized(index_titles[code]):
                differences.append({'county': county_name, 'question': code, 'indexTitle': index_titles[code], 'certifiedBallotTitle': row['title'], 'selectedSource': meta['finalUrl']})
            ident = 'md-county-questions-2026-' + file.lower() + '-' + code.lower()
            if ident in existing:
                continue
            title = county_name + ' — Question ' + code + ' — ' + row['title']
            ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'MEASURE', 'measureTextUrl': meta['finalUrl'], 'voteFor': 1, 'termYears': None, 'scopeNote': None, 'provenance': {**provenance, 'quote': 'Question ' + code + ' | ' + row['title'] + f' | Identical wording appears on all {len(styles)} county ballot styles.'}})
            ballot['measures'].append({'id': ident + ':question', 'contestId': ident, 'questionText': row['body'], 'officialStatement': None, 'provenance': provenance})
    added = {key: len(ballot[key]) - count for key, count in old.items()}
    if any(added.values()):
        for meta in sources + [index_meta]:
            receipt = {'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'], 'publisher': 'Maryland State Board of Elections', 'sourceClass': 'ELECTION_AUTHORITY', 'retrievedAt': meta['retrievedAt'], 'httpStatus': 200, 'rawHash': meta['rawHash'], 'reviewedEvidence': 'All county questions replayed with full certified ballot wording, including explanatory for/against paragraphs. Question lists, exact printed titles, and identical wording verified across every certified county ballot style; county question index cross-checked. Printed ballot controls where index abbreviates or mistitles a question.'}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max([package['sourceReceipt']['reviewedAt']] + [m['retrievedAt'] for m in sources + [index_meta]])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 all Maryland county questions certified ballot replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'MD', 'added': added, 'verifiedCounties': verified, 'countyQuestionsStatewide': 48, 'previouslyVerifiedPrinceGeorgesQuestions': 10, 'titleSourceDifferences': differences, 'wordingSourceDifferences': ['Baltimore County A: certified ballot prints "five (5)" where the question index prints "5".', 'Baltimore County F: certified ballot includes the full refuse-facility project list omitted by the question index.', 'Baltimore County I: question index contains a stray #6 before the FOR explanation; certified ballot has no #6.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
