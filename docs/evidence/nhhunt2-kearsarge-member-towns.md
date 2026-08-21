# The Kearsarge member towns, enumerated — NH Hunt 2, item 3 (2026-08-21)

**What this is.** The list of governing BODIES in each town that sends members
to the Kearsarge Regional School Board, read from each town's own website on
2026-08-21, with the rung that reached it. It is the per-town denominator the
gap ledger needs and did not have.

**Why it is a body count and not a government count.** RULING 9: the Census of
Governments counts a New Hampshire town as ONE government. The product renders
BODIES, and a town is a dozen or more of them. An external denominator that
says "1" cannot catch a town whose Zoning Board is missing, so the denominator
for a town has to come from the town.

**The pair.** Seven member towns. **107 bodies enumerated · 17 in the registry
(Newbury's, all of them) · 90 enumerated and not yet wired.** Before this run
the pair was 17 of 17, because six of the seven towns had no bodies in the
registry at all and therefore no denominator to be missing from.

---

## The count that was wrong before we started: SEVEN towns, not eight

The session brief and the standing record both say *"the Kearsarge Regional
School District's eight member towns."* The district's own board-members page
says seven, and names them:

> Kearsarge Regional School District (SAU #65) is composed of seven towns
> governed by one regional School Board consisting of nine members. The towns
> represented are Bradford, Newbury, New London, Springfield, Sutton, Warner,
> and Wilmot.

Read 2026-08-21 at rung 4 (`curl`, HTTP 200, 73,695 bytes) and independently at
rung 5. It matches the same page read on 2026-08-16 and the nine-member roster
committed then. **Croydon is the likely source of the eighth**: the same page
links "School Board — Croydon Anchor Agreement Reports", and Croydon tuitions
students in under an anchor agreement without being a member town. Seven is
what the district publishes and seven is what is used here.

---

## Per town: bodies enumerated, bodies in the registry, how it was read

| Town | Bodies enumerated | In the registry | Rung | Source read |
|---|---|---|---|---|
| Bradford | 12 | 0 | 6 → 7 | `towncloud.io/go/bradford-nh` |
| Newbury | 17 | 17 | — | already wired (NH Hunt, 2026-08-20) |
| New London | 14 | 0 | 2 | `newlondon.nh.gov` |
| Springfield | 11 | 0 | 2 | `springfieldnh.org` |
| Sutton | 16 | 0 | 4 | `suttonnh.gov` |
| Warner | 26 | 0 | 2 | `warnernh.gov/boards/` |
| Wilmot | 11 | 0 | 2 | `wilmotnh.org` |
| **Total** | **107** | **17** | | |

### Bradford — 12

Select Board · Planning Board · Zoning Board of Adjustment · Conservation
Commission · Budget Committee · Capital Improvement Program · Economic
Development Committee · Energy Committee · Bradford's Affordable Tomorrow
Committee · Reimagining Community Spaces Bradford · Independence Day Committee ·
Road Committee

**This list is DERIVED FROM MEETINGS and therefore under-counts.** Bradford's
own site publishes no boards index; the names above are the distinct meeting
titles across 227 agenda rows on its vendor platform. A body that has not met in
that window is invisible to this method, so 12 is a FLOOR and not the town's
denominator. Named as a floor rather than reported as a count.

### New London — 14

Board of Selectmen · Planning Board · Zoning Board of Adjustment · Conservation
Commission · Budget Committee · Board of Firewards · Bicycle & Pedestrian
Advisory Committee · Citizens' Committee · Energy Committee · Housing Commission
· Recreation Commission · Trustees of the Trust Funds · Supervisors of the
Checklist · Tri-Town Assessing Board

### Springfield — 11

Board of Selectmen · Planning Board · Zoning Board of Adjustment · Conservation
Committee · Agriculture Commission · Energy Committee · Recreation Committee ·
Library Trustees · Cemetery Trustees · Trustees of the Trust Funds ·
Supervisors of the Checklist

### Sutton — 16

Select Board · Planning Board · Zoning Board of Adjustment · Conservation
Commission · Municipal Budget Committee · Cemetery Commission · Hazard
Mitigation Committee · Supervisors of the Checklist · Trustees of the Trust
Funds · Warner River Local Advisory Committee · Sutton Free Library Board of
Trustees · and five standing AD HOC committees the town lists under one index —
Waste Reduction Advisory, Grist Mill Bridge, Fire Safety Municipal Building,
Sutton Connects!, and Speed Sign.

The ad hoc five are counted because Sutton lists them beside its permanent
boards with their own pages; a town that convenes a committee, gives it a page
and posts its meetings has made it a body a reader can attend.

### Warner — 26

**Warner publishes its own denominator, and it is the best one found in any of
the seven.** Its Boards page lists every board and committee with an
elected-or-appointed marker beside each name — *"(E: Elected  A: Appointed)"* —
which is a town stating, in its own words, what its governing bodies are and how
each is constituted:

Select Board (E) · Budget Committee (E) · Cemetery Trustees (E) · Chandler
Reservation Committee (E) · Supervisors of the Checklist (E) · Trustees of Trust
Funds (E) · Warner Village Water District (E) · Agricultural Commission (A) ·
Auditor Search Committee (A) · Community Power Committee (A) · Conservation
Commission (A) · Corridor Committee (A) · Economic Development Advisory
Committee (A) · Energy/Solar Committee (A) · Groundwater Protection Committee
(A) · Highway Safety Committee (A) · Housing Advisory Committee (A) · Housing
Committee (A) · Joint Loss Management Committee / Safety (A) · Mink Hills
Recreation Committee (A) · Parks and Recreation (A) · Planning Board (A) ·
Record Preservation Committee (A) · Road Committee (A) · Warner River Local
Advisory Committee (A) · Zoning Board of Adjustment (A)

Four single-officer offices on the same page — Town Clerk, Town Treasurer, Tax
Collector, Welfare Department — are NOT counted as bodies. One more,
**Warner River Designation Committee (A), is marked "Dissolved" by the town
itself** and is excluded; recording it would have put a body on a reader's map
that no longer meets.

### Wilmot — 11

Selectboard · Planning Board · Zoning Board of Adjustment · Conservation
Commission · Supervisors of the Checklist · Trustees of the Trust Funds ·
Cemetery Trustees · Parks and Recreation · Waste Reduction Committee · Master
Plan Committee · Overseer of Public Welfare

---

## What was populated, and what was not

**Populated: the Kearsarge Regional School Board itself, to nine emails.** See
the correction in `lib/registry/body-rosters.ts` — the district publishes an
email for every board member in the `href` of their own name, and the 2026-08-17
read recorded those as honest absences because it read the table's CELLS and not
its LINKS. Nine board members and the district clerk now carry a contact.

**Not populated: the 90 town bodies above.** Enumerating a town and wiring it
are two different subjects, and the deferral boundary falls between subjects. The
enumeration is complete and committed here so the next session starts from a
list rather than from a search box; the wiring is a tracker row per town.

## Walls and vendor findings, for the playbook

- **`suttonnh.gov` refuses rung 2 and admits rung 4.** The same
  TLS-fingerprint shape as `hopkinton-nh.gov`.
- **Five of the six non-Newbury member towns have moved to `.gov` domains** and
  the district's own board page still links the old ones:
  `bradfordnh.org → bradfordnh.gov`, `nl-nh.com → newlondon.nh.gov`,
  `sutton-nh.org → suttonnh.gov`, `warner.nh.us → warnernh.gov`. They redirect
  today; a link we hold is a link that will break.
- **TownCloud is a vendor family this repo had not seen**, and it is where
  Bradford's meetings live. Its agenda table is a server-side DataTables POST to
  `/go/<slug>/table_data`; a replayed POST answers 422 without the page's own
  session, so the reachable route is rung 6 driving the table's own paging.
- **TownCloud answers HTTP 200 with an empty shell for ANY slug.** Probing
  `towncloud.io/go/<guess>` by status code reports every guess as a hit — all
  six other member towns "existed" on it and none does. The check that works is
  the rendered row count.
