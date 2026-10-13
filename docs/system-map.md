# System map: the target operating model

> TARGET OPERATING MODEL — NOT LIVE OPERATIONAL STATUS. This map describes how the system should behave at full effectiveness. It is not a reading of what is running now, and it authorises no backend change. Actual status, queue depth, freshness, spending and blockers come from supported data only and belong to the Admin fleet operations overlay, where an unavailable measurement stays unavailable rather than being filled in.

**Capacity spread across everything that is owed, with progress that accumulates.**

Meanwhile continuously discovers, collects, verifies and publishes civic information. Workers are reusable capabilities called as a record's situation requires — not stations on a line every record must walk. Select any node for its purpose, inputs, outputs, dependencies, failure handling and next action.

_Code-name labels point at the code path each capability is intended to use at full effectiveness. They are a reading aid, not a claim that every path is implemented today or that a retired module still stands — the legacy promotion producer named on the authorized-pipeline node (promotion/promoter.ts) is being retired, and a target capability's label never means the current contracts establish it._

Moved here from the Admin System map page (2026-09-30, Sean: the explainer belongs in `docs/`, and Admin is the command center only). The data it was drawn from was `lib/admin/system-map-model.ts`.

## 01. Who coordinates the work

Coordination. Capacity is spread across everything that is due. Nothing starves, and one blocked branch never stops unrelated work.

Rail: Dispatch. Independent work runs concurrently, within resource and source-access limits. A record is sent only to the capabilities its situation requires.

### The obligation ledger

Code: `repository/types.ts · work-item.ts`

- **Purpose:** One durable record of everything Meanwhile owes: which government, which record class, how often it must be refreshed, and the state that obligation is in right now.
- **Takes in:** Coverage decisions, record-class cadences, and every result, checkpoint and cost row written back during a turn.
- **Hands on:** The eligible-and-due set the scheduler reads, plus the history any capability needs in order to resume rather than restart.
- **Depends on:** Nothing upstream. Every other part of the system reads from here and writes back through compare-and-set, so two processes cannot claim the same work.
- **When it fails:** A write that loses its compare-and-set is rejected rather than overwriting. A process that dies leaves a recoverable expired lease, not a lost task.
- **What comes next:** The scheduler reads the due set at the start of every turn.
- **Connected to:** The scheduler spreads capacity, The blocked register, Preserved sources

### The scheduler spreads capacity

Code: `workers/coordinator.ts`

- **Purpose:** Distributes the capacity available in a turn across every eligible, due obligation. Ordering is by who was served least recently, so no government and no record class starves.
- **Takes in:** The eligible-and-due set, the capacity available this turn, and the concurrency and source-access limits that govern how much can run at once.
- **Hands on:** Dispatch instructions to capabilities — several at once wherever the work is independent — with discovery capacity reserved so it cannot be crowded out by cheaper work.
- **Depends on:** The ledger for what is due; the limits governor for how much may run concurrently.
- **When it fails:** If capacity runs out, unserved obligations keep their place in the ordering and the stop reason is named. Work stays owed rather than being silently dropped.
- **What comes next:** Admitted work goes to the capability pool. Everything else keeps its position for the next turn.
- **Connected to:** The obligation ledger, Concurrency and access limits, The blocked register

### Concurrency and access limits

Code: `scheduler/admission.ts`

- **Purpose:** Governs how much can run at once: resource ceilings, per-capability concurrency, and each source's own access rules and politeness constraints.
- **Takes in:** Declared resource ceilings, the access rules published by each source, and a live count of in-flight work.
- **Hands on:** An admit-or-hold decision for each candidate, with the reason attached whenever it is a hold.
- **Depends on:** The scheduler proposes; this decides how many proposals become in-flight work. It never reorders fairness, only throttles it.
- **When it fails:** A source's access rules refuse a route before any request is made. A refusal is recorded with the condition that would lift it, never retried blindly.
- **What comes next:** Admitted work reaches the capability pool. Held work goes to the blocked register carrying its reason.
- **Connected to:** The scheduler spreads capacity, The blocked register, Acquirers retrieve and preserve source material, Scouts discover sources and routes

### The blocked register

Code: `work-item.ts · WORK_ITEM_STATES`

- **Purpose:** Holds work that cannot proceed, together with the specific reason and the condition that would release it. A blocked branch is parked, not failed.
- **Takes in:** Holds from the limits governor, unanswered owner decisions, unresolved identities, and sources that need a records request or a person.
- **Hands on:** A resume signal the moment the releasing condition is met, returning that branch to the due set at the position it retained.
- **Depends on:** Deliberately nothing downstream. Independent branches — including other record classes for the same government — continue while one is parked.
- **When it fails:** A reason nobody has written a plain sentence for is shown in its own words rather than given an invented explanation.
- **What comes next:** Rechecked every turn. When eligible, the branch rejoins the ordering where it left off.
- **Connected to:** The scheduler spreads capacity, Concurrency and access limits, Owner decisions, kept explicit

### Owner decisions, kept explicit

Code: `decision-cards.ts`

- **Purpose:** The small set of decisions the system will not make for itself: activating coverage, authorizing a records request or human contact, merging a proven method, and any publication outside standing authorization.
- **Takes in:** Decision cards raised by a capability that has reached a boundary it is not permitted to cross.
- **Hands on:** An answer that releases exactly one parked branch on the next turn.
- **Depends on:** Routine publication does not wait here — standing authorization covers it. Only genuine exceptions arrive.
- **When it fails:** Nothing fails; the branch waits. A system that could unblock itself by guessing would eventually publish a guess.
- **What comes next:** An unanswered card leaves one branch parked. Every unrelated branch keeps moving.
- **Connected to:** The blocked register, Standing authorization, and named exceptions, Engineering workers build reusable automation

## 02. Reusable capabilities, called as needed

Capability. Not an assembly line. Any capability can be called at any point, several at once, and a record visits only the ones it needs.

Rail: Reads and writes. Every capability reads what is already held and writes back what it learns. Nothing already preserved is fetched twice.

### Scouts discover sources and routes

Code: `workers/scout.ts`

- **Purpose:** Work out where a record class is actually published for a given government, and how to reach it — which platform, which interface, which page follows which.
- **Takes in:** A government and record class with no known route, or a route that has only been partly walked.
- **Hands on:** A walkable route, or a partly-walked route with the next unexplored steps preserved, so the following turn continues instead of starting over.
- **Depends on:** The site's robots file is read and recorded before any request, and never blocks a public page; a login, paywall, bot check or rate limit is never bypassed. Discovery capacity is reserved by the scheduler so cheap work cannot crowd it out.
- **When it fails:** A route that cannot be resolved is recorded as open with what remains to investigate. A source that refuses access is recorded with the condition that would lift the refusal.
- **What comes next:** A resolved route lets acquirers fetch. What remains to investigate becomes its own queued work.
- **Connected to:** Acquirers retrieve and preserve source material, Open questions and routes still to walk, Engineering workers build reusable automation, Concurrency and access limits

### Detectives investigate open questions

Code: `workers/detective.ts`

- **Purpose:** Investigate identity, contradictions, missing information and completeness — is this the same governing body, is this list the whole list, does this contradict what is already held.
- **Takes in:** An open question blocking progress, together with whatever evidence is already preserved.
- **Hands on:** A settled answer with its evidence, or a named gap with an identity that survives. One investigation may span several questions and several sources, each as a linked follow-up task.
- **Depends on:** Preserved sources and structured records, and it may commission an acquirer for evidence not yet held.
- **When it fails:** An unresolved identity is a hard stop for that branch rather than a warning — a record that cannot be attributed to a specific body is not a record.
- **What comes next:** Linked follow-up tasks enter the queue as ordinary work and are scheduled alongside everything else.
- **Connected to:** Open questions and routes still to walk, Acquirers retrieve and preserve source material, Verifiers check attribution and correctness, Structured records and their evidence

### Acquirers retrieve and preserve source material

Code: `workers/acquirer.ts`

- **Purpose:** Fetch the published document itself and preserve its origin, its retrieval time and its exact contents, so any claim can be re-checked against what was actually published.
- **Takes in:** A walkable route from a scout, or a proven method that already knows the route, plus the source's access rules.
- **Hands on:** A preserved capture addressed by its contents, with publisher and retrieval time attached.
- **Depends on:** The route and the access rules. It reads and records the site's robots file, which never blocks a public page (your decision of 2026-09-25); it never gets past a login, paywall, bot check or rate limit, and never falls back to an unverified mirror.
- **When it fails:** A capture that fails integrity, provenance or currency is refused. The last good capture is retained and keeps serving, with its age reported plainly rather than hidden.
- **What comes next:** Parsers read the preserved capture. Nothing downstream reads the live source again.
- **Connected to:** Preserved sources, Parsers extract structured records, Scouts discover sources and routes, The method library

### Parsers extract structured records

Code: `workers/parser.ts`

- **Purpose:** Turn a preserved document into typed records, each carrying the exact location in the source that supports it.
- **Takes in:** A preserved capture, and a method from the library wherever one already covers this platform.
- **Hands on:** Structured records, each linked to the supporting passage in the preserved source.
- **Depends on:** The preserved capture rather than the live source, so a record can always be re-derived from what is held.
- **When it fails:** A field that cannot be supported by a passage is left absent and named, never inferred. An empty extraction is recorded as a gap, not as proof the source is empty.
- **What comes next:** Verifiers and auditors check the records against the evidence requirements applicable to that record class.
- **Connected to:** Structured records and their evidence, Verifiers check attribution and correctness, The method library, Preserved sources

### Verifiers check attribution and correctness

Code: `workers/verifier.ts`

- **Purpose:** Check that each record is attributed to the right governing body and that its content is correct against the evidence requirements applicable to its record class.
- **Takes in:** Structured records with their supporting passages, and independent authorities wherever the record class requires one.
- **Hands on:** Records marked as satisfying their evidence requirements, or discrepancies attached to the specific field in question.
- **Depends on:** Requirements differ by record class. The applicable set governs, not one fixed bar applied to everything.
- **When it fails:** No independent authority on file is a named gap rather than a pass. Uncertainty stays explicit instead of resolving quietly to a default.
- **What comes next:** What survives verification is handed to auditors to be attacked.
- **Connected to:** Auditors check completeness and contradictions, Structured records and their evidence, Open questions and routes still to walk

### Auditors check completeness and contradictions

Code: `workers/auditor.ts`

- **Purpose:** Try to break a verified record from independent evidence — false absence, false presence, anything unobserved — and check that the set is complete rather than merely correct.
- **Takes in:** Verified records, independent evidence, and injected controls wherever the record class requires measured recall.
- **Hands on:** Records that survived an adversarial check, or a reopened branch with the contradiction attached to the field it concerns.
- **Depends on:** Measured controls where they are required. A model's suspicion is a hypothesis, not evidence, and cannot carry an audit on its own.
- **When it fails:** An audit without the controls its record class requires cannot state recall and is refused. An unmeasured score is recorded as unmeasured, never as zero.
- **What comes next:** Surviving records become eligible for publication. A broken record reopens only its own branch.
- **Connected to:** Structured records and their evidence, The authorized data pipeline, Open questions and routes still to walk

### Engineering workers build reusable automation

Code: `workers/engineering.ts`

- **Purpose:** Once a procedure has been solved and proved repeatable, turn it into deterministic code, so expensive model work happens on discovery and exceptions only.
- **Takes in:** A route or extraction that has been solved and can reproduce its own claimed result.
- **Hands on:** A candidate method with its proof, proposed through the approved software-review process.
- **Depends on:** The review process and an owner decision to merge. Nothing merges itself.
- **When it fails:** A candidate that cannot reproduce its claimed result is refused before review, with the proof failure attached.
- **What comes next:** A merged method enters the library, and every government on the same platform inherits it.
- **Connected to:** The method library, Owner decisions, kept explicit, Scouts discover sources and routes, Parsers extract structured records

## 03. What accumulates, and gets reused

Record. Progress is durable. Findings, preserved sources and proven methods are reused; a failure reopens only the affected work.

Rail: Validated updates. Only records that satisfy the evidence requirements for their class become eligible to publish.

### Preserved sources

Code: `evidence/durable-store.ts`

- **Purpose:** The published documents themselves, addressed by their contents, each carrying its origin, its retrieval time and its exact bytes.
- **Takes in:** Captures written by acquirers.
- **Hands on:** The evidence any capability re-reads instead of re-fetching, and the checkpoint a recovering worker resumes from.
- **Depends on:** Immutable once written. A newer capture never overwrites an older one; both stay on the record.
- **When it fails:** A failed refresh leaves the last good capture in place and serving, with its age reported. Falling back to older evidence never satisfies a stage on its own.
- **What comes next:** Read by parsers, detectives and auditors, and by any retry resuming from a checkpoint.
- **Connected to:** Acquirers retrieve and preserve source material, Parsers extract structured records, Structured records and their evidence

### Structured records and their evidence

Code: `promotion/pipeline.ts`

- **Purpose:** Every extracted record with the complete history of what it has satisfied, each stage pointing at the exact result and passage that earned it.
- **Takes in:** Extractions from parsers, and stage outcomes from verifiers.
- **Hands on:** Records eligible to publish, and records reopened with a named reason.
- **Depends on:** A stage cannot be claimed without the stage beneath it. Currency, attribution and completeness are tracked separately rather than collapsed into one flag.
- **When it fails:** An offer that does not satisfy its stage is refused and the refusal is kept on the record. Uncertainty is carried forward, not rounded away.
- **What comes next:** Eligible records go to the publication pipeline. Reopened ones go back to the queue as their own work.
- **Connected to:** Parsers extract structured records, Auditors check completeness and contradictions, The authorized data pipeline, Open questions and routes still to walk

### Open questions and routes still to walk

Code: `workers/research-types.ts`

- **Purpose:** What remains to investigate, preserved so it is never re-derived: unsettled questions, partly-walked routes, and the next steps each one needs.
- **Takes in:** Unresolved questions from detectives and verifiers, and partly-walked routes from scouts.
- **Hands on:** Queued work items with the same standing as any other obligation, so investigation competes for capacity on equal terms.
- **Depends on:** Nothing. This is the system's memory of its own unfinished business.
- **When it fails:** A question that cannot be settled stays open with what is known attached. It never becomes an assumption.
- **What comes next:** The scheduler picks these up alongside refreshes and new coverage.
- **Connected to:** Detectives investigate open questions, Scouts discover sources and routes, The scheduler spreads capacity

### The method library

Code: `workers/engineering-candidate.ts`

- **Purpose:** Proven, reviewed procedures that any government on the same platform inherits — the reason a route solved once does not have to be solved again.
- **Takes in:** Merged candidates from engineering workers, each carrying the proof it reproduced its claimed result.
- **Hands on:** A deterministic path acquirers and parsers take instead of paying for model work.
- **Depends on:** The approved software-review process, and an explicit owner decision to merge.
- **When it fails:** If no method covers a platform, that platform simply keeps costing model spend per jurisdiction. Nothing breaks; the cost curve just does not bend.
- **What comes next:** Applied on the next acquisition or extraction for any government on that platform.
- **Connected to:** Engineering workers build reusable automation, Acquirers retrieve and preserve source material, Parsers extract structured records, Owner decisions, kept explicit

## 04. Publication, and proof it was served

Publication. Routine updates proceed under standing authorization. Publication is confirmed by checking the served result, not a completed task.

Rail: Feedback returns. Retries, recovery, recurring refreshes and newly discovered questions all re-enter the work queues below.

### The authorized data pipeline

Code: `promotion/promoter.ts`

- **Purpose:** The one path by which validated updates are made available to the existing site.
- **Takes in:** Records that satisfy the evidence requirements for their class, and the authorization covering them.
- **Hands on:** An update submitted through the authorized path, with a retained receipt of what was included.
- **Depends on:** Standing authorization for routine updates; an explicit owner decision for anything outside it.
- **When it fails:** An update that cannot be validated is not submitted. A retained receipt that fails to refresh stays visible as history and is explicitly prevented from continuing to look current.
- **What comes next:** The served result is checked before anything is treated as published.
- **Connected to:** Standing authorization, and named exceptions, Served-result confirmation, Structured records and their evidence

### Standing authorization, and named exceptions

Code: `promotion/policy.ts`

- **Purpose:** Routine updates proceed without waiting on a person. Anything outside the standing grant is raised as an explicit, named owner decision.
- **Takes in:** The authorization policy for each record class, and the specific update being proposed.
- **Hands on:** A proceed signal for routine work, or a decision card for the exception.
- **Depends on:** A clearly scoped grant. An unscoped grant would make the exception path meaningless.
- **When it fails:** An update that falls outside the grant waits rather than proceeding. Only that update waits.
- **What comes next:** Routine updates continue straight to the pipeline; exceptions park until answered.
- **Connected to:** Owner decisions, kept explicit, The authorized data pipeline

### Served-result confirmation

Code: `promotion/reader-projection.ts`

- **Purpose:** Confirm publication by reading what the site actually returns. A completed task is not evidence that a reader can see anything.
- **Takes in:** The submitted update, and the live served response for the affected addresses.
- **Hands on:** A confirmed publication, or a discrepancy between what was submitted and what is being served.
- **Depends on:** The ability to read the served result. Where that cannot be read, the status stays unknown rather than being inferred.
- **When it fails:** A completed computation is never read as a published fact, and a loaded receipt is never read as a served one. This is the most load-bearing refusal in the design.
- **What comes next:** A confirmed publication closes the obligation for this cycle. A discrepancy reopens it.
- **Connected to:** The authorized data pipeline, The Reader, The obligation ledger

### The Reader

Code: `app/reader`

- **Purpose:** The public surface: one address returns the full governing stack, with every claim traceable to the preserved document behind it, and each fact's age stated.
- **Takes in:** Confirmed publications.
- **Hands on:** Answers residents can act on, and the questions they ask that nothing currently answers.
- **Depends on:** Served-result confirmation. Nothing appears here on the strength of a completed task.
- **When it fails:** Where information is stale, its age is shown rather than hidden. Where it is missing, the gap is named rather than left blank.
- **What comes next:** Unanswered questions become demand signal that points at what to acquire next.
- **Connected to:** Served-result confirmation, Open questions and routes still to walk

## Feedback loops

### A failure reopens only the affected work

Ring 01 · retry. Closes when: One failed refresh reopens one obligation. Every unrelated branch for the same government keeps moving through the same turn.

1. **Acquirers retrieve and preserve source material** — A refresh fails its integrity or currency check
2. **Preserved sources** — The last good capture is retained and keeps serving, with its age reported
3. **The blocked register** — Only this branch parks, carrying the reason and a backoff derived from its own attempts
4. **The scheduler spreads capacity** — Backoff elapses and this obligation alone returns to the due set

### Work resumes from a valid checkpoint

Ring 02 · recovery. Closes when: A crash costs a turn, never the evidence. Recovery starts from the last valid checkpoint rather than from the beginning.

1. **The obligation ledger** — A process dies holding work and leaves an expired lease behind
2. **The scheduler spreads capacity** — The expired lease is swept, the attempt is retained as history, and the task is re-admitted
3. **Preserved sources** — The new attempt resumes from the preserved capture instead of re-fetching the source

### Every obligation comes due again

Ring 03 · recurring refresh. Closes when: Currency is a standing obligation, not a one-time task. This is the ring that keeps the record true rather than merely once-true.

1. **The obligation ledger** — The cadence for this record class elapses and the obligation is owed again
2. **The scheduler spreads capacity** — Least-recently-served ordering gives it a turn without starving anything else
3. **Acquirers retrieve and preserve source material** — A fresh capture is taken and compared against what is already held
4. **Structured records and their evidence** — Changed facts supersede their predecessors; unchanged facts have their currency extended

### Investigation creates its own work

Ring 04 · new questions. Closes when: Questions do not accumulate in someone's head. They become work items with the same standing as any other obligation.

1. **Detectives investigate open questions** — An investigation surfaces a question it cannot settle from what is held
2. **Open questions and routes still to walk** — The question is preserved with what is known and what remains to investigate
3. **The scheduler spreads capacity** — It is scheduled as ordinary work, competing for capacity on equal terms
4. **Acquirers retrieve and preserve source material** — Evidence is commissioned wherever the question needs material not yet preserved

### A route solved once gets cheap platform-wide

Ring 05 · method reuse. Closes when: Models are paid to discover and to handle exceptions, never to replay a solved procedure.

1. **Scouts discover sources and routes** — A route is solved for one government on one platform
2. **Engineering workers build reusable automation** — The procedure is proved repeatable and proposed through software review
3. **Owner decisions, kept explicit** — An owner decision merges it. The system proposes; it never merges itself
4. **The method library** — Every government on the same platform inherits the deterministic path
5. **Acquirers retrieve and preserve source material** — The next acquisition on that platform runs without model spend

## Journeys

### A record reaches the Reader

The straightforward path, with no discovery needed because a proven method already covers this platform. Note that the record skips the capabilities it does not need — scouts and detectives are never called.

**One obligation** (runs to a confirmed publication)

1. **The obligation comes due** (The obligation ledger) — Its refresh cadence elapses and it rejoins the due set
2. **Capacity is allocated** (The scheduler spreads capacity) — Dispatched alongside other independent work in the same turn
3. **A proven method already covers this platform** (The method library) — No scout and no detective is called — the record visits only what it needs
4. **The document is retrieved and preserved** (Acquirers retrieve and preserve source material) — Origin, retrieval time and exact contents kept
5. **Records are extracted with their evidence** (Parsers extract structured records) — Each field points at the passage that supports it
6. **Attribution and correctness check out** (Verifiers check attribution and correctness) — Against the evidence requirements applicable to this record class
7. **The set survives an adversarial check** (Auditors check completeness and contradictions) — Completeness and contradictions, with the required controls in place
8. **Routine publication proceeds** (Standing authorization, and named exceptions) — Inside the standing grant, so no person is waited on
9. **The update goes through the authorized pipeline** (The authorized data pipeline) — With a retained receipt of exactly what was included
10. **The served result is checked** (Served-result confirmation) — Publication is confirmed by reading what the site returns, not by a completed task
11. **A resident gets a current answer** (The Reader) — With every claim traceable to the preserved document behind it

### A branch blocks while other work continues

The same county, the same turn. One refresh fails and parks with its reason; two unrelated branches carry on and one of them publishes. This is the behaviour that makes a blocked branch cheap.

**Branch A · blocked** (parks, keeps its reason)

1. **A refresh fails its currency check** (Acquirers retrieve and preserve source material) — The newest fetch cannot satisfy integrity, provenance or current-until
2. **The last good capture is retained** (Preserved sources) — It keeps serving downstream, with its age reported rather than hidden
3. **The branch parks with its reason** (The blocked register) — Carrying the specific condition that would release it, and a backoff from its own attempts
4. **It returns to the due set when eligible** (The scheduler spreads capacity) — At the position it retained. Nothing else was held up while it waited

**Branch B · continues** (investigates in parallel)

1. **An unrelated identity question is investigated** (Detectives investigate open questions) — Same county, different record class — completely independent work
2. **A follow-up question is preserved and queued** (Open questions and routes still to walk) — With what is known and what remains to investigate attached

**Branch C · continues** (publishes in the same turn)

1. **A different record class is extracted** (Parsers extract structured records) — From a capture already preserved, so nothing is fetched again
2. **It survives audit and becomes eligible** (Auditors check completeness and contradictions) — Its own evidence requirements, independent of Branch A
3. **It publishes under standing authorization** (Standing authorization, and named exceptions) — One parked branch never delays an unrelated publication

## What this map does not show

- **Live status and queue depth:** How many items are moving right now, and what each is doing. That is an operational reading and belongs to the Admin fleet overlay.
- **Freshness and age of the served record:** Real currency figures come from reading what is actually served. Where that reading is unavailable, it stays unavailable.
- **Spending and throughput:** Measured cost per turn and per jurisdiction. An unmeasured total is reported as unknown, never rendered as zero.
- **Which blockers are open today:** Actual blocked branches, their reasons and their retry times are supported data. Nothing on this map should be read as a count.
