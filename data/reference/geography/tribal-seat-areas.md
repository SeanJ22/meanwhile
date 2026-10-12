# Tribal legislative seats and Census areas

The JSON maps each legislative district string to its nation's exact Census
AIANNH component GEOIDs. It is reference data; state and nation names do not
choose a code path. Reservation (`R`) and off-reservation trust-land (`T`)
components retain their Census identities.

The Department of the Interior's Census tribal crosswalk at commit
`286ba0ce7943d5a4092f7cfb3cb3cf94cc9c284d` identifies Houlton Maliseet as 1530,
Penobscot as 2760, and the Passamaquoddy nation as Indian Township (1575),
Passamaquoddy Trust Land (2695), and Pleasant Point (2850). Census's national
2020 code file and original TIGER/Line 2020 AIANNH DBF were acquired on
2026-10-12. The actual DBF confirms all seven components: `1530R`, `1530T`,
`2760R`, `2760T`, `1575R`, `2695T`, and `2850R`.

- DOI crosswalk: <https://github.com/DOI-DO/census-tribal/blob/286ba0ce7943d5a4092f7cfb3cb3cf94cc9c284d/data/census-tribal_FRNEntityCICD_CensusGeography.csv>
- Census codes: <https://www2.census.gov/geo/docs/reference/codes2020/national_aiannh2020.txt>
- Census boundaries: <https://www2.census.gov/geo/tiger/TIGER2020/AIANNH/tl_2020_us_aiannh.zip>
- Legislature roster: <https://web.legislature.maine.gov/house/MemberProfiles/List?sort=seat>

Passamaquoddy Tribe and Houlton Band of Maliseet Indians are the exact district
strings in the held Open States legislator CSV. The Penobscot Nation reference
names the third legislative seat. Absence from Open States or the current
roster does not establish a vacancy. No reference declares a vacant seat; a
vacancy requires the legislature roster's affirmative statement and source.

The current roster and member profiles acquired on 2026-10-12 list Aaron Dana
for the Passamaquoddy Tribe and Brian Reynolds for the Houlton Band of Maliseet
Indians in the 132nd Legislature. Their profiles explicitly call their seats
non-voting tribal memberships. The roster provides no affirmative vacancy
statement for the Penobscot seat.

- Aaron Dana: <https://web.legislature.maine.gov/house/MemberProfiles/Details/1507>
- Brian Reynolds: <https://web.legislature.maine.gov/house/MemberProfiles/Details/3140>

The 132nd Legislature's current Joint Rules PDF was acquired on 2026-10-12.
Rule 206(3), PDF page 9, permits sponsorship of legislation concerning Indians
and Indian land claims and co-sponsorship of other legislation. Rule 316, PDF
page 23, grants floor seats and speaking with the Speaker's consent; it says
committee memberships are **nonvoting** and the member's position must be
included in committee reports. The Legislature's law library describes the
same role. The preserved reader wording does not claim committee voting:

"Tribal representative for the {nation}. Non-voting member of the House:
sponsors bills on tribal matters, co-sponsors any bill, sits with committees
and may speak on the floor. Represents the nation's members wherever they
live."

- Joint Rules: <https://legislature.maine.gov/uploads/visual_edit/132nd-joint-rules-2.pdf>
- Law library: <https://legislature.maine.gov/9261>

Source byte counts, SHA-256 digests and exact profile/rule excerpts are in
`tribal-seat-areas-evidence.json`.

The routine geography acquisition uses three original Census 2020 sources:

- TIGER/Line AIANNH boundaries (8,890,886 bytes).
- State Block Assignment Files: <https://www2.census.gov/geo/docs/maps-data/data/baf2020/>. The archive's FIPS/postal name is derived from the existing Census reference; `BlockAssign_ST23_ME.zip` was acquired (1,141,205 bytes). Its exact AIANNH member is `BlockAssign_ST23_ME_AIANNH.txt` (850,409 bytes). The actual header is `BLOCKID|AIANNHCE|COMPTYP`; the published layout's spelling `COMPTYPE` differs from the source bytes, so parsing uses the actual header.
- National ZCTA-to-block land relationship: <https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt>. All 1,057,697,144 bytes were streamed and hashed in 33.6 seconds. It provides all 366 referenced area blocks, including 23 in Houlton's combined area.

Only referenced areas' geometry and block assignments are retained. The national
relationship is streamed and joined by the verbatim 15-digit Census block ID.
The ZIP numerator sums `AREALAND_PART` for those blocks; the denominator is
`AREALAND_ZCTA5_20` from the same source and includes both sides of a ZCTA
crossing a state line. Reservation and trust-land components form one combined
area per four-digit Census AIANNH code. It publishes five combined areas for
three legislative seats, with 24 positive-land ZIP edges. Geometry locates a
seat; it does not establish tribal membership.

The existing acquisition deadline, spending limits and pauses remain in effect.
A source error preserves the held supplemental scope and records the failure.
The verified source routes, actual archive members, checksums and reduced real
fixtures are recorded in `tests/fixtures/geography/aiannh2020-source-evidence.json`
and `aiannh2020-source-evidence.md`. No guessed GRF route or nonexistent direct
AIANNH-to-ZCTA table is enabled. This evidence verifies acquisition and point
lookup; publication, shared-linker and live-reader checks remain separate.
