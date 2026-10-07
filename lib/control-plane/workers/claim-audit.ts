/**
 * Weekly, a sample of claimed wins and Proven labels is recomputed from the source records and marked confirmed
 * or wrong. A wrong claim raises a fix-list item and a lesson; a claim whose records are gone or changed is
 * "could not check", never confirmed. A controlled run writes nothing and is never shown as real.
 */
import { createHash } from "node:crypto";

import { newFieldManualEntry, writeFieldManual, type FieldManualEntry } from "../field-manual.ts";
import { addFixItem, fixItems, type FixItem } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, isAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { readRecentClaimPasses, recordClaimPass, type LiveAuditRepos } from "../live-audit-log.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { UpdateRecord } from "../updates.ts";
import type { FixMapRepository, FixMapRow } from "../../method/fix-map.ts";
import { fixProof, readFixProofBar, type MethodStanding } from "../../method/fix-status.ts";

export type ClaimVerdict = "CONFIRMED" | "WRONG" | "COULD_NOT_CHECK";

export interface ClaimCheck {
  /** The update or label checked. */
  readonly claimId: string;
  /** What was claimed, in the words Sean saw. */
  readonly claimed: string;
  readonly verdict: ClaimVerdict;
  /** What the source records say, in plain words. */
  readonly recomputed: string;
  /** Why a wrong claim was wrong; null otherwise. */
  readonly cause: string | null;
}

export interface ClaimPass {
  readonly at: string;
  /** The UTC Monday the week starts on. */
  readonly week: string;
  readonly checks: readonly ClaimCheck[];
  /** True for a controlled run; never counted or shown as real. */
  readonly synthetic: boolean;
}

/** A claim the auditors can recompute. */
export type Claim =
  | { readonly type: "UPDATE"; readonly update: UpdateRecord }
  | { readonly type: "PROVEN_LABEL"; readonly standing: MethodStanding };

export const CLAIMS_PER_WEEK = 20;
const WEEK_MS = 7 * 86_400_000;

export function weekOf(iso: string): string {
  const d = new Date(iso);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

/** The fix-list item a "Fixed:" update came from: the gateway writes `fix:<item id>:<at>`. */
export function fixItemIdOf(update: UpdateRecord): string | null {
  const suffix = `:${update.at}`;
  return update.id.startsWith("fix:") && update.id.endsWith(suffix) ? update.id.slice(4, -suffix.length) || null : null;
}

/** Every claim the week holds that a source record can confirm: wins shown in the last seven days, and every Proven label. */
export function claimsOf(config: AdminConfig, now: string): Claim[] {
  const since = Date.parse(now) - WEEK_MS;
  const updates = (config.updates ?? []).filter((u) => u.label !== "EXPECTED" && u.setback !== true && Date.parse(u.at) >= since && Date.parse(u.at) <= Date.parse(now))
    .filter((u) => u.claim !== undefined || fixItemIdOf(u) !== null);
  return [
    ...updates.map((update): Claim => ({ type: "UPDATE", update })),
    ...(config.methodStandings ?? []).filter((s) => s.status === "PROVEN").map((standing): Claim => ({ type: "PROVEN_LABEL", standing })),
  ];
}

const idOf = (c: Claim): string => (c.type === "UPDATE" ? c.update.id : `proven-label:${c.standing.methodId}`);

/** A fixed sample per week: the same claims are drawn on a rerun, and no claim's place in a list decides it. */
export function sampleClaims(claims: readonly Claim[], week: string, k: number = CLAIMS_PER_WEEK): Claim[] {
  const rank = (c: Claim) => createHash("sha256").update(`${week}\u0000${idOf(c)}`).digest("hex");
  return [...claims].sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, Math.max(0, k));
}

const places = (k: number): string => `${k.toLocaleString("en-US")} place${k === 1 ? "" : "s"}`;
const tried = (r: FixMapRow): number => Date.parse(r.triedAt ?? r.updatedAt);

/** "Proven: worked in X places, failed in Y", recomputed from the fix map as it stood when it was said. */
export function checkProvenCount(update: UpdateRecord, map: readonly FixMapRow[]): ClaimCheck {
  const c = update.claim!;
  const at = Date.parse(update.at);
  const before = map.filter((r) => r.state !== "UNTRIED" && tried(r) <= at);
  // A place whose result was replaced since cannot say what it read then.
  const since = map.filter((r) => r.state !== "UNTRIED" && tried(r) > at).length;
  const works = before.filter((r) => r.state === "WORKS").length;
  const failed = before.filter((r) => r.state === "FAILS").length;
  const recomputed = `The fix map shows ${places(works)} working and ${places(failed)} failing then${since > 0 ? `, and ${places(since)} tried again since` : ""}.`;
  const base = { claimId: update.id, claimed: update.what, recomputed };
  if (since === 0) {
    return works === c.works && failed === c.failed
      ? { ...base, verdict: "CONFIRMED", cause: null }
      : { ...base, verdict: "WRONG", cause: `The update said ${places(c.works)} working and ${places(c.failed)} failing; the fix map held ${places(works)} and ${places(failed)}.` };
  }
  const possible = works <= c.works && c.works <= works + since && failed <= c.failed && c.failed <= failed + since && c.works + c.failed <= works + failed + since;
  return possible
    ? { ...base, verdict: "COULD_NOT_CHECK", cause: null }
    : { ...base, verdict: "WRONG", cause: `The update said ${places(c.works)} working and ${places(c.failed)} failing, which the fix map cannot hold even counting the places tried again since.` };
}

/** A Proven label on a fix, recomputed from the fix map against today's bar. */
export function checkProvenLabel(standing: MethodStanding, map: readonly FixMapRow[], config: AdminConfig | null): ClaimCheck {
  const proof = fixProof(map, readFixProofBar(config));
  const base = { claimId: `proven-label:${standing.methodId}`, claimed: `${standing.title} is Proven.`,
    recomputed: `The fix map shows it working in ${places(proof.works)} of ${places(proof.tried)} tried, across ${proof.states} state${proof.states === 1 ? "" : "s"}.` };
  return proof.status === "PROVEN"
    ? { ...base, verdict: "CONFIRMED", cause: null }
    : { ...base, verdict: "WRONG", cause: "Admin still labels it Proven, but its places no longer meet the proof bar in Settings." };
}

/** "Fixed: …", recomputed from the fix-list item: it was recorded fixed, at or before the update. */
export function checkFixDone(update: UpdateRecord, items: readonly FixItem[]): ClaimCheck {
  const id = fixItemIdOf(update)!;
  const item = items.find((i) => i.id === id);
  const base = { claimId: update.id, claimed: update.what };
  if (!item) return { ...base, verdict: "COULD_NOT_CHECK", recomputed: "The fix list no longer holds that item.", cause: null };
  const fixedThen = item.fixedAt !== undefined && Date.parse(item.fixedAt) <= Date.parse(update.at);
  if (fixedThen) return { ...base, verdict: "CONFIRMED", recomputed: `The fix list recorded it fixed${item.state === "CAME_BACK" ? "; it came back later" : ""}.`, cause: null };
  if (item.state === "CAME_BACK" || item.state === "FIXED") return { ...base, verdict: "COULD_NOT_CHECK", recomputed: "The fix list was rewritten for that item since.", cause: null };
  return { ...base, verdict: "WRONG", recomputed: `The fix list shows it ${item.state === "OPEN" ? "still open" : "still being fixed"}.`,
    cause: "The update said it was fixed, but the fix list never recorded the fix." };
}

export interface ClaimAuditInput {
  readonly config: AdminConfig;
  readonly fixMap: Pick<FixMapRepository, "forMethod">;
  readonly now: string;
  readonly synthetic?: boolean;
  readonly k?: number;
}

/** Draws the week's sample and recomputes each claim. Reads only; the caller records the pass and answers red flags. */
export async function auditClaims(input: ClaimAuditInput): Promise<ClaimPass> {
  const week = weekOf(input.now);
  const maps = new Map<string, readonly FixMapRow[]>();
  const mapOf = async (methodId: string) => {
    if (!maps.has(methodId)) maps.set(methodId, await input.fixMap.forMethod(methodId, 1000));
    return maps.get(methodId)!;
  };
  const checks: ClaimCheck[] = [];
  for (const claim of sampleClaims(claimsOf(input.config, input.now), week, input.k)) {
    try {
      if (claim.type === "PROVEN_LABEL") checks.push(checkProvenLabel(claim.standing, await mapOf(claim.standing.methodId), input.config));
      else if (claim.update.claim?.kind === "FIX_PROVEN") checks.push(checkProvenCount(claim.update, await mapOf(claim.update.claim.methodId)));
      else checks.push(checkFixDone(claim.update, fixItems(input.config)));
    } catch {
      // Records that cannot be read confirm nothing.
      checks.push({ claimId: idOf(claim), claimed: claim.type === "UPDATE" ? claim.update.what : `${claim.standing.title} is Proven.`,
        verdict: "COULD_NOT_CHECK", recomputed: "The fix map could not be read just now.", cause: null });
    }
  }
  return { at: input.now, week, checks, synthetic: input.synthetic === true };
}

export const CLAIM_AUDIT_FINDER = "The claim auditors";
const CLAIM_LESSON_SOURCE = "claim-audit-lesson";

/** The red flag a wrong claim raises on the team: one fix-list item per claim. */
export function claimRedFlag(check: ClaimCheck): { where: string; says: string } {
  return { where: `Team report: ${check.claimed}`, says: `A claimed win was wrong. ${check.cause ?? ""} ${check.recomputed}`.replace(/\s+/g, " ").trim() };
}

/** The lesson a wrong claim teaches, keyed by the kind of claim and its cause, so a repeat updates it. */
export function claimLesson(check: ClaimCheck, at: string): FieldManualEntry {
  const kind = check.claimId.startsWith("proven-label:") ? "PROVEN_LABEL" : check.claimId.startsWith("fix-status:") ? "FIX_PROVEN" : "FIX_DONE";
  return newFieldManualEntry(CLAIM_LESSON_SOURCE, `${kind}|${check.cause ?? ""}`, {
    role: "AUDITOR", kind: "CLAIM_LESSON",
    title: `A claimed win was wrong (${kind === "PROVEN_LABEL" ? "a Proven label" : kind === "FIX_PROVEN" ? "a Proven count" : "a fix reported done"})`,
    summary: `recompute from source records before claiming: ${check.cause ?? "the claim did not match"}`.slice(0, 240),
    outcome: "FAILED", observedAt: at.slice(0, 10), payload: { claimId: check.claimId, claimed: check.claimed, recomputed: check.recomputed },
  });
}

/** The Scoreboard's reading of the latest real pass. */
export interface ReportAccuracyReading {
  readonly confirmed: number;
  readonly wrong: number;
  readonly couldNotCheck: number;
  readonly at: string;
  readonly wrongClaims: readonly { readonly claimed: string; readonly cause: string }[];
}

export function reportAccuracy(passes: readonly ClaimPass[]): ReportAccuracyReading | null {
  const real = passes.filter((p) => !p.synthetic).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!real) return null;
  const count = (v: ClaimVerdict) => real.checks.filter((c) => c.verdict === v).length;
  return { confirmed: count("CONFIRMED"), wrong: count("WRONG"), couldNotCheck: count("COULD_NOT_CHECK"), at: real.at,
    wrongClaims: real.checks.filter((c) => c.verdict === "WRONG").map((c) => ({ claimed: c.claimed, cause: c.cause ?? "" })) };
}

export type ClaimAuditRepos = LiveAuditRepos & Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">;

/**
 * The weekly pass: once per week (a rerun in the same week does nothing), draw
 * the sample, recompute it, keep the pass, and answer each wrong claim with a
 * red flag and a lesson. A lesson the Bank refuses is reported, never thrown.
 */
export async function runClaimAuditWeek(repos: ClaimAuditRepos, fixMap: Pick<FixMapRepository, "forMethod">, now: string):
  Promise<{ readonly ran: boolean; readonly pass: ClaimPass | null; readonly lessonErrors: readonly string[] }> {
  const week = weekOf(now);
  if ((await readRecentClaimPasses(repos, [week])).length > 0) return { ran: false, pass: null, lessonErrors: [] };
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const config = held && isAdminConfig(held.value) ? held.value : null;
  if (!config) return { ran: false, pass: null, lessonErrors: [] };
  const pass = await auditClaims({ config, fixMap, now });
  await recordClaimPass(repos, pass);
  const lessonErrors: string[] = [];
  for (const check of pass.checks.filter((c) => c.verdict === "WRONG")) {
    const flag = claimRedFlag(check);
    await addFixItem(repos, { ...flag, by: CLAIM_AUDIT_FINDER, at: now });
    const lesson = claimLesson(check, now);
    const wrote = await writeFieldManual(repos, [lesson], now);
    if (wrote.error) lessonErrors.push(`${lesson.id}: ${wrote.error}`);
  }
  return { ran: true, pass, lessonErrors };
}
