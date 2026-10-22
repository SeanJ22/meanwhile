# Officials checks and stated vacancies

Each officeholder a reader sees is checked against the office's own current list, and a seat the official source says is empty shows as vacant. A missing holder is never read as a vacancy. The same code serves every state; what differs by state is data.

## Congress

`lib/officials/chamber-directory.ts` reads the House Clerk's member list and the Senate's contact list for each state (`congress-bulk-roster:<ST>`). The Clerk lists every seat. A seat the Clerk names a member for is held by that member, and a seat whose row carries the Clerk's "Vacancy due to…" footnote is vacant, with the predecessor's vacate date as `since`. A mirror holder the Clerk contradicts is removed; a Clerk or Senate member the mirror lacks is added from the chamber's own row. An agreeing mirror holder keeps the mirror's richer record. The chambers' last lists are saved on the read model (`chambers`), so every later mirror step checks seats against them, and a failed chamber read keeps the last verified list. A partial list changes only the seats it names.

## State legislatures

The `official-state-people` source (`lib/sources/people/legislature.ts`) reads each legislature's own roster pages, listed in `data/reference/official-legislature-rosters.json`, along with the member pages it already holds. A bounded row or card that names one district and says, in a label of its own, that its seat is Vacant becomes a `SeatVacancy` in the page's own words, with any departure date printed beside it. A district number comes from the row's text or from the column its table header names District; the chamber comes from the page's address, table and headings, then the row. The vacancy also records who else that page lists in the same division (`heldBy`).

Publication (`lib/civic-data/people-source-publication.ts`) checks that each vacancy's words are on the saved official page, like every person. `mergePeopleSets` carries vacancies through every composition and removes another source's claim to a vacant division unless the stating page lists that holder, so a two-member district keeps its listed member. A reread page replaces its earlier vacancy. The reader shows a vacancy on a seat with no remaining holder (`lib/reader/coverage.ts`), with its source.

## Admin's officials check

**Check officials now** (`officials.checkNow`, `lib/control-plane/gateway/officials-action.ts`) resolves a state, county, district or ZIP against held Census geography and marks every registered people feed covering it to be read now. A people feed covers the country or one state by its contract scope (`lib/doors/people-feeds.ts`), so no state list exists in code; portraits are not part of the check. Missing feed rows are created from their registered contracts on the first check. A later check renews the marks.

On the next runner pass each marked feed is an ordinary due request for its own contract (`doorPartitionIds`, `routineDueRequestFor`). The runner hands the request time to the child as `WTP_SOURCE_CHECK_AFTER`, and every known-release read in that child checks the publisher again if its held check is older, keeping the bytes' original date when unchanged.

Each people candidate and federal directory candidate saves the seats its read changed (`changes`, `lib/officials/roster-changes.ts`): new and changed holders, departures stated by a vacancy, a successor or a removed link, and new vacancies. Admin's Officials card (`/api/admin/v6/officials`, `lib/control-plane/admin-view/officials-results.ts`) shows each covering source's runner outcome since the check and the changes touching the place, each with its source.

**What I heard** saves the owner's note as Scout instructions (`lib/control-plane/officials-leads.ts`). It runs only inside a funded mission for that state and settles only when a Scout's verified work completes; the note itself is never evidence.

## Still open

- Named districts (for example Massachusetts' "16th Middlesex") are not yet matched to their Census divisions, so their stated vacancies wait.
- Legislatures that publish their rosters only through an API (Alabama, Delaware, Georgia, Montana, Rhode Island, South Dakota, Utah, Vermont, Wyoming) have no roster page in the data file yet; their member pages are still read.
- Senate vacancies: the Senate's contact list names only sitting senators, so a Senate seat shows the remaining senator and no vacancy until a Senate page stating the vacancy is read.
- Statewide officers are checked against their own official pages by `statewide-executive-sources`; a page stating an office vacant is not yet read as a vacancy.
