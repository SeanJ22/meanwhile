/**
 * Target Operating Model — the architecture explainer's data.
 *
 * Content transcribed VERBATIM from the approved design canvas ("Target Operating
 * Model.html", the primary reference design). This is an ILLUSTRATIVE description of
 * how the system should behave at full effectiveness — it is NOT a reading of live
 * operational status and it authorises no backend change. Live status, queue depth,
 * freshness, spending and blockers belong to the Fleet operations overlay
 * (`components/admin/fleet-operations-map.tsx`), where an unavailable measurement
 * stays unavailable. Pure data, React-free and node:fs-free, so it is client-safe.
 */

export type BandId = "coord" | "cap" | "record" | "pub";

export interface SystemNode {
  readonly id: string;
  readonly band: BandId;
  readonly title: string;
  /** Code-name label (repository path). Shown only when code-name visibility is on. */
  readonly code: string;
  readonly purpose: string;
  readonly inputs: string;
  readonly outputs: string;
  readonly depends: string;
  readonly failure: string;
  readonly next: string;
  /** Related node ids — the "connected to" links. */
  readonly related: readonly string[];
}

/** A feedback ring: a closed loop whose hops are [nodeId, station description]. */
export interface SystemRing {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly closes: string;
  readonly hops: readonly (readonly [string, string])[];
}

export interface JourneyStep { readonly nodeId: string; readonly title: string; readonly detail: string; }
export interface JourneyTrack { readonly name: string; readonly status: string; readonly color: string; readonly steps: readonly JourneyStep[]; }
export interface Journey { readonly id: string; readonly label: string; readonly title: string; readonly blurb: string; readonly tracks: readonly JourneyTrack[]; }

export interface BandMeta {
  readonly num: string; readonly color: string; readonly kind: string; readonly title: string; readonly note: string;
  readonly railColor: string; readonly railLabel: string; readonly railNote: string;
}

export interface OverlayNote { readonly title: string; readonly note: string; }

/** The colour a highlighted feedback ring numbers its stations in. */
export const RING_MARK_COLOR = "#B57BFF";

export const SYSTEM_HEADER = {
  eyebrow: "MEANWHILE · AUTONOMOUS SYSTEM · ARCHITECTURE",
  headline: "Capacity spread across everything that is owed, with progress that accumulates.",
  intro:
    "Meanwhile continuously discovers, collects, verifies and publishes civic information. Workers are reusable capabilities called as a record's situation requires — not stations on a line every record must walk. Select any node for its purpose, inputs, outputs, dependencies, failure handling and next action.",
  bannerTitle: "TARGET OPERATING MODEL — NOT LIVE OPERATIONAL STATUS",
  bannerBody:
    "This map describes how the system should behave at full effectiveness. It is not a reading of what is running now, and it authorises no backend change. Actual status, queue depth, freshness, spending and blockers come from supported data only and belong to the Admin fleet operations overlay, where an unavailable measurement stays unavailable rather than being filled in.",
  /**
   * Honesty caveat for the code-name labels (§ content reconciliation, 2026-09-13).
   * The labels point at the code path each capability is INTENDED to use at full
   * effectiveness — a reading aid, not a claim of current implementation. This
   * matters concretely: the legacy promotion producer named on the pipeline node
   * (`promotion/promoter.ts`) is being retired, so it is not a current path.
   */
  codeNamesNote:
    "Code-name labels point at the code path each capability is intended to use at full effectiveness. They are a reading aid, not a claim that every path is implemented today or that a retired module still stands — the legacy promotion producer named on the authorized-pipeline node (promotion/promoter.ts) is being retired, and a target capability's label never means the current contracts establish it.",
} as const;

export const SYSTEM_NODES: readonly SystemNode[] = [
  { id: "ledger", band: "coord", title: "The obligation ledger", code: "repository/types.ts · work-item.ts",
    purpose: "One durable record of everything Meanwhile owes: which government, which record class, how often it must be refreshed, and the state that obligation is in right now.",
    inputs: "Coverage decisions, record-class cadences, and every result, checkpoint and cost row written back during a turn.",
    outputs: "The eligible-and-due set the scheduler reads, plus the history any capability needs in order to resume rather than restart.",
    depends: "Nothing upstream. Every other part of the system reads from here and writes back through compare-and-set, so two processes cannot claim the same work.",
    failure: "A write that loses its compare-and-set is rejected rather than overwriting. A process that dies leaves a recoverable expired lease, not a lost task.",
    next: "The scheduler reads the due set at the start of every turn.",
    related: ["scheduler", "blocked", "sources"] },
  { id: "scheduler", band: "coord", title: "The scheduler spreads capacity", code: "workers/coordinator.ts",
    purpose: "Distributes the capacity available in a turn across every eligible, due obligation. Ordering is by who was served least recently, so no government and no record class starves.",
    inputs: "The eligible-and-due set, the capacity available this turn, and the concurrency and source-access limits that govern how much can run at once.",
    outputs: "Dispatch instructions to capabilities — several at once wherever the work is independent — with discovery capacity reserved so it cannot be crowded out by cheaper work.",
    depends: "The ledger for what is due; the limits governor for how much may run concurrently.",
    failure: "If capacity runs out, unserved obligations keep their place in the ordering and the stop reason is named. Work stays owed rather than being silently dropped.",
    next: "Admitted work goes to the capability pool. Everything else keeps its position for the next turn.",
    related: ["ledger", "limits", "blocked"] },
  { id: "limits", band: "coord", title: "Concurrency and access limits", code: "scheduler/admission.ts",
    purpose: "Governs how much can run at once: resource ceilings, per-capability concurrency, and each source's own access rules and politeness constraints.",
    inputs: "Declared resource ceilings, the access rules published by each source, and a live count of in-flight work.",
    outputs: "An admit-or-hold decision for each candidate, with the reason attached whenever it is a hold.",
    depends: "The scheduler proposes; this decides how many proposals become in-flight work. It never reorders fairness, only throttles it.",
    failure: "A source's access rules refuse a route before any request is made. A refusal is recorded with the condition that would lift it, never retried blindly.",
    next: "Admitted work reaches the capability pool. Held work goes to the blocked register carrying its reason.",
    related: ["scheduler", "blocked", "acquirers", "scouts"] },
  { id: "blocked", band: "coord", title: "The blocked register", code: "work-item.ts · WORK_ITEM_STATES",
    purpose: "Holds work that cannot proceed, together with the specific reason and the condition that would release it. A blocked branch is parked, not failed.",
    inputs: "Holds from the limits governor, unanswered owner decisions, unresolved identities, and sources that need a records request or a person.",
    outputs: "A resume signal the moment the releasing condition is met, returning that branch to the due set at the position it retained.",
    depends: "Deliberately nothing downstream. Independent branches — including other record classes for the same government — continue while one is parked.",
    failure: "A reason nobody has written a plain sentence for is shown in its own words rather than given an invented explanation.",
    next: "Rechecked every turn. When eligible, the branch rejoins the ordering where it left off.",
    related: ["scheduler", "limits", "owner"] },
  { id: "owner", band: "coord", title: "Owner decisions, kept explicit", code: "decision-cards.ts",
    purpose: "The small set of decisions the system will not make for itself: activating coverage, authorizing a records request or human contact, merging a proven method, and any publication outside standing authorization.",
    inputs: "Decision cards raised by a capability that has reached a boundary it is not permitted to cross.",
    outputs: "An answer that releases exactly one parked branch on the next turn.",
    depends: "Routine publication does not wait here — standing authorization covers it. Only genuine exceptions arrive.",
    failure: "Nothing fails; the branch waits. A system that could unblock itself by guessing would eventually publish a guess.",
    next: "An unanswered card leaves one branch parked. Every unrelated branch keeps moving.",
    related: ["blocked", "standing", "engineering"] },
  { id: "scouts", band: "cap", title: "Scouts discover sources and routes", code: "workers/scout.ts",
    purpose: "Work out where a record class is actually published for a given government, and how to reach it — which platform, which interface, which page follows which.",
    inputs: "A government and record class with no known route, or a route that has only been partly walked.",
    outputs: "A walkable route, or a partly-walked route with the next unexplored steps preserved, so the following turn continues instead of starting over.",
    depends: "Source access rules are checked before any request. Discovery capacity is reserved by the scheduler so cheap work cannot crowd it out.",
    failure: "A route that cannot be resolved is recorded as open with what remains to investigate. A source that refuses access is recorded with the condition that would lift the refusal.",
    next: "A resolved route lets acquirers fetch. What remains to investigate becomes its own queued work.",
    related: ["acquirers", "openq", "engineering", "limits"] },
  { id: "detectives", band: "cap", title: "Detectives investigate open questions", code: "workers/detective.ts",
    purpose: "Investigate identity, contradictions, missing information and completeness — is this the same governing body, is this list the whole list, does this contradict what is already held.",
    inputs: "An open question blocking progress, together with whatever evidence is already preserved.",
    outputs: "A settled answer with its evidence, or a named gap with an identity that survives. One investigation may span several questions and several sources, each as a linked follow-up task.",
    depends: "Preserved sources and structured records, and it may commission an acquirer for evidence not yet held.",
    failure: "An unresolved identity is a hard stop for that branch rather than a warning — a record that cannot be attributed to a specific body is not a record.",
    next: "Linked follow-up tasks enter the queue as ordinary work and are scheduled alongside everything else.",
    related: ["openq", "acquirers", "verifiers", "records"] },
  { id: "acquirers", band: "cap", title: "Acquirers retrieve and preserve source material", code: "workers/acquirer.ts",
    purpose: "Fetch the published document itself and preserve its origin, its retrieval time and its exact contents, so any claim can be re-checked against what was actually published.",
    inputs: "A walkable route from a scout, or a proven method that already knows the route, plus the source's access rules.",
    outputs: "A preserved capture addressed by its contents, with publisher and retrieval time attached.",
    depends: "The route and the access rules. It never bypasses permission uncertainty and never falls back to an unverified mirror.",
    failure: "A capture that fails integrity, provenance or currency is refused. The last good capture is retained and keeps serving, with its age reported plainly rather than hidden.",
    next: "Parsers read the preserved capture. Nothing downstream reads the live source again.",
    related: ["sources", "parsers", "scouts", "methods"] },
  { id: "parsers", band: "cap", title: "Parsers extract structured records", code: "workers/parser.ts",
    purpose: "Turn a preserved document into typed records, each carrying the exact location in the source that supports it.",
    inputs: "A preserved capture, and a method from the library wherever one already covers this platform.",
    outputs: "Structured records, each linked to the supporting passage in the preserved source.",
    depends: "The preserved capture rather than the live source, so a record can always be re-derived from what is held.",
    failure: "A field that cannot be supported by a passage is left absent and named, never inferred. An empty extraction is recorded as a gap, not as proof the source is empty.",
    next: "Verifiers and auditors check the records against the evidence requirements applicable to that record class.",
    related: ["records", "verifiers", "methods", "sources"] },
  { id: "verifiers", band: "cap", title: "Verifiers check attribution and correctness", code: "workers/verifier.ts",
    purpose: "Check that each record is attributed to the right governing body and that its content is correct against the evidence requirements applicable to its record class.",
    inputs: "Structured records with their supporting passages, and independent authorities wherever the record class requires one.",
    outputs: "Records marked as satisfying their evidence requirements, or discrepancies attached to the specific field in question.",
    depends: "Requirements differ by record class. The applicable set governs, not one fixed bar applied to everything.",
    failure: "No independent authority on file is a named gap rather than a pass. Uncertainty stays explicit instead of resolving quietly to a default.",
    next: "What survives verification is handed to auditors to be attacked.",
    related: ["auditors", "records", "openq"] },
  { id: "auditors", band: "cap", title: "Auditors check completeness and contradictions", code: "workers/auditor.ts",
    purpose: "Try to break a verified record from independent evidence — false absence, false presence, anything unobserved — and check that the set is complete rather than merely correct.",
    inputs: "Verified records, independent evidence, and injected controls wherever the record class requires measured recall.",
    outputs: "Records that survived an adversarial check, or a reopened branch with the contradiction attached to the field it concerns.",
    depends: "Measured controls where they are required. A model's suspicion is a hypothesis, not evidence, and cannot carry an audit on its own.",
    failure: "An audit without the controls its record class requires cannot state recall and is refused. An unmeasured score is recorded as unmeasured, never as zero.",
    next: "Surviving records become eligible for publication. A broken record reopens only its own branch.",
    related: ["records", "pipeline", "openq"] },
  { id: "engineering", band: "cap", title: "Engineering workers build reusable automation", code: "workers/engineering.ts",
    purpose: "Once a procedure has been solved and proved repeatable, turn it into deterministic code, so expensive model work happens on discovery and exceptions only.",
    inputs: "A route or extraction that has been solved and can reproduce its own claimed result.",
    outputs: "A candidate method with its proof, proposed through the approved software-review process.",
    depends: "The review process and an owner decision to merge. Nothing merges itself.",
    failure: "A candidate that cannot reproduce its claimed result is refused before review, with the proof failure attached.",
    next: "A merged method enters the library, and every government on the same platform inherits it.",
    related: ["methods", "owner", "scouts", "parsers"] },
  { id: "sources", band: "record", title: "Preserved sources", code: "evidence/durable-store.ts",
    purpose: "The published documents themselves, addressed by their contents, each carrying its origin, its retrieval time and its exact bytes.",
    inputs: "Captures written by acquirers.",
    outputs: "The evidence any capability re-reads instead of re-fetching, and the checkpoint a recovering worker resumes from.",
    depends: "Immutable once written. A newer capture never overwrites an older one; both stay on the record.",
    failure: "A failed refresh leaves the last good capture in place and serving, with its age reported. Falling back to older evidence never satisfies a stage on its own.",
    next: "Read by parsers, detectives and auditors, and by any retry resuming from a checkpoint.",
    related: ["acquirers", "parsers", "records"] },
  { id: "records", band: "record", title: "Structured records and their evidence", code: "promotion/fact-chain.ts",
    purpose: "Every extracted record with the complete history of what it has satisfied, each stage pointing at the exact result and passage that earned it.",
    inputs: "Extractions from parsers, and stage outcomes from verifiers and auditors.",
    outputs: "Records eligible to publish, and records reopened with a named reason.",
    depends: "A stage cannot be claimed without the stage beneath it. Currency, attribution and completeness are tracked separately rather than collapsed into one flag.",
    failure: "An offer that does not satisfy its stage is refused and the refusal is kept on the record. Uncertainty is carried forward, not rounded away.",
    next: "Eligible records go to the publication pipeline. Reopened ones go back to the queue as their own work.",
    related: ["parsers", "auditors", "pipeline", "openq"] },
  { id: "openq", band: "record", title: "Open questions and routes still to walk", code: "workers/research-types.ts",
    purpose: "What remains to investigate, preserved so it is never re-derived: unsettled questions, partly-walked routes, and the next steps each one needs.",
    inputs: "Unresolved questions from detectives and verifiers, and partly-walked routes from scouts.",
    outputs: "Queued work items with the same standing as any other obligation, so investigation competes for capacity on equal terms.",
    depends: "Nothing. This is the system's memory of its own unfinished business.",
    failure: "A question that cannot be settled stays open with what is known attached. It never becomes an assumption.",
    next: "The scheduler picks these up alongside refreshes and new coverage.",
    related: ["detectives", "scouts", "scheduler"] },
  { id: "methods", band: "record", title: "The method library", code: "workers/engineering-candidate.ts",
    purpose: "Proven, reviewed procedures that any government on the same platform inherits — the reason a route solved once does not have to be solved again.",
    inputs: "Merged candidates from engineering workers, each carrying the proof it reproduced its claimed result.",
    outputs: "A deterministic path acquirers and parsers take instead of paying for model work.",
    depends: "The approved software-review process, and an explicit owner decision to merge.",
    failure: "If no method covers a platform, that platform simply keeps costing model spend per jurisdiction. Nothing breaks; the cost curve just does not bend.",
    next: "Applied on the next acquisition or extraction for any government on that platform.",
    related: ["engineering", "acquirers", "parsers", "owner"] },
  { id: "pipeline", band: "pub", title: "The authorized data pipeline", code: "promotion/promoter.ts",
    purpose: "The one path by which validated updates are made available to the existing site.",
    inputs: "Records that satisfy the evidence requirements for their class, and the authorization covering them.",
    outputs: "An update submitted through the authorized path, with a retained receipt of what was included.",
    depends: "Standing authorization for routine updates; an explicit owner decision for anything outside it.",
    failure: "An update that cannot be validated is not submitted. A retained receipt that fails to refresh stays visible as history and is explicitly prevented from continuing to look current.",
    next: "The served result is checked before anything is treated as published.",
    related: ["standing", "served", "records"] },
  { id: "standing", band: "pub", title: "Standing authorization, and named exceptions", code: "promotion/policy.ts",
    purpose: "Routine updates proceed without waiting on a person. Anything outside the standing grant is raised as an explicit, named owner decision.",
    inputs: "The authorization policy for each record class, and the specific update being proposed.",
    outputs: "A proceed signal for routine work, or a decision card for the exception.",
    depends: "A clearly scoped grant. An unscoped grant would make the exception path meaningless.",
    failure: "An update that falls outside the grant waits rather than proceeding. Only that update waits.",
    next: "Routine updates continue straight to the pipeline; exceptions park until answered.",
    related: ["owner", "pipeline"] },
  { id: "served", band: "pub", title: "Served-result confirmation", code: "promotion/reader-projection.ts",
    purpose: "Confirm publication by reading what the site actually returns. A completed task is not evidence that a reader can see anything.",
    inputs: "The submitted update, and the live served response for the affected addresses.",
    outputs: "A confirmed publication, or a discrepancy between what was submitted and what is being served.",
    depends: "The ability to read the served result. Where that cannot be read, the status stays unknown rather than being inferred.",
    failure: "A completed computation is never read as a published fact, and a loaded receipt is never read as a served one. This is the most load-bearing refusal in the design.",
    next: "A confirmed publication closes the obligation for this cycle. A discrepancy reopens it.",
    related: ["pipeline", "reader", "ledger"] },
  { id: "reader", band: "pub", title: "The Reader", code: "app/reader",
    purpose: "The public surface: one address returns the full governing stack, with every claim traceable to the preserved document behind it, and each fact's age stated.",
    inputs: "Confirmed publications.",
    outputs: "Answers residents can act on, and the questions they ask that nothing currently answers.",
    depends: "Served-result confirmation. Nothing appears here on the strength of a completed task.",
    failure: "Where information is stale, its age is shown rather than hidden. Where it is missing, the gap is named rather than left blank.",
    next: "Unanswered questions become demand signal that points at what to acquire next.",
    related: ["served", "openq"] },
];

export const SYSTEM_RINGS: readonly SystemRing[] = [
  { id: "retry", eyebrow: "Ring 01 · retry", title: "A failure reopens only the affected work",
    closes: "One failed refresh reopens one obligation. Every unrelated branch for the same government keeps moving through the same turn.",
    hops: [
      ["acquirers", "A refresh fails its integrity or currency check"],
      ["sources", "The last good capture is retained and keeps serving, with its age reported"],
      ["blocked", "Only this branch parks, carrying the reason and a backoff derived from its own attempts"],
      ["scheduler", "Backoff elapses and this obligation alone returns to the due set"] ] },
  { id: "recovery", eyebrow: "Ring 02 · recovery", title: "Work resumes from a valid checkpoint",
    closes: "A crash costs a turn, never the evidence. Recovery starts from the last valid checkpoint rather than from the beginning.",
    hops: [
      ["ledger", "A process dies holding work and leaves an expired lease behind"],
      ["scheduler", "The expired lease is swept, the attempt is retained as history, and the task is re-admitted"],
      ["sources", "The new attempt resumes from the preserved capture instead of re-fetching the source"] ] },
  { id: "refresh", eyebrow: "Ring 03 · recurring refresh", title: "Every obligation comes due again",
    closes: "Currency is a standing obligation, not a one-time task. This is the ring that keeps the record true rather than merely once-true.",
    hops: [
      ["ledger", "The cadence for this record class elapses and the obligation is owed again"],
      ["scheduler", "Least-recently-served ordering gives it a turn without starving anything else"],
      ["acquirers", "A fresh capture is taken and compared against what is already held"],
      ["records", "Changed facts supersede their predecessors; unchanged facts have their currency extended"] ] },
  { id: "questions", eyebrow: "Ring 04 · new questions", title: "Investigation creates its own work",
    closes: "Questions do not accumulate in someone's head. They become work items with the same standing as any other obligation.",
    hops: [
      ["detectives", "An investigation surfaces a question it cannot settle from what is held"],
      ["openq", "The question is preserved with what is known and what remains to investigate"],
      ["scheduler", "It is scheduled as ordinary work, competing for capacity on equal terms"],
      ["acquirers", "Evidence is commissioned wherever the question needs material not yet preserved"] ] },
  { id: "methods", eyebrow: "Ring 05 · method reuse", title: "A route solved once gets cheap platform-wide",
    closes: "Models are paid to discover and to handle exceptions, never to replay a solved procedure.",
    hops: [
      ["scouts", "A route is solved for one government on one platform"],
      ["engineering", "The procedure is proved repeatable and proposed through software review"],
      ["owner", "An owner decision merges it. The system proposes; it never merges itself"],
      ["methods", "Every government on the same platform inherits the deterministic path"],
      ["acquirers", "The next acquisition on that platform runs without model spend"] ] },
];

export const SYSTEM_JOURNEYS: readonly Journey[] = [
  { id: "clean", label: "A record reaches the Reader", title: "A record reaches the Reader",
    blurb: "The straightforward path, with no discovery needed because a proven method already covers this platform. Note that the record skips the capabilities it does not need — scouts and detectives are never called.",
    tracks: [
      { name: "One obligation", status: "runs to a confirmed publication", color: "#00B894",
        steps: [
          { nodeId: "ledger", title: "The obligation comes due", detail: "Its refresh cadence elapses and it rejoins the due set" },
          { nodeId: "scheduler", title: "Capacity is allocated", detail: "Dispatched alongside other independent work in the same turn" },
          { nodeId: "methods", title: "A proven method already covers this platform", detail: "No scout and no detective is called — the record visits only what it needs" },
          { nodeId: "acquirers", title: "The document is retrieved and preserved", detail: "Origin, retrieval time and exact contents kept" },
          { nodeId: "parsers", title: "Records are extracted with their evidence", detail: "Each field points at the passage that supports it" },
          { nodeId: "verifiers", title: "Attribution and correctness check out", detail: "Against the evidence requirements applicable to this record class" },
          { nodeId: "auditors", title: "The set survives an adversarial check", detail: "Completeness and contradictions, with the required controls in place" },
          { nodeId: "standing", title: "Routine publication proceeds", detail: "Inside the standing grant, so no person is waited on" },
          { nodeId: "pipeline", title: "The update goes through the authorized pipeline", detail: "With a retained receipt of exactly what was included" },
          { nodeId: "served", title: "The served result is checked", detail: "Publication is confirmed by reading what the site returns, not by a completed task" },
          { nodeId: "reader", title: "A resident gets a current answer", detail: "With every claim traceable to the preserved document behind it" } ] } ] },
  { id: "blocked", label: "A branch blocks while other work continues", title: "A branch blocks while other work continues",
    blurb: "The same county, the same turn. One refresh fails and parks with its reason; two unrelated branches carry on and one of them publishes. This is the behaviour that makes a blocked branch cheap.",
    tracks: [
      { name: "Branch A · blocked", status: "parks, keeps its reason", color: "#C2554A",
        steps: [
          { nodeId: "acquirers", title: "A refresh fails its currency check", detail: "The newest fetch cannot satisfy integrity, provenance or current-until" },
          { nodeId: "sources", title: "The last good capture is retained", detail: "It keeps serving downstream, with its age reported rather than hidden" },
          { nodeId: "blocked", title: "The branch parks with its reason", detail: "Carrying the specific condition that would release it, and a backoff from its own attempts" },
          { nodeId: "scheduler", title: "It returns to the due set when eligible", detail: "At the position it retained. Nothing else was held up while it waited" } ] },
      { name: "Branch B · continues", status: "investigates in parallel", color: "#4FC9E8",
        steps: [
          { nodeId: "detectives", title: "An unrelated identity question is investigated", detail: "Same county, different record class — completely independent work" },
          { nodeId: "openq", title: "A follow-up question is preserved and queued", detail: "With what is known and what remains to investigate attached" } ] },
      { name: "Branch C · continues", status: "publishes in the same turn", color: "#00B894",
        steps: [
          { nodeId: "parsers", title: "A different record class is extracted", detail: "From a capture already preserved, so nothing is fetched again" },
          { nodeId: "auditors", title: "It survives audit and becomes eligible", detail: "Its own evidence requirements, independent of Branch A" },
          { nodeId: "standing", title: "It publishes under standing authorization", detail: "One parked branch never delays an unrelated publication" } ] } ] },
];

export const SYSTEM_BANDS: Record<BandId, BandMeta> = {
  coord: { num: "01", color: "#A8ABB7", kind: "Coordination", title: "Who coordinates the work",
    note: "Capacity is spread across everything that is due. Nothing starves, and one blocked branch never stops unrelated work.",
    railColor: "#A8ABB7", railLabel: "Dispatch", railNote: "Independent work runs concurrently, within resource and source-access limits. A record is sent only to the capabilities its situation requires." },
  cap: { num: "02", color: "#4FC9E8", kind: "Capability", title: "Reusable capabilities, called as needed",
    note: "Not an assembly line. Any capability can be called at any point, several at once, and a record visits only the ones it needs.",
    railColor: "#4FC9E8", railLabel: "Reads and writes", railNote: "Every capability reads what is already held and writes back what it learns. Nothing already preserved is fetched twice." },
  record: { num: "03", color: "#00B894", kind: "Record", title: "What accumulates, and gets reused",
    note: "Progress is durable. Findings, preserved sources and proven methods are reused; a failure reopens only the affected work.",
    railColor: "#00B894", railLabel: "Validated updates", railNote: "Only records that satisfy the evidence requirements for their class become eligible to publish." },
  pub: { num: "04", color: "#FFB000", kind: "Publication", title: "Publication, and proof it was served",
    note: "Routine updates proceed under standing authorization. Publication is confirmed by checking the served result, not a completed task.",
    railColor: "#B57BFF", railLabel: "Feedback returns", railNote: "Retries, recovery, recurring refreshes and newly discovered questions all re-enter the work queues below." },
};

export const SYSTEM_BAND_ORDER: readonly BandId[] = ["coord", "cap", "record", "pub"];

/** What this map deliberately does NOT show — it belongs to the measured Fleet overlay. */
export const SYSTEM_NOT_SHOWN: readonly OverlayNote[] = [
  { title: "Live status and queue depth", note: "How many items are moving right now, and what each is doing. That is an operational reading and belongs to the Admin fleet overlay." },
  { title: "Freshness and age of the served record", note: "Real currency figures come from reading what is actually served. Where that reading is unavailable, it stays unavailable." },
  { title: "Spending and throughput", note: "Measured cost per turn and per jurisdiction. An unmeasured total is reported as unknown, never rendered as zero." },
  { title: "Which blockers are open today", note: "Actual blocked branches, their reasons and their retry times are supported data. Nothing on this map should be read as a count." },
];

export const nodeById = (id: string): SystemNode | undefined => SYSTEM_NODES.find((n) => n.id === id);
