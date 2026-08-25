# The branch manifest

> **THIS MANIFEST IS A FLOOR AND NOT A CEILING.** Walking every entry in it is
> **not exhaustion**. Exhaustion is **argued in the report** — RULING 90 — and
> is never satisfied by completing this file. A session that walked the whole
> list and found nothing has established that these named routes returned
> nothing on this date, which is a much smaller claim than the one it is
> tempting to write down. **The routes you did not think of are not in here,
> and they are the ones that have been right every time.**
>
> *(Added 2026-08-22, the author's Discovery Conduct brief, item 6. It sits at
> the top rather than in the body because the failure it names happens to a
> session that is reading this file for a route, not to one reading it for its
> philosophy. See RULING 88: every hunt report lists the routes that did not
> exist at session start, and an empty expansion section fails the item.)*

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
| The campaign lives on Facebook and Facebook is walled. | **RULING 66, manifest v2.** `ad-library` (mandatory political-ad disclosure — needs a credential this project does not hold, tracker `NS01`) · `social-archive` (rung 11 against the page URL) · `social-mirror` (the same content on a platform that answers) · `news-embed` (coverage quoting it — and the best AUTHENTICITY evidence here, which the campaign-site rule requires before a social page may be linked at all). Authenticated access is NEVER attempted. |
| Which state publishes the candidate CONTACT itself? | Ask `filing-county` FIRST outside New England. New Jersey county clerks publish a filed email and street address for every office in one born-digital PDF — `pnpm nj:filing`. New Hampshire publishes a name and a town. This varies by state with no national floor, so ask rather than assume. |
| A local (non-state) candidate files campaign finance. | `filing-campaign-finance-local`. New Jersey imposes this on school-board and council candidates above a threshold; New Hampshire does not. Where the obligation does not exist, record NOT APPLICABLE with the reason — never an absence. |
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

## The routes — manifest v7

**61 routes named**, across 55 distinct dependencies. A route may serve several fields; a route is counted once per field it can actually produce, and a route forbidden for a field (a newspaper photograph, for one) is not counted there at all.

**Routes per field type — this is the bar for `VERIFIED_ABSENT`:**

| Field | Routes that must be walked |
| --- | ---: |
| Photo | 9 |
| In their own words | 16 |
| Contact | 55 |
| Campaign site | 25 |
| Specific verified page | 19 |

> This manifest is incomplete and always will be. Reaching the end of it is not proof that a fact does not exist — it is proof that these named routes returned nothing on this date. We do not know what we do not know; there are always more ways.

### Photo — 9 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `general-web-index` | A general web index that answers this project, control-checked | `lib/hunt/search-pool.ts` — Mojeek (its own crawler), 4get and Brave, rotated with a doubling cooldown on refusal. The control is CONTENT rather than size: does the answer name the subject, and does the answer for an identifier that cannot exist not. | What a person with a browser would see — RULING 94's first move and RULING 85's two-click test, made mechanical | 2, rotating across three INDEPENDENT indexes rather than three fronts of one | three separate crawlers |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `body-roster-page` | The body's own roster or membership page, where the person holds or held office | The body's site, its members page, its department page | An official portrait (door 2), a term, an official email and phone, and the specific verified page itself | 2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup | the body's own host |
| `legislative-directory` | The state legislature's own member directory | NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21. | An official portrait, a district, a committee list, a legislative email and phone | 2 | state legislature |
| `gov-staff-directory` | Any .gov staff or official directory the person appears in | The municipal, county or state directory page | A portrait shippable at door 2 or door 4, a work phone, an official email | 2 | government directory |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |
| `congress-api` | The Congress.gov API — sitting members of the federal delegation | `/v3/member/congress/{congress}/{state}?currentMember=true`, authenticated with the Congress.gov credential | Every sitting member for a state in one call, each with the chamber's own portrait URL and attribution and a specific verified page on congress.gov | 2 | the Library of Congress |

### In their own words — 16 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `general-web-index` | A general web index that answers this project, control-checked | `lib/hunt/search-pool.ts` — Mojeek (its own crawler), 4get and Brave, rotated with a doubling cooldown on refusal. The control is CONTENT rather than size: does the answer name the subject, and does the answer for an identifier that cannot exist not. | What a person with a browser would see — RULING 94's first move and RULING 85's two-click test, made mechanical | 2, rotating across three INDEPENDENT indexes rather than three fronts of one | three separate crawlers |
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
| `press-outlet-map` | The outlets a state's own encyclopedia citations cluster in, queried through their OWN site search rather than through a general engine | Harvest every citation host from the state's municipality and election articles, rank by frequency, then query each outlet's own search endpoint by candidate name | Coverage of a named candidate from a publisher that actually covers this state's politics | 2 and 7 | the state's political press |

### Contact — 55 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `party-county-directory` | The COUNTY party's own directory of its municipal committees | `morrisdems.org/candidates/municipal-candidates/<municipality>` — one page per municipality, carrying that committee's chair, email, website and Facebook page. Found with the literal query `Morris County NJ municipal Democratic committee 2026 candidates site`. | The authoritative committee URL, email and social page per municipality — the seed for every per-committee route below it | 2 (plain fetch); the page carries a control string naming the municipality | the county party organisation |
| `general-web-index` | A general web index that answers this project, control-checked | `lib/hunt/search-pool.ts` — Mojeek (its own crawler), 4get and Brave, rotated with a doubling cooldown on refusal. The control is CONTENT rather than size: does the answer name the subject, and does the answer for an identifier that cannot exist not. | What a person with a browser would see — RULING 94's first move and RULING 85's two-click test, made mechanical | 2, rotating across three INDEPENDENT indexes rather than three fronts of one | three separate crawlers |
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
| `wikipedia-municipality` | The Wikipedia article for the municipality, read as a TEMPLATED ROSTER | `action=query&prop=revisions&rvslots=main` for the article's raw wikitext, then the Local government and Federal/state/county representation sections; the officeholder templates those sections transclude are fetched the same way | The form of government and what it implies about which bodies exist; the mayor with party and term; every council member with party, term and ward or at-large seat; the county governing body; the constitutional officers; the legislative and congressional districts; and the External links block — every one carrying the footnote it came from | 2 | the Wikimedia Foundation |
| `wikipedia-election` | The Wikipedia article for the state's election in this cycle | The same API read, against `<year> <state> <office> election`, plus the per-district sub-articles it links | Declared candidates for federal and state legislative office, with their party, and the External links block that is often the only place a small campaign's own domain is written down | 2 | the Wikimedia Foundation |
| `press-outlet-map` | The outlets a state's own encyclopedia citations cluster in, queried through their OWN site search rather than through a general engine | Harvest every citation host from the state's municipality and election articles, rank by frequency, then query each outlet's own search endpoint by candidate name | Coverage of a named candidate from a publisher that actually covers this state's politics | 2 and 7 | the state's political press |
| `nces-district-directory` | The NCES public-school-district directory record for a school district | The CCD district file, joined on LEA id; the same record the coverage denominator already comes from | The district's mailing address, phone and superintendent name — one file covering every district in the country | 1 and 2 | the National Center for Education Statistics |
| `wikipedia-government-graph` | The government GRAPH, crawled — not a list of named articles but every link that resolves to a governmental entity touching this zip, followed again from each | Seed from the municipality articles for the zip, classify each outbound link by its Wikipedia CATEGORIES, expand the governmental in-scope ones, and keep going; `pnpm wiki:graph --zip <zip> --state <state>` | Bodies no list would have named — executive departments, agencies, boards, commissions and courts — each with its official site, its structure, its named officials, and the meeting or hearing schedule that makes it a reader surface | 2 | the Wikimedia Foundation |
| `congress-api` | The Congress.gov API — sitting members of the federal delegation | `/v3/member/congress/{congress}/{state}?currentMember=true`, authenticated with the Congress.gov credential | Every sitting member for a state in one call, each with the chamber's own portrait URL and attribution and a specific verified page on congress.gov | 2 | the Library of Congress |
| `fec-committee-contact` | The FEC committee record behind a federal candidate — treasurer, address, agent phone | `/v1/candidates/?state=..` for the list, then `/v1/committees/?candidate_id=..` per candidate; the FEC credential | A filed street address, city, zip and designated-agent phone for the committee — a real contact, filed by the person, on a federal form | 2 | the Federal Election Commission |
| `openstates-bulk` | The Open States / Plural BULK legislator file, already committed to this repo | Read `data/reference/openstates_legislators.csv` — 7,976 rows — and filter by jurisdiction and district. No API call, no quota. | Every state legislator with chamber, district, party and an official email address | 1 | Open States / Plural |
| `govinfo-cdir` | govinfo — the federal document collections, including the Congressional Directory | `api.govinfo.gov/collections` and the `CDIR` package, fronted by the api.data.gov credential | Member offices, phones and staff for the federal delegation, as the government publishes them | 2 | the Government Publishing Office |
| `census-acs-api` | The Census ACS API — the demographic layer behind a zip | `api.census.gov/data/{year}/acs/acs5`, authenticated with the Census credential | Population, median household income and median home value for a ZCTA | 2 | the Census Bureau |
| `lda-filings` | The Senate Lobbying Disclosure Act database | `lda.senate.gov/api/v1/filings/`, with the LDA credential | Federal lobbying registrants, their clients, and the offices they lobby. Recorded here because a credential with no route is a credential nobody decides about. | 2 | the United States Senate |
| `tier-directory-federal` | USA.gov's directories of the tier below it — every state's government, election office, governor and local-government directory | `pnpm tier:directory`. `usa.gov/elected-officials`, `/local-governments`, `/state-election-office`, `/state-governor`, `/agency-index`, `/states/{state}`. Plain GET, no key. | The state's own official entry points, named by the federal government. On 2026-08-22: 227 entities across seven routes, including the URL of New Jersey's own directory of all 564 municipalities. | 2 | USAGov (federal) |
| `tier-directory-state-localgov` | A state's own directory of its counties and municipalities, with each one's official website | `pnpm tier:directory --route <state>-localgov`. New Jersey: `nj.gov/nj/gov/county/localgov.shtml`. Reached from the federal route above rather than searched for. | Every county and municipality in the state with its official site. New Jersey returned 624 entities — 569 distinct general-purpose units — including the nine Morris municipalities the county's own page omitted. | 2 | the state government |
| `usmayors-directory` | The US Conference of Mayors' directory of member cities and their mayors | `usmayors.org`, plain GET. **RECORDED, DELIBERATELY NOT WALKED AS A SOURCE OF RECORD.** | Mayor names for member cities — as a DISCOVERY SURFACE only. It is a nonprofit's compilation, not a government publication, so RULING 70's Ballotpedia question governs it rather than public-domain status. Nothing from it may be cited to a reader; it names who to go and confirm against the city's own record. | 2 | US Conference of Mayors (nonprofit) |

### Campaign site — 25 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `party-county-directory` | The COUNTY party's own directory of its municipal committees | `morrisdems.org/candidates/municipal-candidates/<municipality>` — one page per municipality, carrying that committee's chair, email, website and Facebook page. Found with the literal query `Morris County NJ municipal Democratic committee 2026 candidates site`. | The authoritative committee URL, email and social page per municipality — the seed for every per-committee route below it | 2 (plain fetch); the page carries a control string naming the municipality | the county party organisation |
| `party-municipal-committee-gop-shape` | A municipal party committee reached by the DOMAIN SHAPE its siblings use | `<town>republicans.org`, `<town>republicans.com`, `<town>gop.org`, `<town>gop.com`, `<town>njgop.org` — every one control-probed, and the PAGE decides rather than the guess. Seeded by `randolphrepublicans.org`, found with the literal query `Randolph NJ Republican Committee 2026 council candidates`. | The committee's own site, and from its internal pages the candidates it runs | 2 (plain fetch), with a control probe per host because a parked domain answers 200 | the municipal party organisation |
| `host-inversion` | Ask a PAGE whose page it is, rather than asking each candidate about each page | Fetch each distinct host in a link corpus ONCE, control-probe it, and test its text against EVERY candidate on the ballot at once. The promotion bar is `verdictFor` plus `classifyCampaignPage`, unchanged. | Campaign sites belonging to candidates who were never paired with the page their site was linked from — three of five promotions on 2026-08-25 were of that kind | 2, with a control probe per host | whatever hosts the corpus already contains — it adds no new dependency |
| `general-web-index` | A general web index that answers this project, control-checked | `lib/hunt/search-pool.ts` — Mojeek (its own crawler), 4get and Brave, rotated with a doubling cooldown on refusal. The control is CONTENT rather than size: does the answer name the subject, and does the answer for an identifier that cannot exist not. | What a person with a browser would see — RULING 94's first move and RULING 85's two-click test, made mechanical | 2, rotating across three INDEPENDENT indexes rather than three fronts of one | three separate crawlers |
| `filing-county` | The county's own filing or election office record | County clerk / county election office candidate list for the cycle. In New Jersey this is the whole ballot in one born-digital PDF — `pnpm nj:filing` discovers and parses it. | The same fields as the state filing, sometimes with a contact the state list omits. In New Jersey: the FILED EMAIL and the FILED STREET ADDRESS for every candidate for every office in the county, school board included. | 2 | county government |
| `filing-town-clerk` | The town or city clerk's record | The clerk's page, the posted filing period notice, the checklist supervisors' notice, or the clerk by phone | Local-office candidates the county and state never list at all, plus addresses and often a phone | 2, escalating to 13 (the body's own records request path) | municipal clerk |
| `filing-prior-candidacy` | The same person's records from an EARLIER cycle | Prior-cycle filing lists, prior finance reports, archived campaign sites at rung 11 | A campaign site that has since lapsed, an email still in use, a portrait published under a door | 2 and 11 | prior-cycle records |
| `campaign-site` | The campaign's own domain | Home, About and Contact pages; `pnpm probe:site` reads what a campaign site publishes about its own candidate | A self-published portrait (door 3), the candidate's own words, an email, a phone, the site itself | 2, then 6 where the site is a JavaScript build | the campaign's own domain |
| `campaign-social` | The campaign's social presence — Facebook, X, Instagram, LinkedIn, Bluesky, YouTube, TikTok | Opened in a LIVE BROWSER at rung 6 and read, never trusted from a search snippet | The candidate's own words; an email and phone in the page's own contact block; the link field naming a site nothing else names | 6 | the social platform |
| `ad-library` | The Meta Ad Library — mandatory public disclosure for political advertising | The Ad Library API by advertiser name and by page, or the public Ad Library search; `pnpm ad:library` walks it | For any candidate running paid political ads: the campaign's website, its disclaimer 'paid for by' string, a Page id, and frequently a contact — often better than the Page itself | 2 | meta ad library |
| `social-archive` | An archived capture of the campaign's social page | The Internet Archive against the exact page URL, at rung 11 — lawful to read, and frequently carrying the About block intact | The About section's contact block, the link field, and the campaign's own self-description as it stood on the capture date | 11 | web.archive.org |
| `social-mirror` | The same content cross-posted to a platform that is not walled | Instagram, X, Bluesky, LinkedIn, Nextdoor, linktree and the campaign's own newsletter — small campaigns push identical content to several at once | The same words, the same link field, and a contact block, from a host that answers | 2, then 6 | the mirroring platform |
| `news-embed` | Local news coverage that quotes, embeds or screenshots the social page | The paper's site searched by candidate name plus the platform, at rung 2 and rung 11 | The candidate's own words as posted, quoted by a publisher that is not walled — and the page's existence and identity corroborated by a third party | 2 and 11 | the local press |
| `candidate-platform` | A civic platform carrying a page per candidate — GoodParty.org is the live case | The platform's own candidate URL, reached from a search index rather than guessed; read at rung 2 | A social link, a party label and an incumbency claim. NOT a photo and NOT the candidate's own words — see below. | 2 | the platform |
| `donation-platform` | The donation page — ActBlue, WinRed, Anedot, or the committee's own | The platform's candidate page, and the committee disclosure block on it | A committee mailing address, a contact email, and confirmation the campaign is live | 2 | the donation platform |
| `domain-search` | A direct search for a campaign domain by candidate name | Name-plus-office and name-plus-year domain guesses, plus the search index at rung 10 | A site nothing links to | 2 and 10 | the search index |
| `local-newspaper` | The local newspaper's coverage | The town or county paper's site, searched by name; rung 11 where the archive is paywalled or gone | The candidate quoted in their own words; the announcement piece; a campaign contact the paper prints | 2 and 11 | the local press |
| `lwv-questionnaire` | A League of Women Voters / Vote411 candidate questionnaire | Vote411 by address, or the state LWV's own guide | The candidate's own written answers, with a contact block the League collects as a matter of course | 2 | vote411.org |
| `announcement-archive` | The announcement — the 'X announces a run' item, wherever it landed | The paper, the party's own release, the candidate's first social post, rung 11 for a dead page | The campaign's opening self-description, a launch contact, the site as first published | 2 and 11 | the announcement publisher |
| `party-committee-roster` | The party committee's own roster — town, county or state | The committee's site and its officers page | A contact for a candidate who holds a committee office, and the campaign site it links | 2 | the party committee |
| `professional-directory` | LinkedIn and general professional directories | The public profile, read at rung 6 | An employer, a history, occasionally a site link; rarely a direct contact | 6 | the professional directory |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |
| `wikipedia-election` | The Wikipedia article for the state's election in this cycle | The same API read, against `<year> <state> <office> election`, plus the per-district sub-articles it links | Declared candidates for federal and state legislative office, with their party, and the External links block that is often the only place a small campaign's own domain is written down | 2 | the Wikimedia Foundation |
| `press-outlet-map` | The outlets a state's own encyclopedia citations cluster in, queried through their OWN site search rather than through a general engine | Harvest every citation host from the state's municipality and election articles, rank by frequency, then query each outlet's own search endpoint by candidate name | Coverage of a named candidate from a publisher that actually covers this state's politics | 2 and 7 | the state's political press |

### Specific verified page — 19 routes

| id | What it is | How it is reached | What it yields | Rung | Through |
| --- | --- | --- | --- | --- | --- |
| `party-county-directory` | The COUNTY party's own directory of its municipal committees | `morrisdems.org/candidates/municipal-candidates/<municipality>` — one page per municipality, carrying that committee's chair, email, website and Facebook page. Found with the literal query `Morris County NJ municipal Democratic committee 2026 candidates site`. | The authoritative committee URL, email and social page per municipality — the seed for every per-committee route below it | 2 (plain fetch); the page carries a control string naming the municipality | the county party organisation |
| `party-municipal-committee-gop-shape` | A municipal party committee reached by the DOMAIN SHAPE its siblings use | `<town>republicans.org`, `<town>republicans.com`, `<town>gop.org`, `<town>gop.com`, `<town>njgop.org` — every one control-probed, and the PAGE decides rather than the guess. Seeded by `randolphrepublicans.org`, found with the literal query `Randolph NJ Republican Committee 2026 council candidates`. | The committee's own site, and from its internal pages the candidates it runs | 2 (plain fetch), with a control probe per host because a parked domain answers 200 | the municipal party organisation |
| `host-inversion` | Ask a PAGE whose page it is, rather than asking each candidate about each page | Fetch each distinct host in a link corpus ONCE, control-probe it, and test its text against EVERY candidate on the ballot at once. The promotion bar is `verdictFor` plus `classifyCampaignPage`, unchanged. | Campaign sites belonging to candidates who were never paired with the page their site was linked from — three of five promotions on 2026-08-25 were of that kind | 2, with a control probe per host | whatever hosts the corpus already contains — it adds no new dependency |
| `general-web-index` | A general web index that answers this project, control-checked | `lib/hunt/search-pool.ts` — Mojeek (its own crawler), 4get and Brave, rotated with a doubling cooldown on refusal. The control is CONTENT rather than size: does the answer name the subject, and does the answer for an identifier that cannot exist not. | What a person with a browser would see — RULING 94's first move and RULING 85's two-click test, made mechanical | 2, rotating across three INDEPENDENT indexes rather than three fronts of one | three separate crawlers |
| `tier-above-directory-inversion` | The directory the tier ABOVE publishes about the tier below, read by inversion | Crawl the publisher's own roster pages and ask of each which candidates it names. A page naming exactly ONE candidate on an official host is that candidate's page; a page naming several is the roster they are listed on, and a roster is nobody's own page. | A verified page for a candidate who currently HOLDS the office — and, measured, nothing at all for a challenger | 2; `governor.nh.gov` and `nh.gov` refused rungs 3 AND 4 on 2026-08-25 | the government one tier above the office |
| `body-roster-page` | The body's own roster or membership page, where the person holds or held office | The body's site, its members page, its department page | An official portrait (door 2), a term, an official email and phone, and the specific verified page itself | 2, then 6 for a JavaScript roster, then 8 for contacts hiding in the markup | the body's own host |
| `legislative-directory` | The state legislature's own member directory | NH: gc.nh.gov, per member and per seat. Answers rung 2 at HTTP 200 as of 2026-08-21. | An official portrait, a district, a committee list, a legislative email and phone | 2 | state legislature |
| `town-report` | The town's annual report | The town site's reports archive, as a PDF — rung 9, text layer first, OCR when scanned | Every officer and committee member the town has, with terms; acknowledgements naming people no roster does; occasionally addresses | 9 | municipal publication |
| `minutes-naming-them` | Minutes of the body, or of another body, that name the person | The minutes archive, searched for the name — rung 9 for PDFs, rung 12 for a vendor portal | Confirms a seat and a term; a school board's minutes name the parents who later run; sometimes an address read into the record | 9 and 12 | the body's own minutes |
| `gov-staff-directory` | Any .gov staff or official directory the person appears in | The municipal, county or state directory page | A portrait shippable at door 2 or door 4, a work phone, an official email | 2 | government directory |
| `search-index` | The search index itself, worked as a route rather than as a reflex | Quoted name plus office, plus town, plus `site:` against each candidate host in turn | A page no other route names | 10 | the search index |
| `web-archive` | The Internet Archive, of any route above that is now dead | Snapshot URLs at rung 11, against the exact dead path | A page that existed and stopped — a lapsed campaign site, a removed roster, a moved portrait | 11 | web.archive.org |
| `records-request` | The body's own public-records request path, walked as a named route | The statutory request, filed and recorded with its date | What the body holds and has not published | 13 | the body's records officer |
| `wikipedia-municipality` | The Wikipedia article for the municipality, read as a TEMPLATED ROSTER | `action=query&prop=revisions&rvslots=main` for the article's raw wikitext, then the Local government and Federal/state/county representation sections; the officeholder templates those sections transclude are fetched the same way | The form of government and what it implies about which bodies exist; the mayor with party and term; every council member with party, term and ward or at-large seat; the county governing body; the constitutional officers; the legislative and congressional districts; and the External links block — every one carrying the footnote it came from | 2 | the Wikimedia Foundation |
| `wikipedia-government-graph` | The government GRAPH, crawled — not a list of named articles but every link that resolves to a governmental entity touching this zip, followed again from each | Seed from the municipality articles for the zip, classify each outbound link by its Wikipedia CATEGORIES, expand the governmental in-scope ones, and keep going; `pnpm wiki:graph --zip <zip> --state <state>` | Bodies no list would have named — executive departments, agencies, boards, commissions and courts — each with its official site, its structure, its named officials, and the meeting or hearing schedule that makes it a reader surface | 2 | the Wikimedia Foundation |
| `congress-api` | The Congress.gov API — sitting members of the federal delegation | `/v3/member/congress/{congress}/{state}?currentMember=true`, authenticated with the Congress.gov credential | Every sitting member for a state in one call, each with the chamber's own portrait URL and attribution and a specific verified page on congress.gov | 2 | the Library of Congress |
| `govinfo-cdir` | govinfo — the federal document collections, including the Congressional Directory | `api.govinfo.gov/collections` and the `CDIR` package, fronted by the api.data.gov credential | Member offices, phones and staff for the federal delegation, as the government publishes them | 2 | the Government Publishing Office |
| `tier-directory-federal` | USA.gov's directories of the tier below it — every state's government, election office, governor and local-government directory | `pnpm tier:directory`. `usa.gov/elected-officials`, `/local-governments`, `/state-election-office`, `/state-governor`, `/agency-index`, `/states/{state}`. Plain GET, no key. | The state's own official entry points, named by the federal government. On 2026-08-22: 227 entities across seven routes, including the URL of New Jersey's own directory of all 564 municipalities. | 2 | USAGov (federal) |
| `tier-directory-state-localgov` | A state's own directory of its counties and municipalities, with each one's official website | `pnpm tier:directory --route <state>-localgov`. New Jersey: `nj.gov/nj/gov/county/localgov.shtml`. Reached from the federal route above rather than searched for. | Every county and municipality in the state with its official site. New Jersey returned 624 entities — 569 distinct general-purpose units — including the nine Morris municipalities the county's own page omitted. | 2 | the state government |

### Whether each route travels — RULING 60

A branch proven in one place is proven for that shape, not for everywhere. The route that reached a Newbury board will not reach a borough in Alaska, an unincorporated county in Arizona, or a parish in Louisiana. This column is what the project actually believes, and honest uncertainty is a legal answer.

| id | Expected to travel |
| --- | --- |
| `party-county-directory` | The SHAPE travels — a county party that runs municipal committees generally lists them. The URL does not, and the same walk on 2026-08-25 measured Morris County's Republican committee publishing NO per-municipality directory at all, which is why `party-municipal-committee-gop-shape` exists beside this. |
| `party-municipal-committee-gop-shape` | The METHOD travels — RULING 94's third move is shape-testing and it applies anywhere. The specific shapes are American two-party naming conventions and will not survive a jurisdiction with different party structures. |
| `host-inversion` | Yes, unconditionally. It is a way of reading a corpus rather than a place to look, and it costs one fetch per host where a cross product costs one per candidate-host pair. |
| `general-web-index` | Yes, everywhere. And the wall it replaces was real: DuckDuckGo, Bing and Yahoo all refuse, and all three front the same two or three indexes — which is why independence is counted over what a branch goes THROUGH. |
| `tier-above-directory-inversion` | The technique travels; the seeds are per-state (RULING 60). New Hampshire's ballot at 03255 is federal, statewide and county with no municipal layer, and its legislators live on a General Court roster with no New Jersey equivalent. |
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
| `candidate-platform` | Nationally in principle — the platform lists races in every state — and its COVERAGE per race is unknown outside Morris County, where it was 28% of the ballot. Treat that as a measurement to be re-taken, never as a property of the route. |
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
| `wikipedia-municipality` | Roughly 19,000 US municipality articles share this template, so one parser reads all of them. New England town articles and New Jersey municipality articles both parse. Where it will break is a place with no article at all, and the smallest twigs RULING 57 exists for are exactly those. |
| `wikipedia-election` | Federal and statewide races are covered in every state. County and municipal races are almost never covered, so this route is broad and SHALLOW where the ballot is deep. |
| `press-outlet-map` | The METHOD travels to every state; the LIST does not, and is rebuilt per state. That is the point of it — it is a curated map of who covers this state, derived rather than guessed. |
| `nces-district-directory` | Every state. It is a federal collection with a uniform schema, which is why it is already the coverage denominator for school districts. |
| `wikipedia-government-graph` | The METHOD travels everywhere — every state has a Government of {state} article and roughly 19,000 municipalities have one. What does NOT travel is the category vocabulary: a state whose agencies are categorised differently needs its patterns added, and that is a sub-branch rather than a failure. |
| `congress-api` | Every state and every cycle. It is a federal API with a uniform schema. |
| `fec-committee-contact` | Every state, FEDERAL office only. It reaches nothing below Congress, which is most of a county ballot. |
| `openstates-bulk` | All fifty states — it is one national file. It carries NO photo and NO bio, which is what the caucus walk is for; the caucus walk is not for assembling the roster, because the roster is already here. |
| `govinfo-cdir` | Federal only, every state. |
| `census-acs-api` | Every zip in the country — WHEN the credential works. Walked 2026-08-22 and the host refused the held key with `X-DataWebAPI-KeyError: 1`; a keyless call is refused too. Recorded as a dated wall on the CREDENTIAL, never as a property of the source. |
| `lda-filings` | Federal only, and it closes NOTHING at a county or municipal ballot — stated plainly rather than softened, because the register's job is to let the author decide whether a credential earns its place. |
| `tier-directory-federal` | NATIONAL BY CONSTRUCTION — this is one federal publication covering all fifty states, which is the whole point of RULING 93. What it points AT differs per state, and that is the next route down. |
| `tier-directory-state-localgov` | The INSTITUTION is near-universal — a state that does not publish a list of its own municipalities is rare. The URL, the shape and the completeness are per-state and unknown until walked. New Jersey's is one page of `<li><a>`; nothing says the next one is. |
| `usmayors-directory` | Member cities only — it is a membership organisation, so its universe is self-selected and skews large. A small township is not in it, which is precisely the coverage this product exists to reach. |

### Sub-branches grown so far

A route that failed somewhere new is never discarded — it grows a limb. Each row is a place the parent route came back empty and the fact was reached anyway.

| Parent route | Where | What failed | What reached it instead |
| --- | --- | --- | --- |
| `party-county-directory` | Morris County Republican Committee, 2026-08-25 | It publishes no per-municipality directory this walk could find. Walked at its own depth on the same day — `morrisgop.org/officials` answers 200 — and its county page carries a 2024 executive board rather than 2026 municipal committees. | `party-municipal-committee-gop-shape`: probe the domain shapes a municipal Republican committee actually registers. 195 probes over 39 municipalities returned 20 live documents. |
| `general-web-index` | Startpage and searx.be, 2026-08-25 | Both answer HTTP 200 with BYTE-IDENTICAL bodies for a real query and for an identifier that cannot exist. A JavaScript shell, and a 'no result' from either would be indistinguishable from a wall. | Refused by the control query and recorded in `SEARCH_POOL_REFUSED` with the date, rather than deleted — the next session that thinks of Startpage can see it was tried and why the answer was no. |
| `tier-above-directory-inversion` | Merrimack County, New Hampshire, 2026-08-25 | 92 pages crawled across five official seeds returned 0 NEW verified pages. A tier-above directory publishes the people who HOLD offices, and this ballot is mostly the people running against them. | For a challenger the routes are `general-web-index`, `press-outlet-wp-search` and the candidate's own filed materials. This route is not a way to reach a challenger and recording it as one would be an absence built on the wrong question. |
| `filing-state` | New Jersey Division of Elections, 2026-08-22 | `www.nj.gov` sits behind Imperva and refused rungs 2 and 3 on one run — and answered rung 2 plainly on several others within the same minute. An intermittent wall, and a single reading of it recorded as a property of the source is the shape `gc.nh.gov` and `sos.nh.gov` were both wrongly recorded under | rung 4 — `curl`, whose TLS fingerprint passes what Node's does not — cleared it on the run that rungs 2 and 3 refused. And the state publishes the contact document SEPARATELY from the candidate list: `...-candidates-us-house-emails-<MMDDYY>.pdf` beside `...-candidates-us-house.pdf`. A session that reads only the candidate list finds no contact and records an absence that the neighbouring file disproves. |
| `filing-county` | Morris County, New Jersey, 2026-08-22 | nothing failed — this is the reverse entry, and it is recorded here because RULING 60 is about what a route does in a new SHAPE, which includes doing better | the clerk's own candidates page names its current PDFs and the PDFs carry a real text layer: 272 candidates county-wide, 260 with a filed email and 260 with a filed street address, all fifteen 07866 candidates among them, at rung 2. The version segment in the asset path (`/v/9/`) changes on every revision and both revisions stay reachable, so discovery reads the page's own hrefs and takes the newest — a hardcoded URL here reads a superseded filing as current. |
| `filing-campaign-finance-state` | New Jersey ELEC, 2026-08-22 | `elec.nj.gov` serves an Imperva/Incapsula challenge page rather than the site — 212 bytes at rung 2, recorded here since 2026-08-19 and unchanged on re-walk today. This is a WALL and it is named, not defeated | `filing-county` reaches the same fields for New Jersey without touching ELEC at all: the county clerk's filed-candidate PDF carries the contact and the address the finance portal would have been asked for. A walled route is not a lost fact when a different branch holds the same fact — RULING 52. |
| `filing-campaign-finance-state` | New Jersey ELEC, off the web entirely — 2026-08-22 (NJ Hunt 2, RULING 69) | the Imperva wall above was recorded as though it were the whole of ELEC. It is the whole of ELEC'S WEBSITE, which is a different and much smaller thing, and reading one as the other is how a host becomes a permanent wall in this repo | the FEC's Combined Federal/State Disclosure and Election Directory names ELEC's staff and its OFF-WEB contact: Amanda S. Haines, Executive Director, 25 South Stockton Street, 5th Floor, Trenton NJ 08608, PO Box 185, Trenton NJ 08625-0185, 609/292-8700. A telephone and a postal address are a compliant route to a public record that a WAF cannot refuse, and they take this from rung 2 straight to rung 13 — the body's own records-request path — without touching the challenge page at all. Committed at `data/reference/fec_combined_federal_state_disclosure_directory.pdf`, page 80. |
| `body-roster-page` | Kearsarge Regional School District, 2026-08-21 | the roster page's visible cells carry no email | read the cell's own href — nine board emails were in mailto: links (rung 4) |
| `body-roster-page` | Morris County, New Jersey municipalities, 2026-08-22 | nothing failed — this entry records TOOLING built for an existing route, not a new route. `pnpm roster:hunt` walks this branch across an index of sites instead of one body at a time, and `lib/hunt/roster-page.ts` reads the roster off the page | 39 sites walked, 13 returned a roster, 11 of those on a page whose OWN heading names a governing body — the control that matters, because anchor text alone chose Chatham Township's Mayors Wellness Advisory Committee as its governing body. The page carries what the encyclopedia never does: a ward, a term, a direct extension and an email per member. Two defects worth carrying forward: `<br id="isPasted">` is what a WYSIWYG editor emits and a `<br>`-only pattern silently glues names to emails (four of Rockaway's nine members vanished that way), and a page may disagree with itself — Rockaway's council page shows one address over a `mailto:` for a different one. |
| `campaign-social` | Merrimack County Attorney, 2026-08-21 | a search snippet carried a plausible-looking bio | open the page in a live browser and read it — the snippet is not the source, and a snippet-sourced blurb is a generated claim |
| `campaign-social` | every Newbury county candidate, 2026-08-21 | facebook.com renders ~950 KB and ZERO characters of readable text to a headless browser — rung 6 does not clear it, and the wall is deliberate anti-automation defence rather than a bug to route around | RULING 66: the five compliant routes below — `ad-library`, `social-archive`, `social-mirror`, `news-embed`, and the campaign's own site's link to the page. Authenticated or credentialed access is NEVER attempted: it breaches the platform's terms, risks the account it runs under, and RULING 12 says such a wall is NAMED, not defeated. |
| `tier-directory-state-localgov` | New Jersey, 2026-08-22 | `nj.gov/nj/gov/county/` — the path USA.gov itself publishes — answers HTTP 200 with a styled 'Page not found' body | the document is at `/nj/gov/county/localgov.shtml`. Found by walking path variants at rungs 2 and 3. This is why every directory route declares a control string: a status check alone reads the dead path as a success. |

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

---

## Manifest CANDIDATES from the FEC directories — RULING 69 (added 2026-08-22, NJ Hunt 2)

**These are not routes. They are offices a federal directory says exist.**

RULING 61 is explicit that a route is added when it has been WALKED somewhere,
not when a document says the office is there. Promoting a directory listing
straight into the manifest would inflate the exhaustion bar with routes nobody
has ever tried, which makes `VERIFIED_ABSENT` harder to earn without making it
mean more. So they are named here, as a work list, and each moves into the
routes table above on the day a session walks it and records what came back.

Both directories are committed and refreshable — `corepack pnpm fec:directories`
— at `data/reference/fec_state_election_offices.html` and
`data/reference/fec_combined_federal_state_disclosure_directory.pdf`, with their
provenance notes beside them. Both are public domain, being works of the United
States federal government.

### What the directory covers

All 50 states, DC, American Samoa, Guam, the Northern Mariana Islands, Puerto
Rico and the US Virgin Islands. For each: the federal disclosure offices, the
legislative committees dealing with ELECTIONS, the legislative committees
dealing with ETHICS, and nine national and international associations.

### Candidate route classes

| Candidate | What it would yield | Which existing route it would enrich |
| --- | --- | --- |
| The state's chief election office, per state | The filing authority itself, with a phone, an email and a postal address | `filing-state` |
| The state campaign-finance authority, per state | Committee addresses, treasurers, and the reports themselves | `filing-campaign-finance-state` |
| The state ethics commission, per state | Personal financial disclosure by public officials | `filing-ethics-disclosure` |
| The state corporate-records office, per state | A candidate's business, its registered agent and its address | `business-registry` |
| Legislative committees dealing with ELECTIONS (directory p. 128) | Hearing records and testimony naming local officials | none yet — a new class |
| Legislative committees dealing with ETHICS (directory p. 134) | Disclosure and complaint records | none yet — a new class |
| COGEL, NASS, NASED, NCSL, NAAG, NACo, IAGO, IFES, IIMC (pp. 143–145) | Cross-state indexes of the offices above | none yet — a new class |

### What New Jersey's own entry names, and what it does NOT

This is the direct test of whether the directory answers the publishing-practice
question the NJ Hunt raised. It answers **half** of it, and the half it answers
is the more useful one.

New Jersey, directory pages 80–81, six offices:

1. **Department of State, Division of Elections** — candidates on ballot,
   election results, federal campaign-finance reports, HAVA, NVRA, voting
   accessibility. `nj.elections@sos.nj.gov`, 609/292-3760.
2. **Election Law Enforcement Commission** — state and local campaign-finance
   reports, personal financial reports, lobby reports, public financing,
   pay-to-play disclosure. Amanda S. Haines, Executive Director; 609/292-8700;
   PO Box 185, Trenton NJ 08625-0185.
3. **State Ethics Commission** — personal financial reports for state employees.
   `ethics@ethics.nj.gov`.
4. **Office of Legislative Services, Office of Public Information** — legislative
   schedules and public information. `leginfo@njleg.org`.
5. **Department of the Treasury** — political-contributions compliance, and the
   Corporate Records Unit in Revenue and Enterprise Services.
6. **Attorney General** — counsel to the chief election official and to the
   county boards of elections and county superintendents.

**It names WHO the authority is and how to reach a human there. It does not say
what that authority PUBLISHES.** So it does not, by itself, tell the next state
whether its county clerks put a filed email in a PDF the way Morris County's
does. That still takes a walk. What it removes is the part that used to take
the longest — finding out who to walk to.

### The one it already paid for

`elec.nj.gov` has been recorded in this repo as Imperva-walled since
2026-08-19, re-walked and still walled on 2026-08-22. That was read as "ELEC is
unreachable". It is not: it is ELEC'S WEBSITE that is unreachable, and the
directory hands over a named Executive Director, a telephone number and a
postal address for the same records — a compliant route straight to rung 13
that no WAF can refuse.

That distinction — a HOST being walled versus a BODY being unreachable — is
RULING 52's whole point, and this project had collapsed the two again without
noticing. The sub-branch is recorded on `filing-campaign-finance-state` above.
