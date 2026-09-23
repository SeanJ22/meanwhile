/**
 * **THE FIX LIST — what the owner cannot do today, written as what he would
 * be able to do.** (Admin redesign, 2026-09-23 — Fleet · Fix list and
 * Readiness · Fix list.)
 *
 * The design package's MW items, in its order, each with the status it has
 * against CURRENT code rather than the status the package drew. Where the
 * package's own words had gone stale they are corrected here, never repeated:
 * the in-app ceiling is the owner's dial, not "$25 a day"; Opus is a guarded
 * ceiling, not an observation; the routing call is `assertStepMayInvokeModel`;
 * the evidence folders it named are not in this repository.
 *
 * Statuses were checked on 2026-09-23 against main and the running system;
 * `docs/meanwhile-admin-requirements.md` carries the evidence for the ones
 * that did not move, and `standing` says what moved and where.
 *
 * PURE. Data, and the ordering the marks produce.
 */

export type FixStatus = "NEEDS NEW RECORDING" | "DATA EXISTS, NOT JOINED UP" | "PARTLY IN PLACE" | "IN PLACE";
export type FixMark = "MUST" | "LATER" | "NOT_NOW";

export interface FixItem {
  readonly id: string;
  /** What the owner would be able to do. */
  readonly title: string;
  readonly status: FixStatus;
  readonly body: string;
  readonly checkFirst: string;
  /** What is true today, verified — the reason for the status. */
  readonly standing: string;
  /** Where the item came from in the owner's earlier lists. */
  readonly provenance: string;
  readonly defaultMark: FixMark;
}

export const FIX_ITEMS: readonly FixItem[] = [
  {
    id: "MW-012",
    title: "Tell a changed record from an unchanged one",
    status: "PARTLY IN PLACE",
    body: "Re-reading a source must record whether what it found differed. Without it, three of the six standing questions cannot be answered for a body, and money spent re-finding what we already hold is invisible.",
    checkFirst: "the routine data plane already records a change set on every promotion — added, changed, removed and held records. Extend that, rather than fingerprinting again.",
    standing: "In place for routine meeting reads: every promoted version carries its change set, and Fleet · Now counts from it. Not yet for paid research, and some routine re-reads still count unchanged content re-read under a new key as changed.",
    provenance: "was f2 · x2",
    defaultMark: "MUST",
  },
  {
    id: "MW-013",
    title: "See what the money actually bought",
    status: "NEEDS NEW RECORDING",
    body: "Charges record the role and the job, never what the work was for. So no cost can be attributed to a purpose, a district, a body or an assignment after the fact.",
    checkFirst: "the step registry already names every kind of step, and every paid Scout result already records what it produced; a purpose may be derivable before adding a field.",
    standing: "Money · Cost of work now splits paid spend by what each attempt itself recorded it produced, which agrees with the ledger to the cent. The charge still does not say what the work was for.",
    provenance: "was f3 · x11 · RDY-5",
    defaultMark: "MUST",
  },
  {
    id: "MW-021",
    title: "Set a budget on one assignment and have the runner honour it",
    status: "PARTLY IN PLACE",
    body: "A budget must show spent, held for work in flight and left — and stop that assignment only.",
    checkFirst: "fleet-safety.ts already holds back worst-case cost per job and releases it on settle; the geography budget below reuses that. Extend it to an assignment rather than build a second ledger.",
    standing: "A budget per geography is enforced: before every paid Scout the runner checks the geography's rolling 24-hour spend plus one worst case, and holds the work if it would exceed it. A budget per assignment does not exist.",
    provenance: "was f8 · x6 · RDY-6",
    defaultMark: "MUST",
  },
  {
    id: "MW-001",
    title: "Follow one assignment from your words to what a reader can see",
    status: "DATA EXISTS, NOT JOINED UP",
    body: "Every piece exists, but an instruction of yours is not yet a thing every piece of work it causes hangs off. This is the spine the acceptance demonstration runs along.",
    checkFirst: "the published assignment view already gives every unit of work an id and its full chain; a geography you select is recorded with its receipt. The missing link is the instruction id on the work it moves.",
    standing: "Fleet · Work shows your geographies with the runner's acknowledgement, and every assignment's chain opens by id. The two are joined by place, not by an id carried through.",
    provenance: "was f9 · x7 · RDY-2",
    defaultMark: "MUST",
  },
  {
    id: "MW-031",
    title: "See the cheapest suitable model tried first, and why anything went higher",
    status: "NEEDS NEW RECORDING",
    body: "Each step names its cheapest class and its escalation target, and the ladder tops out at the frontier. What is missing is the evidence that triggered a move up, and the combined cost of both attempts.",
    checkFirst: "assertStepMayInvokeModel(step, escalated) takes escalation as a yes-or-no, so the reason cannot be persisted by that call. Keep it with the model attempt and its charge, not with the owner's escalations.",
    standing: "The ladder has never moved: every production call runs its step's base class, and the Scout loop and the audit start at the frontier by design. Nothing records a reason, because nothing has escalated.",
    provenance: "was f16 · x10",
    defaultMark: "MUST",
  },
  {
    id: "MW-032",
    title: "Tell which model is actually better, not just cheaper",
    status: "DATA EXISTS, NOT JOINED UP",
    body: "Price alone ranks models in the wrong order. Comparable tasks against a known-answer corpus, reporting correct, missed, unsupported claims, failures, retries, time and total cost. Cheap but incorrect is not success.",
    checkFirst: "lib/ask/model-comparison.ts already runs a two-arm comparison with a comparability guard and cold pricing.",
    standing: "One comparison ran on 2026-09-23 for the reader's Ask: $1.00, a verdict of not measured because three questions returned no evidence on either arm. The fleet's own models have not been compared.",
    provenance: "was f12 · x14 — you had marked this Later",
    defaultMark: "MUST",
  },
  {
    id: "MW-014",
    title: "Know why work was skipped",
    status: "NEEDS NEW RECORDING",
    body: "Explained reasons must sum to the skipped count, and a mismatch must surface as a mismatch rather than as a zero.",
    checkFirst: "the second queue records its own skip reason; the report does not read it.",
    standing: "Unchanged since it was verified on 2026-09-21.",
    provenance: "was f4",
    defaultMark: "MUST",
  },
  {
    id: "MW-015",
    title: "Know an assignment is not finished just because every body was visited",
    status: "NEEDS NEW RECORDING",
    body: "Refusals and unresolved questions live on individual attempts, so an assignment whose bodies were all visited can look complete while records remain refused. Visited is never shown as finished.",
    checkFirst: "refusal reasons are already typed; this needs a rollup to the assignment plus a completion rule.",
    standing: "Unchanged since it was verified on 2026-09-21.",
    provenance: "was f15 · x5",
    defaultMark: "MUST",
  },
  {
    id: "MW-016",
    title: "Never see an unexplained dead end",
    status: "NEEDS NEW RECORDING",
    body: "Work that ends without an answer must record what it ruled out, what would settle it and who moves next — and may not be marked finished without all three.",
    checkFirst: "failure reasons are already typed; check how much of the three-part shape can be derived before requiring new input.",
    standing: "Every screen now shows the three parts and names any that is missing as a gap marked MW-016. Routine reads derive all three from the check and its schedule; other work records them only in part.",
    provenance: "was f5-adjacent · x5",
    defaultMark: "MUST",
  },
  {
    id: "MW-041",
    title: "See every provider's spend in one place",
    status: "PARTLY IN PLACE",
    body: "Each provider needs its own reading with billing period, where it came from and when — and the three kinds of ceiling are never added together.",
    checkFirst: "whether any credential the system already holds carries a billing scope. Do not invent a billing API.",
    standing: "Money lists every provider with its kind, period and how it is read, and you can enter or import any bill the system cannot read. No provider's bill is read automatically: none of the credentials held carries billing access.",
    provenance: "new — from the combined brief",
    defaultMark: "MUST",
  },
  {
    id: "MW-042",
    title: "Separate credits bought from usage consumed",
    status: "PARTLY IN PLACE",
    body: "A credit purchased and a credit consumed are two different facts, and adding a provider bill to a usage estimate for the same period double-counts. Estimated, billed and unattributed amounts each need their own slot.",
    checkFirst: "nothing in the charge ledger distinguishes a prepaid balance from consumption; this is a new kind of entry, not a join.",
    standing: "Money records a balance, a purchase, a month-to-date figure and a final bill as separate kinds, and never adds them to the measured ledger. Consumption against a balance is not read.",
    provenance: "new — from the combined brief",
    defaultMark: "MUST",
  },
  {
    id: "MW-022",
    title: "Narrow every reading to one state, district or code",
    status: "PARTLY IN PLACE",
    body: "Every panel the scope cannot narrow must say so rather than show a national figure under a local label.",
    checkFirst: "paid results name the state of their subject; bodies carry their division. Start there rather than tagging every charge.",
    standing: "Bodies, readiness and paid spend narrow to a state; bodies and readiness narrow to a county or district through the Census lookup. Charges by model, bills and decisions do not narrow, and each says so.",
    provenance: "was f6 · x13 — you had marked this Later",
    defaultMark: "MUST",
  },
  {
    id: "MW-023",
    title: "Compare one period against another",
    status: "NEEDS NEW RECORDING",
    body: "A selector showing 24-hour numbers under a 30-day label would be exactly the defect this design exists to remove — and scaling an example day up to a year is the same error with arithmetic on top.",
    checkFirst: "the run window is the fixed part. Persisting per-day rollups is cheaper than re-deriving history.",
    standing: "Each figure names its own window: the UTC month for the ledger, a rolling 24 hours for the ceiling and the routine reads. No two periods can be compared side by side.",
    provenance: "was f7 — you had marked this Later",
    defaultMark: "MUST",
  },
  {
    id: "MW-024",
    title: "Keep test runs out of the real numbers",
    status: "PARTLY IN PLACE",
    body: "Test spend stays in actual expenditure and inside the safety ceilings — it is real money — while being excluded from production productivity statistics.",
    checkFirst: "proof runs already have their own lane in the assignment view.",
    standing: "Proof and test assignments are counted in their own lane. Their dollars are inside the spend totals and are not yet separated from them.",
    provenance: "was f13 — you had marked this Later",
    defaultMark: "MUST",
  },
  {
    id: "MW-025",
    title: "See exactly what a worker was given, and whether it used it",
    status: "DATA EXISTS, NOT JOINED UP",
    body: "It must be the exact text supplied at dispatch, never a later reconstruction, and it must show whether the worker used it.",
    checkFirst: "since 2026-09-19 every Scout result records the field-manual entries and lines handed to it at dispatch.",
    standing: "What a Scout was handed is recorded on its result; whether it used each line is not.",
    provenance: "was f14 — you had marked this Later",
    defaultMark: "MUST",
  },
  {
    id: "MW-027",
    title: "Measure whether the system is learning",
    status: "NEEDS NEW RECORDING",
    body: "Ways in learned once then walked free, improvement after failure, blockages clearing themselves, cost per record over time, escalation over time, difficult bodies becoming routine. All six behaviours are real and none is measured over time.",
    checkFirst: "route reuse is already recorded per Scout walk. Six trends over time, not six new subsystems.",
    standing: "Is it learning shows what is recorded for each question today. None is a trend yet.",
    provenance: "was f-learning · x9",
    defaultMark: "MUST",
  },
  {
    id: "MW-034",
    title: "Guarantee the model ceiling rather than merely observing it",
    status: "IN PLACE",
    body: "The frontier class is the most any step may use, and no model named Fable may route.",
    checkFirst: "model-routing.ts: the ceiling check runs when the code loads.",
    standing: "Done: a routing edit that points any class above the ceiling, at an unpriced model or at a Fable fails when the code loads, in tests and at boot.",
    provenance: "new — from the combined brief",
    defaultMark: "MUST",
  },
  {
    id: "MW-011",
    title: "See whether anything actually reached the public site",
    status: "PARTLY IN PLACE",
    body: "The system must connect a promoted record to the page a reader opens. An empty box there means unknown, and must never be read as nothing reached anyone.",
    checkFirst: "the routine data plane already reads back each promoted meeting version through the reader's own projection.",
    standing: "In place for routine meetings: each promoted version is read back through the reader's projection and the result is recorded. Paid research does not reach readers at all while promotion is off.",
    provenance: "was f1 · x8 · RDY-1",
    defaultMark: "LATER",
  },
];

export const FIX_STATUS_TONE: Readonly<Record<FixStatus, "gold" | "amber" | "cyan" | "teal">> = {
  "NEEDS NEW RECORDING": "gold",
  "DATA EXISTS, NOT JOINED UP": "amber",
  "PARTLY IN PLACE": "cyan",
  "IN PLACE": "teal",
};

const MARK_RANK: Readonly<Record<FixMark, number>> = { MUST: 0, LATER: 1, NOT_NOW: 2 };

/** The work order the marks produce: Must have, then Later, then Not now, each in the list's own order. */
export function orderByMarks(items: readonly FixItem[], marks: Readonly<Record<string, FixMark>>): FixItem[] {
  return items
    .map((item, i) => ({ item, i, rank: MARK_RANK[marks[item.id] ?? item.defaultMark] }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.item);
}

/** What the fix queue records for one item, so the same item queued twice is one queued item. */
export function fixQueueText(item: Pick<FixItem, "id" | "title">): { readonly where: string; readonly says: string } {
  return { where: "Fix list", says: `${item.id} — ${item.title}` };
}
