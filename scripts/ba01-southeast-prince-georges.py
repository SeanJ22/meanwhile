"""Replay county-wide Prince George's races and questions from official sources."""
import argparse
import csv
import gzip
import hashlib
import html
import io
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]


def captured(folder, key, converted=False):
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    suffix = '.layout.txt.gz' if converted else '.gz'
    raw = gzip.decompress((folder / (key + suffix)).read_bytes()) if not (folder / key).exists() or converted else (folder / key).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == meta['convertedTextHash' if converted else 'rawHash'] and meta['httpStatus'] == 200
    return raw, meta


def replay(folder, write=False):
    path = ROOT / 'data/ballot/2026-general/md.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    raw, meta = captured(folder, 'md-questions')
    sample_raw, sample_meta = captured(folder, 'md-pg', True)
    sample = sample_raw.decode()
    assert sample.count('End of Ballot') == 327
    division = 'ocd-division/country:us/state:md/county:prince_george_s'
    assert any(r[0] == division and r[3] == "Prince George's County" for r in json.loads((ROOT / 'data/derived/registration/md.json').read_text())['divisions'])
    old = {k: len(ballot[k]) for k in ['contests', 'candidacies', 'measures']}
    existing = {(c['ocdId'], c['title']) for c in ballot['contests']}
    section = re.search(r"<summary>Prince George's</summary>(.*?)</details>", raw.decode(), re.S)[1]
    questions = re.findall(r'<h2>Question ([A-Z])</h2>(.*?)(?=<h2>Question|$)', section, re.S)
    assert [code for code, _ in questions] == list('ABCDEFGHIJ')
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Maryland State Board of Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    for code, body in questions:
        assert sample.count('Question ' + code) == 327
        english = body.split('<div lang="es">')[0]
        paragraphs = [' '.join(html.unescape(re.sub('<[^>]+>', ' ', p)).split()) for p in re.findall(r'<p>(.*?)</p>', english, re.S)]
        assert len(paragraphs) == 4
        title = f"Prince George's County — Question {code} — {paragraphs[1]}"
        if (division, title) in existing:
            continue
        ident = 'md-prince-georges-2026-question-' + code.lower()
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'MEASURE', 'measureTextUrl': meta['finalUrl'], 'voteFor': 1, 'termYears': None, 'scopeNote': None, 'provenance': {**provenance, 'quote': 'Question ' + code + ' | ' + paragraphs[1]}})
        ballot['measures'].append({'id': ident + ':question', 'contestId': ident, 'questionText': paragraphs[2], 'officialStatement': paragraphs[3], 'provenance': provenance})
    candidate_raw, candidate_meta = captured(folder, 'md-30')
    candidates = [r for r in csv.DictReader(io.StringIO(candidate_raw.decode('utf-8-sig'))) if r['Office Name'] == 'Judge of the Circuit Court' and r['Candidate Residential Jurisdiction'] == "Prince George's County" and r['Candidate Status'] == 'Active']
    assert len(candidates) == 9 and sample.count('Vote for up to 9') == 327
    for row in candidates:
        name = (row['Candidate First Name and Middle Name'] + ' ' + row['Candidate Ballot Last Name and Suffix']).strip()
        assert sample.count(name) == 327, name
    title = "Judge of the Circuit Court — Circuit 7, Prince George's County"
    if (division, title) not in existing:
        ident = 'md-prince-georges-2026-circuit-7'
        candidate_provenance = {'sourceUrl': candidate_meta['finalUrl'], 'sourceOrg': 'Maryland State Board of Elections', 'collectedAt': candidate_meta['retrievedAt'], 'verifiedAt': candidate_meta['retrievedAt']}
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'CANDIDACY', 'voteFor': 9, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**candidate_provenance, 'quote': 'All nine named judges appear in all 327 official county ballot styles; vote for up to nine.'}})
        for row in candidates:
            name = (row['Candidate First Name and Middle Name'] + ' ' + row['Candidate Ballot Last Name and Suffix']).strip()
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': row['Candidate First Name and Middle Name'], 'familyName': row['Candidate Ballot Last Name and Suffix'], 'partyLabel': row['Office Political Party'] or None, 'slogan': 'Declared write-in' if row['Filing Type and Date'].startswith('Write-In') else None, 'incumbent': None, 'websiteUrl': row['Website'] or None, 'provenance': {**candidate_provenance, 'quote': title + ' | ' + name}})
    added = {key: len(ballot[key]) - before for key, before in old.items()}
    if any(added.values()):
        for source_meta, reviewed in [(meta, 'All ten English county questions and official explanatory statements replayed. Each question appears on all 327 certified county ballot styles.'), (sample_meta, 'All ten county questions and all nine Circuit 7 candidates appear in every one of the 327 certified Prince George\'s ballot styles. No district election was widened.'), (candidate_meta, 'All nine active Circuit 7 candidate rows replayed with equal fields and exact stated party/category and website values.')]:
            receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': 'Maryland State Board of Elections', 'sourceClass': 'ELECTION_AUTHORITY', 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
            if receipt not in package['sourceReceipt']['sources']:
                package['sourceReceipt']['sources'].append(receipt)
        package['sourceReceipt']['reviewedAt'] = max(m['retrievedAt'] for m in [meta, sample_meta, candidate_meta])
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Prince Georges certified ballot and question replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'MD', 'county': "Prince George's", 'added': added, 'verifiedBallotStyles': 327, 'countyQuestions': 10, 'countyCircuitCandidates': 9}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
