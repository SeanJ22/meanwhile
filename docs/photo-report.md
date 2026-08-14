# Photo report — every shipped photo, its source, and the judgment

The 2b rule (tightened 2026-08-19): **a clean solo portrait or honest
initials — never a screengrab, banner, logo crop, or a photo where the
person is not the unambiguous sole subject.** This report exists so a
human can verify every photo the product ships without hunting through
data files: each row names the person, the file or URL served, where it
came from, and why it passed. A photo not listed here does not ship —
`tests/candidate-cards.test.ts` asserts every shipped photo URL appears
in this file.

Judged 2026-08-19 by eyeballing every image as fetched by a plain client
(the session's 2b audit). The audit covered all 17 candidate cards and
all 8 roster officials; 6 card photos failed the rule and fell back to
initials — their misses are recorded hunts in
`data/ballot/candidate-cards-2026.json` (`hunts`, `#photo` entries),
each with every rung attempted.

## Roster officials — `lib/registry/official-photos.json`, served from `/officials/`

All eight are the GPO Congressional Pictorial Directory portrait
(450×550, public domain as U.S. federal government works), fetched via
the public-domain unitedstates/images mirror. Portraits by construction.

| Person | Served file | Source URL |
|---|---|---|
| Juan Ciscomani | /officials/C001133.jpg | https://unitedstates.github.io/images/congress/450x550/C001133.jpg |
| Mark Kelly | /officials/K000377.jpg | https://unitedstates.github.io/images/congress/450x550/K000377.jpg |
| Ruben Gallego | /officials/G000574.jpg | https://unitedstates.github.io/images/congress/450x550/G000574.jpg |
| Andy Kim | /officials/K000394.jpg | https://unitedstates.github.io/images/congress/450x550/K000394.jpg |
| Cory A. Booker | /officials/B001288.jpg | https://unitedstates.github.io/images/congress/450x550/B001288.jpg |
| Maggie Goodlander | /officials/G000604.jpg | https://unitedstates.github.io/images/congress/450x550/G000604.jpg |
| Jeanne Shaheen | /officials/S001181.jpg | https://unitedstates.github.io/images/congress/450x550/S001181.jpg |
| Margaret Wood Hassan | /officials/H001076.jpg | https://unitedstates.github.io/images/congress/450x550/H001076.jpg |

## Candidate cards — `data/ballot/candidate-cards-2026.json`

The eight photos that pass the rule, exactly as served:

| Candidate | Judgment | Source URL |
|---|---|---|
| Cinde Warmington | clean solo portrait (brick wall, arms crossed) | https://run.imgix.net/97cfce8c-9d0e-4e05-824d-283b14876207/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3/4d7eafb4-1f9c-4589-9ba4-0d1a344679e3.jpg |
| Lily Tang Williams | clean solo headshot (transparent background) | https://www.lilytangwilliams.com/wp-content/uploads/2022/01/lily-tang-williams-homepage.png |
| Gregory M. Sargent | clean solo headshot (outdoor bokeh) | https://gregforrep.com/greg-portrait.jpg |
| Karen Liot Hill | solo self-portrait at the NH State House — informal but the unambiguous sole subject | https://static.wixstatic.com/media/644896_ac32357ab0c6496a8824ebedef424559~mv2.jpeg |
| Cory Booker | solo profile portrait (B&W) | https://corybooker.com/wp-content/uploads/2020/01/cory_sq_profile.png |
| Analilia Mejia | clean solo portrait (street, arms crossed) | https://images.squarespace-cdn.com/content/v1/691b52e1abc45c143c47e6a2/1ffd50e3-47e3-411d-b5d0-94c514a55328/Headshot-+Web+Background+3.jpg |
| Tahsin Selen | clean solo portrait (suit, arms crossed) | https://static.wixstatic.com/media/7ef20c_da57f763291442e19e51303d0828044b~mv2.jpg |
| Maggie Goodlander | committed public-domain official portrait | /officials/G000604.jpg (see roster table) |

The six that fell to initials on 2026-08-19, with the failing class
(full rung-by-rung records live in the cards file's hunts):

| Candidate | What the shipped image actually was |
|---|---|
| Kelly Ayotte | WinRed campaign banner with logo text |
| Katie Hobbs | white-on-transparent campaign wordmark — not a photograph (the card the author flagged) |
| Justin Murphy | file renders blank white as fetched |
| Scott P. Brown | two-person event candid |
| John E. Sununu | two-person couple photo — a stranger cannot tell which person is the candidate |
| Rebecca Harned | canoe selfie with a child |

Cards that had no photo before and still have none: Chris Pappas, Joe
Hathaway, Andy Biggs (recorded hunts, unchanged).
