"""Replay Fulton County's official general ballot without widening its TSPLOST."""
import argparse
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def replay(folder, write=False):
    source_file = folder / 'ga-fulton-sample'
    raw = source_file.read_bytes() if source_file.exists() else gzip.decompress((folder / 'ga-fulton-sample.gz').read_bytes())
    meta = json.loads((folder / 'ga-fulton-sample.meta.json').read_text())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    text = subprocess.check_output(['pdftotext', '-layout', '-', '-'], input=raw).decode()
    assert 'November 3, 2026 General Special Election' in text
    path = ROOT / 'data/ballot/2026-general/ga.json'
    package = json.loads(path.read_text())
    ballot = next(iter(package['ballots'].values()))
    registry = json.loads((ROOT / 'data/derived/registration/ga.json').read_text())['divisions']
    county = 'ocd-division/country:us/state:ga/county:fulton'
    sandy = 'ocd-division/country:us/state:ga/place:sandy_springs'
    palmetto = 'ocd-division/country:us/state:ga/place:palmetto'
    assert all(any(r[0] == division for r in registry) for division in [county, sandy, palmetto])
    old = {k: len(ballot[k]) for k in ['contests', 'candidacies', 'measures']}
    existing = {(row['ocdId'], row['title']) for row in ballot['contests']}
    provenance = {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Fulton County Department of Registration and Elections', 'collectedAt': meta['retrievedAt'], 'verifiedAt': meta['retrievedAt']}
    title = 'Fulton County Commission Chairperson'
    if (county, title) not in existing:
        section = text.split('For County Commission Chairperson', 1)[1].split('For County Commissioner', 1)[0]
        names = re.findall(r'([^\n]+?)\s+[–-]\s+(Republican|Democrat)', section)
        assert [(n.strip(), p) for n, p in names] == [('Eric J. Tatum', 'Republican'), ('Mo Ivory', 'Democrat')]
        ident = 'ga-fulton-2026-commission-chair'
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': county, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'CANDIDACY', 'voteFor': 1, 'termYears': None, 'candidateListComplete': True, 'scopeNote': None, 'provenance': {**provenance, 'quote': title}})
        for name, party in names:
            name = name.strip()
            ballot['candidacies'].append({'id': ident + ':' + hashlib.sha256(name.encode()).hexdigest()[:16], 'contestId': ident, 'givenName': '', 'familyName': name, 'partyLabel': party, 'slogan': None, 'incumbent': None, 'websiteUrl': None, 'provenance': {**provenance, 'quote': ' | '.join([title, name, party])}})
    pages = text.split('\f')
    education_pages = [p for p in pages if 'Educational Special Purpose Local Option Sales and Use Tax (ESPLOST)' in p]
    assert len(education_pages) == 1
    education = ' '.join(education_pages[0].split('Shall the special one percent', 1)[1].split())
    education = 'Shall the special one percent ' + education
    assert education.endswith('APS Projects located in Fulton County.')
    assert '$2,095,680,577.00' in education and '$350,000,000.00' in education
    source_sections = [
        (county, 'Fulton County — Educational Special Purpose Local Option Sales and Use Tax (ESPLOST)', education),
        (sandy, 'City of Sandy Springs — Redevelopment Powers', ' '.join(text.split('City of Sandy Springs Redevelopment Powers', 1)[1].split('City of Palmetto Ad Valorem Tax Exemption', 1)[0].split()).removeprefix('Yes or No ')),
        (palmetto, 'City of Palmetto — Ad Valorem Tax Exemption', ' '.join(text.split('City of Palmetto Ad Valorem Tax Exemption', 1)[1].split('\f', 1)[0].split()).removeprefix('Yes or No ')),
    ]
    assert source_sections[1][2].startswith('Shall the Act be approved') and source_sections[1][2].endswith('time to time.')
    assert source_sections[2][2].startswith('Shall persons who are 65 years') and source_sections[2][2].endswith('48-5-48.3?')
    for division, title, question in source_sections:
        if (division, title) in existing:
            continue
        ident = 'ga-fulton-2026-measure-' + hashlib.sha256(json.dumps([division, title]).encode()).hexdigest()[:16]
        ballot['contests'].append({'id': ident, 'electionId': ballot['election']['id'], 'ocdId': division, 'divisionVintage': 'TIGER_GENZ2025', 'title': title, 'type': 'MEASURE', 'measureTextUrl': meta['finalUrl'], 'voteFor': 1, 'termYears': None, 'scopeNote': None, 'provenance': {**provenance, 'quote': title}})
        ballot['measures'].append({'id': ident + ':question', 'contestId': ident, 'questionText': question, 'officialStatement': None, 'provenance': provenance})
    added = {key: len(ballot[key]) - before for key, before in old.items()}
    if any(added.values()):
        package['sourceReceipt']['sources'].append({'requestedUrl': meta['url'], 'finalUrl': meta['finalUrl'], 'publisher': provenance['sourceOrg'], 'sourceClass': 'ELECTION_AUTHORITY', 'retrievedAt': meta['retrievedAt'], 'httpStatus': 200, 'rawHash': meta['rawHash'], 'reviewedEvidence': 'Exact chairperson candidates and three full questions replayed from the county consolidated general/special sample. Education tax and associated school debt cover the Fulton County electorate; the two municipal questions use exact city divisions. The transportation tax explicitly excludes Atlanta and is not widened to county scope. District commission seats, registered write-ins and soil/water district remain separate coverage work.'})
        package['sourceReceipt']['reviewedAt'] = meta['retrievedAt']
        package['sourceReceipt']['reviewedBy'] = 'BA-01 Fulton County consolidated official sample replay'
        if write:
            path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
    return {'state': 'GA', 'county': 'Fulton', 'added': added, 'remaining': 'Four commission-district races, their two registered district-5 write-ins, the soil/water district race and the Atlanta-excluding transportation tax remain scoped acquisition work.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--captures', type=pathlib.Path, required=True)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    print(json.dumps(replay(args.captures, args.write), indent=2))
