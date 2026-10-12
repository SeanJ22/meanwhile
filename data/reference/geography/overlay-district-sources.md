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

Town and ward membership is checked against the producer's `NHPolitDists.zip`
polygons, including ward names. Once membership agrees with the document, the
overlay is checked as a union of complete Census base legislative districts.
ZCTA shares use the exact sum of those base districts' Census `AREALAND_PART`
values divided by the ZCTA's `AREALAND_ZCTA5_20`. The reference row specifies the
2024 partition boundaries and its matching 2024-plan ZCTA relationships. Water
and population do not supply a share. A source can also use whole-town Census
relationships when it has no ward splits. Unparsed document rows, partial
partition members and town differences are reported with the source URLs;
agreement is never inferred from an absent row.

The source bytes and current document parser layout remain to be verified from
the publishers. The current cloud network proxy denied CONNECT to the GRANIT
host on October 12, 2026. The existing source-ladder document records a successful
earlier SOS PDF retrieval, but the repository does not hold those PDF bytes.
Earlier recorded SOS evidence says Newbury belongs to Merrimack 7 and is not
covered by a floterial; the source cross-check must resolve this before any
Newbury address is assigned an overlay.
