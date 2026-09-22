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

/** MW-054: one promoted record's complete history — evidence, time, version, destination. */
export interface DeliveryPromotionRow {
  readonly subjectId: string | null;
  readonly recordClass: string;
  readonly evidenceChain: {
    readonly scouted: string;
    readonly confirmed: string;
    readonly verified: string;
    readonly audited: string;
  };
  readonly promotedAt: string;
  readonly version: string;
  readonly destination: string;
  readonly checkedAt: string | null;
}

export interface DeliveryTrailView {
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

export interface DeliveryTrailInput {
  readonly activation: ActivationGateReading;
  /** The served-reader readback, when a producer is wired. Null = no producer yet (the witness bridge). */
  readonly servedReader: { readonly count: number; readonly checkedAt: string } | null;
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
      label: "Validated",
      anchor: "VERIFIED",
      reached: reachedRow("VERIFIED", "records independently verified (reached VERIFIED or beyond)"),
      note: `${items === 0 ? 0 : reachedAtLeast(states, "AUDITED")} also survived the adversarial audit (AUDITED).`,
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
                  Math.min(input.servedReader.count, items),
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

  const promotions: DeliveryPromotionRow[] = [];
  for (const s of states) {
    const approved = s.byStage.APPROVED_FOR_PROMOTION;
    if (!approved) continue;
    promotions.push({
      subjectId: s.subjectId,
      recordClass: approved.recordClass,
      evidenceChain: approved.chain,
      promotedAt: approved.at,
      version: approved.recordId,
      destination:
        input.servedReader === null
          ? "NOT_OBSERVED — no served-reader readback producer wired"
          : "reader page (see served-reader readback)",
      checkedAt: input.servedReader?.checkedAt ?? null,
    });
  }

  return {
    version: DELIVERY_TRAIL_VERSION,
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
        : { state: "OBSERVED", says: `Served-reader readback checked ${input.servedReader.checkedAt}.` },
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
