# The branch manifest

**RULING 61, adopted 2026-08-21 (NH Hunt 6). It supersedes RULING 58's
two-branch bar.**

This is the named list of routes that must be walked before this product may
say a Kelly field does not exist for a named person.

The machine-readable twin is `lib/hunt/branch-manifest.ts`, and it is
authoritative for the route ids, the counts and the exhaustion verdict.
`tests/branch-manifest.test.ts` fails the build if this document and that module
stop naming the same routes. Everything here that is a NUMBER is read from that
module.

---

## THIS MANIFEST IS INCOMPLETE, AND ALWAYS WILL BE

Read this before using it for anything.

**Reaching the end of this list is not proof that a fact does not exist.** It is
proof that these named routes returned nothing on the date they were walked.
That is a much smaller claim, and it is the only one the evidence supports.

We do not know what we do not know. There are always more ways. Three separate
times this project recorded something as absent and was wrong — once the thing
was on the first URL anyone tried; nine walls were re-tested in one session and
six answered at rung 2 the same day; Kearsarge's nine board emails sat in the
page's own `href`s after two sessions recorded them as honest absences. Every
one of those had a defensible retrieval history behind it.

So: the manifest **only grows**. A session that finds a new route adds it here
and applies it retroactively to everything already marked absent — which is why
every absence record stamps the `manifestVersion` it was earned under. A record
earned under `v1` is re-openable the moment `v2` exists. A route is **never
removed**; a route that stops working keeps its place with a dated note saying
so, because the next jurisdiction may hit that wall from a different side, and
because a deleted route is a route the next session rediscovers as new.

There is a real ceiling somewhere. This project is nowhere near it.

---

## Index by question

RULING 63: a session in another state must find the right route without reading
New Hampshire's specifics. Start here.

| The question | Routes, in the order worth trying |
| --- | --- |
| How do I find a candidate's phone number? | `filing-state` · `filing-campaign-finance-state` · `campaign-site` · `campaign-social` · `licensing-board` · `bar-directory` · `business-registry` · `chamber-directory` · `employer-listing` — then the rest of the `contact` list below |
| How do I find a candidate's email? | `campaign-site` · `campaign-social` · `lwv-questionnaire` · `candidate-interview` · `donation-platform` · `filing-fec` · `body-roster-page` (an office-holder has an official one) |
| How do I reach a town clerk record? | `filing-town-clerk` — the clerk's page at rung 2, the posted filing notice, then the clerk by phone, then `records-request` at rung 13 |
| How do I find out whether a candidate has a campaign site? | `domain-search` · `campaign-social` (the link field) · `donation-platform` · `local-newspaper` · `announcement-archive` · `party-committee-roster` · `filing-prior-candidacy` (a site from last cycle) · `web-archive` |
| A candidate has no website at all. Now what? | `campaign-social`. A campaign that lives on Facebook still has a campaign site — see the campaign-site rule in `CLAUDE.md`. It is labelled honestly and it never supplies a photo. |
| How do I find a photo I am allowed to ship? | `body-roster-page` · `legislative-directory` · `gov-staff-directory` (doors 2 and 4) · `campaign-site` (door 3) · `filing-prior-candidacy` · `web-archive` · `search-index`. **Nothing else.** Press, wire, photographer-credited and social-media images are prohibited at every door. |
| How do I find a candidate's own words? | `campaign-site` · `campaign-social` · `lwv-questionnaire` · `candidate-interview` · `announcement-archive` · `local-newspaper` · `town-report` |
| How do I enumerate a town's boards when the menu undercounts? | Not a candidate-field question — see `zip-playbook.md` §2 and its question index. The routes here that help are `town-report` (every officer the town has, in one PDF) and `minutes-naming-them`. |
| How do I confirm a person actually holds the seat? | `body-roster-page` · `legislative-directory` · `minutes-naming-them` · `town-report` · `gov-staff-directory` — the `verifiedPage` list |
| The candidate is a lawyer. | `bar-directory` first, then `licensing-board`. County-attorney and judicial races are full of them and the bar publishes an office address and a direct line. |
| The candidate runs a business. | `business-registry` · `chamber-directory` · `employer-listing` |
| The candidate has run before. | `filing-prior-candidacy` first, always. It is the most under-used route in this manifest and it reaches all four candidate fields. |
| Everything is dead — the site, the paper, the roster. | `web-archive` at rung 11, against the exact dead path. It has already shipped a portrait here. |
| The body will not publish it. | `records-request` at rung 13. Slow is a reason to file early, never a reason to skip. |
| I found a route this list does not name. | Add it here and in `lib/hunt/branch-manifest.ts`, bump nothing (ids are permanent), and say so in the session report. Check first that it is not already named — duplication is worse than a gap. |

---

## What exhaustion means now, and what changed

`VERIFIED_ABSENT` is earned **only** when every live route in this manifest for
that field type has been walked, named and dated, and every one returned
nothing.

Not a count. A named list — the same list every time — so no session decides on
the fly what "we tried everything" meant for the field it happens to be tired
of.

**Why two was not enough.** RULING 52 set the bar at two independent branches,
and that was a large improvement on the ladder's `unreachable` verdict. It is
still far too low to support the sentence it authorises. *This public person has
no campaign site* is a claim about a named person, and the transparency
mandate's evidence standard applies to it. Two branches proves almost nothing.
Trying thirty-seven routes and stopping does not tell you the forty-third would
have failed either.

**What this costs, stated plainly.** The `contact` list is nearly the whole
manifest, because a phone number can come from anywhere. That makes
`VERIFIED_ABSENT` on a contact very close to unearnable in practice — and that
is the correct outcome, not a defect in the bar. A field that cannot be
exhausted stays *still owed* and gets hunted again on its RULING 53 clock. This
project does not conclude that anything is unobtainable.

**RULING 60 is built into the shape.** A branch proven in one place is proven
for that SHAPE, not for everywhere. Each route below records what this project
actually believes about whether it travels, and a route that fails in a new
jurisdiction grows a **sub-branch** rather than being discarded. The tree gets
deeper as the country gets stranger.

---

<!-- BEGIN GENERATED ROUTES — written by `corepack pnpm manifest:doc`, never by hand -->

## The routes — manifest v2

**41 routes named**, across 37 distinct dependencies. A route may serve several fields; a route is counted once per field it can actually produce, and a route forbidden for a field (a newspaper photograph, for one) is not counted there at all.

**Routes per field type — this is the bar for `VERIFIED_ABSENT`:**

| Field | Routes that must be walked |
| --- | ---: |
| Photo | 7 |
| In their own words | 14 |
| Contact | 39 |
| Campaign site | 18 |
| Specific verified page | 8 |

> This manifest is incomplete and always will be. Reaching the end of it is not proof that a fact does not exist — it is proof that these named routes returned nothing on this date. We do not know what we do not know; there are always more ways.

### Photo — 7 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `body-roster-page` | The body's own roster or membership page, where the person holds or held office | The body's site, its members page, its department page | An official portrait (door 2), a term, an official email and phone, and the specific verified page itself | 2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup | the body's own host |
| `legislative-directory` | The state legislature's own member directory | NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21. | An official portrait, a district, a committee list, a legislative email and phone | 2 | state legislature |
| `gov-staff-directory` | Any .gov staff or official directory the person appears in | The municipal, county or state directory page | A portrait shippable at door 2 or door 4, a work phone, an official email | 2 | government directory |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |

### In their own words — 14 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `town-report` | The town's annual report | The town site's reports archive, as a PDF — rung 9, text layer first, OCR when scanned | Every officer and committee member the town has, with terms; acknowledgements naming people no roster does; occasionally addresses | 9 | municipal publication |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `campaign-social` | The campaign's social presence — Facebook, X, Instagram, LinkedIn, Bluesky, YouTube, TikTok | Opened in a LIVE BROWSER at rung 6 and read, never trusted from a search snippet | The candidate's own words; an email and phone in the page's own contact block; the link field naming a site nothing else names | 6 | the social platform |
| `ad-library` | The Meta Ad Library — mandatory public disclosure for political advertising | The Ad Library API by advertiser name and by page, or the public Ad Library search; `pnpm ad:library` walks it | For any candidate running paid political ads: the campaign's website, its disclaimer 'paid for by' string, a Page id, and frequently a contact — often better than the Page itself | 2 | meta ad library |
| `social-archive` | An archived capture of the campaign's social page | The Internet Archive against the exact page URL, at rung 11 — lawful to read, and frequently carrying the About block intact | The About section's contact block, the link field, and the campaign's own self-description as it stood on the capture date | 11 | web.archive.org |
| `social-mirror` | The same content cross-posted to a platform that is not walled | Instagram, X, Bluesky, LinkedIn, Nextdoor, linktree and the campaign's own newsletter — small campaigns push identical content to several at once | The same words, the same link field, and a contact block, from a host that answers | 2, then 6 | the mirroring platform |
| `news-embed` | Local news coverage that quotes, embeds or screenshots the social page | The paper's site searched by candidate name plus the platform, at rung 2 and rung 11 | The candidate's own words as posted, quoted by a publisher that is not walled — and the page's existence and identity corroborated by a third party | 2 and 11 | the local press |
| `local-newspaper` | The local newspaper's coverage | The town or county paper's site, searched by name; rung 11 where the archive is paywalled or gone | The candidate quoted in their own words; the announcement piece; a campaign contact the paper prints | 2 and 11 | the local press |
| `candidate-interview` | A candidate interview or Q&A feature | The paper, the local radio or TV station, a community podcast, a chamber forum recording | Long-form words of their own, and FREQUENTLY a contact detail a filing does not carry — the interview footer prints an email | 2 and 6 | the interviewing outlet |
| `lwv-questionnaire` | A League of Women Voters / Vote411 candidate questionnaire | Vote411 by address, or the state LWV's own guide | The candidate's own written answers, with a contact block the League collects as a matter of course | 2 | vote411.org |
| `announcement-archive` | The announcement — the 'X announces a run' item, wherever it landed | The paper, the party's own release, the candidate's first social post, rung 11 for a dead page | The campaign's opening self-description, a launch contact, the site as first published | 2 and 11 | the announcement publisher |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |

### Contact — 39 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `filing-state` | The state's own candidate filing — the Secretary of State or state election division | The state filing list for the cycle, per office. NH: sos.nh.gov's 2026 filing list (walled at rung 2 and 3 as of 2026-08-21 — rung 5 reaches it). | Filed name, filed mailing address, party, office, town of residence; occasionally a phone | 5 (a different egress; rung 2 refuses) | state election authority |
| `filing-county` | The county's own filing or election office record | County clerk / county election office candidate list for the cycle. In New Jersey this is the whole ballot in one born-digital PDF — `pnpm nj:filing` discovers and parses it. | The same fields as the state filing, sometimes with a contact the state list omits. In New Jersey: the FILED EMAIL and the FILED STREET ADDRESS for every candidate for every office in the county, school board included. | 2 | county government |
| `filing-town-clerk` | The town or city clerk's record | The clerk's page, the posted filing period notice, the checklist supervisors' notice, or the clerk by phone | Local-office candidates the county and state never list at all, plus addresses and often a phone | 2, escalating to 13 (the body's own records request path) | municipal clerk |
| `filing-campaign-finance-state` | State campaign-finance filings — receipts and expenditures reports | The state's finance portal, by candidate or committee name | A committee address, a treasurer's name, frequently a phone and an email that appear nowhere else | 2 | state campaign finance authority |
| `filing-campaign-finance-local` | A LOCAL candidate's campaign-finance filing, where the state requires one below state office | The state finance authority's search, by candidate and by committee. NJ: ELEC, walled at rung 2 as of 2026-08-22 — see the sub-branch on `filing-campaign-finance-state`. | A committee address, a treasurer, and a contact for a school-board or council candidate who files nothing anywhere else | 2 | state campaign finance authority |
| `filing-fec` | FEC filings for a federal candidate — Form 2 Statement of Candidacy, Form 1 Statement of Organization | docquery.fec.gov / the FEC API by candidate id | Committee street address, phone and email, and the treasurer | 2 (wired — see lib/sources) | fec.gov |
| `filing-ethics-disclosure` | State ethics or financial-disclosure filings | The state ethics commission's public filing search | An employer, a business address, sometimes a professional listing that leads onward | 2 | state ethics authority |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `voter-file-extract` | The public voter file or checklist extract | The state's public voter-list request, or a town's posted checklist | Confirms a residence and a district; never a phone, and never published wholesale here | 13 | state voter registration authority |
| `body-roster-page` | The body's own roster or membership page, where the person holds or held office | The body's site, its members page, its department page | An official portrait (door 2), a term, an official email and phone, and the specific verified page itself | 2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup | the body's own host |
| `legislative-directory` | The state legislature's own member directory | NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21. | An official portrait, a district, a committee list, a legislative email and phone | 2 | state legislature |
| `town-report` | The town's annual report | The town site's reports archive, as a PDF — rung 9, text layer first, OCR when scanned | Every officer and committee member the town has, with terms; acknowledgements naming people no roster does; occasionally addresses | 9 | municipal publication |
| `minutes-naming-them` | Minutes of the body, or of another body, that name the person | The minutes archive, searched for the name — rung 9 for PDFs, rung 12 for a vendor portal | Confirms a seat and a term; a school board's minutes name the parents who later run; sometimes an address read into the record | 9 and 12 | the body's own minutes |
| `gov-staff-directory` | Any .gov staff or official directory the person appears in | The municipal, county or state directory page | A portrait shippable at door 2 or door 4, a work phone, an official email | 2 | government directory |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `campaign-social` | The campaign's social presence — Facebook, X, Instagram, LinkedIn, Bluesky, YouTube, TikTok | Opened in a LIVE BROWSER at rung 6 and read, never trusted from a search snippet | The candidate's own words; an email and phone in the page's own contact block; the link field naming a site nothing else names | 6 | the social platform |
| `ad-library` | The Meta Ad Library — mandatory public disclosure for political advertising | The Ad Library API by advertiser name and by page, or the public Ad Library search; `pnpm ad:library` walks it | For any candidate running paid political ads: the campaign's website, its disclaimer 'paid for by' string, a Page id, and frequently a contact — often better than the Page itself | 2 | meta ad library |
| `social-archive` | An archived capture of the campaign's social page | The Internet Archive against the exact page URL, at rung 11 — lawful to read, and frequently carrying the About block intact | The About section's contact block, the link field, and the campaign's own self-description as it stood on the capture date | 11 | web.archive.org |
| `social-mirror` | The same content cross-posted to a platform that is not walled | Instagram, X, Bluesky, LinkedIn, Nextdoor, linktree and the campaign's own newsletter — small campaigns push identical content to several at once | The same words, the same link field, and a contact block, from a host that answers | 2, then 6 | the mirroring platform |
| `donation-platform` | The donation page — ActBlue, WinRed, Anedot, or the committee's own | The platform's candidate page, and the committee disclosure block on it | A committee mailing address, a contact email, and confirmation the campaign is live | 2 | the donation platform |
| `local-newspaper` | The local newspaper's coverage | The town or county paper's site, searched by name; rung 11 where the archive is paywalled or gone | The candidate quoted in their own words; the announcement piece; a campaign contact the paper prints | 2 and 11 | the local press |
| `candidate-interview` | A candidate interview or Q&A feature | The paper, the local radio or TV station, a community podcast, a chamber forum recording | Long-form words of their own, and FREQUENTLY a contact detail a filing does not carry — the interview footer prints an email | 2 and 6 | the interviewing outlet |
| `lwv-questionnaire` | A League of Women Voters / Vote411 candidate questionnaire | Vote411 by address, or the state LWV's own guide | The candidate's own written answers, with a contact block the League collects as a matter of course | 2 | vote411.org |
| `announcement-archive` | The announcement — the 'X announces a run' item, wherever it landed | The paper, the party's own release, the candidate's first social post, rung 11 for a dead page | The campaign's opening self-description, a launch contact, the site as first published | 2 and 11 | the announcement publisher |
| `party-committee-roster` | The party committee's own roster — town, county or state | The committee's site and its officers page | A contact for a candidate who holds a committee office, and the campaign site it links | 2 | the party committee |
| `employer-listing` | The employer or professional listing, where public | A law-firm bio page, a faculty page, a business site's team page | A work email and a direct phone; a portrait that is NOT shippable under any door | 2 | the employer |
| `licensing-board` | A professional licensing board — bar, real estate, medical, insurance, engineering | The board's public licensee lookup by name | A business address and phone of record, and a licence status that dates it | 2 | the licensing authority |
| `bar-directory` | The state or county bar directory, for an attorney candidate | The bar association's member lookup | An office address, a direct phone, an email of record | 2 | the bar association |
| `business-registry` | The Secretary of State's corporate registry | Business-entity search by the person's name as officer, agent or incorporator | A registered address and a phone, and the business that leads to an employer listing | 2 | state corporate registry |
| `nonprofit-filing` | IRS Form 990 and state charity filings where the person is an officer or director | ProPublica Nonprofit Explorer or the state charities registry, by name | An organisation address, and a role that a bio never mentions | 2 | irs 990 filings |
| `civic-organisation` | A civic, fraternal or service organisation listing — Rotary, Lions, Grange, VFW, historical society, library trustees | The organisation's officers page or newsletter | A contact, and confirmation of a name that a small town knows and no register does | 2 | the civic organisation |
| `congregation-listing` | A church or congregation listing naming the person | The congregation's own site, its officers or council page | A contact, occasionally the only published one | 2 | the congregation |
| `chamber-directory` | A chamber of commerce or local business directory | The chamber's member directory by name and by business | A business phone and address | 2 | the chamber of commerce |
| `professional-directory` | LinkedIn and general professional directories | The public profile, read at rung 6 | An employer, a history, occasionally a site link; rarely a direct contact | 6 | the professional directory |
| `alumni-obituary-archive` | Alumni notes, announcement and obituary archives naming the person or their family | The institution's class notes, the paper's announcements archive, rung 11 where it is gone | A hometown, a maiden name, an employer, a family connection that unlocks another route | 2 and 11 | the archive publisher |
| `prior-employer-release` | A prior employer's press release naming the person | The employer's newsroom, searched by name; rung 11 where the release is gone | A described role in the employer's words (never the candidate's), and a media contact that sometimes reaches them | 2 and 11 | the prior employer |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |
| `records-request` | The body's own public-records request path, walked as a named route | The statutory request, filed and recorded with its date | What the body holds and has not published | 13 | the body's records officer |

### Campaign site — 18 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `filing-county` | The county's own filing or election office record | County clerk / county election office candidate list for the cycle. In New Jersey this is the whole ballot in one born-digital PDF — `pnpm nj:filing` discovers and parses it. | The same fields as the state filing, sometimes with a contact the state list omits. In New Jersey: the FILED EMAIL and the FILED STREET ADDRESS for every candidate for every office in the county, school board included. | 2 | county government |
| `filing-town-clerk` | The town or city clerk's record | The clerk's page, the posted filing period notice, the checklist supervisors' notice, or the clerk by phone | Local-office candidates the county and state never list at all, plus addresses and often a phone | 2, escalating to 13 (the body's own records request path) | municipal clerk |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `campaign-social` | The campaign's social presence — Facebook, X, Instagram, LinkedIn, Bluesky, YouTube, TikTok | Opened in a LIVE BROWSER at rung 6 and read, never trusted from a search snippet | The candidate's own words; an email and phone in the page's own contact block; the link field naming a site nothing else names | 6 | the social platform |
| `ad-library` | The Meta Ad Library — mandatory public disclosure for political advertising | The Ad Library API by advertiser name and by page, or the public Ad Library search; `pnpm ad:library` walks it | For any candidate running paid political ads: the campaign's website, its disclaimer 'paid for by' string, a Page id, and frequently a contact — often better than the Page itself | 2 | meta ad library |
| `social-archive` | An archived capture of the campaign's social page | The Internet Archive against the exact page URL, at rung 11 — lawful to read, and frequently carrying the About block intact | The About section's contact block, the link field, and the campaign's own self-description as it stood on the capture date | 11 | web.archive.org |
| `social-mirror` | The same content cross-posted to a platform that is not walled | Instagram, X, Bluesky, LinkedIn, Nextdoor, linktree and the campaign's own newsletter — small campaigns push identical content to several at once | The same words, the same link field, and a contact block, from a host that answers | 2, then 6 | the mirroring platform |
| `news-embed` | Local news coverage that quotes, embeds or screenshots the social page | The paper's site searched by candidate name plus the platform, at rung 2 and rung 11 | The candidate's own words as posted, quoted by a publisher that is not walled — and the page's existence and identity corroborated by a third party | 2 and 11 | the local press |
| `donation-platform` | The donation page — ActBlue, WinRed, Anedot, or the committee's own | The platform's candidate page, and the committee disclosure block on it | A committee mailing address, a contact email, and confirmation the campaign is live | 2 | the donation platform |
| `domain-search` | A direct search for a campaign domain by candidate name | Name-plus-office and name-plus-year domain guesses, plus the search index at rung 10 | A site nothing links to | 2 and 10 | the search index |
| `local-newspaper` | The local newspaper's coverage | The town or county paper's site, searched by name; rung 11 where the archive is paywalled or gone | The candidate quoted in their own words; the announcement piece; a campaign contact the paper prints | 2 and 11 | the local press |
| `lwv-questionnaire` | A League of Women Voters / Vote411 candidate questionnaire | Vote411 by address, or the state LWV's own guide | The candidate's own written answers, with a contact block the League collects as a matter of course | 2 | vote411.org |
| `announcement-archive` | The announcement — the 'X announces a run' item, wherever it landed | The paper, the party's own release, the candidate's first social post, rung 11 for a dead page | The campaign's opening self-description, a launch contact, the site as first published | 2 and 11 | the announcement publisher |
| `party-committee-roster` | The party committee's own roster — town, county or state | The committee's site and its officers page | A contact for a candidate who holds a committee office, and the campaign site it links | 2 | the party committee |
| `professional-directory` | LinkedIn and general professional directories | The public profile, read at rung 6 | An employer, a history, occasionally a site link; rarely a direct contact | 6 | the professional directory |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |

### Specific verified page — 8 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `body-roster-page` | The body's own roster or membership page, where the person holds or held office | The body's site, its members page, its department page | An official portrait (door 2), a term, an official email and phone, and the specific verified page itself | 2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup | the body's own host |
| `legislative-directory` | The state legislature's own member directory | NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21. | An official portrait, a district, a committee list, a legislative email and phone | 2 | state legislature |
| `town-report` | The town's annual report | The town site's reports archive, as a PDF — rung 9, text layer first, OCR when scanned | Every officer and committee member the town has, with terms; acknowledgements naming people no roster does; occasionally addresses | 9 | municipal publication |
| `minutes-naming-them` | Minutes of the body, or of another body, that name the person | The minutes archive, searched for the name — rung 9 for PDFs, rung 12 for a vendor portal | Confirms a seat and a term; a school board's minutes name the parents who later run; sometimes an address read into the record | 9 and 12 | the body's own minutes |
| `gov-staff-directory` | Any .gov staff or official directory the person appears in | The municipal, county or state directory page | A portrait shippable at door 2 or door 4, a work phone, an official email | 2 | government directory |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |
| `records-request` | The body's own public-records request path, walked as a named route | The statutory request, filed and recorded with its date | What the body holds and has not published | 13 | the body's records officer |

### Whether each route travels — RULING 60

A branch proven in one place is proven for that shape, not for everywhere. The route that reached a Newbury board will not reach a borough in Alaska, an unincorporated county in Arizona, or a parish in Louisiana. This column is what the project actually believes, and honest uncertainty is a legal answer.

| id | Expected to travel |
| --- | --- |
| `filing-state` | The INSTITUTION travels — every state has one. The route does not: fifty different sites, formats and access postures, and NJ/AZ each need their own walk. |
| `filing-county` | Uneven, and this is the route whose unevenness the NJ Hunt was run to measure. New England counties are thin and publish a name and a town; New Jersey's county clerks publish the contact itself. The INSTITUTION is near-universal — every state has a county-level election office — and what it PUBLISHES is a per-state publishing practice with no national floor. |
| `filing-town-clerk` | Strong in New England town government, where the clerk is the record. Weaker where a county runs everything. |
| `filing-campaign-finance-state` | The institution is universal; thresholds are not — a small local candidate may file nothing. |
| `filing-campaign-finance-local` | Only where the state imposes a local filing obligation, and that is genuinely uneven — New Jersey does, New Hampshire does not for these offices. A session in a state without the obligation should record this route as NOT APPLICABLE with the reason, never as an absence. |
| `filing-fec` | Nationally, exactly. Federal candidates only. |
| `filing-ethics-disclosure` | Varies sharply — some states publish these, some make them request-only. |
| `filing-prior-candidacy` | Everywhere, and it is systematically under-used. A first-time candidate has none, which is itself information. |
| `voter-file-extract` | Legally uneven and slow. It is a named route because it exists, not because it is often the right one. |
| `body-roster-page` | Universal in principle. The CMS families change everything in practice — see the playbook's VTS, Apptegy, CivicPlus and TownCloud entries. |
| `legislative-directory` | Every state has one. NH publishes NO House portrait and a Senate portrait per SEAT rather than per person — see the playbook. |
| `town-report` | A New England institution above all. A township elsewhere may publish nothing like it; a county may publish an annual report that serves the same purpose. |
| `minutes-naming-them` | Universal, and slow. It is the route that finds people nothing else names. |
| `gov-staff-directory` | Wide. Anything on a .gov site is official by the author's ruling, which makes door 4 unusually reachable here. |
| `campaign-site` | Everywhere a candidate has bought a domain, which in small races is a minority. |
| `campaign-social` | Everywhere, and it MATTERS MOST in the smallest races — a campaign that lives on Facebook still has a campaign site, and recording that as nothing penalises exactly the candidates least able to buy a domain. |
| `ad-library` | Nationally and by law — political-ad disclosure is mandatory, so a candidate who buys a single ad appears. Silent on campaigns that never advertise, which in the smallest races is most of them; that silence is a fact about spending, not about the candidate. |
| `social-archive` | Everywhere the page has been captured, which is uneven for small campaigns and good for anything that drew attention. A capture is DATED and says so — it is evidence about that date, never about today. |
| `social-mirror` | Broadly, and it is the single most useful of these five in practice. A campaign posting only to Facebook is real and is the case this route does not reach. |
| `news-embed` | Everywhere there is still a paper. It is also the best AUTHENTICITY evidence in this manifest for a social page, which the campaign-site rule requires before a social page may be linked at all. |
| `donation-platform` | Nationally. Absent in races too small to raise money. |
| `domain-search` | Everywhere. Cheap, and the one route that finds an unlinked site. |
| `local-newspaper` | Everywhere there is still a paper, which is the shrinking part. Where the paper is dead, rung 11 is the route. |
| `candidate-interview` | Everywhere, and systematically under-used relative to what it yields. |
| `lwv-questionnaire` | Nationally, unevenly. It is a QUESTIONNAIRE RESPONSE — an evidenced source class — and not an endorsement, so the advocacy-source prohibition does not reach it. |
| `announcement-archive` | Everywhere. Every campaign starts once. |
| `party-committee-roster` | Everywhere. A ROSTER is a record; an endorsement LIST is somebody's judgement and is never a position source. |
| `employer-listing` | Everywhere somebody is employed publicly. Silent on the retired and the self-employed. |
| `licensing-board` | Nationally, per profession. It is a PUBLIC REGISTER and the address on it is the one the licensee published. |
| `bar-directory` | Every state has a bar. It reaches only lawyers — but county-attorney and judicial races are full of them, which is where it earns its place. |
| `business-registry` | All fifty states run one. Formats differ; the institution does not. |
| `nonprofit-filing` | Nationally, exactly — it is federal. |
| `civic-organisation` | Small-town America broadly. It is the route RULING 57's twigs are actually reachable through. |
| `congregation-listing` | Broad but shallow. Named because it exists and has yielded elsewhere; walked with care, since a person's congregation is not a fact this product publishes. |
| `chamber-directory` | Everywhere there is a chamber, which is most places. |
| `professional-directory` | Everywhere, weakly. Login walls are named, not defeated, and a profile is not the person's words about their candidacy. |
| `alumni-obituary-archive` | Everywhere, as a BRIDGE route. It rarely produces a Kelly field directly and often produces the key to one. |
| `prior-employer-release` | Everywhere somebody has worked somewhere that publishes. |
| `search-index` | Everywhere. Cheapest route in the manifest, and never sufficient on its own. |
| `web-archive` | Everywhere. It has already produced a shipped portrait here (Harold French's Senate portrait, from a 2022 capture). |
| `records-request` | Every state has a records law. It is SLOW, which is a reason to file it early in a hunt and never a reason to skip it. |

### Sub-branches grown so far

A route that failed somewhere new is never discarded — it grows a limb. Each row is a place the parent route came back empty and the fact was reached anyway.

| Parent route | Where | What failed | What reached it instead |
| --- | --- | --- | --- |
| `filing-state` | New Jersey Division of Elections, 2026-08-22 | `www.nj.gov` sits behind Imperva and refused rungs 2 and 3 on one run — and answered rung 2 plainly on several others within the same minute. An intermittent wall, and a single reading of it recorded as a property of the source is the shape `gc.nh.gov` and `sos.nh.gov` were both wrongly recorded under | rung 4 — `curl`, whose TLS fingerprint passes what Node's does not — cleared it on the run that rungs 2 and 3 refused. And the state publishes the contact document SEPARATELY from the candidate list: `...-candidates-us-house-emails-<MMDDYY>.pdf` beside `...-candidates-us-house.pdf`. A session that reads only the candidate list finds no contact and records an absence that the neighbouring file disproves. |
| `filing-county` | Morris County, New Jersey, 2026-08-22 | nothing failed — this is the reverse entry, and it is recorded here because RULING 60 is about what a route does in a new SHAPE, which includes doing better | the clerk's own candidates page names its current PDFs and the PDFs carry a real text layer: 272 candidates county-wide, 260 with a filed email and 260 with a filed street address, all fifteen 07866 candidates among them, at rung 2. The version segment in the asset path (`/v/9/`) changes on every revision and both revisions stay reachable, so discovery reads the page's own hrefs and takes the newest — a hardcoded URL here reads a superseded filing as current. |
| `filing-campaign-finance-state` | New Jersey ELEC, 2026-08-22 | `elec.nj.gov` serves an Imperva/Incapsula challenge page rather than the site — 212 bytes at rung 2, recorded here since 2026-08-19 and unchanged on re-walk today. This is a WALL and it is named, not defeated | `filing-county` reaches the same fields for New Jersey without touching ELEC at all: the county clerk's filed-candidate PDF carries the contact and the address the finance portal would have been asked for. A walled route is not a lost fact when a different branch holds the same fact — RULING 52. |
| `body-roster-page` | Kearsarge Regional School District, 2026-08-21 | the roster page's visible cells carry no email | read the cell's own href — nine board emails were in mailto: links (rung 4) |
| `campaign-social` | Merrimack County Attorney, 2026-08-21 | a search snippet carried a plausible-looking bio | open the page in a live browser and read it — the snippet is not the source, and a snippet-sourced blurb is a generated claim |
| `campaign-social` | every Newbury county candidate, 2026-08-21 | facebook.com renders ~950 KB and ZERO characters of readable text to a headless browser — rung 6 does not clear it, and the wall is deliberate anti-automation defence rather than a bug to route around | RULING 66: the five compliant routes below — `ad-library`, `social-archive`, `social-mirror`, `news-embed`, and the campaign's own site's link to the page. Authenticated or credentialed access is NEVER attempted: it breaches the platform's terms, risks the account it runs under, and RULING 12 says such a wall is NAMED, not defeated. |

### Retired routes — kept, never deleted

None. A route that stops working keeps its id and its place here with a dated note, because the next jurisdiction may hit the same wall from a different side.

<!-- END GENERATED ROUTES -->

---

## How a route is added

1. **Check it is not already here.** RULING 63: a session that builds a branch
   which already exists has committed a defect and reports it as one, naming the
   existing branch. Duplication is worse than a gap, exactly as it is in the
   tracker.
2. Add it to `MANIFEST_ROUTES` in `lib/hunt/branch-manifest.ts` with a permanent
   id, what it is, how it is reached, what it typically yields, its canonical
   ladder rung, its `through` dependency, the fields it can produce, and an
   honest sentence about whether it is expected to travel.
3. Run `corepack pnpm manifest:doc` to regenerate the table above.
4. **Apply it retroactively.** Anything already marked `VERIFIED_ABSENT` under
   the previous manifest version is now re-openable, and the verdict function
   says so rather than leaving it to be noticed.
5. Say so in the session report, as branches newly built against branches
   inherited.

## How a route is retired

It is not removed. It grows `retiredOn` and `retiredBecause`, keeps its id, and
stops counting toward exhaustion. Its failure is recorded **with the
jurisdiction and the date**, so the next state knows what to expect rather than
rediscovering it.

## Where the walk is recorded

On the record itself, never in a document. `RecordedFieldState` in
`lib/ballot/hunt-state.ts` carries the branches; `judgeManifestWalk` in
`lib/hunt/branch-manifest.ts` decides whether they add up to exhaustion and
returns the **missing routes as a work list** when they do not. Staleness is a
state the data carries (RULING 53), not a note here.
