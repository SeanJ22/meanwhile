# Real Census 2020 AIANNH source fixtures

Acquired from the original Census files on 2026-10-12. Source URLs, exact byte
counts, SHA-256 digests, original archive member names and fixture digests are
in `aiannh2020-source-evidence.json`.

`aiannh2020-tribal-components.zip` retains the seven complete, original SHP
polygon bodies and corresponding original DBF row bytes for the reference
components. Only container framing changes: selected SHP records are renumbered,
the SHP file length and DBF row count are updated, and the ZIP contains those
SHP/DBF files with the untouched original CPG/PRJ sidecars. Vertices, rings and
attribute values are neither simplified nor invented. It is a reduced fixture,
not the full national source archive.

`aiannh2020-blockassign-referenced.zip` contains the exact original member name
`BlockAssign_ST23_ME_AIANNH.txt`, its untouched header and all 366 original
rows assigned to the five referenced AIANNH codes. The real source header
spells its component column `COMPTYP`; the previous parser's `COMPTYPE`
expectation rejected these bytes and has been corrected.

`aiannh2020-zcta-block-referenced.txt` retains the untouched UTF-8 BOM/header
and all 366 original national relationship lines matching those block IDs. The
full source was streamed, not truncated or sampled, and its SHA-256 is
`7f077624d252fc1cc5a2d1100be07cfe038ffc152bfe193561d068b4def6bbbf`.
Only the bounded referenced lines are saved in the fixture. Each row retains
the full ZCTA land denominator from the national source.

The actual Houlton trust-land feature (`1530T`) supplies the positive test
point: latitude `46.1888323`, longitude `-67.8072179`. This point is inside the
real 2020 trust-land polygon and the combined `1530` geography, which locates
the Houlton Band legislative reference. A Portland point at latitude `43.6591`,
longitude `-70.2568` has no tribal hit. These are source-vintage tests; the
2014 polygons they replace are removed.

Houlton's actual ZIP overlaps sum to 4,280,041 square meters in `04730` over
that ZCTA's 633,579,881-square-meter denominator and 936,212 in `04760` over
199,056,953. Tests also run the acquisition function with the real archive
members and real relationship rows, producing all five combined areas and
24 positive-land ZIP edges. A separate arithmetic test covers the full
cross-state denominator and rejects contradictory denominators.

The actual acquisition function also ran against all three original live
sources, with the existing proxy and a 120-second caller deadline. It finished
in 103.24 seconds and produced the same five areas and 24 edges. Its three
source hashes matched the independent acquisition. This verifies the source
path and bounded result, not the still-dependent shared seat linker or live
reader publication.
