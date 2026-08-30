# Extraction, verified against rendered content

**Measured 2026-08-29** by `pnpm verify:extraction`.

**THIS IS THE FIRST MEASUREMENT OF ITS KIND IN THIS PROJECT.** Before today, extraction had never been
verified against rendered content for any body — **0 of 42**. A silently failed extraction leaves a
plausible value behind, so no existing check could catch it: every instrument here asks *did something
come back*, and something did. The Carruth case is the shape — a district published a name six times on
a page fetched at HTTP 200, and the extractor read a news blurb instead.

## The numbers

| | Count |
|---|---|
| Rosters sampled | **44 of 44** |
| Rosters read | 40 |
| Rosters unreadable or refused | 4 |
| **Rosters where every name AGREED** | **26 of 40** |
| Names agreed | **243** |
| Names agreed ONLY in the page's client-render payload | 12 |
| Names PARTIAL (one of given/surname present) | 11 |
| Names DISAGREED (absent from the page) | **13** |

**The client-render payload column exists because this instrument once produced a FALSE ABSENCE.** It
reported five of Vail Unified's six governing-board members missing from the district's own board page and
opened NH216 against the roster. The roster was right: the names ship in the page's Apptegy payload, which
this reader was stripping along with the scripts. A name found there IS published by the government - the
column is separate because it says the page is CLIENT-RENDERED, never because the name is in doubt.

**`PARTIAL` is its own column on purpose.** A surname present with the given name absent usually means
the page changed a person's preferred form, not that we invented them — and folding it into either
neighbouring column would either raise a false alarm or hide a real one (RULING 100).

**Unreadable is counted SEPARATELY** (RULING 24). Folding it into agreement would report confidence
never measured; folding it into disagreement would accuse a roster nothing has evidence against.

## Every roster

| Body | Agreed | In payload | Partial | Disagreed | Names absent from the page | Source |
|---|---|---|---|---|---|---|
| Tucson Unified School District Governing Board | 5 | 0 | 0 | **1** | Dr. Gabriel Trujillo | https://govboard.tusd1.org/ |
| Pima County Board of Supervisors | 5 | 0 | 0 | **0** | — | https://www.pima.gov/government/board_of_supervisors/ |
| Tucson Mayor & Council | 7 | 0 | 0 | **0** | — | https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager |
| Vail Unified School District Governing Board | 0 | 5 | 0 | **1** | John Carruth | https://www.vailschooldistrict.org/o/vsd/page/governing-board |
| Newbury Selectboard | 3 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/selectboard |
| Merrimack County Delegation | 2 | 0 | 1 | **3** | James MacKay; Karen Ebel; Michael Moffett; Thomas Schamberg (partial) | https://www.merrimackcounty.net/elected_officials/delegation/index.php |
| Newbury Planning Board | 11 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/planning-board |
| Newbury Zoning Board of Adjustment | 8 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/zoning-board-adjustment |
| Newbury Conservation Commission | 6 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/conservation-commission |
| Newbury 2026 Advisory Budget Committee | 5 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee |
| Newbury Blodgett Sewer User Advisory Committee | 8 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee |
| Newbury Cemetery Trustees | 4 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/cemetery-trustees |
| Newbury Joint Loss Management Committee | 11 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/joint-loss-management-committee |
| Newbury Septic Committee | — | — | — | — | **could not read (UNREACHABLE)** | https://www.newbury.nh.gov/newbury-septic-committee |
| Newbury Trustees of the Trust Funds | 3 | 0 | 0 | **0** | — | https://www.newbury.nh.gov/trustees-trust-funds |
| Kearsarge Regional School Board | 10 | 0 | 0 | **2** | Michael Bessette; Lawrence LeBoeuf | https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members |
| Rockaway Township Council | 9 | 0 | 0 | **1** | Joseph Jackson | https://www.rockawaytownship.org/157/Township-Council |
| Morris County Board of County Commissioners | 7 | 0 | 0 | **0** | — | https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners |
| Merrimack County Board of Commissioners | — | — | — | — | **could not read (COULD_NOT_ASSERT — the source is a PDF and this reader reads HTML (ladder rung 9 owed))** | https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf |
| Rockaway Township Board of Education | 0 | 7 | 0 | **0** | — | https://www.rocktwp.net/page/board-members |
| Sunnyside Unified School District Governing Board | 5 | 0 | 0 | **0** | — | https://www.susd12.org/governing-board-home |
| Amphitheater Unified School District Governing Board | 5 | 0 | 0 | **0** | — | https://www.amphi.com/348925_2 |
| Boonton Town Council | 11 | 0 | 0 | **0** | — | https://www.boonton.org/180/Mayor-Town-Council |
| Boonton Township Committee | 6 | 0 | 0 | **0** | — | https://www.boontontownship.com/township-committee |
| Butler Borough Council | 6 | 0 | 1 | **0** | Alexander Calvi (partial) | https://www.butlerborough.com/cn/webpage.cfm?TID=19&TPID=3570 |
| Chatham Borough Council | 6 | 0 | 0 | **0** | — | https://www.chathamborough.org/government/mayor |
| Chatham Township Committee | 5 | 0 | 1 | **0** | Stacy Ewald (partial) | https://chathamtownship.org/government/mayor-township-committee/ |
| Chester Borough Council | 7 | 0 | 0 | **0** | — | https://chesterborough.org/government/mayor |
| Denville Township Council | — | — | — | — | **could not read (DISALLOWED)** | https://www.denvillenj.gov/administration/township_council.php |
| Florham Park Borough Council | 7 | 0 | 0 | **0** | — | https://www.florhamparknj.gov/departments/mayorandcouncil |
| Harding Township Committee | 5 | 0 | 1 | **0** | Christopher M. Yates (partial) | https://www.hardingnj.org/government/mayor |
| Kinnelon Borough Council | 5 | 0 | 1 | **1** | James J. Freda; Cyndi Frank (partial) | https://www.kinnelonboro.org/cn/TownCouncil/?tpid=8660 |
| Lincoln Park Borough Council | 9 | 0 | 0 | **0** | — | https://www.lincolnpark.org/129/Borough-Council |
| Madison Borough Council | 5 | 0 | 1 | **0** | Thomas Haralampoudis (partial) | https://www.rosenet.org/229/Mayor-Council |
| Mendham Borough Council | 6 | 0 | 0 | **0** | — | https://www.mendhamnj.org/cn/TownCouncil/?tpid=9705 |
| Mendham Township Committee | 6 | 0 | 1 | **0** | MembersSarah Neibart, Mayor (partial) | https://www.mendhamtownship.org/266/Township-Committee |
| Morris Plains Borough Council | 7 | 0 | 0 | **0** | — | https://morrisplainsboro.org/governing-body/ |
| Morris Township Committee | 5 | 0 | 1 | **0** | Samatha G. Rothman (partial) | https://www.morristwp.com/240/Township-Committee |
| Morristown Town Council | — | — | — | — | **could not read (DISALLOWED)** | https://www.townofmorristown.org/index.asp?Type=B_DIR&SEC={6271CCD1-1E4F-4A39-8761-63779701D8BE |
| Pequannock Township Council | 5 | 0 | 0 | **0** | — | https://www.peqtwp.org/243/Township-Council |
| Rockaway Borough Council | 7 | 0 | 0 | **0** | — | https://www.rockawayborough.org/departments/council/ |
| Wharton Borough Council | 6 | 0 | 1 | **0** | Vincent Binkoski (partial) | https://www.whartonnj.com/index.php/borough/governing-body |
| Central Arizona Water Conservation District Board of Directors | 15 | 0 | 0 | **0** | — | https://www.cap-az.com/board/board-members/ |
| Pima County Board of Adjustment, District 4 | 0 | 0 | 2 | **4** | Greg Stanton; William Yarnell; Peter Backus; Marianna Kuglmeier; Robert Fee (partial); Tim Healy (partial) | https://www.pima.gov/2792 |
