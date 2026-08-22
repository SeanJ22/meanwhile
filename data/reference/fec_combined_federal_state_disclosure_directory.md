# fec_combined_federal_state_disclosure_directory.csv — source note

## Source
- **Landing page:** https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/combined-federalstate-disclosure-and-election-directory/
- **Source document (PDF):** https://www.fec.gov/resources/cms-content/documents/cfsded.pdf
- **Publisher:** Federal Election Commission (United States).
- **Columns:** jurisdiction, office, records_held, url, email, phone, directory_page. 349 rows across 56 jurisdictions.

## The PDF is NOT committed, and this is why

RULING 69 says these documents land here. RULING 20 says PDF binaries do not go in git — they are
content-addressed outside the repo with their hashes committed, while reference data and all provenance
stay in git. Both hold if what is committed is the CONTENT rather than the container.

So the directory's offices are committed as the CSV beside this note, and the PDF is identified here:

- **Bytes:** 2347174
- **SHA-256:** `0a30a76fb056f4708d6edaff96b3be6b026f4cc7f36f65b2cf1bed6a5bd0d22c`

Re-fetch it with `corepack pnpm fec:directories`; the hash above is what to check it against.

**The conflict between RULING 69 and RULING 20 is named on a Needs Sean tracker row rather than settled
by a session.** `CLAUDE.md`: a ruling that contradicts another does not silently win — the conflict is
named, and the author rules.

## What it covers

All 50 states, the District of Columbia, American Samoa, Guam, the Northern Mariana Islands, Puerto Rico
and the US Virgin Islands. For each: the federal disclosure offices, the legislative committees dealing
with elections, the legislative committees dealing with ethics, and nine national and international
associations dealing with campaign finance and elections.

Every one of those is a manifest CANDIDATE — a body that may publish something a candidate can be
reached through. They are named in `docs/branch-manifest.md` as candidates rather than silently added:
RULING 61 adds a route when it has been WALKED somewhere, not when a directory says the office exists.

## What New Jersey's entry names — the direct test

Six offices: the Department of State's Division of Elections (candidates on ballot, election results,
federal campaign-finance reports); the Election Law Enforcement Commission (state and local campaign
finance, personal financial reports, lobbying, pay-to-play); the State Ethics Commission; the Office of
Legislative Services; the Department of the Treasury (political-contributions compliance, and corporate
registration); and the Attorney General.

**It names WHO the authority is and how to reach a human there. It does not say what that authority
PUBLISHES.** So it does not tell the next state whether its county clerks put a filed email in a PDF the
way Morris County's does — that still takes a walk. What it removes is the part that used to take
longest: finding out who to walk to.

It has already paid for itself once. `elec.nj.gov` has been recorded in this repo as Imperva-walled
since 2026-08-19 and was still walled on re-walk. That was read as *ELEC is unreachable*. It is not: it
is ELEC's WEBSITE that is unreachable, and this directory hands over a named Executive Director, a
telephone number and a postal address for the same records — a compliant route straight to rung 13 that
no WAF can refuse. Recorded as a sub-branch on `filing-campaign-finance-state`.

## Acquisition
- Fetched 2026-08-22 by `corepack pnpm fec:directories`, rung 2 (plain fetch).
- Landing page: HTTP 200, 33202 bytes.
- PDF: HTTP 200, 2347174 bytes, text layer extracted and parsed.
- **The PDF link is read off the landing page's own hrefs, never hardcoded.** The Morris County Clerk
  republishes at a new version path on every revision and both revisions stay reachable; a hardcoded URL
  reads a superseded edition as current. The same hazard applies here.
- The PDF is checked for its `%PDF` magic bytes before being parsed, so a challenge page served at 200
  cannot be read as a federal directory.
- A zero-row parse exits NON-ZERO with the reason.

## Licence
- **Public domain.** A work of the United States federal government (17 U.S.C. § 105).

## Trust caveats
- An edition, as served on the fetch date. Re-run to refresh.
- The parse reads the layout's `*` cell breaks and its ALL-CAPS office headings. Both are properties of
  the FEC's current template, and a template change would show up as a falling office count rather than
  as wrong rows — which is why the count is asserted in `tests/reference-data.test.ts` rather than
  eyeballed.
- `records_held` is the directory's own phrasing, concatenated. The layout interleaves the record labels
  with the office's address block, so some rows carry an address fragment inside that field. It is left
  as the document printed it rather than cleaned, because guessing where a label ends would invent
  structure the document does not have.
