/**
 * Adoptions and resolutions applied on top of the mechanical import.
 *
 * Three things live here, and they are kept apart because they carry different
 * authority:
 *
 * 1. **NEW author decisions** from the governance remediation brief of
 *    2026-08-26. Every one is an EXPLICIT AUTHOR DIRECTIVE quoted or
 *    compressed from that brief, and every one carries `author_explicit`. They
 *    take ids from 172 — the next free numbers above the highest adopted id
 *    (171), read from the ledger rather than assumed.
 *
 * 2. **CLAIM ASSIGNMENTS** — which existing record answers which semantic rule
 *    slot. These are not new law. They point an existing rule at the slot it
 *    was always answering, so the answer becomes machine-readable.
 *
 * 3. **STATUS RESOLUTIONS** — records whose operative force a later record
 *    took over. Every one names the later record, and every one is justified by
 *    language that later record already uses. **Nothing is retired on a
 *    session's judgement.**
 */

import type { Domain, GovernanceRecord, Provenance, RecordKind, Status } from "./schema.ts";

export const REMEDIATION_DATE = "2026-08-26";

interface NewDecision {
  n: number;
  title: string;
  /**
   * The adoption date, when it is NOT the remediation date.
   *
   * The remediation adopted 172-188 on one day, so the compiler stamped that
   * one date on all of them. A later amendment adopted on a later day must
   * carry its own — a ruling misdated to the day before is a ruling that claims
   * to have governed decisions taken before it existed.
   */
  adopted?: string;
  domain: Domain;
  kind: RecordKind;
  provenance: Provenance;
  body: string;
  claims?: Array<{ key: string; value: string }>;
  relations?: GovernanceRecord["relations"];
}

/**
 * The author's explicit directives from the governance remediation brief.
 *
 * Body text is the brief's own wording, compressed to the operative clause. A
 * paraphrase of a directive is a different directive, so where the brief states
 * a rule in a specific form that form is kept.
 */
export const NEW_DECISIONS: NewDecision[] = [
  {
    n: 172,
    title: "RULING 172 — current authority and history are separate systems",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**History may explain current authority. History may never itself become
current authority merely because a session found an old paragraph.**

Two systems, not one file with two jobs. The canonical current answer to
"what governs now?" is compiled from typed records; the narrative that explains
why is retrieved on demand and is never loaded as default context.

*The rationale stays attached.* Sessions were reconstructing current law by
reasoning through chronology and supersession, and a session that reasons its
way to an answer can reason its way to a wrong one. A paragraph adopted in
August and replaced in August reads identically to one still in force — same
bold type, same adoption stamp, same confident voice. The only thing separating
them was a session noticing.`,
  },
  {
    n: 173,
    title: "RULING 173 — CLAUDE.md is the root constitution and carries current law only",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**\`CLAUDE.md\` contains CURRENT cross-cutting law only, plus the authority
hierarchy and the policy index.**

It does not contain superseded operative text, chronological ruling batches,
incident narratives whose purpose is historical, volatile counts, current
credential status, endpoint health, commit-specific measurements, or duplicated
full copies of domain law.

**Detailed current law lives in delegated domain policies** under
\`docs/governance/policies/\`. Superseded wording lives in history, never beside
the operative clause.

*What this is not.* It is not a size target met by deleting rationale. History
grows without a cap; what changes is that it stops being loaded as default
runtime context.`,
  },
  {
    n: 174,
    title: "RULING 174 — binding authority requires author provenance",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**Only \`author_explicit\` or \`author_confirmed\` provenance may create binding
law or decision state. An LLM may not upgrade its own confident prose into
"Sean ruled this."**

Four provenance kinds are kept apart: \`author_explicit\`, \`author_confirmed\`,
\`session_interpretation\`, \`observed_fact\`. A session's reading of a rule is
recorded as a reading. It does not become the rule by being written down
confidently.

**Where provenance cannot be established, the record says so and does not
bind.** Uncertainty is a legal state. Guessing is not.`,
  },
  {
    n: 175,
    title: "RULING 175 — supersession is structured data, and a partial amendment names both halves",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A partial supersession must name what CHANGED and what SURVIVES. Do not
reduce a clause-level amendment to a boolean.**

Nine relation kinds are representable: \`supersedes_full\`, \`supersedes_clause\`,
\`amends\`, \`extends\`, \`clarifies\`, \`implements\`, \`ratifies\`, \`derived_from\`,
\`related_to\`.

*The rationale stays attached.* RULING 170 amends RULING 94 and says in its own
words that RULING 94's five moves stand, its placement stands, and its void
condition stands — three quarters of the rule is in force. A boolean
\`superseded\` destroys exactly that, and a session reading it would drop a rule
the amendment deliberately kept.`,
  },
  {
    n: 176,
    title: "RULING 176 — governance changes are atomic",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A law or decision change is incomplete until the canonical event exists,
operative policy is updated where applicable, generated views are regenerated,
generated startup context is regenerated, and validation passes.**

**No state may ship where the constitution claims a ruling that the canonical
ledger does not contain.**

*Why this is law rather than a habit.* The hand-maintained dual write between
\`CLAUDE.md\` and \`docs/rulings.md\` is what let the constitution carry RULING 169
and RULING 170 while the ruling record stopped at 168. That specific mismatch is
RESOLVED — both files carry 169, 170 and 171 at the HEAD this was adopted
against, measured rather than assumed. **The mismatch was never the defect. The
architecture that permitted it was**, and a guard that only fixed the instance
would be the named-instance failure this repository names most often.`,
    claims: [
      { key: "rulings.id_namespace", value: "global-immutable" },
      { key: "governance.amendment_procedure", value: "canonical-ledger-and-generated-views" },
    ],
    relations: [
      {
        kind: "amends",
        target: "R-0099",
        changed:
          "RULING 99's third clause — that an amendment adds a mapping line in BOTH docs/rulings.md and CLAUDE.md. " +
          "That dual write is retired: docs/rulings.md is a GENERATED compatibility view and CLAUDE.md is a root " +
          "constitution carrying current cross-cutting law only, so neither can receive a hand-written mapping line. " +
          "An amendment now lands as a canonical event in docs/governance/ledger.jsonl, and every view regenerates from it",
        survives:
          "RULING 99's first two clauses in full — an amendment is a LATER DATED ruling that names the number it " +
          "supersedes and states what changed and why. So does everything else it established: rulings are never " +
          "edited in place and never silently dropped, a superseded ruling stays in the record marked superseded and " +
          "carrying its successor, and adopted numbers are immutable and never renumbered to tidy a sequence",
      },
    ],
  },
  {
    n: 177,
    title: "RULING 177 — the subject universe may be bounded; the method never is",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**THE UNIVERSE OF OWED SUBJECTS MAY BE BOUNDED. THE UNIVERSE OF METHODS IS
NOT. THE EFFORT PERMITTED TO COMPLETE AN OWED ITEM IS NOT ARBITRARILY CAPPED.**

This is the correction to two bad architectures at once.

**BAD:** try N things; N things failed; therefore absent.
**ALSO BAD:** follow every hyperlink forever; completion has no possible
boundary.

A current workstream may have a defined denominator. The discovery method
itself is permanently open-ended. **"Bounded universe" applies ONLY to the
subjects currently owed** — never to the method, the route manifest, the source
vocabulary, the platform vocabulary, the government-type vocabulary, or the
retrieval technique.

**A discovered route enlarges the active graph only when it plausibly advances
an owed question.** A government page does not recursively make every hyperlink
on the internet owed. That is what keeps this bounded without capping effort.`,
    claims: [
      { key: "discovery.completion_model", value: "bounded-universe-versioned-convergence" },
      { key: "discovery.method_growth", value: "living-versioned-never-final" },
    ],
  },
  {
    n: 178,
    title: "RULING 178 — inherit everything, assume it is incomplete, keep the learning",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A method that works across 43 states is not "the method." It is the method
learned so far.**

If the repository knows 76 routes and those routes work across 43 states, that
means WE CURRENTLY KNOW 76 ROUTES. It does not mean THERE ARE 76 ROUTES. If the
next seven states require 11 more, the system learns those 11, records them,
classifies where they apply, and future sessions inherit all 87. Then 88. There
is no maximum.

- **A new route is PROJECT KNOWLEDGE, not session knowledge.** Every successful
  new avenue is persisted so another session never rediscovers it.
- **A failed inherited route is also knowledge.** It grows a sub-branch naming
  the jurisdictional shape it failed in and the date, and it is never deleted.
- **Every route carries applicability metadata.** Nationwide, state-specific,
  state-family, government-type, publisher, platform, document-type,
  jurisdiction, or **unknown portability — which is a VALID state.** Do not
  generalize farther than the evidence supports.
- **A NEW JURISDICTION IS PRESUMED CAPABLE OF TEACHING THE PROJECT A NEW
  METHOD.** "Nothing new learned" is a legitimate measured result only after
  genuine expansion work occurred. It may never be inferred merely because all
  inherited routes completed.
- **New knowledge reopens old conclusions.** When a route is learned, prior
  items recorded absent, blocked, dark or converged are identified
  MECHANICALLY, their exhaustion state is invalidated where the route applies,
  and they return to owed. This is structural, never something a future session
  is expected to remember.

**Inheritance is the STARTING advantage of a new state, never its constraint.**`,
  },
  {
    n: 179,
    title: "RULING 179 — convergence is versioned, and completion is derived from child state",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**CONVERGED never means "we know every possible way to find this."** It means:
under the current project knowledge, for this defined universe, every currently
eligible avenue has a disposition as of this date.

Every convergence record states \`convergedAsOf\`, \`methodVersion\`,
\`universeVersion\` and \`eligibleEdgeVersion\`. **A newly applicable route, a
changed universe, or expired freshness reopens it.**

- **Item completion is DERIVED from child dispositions.** A model may not type
  "done" into a report while unresolved required children exist. The repository
  computes it.
- **A workstream is \`COMPLETE_AS_OF\` only when** its owed universe is defined,
  every member is accounted for exactly once, every required child has an
  allowed disposition, no UNKNOWN remains, no owed item is represented as absent
  because of a blocker, the eligible graph has converged for the current
  freshness window, and the completion is stamped with the method version it was
  earned under.
- **Graph convergence and factual absence are different.** A complete eligible
  pass finding zero new eligible routes does not mean there are no other sources
  on Earth.`,
  },
  {
    n: 180,
    title: "RULING 180 — session status, workstream status and graph status are three different facts",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A session may run out of time. The work may remain open. Neither fact may
ever be misreported as "done" — and neither may be reported as a failure.**

Three independent axes:

    SESSION:    CLEAN_HANDOFF | COMPLETE | FAILED_CLOSEOUT
    WORKSTREAM: OPEN | COMPLETE_AS_OF <date>
    GRAPH:      EXPANDING | CONVERGED_AS_OF <date>

**An ended context window with every byte persisted and an exact cursor is
\`SESSION: CLEAN_HANDOFF\` / \`WORKSTREAM: OPEN\`. That is SUCCESS.** Lost or
unrepresented remainder is failure.

**The repository, not the model, generates the handoff.** Close-out tooling
produces the exact cursor and the exact unresolved set from canonical
work-state. The model may explain it; it may not invent it. No "the rest", no
omitted tail.`,
  },
  {
    n: 181,
    title: "RULING 181 — a frontier is state, not a recipe for recreating state",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**The canonical store persists every discovered eligible edge with a stable
id, its parent/source provenance, and its disposition. Processed and queued
edges are explicit. The current cursor is explicit.**

**Restart does not require recrawling seeds to discover what was already
known.** A seed list may INITIALIZE a new workstream; it may not be the only
source from which an in-progress workstream reconstructs what remains.

**\`passes\` and \`budget\` are execution controls. They choose HOW MUCH queued
work to process. They never define WHAT WORK EXISTS.**

A derived frontier index may be regenerated from canonical edge state. If
canonical outstanding work exists only because a future crawl will rediscover
it, it is not persisted.`,
  },
  {
    n: 182,
    title: "RULING 182 — permission state and transport state are orthogonal",
    domain: "sources-licensing",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A permission decision and the ability to retrieve the permission document
are different facts, and the system may never collapse them.**

    PERMISSION: ALLOWED | DISALLOWED | CANNOT_TELL | NOT_APPLICABLE
    TRANSPORT:  REACHABLE | FAILED_AT_RUNG | CHALLENGED | TIMEOUT
                | TLS_CLIENT_MISMATCH | OTHER_NAMED_FAILURE

**"could not fetch robots.txt with this client" is NEVER "robots disallows this
host."**

- Fail safe for the ROUTE where permission genuinely cannot be established —
  \`CANNOT_TELL\` refuses the fetch, exactly as RULING 148 requires.
- **Do not convert transport failure into \`DISALLOWED\`.**
- **Continue alternate compliant retrieval methods for the permission
  document**, and continue alternate compliant branches to the underlying
  public fact.
- Freshness and recheck still apply.

*The rationale stays attached.* The descent session found a transport failure
while reading permission being interpreted as permission being unanswerable,
which then refused the host. Escalating the retrieval client recovered multiple
hosts — including the tops of two state descents. **A blocked route may never
become a blocked fact.**`,
    claims: [{ key: "permission.transport_collapse", value: "orthogonal-cannot-tell" }],
  },
  {
    n: 183,
    title: "RULING 183 — a lead is not a body",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A link detector or site walker produces CANDIDATES. Coverage increases only
through verified and promoted bodies.**

    EDGE_DISCOVERED -> ENTITY_CANDIDATE -> ENTITY_VERIFIED -> BODY_PROMOTED

with alternate endings \`DUPLICATE\`, \`REJECTED_FALSE_POSITIVE\`,
\`NEEDS_CLASSIFICATION\`. The transition and its evidence are persisted.

**A report may state all counts. NO CANDIDATE COUNT MAY SUBSTITUTE FOR THE
PROMOTED-BODY COUNT**, and RULING 169's load-bearing number is unchanged:
bodies discovered that were not already in the registry.

**Detector counts require calibration against what the detector actually
found.** A job board produced 154 false candidates and a calendar view produced
214. Detectors report promoted, rejected and uncertain outcomes; tests include
false-positive calibration rather than merely non-zero output. **A detector must
not be able to satisfy a success threshold entirely with known false
positives.**`,
  },
  {
    n: 184,
    title: "RULING 184 — blocked is a real state, and a finite attempt count never earns absence",
    domain: "discovery",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**Delete the false binary \`taken OR absent\`.** Source and work dispositions
represent at least: \`UNWALKED\`, \`DISCOVERED\`, \`IN_PROGRESS\`, \`INGESTED\`,
\`POINTER_ONLY\`, \`WALKED_NO_YIELD\`, \`BLOCKED_CURRENTLY\`,
\`REQUIRES_NEW_ADAPTER\`, \`RECORDS_REQUEST_PENDING\`, \`NOT_APPLICABLE\`,
\`RECHECK_DUE\`.

A CAPTCHA is not absence. Missing tooling is not absence. A pending records
request is not absence. A third-party pointer is not necessarily something to
ingest. A presently prohibited route is not absence.

**Five moves, seven tiers, N routes, every manifest entry, every known branch —
these are FLOORS and instruments. Reaching their end never means "therefore the
information does not exist."**

If a session has no further avenue it says **"I have run out of ideas"**, which
is a claim about the session. It is never "the government does not publish
this", which is a claim about a government.`,
    claims: [{ key: "discovery.absence_standard", value: "argued-never-counted" }],
    relations: [
      {
        kind: "extends",
        target: "R-0170",
      },
    ],
  },
  {
    n: 185,
    title: "RULING 185 — the authority precedence model",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**One precedence model, documented, and it is this one:**

1. Explicit current author directive.
2. Root constitution (\`CLAUDE.md\`).
3. Delegated current policy for the relevant domain.
4. Active current non-law author decision.
5. Session brief / tracker scope instruction.
6. Operational state / current measurements.
7. Historical ledger and history views.

**History explains. History does not override.**

**A brief that conflicts with current law does not silently win** unless it is
an explicit author amendment. The conflict is REPRESENTED rather than resolved
by whichever document the session happened to read last.`,
  },
  {
    n: 187,
    title: "RULING 187 — a well-preserved handoff is not automatically a legitimate stop",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**There are TWO independent questions at session close: was the state
preserved correctly, and was there a legitimate reason to stop? A session may
preserve everything perfectly and still stop too early.**

    SESSION: COMPLETE
             CLEAN_HANDOFF_LIMIT_REACHED
             CLEAN_HANDOFF_EXTERNAL_STOP
             EARLY_HANDOFF_WITH_CAPACITY
             FAILED_CLOSEOUT

Every non-\`COMPLETE\` close records **measured** \`context_used_percent\`,
\`context_remaining_percent\`, a specific \`stop_reason\`, and
\`executable_owed_work_remaining\`. Where the environment exposes context usage
directly, that reading is used rather than inferred.

**\`CLEAN_HANDOFF_LIMIT_REACHED\`** requires ALL of: canonical state fully
persisted; exact cursor and remainder generated from it; executable owed work
remaining; productive authorized work continued to a real context boundary; AND
either **at least 80% of usable context actually consumed**, or the platform
reporting an imminent context limit, compaction event or hard stop.

**THE 80% FIGURE IS A FLOOR FOR THAT STATUS. IT IS NOT A TARGET.** It is a
defect to consume context merely to qualify for a clean handoff — no repeating
analysis, no restating recorded work, no unnecessary prose, no low-value
busywork, no delayed correct action, no enlarged reports. **If productive
executable work remains, do that work.**

**\`CLEAN_HANDOFF_EXTERNAL_STOP\`** may be used with substantial context
remaining only when an actual external condition prevents continued authorized
work — the author says stop, the environment terminates the run, or every
remaining executable item is blocked externally and the brief holds nothing else
to skip forward to. **One blocked item does not qualify if other authorized work
exists. Skip forward.**

**\`EARLY_HANDOFF_WITH_CAPACITY\` is REQUIRED** when substantial usable context
remains, executable authorized work remains, no qualifying external stop exists,
and the session closes anyway. The work may be perfectly persisted and the
cursor perfect. It is still an early stop. **Do not convert preservation quality
into permission to stop.**

**\`COMPLETE\` means the authorized work actually satisfies its completion
rules.** Finishing the current checklist is not sufficient if the standing queue
requires the session to continue; finishing one phase is not sufficient if the
workstream remains owed. **The model does not award itself \`COMPLETE\`. The
state does.**

*Applied to the preceding descent session, from the evidence rather than by
automatic translation:* it shed more than half its visual work at approximately
56% context, with executable brief items remaining and no qualifying external
stop. Its persistence and handoff were genuinely strong and that remains a
positive fact. Its migrated semantic state is nonetheless
**\`EARLY_HANDOFF_WITH_CAPACITY\` / \`OPEN\` / \`EXPANDING\`**. Its historical
report is not rewritten.

The machinery is \`classifySessionStop\` in \`lib/workstate/types.ts\`, guarded
in \`tests/stopping-legitimacy.test.ts\` — whose load-bearing case is the one
prose could never enforce: **a session claiming
\`CLEAN_HANDOFF_LIMIT_REACHED\` at 56% is REFUSED, and the refusal names what
was claimed.**`,
    relations: [
      {
        kind: "amends",
        target: "R-0180",
        changed:
          "the session-status vocabulary expands from three values to five, and a measured stop accounting is required at every non-COMPLETE close",
        survives:
          "RULING 180's separation of session, workstream and graph status; that the repository generates the handoff; that item completion is derived from child state; and that lost or unrepresented remainder is failure",
      },
    ],
  },
  {
    n: 189,
    adopted: "2026-08-27",
    title:
      "RULING 189 — a session does not measure its own context, and stops for real reasons only",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**A SESSION DOES NOT MEASURE ITSELF. The context-usage stopping model is
REMOVED — every percentage, every threshold, and every proxy for one.**

RULING 187 required a session to record \`context_used_percent\` and
\`context_remaining_percent\` at every non-\`COMPLETE\` close, and gave one
status an **80% floor**. The model does not possess that measurement. A
session reported approximately **4% used / 96% remaining** while the
interface it was running inside displayed a context gauge at roughly **47%**.
The classifier believed the number, because a number was all it was given.

**A guessed quantity dressed as a measurement is worse than no quantity.** It
made a status that reads as success purchasable with an estimate, and it gave
a session a standing reason to reason about its own capacity instead of about
the work.

**The operating rule, entire:**

    DO THE WORK THAT WAS ASKED FOR.
    KEEP WORKING WHILE AUTHORIZED EXECUTABLE WORK REMAINS.
    STOP WHEN THE REQUESTED WORK IS ACTUALLY COMPLETE, WHEN THE AUTHOR
    EXPLICITLY STOPS OR REDIRECTS THE SESSION, OR WHEN THE ENVIRONMENT
    ITSELF ACTUALLY PREVENTS CONTINUATION.

**A session does not estimate context used, estimate context remaining,
narrate approximate percentages, monitor its own context as a work-management
signal, stop because a threshold is thought to be reached, or classify itself
as early on guessed capacity.** Nor is the percentage replaced by another
arbitrary proxy — elapsed minutes, token guesses, message counts, command
counts, commit counts, subjective fatigue, or a work quota. **It is a defect
to consume context or produce prose in order to cross any threshold, and
there is now no threshold to cross.**

**The five statuses, replacing RULING 187's five:**

    SESSION: COMPLETE
             CLEAN_HANDOFF_AUTHOR_STOP
             CLEAN_HANDOFF_EXTERNAL_STOP
             EARLY_HANDOFF
             FAILED_CLOSEOUT

Every non-\`COMPLETE\` close records a specific \`stop_reason\`, whether the
AUTHOR stopped the session, whether an ACTUAL external condition prevented
continuing, and \`executable_owed_work_remaining\` — which is DERIVED from
canonical state, never asserted. **No percentage is recorded and none is
asked for.**

**\`CLEAN_HANDOFF_EXTERNAL_STOP\` is never INFERRED.** One blocked item does
not qualify while other authorized work exists — skip forward.

**MERGE CADENCE IS NOT SESSION CADENCE.** RULING 1 governs shipping: verify
locally, accumulate the session's work, ship once at the real end. **The fact
that the planned merge has occurred is not a legitimate reason to stop**, and
the normal answer is to DELAY the merge until the session is actually ready
to end. The preceding descent session stopped on \`one planned merge per
session (RULING 1), now taken\` while executable work remained; that is the
wrong reading, and it is now refused mechanically. Any author-directed
mid-session merge exception already in force is preserved.

**PERSISTED RESUMABILITY IS NOT PERMISSION TO STOP VOLUNTARILY.** Canonical
workstate, exact frontier persistence, exact resume cursors, unmaterialized-
obligation accounting, generated handoffs, method knowledge, the state corpus
and durable closeout records are all UNCHANGED and undiminished. They exist
so that an interrupted session can be resumed. They are not a licence to end
one.

The machinery is \`classifySessionStop\` and \`NON_REASONS\` in
\`lib/workstate/types.ts\`, guarded in \`tests/stopping-legitimacy.test.ts\`.
**A stated stop reason that appeals to self-estimated capacity or to merge
cadence cannot make a stop clean: it is refused, and the refusal names the
non-reason it appealed to.**`,
    claims: [{ key: "session.stop_standard", value: "work-author-or-external-condition" }],
    relations: [
      {
        kind: "supersedes_full",
        target: "R-0187",
        changed:
          "the entire context-usage stopping model is removed — context_used_percent, context_remaining_percent, the 80% floor, the platform-limit signal, CLEAN_HANDOFF_LIMIT_REACHED and EARLY_HANDOFF_WITH_CAPACITY all go, because the session cannot measure the quantity they were built on",
        survives:
          "that a well-preserved handoff is not automatically a legitimate stop; that the two questions at close are independent; that the model does not award itself a status and a claim the state refuses is named; that COMPLETE is derived from owed work; and that an external stop must be real, one blocked item never qualifying while other authorized work exists",
      },
      {
        kind: "amends",
        target: "R-0180",
        changed:
          "the session-status vocabulary is COMPLETE | CLEAN_HANDOFF_AUTHOR_STOP | CLEAN_HANDOFF_EXTERNAL_STOP | EARLY_HANDOFF | FAILED_CLOSEOUT, and the stop accounting recorded at close carries no measurement of context",
        survives:
          "RULING 180's separation of session, workstream and graph status; that the repository generates the handoff and the model may not invent it; that item completion is derived from child state; and that lost or unrepresented remainder is failure",
      },
    ],
  },
  {
    n: 188,
    title: "RULING 188 — the descent freezes only for the minimum safe state cutover",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**FREEZE THE MOVING STATE ONLY LONG ENOUGH TO REPLACE ITS CANONICAL
STORE. DO NOT FREEZE THE PRODUCT UNTIL EVERY HISTORICAL DOCUMENT IS PERFECT.**

An active discovery frontier must not keep changing while its canonical state
representation is being replaced. It does not follow that the work stops until
the whole governance history is normalized — that would spend an extended period
building the system that DESCRIBES the work instead of doing the work.

**Stage 1** is the minimum safe cutover, and its acceptance list is a SAFETY
list: the ruling ledger imported with immutable ids and resolving aliases; new
decisions landing through one atomic path; the rulings document needing no
hand-maintained second write; current discovery law and current
shipping/verification/close-out law each compiled to one authoritative surface;
the active frontier migrated to machine-readable state with stable edge ids,
queued and processed edges, an exact cursor, parent provenance and dispositions;
candidates separate from promoted bodies; permission separate from transport;
cumulative method knowledge preserved and inherited; the handoff generated from
canonical state; the Stage 1 validators passing; and a resume proof showing the
frontier continues **without rediscovering outstanding edges from seeds**.

**When those pass, the freeze is LIFTED and the descent resumes immediately.**

**Stage 2 does NOT hold the freeze.** Full historical type classification, full
provenance normalization, complete supersession normalization, every remaining
domain policy, final root reduction, remaining historical ambiguity and
compatibility-path removal all continue afterwards, while the live work benefits
from the new architecture.

**THERE IS NO SECOND MIGRATION OF THE ACTIVE FRONTIER.** From the cutover
forward, new descent work writes directly into the canonical frontier, new
methods into the cumulative store, new decisions through the atomic governance
transaction, and new convergence states under the versioned model.

**A freeze that outlasts its safety reason is reported as a blocker with the
exact failing criterion named.** "Migration incomplete" is not an acceptable
substitute for naming which criterion failed.

The gate is \`pnpm stage1\`, guarded in \`tests/stopping-legitimacy.test.ts\`,
which fails if Stage 1 ever gates on Stage 2 work.`,
  },
  {
    n: 186,
    title: "RULING 186 — a session opens on task-relevant current authority, never on the full history",
    domain: "meta-governance",
    kind: "LAW_DECISION",
    provenance: "author_explicit",
    body: `**\`pnpm governance:open --task <domain>\` loads the root constitution, the
applicable current domain policies, the applicable active current decisions,
unresolved governance conflicts, the governance snapshot hash, and pointers to
current tracker and work state.**

**It does NOT dump the historical ledger as normal startup context.**
Historical rationale is retrieved on demand.

For long-running work, opening also prints canonical workstream and method
state: workstream status, graph status, method version, routes inherited and
applicable, the exact resume cursor, and the counts of open, blocked and
recheck-due children.

**If answering a current-rule question still requires reading 80,000 words of
chronology, this rule is not being met.**`,
  },
];

/**
 * Claim assignments onto EXISTING records.
 *
 * These add no law. They point a rule that was already answering a question at
 * the slot that holds the answer, so a contradiction becomes a failing test
 * rather than something a session might notice.
 */
export const CLAIM_ASSIGNMENTS: Array<{ id: string; key: string; value: string; why: string }> = [
  {
    id: "R-0125",
    key: "verification.target",
    value: "local-production-build",
    why: "RULING 125 states it in as many words: walk:all loses its production mode entirely and a non-local target is REFUSED.",
  },
  {
    id: "R-0124",
    key: "shipping.closeout_path",
    value: "no-separate-push",
    why: "RULING 124 states that `pnpm closeout` refuses a separate push to `main`.",
  },
  {
    id: "R-0124",
    key: "refresh.cadence",
    value: "orchestrated-daily-per-source-rate",
    why: "RULING 124 replaces five crons with one orchestrated daily run at per-source rates.",
  },
  {
    id: "R-0079",
    key: "tracker.needs_sean_closure",
    value: "author-or-answering-ruling",
    why: "RULING 79 amends RULING 37 narrowly: a dated ruling that demonstrably answers a row closes it.",
  },
  {
    id: "R-0166",
    key: "discovery.source_order",
    value: "body-own-publication-first",
    why: "RULING 166 states the body's own publication is rung one and its bulk download is rung zero.",
  },
];

/**
 * Status resolutions.
 *
 * Every entry names the LATER record that took over, and every one is
 * justified by language that later record already uses. **Nothing is retired on
 * a session's judgement**, which is why each carries a `why` quoting the basis.
 */
export const STATUS_RESOLUTIONS: Array<{ id: string; status: Status; by: string; why: string }> = [
  {
    id: "R-0187",
    status: "SUPERSEDED",
    by: "R-0189",
    why: "RULING 189 removes the context-usage stopping model RULING 187 was built on. Its operative text is retired rather than amended, because leaving it current would keep instructing sessions to measure a quantity they cannot measure; what survives of it travels on RULING 189's supersedes_full relation.",
  },
  {
    id: "R-0180",
    status: "AMENDED",
    by: "R-0189",
    why: "RULING 189 replaces the session-status vocabulary. RULING 180's three-axis separation, generated handoff and derived item completion all stand.",
  },
  {
    id: "R-0058",
    status: "SUPERSEDED",
    by: "R-0061",
    why: "RULING 61 says in its own heading that it supersedes RULING 58's two-branch bar, which was too low.",
  },
  {
    id: "R-0078",
    status: "AMENDED",
    by: "R-0124",
    why: "RULING 124 amends the cadence clause; the duplicate-CI-runs clause stays law.",
  },
  {
    id: "R-0037",
    status: "AMENDED",
    by: "R-0079",
    why: "RULING 79 amends RULING 37 narrowly and deliberately; author-only closure stands for rows awaiting judgement.",
  },
  {
    id: "R-0084",
    status: "AMENDED",
    by: "R-0166",
    why: "RULING 166 amends the order INSIDE Tier A; RULING 84's three tiers and cost-per-fact reasoning stand.",
  },
  {
    id: "R-0094",
    status: "AMENDED",
    by: "R-0170",
    why: "RULING 170 amends what reaching the end of the five moves MEANS; the moves, placement and void condition stand.",
  },
  {
    id: "R-0120",
    status: "AMENDED",
    by: "R-0160",
    why: "RULING 160 amends WHEN a sale may happen; the exclusivity prohibition and equal-solicitation obligation are carried forward in force.",
  },
  {
    id: "R-0104",
    status: "AMENDED",
    by: "R-0135",
    why: "RULING 135 refines RULING 104 and narrows nothing; committing is registration, not action.",
  },
  {
    id: "R-0099",
    status: "AMENDED",
    by: "R-0176",
    why:
      "RULING 176 retires the dual-write clause and replaces it with the canonical ledger plus generated views. " +
      "RULING 99 stays in force in everything else it says — the later-dated-ruling requirement, naming the " +
      "predecessor, stating what changed, never editing in place, and immutable numbers.",
  },
  {
    id: "R-0092",
    status: "AMENDED",
    by: "R-0102",
    why: "RULING 102 gives RULING 92 the completion condition it never had; fix-the-generator stands.",
  },
];
