# CLAUDE.md — the root constitution

Civic app, two halves. Consumer side shows what's on a user's ballot with
sourced candidate positions, translates ballot measures into plain language, and
alerts users to nearby local government meetings. Data side captures user
reactions and sells anonymized aggregates to political organizations. Consumers
never pay.

---

## How to read this file

**This file is CURRENT cross-cutting law and nothing else.** It carries no
superseded text, no chronological ruling batches, no incident narratives, no
volatile counts, no credential status, no endpoint health, and no duplicated
copies of domain law.

That is a change made on 2026-08-26, and it is the point of the change:
this file and `docs/rulings.md` had grown to 538,255 bytes between them, mixing
current law, superseded law, decisions, rationale, measurements, approvals and
implementation history in one stream. A session answering *what is true now?*
had to reason through chronology and supersession — and a session that reasons
its way to an answer can reason its way to a wrong one.

**History still exists, in full, and it grows without a cap. It is just no
longer loaded as default context.** See RULING 172.

### Open a session on the task, not on the archive

```bash
pnpm governance:open --task discovery
```

That prints the root constitution's own rules, the current policy for that
domain, active decisions, unresolved conflicts, the governance snapshot, and —
for long-running work — the canonical workstream state and exact resume cursor.

**It does not print the history.** Ask for that when you need to know *why*.

---

## Authority precedence

**RULING 185.** One model, and it is this one:

1. **Explicit current author directive.**
2. **This file** — the root constitution.
3. **The delegated current policy** for the relevant domain.
4. **Active current non-law author decisions** — `docs/governance/current-decisions.md`.
5. **The session brief / tracker scope instruction.**
6. **Operational state and current measurements.**
7. **The historical ledger and history views.**

**History explains. History does not override.** A brief that conflicts with
current law does not silently win unless it is an explicit author amendment —
the conflict is represented, not resolved by whichever document was read last.

---

## The policy index

Detailed current law lives in delegated domain policies. Each is **generated**
from the canonical ledger and is never hand-edited (RULING 92).

| Policy | What it governs |
| --- | --- |
| `docs/governance/policies/discovery.md` | Hunting, the ladder, branches, absence, exhaustion, the descent |
| `docs/governance/policies/rendering-neutrality.md` | What reaches a reader, and what may never be inferred |
| `docs/governance/policies/data-privacy.md` | The collection stores, the identity boundary, reaction capture |
| `docs/governance/policies/sources-licensing.md` | Sources, permission, licences, credentials |
| `docs/governance/policies/shipping-ci.md` | Merges, deploys, gates, verification, close-out |
| `docs/governance/policies/tracker-workflow.md` | The two tracker stores, Needs Sean, priority, dates |
| `docs/governance/policies/visual-feedback.md` | Captures as evidence and as specification |
| `docs/governance/policies/business.md` | Selling, solicitation, exports, neutrality constraints |
| `docs/governance/policies/meta-governance.md` | How law itself is made, amended and recorded |

**The canonical store is `docs/governance/ledger.jsonl`.** Everything above is a
view of it. `docs/rulings.md` is a GENERATED compatibility view kept so every
`RULING n` reference in this repository still resolves; it stopped being an
authority on 2026-08-26.

---

## The order of every trade

**Correct first. Fast second. Nothing third.** Perfection and speed are both
mandatory, and when they collide, correct wins — always. A fast wrong answer in
this product is a false claim about a government, and that is the one failure it
cannot survive. Never ship partial data as complete, never let green stand in
for verified, never trade an honest gap for a plausible guess. Data is the
trophy. Public records are the product's birthright. Difficulty is friction, not
refusal. Go get it.

---

## The transparency mandate

*(Adopted 2026-08-16, the author's directive. Operative text:
`docs/governance/policies/discovery.md`. It sits above every operational rule
because they inherit from it.)*

> Get out of my way. This public information is mine and I need to read it.

These are PUBLIC bodies and PUBLIC people. Their records, their meetings, their
money, and their votes are already owed to the reader. Difficulty of access is
frequently deliberate, and this product exists to defeat it.

**Do not fail. Find every avenue, every back door, every nook, every cranny.**

- A wall never renders as an emptiness. A failed retrieval is reported as a
  failed retrieval, with the wall named. **Absence is never asserted.**
- Every wall that falls becomes a rung, so it never costs a second session.
- Two prohibitions, and neither is caution: **no residential-proxy spoofing**,
  and **nothing fabricated** when the ladder is genuinely exhausted. We take
  everything that is owed and we invent nothing.

---

## The cross-cutting non-negotiables

These bind everywhere, in every domain. The detail and the reasoning are in the
policies; what is here is the part no session may ever need to look up.

**Never generate a candidate position.** Every position, vote or stance rendered
to a reader carries a source record pointing at a specific statement, roll-call
vote, filing or questionnaire response. If no source exists, the field is null.
Never infer from party, endorsements or similar candidates. This binds
LLM-written summaries too: a summary paraphrases a cited source, never fills a
gap.

**The product never tells anyone how to vote.** No ranking, no recommended
ballot, no match, fit, alignment or compatibility score, no ordering by anything
but a neutral criterion. A reader asking for a recommendation directly is not an
exception, and neither is a well-sourced transparent one.

**Show everything we find.** Collection state never governs display. There is no
threshold, no completeness bar, and no circumstance under which a candidate, a
contest or a field is suppressed because something else is missing. Completeness
is a property of the HUNT. The correct response to an incomplete hunt is more
hunting. (RULING 26, RULING 27.)

**A render default may never manufacture a claim.** A null renders as its NAMED
GAP, on every surface, always — and the name says WHOSE gap it is. "We haven't
recorded this yet" is a fact about us; "not in this chamber for this vote" is a
fact about them. They may never render as the same sentence.

**The product never announces its own failure.** State what is known, offer the
narrowing, move on. The ATTRIBUTION above is required; a verdict on ourselves is
struck. (RULING 139.)

**An operation that can return nothing must be asked what it returned**, and a
partial that reconciles is still a wrong answer (RULING 100). A zero-row
extraction is a FAILED extraction, never an empty document.

**A finite attempt count never earns an absence.** Five moves, seven tiers, N
routes, every manifest entry — floors and instruments, never completion
conditions. A session with no further avenue says **"I have run out of ideas"**,
which is a claim about the session, never "this is not published", which is a
claim about a government. (RULING 170, RULING 184.)

**The collection stores never join.** No store carries a column that could join
to another, and there is no mapping table between any pair. Proven over VALUE
SPACES, never column names (RULING 132).

**No user-to-user surface.** Reactions are write-only from the reader's
perspective — stored and aggregated, never rendered back to any user, including
in aggregate.

**Collect the minimum.** Zip or address for district resolution, an email for
account identity. Adding a field to the user model is an ask-before.

**Reader friction is a defect**, with exactly three exceptions, each checkable by
number: the transparency disclosure at reaction capture, the optionality of the
narrowing prompt, and anything constituting consent to collection.

**Reader surfaces speak plain language.** No OCD-ID, no enum value, no
`NO_SOURCE_FOUND` reaches a reader.

**An agent does not know today's date.** Every stamp entering every document
comes from `pnpm stamp`. A plausible date is a fabrication, and it misdates the
rule every later decision was supposedly made under.

**A generated artifact is never hand-edited** (RULING 92), and fixing a
generator is not finished until its output is regenerated and diffed
(RULING 102).

---

## Discovery, in one page

The detail is `docs/governance/policies/discovery.md`. What binds everywhere:

**The universe of owed subjects may be bounded. The universe of methods is
not.** The effort permitted to complete an owed item is not arbitrarily capped.
A workstream may have a denominator; the method is permanently open-ended.
(RULING 177.)

**And the bound is on SUBJECT, never on effort.** A discovered route enlarges
the active graph only when it plausibly advances an owed question — a
governmental body, an official, a meeting, an election, a filing, another
authoritative publisher, an official record, evidence for an owed fact, a new
governmental layer, or a new source class. **A government page does not
recursively make every hyperlink on the internet owed.** That is what keeps
discovery finite without capping how hard an eligible edge is worked, and it is
the only bound there is. `lib/workstate/eligibility.ts`.

**Inherit everything. Assume it is incomplete. Learn what this place teaches.
Keep the learning. Reapply it where else it fits.** A method that works across
43 states is the method learned so far, never *the* method. A new route is
PROJECT knowledge, persisted, classified by portability, inherited by every
later jurisdiction — and it **mechanically reopens** prior conclusions it would
have applied to. (RULING 178.)

**No manifest, route list, source taxonomy, government-type taxonomy, platform
taxonomy or retrieval vocabulary is ever complete.** Each represents WHAT THE
PROJECT KNOWS NOW.

**Discovery is a tree, not a ladder** (RULING 52), **absences expire**
(RULING 53), **every twig is named** (RULING 57), and **convergence is
versioned** — `CONVERGED_AS_OF` means every currently eligible avenue has a
disposition under the current method version, never that no other source exists
(RULING 179).

**A blocked route may never become a blocked fact.** `BLOCKED_CURRENTLY`,
`REQUIRES_NEW_ADAPTER`, `RECORDS_REQUEST_PENDING` and `RECHECK_DUE` are real
states. A CAPTCHA is not absence; missing tooling is not absence. (RULING 184.)

**Permission state and transport state are orthogonal.** "Could not fetch
robots.txt with this client" is never "robots disallows this host". `CANNOT_TELL`
fails safe for the route and keeps hunting the fact by other branches.
(RULING 182.)

**A lead is not a body.** Detectors produce CANDIDATES. Coverage rises only
through verified and promoted bodies, and no candidate count may substitute for
the promoted-body count. (RULING 183.)

---

## Sessions, and what "done" means

**A session runs unattended. Nothing it runs may be able to ask it a question**
(RULING 146). A decision that is genuinely the author's becomes a Needs Sean row
and the session keeps going.

**Three independent statuses, and confusing them is a reporting defect**
(RULING 180, amended by RULING 189):

```
SESSION:    COMPLETE
            CLEAN_HANDOFF_AUTHOR_STOP
            CLEAN_HANDOFF_EXTERNAL_STOP
            EARLY_HANDOFF
            FAILED_CLOSEOUT
WORKSTREAM: OPEN | COMPLETE_AS_OF <date>
GRAPH:      EXPANDING | CONVERGED_AS_OF <date>
```

**A session does not measure itself** (RULING 189). It does not estimate context
used or remaining, narrate approximate percentages, monitor its own context as a
work-management signal, stop because it believes a threshold was reached, or
call itself early on guessed capacity. There is no threshold, and no proxy for
one — not elapsed minutes, token guesses, message counts, command counts, commit
counts, fatigue, or a work quota.

**The rule, entire:**

```
DO THE WORK THAT WAS ASKED FOR.
KEEP WORKING WHILE AUTHORIZED EXECUTABLE WORK REMAINS.
STOP WHEN THE REQUESTED WORK IS ACTUALLY COMPLETE, WHEN THE AUTHOR EXPLICITLY
STOPS OR REDIRECTS THE SESSION, OR WHEN THE ENVIRONMENT ITSELF ACTUALLY
PREVENTS CONTINUATION.
```

`CLEAN_HANDOFF_EXTERNAL_STOP` is never INFERRED; **one blocked item does not
qualify while other authorized work exists — skip forward.** `EARLY_HANDOFF` is
what a voluntary stop with owed work is called, however excellent the handoff.

**MERGE CADENCE IS NOT SESSION CADENCE.** RULING 1 governs shipping — verify
locally, accumulate, ship once at the real end. **The planned merge having
happened is not a reason to stop.** Delay the merge until the session is ready
to end.

**PERSISTED RESUMABILITY IS NOT PERMISSION TO STOP VOLUNTARILY.** Canonical
state exists so an interrupted session can resume, not so this one can end.

**The model does not award itself a status. The state does**
(`classifySessionStop` in `lib/workstate/types.ts`). Every non-`COMPLETE` close
records a specific `stop_reason`, whether the author stopped the session,
whether an actual external condition prevented continuing, and
`executable_owed_work_remaining` — derived, never asserted. A stop reason that
appeals to self-estimated capacity or to merge cadence cannot make a stop clean:
it is refused, and the refusal names the non-reason.

**The repository generates the handoff, not the model.** `pnpm workstream:close`
produces the exact cursor and the exact unresolved set from canonical state. The
model may explain it; it may not invent it. No "the rest", no omitted tail.

**Item completion is DERIVED from child state.** A model may not type "done"
while unresolved required children exist.

**A frontier is state, not a recipe for recreating state** (RULING 181).
`passes` and `budget` choose how much queued work to process; they never define
what work exists.

---

## Stack

**This section names DECISIONS, never versions.** A framework version written
here goes stale the next time anyone runs an upgrade, and a stale constitution
is worse than a short one. Shelf-life content lives where it is authoritative:
**`package.json` and `pnpm-lock.yaml`** for what is installed, **`netlify.toml`**
for how the deploy builds, **`next.config.ts`** for what the build does,
**`drizzle.config.ts`** for the database wiring, and
**`lib/ops/refresh-cadence.ts`** for what runs when.

What does not drift, and is therefore law:

- Next.js (App Router) + TypeScript + React.
- Tailwind + shadcn/ui; the design tokens are committed (`docs/DESIGN.md`,
  `app/globals.css`).
- Postgres on Neon through Drizzle. **Schema changes go through Drizzle
  migrations; no hand-edited SQL**, applied with `pnpm db:apply`.
- **Deployed on NETLIFY.** Not Vercel. The build is the literal command in
  `netlify.toml`.
- **The scheduler is GitHub Actions, not platform cron.** Counts and cadence are
  asserted in `tests/push-main.test.ts` and `tests/refresh-cadence.test.ts` —
  read them rather than a number written here.
- Auth via Auth.js, email magic link only. No OAuth, no social login.
- MapLibre GL with a vector tile provider. Not Google Maps.
- Mobile is responsive web first.

---

## Repo layout

**The tree is the tree; read it.** `docs/code-manifest.md` is authoritative. The
placement rules that are decisions rather than descriptions:

- **`lib/sources/<name>/`** — one ingestion adapter per external source, each
  exporting `fetch()`, `normalize()`, `upsert()`. **Adding a source means adding
  a directory, never editing shared ingestion logic.**
- **`lib/db/`** — the Drizzle schema, migrations and queries.
- **`lib/governance/`** — the governance schema, ledger, compiler and validator.
- **`lib/workstate/`** — canonical multi-session work state.
- **`lib/method/`** — cumulative project discovery knowledge.
- **`tests/fixtures/`** — recorded API responses. **No live calls in tests.**
- **`docs/`** — methodology, policy and the standing record.

---

## Commands

`package.json`'s `scripts` block is the list; run `pnpm run` to see it. Named
here only because a rule depends on each one existing:

| Command | Why it is law |
| --- | --- |
| `pnpm stamp` | Every date entering every document |
| `pnpm gates` | The local gate set CI requires |
| `pnpm governance:open --task <domain>` | Session open on current authority |
| `pnpm governance:check` | The governance validator — no skip flag |
| `pnpm governance:compile` | Regenerates every governance view |
| `pnpm workstream:status` / `:close` | Canonical work state and the generated handoff |
| `pnpm method:check` | The route-knowledge validator |
| `pnpm walk:all` | The standing regression net, against a LOCAL production build |
| `pnpm db:apply` | How a migration reaches a database |

---

## Ask before

Adding a user data field. Adding an external source. Anything that ranks, scores
or orders candidates. Anything that renders one user's input — or any aggregate
of it — back to users. Anything that changes how reactions are bucketed or
exported.

---

## Changing this file

**RULING 99 and RULING 176.** A ruling is amendable only by a LATER DATED
ruling that names the number it supersedes, states what changed and what
survives, and lands in the canonical ledger. **Rulings are never edited in place
and never silently dropped.** Adopted numbers are GLOBAL and IMMUTABLE — never
reused, never renumbered.

**A governance change is atomic.** The canonical event, the operative policy,
the regenerated views, the regenerated context and a passing
`pnpm governance:check` land together, or the change has not happened.
