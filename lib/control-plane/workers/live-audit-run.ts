/**
 * One live-audit cycle around `runLiveAuditPass`: skip facts checked this week, record every result, answer each
 * red flag, and mark FIXED the pulled facts that audit green again. A fact that cannot be traced to the work
 * that published it is never pulled blind; it goes on the fix list with the reason.
 */
import { AUDIT_POLICY_SETTING, LIVE_AUDIT_DEFAULT_POLICY, type LiveAuditPolicy } from "../audit-policy.ts";
import { addFixItem } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../gateway/admin-config.ts";
import { readSetting } from "../settings.ts";
import { writeFieldManual } from "../field-manual.ts";
import {
  weekDayKeys, CORRECTIONS_KEY, recordAuditCorrection, recordLiveAuditPull, recordLiveAuditResult, type LiveAuditRepos,
} from "../live-audit-log.ts";
import { transitionWorkItem } from "../repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { completedWorkerResults } from "../repository/worker-completion.ts";
import { forEachAggregate, withHistoryIndex } from "./streamed-history.ts";
import {
  runLiveAuditPass, type LiveAuditPassDeps, type LiveAuditPassSummary, type LiveFactCatalog,
} from "./live-audit.ts";
import {
  originFromPublications, respondToRedFlag, type FactOrigin, type RedFlagOutcome, type RedFlagWriters,
} from "./live-audit-response.ts";

/** Who the fix list names as having found a red flag. */
export const LIVE_AUDIT_FINDER = "The live audit";

export type LiveAuditCycleRepos = LiveAuditRepos & Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">;

export interface LiveAuditCycleDeps extends Omit<LiveAuditPassDeps, "lastAuditedAt" | "record"> {
  readonly repos: LiveAuditCycleRepos;
  /** Trace a fact to the work that published it and reopen that work. Absent: red flags go to the fix list unpulled. */
  readonly trace?: {
    readonly originOf: (factId: string) => Promise<FactOrigin | null>;
    readonly reopenWorkItem: (workItemId: string, why: string) => Promise<void>;
  };
}

export interface LiveAuditCycleOutcome {
  readonly summary: LiveAuditPassSummary;
  readonly redFlags: readonly RedFlagOutcome[];
  readonly fixed: number;
  /** Lessons the bank refused to take; the red flag was still answered. */
  readonly lessonErrors: readonly string[];
}

/**
 * The trace for worker-published facts: the work item whose publication admitted the fact's member, read
 * only when a red flag needs it, and the reopen as a recorded REOPENED transition, the way a
 * BROKE audit reopens its work. `hostOf` gives the fact's page host for the lesson.
 */
export function workItemTrace(repos: ControlPlaneRepositories, hostOf: (factId: string) => string | null): NonNullable<LiveAuditCycleDeps["trace"]> {
  return {
    originOf: async (factId) => {
      const memberId = factId.slice(factId.indexOf(":") + 1);
      let origin: FactOrigin | null = null;
      await forEachAggregate(repos.workItems, async ({value: item}) => {
        const outcome = item.publicationOutcome;
        if (origin || !outcome || outcome.status === "HELD" || !outcome.recordChanges?.some(change => change.readerId === memberId)) return;
        const records = await repos.workerResults.readWhere(item.id, ["id"], outcome.workerResultId);
        const parsers = await completedWorkerResults(repos, records);
        const contract = await repos.workItems.readNarrowed(item.id, { autonomousPlan: ["contract"] });
        origin = originFromPublications({ items: [{...item, ...(contract?.value as Pick<typeof item, "autonomousPlan">)}], parsers, memberId, host: hostOf(factId) ?? "unknown", platform: null });
      }, { id: true, publicationOutcome: ["status", "workerResultId", "recordChanges"] });
      return origin;
    },
    reopenWorkItem: async (workItemId, why) => {
      await transitionWorkItem(repos, { workItemId, to: "REOPENED", by: `live-audit:${workItemId}`, why, now: new Date().toISOString() });
    },
  };
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
  const row = await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, {apiFallback: true, settings: true}).catch(() => null);
  const fallback: LiveAuditPolicy & { readonly [key: string]: number } = { ...LIVE_AUDIT_DEFAULT_POLICY };
  return readSetting(row && isAdminConfig(row.value) ? row.value : null, AUDIT_POLICY_SETTING, fallback);
}

export async function runLiveAuditCycle(deps: LiveAuditCycleDeps): Promise<LiveAuditCycleOutcome> {
  return withHistoryIndex(async db => {
  const { repos, now } = deps;
  const policy = deps.policy ?? await auditPolicyFrom(repos);
  db.exec(`CREATE TABLE latest(fact TEXT PRIMARY KEY,at TEXT NOT NULL);
    CREATE TABLE greens(fact TEXT NOT NULL,at TEXT NOT NULL); CREATE INDEX greens_by_fact ON greens(fact,at);
    CREATE TABLE fixed(fact TEXT PRIMARY KEY); CREATE TABLE pulls(sequence INTEGER PRIMARY KEY,fact TEXT NOT NULL,at TEXT NOT NULL)`);
  const latest = db.prepare("INSERT INTO latest VALUES(?,?) ON CONFLICT(fact) DO UPDATE SET at=MAX(latest.at,excluded.at)");
  const green = db.prepare("INSERT INTO greens VALUES(?,?)");
  const fixedFact = db.prepare("INSERT OR IGNORE INTO fixed VALUES(?)");
  const pull = db.prepare("INSERT INTO pulls VALUES(?,?,?)");
  const days = new Set(weekDayKeys(now)); let sequence = 0;
  await repos.liveAudits.readChangedSince(null, undefined, {projection: {kind: true, result: ["factId", "checkedAt", "verdict"], correction: true}, page: rows => {
    for (const {key, record} of rows) {
      if (days.has(key) && record.kind === "RESULT") {
        latest.run(record.result.factId, record.result.checkedAt);
        if (record.result.verdict === "GREEN") green.run(record.result.factId, record.result.checkedAt);
      }
      if (key === CORRECTIONS_KEY && record.kind === "CORRECTION") {
        if (record.correction.action === "FIXED") fixedFact.run(record.correction.factId);
        else pull.run(sequence++, record.correction.factId, record.correction.at);
      }
    }
  }});
  const lastAudited = db.prepare("SELECT at FROM latest WHERE fact=?");
  const lessonErrors: string[] = [];
  const writers: RedFlagWriters = {
    originOf: deps.trace?.originOf ?? (async () => null),
    pull: async (pull) => recordLiveAuditPull(repos, { workItemId: pull.workItemId, parserResultId: pull.parserResultId,
      parserAttemptId: pull.parserAttemptId, recordIds: pull.recordIds, factId: pull.result.factId, at: now, reason: pull.result.reason }),
    reopenWorkItem: deps.trace?.reopenWorkItem ?? (async () => { throw new Error("A traced fact needs a work-item reopen."); }),
    addFixItem: async (item) => { await addFixItem(repos, { where: item.factId, says: `${item.title}. ${item.detail}`, by: LIVE_AUDIT_FINDER, at: item.at }); },
    writeLesson: async (entry) => {
      const wrote = await writeFieldManual(repos, [entry], now);
      if (wrote.error) lessonErrors.push(`${entry.id}: ${wrote.error}`);
    },
    recordCorrection: (correction) => recordAuditCorrection(repos, correction),
  };
  const redFlags: RedFlagOutcome[] = [];
  const summary = await runLiveAuditPass({
    ...deps,
    policy,
    lastAuditedAt: (factId) => lastAudited.get(factId)?.at ?? null,
    record: async (result) => {
      await recordLiveAuditResult(repos, result);
      if (result.verdict === "GREEN") green.run(result.factId, result.checkedAt);
      if (result.verdict === "RED") redFlags.push(await respondToRedFlag(result, writers, now));
    },
  });
  for (const flag of redFlags) if (flag.status === "PULLED_AND_REOPENED") pull.run(sequence++, flag.factId, now);
  let fixed = 0;
  for (const row of db.prepare(`SELECT p.fact,(SELECT MIN(g.at) FROM greens g WHERE g.fact=p.fact AND g.at>p.at) AS back
    FROM pulls p LEFT JOIN fixed f ON f.fact=p.fact WHERE f.fact IS NULL ORDER BY p.sequence`).iterate()) {
    if (!row.back) continue;
    await recordAuditCorrection(repos, {factId: row.fact, action: "FIXED", at: row.back, summary: "The corrected value is back on the page and checks out."});
    fixed++;
  }
  return { summary, redFlags, fixed, lessonErrors };
  });
}
