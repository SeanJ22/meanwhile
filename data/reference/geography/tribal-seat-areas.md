# Tribal legislative seats and Census areas

The JSON maps each legislative district string to its nation's exact Census
AIANNH component GEOIDs. It is reference data; state and nation names do not
choose a code path. Reservation (`R`) and off-reservation trust-land (`T`)
components retain their Census identities.

The Department of the Interior's Census tribal crosswalk, captured on
2026-10-12 at commit `286ba0ce7943d5a4092f7cfb3cb3cf94cc9c284d`, identifies
Houlton Maliseet as 1530, Penobscot as 2760, and the Passamaquoddy nation as
Indian Township (1575), Passamaquoddy Trust Land (2695), and Pleasant Point
(2850). The crosswalk cites the Census 2020 national AIANNH codes. The exact
component GEOIDs were also read from the real TIGER/Line 2014 GeoJSON mirror
at boundaryissues/TIGER2014 commit
`e6325ba3074e1668c6c4fe4c0d4e65c940e87d16`:
`1530R`, `1530T`, `2760R`, `2760T`, `1575R`, `2695T`, and `2850R`.

- Crosswalk: <https://github.com/DOI-DO/census-tribal/blob/286ba0ce7943d5a4092f7cfb3cb3cf94cc9c284d/data/census-tribal_FRNEntityCICD_CensusGeography.csv>
- Census code source: <https://www2.census.gov/geo/docs/reference/codes2020/national_aiannh2020.txt>
- Component evidence: <https://github.com/boundaryissues/TIGER2014/blob/e6325ba3074e1668c6c4fe4c0d4e65c940e87d16/native/AIANNH/tl_2014_us_aiannh.geojson>
- Legislature roster: <https://web.legislature.maine.gov/house/MemberProfiles/List?sort=seat>

Passamaquoddy Tribe and Houlton Band of Maliseet Indians are the exact district
strings in the held Open States legislator CSV. The Penobscot Nation row names
the third legislative seat; absence from Open States does not establish a
vacancy. No row declares a vacant seat. A vacancy must carry the legislature's
own roster as evidence before it is shown.

The routine acquisition uses three documented Census 2020 sources:

- TIGER/Line AIANNH boundaries: <https://www2.census.gov/geo/tiger/TIGER2020/AIANNH/tl_2020_us_aiannh.zip>
- State Block Assignment Files: <https://www2.census.gov/geo/docs/maps-data/data/baf2020/>. The archive name uses the existing Census FIPS/postal reference, such as `BlockAssign_ST23_ME.zip`. Its unique AIANNH text member follows `BLOCKID|AIANNHCE|COMPTYPE`.
- National ZCTA-to-block land relationship: <https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt>.

The official archive directory and layouts were checked through the connected
browser on 2026-10-12:

- BAF20 layout: <https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/block-assignment-record-layout.html>
- ZCTA-to-block layout: <https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/2020-zcta-record-layout.html>

Only the referenced areas' block assignments are retained. The national
relationship is streamed and joined by the verbatim 15-digit Census block ID.
The ZIP numerator sums `AREALAND_PART` for those blocks; the denominator is
`AREALAND_ZCTA5_20` from the same source. It includes both sides of a ZCTA
crossing a state line. Reservation and trust-land components form one combined
area per four-digit Census AIANNH code, so their land shares are counted once.

The national relationship is about 1 GB. The routine publisher's existing
acquisition deadline and spending controls remain in effect; a timeout or
retrieval error preserves the last published dataset and records the failure.
Actual downloads in this execution environment remain blocked by destination
policy (CONNECT HTTP 403), so the real 2020 acquisition has not been verified.
The real 2014 geometry fixture verifies point lookup, not current publication.
No guessed GRF route or nonexistent direct AIANNH-to-ZCTA table is enabled.

Per-source `checkedAt` dates captured evidence. The legislature roster was
separately retrieved through the connected browser on 2026-10-12 and lists
Aaron Dana and Brian Reynolds in the 132nd Legislature (2025); the roster
provides no affirmative vacancy statement for the Penobscot seat.

The 132nd Legislature's Joint Rules, captured through the connected browser on
2026-10-12, provide the role evidence for each seat. Rule 206(3) authorizes
sponsorship and co-sponsorship; Rule 316 provides seats and permits speaking
with the Speaker's consent. The Legislature's law library explains the same
role. These sources support the reader wording without claiming committee
voting authority:

- <https://legislature.maine.gov/uploads/visual_edit/132nd-joint-rules-2.pdf>
- <https://legislature.maine.gov/9261>
