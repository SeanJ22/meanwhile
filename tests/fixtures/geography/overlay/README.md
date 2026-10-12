# Original legislative overlay evidence

Acquired from the official publishers on October 12, 2026. `sources.json`
records URLs, byte lengths and SHA-256 checksums. The two GRANIT ZIPs, Census
ZIP and five-page election PDF are original publisher bytes. The PDF's SOS
URL returned HTTP 403 even with the previously successful browser user agent;
the legislature's official copy returned the document successfully.

`NHHouseDists2022_float.dbf` is the original ZIP member: 40 records, one blank
`FloatHse22` record and 39 actual overlays. `original-polygons.json` preserves
the original rings, attributes and State Plane feet coordinates for RO31,
ME28 and ST18. `floterials.geojson` contains those same three polygons
reprojected from the original `.prj` to WGS84, without simplification.

The Census relationship fixture contains the original header and every row
for state FIPS 33, with the UTF-8 BOM removed. Only selection has changed;
the original land measures are intact. The complete national relationship's
checksum is recorded separately from the selected fixture's checksum.

The routine parser cross-checks all original overlays against the official
PDF and the matching 2022 town/ward ZIP. Its result is 38 agreeing districts
and 199 exact Census ZIP edges; one district, CH16, differs. The PDF assigns
Keene Ward 2 to Cheshire 16, but the original overlay covers approximately
0.00000000126 of that ward. The district remains unpublished.

The 2022 town/ward source includes whole-city remnants beside ward polygons;
the ward polygons supply legislative identities. Four ward comparisons have
boundary slivers no larger than 0.00013646 of ward area. The reference's
0.0002 cartographic tolerance excludes those slivers from town membership;
the original reader polygons and exact Census land fractions stay intact.

The PDF marks 38 overlay rows FL and omits FL on Strafford 18. The parser
uses the original boundary's ST18 identity to retrieve and independently
compare that row's towns, which agree. The PDF also contains two spelling
errors in district headings, `Distsrict` and `Disrict`; the reference grammar
handles the actual printed headings.

Newbury and New London belong to Merrimack 7, a two-seat base district.
Neither appears in an official floterial town list, and ZIP 03255 has no
overlay edge in the exact Census land relationships. Candia 03034 belongs
to base Rockingham 2 and floterial Rockingham 31; the floterial's ZIP share
is exactly 1. The real acceptance tests preserve this source contradiction
instead of assigning an unsupported floterial to Newbury.
