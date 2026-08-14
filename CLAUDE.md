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

**Reader surfaces speak plain language.** Every reader-facing string passes the 15-year-old test. Identifiers, enum values, and internal keys never render outside a technical-details disclosure: no OCD-ID, no `school_district:tucson_unified_district`, no `NO_SOURCE_FOUND` reaches a reader — label maps translate, or the row does not render. The reader gesture on a card is expansion, never clipboard — no click-to-copy affordances on reader surfaces.

**Public records are reachable. A vendor's terms describe a route, not a wall.** Every agenda, minute set, meeting notice, ballot and candidate filing this product retrieves is a public record a public body is statutorily obliged to publish. A software vendor hosting those records does not acquire rights over them, and a vendor's website terms of use are not a mechanism by which a public body can narrow statutory access to its own records. The difficulty is structural and deliberate — scattered across incompatible vendors, buried in server-rendered portals, published without feeds. That is friction, not prohibition, and routing around friction is what this product is for. **"Not found" is a claim and has to be earned**: only an enumerated record of every ladder rung attempted and what each returned (`docs/source-ladder.md`); a body without a recorded search is `NOT_ATTEMPTED`, never exhausted. "Exists but not found yet" is always a work item; "publishes nothing" is a real finding claimable only with the full ladder recorded. A 403 to a plain client, a stale URL, a feed with zero items, a server-rendered site, no documented API, unfriendly vendor marketing terms — none of these are answers. What does hold, and it is the whole of it: never authenticate or circumvent an access control; never accept clickwrap terms and then violate them; never request at a rate that degrades service (serialized requests, identified `User-Agent` with a contact address, honour `Retry-After`, never re-fetch an unchanged `contentHash`); never retrieve anything the body has not already published to the public. Everything outside those four is reachable. There is deliberately no "blocked" coverage status — a terminal we-gave-up state encoded in a schema is how giving up becomes routine; a closed route is recorded on its rung and the next rung is attempted.

**The product never tells anyone how to vote.** It presents sourced positions, sourced votes, and the reader's own stated priorities side by side. It never ranks candidates, never generates a recommended ballot, never computes a match, fit, alignment or compatibility score, and never orders candidates by anything other than a neutral criterion such as ballot order or alphabetical. This is stricter than the no-composite-score rule above and it is not a UI preference: the moment the product recommends, its neutrality claim is gone and the data business goes with it. A reader asking for a recommendation directly is not an exception, and neither is a well-sourced, transparent, explainable one — the transparency of the method is not the issue. Guarded in tests: no candidate or measure record may grow a `score`, `rank`, `rating`, `match`, `fit`, `grade`, `alignment`, or `recommendation` key.

**The collection stores never join — n stores, same rule for every n.** Three today: the search log, the reactions store, and (when notification is built) the subscription store. The search log is permanently identifier-free: no account key, no device ID, no fingerprint, no retained IP, no session key that survives the session, no subscriber ID, no foreign key to anything — it records what was asked and where, never who, and it is honest to sell only because it cannot be resolved to a person. The reactions store is identifier-free the same way, with one disclosed wrinkle: a random browser-minted continuity key, stored only hashed, that relates a browser's reactions to each other (so an answer can be changed) and to nothing else — it joins no other table, appears in no export, and its column exists on the reactions table alone. The subscription store holds an email or push token, a zip, and topic or body interests, and no behavioral history — not what was searched, not what was opened, not what was read, not what was reacted to. No store carries a column that could join to another, and there is no mapping table between any pair; tests assert the schemas share no key. The honest form of the trade: a subscriber is notified about topics they declared, not topics we inferred from watching them — a slightly worse notification product, and the only version that survives the transparency page.

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

**Disclosure at the point of capture — the one-time acknowledged notice.** (Author-revised 2026-08-16; the prior form was an always-visible sentence beside every input.) The first reaction tap a device ever makes surfaces a one-time notice — "Your answer joins anonymous local totals. We never know who you are. How we use this →" — that must be acknowledged before the answer is recorded; the acknowledgment stores device-local and the notice never repeats. The linked transparency page carries the full truth, including that totals may be sold. The gate blocks capture until acknowledged: an unacknowledged tap parks and applies only on acknowledgment, never silently records. Still never buried in a privacy policy — the notice is at the capture point, the reader must pass through it exactly once, and `tests/reactions.test.ts` pins the sentence, the link, and the park-don't-record behavior.

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

## Commands

```
pnpm dev
pnpm test
pnpm db:generate       # drizzle migration from schema changes
pnpm db:migrate
pnpm ingest <source>   # run one adapter locally
pnpm signal:snapshot   # freeze current aggregates for calibration
```

## Ask before

Adding a user data field. Adding an external source. Anything that ranks, scores, or orders candidates. Anything that renders one user's input — or any aggregate of it — back to users. Anything that changes how reactions are bucketed or exported.
