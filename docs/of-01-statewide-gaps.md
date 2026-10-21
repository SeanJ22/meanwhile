# OF-01 statewide office gaps

On the final production copy, all 51 representation and state readers retain the President and show the Vice President; existing officials, memberships, contacts and provenance pass the preservation comparison. Raw statewide rows increase from 191 to 192 because New Jersey now shows its already-held appointed Attorney General, Jennifer Davenport. No missing-office acquisition was performed.

Production-copy measurements compare all 50 states and DC through the real representation and state readers. Shown counts are the raw statewide holder rows served by the representation reader; they exclude federal holders. They include currently displayed appointed offices and duplicate rows. Expected counts inventory seats elected by the statewide electorate, including retention and at-large board seats; they are not directly comparable totals.

The official office lists, seat counts, title aliases and electorate exclusions are in [of-01-office-inventory.json](./of-01-office-inventory.json). The 827-seat inventory contains 312 executive seats and 515 other statewide judicial, board and DC seats. A matched title is not a new verification of the current holder, source or contact. No missing holder was acquired or repaired for this report.

| State | Shown before | Shown after | Elected executive seats | Other statewide seats | Missing elected seats |
| --- | ---: | ---: | ---: | ---: | ---: |
| AK | 3 | 3 | 2 | 9 | 9 |
| AL | 6 | 6 | 10 | 19 | 23 |
| AR | 6 | 6 | 7 | 7 | 8 |
| AZ | 12 | 12 | 11 | 7 | 8 |
| CA | 4 | 4 | 8 | 7 | 11 |
| CO | 4 | 4 | 5 | 31 | 32 |
| CT | 4 | 4 | 6 | 0 | 2 |
| DC | 6 | 6 | 2 | 9 | 5 |
| DE | 4 | 4 | 6 | 0 | 3 |
| FL | 4 | 4 | 5 | 7 | 9 |
| GA | 4 | 4 | 13 | 24 | 33 |
| HI | 3 | 3 | 2 | 9 | 9 |
| IA | 4 | 4 | 7 | 16 | 19 |
| ID | 4 | 4 | 7 | 9 | 12 |
| IL | 3 | 3 | 6 | 0 | 3 |
| IN | 4 | 4 | 6 | 12 | 14 |
| KS | 4 | 4 | 6 | 21 | 23 |
| KY | 3 | 3 | 7 | 0 | 4 |
| LA | 3 | 3 | 7 | 0 | 4 |
| MA | 6 | 6 | 6 | 0 | 0 |
| MD | 3 | 3 | 4 | 8 | 9 |
| ME | 2 | 2 | 1 | 0 | 0 |
| MI | 4 | 4 | 4 | 39 | 39 |
| MN | 4 | 4 | 5 | 26 | 27 |
| MO | 3 | 3 | 6 | 7 | 10 |
| MS | 3 | 3 | 8 | 0 | 5 |
| MT | 3 | 3 | 6 | 8 | 11 |
| NC | 3 | 3 | 10 | 22 | 29 |
| ND | 4 | 4 | 13 | 5 | 14 |
| NE | 4 | 4 | 6 | 7 | 9 |
| NH | 1 | 1 | 1 | 0 | 0 |
| NJ | 2 | 3 | 2 | 0 | 0 |
| NM | 3 | 3 | 7 | 15 | 19 |
| NV | 4 | 4 | 6 | 10 | 12 |
| NY | 3 | 3 | 4 | 0 | 1 |
| OH | 4 | 4 | 6 | 7 | 9 |
| OK | 3 | 3 | 11 | 26 | 34 |
| OR | 3 | 3 | 5 | 21 | 23 |
| PA | 4 | 4 | 5 | 31 | 33 |
| RI | 4 | 4 | 5 | 0 | 1 |
| SC | 4 | 4 | 8 | 0 | 5 |
| SD | 4 | 4 | 10 | 5 | 11 |
| TN | 2 | 2 | 1 | 29 | 29 |
| TX | 4 | 4 | 9 | 18 | 24 |
| UT | 3 | 3 | 5 | 14 | 16 |
| VA | 3 | 3 | 3 | 0 | 0 |
| VT | 4 | 4 | 6 | 0 | 2 |
| WA | 4 | 4 | 9 | 9 | 14 |
| WI | 3 | 3 | 6 | 7 | 10 |
| WV | 2 | 2 | 6 | 8 | 12 |
| WY | 3 | 3 | 5 | 6 | 9 |

“Missing” below means the current reader roster has no matching holder for that expected seat. Multiple seats of one office type are grouped with their missing count. The AZ Attorney General row named “Actions” is excluded from a holder match because it is not a person name. No claim is made that any absent office is unpublished by its government.

## Measured reasons

- **N:** No matching holder in the served roster and no promoted `statewide-executive` source pointer for that state in the measured source-contract state. The per-office retrieval/parser omission is not individually measured; this is a publication-coverage gap, not a finding that the official source lacks the office.
- **P:** A `statewide-executive` source is promoted, but the roster served to readers does not supply this expected office.
- **Z:** The latest `statewide-executive` candidate failed `CANNOT_TELL / ZERO_IS_NOT_ABSENCE`, so it could not establish coverage and existing data was retained.
- **V:** The latest `statewide-executive` candidate failed `TEMPORAL_INVALID / VERSION_REGRESSION`; the older promoted version was retained and still lacks these offices.
- **J:** No matching elected statewide court holder is in the served roster. The held executive/legislator sources do not publish these court seats through this reader path. Judicial acquisition is remaining work.
- **B:** No matching statewide board, DC school or shadow-delegation holder is in the served roster. These seats are not supplied by the currently published executive/legislator roster. Their acquisition is remaining work.

The comparison finds 179 matching elected memberships and 648 missing memberships across 196 office types. Of the missing memberships, 138 are executive and 510 are elected courts, boards or DC offices. Ordinary missing-office acquisition is the next step. The automatic update work in OF-01 refreshes source and state bindings; a healthy scheduled binding cannot supply an office absent from the held source roster.

## Every remaining office

### AK — Alaska

- **Supreme Court Justice × 5** — J. [official source 1](https://courts.alaska.gov/soj/docs/2024.pdf); [official source 2](https://courts.alaska.gov/admin/docs/fy07.pdf).
- **Court of Appeals Judge × 4** — J. [official source 1](https://courts.alaska.gov/soj/docs/2024.pdf); [official source 2](https://courts.alaska.gov/admin/docs/fy07.pdf).

### AL — Alabama

- **Commissioner of Agriculture and Industries × 1** — N. [official source 1](https://www.sos.alabama.gov/sites/default/files/election-2026/2026-VoterGuide.pdf); [official source 2](https://psc.alabama.gov/about-us/).
- **Public Service Commissioner × 3** — N. [official source 1](https://www.sos.alabama.gov/sites/default/files/election-2026/2026-VoterGuide.pdf); [official source 2](https://psc.alabama.gov/about-us/).
- **Supreme Court Justice × 9** — J. [official source 1](https://judicial.alabama.gov/Appellate/JudgeQualification); [official source 2](https://judicial.alabama.gov/library/tour6).
- **Court of Civil Appeals Judge × 5** — J. [official source 1](https://judicial.alabama.gov/Appellate/CivilAppeals).
- **Court of Criminal Appeals Judge × 5** — J. [official source 1](https://judicial.alabama.gov/Appellate/CriminalAppeals).

### AR — Arkansas

- **Commissioner of State Lands × 1** — N. [official source 1](https://portal.arkansas.gov/elected-officials/).
- **Supreme Court Justice × 7** — J. [official source 1](https://arcourts.gov/courts/supreme-court).

### AZ — Arizona

- **Attorney General × 1** — N. [official source 1](https://azsos.gov/elections/candidates/elected-office-terms).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.azcourts.gov/AZ-Supreme-Court/Meet-the-Justices).

The Lieutenant Governor office first takes office in January 2027; it is not a current seat on October 20, 2026. Corporation Commission has five statewide-elected seats. Court of Appeals retention electorates are regional, not statewide.

### CA — California

- **State Treasurer × 1** — N. [official source 1](https://clerk.assembly.ca.gov/legislative-information/elected-officials); [official source 2](https://www.sos.ca.gov/administration/california-roster).
- **State Controller × 1** — N. [official source 1](https://clerk.assembly.ca.gov/legislative-information/elected-officials); [official source 2](https://www.sos.ca.gov/administration/california-roster).
- **Insurance Commissioner × 1** — N. [official source 1](https://clerk.assembly.ca.gov/legislative-information/elected-officials); [official source 2](https://www.sos.ca.gov/administration/california-roster).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://clerk.assembly.ca.gov/legislative-information/elected-officials); [official source 2](https://www.sos.ca.gov/administration/california-roster).
- **Supreme Court Justice × 7** — J. [official source 1](https://courts.ca.gov/news/what-know-about-judicial-selection); [official source 2](https://appellate.courts.ca.gov/ko/node/3886).

### CO — Colorado

- **State Treasurer × 1** — N. [official source 1](https://content.leg.colorado.gov/agencies/legislative-council-staff/salaries-legislators-statewide-elected-officials-and-county).
- **State Board of Education Member, At Large × 1** — B. [official source 1](https://ed.cde.state.co.us/cdeboard/board-member-profiles).
- **University of Colorado Regent, At Large × 1** — B. [official source 1](https://regents.cu.edu/).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.coloradojudicial.gov/supreme-court).
- **Court of Appeals Judge × 22** — J. [official source 1](https://www.coloradojudicial.gov/topic/77/court-appeals-protocols?topic=77&wrapped=true).

Include only the one at-large State Board of Education seat and one at-large CU Regent; district seats are not statewide.

### CT — Connecticut

- **State Treasurer × 1** — N. [official source 1](https://portal.ct.gov/Government/Departments-and-Agencies/Constitutional-Offices).
- **State Comptroller × 1** — N. [official source 1](https://portal.ct.gov/Government/Departments-and-Agencies/Constitutional-Offices).

Judicial exclusion: State judges are appointed following Governor nomination and General Assembly approval; no statewide popular judicial ballot. [Official source](https://portal.ct.gov/sots/register-manual/section-v/judicial-department---state-courts).

### DC — District Of Columbia

- **Attorney General × 1** — Z. [official source 1](https://code.dccouncil.gov/us/dc/council/code/sections/1-1001.08); [official source 2](https://dcboe.org/getmedia/b5579707-fd07-40f0-9d1e-9ff3c8ff071f/05-List-of-Elected-Offices-in-the-District-of-Columbia.pdf).
- **State Board of Education Member, At Large × 1** — B. [official source 1](https://sboe.dc.gov/page/board-biographies).
- **United States Senator (shadow) × 2** — B. [official source 1](https://dcboe.org/getmedia/b5579707-fd07-40f0-9d1e-9ff3c8ff071f/05-List-of-Elected-Offices-in-the-District-of-Columbia.pdf); [official source 2](https://code.dccouncil.gov/us/dc/council/code/sections/1-123).
- **United States Representative (shadow) × 1** — B. [official source 1](https://dcboe.org/getmedia/b5579707-fd07-40f0-9d1e-9ff3c8ff071f/05-List-of-Elected-Offices-in-the-District-of-Columbia.pdf); [official source 2](https://code.dccouncil.gov/us/dc/council/code/sections/1-123).

District-wide offices are the DC counterpart of statewide. Ward council/education/ANC seats are excluded. Shadow Senators and Representative are DC elected advocacy offices, distinct from the federal congressional Delegate.

Judicial exclusion: DC Court of Appeals and Superior Court judges are Presidentially nominated and Senate confirmed, not elected by DC voters. [Official source](https://newsroom.dccourts.gov/faqs).

### DE — Delaware

- **State Treasurer × 1** — P. [official source 1](https://delaware.gov/guides/your-government/).
- **Auditor of Accounts × 1** — P. [official source 1](https://delaware.gov/guides/your-government/).
- **Insurance Commissioner × 1** — P. [official source 1](https://delaware.gov/guides/your-government/).

Judicial exclusion: State judges are appointed by the Governor with Senate confirmation, not popular statewide election. [Official source](https://delcode.delaware.gov/constitution/constitution-05.html).

### FL — Florida

- **Chief Financial Officer × 1** — N. [official source 1](https://www.flsenate.gov/Laws/Constitution); [official source 2](https://www.cabinet.myflorida.com/structure_of_the_florida_cabinet).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://www.flsenate.gov/Laws/Constitution); [official source 2](https://www.cabinet.myflorida.com/structure_of_the_florida_cabinet).
- **Supreme Court Justice × 7** — J. [official source 1](https://supremecourt.flcourts.gov/the-court/about-the-court/Justices/Merit-Selection-Retention-Retirement); [official source 2](https://supremecourt.flcourts.gov/the-court/about-the-court/Court-System).

### GA — Georgia

- **State School Superintendent × 1** — Z. [official source 1](https://georgia.gov/elected-officials); [official source 2](https://sos.ga.gov/page/elected-officials-state-georgia).
- **Commissioner of Agriculture × 1** — Z. [official source 1](https://georgia.gov/elected-officials); [official source 2](https://sos.ga.gov/page/elected-officials-state-georgia).
- **Commissioner of Insurance and Safety Fire × 1** — Z. [official source 1](https://georgia.gov/elected-officials); [official source 2](https://sos.ga.gov/page/elected-officials-state-georgia).
- **Commissioner of Labor × 1** — Z. [official source 1](https://georgia.gov/elected-officials); [official source 2](https://sos.ga.gov/page/elected-officials-state-georgia).
- **Public Service Commissioner × 5** — Z. [official source 1](https://georgia.gov/elected-officials); [official source 2](https://sos.ga.gov/page/elected-officials-state-georgia).
- **Supreme Court Justice × 9** — J. [official source 1](https://law.georgia.gov/opinions/96-9); [official source 2](https://www.gasupreme.us/court-information/history/).
- **Court of Appeals Judge × 15** — J. [official source 1](https://law.georgia.gov/opinions/96-9); [official source 2](https://georgiacourts.gov/court-of-appeals-of-georgia/).

### HI — Hawaii

- **Office of Hawaiian Affairs Trustee × 9** — B. [official source 1](https://elections.hawaii.gov/office-of-hawaiian-affairs-elections/).

All nine OHA trustees are elected by the statewide electorate, including island-residency seats. Other executive department heads are appointed.

Judicial exclusion: Judges are initially appointed; retention is decided by the Judicial Selection Commission, not the statewide electorate. [Official source](https://www.courts.state.hi.us/our-judges).

### IA — Iowa

- **Treasurer of State × 1** — N. [official source 1](https://www.legis.iowa.gov/publications/otherResources/register).
- **Auditor of State × 1** — N. [official source 1](https://www.legis.iowa.gov/publications/otherResources/register).
- **Secretary of Agriculture × 1** — N. [official source 1](https://www.legis.iowa.gov/publications/otherResources/register).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.iowacourts.gov/iowa-courts/supreme-court/constitution-day-2025/what-is-an-oral-argument).
- **Court of Appeals Judge × 9** — J. [official source 1](https://www.iowacourts.gov/iowa-courts/supreme-court/constitution-day-2025/what-is-an-oral-argument).

### ID — Idaho

- **State Treasurer × 1** — P. [official source 1](https://idaho.gov/government/executive-branch/); [official source 2](https://voteidaho.gov/idaho-elected-officials/).
- **State Controller × 1** — P. [official source 1](https://idaho.gov/government/executive-branch/); [official source 2](https://voteidaho.gov/idaho-elected-officials/).
- **Superintendent of Public Instruction × 1** — P. [official source 1](https://idaho.gov/government/executive-branch/); [official source 2](https://voteidaho.gov/idaho-elected-officials/).
- **Supreme Court Justice × 5** — J. [official source 1](https://isc.idaho.gov/about-the-courts/sc-justices); [official source 2](https://voteidaho.gov/idaho-elected-officials/).
- **Court of Appeals Judge × 4** — J. [official source 1](https://isc.idaho.gov/about-the-courts/ica-judges); [official source 2](https://voteidaho.gov/idaho-elected-officials/).

The fiscal office is State Controller, not State Auditor.

### IL — Illinois

- **Secretary of State × 1** — V. [official source 1](https://www.illinois.gov/government/executive-branch.html).
- **State Treasurer × 1** — V. [official source 1](https://www.illinois.gov/government/executive-branch.html).
- **State Comptroller × 1** — V. [official source 1](https://www.illinois.gov/government/executive-branch.html).

Judicial exclusion: Supreme Court and Appellate Court elections and retention use judicial districts, not the whole-state electorate. [Official source](https://www.illinoiscourts.gov/courts/supreme-court/).

### IN — Indiana

- **Treasurer of State × 1** — N. [official source 1](https://www.in.gov/dA/1eada35c3e/2026-Candidate-Guide.FINAL.pdf?language_id=1).
- **State Comptroller × 1** — N. [official source 1](https://www.in.gov/dA/1eada35c3e/2026-Candidate-Guide.FINAL.pdf?language_id=1).
- **Supreme Court Justice × 5** — J. [official source 1](https://www.in.gov/courts/supreme/about).
- **Court of Appeals Judge, Districts 4 and 5 × 6** — J. [official source 1](https://secure.in.gov/courts/appeals/districts/).
- **Tax Court Judge × 1** — J. [official source 1](https://www.in.gov/courts/news/2026/0827).

The constitutional Auditor of State office now uses State Comptroller. Court of Appeals Districts 1-3 retention is regional; Districts 4-5 retention is statewide (six seats). Tax Court judge has statewide retention.

### KS — Kansas

- **State Treasurer × 1** — N. [official source 1](https://www.sos.ks.gov/publications/sessionlaws/2018/2018_Session_Laws.pdf).
- **Commissioner of Insurance × 1** — N. [official source 1](https://www.sos.ks.gov/publications/sessionlaws/2018/2018_Session_Laws.pdf).
- **Supreme Court Justice × 7** — J. [official source 1](https://sos.ks.gov/elections/election-standards/Kansas-Election-Standards-Chapter-II-Election-Administration.pdf).
- **Court of Appeals Judge × 14** — J. [official source 1](https://sos.ks.gov/elections/election-standards/Kansas-Election-Standards-Chapter-II-Election-Administration.pdf).

### KY — Kentucky

- **Secretary of State × 1** — N. [official source 1](https://transparency.ky.gov/accountability/Pages/officers.aspx).
- **State Treasurer × 1** — N. [official source 1](https://transparency.ky.gov/accountability/Pages/officers.aspx).
- **Auditor of Public Accounts × 1** — N. [official source 1](https://transparency.ky.gov/accountability/Pages/officers.aspx).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://transparency.ky.gov/accountability/Pages/officers.aspx).

Judicial exclusion: Supreme Court and Court of Appeals judges are elected by geographic judicial districts. [Official source](https://www.kycourts.gov/Courts/Pages/default.aspx).

### LA — Louisiana

- **Secretary of State × 1** — N. [official source 1](https://www.la.gov/government/executive-branch-elected-officials/).
- **State Treasurer × 1** — N. [official source 1](https://www.la.gov/government/executive-branch-elected-officials/).
- **Commissioner of Agriculture and Forestry × 1** — N. [official source 1](https://www.la.gov/government/executive-branch-elected-officials/).
- **Commissioner of Insurance × 1** — N. [official source 1](https://www.la.gov/government/executive-branch-elected-officials/).

The current state executive list has seven elected officers. Superintendent of Education is appointed; Commissioner of Elections is no longer a separate elected office. PSC and BESE elected seats have district electorates.

Judicial exclusion: Supreme Court and lower appellate judges are elected by judicial districts. [Official source](https://www.legis.la.gov/Legis/Law.aspx?d=1387456).

### MA — Massachusetts

No expected statewide popular-election office type is absent by this title-and-membership comparison.

Judicial exclusion: State judges are appointed by the Governor with Governor Council approval, not popularly elected. [Official source](https://www.mass.gov/info-details/supreme-judicial-court-justices).

### MD — Maryland

- **Comptroller × 1** — N. [official source 1](https://elections.maryland.gov/candidacy/requirements.html).
- **Appellate Court Judge, At Large × 8** — J. [official source 1](https://www.mdcourts.gov/acm); [official source 2](https://elections.maryland.gov/elections/2026/general_candidates/2026_GG_statewide_candidatelist.html); [official source 3](https://mgaleg.maryland.gov/Pubs/LegisLegal/2022-legislativehandbookseries-vol-2.pdf).

Supreme Court retention is by appellate circuit. Appellate Court has seven circuit-based and eight at-large judges; only the eight at-large seats are counted here.

### ME — Maine

No expected statewide popular-election office type is absent by this title-and-membership comparison.

Only Governor is popularly elected statewide. Secretary, Treasurer, Attorney General and State Auditor are selected by the Legislature, so their current reader rows are preserved but do not increase the elected-seat target.

Judicial exclusion: State judges are appointed by the Governor and confirmed by the Senate, not popularly elected statewide. [Official source](https://www.courts.maine.gov/about/).

### MI — Michigan

- **State Board of Education Member × 8** — B. [official source 1](https://www.legislature.mi.gov/documents/2023-2024/michiganmanual/2023-MM-P0447-p0455.pdf).
- **University of Michigan Regent × 8** — B. [official source 1](https://www.legislature.mi.gov/documents/mcl/pdf/mcl-Constitution-VIII.pdf).
- **Michigan State University Trustee × 8** — B. [official source 1](https://www.legislature.mi.gov/documents/mcl/pdf/mcl-Constitution-VIII.pdf).
- **Wayne State University Governor × 8** — B. [official source 1](https://www.legislature.mi.gov/documents/mcl/pdf/mcl-Constitution-VIII.pdf).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.courts.michigan.gov/4add7e/siteassets/msc-learning-center/justitia_micourtsystem.pdf).

Four independently elected executive roles plus eight State Board members and three eight-member university boards elected statewide.

### MN — Minnesota

- **State Auditor × 1** — N. [official source 1](https://www.revisor.mn.gov/constitution/); [official source 2](https://www.sos.mn.gov/election-administration-campaigns/become-a-candidate/filing-for-other-state-constitutional-offices/).
- **Supreme Court Justice × 7** — J. [official source 1](https://mncourts.gov/supremecourt).
- **Court of Appeals Judge × 19** — J. [official source 1](https://mncourts.gov/about-the-courts/fast-facts); [official source 2](https://www.mncourts.gov/courtofappeals.aspx); [official source 3](https://www.mncourts.gov/about-the-courts).

The State Treasurer office was abolished in 2003. The current constitution and current SOS filing page list five constitutional offices; an old legislature FAQ still lists Treasurer and is not used as authority.

### MO — Missouri

- **Secretary of State × 1** — N. [official source 1](https://www.sos.mo.gov/bluebook/2025-2026).
- **State Treasurer × 1** — N. [official source 1](https://www.sos.mo.gov/bluebook/2025-2026).
- **State Auditor × 1** — N. [official source 1](https://www.sos.mo.gov/bluebook/2025-2026).
- **Supreme Court Judge × 7** — J. [official source 1](https://www.sos.mo.gov/archives/judiciary/supremecourt/history.asp); [official source 2](https://www.courts.mo.gov/file.jsp?id=116513).

### MS — Mississippi

- **Secretary of State × 1** — N. [official source 1](https://www.ms.gov/government/government-branches).
- **State Treasurer × 1** — N. [official source 1](https://www.ms.gov/government/government-branches).
- **State Auditor × 1** — N. [official source 1](https://www.ms.gov/government/government-branches).
- **Commissioner of Agriculture and Commerce × 1** — N. [official source 1](https://www.ms.gov/government/government-branches).
- **Commissioner of Insurance × 1** — N. [official source 1](https://www.ms.gov/government/government-branches).

Judicial exclusion: Supreme Court and Court of Appeals seats have district electorates. [Official source](https://www.ms.gov/agencies/mississippi-supreme-court).

### MT — Montana

- **Secretary of State × 1** — N. [official source 1](https://mtgovtemplate.mt.gov/govt/elected_officials).
- **State Auditor × 1** — N. [official source 1](https://mtgovtemplate.mt.gov/govt/elected_officials).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://mtgovtemplate.mt.gov/govt/elected_officials).
- **Clerk of the Supreme Court × 1** — B. [official source 1](https://courts.mt.gov/clerk/about/).
- **Supreme Court Justice × 7** — J. [official source 1](https://courts.mt.gov/external/supreme/docs/Overview%20Montana%20Supreme%20Court.pdf).

State Auditor also serves as Commissioner of Securities and Insurance; count that one seat once. Supreme Court Clerk is a separately elected statewide office.

### NC — North Carolina

- **Secretary of State × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **State Treasurer × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **State Auditor × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **Commissioner of Insurance × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **Commissioner of Labor × 1** — N. [official source 1](https://www.nc.gov/your-government/executive).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.nc.gov/your-government/judicial).
- **Court of Appeals Judge × 15** — J. [official source 1](https://www.nc.gov/your-government/judicial).

### ND — North Dakota

- **State Treasurer × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **State Auditor × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Agriculture Commissioner × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Insurance and Securities Commissioner × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Tax Commissioner × 1** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Public Service Commissioner × 3** — N. [official source 1](https://www.psc.nd.gov/commission); [official source 2](https://www.tax.nd.gov/about/commissioner-bio); [official source 3](https://www.sos.nd.gov/elections/candidate/become-candidate/state-legislative-judicial); [official source 4](https://vip.sos.nd.gov/pdfs/Portals/qual-terms-elec.pdf).
- **Supreme Court Justice × 5** — J. [official source 1](https://www.ndcourts.gov/legal-resources/nd-constitution/article-vi-judicial-branch).

### NE — Nebraska

- **State Treasurer × 1** — N. [official source 1](https://www.nebraska.gov/); [official source 2](https://sos.nebraska.gov/sites/sos.nebraska.gov/files/doc/elections/2022/2022%20Elected%20Offices%20and%20Maps.pdf).
- **Auditor of Public Accounts × 1** — N. [official source 1](https://www.nebraska.gov/); [official source 2](https://sos.nebraska.gov/sites/sos.nebraska.gov/files/doc/elections/2022/2022%20Elected%20Offices%20and%20Maps.pdf).
- **Supreme Court Chief Justice × 1** — J. [official source 1](https://sos.nebraska.gov/sites/default/files/doc/elections/2022/Statewide-Judicial-Retention.pdf).
- **Workers Compensation Court Judge × 6** — J. [official source 1](https://www.newcc.gov/home/judges-of-the-court).

Public Service Commission, Education Board, Regents, six associate Supreme Court justices and six Court of Appeals judges have district electorates; only Chief Justice and the six Workers Compensation judges are counted as statewide judicial seats.

### NH — New Hampshire

No expected statewide popular-election office type is absent by this title-and-membership comparison.

Governor is the only statewide popular executive election. Executive Council members are elected by five separate districts. Secretary, Treasurer and judges are not popularly elected statewide.

Judicial exclusion: State judges are appointed by Governor and Executive Council, not popularly elected. [Official source](https://gc.nh.gov/rsa/html/I/4/4-44.htm).

### NJ — New Jersey

No expected statewide popular-election office type is absent by this title-and-membership comparison.

Governor and Lieutenant Governor are the only statewide popular executive offices. Attorney General and Secretary of State are appointed. A Lieutenant Governor who also serves as Secretary holds an additional appointed role, not another elected seat.

Judicial exclusion: State Supreme Court judges are appointed by Governor with Senate advice and consent. [Official source](https://www.njleg.state.nj.us/constitution).

### NM — New Mexico

- **Secretary of State × 1** — N. [official source 1](https://www.sos.nm.gov/about-new-mexico/nm-government/).
- **State Treasurer × 1** — N. [official source 1](https://www.sos.nm.gov/about-new-mexico/nm-government/).
- **State Auditor × 1** — N. [official source 1](https://www.sos.nm.gov/about-new-mexico/nm-government/).
- **Commissioner of Public Lands × 1** — N. [official source 1](https://www.sos.nm.gov/about-new-mexico/nm-government/).
- **Supreme Court Justice × 5** — J. [official source 1](https://nmcourts.gov/resources/judicial-terms-and-retention-schedule/).
- **Court of Appeals Judge × 10** — J. [official source 1](https://nmcourts.gov/resources/judicial-terms-and-retention-schedule/).

### NV — Nevada

- **State Treasurer × 1** — N. [official source 1](https://nv.gov/); [official source 2](https://nsla.nv.gov/archives-SOS-office).
- **State Controller × 1** — N. [official source 1](https://nv.gov/); [official source 2](https://nsla.nv.gov/archives-SOS-office).
- **Supreme Court Justice × 7** — J. [official source 1](https://nvcourts.gov/supreme/court_information/overview_of_the_supreme_court_and_court_of_appeals).
- **Court of Appeals Judge × 3** — J. [official source 1](https://nvcourts.gov/supreme/court_information/court_of_appeals).

### NY — New York

- **State Comptroller × 1** — N. [official source 1](https://elections.ny.gov/new-york-state-elected-officials).

Governor, Lieutenant Governor, Comptroller and Attorney General are statewide popular offices; Court of Appeals is appointed and Supreme Court judges are elected by judicial district.

Judicial exclusion: Highest Court of Appeals is appointed; elected Supreme Court trial judges use judicial districts. [Official source](https://www.nycourts.gov/courts/8th-judicial-district/court-structure).

### OH — Ohio

- **Treasurer of State × 1** — N. [official source 1](https://codes.ohio.gov/ohio-constitution/section-3.1).
- **Auditor of State × 1** — N. [official source 1](https://codes.ohio.gov/ohio-constitution/section-3.1).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.supremecourt.ohio.gov/courts/judicial-system/supreme-court-of-ohio/history-of-the-court/).

### OK — Oklahoma

- **State Treasurer × 1** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **State Auditor and Inspector × 1** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **Insurance Commissioner × 1** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **Commissioner of Labor × 1** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **Corporation Commissioner × 3** — N. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html); [official source 2](https://oklahoma.gov/omes/about-omes/boards-and-commissions/statewide-official-legislative-compensation-board.html).
- **Supreme Court Justice × 9** — J. [official source 1](https://oklahoma.gov/elections/candidates/2026-candidate-filing-information.html).
- **Court of Criminal Appeals Judge × 5** — J. [official source 1](https://oklahoma.gov/top/agency/199.html).
- **Court of Civil Appeals Judge × 12** — J. [official source 1](https://www.oklegislature.gov/OK_Statutes/CompleteTitles/os20.pdf).

All three appellate courts have statewide retention ballots, including the twelve Court of Civil Appeals seats; district residency for appointment does not make their retention electorate regional. Title 20 section 30.16 explicitly submits Civil Appeals retention to qualified electors of the state; this controls over an older state-library summary describing district retention.

### OR — Oregon

- **State Treasurer × 1** — N. [official source 1](https://www.oregon.gov/Pages/new-to-oregon.aspx).
- **Commissioner of the Bureau of Labor and Industries × 1** — N. [official source 1](https://www.oregon.gov/Pages/new-to-oregon.aspx).
- **Supreme Court Justice × 7** — J. [official source 1](https://sos.oregon.gov/blue-book/government/Pages/supreme.aspx).
- **Court of Appeals Judge × 13** — J. [official source 1](https://sos.oregon.gov/blue-book/government/Pages/appeals-description.aspx).
- **Tax Court Judge × 1** — J. [official source 1](https://sos.oregon.gov/blue-book/government/Pages/tax.aspx).

### PA — Pennsylvania

- **State Treasurer × 1** — N. [official source 1](https://www.pa.gov/agencies/vote/elections/types-of-elections).
- **Auditor General × 1** — N. [official source 1](https://www.pa.gov/agencies/vote/elections/types-of-elections).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.pacourts.us/learn).
- **Superior Court Judge × 15** — J. [official source 1](https://www.pacourts.us/learn).
- **Commonwealth Court Judge × 9** — J. [official source 1](https://www.pacourts.us/learn).

Secretary of the Commonwealth and Secretary of Education are appointed, not elected statewide. Supreme, Superior and Commonwealth courts are statewide electoral offices.

### RI — Rhode Island

- **General Treasurer × 1** — N. [official source 1](https://www.sos.ri.gov/divisions/open-government-center/glossary).

Judicial exclusion: Supreme Court appointments require Governor nomination and General Assembly approval, not public statewide election. [Official source](https://www.rilegislature.gov/riconstitution/Constitution/C10.aspx).

### SC — South Carolina

- **Secretary of State × 1** — N. [official source 1](https://www.sc.gov/government/getting-know-your-government/elected-officials/constitutional-officers).
- **State Treasurer × 1** — N. [official source 1](https://www.sc.gov/government/getting-know-your-government/elected-officials/constitutional-officers).
- **Comptroller General × 1** — N. [official source 1](https://www.sc.gov/government/getting-know-your-government/elected-officials/constitutional-officers).
- **State Superintendent of Education × 1** — N. [official source 1](https://www.sc.gov/government/getting-know-your-government/elected-officials/constitutional-officers).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://www.sc.gov/government/getting-know-your-government/elected-officials/constitutional-officers).

Adjutant General has been appointed since 2019; do not count it as an elected seat. Judges elected by the General Assembly are not statewide popular-election seats.

Judicial exclusion: General Assembly elects appellate judges; the public does not elect or retain them in statewide ballots. [Official source](https://www.scstatehouse.gov/JudicialMeritPage/How%20Judges%20Are%20Elected%20in%20South%20Carolina.pdf).

### SD — South Dakota

- **State Treasurer × 1** — N. [official source 1](https://boardsandcommissions.sd.gov/Information.aspx?BoardID=213); [official source 2](https://electionresults.sd.gov/ResultsSW.aspx?cty=33&eid=471&type=CTYALL); [official source 3](https://sdsos.gov/Information/current-elected-officials.aspx); [official source 4](https://sdsos.gov/Information/executive-branch.aspx).
- **State Auditor × 1** — N. [official source 1](https://boardsandcommissions.sd.gov/Information.aspx?BoardID=213); [official source 2](https://electionresults.sd.gov/ResultsSW.aspx?cty=33&eid=471&type=CTYALL); [official source 3](https://sdsos.gov/Information/current-elected-officials.aspx); [official source 4](https://sdsos.gov/Information/executive-branch.aspx).
- **Commissioner of School and Public Lands × 1** — N. [official source 1](https://boardsandcommissions.sd.gov/Information.aspx?BoardID=213); [official source 2](https://electionresults.sd.gov/ResultsSW.aspx?cty=33&eid=471&type=CTYALL); [official source 3](https://sdsos.gov/Information/current-elected-officials.aspx); [official source 4](https://sdsos.gov/Information/executive-branch.aspx).
- **Public Utilities Commissioner × 3** — N. [official source 1](https://boardsandcommissions.sd.gov/Information.aspx?BoardID=213); [official source 2](https://electionresults.sd.gov/ResultsSW.aspx?cty=33&eid=471&type=CTYALL); [official source 3](https://sdsos.gov/Information/current-elected-officials.aspx); [official source 4](https://sdsos.gov/Information/executive-branch.aspx).
- **Supreme Court Justice × 5** — J. [official source 1](https://sdlegislature.gov/Statutes/16-1-2).

### TN — Tennessee

- **Supreme Court Justice × 5** — J. [official source 1](https://tncourts.gov/courts/supreme-court/about).
- **Court of Appeals Judge × 12** — J. [official source 1](https://tncourts.gov/news/2015/12/10/susano-step-down-chief-judge-will-remain-court-appeals).
- **Court of Criminal Appeals Judge × 12** — J. [official source 1](https://www.tn.gov/content/dam/tn/attorneygeneral/documents/victims/victimbrochure.pdf).

Governor is the sole statewide popularly elected executive office. Lieutenant Governor is elected by the Senate; Secretary, Comptroller and Treasurer are elected by the General Assembly. All appellate courts use statewide retention.

### TX — Texas

- **Comptroller of Public Accounts × 1** — N. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml); [official source 2](https://www.rrc.texas.gov/about-us/commissioners/).
- **Commissioner of General Land Office × 1** — N. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml); [official source 2](https://www.rrc.texas.gov/about-us/commissioners/).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml); [official source 2](https://www.rrc.texas.gov/about-us/commissioners/).
- **Railroad Commissioner × 3** — N. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml); [official source 2](https://www.rrc.texas.gov/about-us/commissioners/).
- **Supreme Court Justice × 9** — J. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml).
- **Court of Criminal Appeals Judge × 9** — J. [official source 1](https://www.sos.texas.gov/elections/voter/elected.shtml).

### UT — Utah

- **State Treasurer × 1** — N. [official source 1](https://www.utah.gov/government/).
- **State Auditor × 1** — N. [official source 1](https://www.utah.gov/government/).
- **Supreme Court Justice × 7** — J. [official source 1](https://governor.utah.gov/press/gov-cox-announces-appointments-of-jay-jorgensen-and-stephen-dent-to-the-utah-supreme-court/); [official source 2](https://legacy.utcourts.gov/utc/news/2026/09/11/news-release-justice-stephen-dent-takes-oath-of-office/).
- **Court of Appeals Judge × 7** — J. [official source 1](https://www.utcourts.gov/content/dam/court-records-publications/publications/court-publications/court-reports/2025-CourtsAnnualReport.pdf).

Supreme Court expanded from five to seven justices in 2026; Governor appointments and September oath report establish the two new seats. State Board of Education seats are district-elected.

### VA — Virginia

No expected statewide popular-election office type is absent by this title-and-membership comparison.

Judges selected by the General Assembly are not statewide popular-election seats.

Judicial exclusion: General Assembly selects state judges; the public does not elect them statewide. [Official source](https://law.lis.virginia.gov/constitution/article6/section7/).

### VT — Vermont

- **State Treasurer × 1** — N. [official source 1](https://legislature.vermont.gov/statutes/section/32/015/01003); [official source 2](https://legislature.vt.gov/statutes/constitution-of-the-state-of-vermont/); [official source 3](https://www.vermont.gov/government/statewide-officials); [official source 4](https://sos.vermont.gov/vsara/learn/elections/state-officers).
- **Auditor of Accounts × 1** — N. [official source 1](https://legislature.vermont.gov/statutes/section/32/015/01003); [official source 2](https://legislature.vt.gov/statutes/constitution-of-the-state-of-vermont/); [official source 3](https://www.vermont.gov/government/statewide-officials); [official source 4](https://sos.vermont.gov/vsara/learn/elections/state-officers).

Supreme Court retention is decided by the General Assembly, not a statewide popular ballot.

Judicial exclusion: Supreme Court appointment and General Assembly retention are not statewide popular elections. [Official source](https://www.vtcourts.gov/supreme-court).

### WA — Washington

- **State Treasurer × 1** — N. [official source 1](https://www.sos.wa.gov/elections/voters/helpful-information/elected-officials); [official source 2](https://apps.leg.wa.gov/rcW/default.aspx?cite=43.01.020).
- **State Auditor × 1** — N. [official source 1](https://www.sos.wa.gov/elections/voters/helpful-information/elected-officials); [official source 2](https://apps.leg.wa.gov/rcW/default.aspx?cite=43.01.020).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://www.sos.wa.gov/elections/voters/helpful-information/elected-officials); [official source 2](https://apps.leg.wa.gov/rcW/default.aspx?cite=43.01.020).
- **Commissioner of Public Lands × 1** — N. [official source 1](https://www.sos.wa.gov/elections/voters/helpful-information/elected-officials); [official source 2](https://apps.leg.wa.gov/rcW/default.aspx?cite=43.01.020).
- **Insurance Commissioner × 1** — N. [official source 1](https://www.sos.wa.gov/elections/voters/helpful-information/elected-officials); [official source 2](https://apps.leg.wa.gov/rcW/default.aspx?cite=43.01.020).
- **Supreme Court Justice × 9** — J. [official source 1](https://www.courts.wa.gov/appellate_trial_courts/supremecourt/?fa=supremecourt.justices).

### WI — Wisconsin

- **Secretary of State × 1** — N. [official source 1](https://doa.wi.gov/DEBFCapitalFinance/2022/2022CompleteAnnualReport.pdf).
- **State Treasurer × 1** — N. [official source 1](https://doa.wi.gov/DEBFCapitalFinance/2022/2022CompleteAnnualReport.pdf).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://doa.wi.gov/DEBFCapitalFinance/2022/2022CompleteAnnualReport.pdf).
- **Supreme Court Justice × 7** — J. [official source 1](https://www.wicourts.gov/courts/supreme/justices/).

### WV — West Virginia

- **Secretary of State × 1** — N. [official source 1](https://ethics.wv.gov/election-booklet).
- **State Treasurer × 1** — N. [official source 1](https://ethics.wv.gov/election-booklet).
- **State Auditor × 1** — N. [official source 1](https://ethics.wv.gov/election-booklet).
- **Commissioner of Agriculture × 1** — N. [official source 1](https://ethics.wv.gov/election-booklet).
- **Supreme Court of Appeals Justice × 5** — J. [official source 1](https://www.courtswv.gov/appellate-courts/supreme-court-of-appeals/about-the-court).
- **Intermediate Court of Appeals Judge × 3** — J. [official source 1](https://code.wvlegislature.gov/51-11-3/); [official source 2](https://code.wvlegislature.gov/51-11-6/).

### WY — Wyoming

- **State Treasurer × 1** — N. [official source 1](https://www.wyo.gov/state-government/elected-officials); [official source 2](https://sos.wyo.gov/Services/HistoricalInfo.aspx).
- **State Auditor × 1** — N. [official source 1](https://www.wyo.gov/state-government/elected-officials); [official source 2](https://sos.wyo.gov/Services/HistoricalInfo.aspx).
- **Superintendent of Public Instruction × 1** — N. [official source 1](https://www.wyo.gov/state-government/elected-officials); [official source 2](https://sos.wyo.gov/Services/HistoricalInfo.aspx).
- **Supreme Court Justice × 5** — J. [official source 1](https://www.wyocourts.gov/supreme-court/).
- **Chancery Court Judge × 1** — J. [official source 1](https://www.wyocourts.gov/court/chancery-court/); [official source 2](https://sos.wyo.gov/Elections/Docs/2026/2026_Judges_Standing_for_Retention.pdf).

Include the single full-time Chancery Court judge, subject to statewide retention in November 2026, as well as five Supreme Court seats.

## Count and matching qualifications

- Arizona already serves two Katie Hobbs Governor rows under different IDs. They count as two shown rows and one expected seat. Its source-less Attorney General row says “Actions”; the office therefore remains a current-holder/source gap despite a displayed title.
- DC stores four current At-Large Council memberships and one Chairman membership under the generic `Councilmember` title. Membership district, rather than title alone, matches those five seats.
- Massachusetts stores William Galvin as `Chief Election Officer`; this is the elected Secretary of the Commonwealth. Delaware and South Carolina chief election officers are appointed positions and are not treated as elected Secretaries of State.
- Appointed Attorneys General, Secretaries and other existing office rows remain in the shown counts. An appointed incumbent temporarily occupying a normally elected seat remains within the expected elected-seat count.
- A nonjudicial statewide office can be absent from this inventory if it is selected by the legislature or appointed rather than elected by the statewide public. Courts chosen solely by legislature/appointment and seats with district-only electorates are likewise excluded. Federal senators, congressional delegates, President and Vice President belong to federal coverage and are excluded from these statewide numbers.
