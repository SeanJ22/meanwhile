"""Connect held NM PEC 2/3/7 using the Legislature's adopted plan geometry."""
import gzip
import hashlib
import json
from pathlib import Path

from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-west-extra'
raw = gzip.decompress((EVIDENCE / 'nm-pec-plan.geojson.gz').read_bytes())
meta = json.loads((EVIDENCE / 'nm-pec-plan.geojson.gz.capture.json').read_text())
assert meta['httpStatus'] == 200 and hashlib.sha256(raw).hexdigest() == meta['rawHash']
plan = json.loads(raw)
assert {int(f['properties']['District']) for f in plan['features']} == set(range(1, 11))
page = gzip.decompress((EVIDENCE / 'nm-pec-plan.html.gz').read_bytes()).decode()
assert '/Redistricting2021/221723.1/221723.1.geojson' in page
features, points = [], []
for feature in plan['features']:
    district = int(feature['properties']['District'])
    if district not in (2, 3, 7):
        continue
    geometry = shape(feature['geometry'])
    assert geometry.is_valid and not geometry.is_empty
    assert -110 < geometry.bounds[0] < geometry.bounds[2] < -102
    assert 31 < geometry.bounds[1] < geometry.bounds[3] < 38
    ocd = f'ocd-division/country:us/state:nm/board_of_education:{district}'
    features.append({'type': 'Feature', 'properties': {
        'ocdId': ocd, 'label': f'Public Education Commission District {district}',
        'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'],
        'collectedAt': meta['retrievedAt']}, 'geometry': mapping(geometry)})
    point = geometry.representative_point()
    points.append({'districtOcdId': ocd, 'lat': point.y, 'lng': point.x})
output = ROOT / 'data/states/nm/geo/bl02-board-districts-35.geojson'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')) + '\n')
state_path = ROOT / 'data/ballot/2026-general/nm.json'
state = json.loads(state_path.read_text())
sources = state['sourceReceipt']['sources']
if not any(s['finalUrl'] == meta['finalUrl'] for s in sources):
    sources.append({k: meta[k] for k in ['requestedUrl', 'finalUrl', 'httpStatus', 'retrievedAt', 'rawHash', 'publisher']})
    sources[-1].update(sourceClass='OFFICIAL_PUBLISHER', reviewedEvidence=
        'Adopted 2021 PEC plan 221723.1 linked by the Legislature Maps and Data page; exact districts 2, 3 and 7 supply point and partial ZIP routes where no whole county or city is safe. Existing HB9 and block equivalency evidence establishes the current plan. Demographic properties are omitted from reader geometry.')
    state_path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + '\n')
report = {'step': 'BL-02', 'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'],
          'geometryPath': str(output.relative_to(ROOT)), 'districts': 3,
          'allSourcePolygonsValid': True, 'geometryChanged': False,
          'representativePoints': points,
          'wholeCountyWidening': False, 'properties': 'Identity and source only; source coordinates preserved.'}
(ROOT / 'data/ballot/reports/bl02-nm-held-districts.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'districts': len(features), 'path': str(output.relative_to(ROOT))}))
