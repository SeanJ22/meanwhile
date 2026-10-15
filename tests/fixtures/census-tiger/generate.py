"""Generate deterministic, fictional Census-shaped shapefile ZIP samples."""
from pathlib import Path
import struct
import zipfile

ROOT = Path(__file__).parent


def rectangle(left, bottom, right, top, hole=False):
    # Shapefile exterior clockwise; hole counterclockwise.
    points = [(left, bottom), (left, top), (right, top), (right, bottom), (left, bottom)]
    if hole:
        points.reverse()
    return [(x - 110, y + 30) for x, y in points]


LEFT = [rectangle(0, 0, 2, 2), rectangle(.5, .5, 1.5, 1.5, True)]
RIGHT = [rectangle(2, 0, 4, 2), rectangle(-2, 0, -1, 1)]


def polygon(rings):
    if not rings:
        return struct.pack("<i", 0)
    points = [point for ring in rings for point in ring]
    box = (min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points))
    starts, count = [], 0
    for ring in rings:
        starts.append(count)
        count += len(ring)
    return (struct.pack("<i4d2i", 5, *box, len(rings), len(points))
            + struct.pack("<" + "i" * len(starts), *starts)
            + b"".join(struct.pack("<2d", *point) for point in points))


def shape_header(length, rows):
    points = [point for rings, _, _ in rows for ring in rings for point in ring]
    box = (min(x for x, _ in points), min(y for _, y in points), max(x for x, _ in points), max(y for _, y in points))
    return struct.pack(">7i", 9994, 0, 0, 0, 0, 0, length // 2) + struct.pack("<2i8d", 1000, 5, *box, 0, 0, 0, 0)


def write_zip(name, fields, rows):
    bodies = [polygon(rings) for rings, _, _ in rows]
    shp_records, shx_records, offset = [], [], 50
    for index, body in enumerate(bodies, 1):
        words = len(body) // 2
        shp_records.append(struct.pack(">2i", index, words) + body)
        shx_records.append(struct.pack(">2i", offset, words))
        offset += 4 + words
    shp = shape_header(100 + sum(len(record) for record in shp_records), rows) + b"".join(shp_records)
    shx = shape_header(100 + len(shx_records) * 8, rows) + b"".join(shx_records)
    header_length, record_length = 33 + len(fields) * 32, 1 + sum(length for _, length in fields)
    header = bytearray(32)
    header[0] = 3
    header[1:4] = bytes([126, 1, 1])
    struct.pack_into("<IHH", header, 4, len(rows), header_length, record_length)
    descriptors = []
    for field, length in fields:
        descriptor = bytearray(32)
        descriptor[:len(field)] = field.encode("ascii")
        descriptor[11], descriptor[16] = ord("C"), length
        descriptors.append(bytes(descriptor))
    records = []
    for _, properties, deleted in rows:
        records.append((b"*" if deleted else b" ") + b"".join(str(properties.get(field, "")).encode("ascii").ljust(length, b" ") for field, length in fields))
    dbf = bytes(header) + b"".join(descriptors) + b"\r" + b"".join(records) + b"\x1a"
    prj = ('GEOGCS["GCS_North_American_1983",DATUM["D_North_American_1983",'
           'SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],'
           'UNIT["Degree",0.0174532925199433]]').encode("ascii")
    with zipfile.ZipFile(ROOT / name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for suffix, data in [("shp", shp), ("shx", shx), ("dbf", dbf), ("prj", prj), ("cpg", b"UTF-8")]:
            info = zipfile.ZipInfo(name[:-4] + "." + suffix, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def districts(family, year, release=None):
    column = f"CD{year}FP" if family == "cd" else "SLDUST" if family == "sldu" else "SLDLST"
    codes = ["01", "02", "ZZ"] if family == "cd" else ["001", "A01" if family == "sldu" else "002", "ZZZ", "999"]
    rings = [LEFT, RIGHT, [rectangle(5, 0, 6, 1)], [rectangle(6, 0, 7, 1)]]
    metadata = "CDSESSN" if family == "cd" else "LSY"
    rows = [(shape, {"STATEFP": "04", column: code, "GEOID": "04" + code, metadata: str(year if index < 2 or family == "cd" else "0000"), "ALAND": "1234"}, False)
            for index, (code, shape) in enumerate(zip(codes, rings))]
    name = f"tl_{release or year}_04_{'cd' + str(year) if family == 'cd' else family}.zip"
    write_zip(name, [("STATEFP", 2), (column, len(codes[0])), ("GEOID", len(codes[0]) + 2), (metadata, 4), ("ALAND", 10)], rows)


districts("cd", 120, 2026)
districts("cd", 121, 2028)
districts("sldu", 2026)
districts("sldl", 2026)
districts("sldu", 2024, 2025)
districts("sldu", 2028)
districts("sldl", 2028)
write_zip("tl_2026_31_sldl.zip", [("STATEFP", 2), ("SLDLST", 3), ("GEOID", 5), ("LSY", 4)], [
    ([rectangle(0, 0, 1, 1)], {"STATEFP": "31", "SLDLST": "ZZZ", "GEOID": "31ZZZ", "LSY": "0000"}, False),
    ([rectangle(1, 0, 2, 1)], {"STATEFP": "31", "SLDLST": "999", "GEOID": "31999", "LSY": "0000"}, False),
])
zcta_shapes = [
    [rectangle(.1, .1, .4, .4)],
    [rectangle(1.999999999, .1, 2.5, .4)],
    [rectangle(.6, .6, 1.4, 1.4)],
    [rectangle(.2, .2, 2, .4)],
    [rectangle(2.2, .1, 2.4, .4), rectangle(-1.8, .2, -1.2, .6)],
    [rectangle(.4, .4, .8, .8)],
    [rectangle(.5, .5, 1.5, 1.5)],
    [rectangle(10, 0, 11, 1)],
]
zctas = [(rings, {"ZCTA5CE20": f"9000{index}", "GEOID20": f"9000{index}", "ALAND20": "1234", "AWATER20": "5678"}, False) for index, rings in enumerate(zcta_shapes, 1)]
zctas.insert(1, ([], {"ZCTA5CE20": "99998", "GEOID20": "99998"}, False))
zctas.insert(4, ([rectangle(0, 0, 1, 1)], {"ZCTA5CE20": "99999", "GEOID20": "99999"}, True))
write_zip("tl_2020_us_zcta520.zip", [("ZCTA5CE20", 5), ("GEOID20", 5), ("ALAND20", 10), ("AWATER20", 10)], zctas)
