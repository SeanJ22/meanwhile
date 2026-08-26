# The body-or-intermediary audit

**Walked 2026-08-26**, the sources-and-incumbency session, Item 1 of that brief.
This is RULING 166's retroactive half: for every data class this product uses,
is the source **the body that holds the record**, or **an intermediary**?

**Every intermediary is a place where staleness, coverage gaps and an outside
party's editorial judgement enter without announcing themselves.** So each one
below records what the BODY publishes, whether we have ever walked it, and —
where both exist — whether the two agree.

**A disagreement between an aggregator and the body it aggregates is a P1
finding.** Two are recorded here and both are rowed.

---

## The table

| Data class | Source in use | Body or intermediary | What the body itself publishes | Have we walked it? | Do they agree? |
|---|---|---|---|---|---|
| **Officials — federal** | `unitedstates/congress-legislators` | **INTERMEDIARY.** A community-maintained GitHub repository, not a government publication | `clerk.house.gov` and `senate.gov` member data; the Congressional Directory via GPO | **Partly** — the roll-call XML is walked directly; the ROSTER is not | Not compared. `NH211` |
| **Officials — state legislators** | Plural / Open States bulk CSV (CC-0) | **INTERMEDIARY** | each legislature's own roster. NH: `gc.nh.gov/downloads/Members.txt`. AZ: `azleg.gov/memberroster`. NJ: `njleg.state.nj.us` | **NH: YES, 2026-08-26.** AZ and NJ: reachability only | **NH: a NAME-FORM disagreement, and it is material.** See below |
| **Officials — local** | each body's own website (`pnpm roster:hunt`) | **BODY** | — | yes | n/a |
| **Roll calls — federal** | `clerk.house.gov` / `senate.gov` XML | **BODY** | — | yes | n/a |
| **Roll calls — state** | **LegiScan** (CC BY 4.0) | **INTERMEDIARY** | NH: `gc.nh.gov/nhgcrollcalls/` and the public `rollcallhistory` table. AZ: `azleg.gov`. NJ: `njleg.state.nj.us` | **NO — none of the three** | **A COUNT disagreement, reconciled.** See below |
| **Meetings** | Legistar, BoardBook, CivicPlus, Revize, IQM2, OnBase, Apptegy, Diligent, `clerksboards`, `ical`, `schedulepage` | **VENDOR** — the records are the body's, the site is a third party's. `CLAUDE.md` types a vendor portal as deliberately NOT official | each body's own posted agenda and minutes | yes, per body, through the vendor | n/a — the vendor serves the body's own document |
| **Filings — NJ ballot** | Morris County Clerk | **BODY** | — | yes, daily | n/a |
| **Finance — federal** | OpenFEC | **BODY.** The FEC is the body that holds the filings | — | yes | n/a |
| **Finance — state (NJ)** | `njelecefilesearch.com` | **BODY** (ELEC's own search host) | ELEC | yes | n/a |
| **Finance — state (NH)** | none in use | — | `cfs.sos.nh.gov` | **NO — walled, HTTP 403 at rungs 2 and 3, 2026-08-26** | n/a |
| **Finance — state (AZ)** | none in use | — | `seethemoney.az.gov` and `ftp://ftp.azsos.gov/cfsdata2/` | **The FTP: YES, 2026-08-26. 8,828 committees.** Not yet wired | n/a |
| **Photos — federal** | `unitedstates/images` (GPO pictorial directory) | **INTERMEDIARY of a body publication** | the GPO's own release | via the mirror | not compared |
| **Photos — state/local** | four-door hunt, per person | mixed | each body's member directory | **NH: walked 2026-08-26 and it does NOT carry one for the reported instance** — Ebel's member page serves `nophoto.jpg` | n/a |
| **Districts and geography** | Census TIGER/Line, ZCTA | **BODY** (federal) | — | yes | **AZ: NOT compared against `irc.az.gov`, the commission that DRAWS them.** `AZ20` |
| **School districts** | NCES CCD | **BODY** (federal) | — | yes | n/a |
| **The official universe** | 2022 Census of Governments | **BODY** (federal) | — | yes | n/a |
| **`.gov` registry** | `cisagov/dotgov-data` | **BODY** — CISA's own repository | — | yes | n/a |
| **Municipal directory (NJ)** | `nj.gov/nj/gov/county/localgov.shtml` | **BODY** | — | yes, re-walked 2026-08-26 | n/a |
| **Discovery** | Wikipedia | **INTERMEDIARY**, and declared as one — discovery only, never a source of record (RULING 87) | — | n/a | n/a |
| **Positions / statements** | first-party questionnaire | **OURS** — original data, symmetric by construction (RULING 112) | — | n/a | n/a |

---

## The two disagreements, and both are P1

### 1. NH state legislators — LegiScan's names are not the body's names

Not a count problem. **A NAME-FORM problem, and it is the one that produced a
false public claim about a named person.**

| Where | | | |
|---|---|---|---|
| the ballot corpus (the FILED name) | Karen Elizabeth Ebel | Gregory M. Sargent | Daniel E. Innis |
| the General Court's own roster | Karen E. Ebel | **Greg Sargent** | **Dan Innis** |
| the officeholder registry (Plural) | Karen Ebel | **Greg Sargent** | **Dan Innis** |

**Candidates file under legal names and serve under working names.** Every one
of these is one person. A join on a name string breaks on two of the three, and
the first version of this session's own matcher broke on exactly those two —
found before shipping, which is the whole of RULING 157.

### 2. NH legislature — the two publications count different populations

| | Rows |
|---|---|
| `gc.nh.gov/downloads/Members.txt`, read 2026-08-26 | **408** (384 House, 24 Senate) |
| LegiScan's NH dataset, `peopleSeen`, snapshot 2026-08-26 | **426** |

**They differ by 18, and 18 is exactly the number of rows the body's file marks
`Former`.** That reconciles: the two are counting different populations at
different moments, and neither is wrong.

**What IS a finding is the third number.** LegiScan's NH `peopleMatched` is
**85 of 426**. So **341 New Hampshire legislators' roll calls sit in a committed
snapshot in this repository and reach no reader**, because the join to our
officeholder records fails. Nationally: `peopleSeen` 638, `peopleMatched` 130 —
AZ 24 of 92, NH 85 of 426, NJ 21 of 120.

---

## What this audit changes

**Nothing is removed.** LegiScan is a good source and stays; so does Plural, so
does the GPO mirror. What RULING 166 changes is the ORDER: the body's own
publication is walked first, and what it carries is recorded, before an
aggregator is reached.

**The measured consequence on adoption day:** the New Hampshire General Court's
own bulk file carries a **phone for 266 legislators and a work email for 406**,
plus committee assignments and `electedStatus`, in ONE fetch — three
Kelly-standard fields for the whole legislature, from a file nobody in this
project had opened, while the aggregator route was the only one wired.
