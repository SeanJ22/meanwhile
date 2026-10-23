"""Bind held Michigan court electorates to the state's statutory jurisdictions.

This compiles ballot data only. County subdivisions use the same Census IDs as
the ZIP index; a split county never becomes a whole-county membership.
"""
import argparse
import copy
import gzip
import hashlib
import json
import re
import runpy
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 'ocd-division/country:us/state:mi/'
EVIDENCE = ROOT / 'data/ballot/evidence/ba01-great-lakes'
MANUAL = ROOT / 'data/ballot/evidence/bl02-mi'
COMMON = runpy.run_path(str(ROOT / 'scripts/ba01-great-lakes-mi-judicial.py'))
NOW = datetime.now(timezone.utc).isoformat()


def norm(value):
    value = value.lower().replace('saint ', 'st ').replace('mt. ', 'mount ')
    return re.sub(r'[^a-z0-9]+', '_', value).strip('_')


def names(value):
    return [x.strip() for x in re.split(r',\s*(?:and )?|\s+and\s+', value) if x.strip()]


def source(stem, directory=EVIDENCE):
    meta = json.loads((directory / (stem + '.retrieval.json')).read_text())
    file = directory / (stem + ('.pdf.gz' if directory == MANUAL else '.raw.gz'))
    raw = gzip.decompress(file.read_bytes())
    assert hashlib.sha256(raw).hexdigest() == meta['rawHash'] and meta['httpStatus'] == 200
    with tempfile.TemporaryDirectory() as tmp:
        pdf = Path(tmp) / 'source.pdf'
        pdf.write_bytes(raw)
        text = subprocess.run(['pdftotext', '-raw' if directory == MANUAL else '-layout', str(pdf), '-'], check=True, capture_output=True, text=True).stdout
    return meta, COMMON['sections'](text), text


def main(write=False):
    path = ROOT / 'data/ballot/2026-general/mi.json'
    document = json.loads(path.read_text())
    ballot = next(iter(document['ballots'].values()))
    before = copy.deepcopy(ballot)
    indexed = set()
    for prefix in ['48', '49']:
        shard = json.loads((ROOT / f'data/derived/zip-divisions/{prefix}.json').read_text())
        indexed.update(re.sub(r'/(cd|sldu|sldl):0+(\d+)$', r'/\1:\2', x) for x in shard['divisions'] if x.startswith(BASE))

    district_meta, district_sections, _ = source('mi-district-law-pdf')
    circuit_meta, circuit_sections, _ = source('mi-circuit-law-pdf')
    manual_meta, _, manual_text = source('michigan-manual-2023-ch5', MANUAL)
    ordinals = {i: x for i, x in enumerate(['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'])}
    for n, word in [(20, 'twenty'), (30, 'thirty'), (40, 'forty'), (50, 'fifty'), (60, 'sixty'), (70, 'seventy'), (80, 'eighty'), (90, 'ninety')]:
        ordinals[n] = word[:-1] + 'ieth' if word.endswith('y') else word + 'th'
        for unit in range(1, 10):
            ordinals[n + unit] = word + '-' + ordinals[unit]
    words = {v: str(k) for k, v in ordinals.items() if k}
    words.update({v + '-' + suffix: str(k) + suffix for k, v in ordinals.items() if k for suffix in ['a', 'b', 'c']})

    # The 2026 certified candidate list holds both members of these proposed
    # consolidations, so the original Westland/Roseville/Ingham definitions apply.
    first_definition = {'18', '39', '55'}
    definitions = {}
    pattern = r'[Tt]he ([a-zA-Z-]+) district consists of (.*?)(?=,? is a district| and is a district| and has \d+)'
    for code, (_, body) in district_sections.items():
        body = body.replace('- ', '-')
        for match in re.finditer(pattern, body):
            number = words[match[1].lower()]
            if number not in first_definition or number not in definitions:
                definitions[number] = (code, match[2].rstrip(','), match[0], district_meta)

    # Explicit election divisions, rather than administrative districts, are
    # the electorate. Their lists in the statute survive the 67/68 consolidation.
    for district, section in [('42', '600.8122'), ('52', '600.8123'), ('67', '600.8134'), ('70', '600.8135')]:
        body = district_sections[section][1].replace('- ', '-')
        if district == '52':
            body = body[body.index('The fifty-second district'):]
        for match in re.finditer(r'[Tt]he (first|second|third|fourth|fifth) division consists of (.*?)(?= and has \d+|, and has \d+|\. The judgeships)', body):
            division = words[match[1]]
            if district == '42' and division not in ['1', '2']:
                continue
            definitions[district + '/division:' + division] = (section, match[2].rstrip(','), match[0], district_meta)
        if district == '67':
            key = '67/division:4'
            section, territory, quote, meta = definitions[key]
            sentence = 'The fourth division also includes the city of Fenton, which is located in both the counties of Genesee and Oakland.'
            assert sentence in body
            definitions[key] = (section, territory + ' and the city of Fenton', quote + '. ' + sentence, meta)

    # The state's own published district list confirms that the conditional
    # reformed circuits actually exist; the current statutes give their counties.
    for number, county, code in [('5', 'Barry', '600.506'), ('33', 'Charlevoix', '600.534'), ('40', 'Lapeer', '600.541'), ('56', 'Eaton', '600.549h')]:
        body = circuit_sections[code][1]
        phrase = f'the {ordinals[int(number)]} judicial circuit consists of the county of {county}'
        assert phrase.lower() in body.lower()
        assert re.search(rf'{number}(?:st|nd|rd|th) Circuit\s+{county}', manual_text)
        definitions['circuit:' + number] = (code, 'the county of ' + county, phrase, circuit_meta)

    county_regions = {**{str(i): 'wayne' for i in range(16, 37)}, **{str(i): 'macomb' for i in range(37, 43)}, **{str(i): 'oakland' for i in range(43, 53)}, '14': 'washtenaw', '15': 'washtenaw', '54': 'ingham', '55': 'ingham', '61': 'kent', '62': 'kent', '63': 'kent', '67': 'genesee', '70': 'saginaw'}
    existing = {(m['memberOcdId'], m['districtOcdId']) for m in ballot['districtMemberships']}
    added, split = [], {}

    def add(member, electorate, quote, meta):
        pair = (member, electorate)
        if pair in existing:
            return
        existing.add(pair)
        row = {'id': 'mi-bl02-' + norm(member.removeprefix(BASE)) + '-to-' + norm(electorate.removeprefix(BASE)), 'memberOcdId': member, 'districtOcdId': electorate,
               'provenance': {'sourceUrl': meta['finalUrl'], 'sourceOrg': 'Michigan Legislature', 'collectedAt': meta['retrievedAt'], 'verifiedAt': NOW, 'quote': quote}}
        ballot['districtMemberships'].append(row)
        added.append(row)

    def municipality_ids(name, kind, county=None, allow_all_counties=False):
        short = norm(name.replace('the village of ', 'village of '))
        scoped = []
        for row in indexed:
            match = re.fullmatch(BASE + r'county:([^/]+)/place:(.+)', row)
            if not match or (county and match[1] != county and not allow_all_counties):
                continue
            full = match[2]
            if kind in ['city', 'cities'] and full == short + '_city':
                scoped.append(row)
            if kind in ['township', 'townships'] and full in [short + '_township', short + '_charter_township']:
                scoped.append(row)
        assert scoped, (name, kind, county)
        ids = set(scoped)
        generic = BASE + 'place:' + short
        # A generic city spanning counties is safe only if every county piece
        # belongs to the electorate (e.g. Fenton explicitly includes both).
        all_pieces = {x for x in indexed if re.fullmatch(re.escape(BASE) + r'county:[^/]+/place:' + re.escape(short) + '_city', x)}
        if generic in indexed and (not all_pieces or all_pieces <= ids):
            ids.add(generic)
        return ids

    def members(territory, county=None, number=None):
        exception = re.search(r',? except ', territory)
        if exception:
            head, tail = territory[:exception.start()], territory[exception.end():]
            county_name = re.fullmatch(r'the county of (.+)', head)[1]
            county = norm(county_name)
            result = {x for x in indexed if x.startswith(BASE + f'county:{county}/place:')}
            excluded = municipality_groups(tail, county)
            return result - excluded, county
        county_match = re.fullmatch(r'the count(?:y|ies) of (.+)', territory)
        if county_match and ' and the city of ' not in territory:
            return {BASE + 'county:' + norm(n) for n in names(county_match[1])}, None
        if number == '10':
            assert territory == 'the county of Calhoun and the city of Battle Creek'
            return {BASE + 'county:calhoun'} | municipality_ids('Battle Creek', 'city', allow_all_counties=True), None
        return municipality_groups(territory, county, number), county

    def municipality_groups(territory, county, number=None):
        result = set()
        pattern = r'(?:the )?(city|cities|township|townships|village|villages) of (.*?)(?= and the (?:city|cities|township|townships|village|villages) of|$)'
        groups = list(re.finditer(pattern, territory))
        assert groups, territory
        for match in groups:
            kind, text = match.groups()
            text = re.sub(r' in the county of .+$', '', text)
            for name in names(text):
                # Section 8101 treats a city crossing county lines as a partial
                # city unless large enough; Memphis is mapped only in Macomb.
                allow_all = (number == '35' and name == 'Northville' or number == '67' and name == 'Fenton'
                             or number == '54' and name in ['Lansing', 'East Lansing'])
                result.update(municipality_ids(name, kind, county, allow_all))
        return result

    held = {c['ocdId'] for c in ballot['contests']}
    for electorate in sorted(held):
        suffix = electorate.removeprefix(BASE)
        if suffix.startswith('district_court:'):
            key = suffix.removeprefix('district_court:')
        elif suffix.startswith('circuit_court:') and suffix.removeprefix('circuit_court:') in ['5', '33', '40', '56']:
            key = 'circuit:' + suffix.removeprefix('circuit_court:')
        else:
            continue
        assert key in definitions, key
        section, territory, quote, meta = definitions[key]
        number = re.match(r'\d+', key)[0] if not key.startswith('circuit:') else None
        county = county_regions.get(number)
        mids, split_county = members(territory, county, number)
        if split_county:
            counties = sorted({re.search(r'/county:([^/]+)/', member)[1] for member in mids if '/county:' in member})
            split[electorate] = {'counties': counties or [split_county], 'section': section, 'territory': territory, 'wholeCountyMembershipAdded': False}
        for member in sorted(mids):
            add(member, electorate, section + ' ' + quote, meta)

    # New evidence resolves the statutory conditional-circuit ambiguity.
    manual_added = not any(s['rawHash'] == manual_meta['rawHash'] and s['finalUrl'] == manual_meta['finalUrl'] for s in document['sourceReceipt']['sources'])
    if manual_added:
        document['sourceReceipt']['sources'].append({**{k: manual_meta[k] for k in ['requestedUrl', 'finalUrl', 'httpStatus', 'rawHash', 'retrievedAt']}, 'publisher': 'Michigan Legislature', 'sourceClass': 'OFFICIAL_PUBLISHER',
            'reviewedEvidence': 'Saved original PDF at data/ballot/evidence/bl02-mi/michigan-manual-2023-ch5.pdf.gz. Pages 545-546 confirm the reformed 5th (Barry), 33rd (Charlevoix), 40th (Lapeer), and 56th (Eaton) circuits; current Chapter 5 statutes captured October 21, 2026 retain these county definitions. Hash identifies decompressed bytes.'})
    if added or manual_added:
        document['sourceReceipt']['reviewedAt'] = NOW

    def unreachable(ballot):
        reached = set(indexed) | {BASE.rstrip('/')}
        while True:
            after = reached | {m['districtOcdId'] for m in ballot['districtMemberships'] if m['memberOcdId'] in reached}
            if after == reached:
                break
            reached = after
        return [{'id': c['id'], 'district': c['ocdId'], 'title': c['title']} for c in ballot['contests']
                if re.search(r'/(district_court|circuit_court|court_of_appeals):', c['ocdId']) and c['ocdId'] not in reached]

    for field in ['contests', 'candidacies', 'measures', 'absences']:
        assert ballot[field] == before[field], field
    remaining = unreachable(ballot)
    assert not remaining, remaining
    assert all(m['memberOcdId'] in indexed for m in added), 'Every new member uses a ZIP-index division ID'
    report = {'checkedAt': NOW, 'state': 'MI', 'upstream': 'BA-01 saved certified judicial roster and official district statutes', 'downstream': 'State ballot publisher → district-membership expansion → reader ballot',
              'countScope': 'Court contests; ordinary congressional and legislative districts are supplied by promoted Census geography, separately from the static ZIP index.',
              'beforeUnreachableContests': len(unreachable(before)), 'afterUnreachableContests': len(remaining), 'addedMemberships': len(added), 'coveredDistricts': len({m['districtOcdId'] for m in added}), 'splitCountyDistricts': split, 'remaining': remaining,
              'method': 'Compile current Michigan statutory county/city/township and election-division lists into existing ZIP-index IDs. Whole county exclusions expand only to county subdivisions outside the exclusions. Section 8101 county-crossing city rule keeps Memphis scoped to Macomb; Fenton is explicitly included across Genesee and Oakland. Certified 2026 roster keeps proposed 18/29, 38/39, 54A/54B/55 consolidations distinct. Official Michigan Manual confirms formerly conditional circuit creation.'}
    if write and (added or manual_added):
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
        (ROOT / 'data/ballot/reports/bl02-mi.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    main(parser.parse_args().write)
