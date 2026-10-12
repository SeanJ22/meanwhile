# Overlay district sources

`overlay-district-sources.json` contains one reference row describing an official
legislative overlay source. Source URLs, chamber, plan years, source code field,
county-prefix naming rule and document parsing rules are data. Runtime code does
not name a state or select a special state implementation.

The row describes NH GRANIT's `NHHouseDistricts2022_Float.zip`, produced by the
New Hampshire Office of Strategic Initiatives on February 2, 2023: forty
features in `NHHouseDists2022_float.shp`, identified by `FloatHse22`. The metadata
defines one unassigned polygon for places outside any floterial; acquisition
omits that polygon and retains the thirty-nine actual districts.
Its `.prj` file supplies the NAD83 State Plane feet projection; acquisition
reprojects every coordinate to WGS84 with that definition. The Secretary of
State's district document is the independent town-assignment source; floterial
rows are marked FL. The current linked document is named
`2022-state-representative-and-delegate-districts.pdf` under `Voting Districts`;
the earlier `2022-2032` basename is recorded in `docs/source-ladder.md`.
The [GRANIT metadata](https://www.arcgis.com/sharing/rest/content/items/390b41cdc1c84bc5ad53f78a26c272e2/info/metadata/metadata.xml?format=default&output=html)
identifies the government producer, the publication date, both source types,
the exact ZIP URL and the Earth Systems Research Center's work under contract
to the Office of Strategic Initiatives.

Town and ward membership is checked against the producer's
`d-nhpolitdists/2022/NHPolitDists2022.zip` polygons, with ward names from its
`DISTRICT` field. The unversioned `NHPolitDists.zip` is a 2017 plan and cannot
cross-check 2022 wards. The matching 2022 file contains whole-city remnants
beside ward polygons; the wards supply legislative membership.

Once membership agrees with the document, the overlay's official town/ward
list must equal a union of complete base-district lists in the same official
document. Each base designation matches its Census DBF `NAMELSAD` through
the reference naming rule, establishing the exact Census GEOID members.
This avoids treating different cartographic coastlines as electoral changes.
ZCTA shares use the exact sum of those base districts' Census `AREALAND_PART`
values divided by the ZCTA's `AREALAND_ZCTA5_20`. The reference row specifies the
2024 partition boundaries and its matching 2024-plan ZCTA relationships. Water
and population do not supply a share. A source can also use whole-town Census
relationships when it has no ward splits. Unparsed document rows, partial
partition members and town differences are reported with the source URLs;
agreement is never inferred from an absent row.

Original publisher bytes were acquired on October 12, 2026 and preserved in
`tests/fixtures/geography/overlay/`, including the real DBF and three original
polygons. SOS returned HTTP 403 even with a browser user agent; the reference's
official legislature PDF mirror supplied the five-page document. Its four
columns are read in order down each column, with the page title excluded.
Two printed heading spelling errors are handled by the reference grammar.
Strafford 18 has no printed FL marker; its original overlay code identifies
the candidate and its independently listed towns agree.

Thirty-eight districts agree and produce 199 exact Census ZIP edges. Cheshire
16 differs: the PDF includes Keene Ward 2 and the original overlay excludes
it. `overlay-source-discrepancies.json` preserves that difference and both
official sources; the district stays unpublished. Four ward comparisons have
cartographic slivers at most 0.00013646 of ward area; the source row's 0.0002
tolerance establishes town membership without altering source geometry or
Census land measures. Millimetre-scale rounding only in polygon comparisons
stabilizes coincident reprojected edges; reader polygons retain full precision.

The PDF assigns Newbury and New London to Merrimack 7 (two base seats), and no
floterial town list includes either. ZIP 03255 has no overlay edge in the exact
Census relationships. Candia 03034 has both base Rockingham 2 and floterial
Rockingham 31; its overlay land share is exactly 1. Tests preserve that result
instead of adding an unsupported Newbury floterial.
