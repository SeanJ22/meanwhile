"""Replay official MT/NM/NV district lists into safe whole-division memberships."""
import argparse
import collections
import copy
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
import unicodedata

from lxml import html
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-west-extra'
AT = datetime.datetime.now(datetime.timezone.utc).isoformat()
COUNTY_FILE = ROOT / 'data/ballot/sources/ba01-northeast/ma-2020-census-county-fips.txt'
COUNTIES = {r['STATEFP'] + r['COUNTYFP']: re.sub(r' (County|Parish)$', '', r['COUNTYNAME'])
            for r in csv.DictReader(COUNTY_FILE.open(), delimiter='|')}


def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '_', value.lower()).strip('_')


def blocks(name):
    rows = openpyxl.load_workbook(EVIDENCE / name, read_only=True, data_only=True).active.values
    next(rows)
    out = {}
    for a, b, *_ in rows:
        if a is None:
            continue
        block = str(int(a)) if isinstance(a, (int, float)) else str(a)
        assert len(block) == 15 and block.isdigit()
        assert block not in out
        out[block] = int(b)
    return out


def grouping(base, target):
    assert set(base) == set(target), 'Both official plans must enumerate identical complete block sets.'
    result = collections.defaultdict(set)
    counts = collections.Counter()
    for block, member in base.items():
        result[member].add(target[block])
        counts[member] += 1
    return result, counts


def county_groups(target):
    return grouping({block: block[:5] for block in target}, target)


def update(state, family, target, house, source_names, statutory=None, places=None, write=False):
    path = ROOT / f'data/ballot/2026-general/{state}.json'
    original = path.read_bytes()
    data = json.loads(original)
    ballot = next(iter(data['ballots'].values()))
    before = copy.deepcopy(ballot)
    base = f'ocd-division/country:us/state:{state}'
    held = {int(r['ocdId'].rsplit(':', 1)[1]) for r in ballot['contests'] if r['ocdId'].startswith(base + '/' + family + ':')}
    records = []
    used = []
    for filename, publisher in source_names:
        meta = json.loads((EVIDENCE / (filename + '.capture.json')).read_text())
        assert meta['httpStatus'] == 200
        assert hashlib.sha256((EVIDENCE / filename).read_bytes()).hexdigest() == meta['rawHash']
        receipt = {**meta, 'publisher': publisher, 'sourceClass': 'OFFICIAL_PUBLISHER',
                   'reviewedEvidence': 'BL-02 source-bound replay; whole-division membership requires every block in the official member district to have the same target. Split counties are reported and never widened.'}
        if not any(r['rawHash'] == receipt['rawHash'] and r['finalUrl'] == receipt['finalUrl'] for r in data['sourceReceipt']['sources']):
            data['sourceReceipt']['sources'].append(receipt)
        used.append({'path': str((EVIDENCE / filename).relative_to(ROOT)), **meta})
    primary = data['sourceReceipt']['sources'][-1]
    wanted_url = used[0]['finalUrl']
    primary = next(r for r in data['sourceReceipt']['sources'] if r['finalUrl'] == wanted_url and r['rawHash'] == used[0]['rawHash'])
    provenance = {'sourceUrl': primary['finalUrl'], 'sourceOrg': primary['publisher'],
                  'collectedAt': primary['retrievedAt'], 'verifiedAt': AT}

    def add(member, district, quote):
        if district not in held:
            return
        row = {'id': f'{state}-bl02-membership:{member}->{family}:{district}', 'memberOcdId': base + '/' + member,
               'districtOcdId': base + '/' + family + ':' + str(district),
               'provenance': {**provenance, 'quote': quote}}
        existing = next((r for r in ballot.setdefault('districtMemberships', []) if r['id'] == row['id']), None)
        if existing:
            existing.update(row)
        else:
            ballot['districtMemberships'].append(row)
        records.append({'memberOcdId': row['memberOcdId'], 'districtOcdId': row['districtOcdId']})

    house_groups, house_counts = grouping(house, target)
    for n, districts in sorted(house_groups.items()):
        if len(districts) == 1:
            district = next(iter(districts))
            quote = (f'House district {n} is assigned to public service commission district {district} by MCA 69-1-104.' if statutory else
                     f'Every one of the {house_counts[n]} blocks in the official House/Assembly district {n} is assigned to district {district} in the official target plan; both official block sets match exactly.')
            add('sldl:' + str(n), district, quote)
    county, county_counts = county_groups(target)
    for fips, districts in sorted(county.items()):
        if len(districts) == 1:
            district = next(iter(districts))
            add('county:' + slug(COUNTIES[fips]), district,
                f'All {county_counts[fips]} official plan blocks in {COUNTIES[fips]} County ({fips}) are assigned to district {district}.')
    if places:
        z = zipfile.ZipFile(EVIDENCE / 'nv-place-blocks.zip')
        place_rows = list(csv.DictReader(io.StringIO(z.read('BlockAssign_ST32_NV_INCPLACE_CDP.txt').decode()), delimiter='|'))
        assert {r['BLOCKID'] for r in place_rows} == set(target)
        place_blocks = {r['BLOCKID']: r['PLACEFP'] for r in place_rows if r['PLACEFP']}
        p_groups, p_counts = grouping(place_blocks, {b: target[b] for b in place_blocks})
        names = {r['GEOID'][2:]: re.sub(r' (CDP|city|town)$', '', r['NAME']) for r in csv.DictReader((EVIDENCE / 'nv-place-names.txt').open(), delimiter='\t')}
        for code, districts in sorted(p_groups.items()):
            if len(districts) == 1 and next(iter(districts)) in held:
                district = next(iter(districts))
                add('place:' + slug(names[code]), district,
                    f'All {p_counts[code]} Census 2020 blocks of {names[code]} ({code}) are assigned to Board of Regents district {district} in the adopted official plan.')
    splits = [{'county': COUNTIES[fips], 'countyOcdId': base + '/county:' + slug(COUNTIES[fips]), 'districts': sorted(districts)}
              for fips, districts in sorted(county.items()) if len(districts) > 1]
    by_district = []
    reached = {int(r['districtOcdId'].rsplit(':', 1)[1]) for r in records}
    for district in sorted(held):
        split = [r['county'] for r in splits if district in r['districts']]
        by_district.append({'district': district, 'countySplits': split, 'wholeDivisionMembershipsAdded': sum(r['districtOcdId'].endswith(':' + str(district)) for r in records), 'reachableFromAddedMemberships': district in reached})
        for contest in ballot['contests']:
            if contest['ocdId'] == base + '/' + family + ':' + str(district) and split:
                contest['scopeNote'] = 'This district covers parts of ' + ', '.join(split) + (' County.' if len(split) == 1 else ' counties.')
    data['sourceReceipt']['reviewedAt'] = AT
    data['sourceReceipt']['reviewedBy'] = 'bl02-whole-division-replay'
    assert before['candidacies'] == ballot['candidacies']
    assert {r['id'] for r in before['contests']} == {r['id'] for r in ballot['contests']}
    if write:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    return {'state': state.upper(), 'heldDistricts': sorted(held), 'addedMemberships': len(records), 'membershipsBefore': len(before.get('districtMemberships', [])),
            'membershipsAfter': len(ballot.get('districtMemberships', [])), 'officialBlocksChecked': len(target), 'sources': used,
            'districts': by_district, 'splitCounties': splits, 'memberships': records,
            'remainingExactMatchDistricts': sorted(held - reached), 'inputSha256': hashlib.sha256(original).hexdigest(),
            'meaning': 'Only whole counties, places and whole legislative districts enter districtMemberships. A district with no wholly contained indexed division remains open for exact boundary matching.'}


def main(write):
    law = ' '.join(html.parse(str(EVIDENCE / 'mt-psc-law.html')).getroot().text_content().split())
    psc = {}
    for n, name in enumerate(['first', 'second', 'third', 'fourth', 'fifth'], 1):
        match = re.search(name + r' district: ([0-9, ]+)[;.]', law)
        assert match
        psc.update({int(k): n for k in match[1].split(',')})
    assert set(psc) == set(range(1, 101))
    mt_house = blocks('mt-house-blocks.xlsx')
    results = [update('mt', 'public_service_commission', {b: psc[h] for b, h in mt_house.items()}, mt_house,
                      [('mt-psc-law.html', 'Montana Legislature'), ('mt-house-blocks.xlsx', 'Montana Districting and Apportionment Commission')], statutory=True, write=write)]
    results.append(update('nm', 'board_of_education', blocks('nm-pec-blocks.xlsx'), blocks('nm-house-blocks.xlsx'),
                          [('nm-pec-blocks.xlsx', 'New Mexico Legislature'), ('nm-house-blocks.xlsx', 'New Mexico Legislature'), ('nm-pec-law.pdf', 'New Mexico Legislature')], write=write))
    results.append(update('nv', 'board_of_regents', blocks('nv-regents-blocks.xlsx'), blocks('nv-assembly-blocks.xlsx'),
                          [('nv-regents-blocks.xlsx', 'Nevada Legislative Counsel Bureau'), ('nv-assembly-blocks.xlsx', 'Nevada Legislative Counsel Bureau'),
                           ('nv-place-blocks.zip', 'U.S. Census Bureau'), ('nv-place-names.txt', 'U.S. Census Bureau'), ('nv-regents-tables.pdf', 'Nevada Legislative Counsel Bureau')], places=True, write=write))
    report = {'step': 'BL-02', 'checkedAt': AT, 'states': results,
              'method': 'Compare every block ID from each state legislature\'s adopted district list. Assign a county, municipality or existing legislative district only when all of its official blocks belong to one target district. Montana PSC assignment is explicit in current MCA 69-1-104. County splits are retained as flags; no split county is assigned wholesale.',
              'nvRemainder': 'Board of Regents districts 2, 3 and 5 divide every county, incorporated place/CDP and Assembly district they touch. The official Senate block file also contains no whole Senate district in a single Regents district. Exact boundary/precinct matching remains necessary for those three races.',
              'sourceConflict': 'Nevada summary table lists Storey wholly in district 9, while the adopted block-equivalency file assigns some Storey blocks to district 11. No Storey membership is added; neither district is a held 2026 race in this file.'}
    if write:
        (ROOT / 'data/ballot/reports/bl02-west-extra-memberships.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps([{'state': r['state'], 'added': r['addedMemberships'], 'remainingExactMatchDistricts': r['remainingExactMatchDistricts']} for r in results]))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    main(parser.parse_args().write)
