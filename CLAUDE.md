# CLAUDE.md

Civic app, two halves. Consumer side shows what's on a user's ballot with sourced candidate positions, translates ballot measures into plain language, and alerts users to nearby local government meetings. Data side captures user reactions and sells anonymized aggregates to political organizations. Consumers never pay.

## Stack

- Next.js (App Router) + TypeScript + React
- Tailwind + shadcn/ui
- Postgres on Neon, accessed through Drizzle
- Deployed on Vercel; ingestion runs as Vercel cron jobs
- Auth via Auth.js, email magic link only — no OAuth, no social login
- MapLibre GL with a vector tile provider. Not Google Maps.
- Mobile is responsive web first. A React Native client comes later if push notifications justify it, and will consume the same API.

## The order of every trade

**Correct first. Fast second. Nothing third.** Perfection and speed are both
mandatory, and when they collide, correct wins — always. A fast wrong answer
in this product is a false claim about a government, and that is the one
failure it cannot survive. Never ship partial data as complete, never let
green stand in for verified, never trade an honest gap for a plausible
guess. Data is the trophy, and nothing outside the four limits in the
public-records rule below stands between this product and it. Public records
are the product's birthright. Difficulty is friction, not refusal. Go get it.

## Non-negotiables in code

**Never generate a candidate position.** Every position, vote, or stance rendered to a user must carry a source record pointing at a specific statement, roll-call vote, filing, or questionnaire response. If no source exists, the field is null and the UI renders "no public position found." Do not infer from party affiliation, endorsements, or similar candidates. This applies to LLM-generated summaries too — summaries paraphrase a cited source, never fill a gap.

**No composite match scores.** Alignment renders per issue. No aggregate percentage, ranking, ordering by fit, or UI affordance implying a recommendation.

**Reader friction is a defect.** Remove it relentlessly. Every unnecessary click, confirmation, new tab, duplicate message, or hidden entry point is a bug with the same standing as a wrong number. The reader is trying to find out what is happening; everything between them and that answer had better be earning its place. Exactly four exceptions — friction that is the product working, checkable by number, and a change claiming one must name which: (1) the transparency disclosure at the point of reaction capture; (2) the optionality of the narrowing prompt — declining must stay the effortless default; (3) anything constituting consent to collection; (4) honesty about coverage gaps, which may never be smoothed into implied completeness. These four are load-bearing. Everything else goes.

**No user-to-user surface.** No comments, feeds, upvotes, public profiles, or shared slates. Reactions are write-only from the user's perspective — stored and aggregated, never rendered back to any user including in aggregate form. Showing aggregates anchors later respondents and corrupts the data being sold.

**Collect the minimum.** Zip or address for district resolution, an email for account identity. Do not add fields to the user model without asking first.

**The design system is committed, not improvised.** (Adopted 2026-08-15, the design pass.) Structural labels organize, content leads, flagship surfaces get flagship treatment, and reader-facing polish follows the committed tokens — `docs/DESIGN.md` and the tokens in `app/globals.css`, never a new ad-hoc scale.

**Reader surfaces speak plain language.** Every reader-facing string passes the 15-year-old test. Identifiers, enum values, and internal keys never render outside a technical-details disclosure: no OCD-ID, no `school_district:tucson_unified_district`, no `NO_SOURCE_FOUND` reaches a reader — label maps translate, or the row does not render. The reader gesture on a card is expansion, never clipboard — no click-to-copy affordances on reader surfaces.

**The register is chosen by surface, and the ask-box beat draws from a fixed pool.** (Adopted 2026-08-15, the author's voice doctrine.) Two registers, and using the wrong one is a defect with the same standing as a wrong number. *Playful* on **interaction** surfaces — asks, calls to action, expanders, empty states, confirmations: warm, casual, timeless-casual over dated slang, because a dated joke ages into a wrong-feeling product. *Level* on **claim** surfaces — funding numbers, votes, summaries, citations, refusals, coverage gaps: plain, neutral, never cute about a real person or real money. The two meet constantly and the seam is the rule, not an exception: an expander's button may be playful while every word inside it is level. The ask box's acknowledgment beat draws at random from a FIXED author-curated pool, committed at `lib/routing/ask-beat-pool.ts` — acknowledgment register only. Labels implying deliberation ("Thinking", "Pondering", "Analyzing", "Reasoning") are PROHIBITED there: nothing a reader sees is generated, and a deliberation label claims otherwise. **Code never adds a pool entry; the author does** — guarded in `tests/ask-box.test.ts`.

**The stranger test.** (Adopted 2026-08-14, the author's principle written as the standard.) A person in Tucson should be able to learn everything they'd want to know about Newbury, NH from this product alone. The completeness bar for any place is a STRANGER's, not a local's — a local fills gaps with what they already know; a stranger has nothing, so any gap a stranger would hit is a defect. Every surface, every explainer, every card is judged against the reader who has never been there: no assumed context, no "everyone knows how town meeting works," no office left unexplained, no body left unpeopled. Tester passes walk every zip as a stranger by instruction.

**Coverage claims are made against the official universe, never against our own records.** (Adopted 2026-08-14.) "We watch N of M bodies here" — M comes from the Census of Governments and the official enumerations (NCES for school districts, state municipal/authority/special-district rosters), never from counting our own registry. A registry that defines its own denominator cannot be caught missing anything — the Sunnyside class of miss is a gap in what we know exists, and only an external denominator surfaces it. The per-county audit lives in `docs/coverage-audit-by-county.md`.

**Public records are reachable. A vendor's terms describe a route, not a wall.** Every agenda, minute set, meeting notice, ballot and candidate filing this product retrieves is a public record a public body is statutorily obliged to publish. A software vendor hosting those records does not acquire rights over them, and a vendor's website terms of use are not a mechanism by which a public body can narrow statutory access to its own records. The difficulty is structural and deliberate — scattered across incompatible vendors, buried in server-rendered portals, published without feeds. That is friction, not prohibition, and routing around friction is what this product is for. **"Not found" is a claim and has to be earned**: only an enumerated record of every ladder rung attempted and what each returned (`docs/source-ladder.md`); a body without a recorded search is `NOT_ATTEMPTED`, never exhausted. "Exists but not found yet" is always a work item; "publishes nothing" is a real finding claimable only with the full ladder recorded. A 403 to a plain client, a stale URL, a feed with zero items, a server-rendered site, no documented API, unfriendly vendor marketing terms — none of these are answers. What does hold, and it is the whole of it: never authenticate or circumvent an access control; never accept clickwrap terms and then violate them; never request at a rate that degrades service (serialized requests, identified `User-Agent` with a contact address, honour `Retry-After`, never re-fetch an unchanged `contentHash`); never retrieve anything the body has not already published to the public. Everything outside those four is reachable. There is deliberately no "blocked" coverage status — a terminal we-gave-up state encoded in a schema is how giving up becomes routine; a closed route is recorded on its rung and the next rung is attempted.

**The product never tells anyone how to vote.** It presents sourced positions, sourced votes, and the reader's own stated priorities side by side. It never ranks candidates, never generates a recommended ballot, never computes a match, fit, alignment or compatibility score, and never orders candidates by anything other than a neutral criterion such as ballot order or alphabetical. This is stricter than the no-composite-score rule above and it is not a UI preference: the moment the product recommends, its neutrality claim is gone and the data business goes with it. A reader asking for a recommendation directly is not an exception, and neither is a well-sourced, transparent, explainable one — the transparency of the method is not the issue. Guarded in tests: no candidate or measure record may grow a `score`, `rank`, `rating`, `match`, `fit`, `grade`, `alignment`, or `recommendation` key.

**Organizations render as filed, never characterized.** (Adopted 2026-08-14, second session.) A contributor organization renders with its FEC-registered name and committee type, linking to its FEC page. The app NEVER labels an organization's affiliations, alignments, or politics — never "an AIPAC affiliate," never "a progressive group," never "-aligned" anything. The reader who wants to know what an org is clicks through to the filing. Guard-tested on the funding surfaces for characterization strings where feasible; the rule itself is law regardless of what the guard can reach.

**A photo ships through one of four doors, and the composition standards are not one of them.** (The four-door structure adopted 2026-08-15, the author's ruling.) Two halves, and confusing them is the failure this rule exists to prevent. **Each door carries its own adoption stamp on its own line below** — the doors became law on different days, and a single parenthetical holding three dates left one of them ("and 2026-08-14", with no stamping verb in front of it) invisible to `pnpm verify-stamps`. A stamp nothing audits is a stamp nobody can catch.

*The standards never move, at any door.* A clean solo portrait or honest initials — never a wrong face, never a banner, a logo, a wordmark, a group shot, an event candid where the person is not the unambiguous sole subject, a screengrab, or a generated likeness. Any doubt about identity fails at every door. EXIF stripped, served from our own origin, source URL recorded per row, remove-on-request honoured. A door is permission to use a source; it is never permission to ship a worse picture.

*The doors govern the source basis only, and are tried in order:*

1. **An explicit recorded license** (door 1, adopted 2026-08-13) — public domain (GPO, a chamber's own release), or a machine-checkable Commons license, recorded per row.
2. **An official government-published portrait** (door 2, adopted 2026-08-14) — the portrait a government body publishes to identify its own member — with attribution to the publishing body and remove-on-request.
3. **The campaign's own self-published portrait from its own site** (door 3, adopted 2026-08-15) — an `og:image` or a site headshot on the candidate's own domain, labeled "campaign-provided," source recorded, remove-on-request. A campaign publishing its candidate's face for recognition is distributing it.
4. **Last resort, when doors 1–3 all fail for a person** (door 4, adopted 2026-08-15) — any portrait published on the candidate's own campaign site or on any `.gov` site (anything on a `.gov` site is official, by the author's ruling). Post it, cite it, move on. Remove-on-request.

*Prohibited at every door, unchanged:* press photos, wire images, photographer-credited images, and social-media images. That is the demand-letter class and no door reaches it — a working photographer's copyright is not narrowed by where the image was reposted.

Every shipped photo records WHICH door it shipped through (`docs/photo-report.md`, one row per photo); every miss records which doors were tried, per person (`docs/photo-report.md` again — equal effort per candidate applies to photo hunts by name).

**A campaign that lives on Facebook still has a campaign site.** (Adopted 2026-08-15, the author's ruling.) In small races the campaign's whole public presence is often a social page — no domain, no site, just a page. Recording that as "no campaign site found" hides a real, findable thing from the reader, and it penalizes exactly the candidates least able to buy a domain, which is the information asymmetry the equal-effort rule exists to catch. So a social page MAY serve as the campaign-site link when AUTHENTICITY is establishable: the page self-identifies with the filed candidate name, the office and the cycle, AND is reachable by an authoritative trail — named in a filing, linked by the county party or local press, or the top self-identified match — with that trail recorded as the link's source. It renders labeled honestly — "the campaign's Facebook page" — never dressed as a website. It NEVER supplies a photo: social-media images are prohibited at every door of the photo rule, and a door the campaign-site rule opens is not a door into the photo rule. It supplies no prose beyond the labeled self-description the blurb rule already governs.

**Equal effort per candidate within a race.** (Adopted 2026-08-14, the tester's mobile pass — her finding, in her words: "Karen might be the perfect fit for me, but she has no information here. So I'm only going to look at the folks that do have information... how could using this app actually impact voter outcomes instead of collect information from voters.") The app can say nothing about anyone and still tilt a race, because a thin card tracks incumbency and campaign professionalism, not merit — information asymmetry is a thumb on the scale that no neutrality rule above catches. So: hunts for candidate information — photos, blurbs, contacts, sites — are run for EVERY candidate in a contest to the same rung depth, and misses are recorded per candidate, never left as a blank that reads as absence of the candidate. A hunt that stops when the well-covered candidates are done is not finished; it has produced a ranking. Where the hunt still comes back empty the absence is named on the card in the standard line ("We haven't found much about this candidate yet." — `THIN_CANDIDATE_LINE`, one sentence, no apology, describing our research and never the candidate). **The app's neutrality includes what it fails to find.**

**Every blurb carries its source class.** (Adopted 2026-08-14, second session.) Any prose describing a person or organization names where it came from, in the register the candidate cards already ship ("In the campaign's words — [domain], read [date]"). No unlabeled descriptions of real people or orgs, anywhere, ever — a description without its source class is treated as a generated claim and removed.

**The collection stores never join — n stores, same rule for every n.** Three today: the search log, the reactions store, and (when notification is built) the subscription store. The search log is permanently identifier-free: no account key, no device ID, no fingerprint, no retained IP, no session key that survives the session, no subscriber ID, no foreign key to anything — it records what was asked and where, never who, and it is honest to sell only because it cannot be resolved to a person. The reactions store is identifier-free the same way, with one disclosed wrinkle: a random browser-minted continuity key, stored only hashed, that relates a browser's reactions to each other (so an answer can be changed) and to nothing else — it joins no other table, appears in no export, and its column exists on the reactions table alone. The subscription store holds an email or push token, a zip, and topic or body interests, and no behavioral history — not what was searched, not what was opened, not what was read, not what was reacted to. No store carries a column that could join to another, and there is no mapping table between any pair; tests assert the schemas share no key. The honest form of the trade: a subscriber is notified about topics they declared, not topics we inferred from watching them — a slightly worse notification product, and the only version that survives the transparency page. **The intake limiter is this rule under load (T08):** rate limiting requires transient tracking of a submitting device, and that state lives in its OWN space — the `intake_limiter` table, keyed by a digest deliberately different from the reaction store's continuity hash (`sha256("intake-limiter:" + key)` vs `sha256(key)`), holding counters only, expiring on its own 48-hour schedule, joined to nothing, exported in nothing. A protection that violates n-stores-never-join to enforce it has failed; `tests/db-schema.test.ts` asserts the limiter table shares no joinable column with any store. Rows that trip a limit but land anyway are quarantined by `suspect_reason` — a why, never a who — and excluded from every aggregate unconditionally; nothing auto-deletes, the author decides. The intake protections sit behind `ripcord.rateLimits` (thresholds tunable via `WTP_LIMIT_*` env vars) and the master ripcord `ripcord.reactionIntake` closes all intake writes; the 2am pull procedure is `docs/ripcords.md`. Validity checks — real target ids, closed enums, length caps, and the like — are never behind any flag.

**Every production probe row a session creates is NAMED in its report.** (Adopted 2026-08-15, the author's standing order.) A session that taps a reaction, fires a log event, or otherwise writes a row against production states it in the standing report — the timestamp, the target, and what it was proving. The reason is not tidiness: these stores are sold as reader signal, and a row a session created is plumbing wearing reader clothes. Unnamed, it is indistinguishable from a real answer, and the author cannot tell which without an investigation — the T08 session named its probes and the 0814f session did not, and that cost exactly such an investigation. Naming them is also what makes a later quarantine or exclusion a filter rather than a hunt. The same obligation covers rows a session's automated walk creates.

**The ripcord doctrine — legally-open features ship behind named kill switches.** (Adopted 2026-08-13, author-approved.) A feature whose legal or policy question is open but whose build is otherwise sound may ship only when: (1) it sits behind a named flag — a ripcord — whose tracker row states the flag name, the open question, and WHO closes it (a named closer, e.g. counsel); (2) every record the feature produces carries a provenance tag so pulling the ripcord is a filter, never a migration or a hunt; (3) ripcorded data never enters an export or a sold aggregate until its question closes — a ripcord that only hides the UI while the data flows downstream is not a ripcord; (4) the transparency page changes in the same commit that ships the feature. The first application is the FEC funding surface (tags `FEC_COMMITTEE`, `FEC_CONTRIBUTOR`; ripcords `ripcord.fecContributorDisplay` and `ripcord.fundingReactionsInAggregates`, the second shipping PULLED) — deferred whole this session; its tracker rows carry the flags and the closer.

**A join that can collapse must be asked for distinctness — identical payloads across distinct keys are presumed broken.** (Adopted 2026-08-14, the FEC replication bug.) The sibling of the count check below: a match rate can read 100% while every match points at the same row. Any join or enrichment binding values to keys must be checkable for per-key uniqueness — no two officials share an FEC committee id unless the FEC itself proves the share (`tests/funding.test.ts`, the D40 family). The rule extends to every layer that can alias keys: an HTTP response whose body varies by a request input must carry that input where every cache implementation keys on it — in the path, never only a query string on a `public` response (production served one campaign's books for three politicians exactly this way), and a client component holding fetched state must reset it when its key prop changes. When adding a keyed join, enrichment, or cacheable endpoint, state how distinct keys are proven to produce distinct results.

**The zip playbook is append-only, and every depth run ends with its diff.** (Adopted 2026-08-15, the author's standing order; tracker R13.) `docs/zip-playbook.md` is the machine-checkable definition of done for a zip and the source ladder per jurisdiction type. It is written by the sessions that discover it: **the rungs written so far are the rungs discovered so far, and every new state is presumed to teach new ones** — discovering and recording a rung is the work, not a deviation from it. Entries are APPEND-ONLY: a rung that stopped working gets a dated note beside it, never a deletion, because the next state may hit the same wall from a different side. Every zip or depth run ends with a **playbook diff** — what was added — or an explicit "nothing new," stated in the standing report. A run that learned something and did not write it down has spent the discovery and kept nothing.

**An operation that can return nothing must be asked what it returned.** No adapter, join, or scripted edit may report success without stating its count. The shape has now been sighted four times — an empty RSS feed recorded as working, a zero-match join presented as a clean build, a scripted edit that edited nothing and exited 0, and a NovusAgenda portal returning 200 with zero meetings recorded as a HIT. Every adapter reports fetched/normalized/dropped per run (`ReportingMeetingSource`); the snapshot writer refuses a snapshot whose sources do not state integer counts (`lib/meetings/snapshot.ts`, guarded in `tests/snapshot.test.ts`); parse tests assert minimum row counts against recorded fixtures, never merely the absence of an error. When adding any of these, state the count and the denominator — a deliberate clip must not read as a failure, and a real failure must not read as a clip.

## Entry experience

The app opens on a map. The user enters a zip code, the map zooms, upcoming local meetings and hearings render as pins.

Zip is orientation only. ZCTAs cross city, county, school district, and legislative boundaries, so a zip can never resolve a ballot. Store zip as `approximate_location` and never treat it as district truth. Prompt for a street address only when the user wants their actual ballot, and explain why at the point of asking.

Zoom targets come from Census ZCTA centroids. District boundaries from Census TIGER/Line.

Never render an empty map. If nothing upcoming is in view, widen the radius, then show recently decided items, then fall back to district boundaries with officeholders.

## Reaction capture

This is the revenue-generating path. Treat it accordingly.

Reactions are always asked **after** the explanation, never before.

**Measures** are decomposed into contested provisions — funding mechanism, spending program, oversight, sunset — and reactions attach to provisions, not to the measure as a whole. Schema must support many reactions per measure keyed by provision.

**Candidates** get reactions attached to a specific sourced position, never to the candidate as a whole. The question is "would you vote for someone who holds this position," not "do you like this candidate."

Each reaction has a one-tap binary and an optional free-text field. Binary carries volume; text carries color. Never require the text.

**Incumbent and challenger reactions are stored and aggregated in separate buckets.** Incumbents have records, challengers have rhetoric. Aggregating them makes incumbents look worse by construction.

**Disclosure at the point of capture — the one-time acknowledged notice.** (Author-revised 2026-08-13; the prior form was an always-visible sentence beside every input.) The first reaction tap a device ever makes surfaces a one-time notice — "Your answer joins anonymous local totals. We never know who you are. How we use this →" — that must be acknowledged before the answer is recorded; the acknowledgment stores device-local and the notice never repeats. The linked transparency page carries the full truth, including that totals may be sold. The gate blocks capture until acknowledged: an unacknowledged tap parks and applies only on acknowledgment, never silently records. Still never buried in a privacy policy — the notice is at the capture point, the reader must pass through it exactly once, and `tests/reactions.test.ts` pins the sentence, the link, and the park-don't-record behavior.

**Moderation runs before any export.** Free text about named real people will contain slurs and threats. No aggregate leaves the system unfiltered.

**The free-text input carries a threat notice.** Adjacent to the field, plain and short: threats of violence are removed and may be reported to law enforcement. Wording is "may," not "will" — a stated commitment that isn't honored on every instance is worse than a reserved right.

Flagged text is preserved with full metadata, never silently deleted — deletion destroys evidence. Flagging never auto-reports; every report passes human review first. See `docs/abuse-policy.md`.

## Signal integrity

The attacker with the strongest motive is a buyer. A campaign that can fake eight thousand lookups in a district shapes what the other side spends money on. Design against a funded adversary, not a kid with a script.

Gates, cheapest first:
- Device attestation on every write — App Attest, Play Integrity, Cloudflare Private Access Tokens. Proves a real device without identifying a person.
- SMS verification with carrier lookup. Reject VoIP and prepaid numbers. This is the single highest-value gate per unit of friction.
- Address validation via USPS or Smarty — confirm existence, residential, deliverable. Invisible to the user. Cap responses per household.
- No postcard verification. Kills the funnel on a free product nobody's heard of.

Weight, don't gate. The product has natural proof-of-work: a real user reads the explainer before reacting. Record time on measure, scroll depth, provision expansions, and arrival-to-answer gap. Store an engagement score on every reaction and weight it in aggregation. Bots jump to the endpoint; faking realistic reading across thousands of accounts is expensive and leaves patterns.

Honeypots: occasionally serve a provision nobody would have an opinion on, or a fake measure in a district that has none. Scripts answer everything.

Anomaly detection runs on the aggregate layer — timing bursts, response clustering, text entropy, geographic distribution against population density. Assume detection, not prevention.

**Every export reports its confidence mix.** Counts by verification tier — device-attested, SMS-verified, address-validated, unverified — plus engagement-weighted and raw figures. Never ship a single blended number. Stating the confidence converts an unsolvable problem into a disclosed one.

## Data model conventions

OCD-IDs (`ocd-division/country:us/state:az/...`) are the universal join key for districts, offices, and elections. Every geographic entity carries one. Never join on name strings.

Evidence is tiered and stored explicitly: `STATEMENT` (what they said), `RECORD` (how they voted), `FUNDING` (who paid). The UI keeps these visually distinct. Don't collapse them.

Every externally sourced record stores `source_url`, `source_org`, `collected_at`, `verified_at`. Provenance is never dropped in a transform.

Signal snapshots are immutable and timestamped. Calibration depends on being able to prove what the data said before an outcome was known. Never backfill or amend a published snapshot — write a correction record instead.

## External sources

| Source | Purpose | Auth |
|---|---|---|
| Congress.gov | federal bills, members, House roll calls | API key |
| clerk.house.gov / senate.gov | authoritative roll-call XML | none |
| unitedstates/congress (GitHub) | public-domain roll-call collectors | none |
| Plural Open (ex-Open States) | state bills and votes, all 50 states | API key via open.pluralpolicy.com |
| OpenFEC | contributions, independent expenditures | API key |
| Google Civic — Divisions | address → OCD-ID | API key |
| Democracy Works Elections | elections and ballots to sub-municipal | licensed, contact |
| Granicus Legistar | municipal agendas and hearings | mostly open web API |
| Vote Smart | candidate questionnaires | API key |
| Census TIGER/Line + ZCTA | boundaries and zoom centroids | none |

The Google Civic **Representatives** endpoint shut down April 2025. Any code or doc referencing it is dead — use Divisions for OCD-ID resolution and get officeholders elsewhere.

GovTrack's API may have been discontinued in summer 2026. Verify before adding a dependency on it.

Do not add advocacy organizations, PACs, or endorsement sites as sources. Go to the underlying government filing.

## Repo layout

```
app/                  routes and pages
components/           UI, shadcn primitives in components/ui
lib/
  sources/<name>/     one ingestion adapter per external source
  db/                 drizzle schema, migrations, queries
  ocd/                OCD-ID parsing and district resolution
  signal/             reaction aggregation, snapshots, export
scripts/              backfills and data exploration
docs/                 methodology, abuse policy, calibration log
tests/fixtures/       recorded API responses, no live calls in tests
```

Every source adapter exports `fetch()`, `normalize()`, `upsert()`. Adding a source means adding a directory, never editing shared ingestion logic.

Schema changes go through Drizzle migrations. No hand-edited SQL against the database.

Task status lives in `docs/tracker.csv`. Update the Status and Notes of any item you work on, in the same commit as the work. **A status change edits the existing row. It never appends a second row with the same ID** — a tracker with two rows per ID cannot be read by anything, including the xlsx view generator, and it silently breaks every lookup by ID. M02 and M04 each carried a duplicate pair for a day before anyone noticed. Nothing is marked Done without evidence in Notes: the branch name, and which of `test` / `lint` / `build` passed. A commit SHA cannot be used — it does not exist inside the commit that would name it. An agent grading its own homework drifts optimistic; this tracker only earns its keep if it tells the truth.

**An agent does not know today's date, and a date not read from the system clock is a fabrication.** Every stamp entering any document — a tracker Note, a `state.md` section, an `Adopted` line in this file, a provenance field — comes from `pnpm stamp`, which prints today in `America/Phoenix` (a UTC read after 5pm local is a day ahead, and that is the same bug wearing a smaller hat). A plausible date is not a date; it is the same failure as a generated candidate position — a confident claim with nothing behind it — and it is worse here, because it misdates the rule every later decision was supposedly made under. Guarded at authorship by the pre-commit hook and in the suite by `tests/doc-dates.test.ts`; `pnpm verify-stamps` audits this file's `Adopted` stamps against the git history that would have to be true for them, and writes `docs/stamp-audit.md` for the author to rule on. Nothing corrects a stamp automatically — an agent that repaired a date would be doing the thing that caused the defect.

## Commands

```
pnpm dev
pnpm test
pnpm db:generate       # drizzle migration from schema changes
pnpm db:migrate
pnpm ingest <source>   # run one adapter locally
pnpm signal:snapshot   # freeze current aggregates for calibration
pnpm stamp             # today's date, YYYY-MM-DD, America/Phoenix
pnpm verify-stamps     # audit CLAUDE.md's Adopted dates against git history
```

## Ask before

Adding a user data field. Adding an external source. Anything that ranks, scores, or orders candidates. Anything that renders one user's input — or any aggregate of it — back to users. Anything that changes how reactions are bucketed or exported.
