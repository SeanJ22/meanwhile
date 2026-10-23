"""Read the adopted Nevada Regents district shapefile into existing reader data."""
import hashlib
import io
import json
from pathlib import Path
import zipfile

import pyproj
import shapefile
from shapely.geometry import mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'data/ballot/evidence/bl02-west-extra'
source = EVIDENCE / 'nv-regents-polygons.zip'
meta = json.loads((EVIDENCE / 'nv-regents-polygons.zip.capture.json').read_text())
assert meta['httpStatus'] == 200 and hashlib.sha256(source.read_bytes()).hexdigest() == meta['rawHash']
archive = zipfile.ZipFile(source)
stem = '2021Regents_BDR_Final'
original_crs = pyproj.CRS.from_wkt(archive.read(stem + '.prj').decode())
assert original_crs.to_epsg() == 4269
project = pyproj.Transformer.from_crs(original_crs, pyproj.CRS.from_epsg(4326), always_xy=True).transform
reader = shapefile.Reader(shp=io.BytesIO(archive.read(stem + '.shp')), shx=io.BytesIO(archive.read(stem + '.shx')), dbf=io.BytesIO(archive.read(stem + '.dbf')))
features = []
checks = []
for item in reader.iterShapeRecords():
    district = int(item.record.as_dict()['DISTRICT'])
    original = shape(item.shape.__geo_interface__)
    assert original.is_valid and not original.is_empty
    geometry = transform(project, original)
    assert geometry.is_valid
    ocd = f'ocd-division/country:us/state:nv/board_of_regents:{district}'
    features.append({'type': 'Feature', 'properties': {'ocdId': ocd, 'label': f'Board of Regents District {district}',
                    'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'], 'collectedAt': meta['retrievedAt']},
                     'geometry': mapping(geometry)})
    representative = geometry.representative_point()
    checks.append({'districtOcdId': ocd, 'lat': representative.y, 'lng': representative.x})
assert sorted(int(r['properties']['ocdId'].rsplit(':', 1)[1]) for r in features) == list(range(1, 14))
output = ROOT / 'data/states/nv/geo/bl02-regents-32.geojson'
output.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')) + '\n')
report_path = ROOT / 'data/ballot/reports/bl02-west-extra-memberships.json'
report = json.loads(report_path.read_text())
report['nvExactGeometry'] = {'path': str(output.relative_to(ROOT)), 'sourceUrl': meta['finalUrl'], 'sourceHash': meta['rawHash'],
    'inputCrs': 'EPSG:4269', 'outputCrs': 'EPSG:4326', 'districts': 13, 'allSourcePolygonsValid': True,
    'representativePoints': checks,
    'meaning': 'Adopted official district geometry supplies exact point selection for all Regents districts, including 2, 3 and 5 where no complete county, place, Assembly district or Senate district can supply a safe membership. Resolver manifest publication is handled by the BL-02 parent task.'}
report_path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'districts': len(features), 'path': str(output.relative_to(ROOT)), 'bytes': output.stat().st_size}))
