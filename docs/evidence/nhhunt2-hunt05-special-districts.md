# `HUNT05` — the eighteen special districts at 03255, resolved

*NH Hunt 2, item 4. Walked 2026-08-21.*

**The pair: 18 of 18 resolved. TWO reach 03255. SIXTEEN do not.** Before this
run it was 0 of 18 resolved, 0 attempted.

Every one is named below with the evidence that settled it. None is recorded as
"probably not" and none is left as a count.

---

## Why geometry could not answer this, and what did

The national boundary join of 2026-08-20 resolved 47,834 of the country's
90,837 governments and **not one special district** — TIGER publishes no
boundary for any of them, at any vintage. The gap ledger recorded that
correctly and recorded the consequence: 03255 cannot leave Tier 0 while
eighteen governments over it are unresolved.

The answer was never going to be a map. It is three documents:

1. **`data/derived/zip-governments.json`** — 03255's ZCTA samples 109 points and
   **all 109 fall in Newbury town, Merrimack County**. There is no second town
   in this zip. So "does this district reach 03255" reduces to "does this
   district include territory in NEWBURY".
2. **RSA 52:1, read 2026-08-21 at rung 2 on `gencourt.state.nh.us`** — a New
   Hampshire village district is fixed by *"the selectmen of the town or towns"*
   over *"such parts of the town or towns as may seem convenient."* A village
   district's territory is a subset of the town or towns that created it. Note
   the plural: **a district may span towns, and one of these does**, which is
   why a name-based inference was not accepted for any of them.
3. **The New Hampshire Department of Revenue Administration's 2025 Village
   District Tax Rates**, read 2026-08-21 at RUNG 5 — `revenue.nh.gov` answers
   403 to rungs 2, 3 and 4, and the whole file is unarchived, so a different
   egress is the only route that reached it. It lists **106 district-rate rows**
   grouped by municipality, and it lists a district **even when its rate is
   $0.00** (Andover Village, Central Hooksett Water, Epsom Village, Hooksett
   Village Water and eleven others are in it at zero). That last property is
   what makes an absence meaningful: this is a list of DISTRICTS, not a list of
   districts that happened to tax.

A district appearing under two municipalities has an asterisk beside its name
and appears twice, once per municipality. That is how the two multi-town cases
below were caught.

---

## The two that DO reach 03255

### 1. MERRIMACK COUNTY CONSERVATION DISTRICT — REACHES (Census PID6 152224)

**RSA 432:12**, read 2026-08-21 at rung 2:

> There are hereby established … 10 conservation districts as follows: (1) each
> of the 10 counties within the state is hereby incorporated into a conservation
> district; (2) each of the 10 districts shall be known by the name of the
> county **to which its boundaries conform**.

Its boundaries conform to Merrimack County by statute. 03255 is 109 of 109
sample points in Merrimack County. The district's own site
(`merrimackccd.org`, read 2026-08-21 at rung 2, HTTP 200) says the same in its
own words: *"Conserving the natural resources and cultural heritage of Merrimack
County."*

This one needed no map and never did.

### 2. LAKE TODD VILLAGE DISTRICT — REACHES (Census PID6 217017)

Seated in Bradford, and it does not stop there. **Two independent sources:**

- **The district's own history page.** Its site
  (`laketoddvillagedistrict.us`) is dead today — 404 at rungs 2, 3, 4, 5 AND 6,
  every one recorded — and the Internet Archive's capture of 2014-01-08 holds
  it. In the district's own words: *"Lake Todd Village District was formed in
  2004 by the litoral owners of Lake Todd, **located in Bradford and Newbury,
  New Hampshire**, in accordance with … RSA 52, 'Village Districts'."* The same
  page: the warrant and budget are posted *"in the Bradford Post Office and
  **outside the Newbury Town Office**."* A district that posts its warrant at a
  town office is a district that governs in that town.
- **The DRA table, independently.** "Lake Todd Village\*" appears TWICE at
  $0.29, under two different municipalities — the asterisk-and-repeat pattern
  the document uses for a district that spans more than one. It is the only
  district in the file that appears against Newbury.

**This is a real governing body over 03255 that this product has never named.**
It meets annually under RSA 52:12 — *"the last Saturday in June of each year"*,
preceded by a budget hearing on the last Saturday in May — and a reader in
Newbury could live under it and hear nothing about it, which is the exact case
the gap ledger says an unresolved government is.

---

## The sixteen that do NOT reach 03255

Each is settled by the DRA table naming the municipality it levies in, and none
of them is Newbury. Where a district carries the multi-town asterisk, both of
its municipalities are named.

| District | PID6 | Municipality it levies in | 2025 rate |
|---|---|---|---|
| Andover Fire District #1 | 152217 | Andover | $0.44 |
| Andover Village District | 130791 | Andover | $0.00 |
| East Andover Fire Precinct | 152218 | Andover | listed |
| B C E P Solid Waste District | 152222 | a four-town co-operative — Barnstead, Chichester, Epsom, Pittsfield — not a village district and not in the DRA table | — |
| Central Hooksett Water Precinct | 130788 | Hooksett | $0.00 |
| Hooksett Village Water Precinct | 152219 | Hooksett | $0.00 |
| Concord Housing Authority | 152226 | City of Concord, under RSA 203 | — |
| Contoocook Village Precinct | 186525 | Hopkinton | $1.34 |
| Hopkinton Village Precinct | 152220 | Hopkinton | $0.27 |
| Epsom Village District | 108989 | Epsom | $0.00 |
| Hardy Road Village District | 130790 | Loudon | $1.92 |
| Highlands Village District | 216991 | Northfield | $0.00 |
| Northfield Sewer District | 221008 | Northfield | $0.00 |
| New London-Springfield Water System Precinct | 152221 | New London **and** Springfield (asterisked, two rows: $1.49 and $1.04) | — |
| Penacook-Boscawen Water Precinct | 130789 | Boscawen | $0.00 |
| Warner Village Water District | 108988 | Warner | $1.60 |

**The residual uncertainty, stated rather than buried.** Sixteen of these are
settled by a district's ABSENCE from Newbury's block in one annual document. A
district that both levies nothing and is omitted from the table entirely would
be invisible to this method. Two things reduce that to a small risk and neither
eliminates it: the table lists zero-rate districts rather than skipping them,
and the two multi-town cases in scope were both caught by it. Two of the sixteen
— B C E P and the Concord Housing Authority — are not village districts at all
and were settled by their own enabling statutes instead.

---

## What this found that nobody was looking for

**Kearsarge Lighting District** is in the DRA table twice, asterisked, at $0.26
and $0.27 — and it is in **Bartlett and Conway, Carroll County**, not anywhere
near the Kearsarge Regional School District. Its block sits beside Bartlett
Village Water, Lower Bartlett Water and North Conway Water. A name match would
have put a Carroll County lighting district over a Merrimack County zip. Named
here so the next session does not have to re-establish it.
