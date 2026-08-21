# CLAUDE.md

Civic app, two halves. Consumer side shows what's on a user's ballot with sourced candidate positions, translates ballot measures into plain language, and alerts users to nearby local government meetings. Data side captures user reactions and sells anonymized aggregates to political organizations. Consumers never pay.

## Stack

**This section names DECISIONS, never versions.** (Rewritten 2026-08-20,
Prompt C item 4.3.) A framework version written here goes stale the next time
anyone runs an upgrade, and a stale constitution is worse than a short one — a
session reads it as current and builds against a fact that is no longer true.
So the shelf-life content lives where it is authoritative and this points at it:
**`package.json` and `pnpm-lock.yaml`** for what is installed, **`netlify.toml`**
for how the deploy builds, **`next.config.ts`** for what the build does, and
**`drizzle.config.ts`** for the database wiring.

What does not drift, and is therefore law:

- Next.js (App Router) + TypeScript + React.
- Tailwind + shadcn/ui. The design tokens are committed — see the design-system
  rule below.
- Postgres on Neon, accessed through Drizzle. **Schema changes go through
  Drizzle migrations; no hand-edited SQL against the database**, and a
  migration is applied with `pnpm db:apply`.
- **Deployed on NETLIFY.** Not Vercel — the file said Vercel for months and it
  was never true of this repo. The build Netlify runs is the literal command in
  `netlify.toml`, and `.github/workflows/build-check.yml` runs that same string
  on every push so a refused build is readable without the author's Netlify
  login.
- **The scheduler is GitHub Actions, not platform cron.** Five workflows push
  `main` — the four governed-artifact refreshes plus the intake tripwire — and
  each rebases and retries through `scripts/push-main.mjs`, because two of them
  running close together used to lose one run's work (R48).
- Auth via Auth.js, email magic link only — no OAuth, no social login.
- MapLibre GL with a vector tile provider. Not Google Maps.
- Mobile is responsive web first. A React Native client comes later if push
  notifications justify it, and will consume the same API.

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

### THE TRANSPARENCY MANDATE

(Adopted 2026-08-16, the author's directive. Copied verbatim from the h session
brief. It governs every hunt in this product, and every session inherits it at
session-open. It sits above the operational rules below because they inherit
from it.)

Get out of my way. This public information is mine and I need to read it.

These are PUBLIC bodies and PUBLIC people. Their records, their meetings, their money, and their votes are already owed to the reader. Difficulty of access is frequently deliberate, and this product exists to defeat it — forcing the transparency that is already required. That mission governs every hunt.

Do not fail. Find every avenue, every back door, every nook, every cranny.

* Difficulty is an obstacle to out-climb and/or out-maneuver, never a reason to stop. A hunt that ends before the ladder is exhausted is an incomplete hunt, not a finding, and may never be reported as one.
* A wall never renders as an emptiness. A failed retrieval is reported as a failed retrieval, with the wall named and every rung listed with its result. "No meetings" is never the render for "could not reach the calendar." Absence is never asserted.
* Where a body is REQUIRED to publish and has not, that is a finding and it renders as one — the obligation stated, the date checked, the rungs walked. That sentence, in front of a reader, IS the transparency being forced. That being said, this is a LAST RESORT — as a reminder, this is public information and it is required to be SOMEWHERE. Reaching for the finding before the ladder is exhausted is the incomplete hunt this section forbids, wearing a respectable face. And it carries an EVIDENCE STANDARD, because it is a legal claim about a named body, not a retrieval report. It renders only when the record holds: the specific publication obligation; the authoritative source for that obligation (statute, rule, or charter, cited); why the obligation applies to THIS body and THIS document or data type; the obligation's effective date, or the version of the legal text applicable on the date checked; the date checked; the complete retrieval history; and the final failed state. Where the obligation itself is uncertain, the surface renders the retrieval failure honestly and NEVER upgrades it to a compliance claim. No claim without a source record — the same law as everywhere else in the product.
* Every wall that falls becomes a rung, so it never costs a second session.
* Two prohibitions remain, and neither is caution: no residential-proxy spoofing, and nothing fabricated when the ladder is genuinely exhausted. We take everything that is owed and we invent nothing.

**Recorded deviation from the source document, so a later comparison reads it as a decision and not as drift** (recorded 2026-08-17; the adaptation itself was made 2026-08-16 by the h session and reported then). The text above is verbatim from the h session brief with ONE adaptation: the brief's first bullet and its operational-interpretation paragraph each cited experimental control **C5**, and the same brief separately forbade copying its experimental controls into `CLAUDE.md`. Those two clauses therefore read here without the C5 reference. Nothing else was changed, compressed, reordered or paraphrased. A session diffing `CLAUDE.md` against the h brief will find exactly this difference and no other.

### THE LADDER, EXHAUSTIVELY — AND IT IS THE ONLY NUMBERED ONE

(The standing definition — a hunt is over only when every rung below has been
walked and recorded with `attemptedAt` and its result. These fourteen rungs are
`ladder vH-start`.)

**THIS IS THE CANONICAL RETRIEVAL-MECHANICS LADDER, and its numbering is the
numbering that reaches the database.** (Named canonical 2026-08-20, the
author's ruling; `docs/rulings.md` carries it as RULING 16.) A `walledAtRung`
value written anywhere in this product is a rung number FROM THIS LIST and from
no other.

The collision this closes: `docs/source-ladder.md` carried its own numbered
list of thirteen, and it is a DISCOVERY ladder — where a document lives, not
how to get bytes past a wall. Two numbered ladders in one repo meant a "rung 7"
in a throw site and a "rung 7" in a document were different rungs, and nothing
said so. The thirteen are retired in place with a dated note and their content
lives on as the lettered where-to-look ladder in `docs/zip-playbook.md` §2,
lettered precisely so it can never collide with these numbers again.

Rung values written before F22 (2026-08-20) are PROVENANCE-UNKNOWN. F22 was the
session that made throw sites name their rung in this numbering, so everything
earlier is uncertain — those values are MARKED as unknown and are never
reinterpreted, because guessing which ladder an old number meant would
manufacture a retrieval history nobody walked.

1. Committed snapshot.
2. Plain fetch.
3. Fetch with the full browser header set.
4. A different CLIENT whose TLS fingerprint passes (curl beat the fingerprint filter in the f session where header-swapping did not).
5. A different EGRESS — g3's finding: a rung is `(client, headers, URL, egress)`. A CI runner's IP being refused is an EGRESS wall, not a header problem; name it and move to another rung rather than hunting headers.
6. The LIVE BROWSER with JavaScript executed and content awaited. A page that renders for a human renders for us. A plain fetch returning nothing on a JS-rendered page is a FALSE MISS, not a wall.
7. The page's own network calls — the JSON endpoint feeding the widget is usually right there, and it is better data than the HTML.
8. Structured markup the prose hides — vCard, JSON-LD, microdata, RSS, iCal. (The playbook's "prose said no; ask the markup": Newbury's ZBA venue lived in a vCard block behind a map link.) An `.ics` feed is a calendar handed to us.
9. Linked documents in EVERY format. PDFs ARE DATA — text-layer extraction first, OCR when scanned. "Paper-only" and "not machine-readable" are honest ONLY when the document does not exist online — never when a PDF is sitting on the body's site unparsed.
10. Sitemaps, search-index caches, directory listings.
11. The Internet Archive, with snapshot URLs.
12. The vendor platform underneath — Diligent/BoardDocs, Granicus, CivicPlus and siblings expose predictable paths and APIs; identify the platform and use its own interface.
13. The body's own public-records request path, as a named rung.
14. The author's browser, last.

Operational interpretation of "every wall that falls becomes a rung": every successful wall-breaking method becomes a PERMANENT reusable step in the playbook, whether it is code or procedure. Only a genuinely NEW RETRIEVAL CLASS increments the numbered ladder. A new technique inside an existing rung enriches that rung; it does not renumber the ladder. This preserves the mandate verbatim while keeping the ladder version stable.

Every session reports RUNGS ADDED and where they landed — which existing rung
was enriched, or, for a genuinely new retrieval class, which number was added.
A run that learned a new way past a wall and did not write it down has spent the
discovery and kept nothing.

### WHAT IS LAW HERE, AND WHAT IS A RULING

(Adopted 2026-08-20, Prompt C item 5.)

**This file is law.** A rule here binds every session and is changed only by the
author.

**Most decisions are not law**, and until 2026-08-20 they lived only in whichever
chat window was open when they were made — which meant a session could be told
to "hardcode the ruling as fact" with no way to check what the ruling said, and
a superseded ruling could come back as drift because nothing recorded that it
had been superseded. `docs/rulings.md` is that record: append-only, dated, one
entry per ruling, each naming what it supersedes. It is surfaced in
`docs/context.md`, so every session opens on it.

A ruling that becomes law is written INTO this file and its entry in
`docs/rulings.md` says so. A ruling that contradicts this file does not
silently win: the conflict is named, and the author rules.

### THE DEFERRAL BOUNDARY FALLS BETWEEN SUBJECTS, NEVER INSIDE ONE

(Adopted 2026-08-17, the author's ruling on the conflict between the mandate
above and the nothing-half-built rule. Both stay; this is the layer between
them.)

The deferral boundary falls between subjects, never inside one. A subject is never left half-hunted or half-built — the mandate governs the subject and the ladder is walked to exhaustion. But a session does not stop starting new subjects because it doubts it can finish them all. It keeps going until the session genuinely ends, defers whatever remains whole and specced, and states in its report how many subjects were completed against the denominator — "2 of 60", never "the sweep was deferred."

---

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

**Equal effort per candidate within a race — A HUNT DISCIPLINE, AND NOTHING ELSE.** (Adopted 2026-08-14, the tester's mobile pass — her finding, in her words: "Karen might be the perfect fit for me, but she has no information here. So I'm only going to look at the folks that do have information... how could using this app actually impact voter outcomes instead of collect information from voters." **Scope corrected 2026-08-20 by RULING 26 below, after two successive attempts to enforce this rule at the DISPLAY layer ended with the product rendering no candidate cards at all.**) The app can say nothing about anyone and still tilt a race, because a thin card tracks incumbency and campaign professionalism, not merit — an information asymmetry no neutrality rule above catches. So: hunts for candidate information — photos, blurbs, contacts, sites — are run for EVERY candidate in a contest, and misses are recorded per candidate. A hunt session takes a contest as a UNIT and works every candidate in it before moving to the next contest; it does not fill in the incumbent because the incumbent is easy. A hunt that stops when the well-covered candidates are done is not finished; it has produced a ranking. Where the hunt still comes back empty the absence is named on the card in the standard line ("We haven't found much about this candidate yet." — `THIN_CANDIDATE_LINE`, one sentence, no apology, describing our research and never the candidate). **The app's neutrality includes what it fails to find.** **This rule lives in the hunt and never becomes a display rule.** It may not withhold a card, a contest or a field, and any implementation that does is forbidden by RULING 26 below.

**RULING 26 — SHOW EVERYTHING WE FIND.** (Adopted 2026-08-20, the author's ruling, Prompt D item 1a. It is never overridden.)

Everything the product holds about a candidate renders. Collection state never governs display. There is no threshold, no completeness bar, no equality condition, and no circumstance under which a candidate, a contest, or a field is suppressed because something else is missing. A gap in one field has no bearing on any other field, on that candidate's other data, on the other candidates in the contest, or on whether the contest appears at all.

*The rationale stays attached to the rule, because a stripped rule reads as guidance.* Completeness is a property of the HUNT. It kept being treated as a property of the record. Every version of the gate — strict field equality in Prompt B, hunt-completion equality in Prompt C — was an attempt to make the display responsible for a fairness problem that belongs to the collection discipline, and each version withheld more than the last until the product showed nothing at all while holding portraits, finance figures and verified pages in the database. Blanking a contest over one or two missing fields is never the correct response to an incomplete hunt. The correct response to an incomplete hunt is more hunting.

*Where equal effort lives.* In the hunt, and nowhere else. See the rule directly above. That discipline is the constraint. It is not a display rule and it never becomes one.

*Presentation of gaps is a visual question.* How a card looks when a field is missing gets settled in visual feedback sessions over time. It is never a reason to withhold data, and a visual concern never earns a suppression path.

**RULING 27 — NO SUPPRESSION PATH MAY EXIST IN THE CODEBASE.** (Adopted 2026-08-20.) Not live, not behind a flag, not disabled, not retained for a future feature, not as a guard, not commented out as a reference implementation. `tests/no-suppression.test.ts` asserts none exists and fails the build if one is reintroduced — enforced at commit rather than discovered by the author opening the site, which is how both previous versions were found.

**RULING 28 — ABSENCE IS ONE BURIED ANNOTATION PER CONTEST, NEVER A PER-FIELD INDICATOR.** (Adopted 2026-08-20.)

- A field with no data renders NOTHING — no row, no label, no placeholder, no greyed line, no dash, no "still looking for". Cards in a contest may be different lengths and that is correct.
- The only disclosure is a single asterisk on the contest heading with a footnote below the cards in small secondary text: *"An incumbent is likely to have more information available here than the people running against them."* (`components/ballot/incumbency-note.tsx`.) The `*` is reserved for it across the whole ballot page, so the shared-source and scope-note sequence starts at `†`.
- Hunt-queue vocabulary never reaches a reader. "Still looking for", field-name lists, `NOT_HUNTED`, `VERIFIED_ABSENT`, `NOT_APPLICABLE` and any equivalent are internal states. They live in the tracker and in session reports — never on a card, in a header, or in a tooltip.

**RULING 23 — the four-state field is DATA, not a gate.** (Adopted 2026-08-20.) `FOUND` / `NOT_HUNTED` / `VERIFIED_ABSENT` / `NOT_APPLICABLE` stays on the candidate record as the work queue `HD01`–`HD30` were sized against (`lib/ballot/hunt-state.ts`). Nothing reads it to decide what renders, and no render path may even import it. `VERIFIED_ABSENT` is earned by a completed hunt carrying the rungs walked and the date checked; `NOT_APPLICABLE` carries a reason and a date; neither is ever written by a migration.

**Every blurb carries its source class.** (Adopted 2026-08-14, second session.) Any prose describing a person or organization names where it came from, in the register the candidate cards already ship ("In the campaign's words — [domain], read [date]"). No unlabeled descriptions of real people or orgs, anywhere, ever — a description without its source class is treated as a generated claim and removed.

**The collection stores never join — n stores, same rule for every n.** Three today: the search log, the reactions store, and (when notification is built) the subscription store. The search log is permanently identifier-free: no account key, no device ID, no fingerprint, no retained IP, no session key that survives the session, no subscriber ID, no foreign key to anything — it records what was asked and where, never who, and it is honest to sell only because it cannot be resolved to a person. The reactions store is identifier-free the same way, with one disclosed wrinkle: a random browser-minted continuity key, stored only hashed, that relates a browser's reactions to each other (so an answer can be changed) and to nothing else — it joins no other table, appears in no export, and its column exists on the reactions table alone. The subscription store holds an email or push token, a zip, and topic or body interests, and no behavioral history — not what was searched, not what was opened, not what was read, not what was reacted to. No store carries a column that could join to another, and there is no mapping table between any pair; tests assert the schemas share no key. The honest form of the trade: a subscriber is notified about topics they declared, not topics we inferred from watching them — a slightly worse notification product, and the only version that survives the transparency page. **The intake limiter is this rule under load (T08):** rate limiting requires transient tracking of a submitting device, and that state lives in its OWN space — the `intake_limiter` table, keyed by a digest deliberately different from the reaction store's continuity hash (`sha256("intake-limiter:" + key)` vs `sha256(key)`), holding counters only, expiring on its own 48-hour schedule, joined to nothing, exported in nothing. A protection that violates n-stores-never-join to enforce it has failed; `tests/db-schema.test.ts` asserts the limiter table shares no joinable column with any store. Rows that trip a limit but land anyway are quarantined by `suspect_reason` — a why, never a who — and excluded from every aggregate unconditionally; nothing auto-deletes, the author decides. The intake protections sit behind `ripcord.rateLimits` (thresholds tunable via `WTP_LIMIT_*` env vars) and the master ripcord `ripcord.reactionIntake` closes all intake writes; the 2am pull procedure is `docs/ripcords.md`. Validity checks — real target ids, closed enums, length caps, and the like — are never behind any flag.

**Every production probe row a session creates is NAMED in its report.** (Adopted 2026-08-15, the author's standing order.) A session that taps a reaction, fires a log event, or otherwise writes a row against production states it in the standing report — the timestamp, the target, and what it was proving. The reason is not tidiness: these stores are sold as reader signal, and a row a session created is plumbing wearing reader clothes. Unnamed, it is indistinguishable from a real answer, and the author cannot tell which without an investigation — the T08 session named its probes and the 0814f session did not, and that cost exactly such an investigation. Naming them is also what makes a later quarantine or exclusion a filter rather than a hunt. The same obligation covers rows a session's automated walk creates.

**The ripcord doctrine — legally-open features ship behind named kill switches.** (Adopted 2026-08-13, author-approved.) A feature whose legal or policy question is open but whose build is otherwise sound may ship only when: (1) it sits behind a named flag — a ripcord — whose tracker row states the flag name, the open question, and WHO closes it (a named closer, e.g. counsel); (2) every record the feature produces carries a provenance tag so pulling the ripcord is a filter, never a migration or a hunt; (3) ripcorded data never enters an export or a sold aggregate until its question closes — a ripcord that only hides the UI while the data flows downstream is not a ripcord; (4) the transparency page changes in the same commit that ships the feature. The first application is the FEC funding surface (tags `FEC_COMMITTEE`, `FEC_CONTRIBUTOR`; ripcords `ripcord.fecContributorDisplay` and `ripcord.fundingReactionsInAggregates`, the second shipping PULLED) — deferred whole this session; its tracker rows carry the flags and the closer.

**A join that can collapse must be asked for distinctness — identical payloads across distinct keys are presumed broken.** (Adopted 2026-08-14, the FEC replication bug.) The sibling of the count check below: a match rate can read 100% while every match points at the same row. Any join or enrichment binding values to keys must be checkable for per-key uniqueness — no two officials share an FEC committee id unless the FEC itself proves the share (`tests/funding.test.ts`, the D40 family). The rule extends to every layer that can alias keys: an HTTP response whose body varies by a request input must carry that input where every cache implementation keys on it — in the path, never only a query string on a `public` response (production served one campaign's books for three politicians exactly this way), and a client component holding fetched state must reset it when its key prop changes. When adding a keyed join, enrichment, or cacheable endpoint, state how distinct keys are proven to produce distinct results.

**The zip playbook is append-only, and every depth run ends with its diff.** (Adopted 2026-08-15, the author's standing order; tracker R13.) `docs/zip-playbook.md` is the machine-checkable definition of done for a zip and the source ladder per jurisdiction type. It is written by the sessions that discover it: **the rungs written so far are the rungs discovered so far, and every new state is presumed to teach new ones** — discovering and recording a rung is the work, not a deviation from it. Entries are APPEND-ONLY: a rung that stopped working gets a dated note beside it, never a deletion, because the next state may hit the same wall from a different side. Every zip or depth run ends with a **playbook diff** — what was added — or an explicit "nothing new," stated in the standing report. A run that learned something and did not write it down has spent the discovery and kept nothing.

**A render default may never manufacture a claim — a null renders as its NAMED GAP, on every surface, always.** (Adopted 2026-08-16, from the closest call of the 0815 mobile session.) The key-votes surface came one deploy from asserting "Did not vote" about named members of Congress, because a component defaulted a null position straight into a statement. The commonest reason for that null was the most innocent one — they were not in that chamber in 2021 — and the render turned our empty cell into a specific, checkable, false claim about a person. No component default may convert absence into an assertion: not `?? "Did not vote"`, not an empty string that reads as zero, not a placeholder that reads as a finding. The gap gets a name of its own, and the name says WHOSE gap it is — "we haven't recorded this yet" is a fact about us and "not in this chamber for this vote" is a fact about them, and they may never render as the same sentence. Absence also never wears a present value's styling: a named gap renders in the gap's own register (an outline where a recorded position renders as a filled pill), because a colour is a claim too. **The rule is the ATTRIBUTION, never a particular sentence** (clarified 2026-08-19, F01 items 6.1 and 6.2, after the author struck "that's a gap in our research" and "this is a gap in our data" from the whole product): "we haven't recorded this chamber's vote on this yet" satisfies it in full, and the clause that used to follow it was editorial about our own shortcomings rather than attribution. What must survive is that the reader can tell OUR gap from THEIR absence; what may be rewritten at any time is how that is said. `tests/wording.test.ts` bans the struck phrasing across `app`, `components`, `lib` and `data`, and guards the surviving attribution in the same test so neither half can be lost without the other being noticed. Guarded where cheap — `tests/key-votes.test.ts` is the pattern, and `tests/card-sources.test.ts` is the same rule applied to a Sources tab that reported absence without having looked. The rule is law regardless of what a guard can reach.

**An operation that can return nothing must be asked what it returned.** No adapter, join, or scripted edit may report success without stating its count. The shape has now been sighted four times — an empty RSS feed recorded as working, a zero-match join presented as a clean build, a scripted edit that edited nothing and exited 0, and a NovusAgenda portal returning 200 with zero meetings recorded as a HIT. Every adapter reports fetched/normalized/dropped per run (`ReportingMeetingSource`); the snapshot writer refuses a snapshot whose sources do not state integer counts (`lib/meetings/snapshot.ts`, guarded in `tests/snapshot.test.ts`); parse tests assert minimum row counts against recorded fixtures, never merely the absence of an error. When adding any of these, state the count and the denominator — a deliberate clip must not read as a failure, and a real failure must not read as a clip.

**Every session ends by running `pnpm walk:all` against production, and a prior win that fails is a NAMED REGRESSION.** (Adopted 2026-08-16, from the g3 session's own reason for existing.) Every session before this one wrote its own walk, and every walk checked only the surfaces that session had touched — so a win shipped in one session and broken in the next died silently, because nothing owned it once its session ended. Three were found dead on the first run: Kearsarge's fifteen sittings, `/about-area` answering HTTP 500 at every zip, and the meeting counts at 03255 down from 26 to 7. Each check in `scripts/walk-all.mts` carries the SESSION that shipped the claim, so a failure prints as "the win <session> shipped is undone" rather than as an anonymous red line. **New walks APPEND — the suite only grows**, and a check leaves it only when the author retires the claim behind it. Two disciplines make it worth trusting: a check that could not RUN is reported separately from a check that FAILED (an unreachable service is not a missing feature), and the checks that WRITE — a reaction tap, an ask submission — are excluded by name, with the exclusion printed on every run so the gap is stated rather than implied. The run's own production rows are counted and printed too: every `/api/meetings` GET writes a search-log row, so a walk is never row-free and saying so is the probe-naming rule applied to the instrument itself.

**A full-page screenshot is evidence only once it has been READ AS AN IMAGE.** (Adopted 2026-08-20, the author's ruling.) Capturing a screenshot is not looking at one. A file written to disk, a byte count, a green capture step — none of these are the reader's view, and a session that reports "screenshotted" on the strength of any of them has reported a step it did not take. So: every full-page capture a session offers as evidence is opened and read as an image, and the report states screenshots as **N of N read as images**. **A DOM assertion plus a live walk does not substitute** — they answer a different question, because the defects this rule exists to catch are the ones the DOM is happy about: an element present and painted behind another, a mask that dropped, a control below the fold, a colour that renders a gap as a finding. **If a capture cannot be read, the item it belongs to is a BOUNDARY STOP, not a finish**, and the report names which capture and why it could not be read. That is a real ending and an honest one; a finish claimed on unread evidence is neither. This is the render-default rule pointed at our own reporting: an unverified surface may not be written up as a verified one.

**A failed fetch never silently empties a previously-full surface.** (Adopted 2026-08-16 — the refresh corollary to the render-default rule.) The render rule forbids a component turning absence into an assertion. This is the same rule one layer down: a RETRIEVAL failure may not be written into the data as an absence, because by the time a null reaches a component the lie is already in the file. The truth session verified fifteen Kearsarge sittings live; the next scheduled refresh got a 403, recorded the source as failed, and committed a snapshot with every one of that source's meetings gone — a school board that sits fifteen times a year rendered as a body with nothing scheduled. Two rules follow. **Per-body isolation:** one host's refusal may not empty the bodies on other hosts (`schedulepage` served five bodies across three hosts through a loop whose first failure threw, so a New Hampshire WAF deleted a New Jersey school board). **Carry-forward:** `lib/meetings/carry-forward.ts` keeps a refused source's last known rows, clipped to the same serving window, with their original `collectedAt` intact and the carried count stated per source — never restamped as fresh. A source that succeeds and reports no refusal carries nothing, because a body that genuinely went quiet must be allowed to. Guarded in `tests/refresh-corollary.test.ts`.

**A read from the subject's own official source IS the verification.** (Adopted 2026-08-16, the author's ruling.) A fact read off the Governor of Arizona's own website, on a stated date, with the link two rows above it, rendered under the words "Verified: not yet" — the product slandering its own best evidence on the surface whose whole job is to say where a claim came from. So an official-source read renders as verified, BY that source, ON the read date; "not yet" is reserved for provenance where a second rung is genuinely owed (an aggregator, a third-party page, a social feed). Official is decided against something outside us and never a hand-list: the `.gov`/`.mil` TLDs, RFC 1480's `.us` locality space, and the hosts the source wiring itself types as a body's own page. A VENDOR portal is deliberately not official — the records are the body's, the site is a third party's. An official host with no read date stays unverified, because a missing date may not be filled in with a plausible one. `lib/officials/verification.ts`, guarded in `tests/verification-vocabulary.test.ts`.

**More viewport must never mean fewer pins.** (Adopted 2026-08-16.) Zooming out is a request to see MORE, and a map that answers it with less is indistinguishable from a map losing data. The cause was never clustering or culling: the settle re-query carried no radius, so the server used the ladder's first rung at every zoom while a wheel zoom dragged the centre, and a fresh small circle was drawn around a new point. The requested radius follows the viewport, floored at the first rung and capped at the last, and a materially wider view is its own reason to re-ask — a centre-distance test alone misses zooming out in place entirely. `lib/map/viewport-radius.ts`.

**Where collection and rendering can diverge, BOTH numbers are reported, always, as a pair.** (Adopted 2026-08-20, the D68 rule.) A single figure standing in front of two measurements is a data-destruction pattern, not a rounding choice: a flat total conceals a falling component, and the component that is falling is the one somebody needed to see. The ballot page counted contests one way and rendered them another and reported one number; the meetings snapshot counted two things and stated one. Both looked healthy. So a surface, a script, a report or a snapshot that can COLLECT one number and RENDER a different one states them BOTH, makes the pair reconcile, and names which is the standing figure. The rule above — an operation that can return nothing must be asked what it returned — catches a ZERO. It does not catch this, and D50 recurred in F01 because nobody had written the difference down. Where the two do not reconcile, that is the finding, and it renders as one.

**A named instance is an example of a class-wide defect.** (Adopted 2026-08-20.) Every defect this project has found by name has turned out to have siblings: one separator-broken allowlist was fourteen hand-kept state registries; one campaign's books served for three politicians was every `public`-cached response keyed on a query string; one unparsed Apptegy page was a whole CMS family. So a reported defect is the START of a sweep, never the end of one. Fix at the SHARED CODE PATH, sweep the class with a non-skipping tool — `git grep -a --untracked`, or ripgrep with binary handling forced, because a NUL byte and a hidden path each make ripgrep report nothing found without having looked — and state COUNT FOUND and COUNT FIXED. Fixing the named instance alone and reporting it as closed is how a class defect survives the session that discovered it.

**The Kelly standard, and there are no tiers of it.** (Adopted 2026-08-20.) Every official and every candidate carries a photo, a phone, a working contact, a specific verified page, and a campaign site. That is the standard, whole, for everybody — not a scale to be met partly, and not a target that well-covered people reach and thin ones do not. A tiered standard is the equal-effort rule's failure wearing a respectable name, because the tier a person lands in tracks incumbency and campaign professionalism rather than anything about them. Where a field genuinely does not exist, that is a FINDING and it is recorded as one with the rungs walked and the date checked; where nobody has looked yet, that is a gap and it reads as ours. The two may never render alike. See the equal-effort rule above, which this makes checkable.

**Stated N equals rendered rows.** (Adopted 2026-08-20.) Any count a surface states is the count of the rows that surface actually rendered, built from the same list in the same pass. A number produced by a second query is free to disagree with what is on screen, and a denominator that can disagree with its own page is not a denominator — it is a second opinion presented as arithmetic. Where a count is deliberately clipped, the clip is stated with both numbers, per the pair rule above.

**A ceiling moves only on proof, and the proof is a measurement.** (Adopted 2026-08-20.) The build budgets in `scripts/bundle-budget.json` are baselines with headroom — a ceiling is baseline +15%, rounded down — and `tests/build-budget.test.ts` enforces them. Raising one is a decision that needs a measured before and after on the same machine in the same mode, and the new baseline is what was measured, never what was wanted. Every budget figure in every report is READ FROM THAT FILE, both modes, with the CI run id named; the rounded KB line printed by the build is an estimate and is never the reported number. A ceiling raised to fit the change it was supposed to catch has stopped being a budget.

**A session carries carryover and the deferred queue, and nothing else, until the queue clears.** (Adopted 2026-08-20.) The work a session takes is what the previous session left plus what the deferred queue holds. Nothing new is added to a session's own scope mid-flight: a defect discovered becomes a tracker row and the session keeps going, and writing the row is the whole response. **And a session does not stop early.** It drives until the gas light comes on — the old three-to-four item limit is dead, it is not to be reintroduced by any document, and a session that finishes its list starts the next thing rather than closing out. The instrument for "how much room is left" does not exist inside a session; two sessions in a row stopped at roughly a third and a half of their window while believing they were nearly done. The deferral boundary rule above still governs WHERE a session may stop: between subjects, never inside one.

**Where a tool does not exist to reach a public record, BUILD IT.** (Adopted 2026-08-20.) The absence of a script is never a wall. The transparency mandate says difficulty is friction rather than refusal, and "we have no extractor for this format" is difficulty. So the tool gets built, committed, registered in `docs/zip-playbook.md` §4, and cited by the hunt that needed it — that is the work, not a detour from it. A hunt that stopped because no code existed to finish it has not exhausted the ladder, and may not be reported as though it had.

**A zero-row extraction is a FAILED extraction, never an empty document.** (Adopted 2026-08-20.) A parser that returns nothing has told you about itself, not about the document. Every extraction layer reports rows found against what it was given, and zero rows is an error state that names the document, the layer and the reason — never a clean exit. This is the sibling of the operation-count rule above, and it exists because the same shape has now been sighted five times: an empty RSS feed recorded as working, a zero-match join presented as a clean build, a scripted edit that edited nothing and exited 0, a portal returning 200 with zero meetings recorded as a HIT, and rendered prose extracted from an Apptegy page that never contained the byline the page was fetched for.

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

**The register is `docs/sources.md`, and this section is the law that governs
it.** (Rewritten 2026-08-20, Prompt C items 4.3 and 9.5.) A table of sources
and their auth mechanisms is shelf-life content: a key gets added, an endpoint
dies, a licence changes, and a stale table in the constitution is read as
current by every session that opens it. `docs/sources.md` carries the live
register — one row per source, with its status (wired / evaluated / not in
use), its auth mechanism, its licence obligations, and the adapter that reads
it. `.env.local`'s keys are enumerated there against what is actually wired, so
a credential nobody uses is visible rather than forgotten.

What does not drift:

- **Do not add advocacy organizations, PACs, or endorsement sites as sources.**
  Go to the underlying government filing. An endorsement list is somebody
  else's judgement about a candidate, and this product does not carry
  judgements about candidates.
- **A licence obligation is law, not a note.** Where a source's terms require
  attribution — LegiScan's CC BY 4.0 is the live case — the attribution ships
  with the data it describes, and `docs/sources.md` records the obligation
  beside the source.
- **Adding an external source is an ask-before**, listed at the foot of this
  file. It is a standing commitment to a third party, and one of them is a
  legal question wearing an API key.
- **A dead endpoint is recorded as dead rather than deleted.** The Google Civic
  **Representatives** endpoint shut down in April 2025 and any code or doc
  referencing it is dead — use Divisions for OCD-ID resolution and get
  officeholders elsewhere. Recording the death is what stops the next session
  rediscovering it.

## Repo layout

**The tree is the tree; read it.** (Rewritten 2026-08-20, Prompt C item 4.3.) A
directory diagram in the constitution describes the repo on the day it was
written and quietly stops describing it afterwards — `docs/code-manifest.md`
and the tree itself are authoritative, and neither can drift from what exists.
What belongs here is the small number of placement rules that are decisions
rather than descriptions:

- **`lib/sources/<name>/` — one ingestion adapter per external source.** Every
  adapter exports `fetch()`, `normalize()`, `upsert()`. **Adding a source means
  adding a directory, never editing shared ingestion logic**, because a shared
  path edited per source is a path where one source's quirk becomes every
  source's behaviour.
- **`lib/db/` — the Drizzle schema, its migrations, and the queries.** Schema
  changes go through migrations; no hand-edited SQL against the database.
- **`tests/fixtures/` — recorded API responses. No live calls in tests.** A
  fixture is the bytes a server actually sent, and `.gitattributes` marks the
  directory `-text` so nothing rewrites that evidence on checkout.
- **`docs/` — methodology, policy, and the standing record.** `docs/state.md`
  is the living state document, `docs/rulings.md` is the append-only record of
  every ruling that is not law, and `docs/tracker.csv` is task status.

Task status lives in `docs/tracker.csv`. Update the Status and Notes of any item
you work on, in the same commit as the work. **A status change edits the
existing row. It never appends a second row with the same ID** — a tracker with
two rows per ID cannot be read by anything, including the xlsx view generator,
and it silently breaks every lookup by ID. M02 and M04 each carried a duplicate
pair for a day before anyone noticed. Nothing is marked Done without evidence in
Notes: the branch name, and which of `test` / `lint` / `build` passed. A commit
SHA cannot be used — it does not exist inside the commit that would name it. An
agent grading its own homework drifts optimistic; this tracker only earns its
keep if it tells the truth.

**One CODE merge per session; close-out records may follow as separate named commits.** (Adopted 2026-08-19, the author's amendment to the merge cadence, after F01 shipped three merges under a rule that asked for one and reported the deviation rather than smoothing it.) The one-merge rule was always about CODE — batching reader-facing change into a single reviewable ship — and it collided with the sentence directly above: **a document cannot name the commit that contains it.** `docs/state.md` must carry the deploy SHA and the real `walk:all` numbers; neither exists until the code has shipped and been walked; writing either before it is known would be the fabrication rule, and chasing the regress would merge forever. So the line is drawn where it actually falls. The session ships its code ONCE. `state.md`, the tracker, and any document carrying the deploy SHA or the walk numbers may follow in separate commits, and the report states the **code SHA and the close-out record SHAs separately and labels them as such** — a reader must be able to tell at a glance which commit changed what a reader sees and which changed only our account of it. F01's `a119578` / `1203d48` / `5daeb8f` / `5253e5f` split is correct under this rule and is not a violation.

**The one exception, and it is the only one** (amended 2026-08-20, the author's ruling): the session ships **one PLANNED code merge**. A SECOND code merge is permitted only to fix a regression the live walk caught — and when one is taken, the report **names the regression and states both SHAs**. That is the whole of the exception: not a second feature, not a second batch of items, not work that ran late. A walk that finds a live regression and a session that ships without fixing it is the worse outcome, and a rule that forced the choice would be a rule against fixing it. Any other second merge remains a deviation and is still reported as one. F01C2's `1407c53` / `7d986cb` split is correct under this amendment.

**An agent does not know today's date, and a date not read from the system clock is a fabrication.** Every stamp entering any document — a tracker Note, a `state.md` section, an `Adopted` line in this file, a provenance field — comes from `pnpm stamp`, which prints today in `America/Phoenix` (a UTC read after 5pm local is a day ahead, and that is the same bug wearing a smaller hat). A plausible date is not a date; it is the same failure as a generated candidate position — a confident claim with nothing behind it — and it is worse here, because it misdates the rule every later decision was supposedly made under. Guarded at authorship by the pre-commit hook and in the suite by `tests/doc-dates.test.ts`; `pnpm verify-stamps` audits this file's `Adopted` stamps against the git history that would have to be true for them, and writes `docs/stamp-audit.md` for the author to rule on. Nothing corrects a stamp automatically — an agent that repaired a date would be doing the thing that caused the defect.

## Commands

**`package.json`'s `scripts` block is the list.** (Rewritten 2026-08-20, Prompt
C item 4.3.) It held ten entries when this section was written by hand and
holds well over a hundred now, so any copy here is a copy that is wrong. Run
`pnpm run` to see them.

Four are named here because they are not conveniences — a rule elsewhere in
this file depends on each one existing and being run:

- **`pnpm stamp`** — today's date, `YYYY-MM-DD`, America/Phoenix. Every date
  entering every document comes from here. See the date rule below.
- **`pnpm verify-stamps`** — audits this file's own `Adopted` stamps against the
  git history that would have to be true for them, and writes
  `docs/stamp-audit.md` for the author to rule on.
- **`pnpm walk:all`** — the standing regression net, run against production at
  the end of every session. See the walk rule below.
- **`pnpm db:apply`** — applies the committed Drizzle migrations to a database
  this repo can reach. It is how a schema change reaches production, and
  `--target=production` is required to touch it.

## Ask before

Adding a user data field. Adding an external source. Anything that ranks, scores, or orders candidates. Anything that renders one user's input — or any aggregate of it — back to users. Anything that changes how reactions are bucketed or exported.
