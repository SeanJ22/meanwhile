# BA-01 verified national expansion

Corrected inputs use the existing daily `ballot-contests:<ST>` assembler. This
verified batch is READY for River. River ships the branch; the runner publishes
on its next daily pass; oversight checks live ballot pages. No production write
credential goes to this lane. National source coverage and the requested live
acceptance remain incomplete.

## Verified reader data prepared

Current holdings are recorded by [`ba01-inventory.json`](ba01-inventory.json).
They contain 11,608 contests,
19,860 candidacy records and 488 measures across all 50 states, DC and three
territories: +5,572 / +8,190 / +346 above the starting river, and
+2,535 / +3,411 / +206 beyond the first READY. These are raw inventory counts,
not official denominators, distinct people or live delivery counts.

Ohio's 139 core contests and 310 active choices match acquired official lists and
samples, including all 15 congressional, 17 Senate and 99 House races. Its 311th
raw core record remains as a sourced withdrawn filing. Michigan now matches all
338 candidate-bearing contests and 707 eligible names in the acquired final SOS
list, including 168 judicial races. Minnesota's 221 core contests / 427 choices
and 114 district-judge races / 117 names are checked separately. Kansas accounts
for every one of 247 races / 362 names in its official statewide table. Arkansas
accounts for all 129 regular core races plus both legislative specials.

Texas adds all 269 certified district-judge contests / 328 names, including the
sole declared write-in in District 276, plus the declared-write-in-only District
Attorney 31 special. Exact current court jurisdictions and enacted HB16 resolve
the obsolete Guadalupe entry for District 274: that court now serves Comal and
Hays. All 17 names in the statewide declared write-in certificate are accounted
for. The earlier county import holds all 1,222 countywide offices / 1,346 names
printed for all 254 counties in the final certification. Regional appeals,
prosecutor, precinct, municipal and special-district scope work remains open.

California's 58 official county-to-appellate-district memberships let San
Francisco county readers reach all eleven held First District retention races.
Los Angeles adds 34 certified county/city races / 54 candidates and 54 complete
county/city questions. Its other district races and 14 school/college measure
electorates remain open. Earlier San Francisco additions include all five
countywide candidate offices and eleven local/regional questions.

Further verified county batches include statewide county/judicial lists in
Idaho, North Dakota and New Mexico; selected Montana and Utah judicial races;
Maine's 88 local races / 108 names; New York Supreme Court and selected NYC local
races; Maryland's circuit candidates and all 48 county/city questions; selected
Ohio and Minnesota municipal/school offices; and Florida, Georgia, Mississippi
and other regional additions. Miami-Dade's 55 local questions are held; its
candidate and special-district coverage remains partial. Florida's 31 certified
unopposed core contests are legally omitted from printed ballots; the report
keeps certified-roster counts separate from actual sample counts.

American Samoa has its first verified input, 18 contests / 44 choices. The
Northern Mariana Islands hold 21 of 22 certified/sample races, 72 choices and
three explicit governor mates; Northern Islands mayor's exact electorate remains
open. The U.S. Virgin Islands hold all ten source contests / 70 choices and five
explicit mates. Guam's sample is acquired but the government publisher backlink
is not established. Puerto Rico's next regular general election is 2028; no
November3 contest is invented.

Every new candidate receives the same extraction effort and fields within its
contest, including literal independent/minor-party labels and filed websites
where supplied. No candidate is supplied for a blank write-in line. Six empty
North Dakota offices and Richland County's coroner remain explicit held gaps.

## Publication repairs and verification

The merge retains every still-cited observation, including identical bytes
captured at separate actual times, and prunes uncited observations. Authority
lookup is bound to the exact capture, with a unique-publisher fallback for legacy
measure provenance. A newly verified official list can fill a held contest. A
changed published electorate requires an explicit, newer official correction;
the Newbury Council2 correction includes that proof. Receipt replay preserves
an existing observation's publisher; a partial update cannot rewrite the authority
of a still-cited exact observation. Uncited observations are pruned independently.
Malformed optional membership metadata cannot crash an otherwise usable ballot.

The source-authority duplicate key includes retrieval time. Separate actual
captures of identical bytes are accepted, while exact duplicate observations
remain rejected. Publication checks run through the ordinary path.

The isolated Postgres-compatible copy applies all 46 real journaled migrations.
They are byte-identical to fetched River `190700561a5a5c590e03cd8e22989ec18caac1a9`.
It seeds the prior checked-in ballots from the first READY, runs the actual
assembler and Postgres store, and reads the typed promoted projection back.
Checks require every incoming complete contest, candidate and measure to publish,
every previous ballot ID to remain, and memberships and ticket mates to reach the
reader. New territory inputs also exercise their first publication. All 163
ordinary Node subtests pass, including all 54 jurisdiction publications and
source-lineage/runner checks. The unchanged source inputs retain their 54 passing
Python source-replay tests. TypeScript passes using the tracked test config,
which excludes stale generated `.next` validators. Exact commands and limits are
recorded in [`ba01-validation.json`](ba01-validation.json).

The copy contains no production rows. Automatic approval review rejected the
production snapshot read because it would transmit a configured database
credential, citing Sean's no-lane-credentials instruction. No production write
was attempted, and the rejected credential path was not retried.

## Remaining source and live work

[`ba01-national-comparison.md`](ba01-national-comparison.md) reports measured
scope for every state and DC. Major regular core gaps remain in Pennsylvania,
New Hampshire, Wisconsin and Illinois; Alaska's full core denominator is
unmeasured, and Arizona's CD3/4/8 certification limitations remain explicit.
Nebraska's entire saved source has 411 contest tuples / 521 choices: the old
64-NRD estimate was incorrect; 174 NRD races / 199 choices and 195 other
regional/local races / 230 choices remain for precise electorate mapping.
All regional/local gaps remain standing acquisition work.

[`ba01-zip-acceptance.json`](ba01-zip-acceptance.json) records all 15 requested
ZIP checks as open. NYC10001's particular official address style matches all
16 source races / 32 distinct choices / five questions in the prepared catalog;
this does not establish every address in that split ZIP. Madison53703 Central
Library, Ward52/style005, matches all11 printed races /14 choices through the
prepared reader; CityHallWard51 remains unverified against a printed sample. Fargo58102's particular
City Hall style matches all 26 races / 35 choices / three measures through the
reader selector. Minnesota55415's example has all 41 source races in the catalog,
but only40 reach the reader without explicit commissioner District3 resolution.
Regional reports distinguish other complete source sections from unfinished
address/style mapping.

No post-publication live acceptance is claimed. Austin, San Francisco and Miami
lack resolved congressional districts in the saved live baseline; Detroit lacks
a resolved state Senate district. Those resolver changes are outside the owned
files and remain necessary for the live reader result. Oversight owns the final
race-by-race checks after River and the runner. This verified expansion awaits
River integration, runner publication and those live checks.
