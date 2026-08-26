# The four pilot zips, against the registries they never had

**Item 7 of the sources-and-incumbency brief, 2026-08-26.**

New Hampshire, New Jersey and Arizona were all hunted with **no source
registry**. RULING 86 has required one since 2026-08-22 and nothing could tell
whether a session had built one. Now three exist, and the honest question is:
**what did the hunts miss that a registry would have caught?**

## The headline

| State | Sources now registered | Not previously known | PRIMARY |
|---|---|---|---|
| **New Hampshire** | **85 rows** in `states/nh/sources.md` | **9** | 7 |
| **Arizona** | **87 rows** in `states/az/sources.md` | **21** | 14 |
| **New Jersey** | **57 rows** in `states/nj/sources.md` | **2** | 1 |

*Row counts are what `checkStateRegistry` reads, which is the same number the
RULING 86 gate acts on — never a hand count. "Not previously known" is a source
absent from `docs/sources.md` before this session.*

**Arizona is the outlier and the reason is A.R.S. § 16-928.** Federated filing
means 109 separate filing officers, so a state whose local money is statutorily
scattered produces the most previously-unknown sources — and none of them was
hard to reach. The state names them itself.

## What the hunts missed, by weight

1. **`gc.nh.gov/downloads/` — the NH General Court's bulk roster.** 408 rows,
   406 emails, 266 phones, committees, `electedStatus`. **Six New Hampshire
   sessions hunted state legislators through LegiScan.** This is the finding
   RULING 166 was adopted over.
2. **`ftp://ftp.azsos.gov/cfsdata2/` — 8,828 Arizona committees and the state's
   own 109-jurisdiction filing table.** Anonymous FTP, named in Arizona's own
   Bulk Filing Guide.
3. **The public `NHLegislatureDB` SQL Server.** Live, and its schema joins
   legislators to roll calls on a stable identifier.
4. **`azsos.gov/elections/lobbying`.** The only lobbyist registry this project
   has reached in any state.
5. **The Secretary of State as a BODY.** Five distinct civic datasets under one
   roof, in every state, and no session had ever walked it that way.

## The two named rows, tested against the new registries

**A DISCREPANCY FIRST, because it changes what can be answered.** The brief names
`BC-28` and `OFF-6`. **Neither is a tracker row id in this repository** —
searched across both stores, 2026-08-26, zero matches for either, and no `OFF-*`
id exists at all. They are ids from Sean's visual-feedback lists. The SUBJECTS
are traceable and are answered below; the ids are reported as not-found rather
than silently mapped onto whichever row looked closest.

### `BC-28` — *Morris Hills Regional School District returns "we haven't sourced who runs it yet", in a state whose hunt reported complete*

**Does the NJ registry contain a source that would have answered it? YES —
and it was already wired.**

`nj.gov/nj/gov/county/localgov.shtml` carries every New Jersey county and
municipality with its official website, and the Morris County Clerk is wired for
filings. What neither reaches is a **regional school district**, which is not a
municipality and does not appear in a municipal directory.

**The source that WOULD answer it is NCES**, already wired as the official
universe for school districts — and `HD14` is open in the tracker for exactly
this district's board seats.

**So: a process defect, and a narrow one.** The hunt did not walk what was
available *for school districts specifically*, and the NJ registry as it stands
today would not have caught it either — **`states/nj/sources.md` has no
school-district row**. That gap is now visible because the registry exists to be
looked at, which is the whole argument for having one. Rowed.

### `OFF-6` — *superintendent photos*

**Does any state's registry contain a district-directory source that would have
supplied them in bulk? NO, and the answer is measured rather than assumed.**

- **Arizona:** `vailschooldistrict.org/page/governing-board` walked 2026-08-26,
  HTTP 200 at 1,443,974 bytes. It is a district's own governing-board page —
  a per-district route, **not a bulk directory**.
- **New Hampshire:** the General Court's member directory was expected to be a
  bulk photo primary and **is not** — Ebel's own member page serves
  `nophoto.jpg`.
- **NCES**, the one genuinely bulk school-district source, publishes district
  identity and finance. **It does not publish portraits.**

**There is no bulk portrait source for superintendents in any of the three
states, and that is a finding rather than a gap in the hunt.** A superintendent
is an appointed official whose photograph appears on their district's own site
or nowhere — one district at a time, by construction. Under Item 6's buckets
this is **(d)**: a person typed it, or in this case a district's communications
office posted it, and the remedy is labour rather than a crawler.

*And RULING 118 governs what happens when one is found: an appointed official
never carries the govern verb, and `NH166` already records the TUSD
superintendent's photo as unsourced with its reason.*

## What the registries change going forward

**The RULING 86 gate is now enforceable**
(`lib/hunt/state-registry-gate.ts`): a hunt for a state with no
`states/<code>/sources.md`, or with fewer than five source rows in it, **throws
and names the file to create**. Proved against a constructed registry-less
state — Vermont — which is refused at every stage and removed afterwards.

**And `pnpm state:discover --state <code>` runs the pass** that builds one,
proposing into `docs/sources/inbox.md` and never registering on its own.
