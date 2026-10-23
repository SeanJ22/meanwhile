# Special-district boundary layers

`district-boundary-sources.json` lists the public boundary layers `scripts/district-territories.mts` reads to give
special districts (fire, water, sewer, library, park, hospital, irrigation, drainage, transit, conservation,
community-facilities and others) their own territory. 422 layers across all 50 states, DC and Puerto Rico: state
agencies' statewide layers first, county GIS layers where no statewide layer exists, and the U.S. Environmental
Protection Agency's Community Water System Service Area Boundaries
(<https://www.epa.gov/ground-water-and-drinking-water/community-water-system-service-area-boundaries>), filtered by
primacy agency, for each state. Every layer was checked from the build machine on 2026-10-22 with a feature count and
sample names before it was listed.

Each row names its publisher, the layer URL (an ArcGIS REST layer or a GeoJSON file), the field holding the district
name (or `nameTemplate` when the layer numbers districts), the district kind or the field and values that give it, an
optional `where` filter (active districts only, one state of a national layer) and the layer's county when it is a
county layer. `unmatched` says whether a feature that names no Census of Governments special district is still listed
(`list`: the layer draws only special districts, such as a county's community development districts) or ignored
(`skip`: the layer also draws cities' and companies' systems, such as water service areas).

The file carries no districts, only where to read them; adding a layer is a data change followed by a rebuild.
Layers that could not be reached from the build machine (Mississippi's MARIS, Wyoming's state GIS host, several county
servers) are not listed; each state's gaps are in the lane's report.
