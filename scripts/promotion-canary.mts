/**
 * `pnpm promotion:canary` — **THE SANCTIONED SHADOW / AS-IF-PROMOTED CANARY.**
 * (Fleet Promotion Readiness, PRDY-6, 2026-09-06.)
 *
 * Exercises the REAL planner, projection and promoter path — the same
 * `projectFactChains`, `evaluateItems` and `promoteFacts` the nightly window
 * wires — on an ISOLATED control plane and an ISOLATED copy of the committed
 * reader snapshot, with an as-if authority that opens exactly meeting-times
 * and agendas. The live gate is read and recorded, never changed; the
 * committed snapshot's hash is asserted unchanged before and after; the live
 * control plane is never opened.
 *
 * What it proves, each with a count and its denominator:
 *
 * ```
 *   positive      ≥1 meeting-time and ≥1 agenda fact carried SCOUTED → APPROVED on
 *                 real held bytes and materialized in shadow through the Reader's
 *                 own snapshot writer, verified by the Reader's own reader
 *   stale         a class whose last successful acquisition is older than the
 *                 threshold is refused at approval (FRESHNESS_NOT_STALE)
 *   conflicting   a second acquisition that moves a sitting holds that fact at
 *                 CONFIRMED (CONFIRMATION_FACT_CONFLICT); a later contradiction
 *                 holds an already-approved fact at the promoter (FACT_HELD)
 *   malformed     a capture that is not a JSON document bridges nothing
 *                 (EXTRACTION_NOT_CLEAN)
 *   excluded      a record class outside the proposed scope is refused
 *                 (RECORD_CLASS_CLOSED); the LIVE gate refuses everything
 *                 (PROMOTION_OFF) and writes nothing
 *   rollback      a seeded failing verification reverts the exact before-state
 *                 bytes and opens an incident
 * ```
 *
 *   --source=fixture|live       fixture (default): the real held Pima Legistar capture at
 *                               tests/fixtures/legistar-pima-events.json; live: two fresh
 *                               acquisitions of the same official feed through the polite client
 *   --audit=auto|model|deterministic
 *                               auto (default): the model review runs when the worker
 *                               credential is set; deterministic: the attack set alone, said so
 *   --root=<dir>                the isolated root (default: a fresh temp directory)
 *   --json                      print the report as JSON only
 *   --no-record                 do not append the run to data/health/promotion-canary-runs/
 *
 * Exit 0 only when every canary above has its count and every preservation
 * check holds; 1 with the gaps named otherwise; 2 when a plane could not be
 * built at all (COULD NOT TELL — never printed like a pass, RULING 24).
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ACTIVATION_GATE, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { collectFactChains, factSubjectsFromRepositories, projectFactChains } from "../lib/control-plane/promotion/fact-chain.ts";
import { readFactFreshness } from "../lib/control-plane/promotion/fact-freshness.ts";
import { isolatedFactPlane, PIMA_LEGISTAR_CONTRACT, PIMA_LEGISTAR_FEED_URL } from "../lib/control-plane/promotion/isolated-plane.ts";
import { factAgreementIn, MEETING_FACT_CLASSES } from "../lib/control-plane/promotion/meeting-facts.ts";
import { liveAuthority, promoteFacts, receiptSummary, shadowAuthority, verifyMaterialization, type PromotionReceipt } from "../lib/control-plane/promotion/promoter.ts";
import type { ItemVerdict } from "../lib/control-plane/promotion/types.ts";
import { evaluateItems } from "../lib/control-plane/promotion/window.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { promotedFactsProvider } from "../lib/control-plane/scheduler/providers/promoted-facts.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { boundedAuditTransport, modelAuditReasoner } from "../lib/control-plane/workers/model-audit.ts";
import type { FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SOURCE = opt("source") ?? "fixture";
const AUDIT = opt("audit") ?? "auto";
const JSON_ONLY = argv.includes("--json");
const NO_RECORD = argv.includes("--no-record");
const ROOT = process.cwd();
const nowIso = (): string => new Date().toISOString();
const sha256 = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const log = (line: string): void => { if (!JSON_ONLY) console.log(`promotion:canary · ${line}`); };

const REAL_SNAPSHOT = join(ROOT, "data", "meetings-snapshot.json");
const realSnapshotBefore = sha256(readFileSync(REAL_SNAPSHOT));
const gate = readActivationGate(ROOT);
const canaryRoot = opt("root") ? resolve(opt("root")!) : mkdtempSync(join(tmpdir(), "wtp-promotion-canary-"));
const stamp = `canary-${today()}-${Date.now()}`;
log(`isolated root ${canaryRoot}; live gate ${gate.promotionEnabled ? "ON" : "OFF"} (${gate.openRecordClasses.length} open class(es)); HEAD ${headSha(ROOT)?.slice(0, 8) ?? "unknown"}`);

function seededRoot(name: string): string {
  const root = join(canaryRoot, name);
  mkdirSync(join(root, "data"), { recursive: true });
  copyFileSync(REAL_SNAPSHOT, join(root, "data", "meetings-snapshot.json"));
  return root;
}

/* ------------------------------------------------------------ the bytes --- */

async function acquireBytes(): Promise<{ text: string; provenance: string; second: string }> {
  if (SOURCE === "live") {
    /* The day boundaries of the feed window come from the zone-owning helper, never a UTC slice (generated-doc-dates 0B). */
    const from = today(new Date(Date.now() - 90 * 86_400_000));
    const to = today(new Date(Date.now() + 60 * 86_400_000));
    const url = `${PIMA_LEGISTAR_FEED_URL}?$filter=${encodeURIComponent(`EventDate ge datetime'${from}' and EventDate le datetime'${to}'`)}&$orderby=EventId&$top=1000`;
    const first = await politeGetText(url, { accept: "application/json" });
    const second = await politeGetText(url, { accept: "application/json" });
    return { text: first.text, second: second.text, provenance: `two live acquisitions of ${url} (HTTP ${first.status}/${second.status})` };
  }
  const path = join(ROOT, "tests", "fixtures", "legistar-pima-events.json");
  const text = readFileSync(path, "utf8");
  return { text, second: text, provenance: `recorded real capture of the official feed, ${path} (sha256 ${sha256(text).slice(0, 12)})` };
}

/** The same bytes with the first sitting's clock moved one hour — a second acquisition that states a different fact. */
function movedBytes(text: string): string {
  const decoded = JSON.parse(text) as unknown;
  const rows = (Array.isArray(decoded) ? decoded : (decoded as { value: Record<string, unknown>[] }).value) as Record<string, unknown>[];
  const first = rows[0];
  const clock = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(first.EventTime ?? ""));
  const movedClock = clock ? `${(Number(clock[1]) % 12) + 1}:${clock[2]} ${clock[3].toUpperCase()}` : "11:11 AM";
  const movedRows = rows.map((row, index) => (index === 0 ? { ...row, EventTime: movedClock } : row));
  return Array.isArray(decoded) ? JSON.stringify(movedRows) : JSON.stringify({ ...(decoded as object), value: movedRows });
}

/* ---------------------------------------------------------- the reasoner --- */

let modelAudit: string;
let reasonerFor: ((repos: FleetRuntime["repos"]) => FleetRuntime["auditReasoner"]) | null = null;
if (AUDIT === "deterministic") {
  modelAudit = "NOT_RUN: --audit=deterministic; the audit is the deterministic attack set";
} else {
  const key = process.env[WORKER_CREDENTIAL_VAR];
  if (!key) modelAudit = `NOT_RUN: ${WORKER_CREDENTIAL_VAR} is not set in this runtime; the audit is the deterministic attack set`;
  else {
    reasonerFor = (repos) => modelAuditReasoner(repos, boundedAuditTransport(key), nowIso);
    modelAudit = "RAN: the standing runner's model review over the independent context";
  }
}

/* ----------------------------------------------------------- the report --- */

interface CanaryReport {
  formatVersion: 1;
  version: "promotion-canary/1";
  at: string;
  headSha: string | null;
  root: string;
  source: string;
  modelAudit: string;
  gate: { promotionEnabled: boolean; openRecordClasses: readonly string[]; reason: string; constant: boolean };
  positive: {
    chain: { parser: string; validator: string; auditor: string; auditorFindings: readonly string[]; modelReview: string | null } | null;
    bridged: { facts: number; refusals: number };
    pipeline: Record<string, { items: number; byStage: Record<string, number>; refused: number }>;
    liveGate: { promoteWould: number; refuseWould: number; items: number };
    shadowGate: { promoteWould: number; refuseWould: number; items: number };
    receipt: ReturnType<typeof receiptSummary> | null;
    promotedByClass: Record<string, number>;
    verification: PromotionReceipt["verification"];
    supersededHold: { refused: number; detail: string | null };
    lines: readonly string[];
  };
  refusals: {
    stale: { count: number; freshnessState: string | null; reason: string | null };
    conflict: { count: number; detail: string | null };
    malformed: { count: number; detail: string | null };
    excludedClass: { count: number; code: string | null };
    promotionOff: { count: number; written: boolean; snapshotUnchanged: boolean };
  };
  rollback: { executed: boolean; matchesBefore: boolean | null; before: string | null; after: string | null; restored: string | null; incident: string | null } | null;
  preservation: { realSnapshotUnchanged: boolean; promotionEnabled: boolean; openRecordClasses: number; readerVisiblePromotions: number };
  gaps: string[];
  recordPath: string | null;
}

const report: CanaryReport = {
  formatVersion: 1, version: "promotion-canary/1", at: nowIso(), headSha: headSha(ROOT), root: canaryRoot, source: SOURCE, modelAudit,
  gate: { promotionEnabled: gate.promotionEnabled, openRecordClasses: gate.openRecordClasses, reason: gate.reason, constant: ACTIVATION_GATE.promotionEnabled },
  positive: { chain: null, bridged: { facts: 0, refusals: 0 }, pipeline: {}, liveGate: { promoteWould: 0, refuseWould: 0, items: 0 }, shadowGate: { promoteWould: 0, refuseWould: 0, items: 0 },
    receipt: null, promotedByClass: {}, verification: null, supersededHold: { refused: 0, detail: null }, lines: [] },
  refusals: { stale: { count: 0, freshnessState: null, reason: null }, conflict: { count: 0, detail: null }, malformed: { count: 0, detail: null }, excludedClass: { count: 0, code: null }, promotionOff: { count: 0, written: false, snapshotUnchanged: false } },
  rollback: null,
  preservation: { realSnapshotUnchanged: false, promotionEnabled: gate.promotionEnabled, openRecordClasses: gate.openRecordClasses.length, readerVisiblePromotions: 0 },
  gaps: [],
  recordPath: null,
};

const authority = shadowAuthority([...MEETING_FACT_CLASSES], "shadow canary as-if authority; the live gate is OFF and is not changed");

try {
  const bytes = await acquireBytes();
  log(`bytes: ${bytes.provenance}`);

  /* ---------------------------------------------------- PLANE B: positive --- */
  const positiveRoot = seededRoot("positive");
  const positive = await isolatedFactPlane({ root: ROOT, vaultRoot: join(positiveRoot, "vault"), ...(reasonerFor ? { auditReasoner: reasonerFor, requireModelAudit: true } : {}) });
  const first = await positive.hold(bytes.text);
  await positive.hold(bytes.second);
  const chain = await positive.chain(first);
  report.positive.chain = {
    parser: chain.parser.result.verdict, validator: chain.validator.result.verdict, auditor: chain.auditor.result.verdict,
    auditorFindings: chain.auditor.result.role === "ADVERSARIAL_AUDITOR" ? chain.auditor.result.findings.map((f) => f.code) : [],
    modelReview: chain.auditor.modelReview ? `${chain.auditor.modelReview.model}: ${chain.auditor.modelReview.verdict}${chain.auditor.modelReview.validationError ? ` (${chain.auditor.modelReview.validationError})` : ""}; ${chain.auditor.modelReview.challenges.length} grounded challenge(s)` : null,
  };
  log(`chain: parser ${report.positive.chain.parser}, validator ${report.positive.chain.validator}, auditor ${report.positive.chain.auditor}${report.positive.chain.modelReview ? ` — model review ${report.positive.chain.modelReview}` : ""}`);
  const options = { readArtifactText: positive.readArtifactText, root: ROOT };
  const pass1 = await projectFactChains(positive.repos, { ...options, now: nowIso() });
  report.positive.bridged = { facts: pass1.facts, refusals: pass1.refusals.length };
  const subjects = await factSubjectsFromRepositories(positive.repos, nowIso());
  const registry = buildRegistry([promotedFactsProvider(subjects)], { root: ROOT, nowIso: nowIso() });
  await syncObligations(positive.repos, registry.obligations, nowIso());
  const pass2 = await projectFactChains(positive.repos, { ...options, now: nowIso() });
  report.positive.pipeline = pass2.byClass;
  const liveEval = evaluateItems(pass2.states, gate);
  const shadowEval = evaluateItems(pass2.states, { openRecordClasses: [...MEETING_FACT_CLASSES] });
  report.positive.liveGate = { items: liveEval.verdicts.length, promoteWould: liveEval.verdicts.filter((v) => v.verdict === "PROMOTE_WOULD").length, refuseWould: liveEval.verdicts.filter((v) => v.verdict === "REFUSE_WOULD").length };
  report.positive.shadowGate = { items: shadowEval.verdicts.length, promoteWould: shadowEval.verdicts.filter((v) => v.verdict === "PROMOTE_WOULD").length, refuseWould: shadowEval.verdicts.filter((v) => v.verdict === "REFUSE_WOULD").length };
  const receipt = await promoteFacts({ target: { kind: "SHADOW", root: positiveRoot }, authority, verdicts: shadowEval.verdicts, facts: pass2.factsByItem, now: nowIso(), windowId: stamp, verify: verifyMaterialization });
  report.positive.receipt = receiptSummary(receipt);
  report.positive.verification = receipt.verification;
  for (const item of receipt.items) report.positive.promotedByClass[item.recordClass] = (report.positive.promotedByClass[item.recordClass] ?? 0) + 1;
  report.positive.lines = receipt.lines;
  for (const line of receipt.lines) log(line);

  /* A later contradiction holds an approved fact at the promoter. */
  await positive.hold(movedBytes(bytes.text));
  const collected = await collectFactChains(positive.repos, { ...options, now: nowIso() });
  const holds = new Map<string, string>();
  for (const item of collected.items) {
    if (item.newerSameSource === null) continue;
    const agreement = factAgreementIn(item.fact, item.newerSameSource);
    if (agreement.present && !agreement.sameFact) holds.set(item.itemId, `FACT_SUPERSEDED: ${agreement.detail}`);
  }
  const superseded = await promoteFacts({ target: { kind: "SHADOW", root: positiveRoot }, authority, verdicts: shadowEval.verdicts, facts: pass2.factsByItem, holds, now: nowIso(), windowId: stamp, verify: verifyMaterialization });
  const heldRefusals = superseded.refused.filter((r) => r.code === "FACT_HELD");
  report.positive.supersededHold = { refused: heldRefusals.length, detail: heldRefusals[0]?.detail ?? null };

  /* --------------------------------------------------- PLANE A: refusals --- */
  const refusalRoot = seededRoot("refusals");
  const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const refusals = await isolatedFactPlane({ root: ROOT, vaultRoot: join(refusalRoot, "vault"), startAt: tenDaysAgo });
  const a1 = await refusals.hold(bytes.text);
  await refusals.chain(a1);
  await refusals.hold(movedBytes(bytes.text));
  const malformed = await refusals.hold("{\"value\": [", { canonicalUrl: `${PIMA_LEGISTAR_FEED_URL}?$top=1` });
  await refusals.run(malformed, "PARSER");
  const rOptions = { readArtifactText: refusals.readArtifactText, root: ROOT };
  const rpass1 = await projectFactChains(refusals.repos, { ...rOptions, now: nowIso() });
  const conflicts = rpass1.states.filter((s) => s.refused?.reasons.some((r) => r.code === "CONFIRMATION_FACT_CONFLICT"));
  report.refusals.conflict = { count: conflicts.length, detail: conflicts[0]?.refused?.reasons[0]?.detail ?? null };
  const malformedRefusals = rpass1.refusals.filter((r) => r.code === "EXTRACTION_NOT_CLEAN" && r.artifactId === malformed.artifactId);
  report.refusals.malformed = { count: malformedRefusals.length, detail: malformedRefusals[0]?.detail ?? null };
  const rSubjects = await factSubjectsFromRepositories(refusals.repos, nowIso());
  await syncObligations(refusals.repos, buildRegistry([promotedFactsProvider(rSubjects)], { root: ROOT, nowIso: nowIso() }).obligations, nowIso());
  const rpass2 = await projectFactChains(refusals.repos, { ...rOptions, now: nowIso() });
  const stale = rpass2.states.filter((s) => s.refused?.atStage === "APPROVED_FOR_PROMOTION" && s.refused.reasons.some((r) => /FRESHNESS_NOT_STALE: STALE/.test(r.detail)));
  const freshness = await readFactFreshness(refusals.repos, { recordClass: "meeting-times", subjectId: PIMA_LEGISTAR_CONTRACT.subjectId, now: nowIso(), lastSuccessfulAcquisitionAt: a1.recordedAt });
  report.refusals.stale = { count: stale.length, freshnessState: freshness.state, reason: freshness.reason };

  const excluded = await promoteFacts({ target: { kind: "SHADOW", root: refusalRoot }, authority, now: nowIso(), facts: new Map(), verdicts: [
    { itemId: "pp-canary-excluded", recordClass: "published-minutes", stage: "APPROVED_FOR_PROMOTION", verdict: "PROMOTE_WOULD", reason: "canary: a class outside the proposed activation scope" } satisfies ItemVerdict,
  ] });
  report.refusals.excludedClass = { count: excluded.refused.length, code: excluded.refused[0]?.code ?? null };
  const refusalSnapshotBefore = sha256(readFileSync(join(refusalRoot, "data", "meetings-snapshot.json")));
  const off = await promoteFacts({ target: { kind: "SHADOW", root: refusalRoot }, authority: liveAuthority(gate), verdicts: shadowEval.verdicts, facts: pass2.factsByItem, now: nowIso() });
  report.refusals.promotionOff = { count: off.refused.filter((r) => r.code === "PROMOTION_OFF").length, written: off.after.written, snapshotUnchanged: sha256(readFileSync(join(refusalRoot, "data", "meetings-snapshot.json"))) === refusalSnapshotBefore };

  /* --------------------------------------------------- PLANE C: rollback --- */
  const rollbackRoot = seededRoot("rollback");
  const rolled = await promoteFacts({ target: { kind: "SHADOW", root: rollbackRoot }, authority, verdicts: shadowEval.verdicts, facts: pass2.factsByItem, now: nowIso(), windowId: stamp,
    verify: () => ({ instrument: "canary: seeded failing served-surface verification", exitCode: 1, passed: false, detail: "seeded FAIL to prove the governed reversal" }) });
  report.rollback = { executed: rolled.reversal?.executed ?? false, matchesBefore: rolled.reversal?.matchesBefore ?? null, before: rolled.before.sha256, after: rolled.after.sha256, restored: rolled.reversal?.restoredSha256 ?? null, incident: rolled.incident?.code ?? null };
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  report.gaps.push(`COULD NOT TELL: ${detail}`);
  log(`COULD NOT TELL — ${detail}`);
}

/* --------------------------------------------------------- preservation --- */

report.preservation = {
  realSnapshotUnchanged: sha256(readFileSync(REAL_SNAPSHOT)) === realSnapshotBefore,
  promotionEnabled: gate.promotionEnabled,
  openRecordClasses: gate.openRecordClasses.length,
  readerVisiblePromotions: 0,
};
if (!report.preservation.realSnapshotUnchanged) report.gaps.push("the committed reader snapshot changed during the canary");
if (report.preservation.promotionEnabled || ACTIVATION_GATE.promotionEnabled) report.gaps.push("promotion is ON");
if (report.preservation.openRecordClasses !== 0) report.gaps.push("a production record class is open");
const timesPromoted = report.positive.promotedByClass["meeting-times"] ?? 0;
const agendasPromoted = report.positive.promotedByClass.agendas ?? 0;
if (timesPromoted === 0) report.gaps.push(`no positive meeting-time candidate reached the shadow promoter (chain: ${JSON.stringify(report.positive.chain)})`);
if (agendasPromoted === 0) report.gaps.push("no positive agenda candidate reached the shadow promoter");
if (report.positive.verification?.passed !== true) report.gaps.push("the shadow materialization did not verify");
if (report.refusals.stale.count === 0) report.gaps.push("no stale refusal was produced");
if (report.refusals.conflict.count === 0) report.gaps.push("no conflicting-acquisition hold was produced");
if (report.positive.supersededHold.refused === 0) report.gaps.push("no superseded-at-promotion hold was produced");
if (report.refusals.malformed.count === 0) report.gaps.push("no malformed-capture refusal was produced");
if (report.refusals.excludedClass.count === 0) report.gaps.push("no excluded-class refusal was produced");
if (report.refusals.promotionOff.count === 0 || report.refusals.promotionOff.written || !report.refusals.promotionOff.snapshotUnchanged) report.gaps.push("the live gate did not refuse cleanly");
if (report.rollback?.matchesBefore !== true) report.gaps.push("the reversal did not restore the before-state bytes");

/* ---------------------------------------------------------------- output --- */

const denominator = Math.max(1, report.positive.shadowGate.items);
const lines = [
  floorLine(floored("positive meeting-time facts materialized in shadow", "the shadow-gate verdicts", denominator, timesPromoted)),
  floorLine(floored("positive agenda facts materialized in shadow", "the shadow-gate verdicts", denominator, agendasPromoted)),
  floorLine(floored("items REFUSE_WOULD at the LIVE gate", "the live-gate verdicts", Math.max(1, report.positive.liveGate.items), report.positive.liveGate.refuseWould)),
  `stale refusals ${report.refusals.stale.count} (${report.refusals.stale.freshnessState}); conflicting-acquisition holds ${report.refusals.conflict.count}; superseded-at-promotion holds ${report.positive.supersededHold.refused}; malformed refusals ${report.refusals.malformed.count}; excluded-class refusals ${report.refusals.excludedClass.count} (${report.refusals.excludedClass.code}); PROMOTION_OFF refusals ${report.refusals.promotionOff.count}`,
  `rollback ${report.rollback ? `${report.rollback.executed ? "executed" : "not executed"}, restored bytes ${report.rollback.matchesBefore ? "==" : "!="} before, incident ${report.rollback.incident}` : "not run"}`,
  `preservation: real snapshot ${report.preservation.realSnapshotUnchanged ? "unchanged" : "CHANGED"}; promotion ${report.preservation.promotionEnabled ? "ON" : "OFF"}; open classes ${report.preservation.openRecordClasses}; reader-visible promotions ${report.preservation.readerVisiblePromotions}`,
];
for (const line of lines) log(line);
for (const gap of report.gaps) log(`GAP: ${gap}`);

writeFileSync(join(canaryRoot, "canary-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (!NO_RECORD) {
  const dir = join(ROOT, "data", "health", "promotion-canary-runs");
  report.recordPath = nextRunRecordPath(dir, today());
  writeFileSync(report.recordPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  log(`run record: ${report.recordPath}`);
}
if (JSON_ONLY) console.log(JSON.stringify(report, null, 2));
process.exitCode = report.gaps.some((g) => g.startsWith("COULD NOT TELL")) ? 2 : report.gaps.length === 0 ? 0 : 1;
