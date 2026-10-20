/**
 * One live-audit cycle around `runLiveAuditPass`: skip facts checked this week, record every result, answer each
 * red flag for Sean, and retain the history of his corrections. An unknown origin
 * stays on the fix list and still gets the same four owner choices.
 */
import { AUDIT_POLICY_SETTING, LIVE_AUDIT_DEFAULT_POLICY, type LiveAuditPolicy } from "../audit-policy.ts";
import { addFixItem } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { readSetting } from "../settings.ts";
import { writeFieldManual } from "../field-manual.ts";
import {
  readAuditWeek, recordAuditCorrection, recordLiveAuditResult, type LiveAuditRepos,
} from "../live-audit-log.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import {
  runLiveAuditPass, type LiveAuditPassDeps, type LiveAuditPassSummary, type LiveAuditResult, type LiveFactCatalog,
} from "./live-audit.ts";
import {
  fixedAfterReaudit, respondToRedFlag, type FactOrigin, type RedFlagOutcome, type RedFlagWriters,
} from "./live-audit-response.ts";

/** Who the fix list names as having found a red flag. */
export const LIVE_AUDIT_FINDER = "The live audit";

export type LiveAuditCycleRepos = LiveAuditRepos & Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">;

export interface LiveAuditCycleDeps extends Omit<LiveAuditPassDeps, "lastAuditedAt" | "record"> {
  readonly repos: LiveAuditCycleRepos;
  readonly flag: RedFlagWriters["flag"];
  readonly isPublished?: (result: LiveAuditResult) => Promise<boolean | null>;
  /** Source context for a transferable lesson when it is available. */
  readonly trace?: {
    readonly originOf: (factId: string) => Promise<FactOrigin | null>;
  };
}

export interface LiveAuditCycleOutcome {
  readonly summary: LiveAuditPassSummary;
  readonly redFlags: readonly RedFlagOutcome[];
  readonly fixed: number;
  /** Lessons the bank refused to take; the red flag was still answered. */
  readonly lessonErrors: readonly string[];
}

/** Several families' catalogs as one: an area is every family's facts filed under it. */
export function combinedCatalog(catalogs: readonly LiveFactCatalog[]): LiveFactCatalog {
  return {
    areas: async () => [...new Set((await Promise.all(catalogs.map((c) => c.areas()))).flat())],
    factsInArea: async (area, limit) => (await Promise.all(catalogs.map((c) => c.factsInArea(area, limit)))).flat().slice(0, limit),
  };
}

/** The owner's audit policy from Admin (`audit.policy`); unset, invalid or unreadable reads the code default. */
export async function auditPolicyFrom(repos: Pick<ControlPlaneRepositories, "adminConfig">): Promise<LiveAuditPolicy> {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID).catch(() => null);
  const fallback: LiveAuditPolicy & { readonly [key: string]: number } = { ...LIVE_AUDIT_DEFAULT_POLICY };
  return readSetting(row && isAdminConfig(row.value) ? row.value : null, AUDIT_POLICY_SETTING, fallback);
}

export async function runLiveAuditCycle(deps: LiveAuditCycleDeps): Promise<LiveAuditCycleOutcome> {
  const { repos, now } = deps;
  const policy = deps.policy ?? await auditPolicyFrom(repos);
  const week = await readAuditWeek(repos, now);
  if (deps.isPublished) {
    const latest = new Map<string,LiveAuditResult>();
    for (const result of week.results) if (!latest.has(result.factId) || latest.get(result.factId)!.checkedAt<result.checkedAt) latest.set(result.factId,result);
    for (const result of latest.values()) if (result.published !== false && await deps.isPublished(result) === false) {
      await recordLiveAuditResult(repos,{...result,published:false,verdict:"INCONCLUSIVE",checkedAt:now,reread:null,basis:"NOT_READ",checks:[],
        reason:"This record is no longer published. It is kept in audit history and is outside current accuracy."});
    }
  }
  const latest = new Map<string,LiveAuditResult>();
  for (const result of week.results) if (!latest.has(result.factId) || latest.get(result.factId)!.checkedAt<result.checkedAt) latest.set(result.factId,result);
  const lastAudited = new Map<string,string>();
  for (const result of latest.values()) {
    // A bookkeeping-only failure was a check defect. Re-read it on the normal sampling pass.
    const failed=result.checks.filter(check=>!check.ok);
    if (result.family === "member-offices" && result.verdict === "RED" && failed.length && failed.every(check=>check.field === "officeholderId")) continue;
    lastAudited.set(result.factId,result.checkedAt);
  }
  const lessonErrors: string[] = [];
  const writers: RedFlagWriters = {
    originOf: deps.trace?.originOf ?? (async () => null),
    flag: deps.flag,
    addFixItem: async (item) => { await addFixItem(repos, { where: item.factId, says: `${item.title}. ${item.detail}`, by: LIVE_AUDIT_FINDER, at: item.at }); },
    writeLesson: async (entry) => {
      const wrote = await writeFieldManual(repos, [entry], now);
      if (wrote.error) lessonErrors.push(`${entry.id}: ${wrote.error}`);
    },
  };
  const fresh: LiveAuditResult[] = [];
  const redFlags: RedFlagOutcome[] = [];
  const summary = await runLiveAuditPass({
    ...deps,
    policy,
    lastAuditedAt: (factId) => lastAudited.get(factId) ?? null,
    record: async (result) => {
      if (result.verdict === "RED") redFlags.push(await respondToRedFlag(result, writers, now));
      await recordLiveAuditResult(repos, result);
      fresh.push(result);
    },
  });
  const fixed = fixedAfterReaudit(week.corrections, [...week.results, ...fresh]);
  for (const correction of fixed) await recordAuditCorrection(repos, correction);
  return { summary, redFlags, fixed: fixed.length, lessonErrors };
}
