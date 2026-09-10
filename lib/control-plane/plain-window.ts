/**
 * **THE NIGHTLY WINDOW IN ONE LINE, THEN A PICTURE.** (ADM-13, the 9.4.26
 * evening admin feedback.)
 *
 * The owner's words about the window block: *"it's too overwhelming, turn it
 * into English, not this random text."* The data behind the block is right and
 * every number carries its denominator (RULING 159); the defect is that
 * twenty-five sentences were doing the job of one sentence and one picture.
 *
 * This module derives, from the already-audited `WindowView`:
 *
 *   headline    one sentence — ran when, in what mode, stages, what was
 *               promoted and why not, incidents
 *   stages      the four stage names with a pass/fail/unknown mark, for a strip
 *   split       promoted / would promote / refused / deferred over the item
 *               count, for one bar
 *   classes     one compact row per record class, counts not sentences
 *
 * PURE: the view in, the projection out. Nothing here re-reads a store, and no
 * number is computed that the view did not already carry with its denominator.
 */
import { formatEastern, formatEasternDate } from "./eastern-time.ts";
import type { WindowView } from "./window-view.ts";

export interface StageMark {
  readonly stage: string;
  /** The stage name in words. */
  readonly label: string;
  readonly outcome: string;
  readonly ok: boolean | null;
  readonly reason: string | null;
}

export interface PlainWindow {
  readonly headline: string;
  readonly stages: readonly StageMark[];
  readonly split: {
    readonly items: number;
    readonly promoted: number;
    readonly wouldPromote: number;
    readonly refused: number;
    readonly deferred: number;
  } | null;
  readonly classes: readonly {
    readonly recordClass: string;
    readonly label: string;
    readonly items: number;
    readonly wouldPromote: number;
    readonly refused: number;
    readonly deferred: number;
  }[];
}

const STAGE_LABEL: Record<string, string> = {
  PIPELINE_EVALUATION: "Evaluate",
  DIGEST: "Digest",
};

/** `OFFICIAL_MEETING_DOCUMENT_INVENTORY` → "official meeting document inventory". */
export function recordClassLabel(recordClass: string): string {
  return recordClass.replace(/[_-]+/g, " ").toLowerCase();
}

function stageMark(s: { readonly stage: string; readonly outcome: string; readonly reason?: string | null }): StageMark {
  const ok = s.outcome === "COMPLETED" ? true : s.outcome === "FAILED" ? false : null;
  return {
    stage: s.stage,
    label: STAGE_LABEL[s.stage] ?? recordClassLabel(s.stage),
    outcome: s.outcome,
    ok,
    reason: s.reason ?? null,
  };
}

export function plainWindow(view: WindowView): PlainWindow {
  if (!view.time.held) {
    return {
      headline:
        view.verdict === "UNREACHABLE"
          ? `The nightly window could not be read: ${view.reasons[0] ?? "the control plane did not answer"}.`
          : "The nightly window has never run yet, so there is nothing to report from it.",
      stages: [],
      split: null,
      classes: [],
    };
  }
  const t = view.time.value;
  const stages = view.stages.held ? view.stages.value.map(stageMark) : [];
  const failed = stages.filter((s) => s.ok === false);
  const completed = stages.filter((s) => s.ok === true);

  const onTime = (() => {
    const scheduled = Date.parse(t.scheduledFor);
    const started = Date.parse(t.startedAt);
    if (!Number.isFinite(scheduled) || !Number.isFinite(started)) return "ran";
    const lateMin = Math.round((started - scheduled) / 60_000);
    return lateMin <= 15 ? "ran on time" : `ran ${lateMin} minutes late`;
  })();

  const mode = t.mode === "SHADOW" ? "in shadow mode (nothing reaches readers yet)" : `in ${t.mode.toLowerCase()} mode`;

  const stageSentence =
    stages.length === 0
      ? "no stage record"
      : failed.length === 0
        ? `all ${stages.length} stages completed`
        : `${failed.map((s) => s.label).join(" and ")} failed, ${completed.length} of ${stages.length} stages completed`;

  const split = view.promoted.held && view.wouldPromote.held && view.refused.held && view.deferred.held
    ? {
        items: view.promoted.value.denominator,
        promoted: view.promoted.value.value,
        wouldPromote: view.wouldPromote.value.value,
        refused: view.refused.value.value,
        deferred: view.deferred.value.value,
      }
    : null;

  const promotionSentence = (() => {
    if (split === null) return "the pipeline held no item to promote or refuse";
    if (split.promoted > 0) return `${split.promoted} of ${split.items} items were promoted to readers`;
    const gateClosed = view.gate.held && /NOT_READY|promotion OFF|SHADOW/i.test(view.gate.value.reason);
    const why = gateClosed
      ? "because the gate is closed (reader, truth and freshness are not yet independently proven)"
      : "";
    const parts: string[] = [];
    if (split.refused > 0) parts.push(`${split.refused} refused`);
    if (split.deferred > 0) parts.push(`${split.deferred} deferred`);
    if (split.wouldPromote > 0) parts.push(`${split.wouldPromote} would have been promoted had the gate been open`);
    return `nothing was promoted ${why}`.trim() + (parts.length > 0 ? ` — of ${split.items} items, ${parts.join(", ")}` : "");
  })();

  const incidents = view.incidents.held ? view.incidents.value.shown.denominator : null;
  const incidentSentence = incidents === null ? "incidents unread" : incidents === 0 ? "no incidents" : `${incidents} incident${incidents === 1 ? "" : "s"} opened`;

  const headline =
    `The window for ${formatEasternDate(t.startedAt)} ${onTime} at ${formatEastern(t.startedAt)} ${mode}; ` +
    `${stageSentence}; ${promotionSentence}; ${incidentSentence}.`;

  const classes = view.byRecordClass.held
    ? view.byRecordClass.value.map((row) => ({
        recordClass: row.recordClass,
        label: recordClassLabel(row.recordClass),
        items: row.promoteWould.denominator,
        wouldPromote: row.promoteWould.value,
        refused: row.refuseWould.value,
        deferred: row.deferred.value,
      }))
    : [];

  return { headline, stages, split, classes };
}
