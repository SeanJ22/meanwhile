/**
 * **THE DELIVERY TRAIL — acquisition → validation → publication → public
 * availability, fleet-wide, with the failures between the stages and the
 * blockers that hold them.** (MW-053, MW-054.)
 *
 * The promotion pipeline records each item's furthest stage
 * (SCOUTED → CONFIRMED → VERIFIED → AUDITED → APPROVED_FOR_PROMOTION) and every
 * refused transition. That has always existed PER ITEM; what did not is a
 * FLEET-WIDE rollup a reader can see, folded to the four stages the owner
 * thinks in, with the between-stage failures counted by the transition they
 * refused and the blockers that keep a stage at zero NAMED rather than hidden.
 *
 * Honest by construction. Every stage count is `reached ≥ this stage` out of
 * the same denominator (all items), carried as a `Measured` so the render
 * audits it. A stage with no producer — public availability has no
 * served-reader witness wired yet — reads as its named gap, never a 0 that
 * looks like a measurement; and publication reads its real count beside the
 * blocker (the activation gate) that keeps it there. Pure over the pipeline
 * states: reads no clock and no store.
 */
import {
  gap,
  held,
  measured,
  type Held,
  type Measured,
  type RenderedNumber,
} from "./owner-surface.ts";
import { formatEastern } from "./eastern-time.ts";
import { latestServedObservation, servedWitness, SERVED_READER_MAX_AGE_MS, type ServedReaderReadback } from "./served-reader.ts";
import { stageCounts, type StageCounts } from "./promotion/pipeline.ts";
import {
  PIPELINE_STAGES,
  PRECEDING_STAGE,
  type ActivationGateReading,
  type PipelineItemState,
  type PipelineStage,
  type RefusedRecord,
} from "./promotion/types.ts";

export const DELIVERY_TRAIL_VERSION = "delivery-trail/v1";

export type DeliveryStageKey = "acquisition" | "validation" | "publication" | "publicly_available";

export interface DeliveryStageRow {
  readonly key: DeliveryStageKey;
  readonly label: string;
  /** The pipeline stage that anchors this owner stage, or "SERVED" for the last. */
  readonly anchor: PipelineStage | "SERVED";
  /**
   * Items that reached at least this stage, out of every item. A named gap
   * when there are no items yet, or — for public availability — when no
   * served-reader producer is wired, so the reader never sees a 0 that looks
   * like measured non-delivery.
   */
  readonly reached: Held<Measured>;
  readonly note: string;
}

export interface BetweenStageFailure {
  /** "SCOUTED → CONFIRMED", etc.: the transition that was refused. */
  readonly transition: string;
  readonly atStage: PipelineStage;
  readonly refusals: number;
  readonly topReasons: readonly { readonly code: string; readonly count: number }[];
}

export interface DeliveryBlocker {
  readonly what: string;
  readonly says: string;
}

/**
 * MW-053 / MW-054: one approved record's complete history — what changed, its
 * evidence, time, version and destination.
 *
 * The time is when the pipeline APPROVED it for promotion (its last stage),
 * not when a reader could first see it: nothing records a pipeline item
 * reaching readers yet. Snapshots published before 2026-09-25 carry the same
 * instant as `promotedAt`, a name that overstated it; they stay readable, and
 * the card labels either one as the approval time.
 */
export interface DeliveryPromotionRow {
  readonly subjectId: string | null;
  readonly recordClass: string;
  readonly evidenceChain: {
    readonly scouted: string;
    readonly confirmed: string;
    readonly verified: string;
    readonly audited?: string;
  };
  /** When the record was approved for promotion. Absent only on snapshots published before it was named truthfully. */
  readonly approvedAt?: string;
  /** The approval time under its old name, on snapshots published before 2026-09-25. Never written now. */
  readonly promotedAt?: string;
  /** What the record changed or adds, from its own pipeline records. Absent on snapshots published before it. */
  readonly changeSummary?: string;
  readonly version: string;
  readonly destination: string;
  readonly checkedAt: string | null;
}

const CHANGE_SUMMARY_MAX = 240;

/**
 * What an approved record changes, from its pipeline records: the kind of
 * fact (a meeting time, an agenda, a way in, a method, a record a Scout found)
 * from the SCOUTED source, its own summary and URL, and the fact a second
 * acquisition confirmed when the CONFIRMED record names one. Never invented:
 * an item without a SCOUTED record says so.
 */
export function promotionChangeSummary(state: PipelineItemState): string {
  const approved = state.byStage.APPROVED_FOR_PROMOTION;
  if (approved?.recordClass === "candidate-enrichment" && approved.field === "campaignSite") {
    const site = (approved as typeof approved & { campaignSite?: { url?: unknown } }).campaignSite;
    const url = typeof site?.url === "string" ? site.url : "URL not recorded";
    return `Verified campaign-site link: ${url}. This approval does not verify biography, positions or other claims in the discovery lead. Public delivery requires the separate reader readback.`;
  }
  const scouted = state.byStage.SCOUTED;
  if (scouted === undefined) return "What changed is not recorded: the item holds no SCOUTED record.";
  const src = scouted.source;
  const what =
    src.kind === "FLEET_EXTRACTION"
      ? `${src.factKey.includes("#agenda@") ? "An agenda" : "A meeting time"} (${src.factKey}) from ${src.sourceKey}, for ${formatEastern(src.applicableAt, { year: true })}`
      : src.kind === "SCOUT_RESULT"
        ? src.outcome === "ROUTE_CANDIDATE"
          ? `A way in, route ${src.routeId ?? "unnamed"}`
          : "The record itself, found by a Scout"
        : src.kind === "DISCOVERY_POINTER"
          ? `A lead from a search index (route ${src.routeId}, result ${src.rank}), read at ${src.pointerUrl}`
          : `A method, route ${src.routeId} (${src.lifecycle.toLowerCase()})`;
  const fact = state.byStage.CONFIRMED?.sameFact ?? null;
  const text = `${what}: ${scouted.summary}${scouted.canonicalUrl ? ` <${scouted.canonicalUrl}>` : ""}${fact ? `; the confirming read states ${fact}` : ""}`;
  return text.length <= CHANGE_SUMMARY_MAX ? text : `${text.slice(0, CHANGE_SUMMARY_MAX - 1)}…`;
}

export interface DeliveryTrailView {
  /** Absent on older snapshots; every pending item is retained, never sampled. */
  readonly pending?: readonly DeliveryPendingRow[];
  readonly version: typeof DELIVERY_TRAIL_VERSION;
  readonly items: number;
  readonly stages: readonly DeliveryStageRow[];
  readonly byRecordClass: StageCounts["byRecordClass"];
  readonly betweenFailures: readonly BetweenStageFailure[];
  readonly blockers: readonly DeliveryBlocker[];
  readonly costs: {
    readonly measuredUsd: number | null;
    readonly attemptsMeasured: number;
    readonly costPerVerifiedRecord: Held<Measured>;
  };
  readonly promotions: readonly DeliveryPromotionRow[];
  readonly servedReader: { readonly state: "NO_PRODUCER" | "OBSERVED"; readonly says: string };
}

export interface DeliveryPendingRow {
  readonly itemId: string;
  readonly subjectId: string | null;
  readonly recordClass: string | null;
  readonly stage: PipelineStage | null;
  readonly blocker: string;
  readonly correctiveAction: string;
  readonly outcome: string;
  readonly lastRefusal: string | null;
}

export function pendingDelivery(state: PipelineItemState): DeliveryPendingRow | null {
  if (state.byStage.APPROVED_FOR_PROMOTION) return null;
  const next = PIPELINE_STAGES[(state.stage === null ? -1 : PIPELINE_STAGES.indexOf(state.stage)) + 1];
  const last = state.records.filter((record): record is RefusedRecord => record.stage === "REFUSED").at(-1);
  const activeRefusal = last && PIPELINE_STAGES.indexOf(last.atStage) > (state.stage === null ? -1 : PIPELINE_STAGES.indexOf(state.stage));
  const reasons = last?.reasons.map(reason => `${reason.code}: ${reason.detail}`).join("; ") ?? null;
  const source = state.byStage.SCOUTED?.source;
  const method = source?.kind === "METHOD_CANDIDATE";
  return {
    itemId: state.itemId, subjectId: state.subjectId, recordClass: state.recordClass, stage: state.stage,
    blocker: activeRefusal ? reasons! : `Required ${next ?? "approval"} evidence has not been accepted.`,
    correctiveAction: method
      ? "This is a reusable acquisition method, not a civic claim. Its method-store lifecycle governs worker reuse; it must not be published as a fact."
      : state.recordClass === "candidate-enrichment"
        ? "The standing campaign-site verifier revisits held leads, reuses vaulted reads and acquires missing confirmation. Only campaign-site findings use this connection; other candidate fields still need their own verified reader connection."
        : source?.kind === "FLEET_EXTRACTION"
          ? "The worker's typed fact contract determines its verification and reader connection. A missing contract check remains a repair obligation, never a successful verification."
          : "Resolve the named source or verification failure through the item's existing worker contract. A missing publication connection remains an implementation defect.",
    outcome: `Verification incomplete; ${state.stage ?? "no accepted stage"} is the last accepted pipeline stage. No public delivery is established by this record.`,
    lastRefusal: reasons,
  };
}

export interface DeliveryTrailInput {
  readonly activation: ActivationGateReading;
  /** The served-reader readback, when a producer is wired. Null = no producer yet (the witness bridge). */
  readonly servedReader: ServedReaderReadback | null;
  readonly now?: string;
  readonly costSummary: { readonly measuredUsd: number | null; readonly attemptsMeasured: number } | null;
  readonly costPerVerifiedRecord: Held<Measured>;
}

const stageIndex = (stage: PipelineStage): number => PIPELINE_STAGES.indexOf(stage);

/** Items whose furthest accepted stage is at least `stage`. */
function reachedAtLeast(states: readonly PipelineItemState[], stage: PipelineStage): number {
  const min = stageIndex(stage);
  return states.filter((s) => s.stage !== null && stageIndex(s.stage) >= min).length;
}

export function buildDeliveryTrail(
  states: readonly PipelineItemState[],
  input: DeliveryTrailInput,
): DeliveryTrailView {
  const items = states.length;
  const readAt = input.now ?? input.servedReader?.checkedAt ?? "";
  const witnessed = new Map(states.flatMap(s => {
    const approval = s.byStage.APPROVED_FOR_PROMOTION;
    const witness = approval ? servedWitness(input.servedReader, s.itemId, approval.recordId, readAt) : null;
    return witness ? [[s.itemId, witness] as const] : [];
  }));
  const source = "cp_log_promotion_pipeline via deriveItemState, over every pipeline item";
  const reachedRow = (stage: PipelineStage, contract: string): Held<Measured> =>
    items === 0
      ? gap<Measured>("OURS", "no records have entered the promotion pipeline yet.")
      : held(measured(reachedAtLeast(states, stage), items, contract, source));

  const stages: DeliveryStageRow[] = [
    {
      key: "acquisition",
      label: "Acquired",
      anchor: "SCOUTED",
      reached: reachedRow("SCOUTED", "records for which a source was acquired (reached SCOUTED or beyond)"),
      note: `${items === 0 ? 0 : reachedAtLeast(states, "CONFIRMED")} were confirmed by a second, independent acquisition (CONFIRMED).`,
    },
    {
      key: "validation",
      label: "Validation stage passed",
      anchor: "VERIFIED",
      reached: reachedRow("VERIFIED", "records that passed the five validation-stage checks; audit and publication checks may still remain"),
      note: `${items === 0 ? 0 : reachedAtLeast(states, "AUDITED")} also passed adversarial audit. This stage alone does not establish complete verification or public delivery.`,
    },
    {
      key: "publication",
      label: "Approved for promotion",
      anchor: "APPROVED_FOR_PROMOTION",
      reached: reachedRow("APPROVED_FOR_PROMOTION", "records approved for promotion"),
      note: input.activation.promotionEnabled
        ? "the activation gate is open."
        : "the activation gate is OFF — nothing promotes to readers until it opens; see blockers.",
    },
    {
      key: "publicly_available",
      label: "Publicly available (served to a reader)",
      anchor: "SERVED",
      reached:
        input.servedReader === null
          ? gap<Measured>(
              "OURS",
              "no served-reader readback producer is wired yet (the witness bridge), so public availability cannot be observed — this is our gap, not measured zero delivery.",
            )
          : items === 0
            ? gap<Measured>("OURS", "no records have entered the promotion pipeline yet.")
            : held(
                measured(
                  witnessed.size,
                  items,
                  "records confirmed on a public reader page by readback",
                  `served-reader readback checked ${input.servedReader.checkedAt}`,
                ),
              ),
      note: "a record is publicly available only when a reader-page readback confirms it.",
    },
  ];

  // Between-stage failures: bucket every refused transition by the stage it was offered into.
  const refusalCount = new Map<PipelineStage, number>();
  const reasonTally = new Map<PipelineStage, Map<string, number>>();
  for (const s of states) {
    for (const r of s.records) {
      if (r.stage !== "REFUSED") continue;
      const refused = r as RefusedRecord;
      refusalCount.set(refused.atStage, (refusalCount.get(refused.atStage) ?? 0) + 1);
      const tally = reasonTally.get(refused.atStage) ?? new Map<string, number>();
      for (const reason of refused.reasons) tally.set(reason.code, (tally.get(reason.code) ?? 0) + 1);
      reasonTally.set(refused.atStage, tally);
    }
  }
  const betweenFailures: BetweenStageFailure[] = PIPELINE_STAGES.filter(
    (stage) => (refusalCount.get(stage) ?? 0) > 0,
  ).map((stage) => ({
    transition: `${PRECEDING_STAGE[stage] ?? "start"} → ${stage}`,
    atStage: stage,
    refusals: refusalCount.get(stage) ?? 0,
    topReasons: [...(reasonTally.get(stage) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([code, count]) => ({ code, count })),
  }));

  const blockers: DeliveryBlocker[] = [];
  if (!input.activation.promotionEnabled) {
    blockers.push({ what: "Activation gate (publication)", says: input.activation.reason });
  }
  if (input.servedReader === null) {
    blockers.push({
      what: "Served-reader witness (public availability)",
      says:
        "No served-reader readback producer is wired yet. Until a readback confirms a promoted record on a reader page, public availability stays a named gap, not a measured zero.",
    });
  }
  for (const error of input.servedReader?.errors ?? []) blockers.push({ what: "Public readback", says: error });

  const promotions: DeliveryPromotionRow[] = [];
  for (const s of states) {
    const approved = s.byStage.APPROVED_FOR_PROMOTION;
    if (!approved) continue;
    const observed = latestServedObservation(input.servedReader, s.itemId, approved.recordId);
    const observationAge = observed ? Date.parse(readAt) - Date.parse(observed.checkedAt) : NaN;
    const stale = observed !== null && !(observationAge >= 0 && observationAge <= SERVED_READER_MAX_AGE_MS);
    promotions.push({
      subjectId: s.subjectId,
      recordClass: approved.recordClass,
      evidenceChain: approved.chain,
      /* The APPROVED_FOR_PROMOTION record's own time: approval, not reader visibility (MW-053). */
      approvedAt: approved.at,
      changeSummary: promotionChangeSummary(s),
      version: approved.recordId,
      destination: witnessed.get(s.itemId)?.url ?? (observed
        ? `NOT_OBSERVED${stale ? " (stale readback)" : ""} — ${observed.reason}`
        : "NOT_OBSERVED — no public readback recorded for this exact approval"),
      checkedAt: witnessed.get(s.itemId)?.checkedAt ?? observed?.checkedAt ?? null,
    });
  }

  return {
    version: DELIVERY_TRAIL_VERSION,
    pending: states.flatMap(state => { const row = pendingDelivery(state); return row ? [row] : []; }),
    items,
    stages,
    byRecordClass: stageCounts(states).byRecordClass,
    betweenFailures,
    blockers,
    costs: {
      measuredUsd: input.costSummary?.measuredUsd ?? null,
      attemptsMeasured: input.costSummary?.attemptsMeasured ?? 0,
      costPerVerifiedRecord: input.costPerVerifiedRecord,
    },
    promotions,
    servedReader:
      input.servedReader === null
        ? { state: "NO_PRODUCER", says: "No served-reader readback producer is wired (the witness bridge)." }
        : { state: "OBSERVED", says: `${witnessed.size} exact approvals confirmed on public pages. Checked ${input.servedReader.checkedAt}; other items remain unconfirmed. Witnesses expire after three hours.` },
  };
}

/** The stage counts the trail draws itself, for the render's number audit (RULING 254). */
export function deliveryTrailRenderedNumbers(view: DeliveryTrailView): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  for (const stage of view.stages) {
    if (stage.reached.held) {
      out.push({
        label: `delivery trail · ${stage.label}`,
        value: stage.reached.value.value,
        denominator: stage.reached.value.denominator,
        contract: stage.reached.value.contract,
      });
    }
  }
  return out;
}
