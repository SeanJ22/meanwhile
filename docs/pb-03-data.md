# PB-03 production data corrections

On October 23, 2026, the production reader and control-plane stores were corrected as data, without a software release. Source copies, fact IDs, prior candidate versions and the existing Admin action history were retained. The code lane is separate from these live writes.

The live inventory differed from the prompt snapshot: its 37 Metro doors comprised 30 Los Angeles `metro` doors and seven already using Oregon's `oregonmetro` tenant. Those seven were kept in Oregon. Moving all 37 to California would have introduced another error.

## Applied

| Correction | Production result | Existing Admin history position |
| --- | --- | --- |
| Synthesized board labels | 1,131 names changed to their government's real name plus the appropriate board label; 74 of the 1,205 matching candidates already had the target name | 196 |
| State place links | 32 exact inventoried `entity_place` links from bodies to `/state:<postal>` were removed; district and territory links were excluded | 196 |
| LA Metro membership | Exactly 11 bodies and 91 live member facts now belong to `ca:special:los-angeles-county-metro-transit-authority`, on Los Angeles County. Their 102 total fact rows, including name/history rows, kept their fact IDs and source copies | 197 |
| Alaska REAA geography | Root applied 12 government-parent repairs, removed 12 statewide government links and inserted 15 school-territory links from existing held TIGER identities | 198 |
| Duplicate boards | Vail's three held boards became one, and Corona de Tucson Fire's two became one. Their three empty duplicate entities were removed after preserving hosts/external IDs. Rincon Valley already had one held entity; its alternate Census body ID was recorded as an alias. A Lower Kuskokwim native board alias points to its existing sourced school-board entity | 199 |
| Mobile Housing Authority territory | An immutable Alabama registration successor records the City of Mobile, GEOID `0150000`, as `SOURCE_BOUNDARY`, with the authority's own jurisdiction document retained as an additional source | 200 |
| LA Metro territory | An immutable California registration successor records Los Angeles County, GEOID `06037`, as `SOURCE_BOUNDARY`, with Metro's own board site retained as an additional source | 201 |
| Calendar ownership | One atomic update, with row locks and all expected revisions required, repaired 58 records: 30 LA Metro doors, seven Oregon Metro doors, 13 Ventura doors, seven Cape Coral doors, and one additional wrong Bay Lake door suspended | 202 |
| Additional wrong Oregon publications | 21 other LA Metro calendar-only name facts were pulled; their body records now have no reader state, parent or place. Their source evidence and history remain. The corrected California doors remain scheduled | 203 |
| Metro refresh identity | 11 operational California body aliases and two native/operational governing-board aliases resolve to the source-proven native California bodies; governing aliases use the actual regular Board of Directors body | 206 |

The 11 moved LA Metro body IDs use the California native government root `government:US-CA:cog:142274`. Exact old Oregon and statewide body IDs are retained in `entity_external_id` with scheme `body-alias`. The alias-aware entity loader and readers consume those data mappings, including the Arizona and Alaska aliases.

Every listed correction has before-values and an undo in the existing `data.repair:pb03:*:2026-10-23` Admin receipts. Receipt 196 initially carried an inaccurate nonproduction authority label; immutable correction note 205 records the actual authorized production scope. Subsequent receipts use `GOVERNED_INTEGRATION`.

Automatic approval review rejected relocating the additional 21 LA Metro calendar-only bodies beyond the explicitly named 11-body move, even after their native names were confirmed. Their wrong Oregon publication was therefore removed. It did not remain live while waiting for standing acquisition through the repaired California doors.

## Government-owned source confirmation

- [Metro's board-site explanation](https://boardagendas.metro.net/about/) directly links `https://metro.legistar.com/`. A [current official meeting page](https://boardagendas.metro.net/event/regular-board-meeting-720744bf2799/) also links its calendar. Their captured SHA-256 values are `7439aa9f045d38c9288b439ddb28f7ae2ca3c6178b150b8d0d0184230b6e0054` and `5b4a94b79f427f0bb251b98df1ea9a661678b0e9f7a4183f6c3cb78b1821dbb8`. All 30 repaired doors' native BodyIds and printed names also matched the current `/v1/metro/bodies` response, SHA-256 `aad259be6b48341968c0c0beb9ef4d58024b8744d1f7ab14100c021b5c6be5bb`.
- [Ventura's February 4, 2026 official packet](https://www.cityofventura.ca.gov/DocumentCenter/View/48808/Supplemental-Packet---General-Public-Comment_Redacted), page one, calls Agenda Center the city's website and has an actual PDF hyperlink annotation to `https://ca-ventura.civicplus.com/AgendaCenter/Design-Review-Committee-11`. PDF SHA-256: `57ac9bd1229c2ee9d3f5528caf1e8f439fc4c50687669c453c5bd477affe97c6`.
- [Cape Coral's own agendas page](https://www.capecoral.gov/departments/city_clerk/agendas_videos.php) directly links `https://pub-capecoral.escribemeetings.com/`. Captured SHA-256: `26ae6c68a071b05b1b5c3ce76a221025c7e06ae6e7d8b59050eed8841fb2a31a`.
- [Oregon Metro's own council page](https://www.oregonmetro.gov/about-metro/metro-council) links `https://oregonmetro.legistar.com/Calendar.aspx`. Captured SHA-256: `d941994ef3e65e4bdf1a6defaa38cd38a5f8290a97124a7143f851a34bf3a527`.
- [Mobile Housing Authority's 2025 admissions policy](https://www.mobilehousing.org/files/2025_MHA_ACOP.pdf) explicitly says “for the jurisdiction of the City of Mobile.” The association uses that statement, rather than an office address or county inference.

The typed production registration Reader, through the `readonly` role, returned the new Alabama and California records as `PROMOTED`, at versions `cv-pb03-al-265cebdce1846d0d6318eaa5` and `cv-pb03-ca-4b85a270031985c398746eac`. Both passed the existing candidate lifecycle validation before their exact predecessor pointers were moved. Complete validated event histories were retained, and actual apply times were separately recorded in Admin. No immutable predecessor was edited.

## All-platform rescan

The read-only scan inventoried 9,618 doors of 25 kinds and covered all 5,800 active meeting doors across 19 platform kinds: apptegy, boardbook, civicclerk, civicplus, clerksboards, diligent, document-listing, escribe, granicus, ical, iqm2, legistar, legistar-insite, official-page-events, onbase, pima-edu, primegov, schedulepage and suiteone.

The 5,704 derived doors represented 1,453 stored route groups, 616 government/tenant groups and 443 unique tenants. Public rereads returned 406 HTTP 200s, 34 HTTP 403s, two HTTP 202s and one timeout. The 96 active legacy meeting doors used 22 additional unique routes: 20 HTTP 200s, one HTTP 202 and one HTTP 404 at Vail's API base root. The 37 blocked derived responses remain unverified; they were not counted as confirmed correct bindings.

One additional mismatch was confirmed: Bay Lake's **Shortlist Selection Committee** door pointed to the **Central Florida Tourism Oversight District** portal. The [district's own public-meetings page](https://www.oversightdistrict.org/about_cftod/public-meetings/) embeds `https://pub-oversightdistrict.escribemeetings.com/?FillWidth=1`, captured SHA-256 `35099ab91dad315fbf05d660245a7a7b3f60a14f0b63c56211dfc4a109fb6fd0`. The exact wrong door was suspended in the atomic repair. Its source was not reassigned to an unproved district entity.

Inyo-Mono Area Agency on Aging sharing Inyo County's CivicClerk portal was investigated and cleared: the county's own Aging Services page explicitly establishes county-board governance, and its Board Meetings page links that portal. A shared tenant alone was not treated as a mismatch.

No current per-body MEETING partition, or California/Oregon/Florida derived-family meeting, matched the wrong body IDs in the corrected portal set. There was no matching meeting promotion to remove. A post-write read found all 91 Metro member facts on California bodies under the Los Angeles government.

A separate read-only production Oregon check found no references to the quarantined 21 IDs in the raw runtime registry. The actual `readPlacePackage` statewide Oregon read returned 79 bodies in 212.6 ms, with no quarantined IDs in its bodies or runtime registry and no Karen Bass, Janice Hahn, Hilda Solis, Kathryn Barger, James Butts or Lindsey Horvath memberships. The suppression therefore reaches the reader package; it is not only a change to an unused table.

## Lower Kuskokwim publication state

The authority's own board-site chain and current Diligent roster supplied 11 source-backed Box findings: a board name, homepage and nine member names. They were indexed through the production Box, with exact source URLs and quotes, so the standing publisher could obtain its own durable source copy.

At the last observed queue read, the normal publisher had built one live body-name fact, ID `2119448`, on source copy `70179`; the nine memberships and homepage remained waiting. The reader proof may use the built fact, but this report does not claim the nine memberships were published. The actual production capture's SHA-256 differed from the local page snapshot, so local bytes were never substituted under that production artifact's identity.

Detailed captures and before/after readbacks are in the session's ignored `.scratch/pb03` directory. Reader-page and next-scheduled-run acceptance proofs belong to the main PB-03 report; this data report does not mark the code shipped or those checks complete.

## Nationwide replay follow-up

The resumed session checked all 56 state and territory inventories. Admin receipt 207 (`data.repair:pb03:country-replay-cleanup:2026-10-23`) renamed 291 additional generated labels, removed eight direct statewide body links, and removed two empty Census-placeholder board entities. Receipt 208 (`data.repair:pb03:country-replay-final-cleanup:2026-10-23`) renamed three further labels and removed one new Colorado statewide body link created while the deployed importer still used the replaced code. Both retain exact before-values and undo in the existing Admin history. No fact or source copy was removed by these follow-ups.

The branch now fixes the registration-loader fallback-name path as well as governing-body publication, repairs held generated labels on refresh, and reuses the existing Census-placeholder exclusion. The whole-country reader and controlled next-day results, including the inherited Nevada source-registration conflict, are recorded in `docs/pb-03-replay.md`.
