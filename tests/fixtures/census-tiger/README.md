# Census-shaped TIGER samples

These small binary shapefile ZIPs are generated fixtures. Their coordinates,
district codes and ZIP-like ZCTA codes are fictional and provide no live
geographic evidence. They exercise the production SHP/DBF/ZIP readers offline.

Regenerate deterministically with `python3 tests/fixtures/census-tiger/generate.py`.
Each ZIP contains SHP, SHX, DBF, a NAD83 geographic PRJ, and UTF-8 CPG files.

- `tl_2026_04_cd120.zip`: CD120FP and CDSESSN120, two assigned districts and ZZ.
- `tl_2026_04_sldu.zip`: LSY2026, numeric and alphanumeric districts, ZZZ and 999.
- `tl_2026_04_sldl.zip`: LSY2026, numeric districts, ZZZ and 999.
- `tl_2025_04_sldu.zip`: LSY2024 differs from the TIGER release year.
- `tl_2028_04_sldu.zip`: a newer published legislative plan.
- `tl_2028_04_sldl.zip`: the newer lower-chamber plan.
- `tl_2028_04_cd121.zip`: CD121FP and CDSESSN121, a newer Congress plan.
- `tl_2026_31_sldl.zip`: no assigned House districts, with LSY0000.
- `tl_2020_us_zcta520.zip`: eight filled geometries; a null SHP and a deleted
  DBF record occur between ordinary rows to test ordinal pairing.

ZCTA 90001 is wholly within district 1. 90002 has a positive sliver of width
0.000000001 degrees in district 1 and the remainder in district 2. 90003 is
inside district 1's hole. 90004 merely touches district 2's boundary. 90005 is
a multipolygon wholly contained in district 2's disconnected parts. 90006
partially crosses district 1's hole. 90007 exactly fills that hole and touches
its boundary. 90008 lies outside all assigned district bounding boxes.
ALAND/AWATER fields deliberately differ from polygon surface area: geometric
membership must not manufacture a tabulated land fraction.
