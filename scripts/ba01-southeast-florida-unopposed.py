"""Reconcile certified Florida roster entries with printed ballot law, preserving rows."""
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
CORE_CODES = {'STR', 'STS', 'USR', 'USS', 'GOV', 'ATG', 'CFO', 'AGR', 'SCJ'}


def capture(folder, key):
    raw = gzip.decompress((folder / (key + '.gz')).read_bytes())
    meta = json.loads((folder / (key + '.meta.json')).read_text())
    assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
    return raw, meta


def replay(folder, write=False):
    raw, meta = capture(folder, 'fl-11')
    rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig')), delimiter='\t'))
    core = [row for row in rows if row['OfficeCode'] in CORE_CODES and row['StatusCode'] in {'QUA', 'UNO'}]
    unopposed = [row for row in core if row['StatusCode'] == 'UNO']
    assert len(unopposed) == 31
    assert {code: sum(row['OfficeCode'] == code for row in unopposed) for code in ['STR', 'STS', 'USR']} == {'STR': 28, 'STS': 2, 'USR': 1}
    law_raw, law_meta = capture(folder, 'fl-ballot-statute')
    law = ' '.join(html.unescape(re.sub('<[^>]+>', ' ', law_raw.decode())).split())
    law_quote = 'Except for justices or judges seeking retention, the names of unopposed candidates shall not appear on the general election ballot.'
    assert law_quote in law
    path = ROOT / 'data/ballot/2026-general/fl.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    note = 'Certified unopposed. Florida law excludes unopposed candidates from the general-election ballot except justices or judges seeking retention (Fla. Stat. §101.151(7)).'
    evidence = []
    for row in unopposed:
        candidate = next(c for c in ballot['candidacies'] if c['id'] == 'fl-doe-2026-general-candidate-' + row['AcctNum'])
        contest = next(c for c in ballot['contests'] if c['id'] == candidate['contestId'])
        assert contest.get('scopeNote') in [None, note]
        assert candidate['partyLabel'] == row['PartyCode']
        contest['scopeNote'] = note
        quote = ' | Certified candidate status: Unopposed (UNO). Florida Statutes 101.151(7): ' + law_quote + ' Source: ' + law_meta['finalUrl']
        if quote not in contest['provenance']['quote']:
            contest['provenance']['quote'] += quote
        contest['provenance']['verifiedAt'] = max(contest['provenance']['verifiedAt'], meta['retrievedAt'], law_meta['retrievedAt'])
        evidence.append({'contestId': contest['id'], 'candidateId': candidate['id'], 'title': contest['title'], 'name': ' '.join(filter(None, [candidate['givenName'], candidate['familyName']])), 'partyLabel': candidate['partyLabel'], 'sourceStatus': row['StatusDesc'], 'printedOnGeneralBallot': False})
    for source_meta, publisher, source_class, reviewed in [
        (meta, 'Florida Division of Elections', 'ELECTION_AUTHORITY', 'Certified general roster contains 31 unopposed core entries: 28 State House, two State Senate, and one U.S. House. These certified records are preserved, with explicit unopposed context; the roster is not a printed-ballot denominator.'),
        (law_meta, 'Florida Legislature', 'OFFICIAL_PUBLISHER', 'Florida Statutes 101.151(7) explicitly excludes unopposed candidates, except justices or judges seeking retention, from the general election ballot. No certified record is deleted or hidden.'),
    ]:
        receipt = {'requestedUrl': source_meta['url'], 'finalUrl': source_meta['finalUrl'], 'publisher': publisher, 'sourceClass': source_class, 'retrievedAt': source_meta['retrievedAt'], 'httpStatus': 200, 'rawHash': source_meta['rawHash'], 'reviewedEvidence': reviewed}
        if receipt not in package['sourceReceipt']['sources']:
            package['sourceReceipt']['sources'].append(receipt)
    package['sourceReceipt']['reviewedAt'] = max(package['sourceReceipt']['reviewedAt'], law_meta['retrievedAt'])
    result = {'state': 'FL', 'scope': 'Certified federal, statewide and legislative roster. Counts 175 contests / 372 candidacies are certified-roster counts, not printed sample-ballot denominators.', 'unopposedCoreContests': 31, 'unopposedCoreCandidacies': 31, 'unopposedByOffice': {'State House': 28, 'State Senate': 2, 'U.S. House': 1}, 'law': {'url': law_meta['finalUrl'], 'quote': law_quote}, 'rosterUrl': meta['finalUrl'], 'preservation': 'Every existing contest, candidate and ID remains present. Explicit scope notes explain the unopposed records.', 'records': sorted(evidence, key=lambda row: row['contestId'])}
    if write:
        path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
        (ROOT / 'data/ballot/ba01-southeast-florida-unopposed.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    result = replay(args.captures, args.write)
    print(json.dumps({key: value for key, value in result.items() if key != 'records'}, indent=2))
