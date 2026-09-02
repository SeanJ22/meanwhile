/**
 * THE LAST-WINDOW VIEW — what the admin page reads about the nightly door.
 * (RULING 242.)
 *
 * Server-side reads over the control plane, each answering HELD /
 * NOT_RECORDED / STORE_UNREACHABLE exactly as `research-view.ts` does, and
 * ONE pure function that turns those answers into what the panel renders.
 *
 *   THE VERDICT IS DERIVED     from the stage records of the newest window;
 *                              no verdict is stored
 *   EVERY NUMBER IS MEASURED   a `Measured` with its denominator, or a `Gap`
 *                              that says whose gap it is
 *   A FAILED READ IS NAMED     an unreachable store reads UNREACHABLE, never
 *                              as a window that ran clean
 */

import { unreachable, type ReadOutcome } from "./admin-data.ts";
import {
  gap,
  held,
  measured,
  type CountClaim,
  type Held,
  type Measured,
  type RenderedNumber,
} from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type {
  ItemVerdict,
  WindowIncident,
  WindowRunRecord,
  WindowStageRecord,
} from "./promotion/types.ts";
import { isWindowIncident, isWindowRunRecord } from "./promotion/window.ts";

export const INCIDENTS_SHOWN = 10;
export const VERDICTS_SHOWN = 25;

/* ------------------------------------------------------------------ reads */

export interface LastWindowRead {
  /** Every window record the log holds. */
  readonly total: number;
  /** The newest by finishedAt. */
  readonly last: WindowRunRecord;
}

export async function readLastWindow(repos: ControlPlaneRepositories): Promise<ReadOutcome<LastWindowRead>> {
  try {
    /* A foreign row under the log (the conformance suite writes one per run) is not a window. */
    const all = (await repos.windowRuns.readAll()).filter(isWindowRunRecord);
    if (all.length === 0) {
      return {
        kind: "NOT_RECORDED",
        detail: "The control plane is reachable and holds no window record yet; the nightly window has never run.",
      };
    }
    const last = [...all].sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0))[0];
    return { kind: "HELD", value: { total: all.length, last } };
  } catch (error) {
    return unreachable("the window run log", error);
  }
}

export async function readWindowIncidents(
  repos: ControlPlaneRepositories,
  windowId: string,
): Promise<ReadOutcome<readonly WindowIncident[]>> {
  try {
    return { kind: "HELD", value: (await repos.windowIncidents.read(windowId)).filter(isWindowIncident) };
  } catch (error) {
    return unreachable("the window incident log", error);
  }
}

/* ------------------------------------------------------------------ view */

export type WindowVerdict = "COMPLETED" | "FAILED_STAGE" | "NEVER_RUN" | "UNREACHABLE";

export interface RecordClassRow {
  readonly recordClass: string;
  readonly promoteWould: Measured;
  readonly refuseWould: Measured;
  readonly deferred: Measured;
}

export interface WindowView {
  readonly nowIso: string;
  readonly verdict: WindowVerdict;
  readonly reasons: readonly string[];
  readonly time: Held<{
    readonly windowId: string;
    readonly localDate: string;
    readonly zone: string;
    readonly scheduledFor: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly trigger: string;
    readonly mode: string;
    readonly host: string;
    readonly testedSha: string | null;
    readonly caughtUp: readonly string[];
  }>;
  readonly gate: Held<{ readonly reason: string; readonly openRecordClasses: readonly string[]; readonly readFrom: string | null }>;
  readonly stages: Held<readonly WindowStageRecord[]>;
  readonly promoted: Held<Measured>;
  readonly wouldPromote: Held<Measured>;
  readonly refused: Held<Measured>;
  readonly deferred: Held<Measured>;
  readonly byRecordClass: Held<readonly RecordClassRow[]>;
  readonly verdicts: Held<{ readonly shown: Measured; readonly rows: readonly ItemVerdict[] }>;
  readonly legacy: Held<{ readonly source: string; readonly ran: Measured; readonly rows: readonly { readonly id: string; readonly outcome: string; readonly reason: string }[] }>;
  readonly controls: Held<{ readonly recall: Measured; readonly falseAbsences: Measured; readonly falsePresences: Measured }>;
  readonly verification: Held<{ readonly instrument: string; readonly verdict: string; readonly detail: string }>;
  readonly incidents: Held<{ readonly shown: Measured; readonly rows: readonly WindowIncident[] }>;
  readonly proof: Held<{ readonly windowId: string; readonly recordPath: string | null; readonly digestPath: string | null; readonly leaseId: string; readonly windowsRecorded: number }>;
}

export interface WindowViewInput {
  readonly nowIso: string;
  readonly lastWindow: ReadOutcome<LastWindowRead>;
  readonly incidents: ReadOutcome<readonly WindowIncident[]>;
}

function count(label: string, value: number, denominator: number, contract: string, source: string): Held<Measured> {
  try {
    return held(measured(value, denominator, contract, source));
  } catch {
    return gap("OURS", `${label}: ${value} against a denominator of ${denominator} cannot both be true; the number is withheld`);
  }
}

/** Build everything the panel renders. PURE: `nowIso` is the only clock. */
export function buildWindowView(input: WindowViewInput): WindowView {
  const read = input.lastWindow;
  if (read.kind !== "HELD") {
    const verdict: WindowVerdict = read.kind === "STORE_UNREACHABLE" ? "UNREACHABLE" : "NEVER_RUN";
    const g = <T,>(): Held<T> => gap<T>("OURS", read.detail);
    return {
      nowIso: input.nowIso,
      verdict,
      reasons: [read.detail],
      time: g(),
      gate: g(),
      stages: g(),
      promoted: g(),
      wouldPromote: g(),
      refused: g(),
      deferred: g(),
      byRecordClass: g(),
      verdicts: g(),
      legacy: g(),
      controls: g(),
      verification: g(),
      incidents: g(),
      proof: g(),
    };
  }
  const run = read.value.last;
  const failed = run.stages.filter((s) => s.outcome === "FAILED");
  const verdict: WindowVerdict = failed.length > 0 ? "FAILED_STAGE" : "COMPLETED";
  const reasons = failed.map((s) => `${s.stage} FAILED: ${s.reason ?? "no reason recorded"}`);
  const p = run.pipeline;
  const source = `window ${run.windowId}'s pipeline verdicts, counted at read time`;
  const would = p.verdicts.filter((v) => v.verdict === "PROMOTE_WOULD").length;
  const refusedN = p.verdicts.filter((v) => v.verdict === "REFUSE_WOULD").length;
  const deferredN = p.verdicts.filter((v) => v.verdict === "DEFER").length;
  const denom = p.items;
  const classRows: RecordClassRow[] = p.byRecordClass.map((t) => ({
    recordClass: t.recordClass,
    promoteWould: measured(t.promoteWould, t.items, `items of class ${t.recordClass} the window would have promoted, of every item in that class`, source),
    refuseWould: measured(t.refuseWould, t.items, `items of class ${t.recordClass} the window would have refused, of every item in that class`, source),
    deferred: measured(t.deferred, t.items, `items of class ${t.recordClass} the window deferred, of every item in that class`, source),
  }));
  const incidentRows = input.incidents.kind === "HELD" ? input.incidents.value : run.incidents;
  const legacy = run.legacyRefresh;
  const controls = run.controls;
  return {
    nowIso: input.nowIso,
    verdict,
    reasons: [...reasons, ...(input.incidents.kind === "STORE_UNREACHABLE" ? [`control plane: ${input.incidents.detail}`] : [])],
    time: held({
      windowId: run.windowId,
      localDate: run.localDate,
      zone: run.zone,
      scheduledFor: run.scheduledFor,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      trigger: run.trigger,
      mode: run.mode,
      host: run.host,
      testedSha: run.testedSha,
      caughtUp: run.caughtUp,
    }),
    gate: held({ reason: run.activationGate.reason, openRecordClasses: run.activationGate.openRecordClasses, readFrom: run.activationGate.readFrom }),
    stages: held(run.stages),
    promoted:
      denom === 0
        ? gap("OURS", "the pipeline held no item, so there was nothing to promote or refuse")
        : count("promoted", run.promoted, denom, "items promoted to reader truth this window, of every pipeline item; 0 while the window runs in SHADOW", source),
    wouldPromote: denom === 0 ? gap("OURS", "the pipeline held no item") : count("would promote", would, denom, "items the window would have promoted had the gate been open, of every pipeline item", source),
    refused: denom === 0 ? gap("OURS", "the pipeline held no item") : count("refused", refusedN, denom, "items the window refused with a stated stage or closed class, of every pipeline item", source),
    deferred: denom === 0 ? gap("OURS", "the pipeline held no item") : count("deferred", deferredN, denom, "items the window deferred with a stated reason, of every pipeline item", source),
    byRecordClass: classRows.length === 0 ? gap("OURS", "no record class held an item") : held(classRows),
    verdicts: held({
      shown: measured(Math.min(p.verdicts.length, VERDICTS_SHOWN), p.verdicts.length, `item verdicts listed, of every verdict the window recorded (cap ${VERDICTS_SHOWN})`, source),
      rows: p.verdicts.slice(0, VERDICTS_SHOWN),
    }),
    legacy:
      legacy === null
        ? gap("OURS", failed.find((s) => s.stage === "LEGACY_REFRESH")?.reason ?? "the legacy refresh stage recorded no reading")
        : held({
            source: legacy.source,
            ran: measured(legacy.sources.filter((s) => s.ran).length, legacy.sources.length, "legacy refresh sources that ran in the isolated checkout, of every source the report lists", `docs/refresh-run.${legacy.source === "JSON" ? "json" : "md"} in the window's checkout`),
            rows: legacy.sources.map((s) => ({ id: s.id, outcome: s.outcome, reason: s.reason })),
          }),
    controls:
      controls === null
        ? gap("OURS", "NOT MEASURED: the window's batch carried no injected controls, so recall and the false-absence and false-presence rates cannot be stated")
        : held({
            recall: measured(controls.recalled, controls.knownPresentCount, "known-present control facts the surface stated, of every known-present control", "the control set scored in this window"),
            falseAbsences: measured(controls.falseAbsences, controls.knownPresentCount, "known-present controls the surface denied, of every known-present control", "the control set scored in this window"),
            falsePresences: measured(controls.falsePresences, controls.knownAbsenceCount, "known-absence controls the surface asserted, of every known-absence control", "the control set scored in this window"),
          }),
    verification:
      run.postPromotionVerification === null
        ? gap("OURS", failed.find((s) => s.stage === "POST_PROMOTION_VERIFICATION")?.reason ?? "the verification stage recorded nothing")
        : held({ instrument: run.postPromotionVerification.instrument, verdict: run.postPromotionVerification.verdict, detail: run.postPromotionVerification.detail }),
    incidents: held({
      shown: measured(Math.min(incidentRows.length, INCIDENTS_SHOWN), incidentRows.length, `incidents listed, of every incident this window opened (cap ${INCIDENTS_SHOWN})`, "the windowIncidents log for this window, or the record's own list when the log could not be read"),
      rows: incidentRows.slice(0, INCIDENTS_SHOWN),
    }),
    proof: held({ windowId: run.windowId, recordPath: run.recordPath, digestPath: run.digestPath, leaseId: run.lock.leaseId, windowsRecorded: read.value.total }),
  };
}

/* ------------------------------------------------------------- the audit */

export function renderedNumbersOf(view: WindowView): RenderedNumber[] {
  const none: Held<Measured> = gap("OURS", "this panel holds no number to audit");
  const candidates: (readonly [string, Held<Measured>])[] = [
    ["promoted", view.promoted],
    ["would promote", view.wouldPromote],
    ["refused", view.refused],
    ["deferred", view.deferred],
    ["verdicts shown", view.verdicts.held ? held(view.verdicts.value.shown) : none],
    ["legacy sources ran", view.legacy.held ? held(view.legacy.value.ran) : none],
    ["control recall", view.controls.held ? held(view.controls.value.recall) : none],
    ["control false absences", view.controls.held ? held(view.controls.value.falseAbsences) : none],
    ["control false presences", view.controls.held ? held(view.controls.value.falsePresences) : none],
    ["incidents shown", view.incidents.held ? held(view.incidents.value.shown) : none],
  ];
  if (view.byRecordClass.held) {
    for (const row of view.byRecordClass.value) {
      candidates.push([`${row.recordClass} would promote`, held(row.promoteWould)]);
      candidates.push([`${row.recordClass} refused`, held(row.refuseWould)]);
      candidates.push([`${row.recordClass} deferred`, held(row.deferred)]);
    }
  }
  return candidates.flatMap(([label, m]) =>
    m.held ? [{ label, value: m.value.value, denominator: m.value.denominator, contract: m.value.contract }] : [],
  );
}

export function countClaimsOf(view: WindowView): CountClaim[] {
  const claims: CountClaim[] = [];
  if (view.verdicts.held) {
    claims.push({ label: "verdicts shown", stated: view.verdicts.value.shown.value, rendered: view.verdicts.value.rows.length });
  }
  if (view.incidents.held) {
    claims.push({ label: "incidents shown", stated: view.incidents.value.shown.value, rendered: view.incidents.value.rows.length });
  }
  if (view.legacy.held) {
    claims.push({ label: "legacy sources listed", stated: view.legacy.value.ran.denominator, rendered: view.legacy.value.rows.length });
  }
  return claims;
}
