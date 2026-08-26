# New Jersey — the source registry

**Born 2026-08-26** (the sources-and-incumbency session, Item 2). One row per
source. See `states/nh/sources.md` for the field contract and the
classification vocabulary. `NOTES.md` in this folder is the internal dossier —
the repo's naming wins over the brief's, so there is no `dossier.md` beside it.

---

## The filing-officer statute — and New Jersey is the CENTRALISED shape

**New Jersey routes campaign-finance filing to ONE statewide authority**, the
Election Law Enforcement Commission (ELEC), under the New Jersey Campaign
Contributions and Expenditures Reporting Act, **N.J.S.A. 19:44A**. That is the
opposite of Arizona's federated routing under A.R.S. § 16-928 and the same shape
as New Hampshire's under RSA 664:7.

**THE CITATION IS RECORDED AS PARTIALLY UNVERIFIED, and that is deliberate.**
This session did not read the statutory text from an authoritative host:
`elec.nj.gov` serves an **Imperva/Incapsula challenge** (see below) and
`law.justia.com` answered **HTTP 403** at rung 3 on 2026-08-26. The chapter
citation comes from this project's own prior records, not from a read this
session performed. **A citation nobody read is a lead, not a source** — walking
it to an authoritative host is `NJ26`.

*The contrast the three states now give, which is the point of asking:*

| State | Statute | Shape | Filing officers |
|---|---|---|---|
| **Arizona** | A.R.S. § 16-928, **read 2026-08-26** | **FEDERATED** | **109** — 1 state, 15 counties, 93 cities and towns |
| **New Hampshire** | RSA 664:6, 664:7, **read 2026-08-26** | **CENTRALISED** | **1** — the Secretary of State, including for county offices |
| **New Jersey** | N.J.S.A. 19:44A, **not read this session** | **CENTRALISED** (believed) | **1** — ELEC (believed) |

---

## The state — the tier above the municipalities

### The NJ local-government directory

| | |
|---|---|
| **Name** | County and Municipal Web Sites |
| **URL** | `https://www.nj.gov/nj/gov/county/localgov.shtml` |
| **Publisher** | State of New Jersey |
| **Classification** | **PRIMARY** |
| **Licence** | **NONE STATED.** US state government work |
| **Access** | Open page, plain GET, no key |
| **Carries** | The official website of every county and every municipality |
| **Coverage** | **All 21 counties named and 618 outbound links, measured 2026-08-26.** `docs/sources.md` records 624 entities on 2026-08-22 from the committed walk — the difference is a page that changes, not a disagreement between instruments, and both numbers are stated rather than one being chosen |
| **Freshness** | **Last walked 2026-08-26**, HTTP 200, 114,118 bytes. Rockaway Township present |
| **Points to** | itself |
| **Do we use it** | **YES — WIRED**, `pnpm tier:directory --route nj-localgov` |

**The URL trap is recorded because a status check alone reads it as success:**
`nj.gov/nj/gov/county/` answers **HTTP 200 with a styled "Page not found"**. The
document is at `localgov.shtml`. Control strings are mandatory on directory
routes for exactly this reason.

### The legislature

| | |
|---|---|
| **Name** | New Jersey Legislature |
| **URL** | `https://www.njleg.state.nj.us/` |
| **Publisher** | New Jersey Legislature |
| **Classification** | **PRIMARY — rung one for New Jersey** |
| **Licence** | NONE STATED |
| **Access** | Open pages. `robots.txt` carries `Allow: /` |
| **Carries** | Bills, members, votes |
| **Coverage** | 2026–2027 Regular Session |
| **Freshness** | Walked 2026-08-26, HTTP 200, **928,917 bytes** |
| **Points to** | itself |
| **Do we use it** | **NO. LegiScan is wired instead** — the inversion RULING 166 names, in a third state. **Whether njleg publishes a BULK download has not been established** and is `NJ27` |

### ELEC — the campaign-finance authority

| | |
|---|---|
| **Name** | New Jersey Election Law Enforcement Commission |
| **URL** | `https://www.elec.nj.gov/` |
| **Publisher** | State of New Jersey |
| **Classification** | **PRIMARY** |
| **Licence** | not read — the host was not reached |
| **Access** | **WALLED, and it is only the WEBSITE.** Imperva/Incapsula: **HTTP 200 with a 212-byte body** carrying `<META NAME="robots" CONTENT="noindex,nofollow">` and an `_Incapsula_Resource` script. **A status check reads that as healthy**, which is the whole reason it is written down |
| **Freshness** | Re-confirmed 2026-08-26 at rung 2, byte-identical shape to the 2026-08-24 record |
| **Do we use it** | No — the data is reached through the search host below |

| | |
|---|---|
| **Name** | ELEC Reports and Data Search |
| **URL** | `https://www.njelecefilesearch.com/` |
| **Publisher** | New Jersey ELEC |
| **Classification** | **PRIMARY** |
| **Licence** | **NONE STATED** — no terms-of-use document and no `robots.txt` encountered on the search host |
| **Access** | Keyless `POST /api/VWEntity/Entities20` (committees) and `GET /api/VWEntity/GetEntityFilingData` (the money) |
| **Carries** | Finance — committees and filings |
| **Coverage** | Statewide |
| **Freshness** | Walked 2026-08-26, HTTP 200, 18,433 bytes |
| **Do we use it** | **YES — WIRED** |

**The distinction that matters and is easy to lose:** the WEBSITE is walled and
the DATA is not. Recording ELEC as unreachable would have been true of one host
and false of the fact.

### The county clerk — the election authority to read

| | |
|---|---|
| **Name** | Morris County Clerk |
| **URL** | `https://www.morriscountyclerk.org/` |
| **Publisher** | Morris County Clerk |
| **Classification** | **PRIMARY** |
| **Licence** | NONE STATED |
| **Access** | 403s a general-purpose fetcher; **admits this project's identified User-Agent** |
| **Carries** | Candidate filings, certified results with a Party column |
| **Coverage** | Morris County |
| **Freshness** | Rebuilt daily by `refresh-nj-filing.yml`; run 32996817397 on 2026-08-26 read the clerk's published count and found the artifact **unchanged** |
| **Do we use it** | **YES — WIRED** |

---

## The third parties

| Source | URL | Class | Licence | Use |
|---|---|---|---|---|
| **LegiScan** | `legiscan.com` | DERIVED-CONTENT | **CC BY 4.0**, attribution ships with the data | **WIRED.** NJ session 2250, dataset date 2026-08-23. `peopleSeen` **120**, `peopleMatched` **21** |
| **Wikipedia** | `en.wikipedia.org` | DERIVED-POINTER | CC BY-SA; facts extracted, prose never copied | **WIRED**, discovery only |
| **Open States / Plural** | `data.openstates.org` | DERIVED-CONTENT | CC-0 | **WIRED** |
| **Legislative caucus sites** — `assemblydems.com`, `njassemblygop.com`, `njsendems.org`, `senatenj.com` | | **Party organisation sites, NOT government publications** | NONE STATED | Usable for a member's own published contact and photo under the campaign-site and party-hosted-page rules (RULING 122); **never a source of record for a position** |

---

## What is NOT here, said plainly

- **No NJ lobbyist registry.** Not located this session. Arizona's is registered
  and New Hampshire's is walled; New Jersey's has not been looked for.
- **No NJ League of Municipalities walk.** `njlm.org` exists and was not walked.
  Less important here than elsewhere because the STATE publishes the municipal
  directory directly.
- **No public-testimony mechanism.** `njleg.state.nj.us` was walked and the
  question was not answered from it. A dated gap, not an absence.
- **No authoritative read of N.J.S.A. 19:44A.** Two hosts refused. `NJ26`.

## Freshness cadence

RULING 96 and RULING 53: candidate fields 7 days, bodies and rosters 14 days,
walled sources 14 days.
