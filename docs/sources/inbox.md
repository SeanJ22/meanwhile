# The source inbox

**Sean: drop anything in here. No format. No fields. No ceremony.**

A bare link. A pasted note. A file name. A half-formed *"I think the county
publishes this somewhere."* All of it belongs. If it takes effort, it will not
get used, and an unused store is worse than none because its existence implies
coverage that is not there.

**The half-formed entries are precisely the ones that otherwise get lost**, so
the format must not turn them away.

---

## Why this exists

Sessions register what they discover. **Sean has had no path at all** — links he
finds live in a chat window, which no session can read. That is the same failure
that left the 8/22, 8/24 and 8/25 feedback documents somewhere a session could
not reach (`NS16`, `NH181`, and RULING 108, which says anything a session must
read at session start lives in the repo).

**A found source that is not written down is a source that will be hunted
again.**

## What happens to what you drop here

Every session drains this file. The drain is wired into the session-open path,
so it happens whether or not a brief mentions it:

1. Read the inbox.
2. Do the full registration work on each entry — classification, licence,
   access, coverage, freshness, the primaries it points to — per RULING 166's
   tier order and the field contract in `states/<state>/sources.md`.
3. Move it into the right state's registry, or into `docs/sources.md` where it
   is national.
4. Leave the inbox empty.
5. Report **N drained · N registered · N unresolvable with the reason**.

**An entry too vague to resolve stays put with a note.** It is never deleted.
That is the one rule, and it is what makes dropping a half-formed thought safe.

---

## Inbox — waiting

*(empty)*

---

## Drained 2026-08-26 — the sources-and-incumbency session

**22 entries drained · 22 registered · 0 unresolvable.**

Seeded two ways, because neither is trustworthy alone: a repo-wide URL sweep
(`pnpm url:sweep`), and the links Sean surfaced directly plus his full project
bookmark set.

**The bookmark export file itself is NEVER committed.** `bookmarks_8_26_26.html`
contains personal, employment and financial URLs that have no place in this
repository. It was not read and is not on disk here; the civic entries were
taken from the brief's transcription of it. **Confirmed not committed:** no file
of that name exists in the tree.

### Registered into `states/nh/sources.md`

| Entry | Outcome |
|---|---|
| `sos.nh.gov/lobbyists` | PRIMARY. **Walled — HTTP 403 at rungs 2 and 3, 2026-08-26** |
| `cfs.sos.nh.gov/public/cf/downloads` · `/reports` · `/contribution` | PRIMARY. Same wall, same date |
| `cfs.sos.nh.gov/login` | **Registered as NEVER TO BE WALKED.** A login page is an access control |
| `gencourt.state.nh.us/downloads/` | PRIMARY, **rung zero**. Redirects to `gc.nh.gov`; 408-row Member Data file pulled |
| `gc.nh.gov/house/members/member.aspx?member=377093` | PRIMARY, the member-page URL pattern. Registered with the finding that the `member=` id is neither `seatno` nor anything in the bulk file |
| `citizenscount.org` · `citizenscount.org/nh` | **DERIVED-POINTER**, Live Free or Die Alliance. Terms page **404** — no permission asserted. Both primaries it points to are now registered |
| `gc.nh.gov` | Registered, and **noted as canonical** against `gencourt.state.nh.us` |

### Registered into `states/az/sources.md`

| Entry | Outcome |
|---|---|
| `az-civic-tools/az-civic-tools` | **DERIVED-POINTER**, MIT. Registered as the **Arizona external reconciliation anchor**. Its advocacy-organisation recommendations are **excluded affirmatively** |
| `azleg.gov`, `azleg.gov/arsDetail/?title=16` | PRIMARY, rung one. § 16-928 read and quoted |
| `irc.az.gov` | PRIMARY. Rung-3 wall; the TIGER comparison is rowed |
| `azsos.gov` — campaign finance, lobbying, county contacts, calendar | PRIMARY, four divisions, all HTTP 200 |
| `seethemoney.az.gov` | PRIMARY, HTTP 200 |
| `apps.azsos.gov/cfs/Bulk_Filing_Guide.pdf` | PRIMARY. **Led to `ftp://ftp.azsos.gov/cfsdata2/` — 8,828 committees, 109 filing jurisdictions** |
| `azcleanelections.gov` | PRIMARY |
| `apps.azsos.gov/equal/` | PRIMARY, registered as a civic-action mechanism |
| `lgd.azleague.org` | DERIVED-POINTER, a league of municipalities |
| `pima.gov/620/Campaign-Finance` · `pimacountyaz.easyvotecampaignfinance.com` · `tucsonaz.gov/.../Campaign-Finance-Information` · `legacy.recorder.maricopa.gov/...` | PRIMARY, local filing officers. **EasyVote noted as a VENDOR; the tenant-list question is rowed** |
| `results.arizona.vote` · `my.arizona.vote` | PRIMARY, registered, not walked |
| `markng/theyworkforaz` | Registered **ARCHIVED**, historical only |
| `qstin/LegiScanApiScripts` | Registered as client tooling, **not a source** |
| `State-of-Arizona` GitHub org | **Not civic data.** `az_site_sliver` recorded as an official-site fingerprint |
| `vailschooldistrict.org/page/governing-board` | PRIMARY, HTTP 200 at 1,443,974 bytes, 2026-08-26 |
| `vailschooldistrict.community.highbond.com/...` | Diligent Community portal. **Diligent is an existing wired adapter** |
| `facebook.com/SEArizonaCouncil/` | Party-hosted page class, RULING 122 / RULING 145 |

### Registered into `states/nj/sources.md`

| Entry | Outcome |
|---|---|
| `nj.gov/nj/gov/county/localgov.shtml` | PRIMARY, already wired; re-walked and re-measured |
| `elec.nj.gov` | PRIMARY, **Incapsula challenge at HTTP 200 with a 212-byte body**, re-confirmed |
| `njelecefilesearch.com` | PRIMARY, wired |
| `njleg.state.nj.us` | PRIMARY, rung one, HTTP 200 at 928,917 bytes. **Bulk question open** |

### Registered nationally, or classified and set aside

| Entry | Outcome |
|---|---|
| `fecgov/FEC` · `api.open.fec.gov` | PRIMARY, wired. Confirmed body-not-intermediary |
| `LibraryOfCongress/api.congress.gov` · `api.congress.gov` · `congress.gov` | PRIMARY, wired |
| `congress.gov/help/using-data-offsite` | **Registered as a TERMS document that has never been read.** Rowed |
| `legiscan.com/legiscan` | DERIVED-CONTENT, CC BY 4.0, wired |
| `cisagov/dotgov-data` | PRIMARY (CISA's own repository), wired |
| `open.pluralpolicy.com` | DERIVED-CONTENT, CC-0, wired |
| `unitedstates/congress-legislators` | **DERIVED-CONTENT.** A community-maintained repository, not a government publication — see the body-or-intermediary audit |
| `codeforamerica/open-civic-datasets` | Walked 2026-08-26, README 24,630 bytes. Registered as a **discovery accelerator** |
| `api-evangelist/data-gov` | Walked 2026-08-26, README 9,311 bytes. Registered as an index of the federal open-data catalogue |
| `gathergov.com/api` | **COMMERCIAL, and it is not a civic-meetings product.** Its own page reads *"America's Real Estate Development Pipeline"*, operated by Turl Street Group LLC. **No pricing and no licence published** — sales-gated behind *Book a Demo*. Registered and costed as UNPUBLISHED. **Nothing proposed**: the free-source floor stands |
| `americaspoliticalpulse.com` and its FEC-ID candidate pages | Walked, HTTP 200 at 2,977 bytes. **Whether this is the Polarization Research Lab source already in use under CC BY 4.0 is UNRESOLVED** — the page is too thin to tell, and guessing would put a wrong licence in the register |
| `govtrack.us` | DERIVED, federal. `robots.txt` refuses a plain fetch and answers at rung 3. Already recorded in `docs/source-ladder.md` as a LOOKUP RUNG, never a citation |
| `breakfreegraphics.com/design-blog/neumorphism-in-user-interfaces/` | **NOT a civic source.** A design reference. Recorded in `docs/DESIGN.md`'s references, and deliberately NOT registered as a source |

### `pnpm state:discover --state nh` — New Hampshire — **THE ENGINE RETURNED NOTHING**

Run 2026-08-26. 28 queries asked; **every one produced a page indistinguishable
from the page an impossible query produces** (control: 7268 B, 0 result
URL(s)). That is a WALL at `4get`, dated, and it is NOT a finding about New Hampshire.

**The queries asked, so the next session can see what was not answered:**

- `New Hampshire campaign finance reports search`
- `New Hampshire campaign finance bulk data download`
- `New Hampshire campaign finance filing officer statute`
- `New Hampshire legislature member data download`
- `New Hampshire legislature bulk data`
- `New Hampshire legislature API documentation`
- `New Hampshire legislature roll call votes`
- `New Hampshire legislature github`
- `NH civic tools github`
- `New Hampshire open source legislature data`
- `New Hampshire secretary of state elections division`
- `New Hampshire candidate filings list`
- `New Hampshire election calendar dates`
- `New Hampshire lobbyist registration search`
- `New Hampshire lobbyist registry`
- `New Hampshire open data portal`
- `New Hampshire data catalog gov`
- `New Hampshire league of cities and towns directory`
- `New Hampshire municipal association member directory`
- `New Hampshire county clerk directory`
- `New Hampshire county election officials contact`
- `New Hampshire civic tech project`
- `New Hampshire legislature bill tracker open source`
- `New Hampshire legislature submit testimony online`
- `New Hampshire sign nomination petition online`
- `New Hampshire request to speak committee hearing`
- `usa.gov New Hampshire local governments`
- `New Hampshire list of municipalities official websites`
