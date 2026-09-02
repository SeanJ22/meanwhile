/**
 * `scout:rederive` — REWRITE EVERY VALIDATED METHOD CANDIDATE'S PROVENANCE FROM
 * THE MACHINE RECORD, RECORD WHAT THE MODEL HAD CLAIMED, AND RE-VALIDATE.
 * (Machine-owned provenance, 2026-09-02. RULING 243.)
 *
 * Before this ruling `learnedRouteFrom` wrote the model's `observedOn` into
 * the proposal's `origin` and ROUTE_EXISTENCE statement. Measured live: the
 * Coconino candidate (mc-54a3b641ab944461c5516985, Attempt
 * at-a45f746dee4c4289aeda9e98, run on 2026-09-02) read "observed 2026-01-01".
 *
 * For each VALIDATED candidate this script:
 *
 * ```
 *   1  finds the Attempt's persisted ScoutResult and the candidate on it
 *   2  reads the artifact records the candidate cited (repos.artifacts) —
 *      recordedAt IS the vault stamp the tool wrote at retrieval
 *   3  derives observedOn = the earliest recordedAt date (UTC); permission =
 *      the same-host read_permission rung's verdict when the result carries
 *      one, else the honest statement that the retrieval proceeded (the tools
 *      open only ALLOWED or NO_ROBOTS hosts) and the exact verdict was not
 *      persisted by the pre-ruling record; recordClass = the obligation's
 *   4  rewrites origin / note / claim statement from those values ONLY,
 *      records the model's originals as `modelClaims`, and RE-VALIDATES
 *      through learnBatch -> introducedIssues -> markValidated | markRejected
 *      (the candidate is reset to PROPOSED first, because VALIDATED ->
 *      VALIDATED is not a lifecycle transition)
 * ```
 *
 * NOTHING IS ADMITTED. `markAdmitted` and `writeMethodStore` are not
 * imported. The only write is data/method/candidates.json.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types scripts/scout-candidates-rederive.mts [--dry]
 * ```
 */

import { join } from "node:path";

import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { utcDateOf } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  CANDIDATE_STORE,
  METHOD_STORE,
  existenceStatement,
  learnedRouteFrom,
  originLine,
  type MachineOwnedProvenance,
} from "../lib/control-plane/scheduler/scout-candidates.ts";
import {
  introducedIssues,
  markRejected,
  markValidated,
  readCandidateStore,
  readMethodStore,
  writeCandidateStore,
  type MethodCandidate,
} from "../lib/method/candidate.ts";
import { learnBatch } from "../lib/method/learn-batch.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const NOW = new Date().toISOString();
const DRY = process.argv.includes("--dry");
const STAMP = today();
const line = (s: string): void => console.log(`  ${s}`);
const redact = (s: string): string => s.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");

const url = controlPlaneUrlFromEnv();
if (url === null) {
  console.error(`scout:rederive · ${CONTROL_PLANE_URL_VAR} is not set; the artifact records live in the control plane. Refusing.`);
  process.exit(1);
}
let repos: ControlPlaneRepositories;
try {
  repos = await createPgRepositories(url, NOW);
} catch (error) {
  console.error(`scout:rederive · could not open the control plane: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
}

const candidatePath = join(ROOT, ...CANDIDATE_STORE);
const knowledge = readMethodStore(join(ROOT, ...METHOD_STORE));
let store = readCandidateStore(candidatePath);
const results = await repos.scoutResults.readAll();
const byAttempt = new Map(results.map((r) => [r.attemptId, r]));
const artifactsAll = await repos.artifacts.readAll();
const artifactById = new Map<string, ArtifactRecord>();
for (const a of artifactsAll) if (!artifactById.has(a.artifactId)) artifactById.set(a.artifactId, a);

console.log(`scout:rederive · ${store.candidates.length} candidate(s) in ${candidatePath}; ${results.length} Scout result(s); ${artifactsAll.length} artifact record(s)${DRY ? " · --dry" : ""}`);

function hostOf(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The same-host read_permission verdict the persisted result carries, as a PermissionState word, or null. */
function permissionFromRungs(result: ScoutResult, host: string | null): string | null {
  if (host === null) return null;
  for (const g of result.rungs) {
    if (g.tool !== "read_permission" || hostOf(g.target) !== host) continue;
    const m = /permission (ALLOWED|DISALLOWED|NO_ROBOTS|CANNOT_TELL)/.exec(g.observed);
    if (m) return m[1] === "NO_ROBOTS" ? "NOT_APPLICABLE" : m[1];
  }
  return null;
}

interface Outcome {
  readonly id: string;
  readonly routeId: string;
  readonly before: string;
  readonly after: string;
  readonly lifecycle: string;
  readonly note: string;
}
const outcomes: Outcome[] = [];

for (const mc of store.candidates) {
  if (mc.lifecycle !== "VALIDATED") {
    outcomes.push({ id: mc.id, routeId: mc.proposal.id, before: mc.proposal.origin, after: mc.proposal.origin, lifecycle: mc.lifecycle, note: "not VALIDATED; untouched" });
    continue;
  }
  const result = byAttempt.get(mc.attemptId);
  const c = result?.candidates.find((x) => x.routeId === mc.proposal.id);
  if (result === undefined || c === undefined) {
    outcomes.push({ id: mc.id, routeId: mc.proposal.id, before: mc.proposal.origin, after: mc.proposal.origin, lifecycle: mc.lifecycle, note: "no persisted Scout result carries this candidate; untouched (a rewrite with no record would be a second guess)" });
    continue;
  }
  const cited = c.evidenceArtifactIds.map((id) => artifactById.get(id)).filter((a): a is ArtifactRecord => a !== undefined);
  const dates = cited.map((a) => utcDateOf(a.recordedAt)).filter((d): d is string => d !== null);
  if (dates.length === 0) {
    outcomes.push({ id: mc.id, routeId: mc.proposal.id, before: mc.proposal.origin, after: mc.proposal.origin, lifecycle: mc.lifecycle, note: `none of the cited artifacts (${c.evidenceArtifactIds.join(", ")}) is in repos.artifacts; untouched` });
    continue;
  }
  const observedOn = dates.reduce((a, b) => (a < b ? a : b));
  const host = hostOf(c.url);
  const verdict = permissionFromRungs(result, host);
  const permission =
    verdict ??
    "OPENED (the tools open only ALLOWED or NO_ROBOTS hosts, so the retrieval proceeded under one of them; the exact verdict was not persisted by the pre-RULING 243 record)";
  const machine: MachineOwnedProvenance = { observedOn, permission, recordClass: result.recordClass, evidenceArtifactIds: cited.map((a) => a.artifactId) };
  const opened = cited.filter((a) => a.canonicalUrl === c.url).map((a) => ({
    artifactId: a.artifactId,
    tier: a.tier,
    contentHash: a.contentHash,
    byteLength: a.byteLength,
    contentType: a.contentType,
    canonicalUrl: a.canonicalUrl,
    partial: a.partial,
    recordedAt: a.recordedAt,
  }));
  const proposal = learnedRouteFrom(c, result, opened.length > 0 ? opened : [], machine);
  /* The rewritten proposal keeps the fields a session may have set (effort) and everything not provenance. */
  const rewritten = {
    ...mc.proposal,
    fields: proposal.fields,
    note: proposal.note,
    origin: originLine(mc.attemptId, result.obligationId, observedOn),
    claims: (mc.proposal.claims ?? []).map((cl) =>
      cl.class === "ROUTE_EXISTENCE" ? { ...cl, statement: existenceStatement(c.url, observedOn, [...new Set([...machine.evidenceArtifactIds, ...opened.map((a) => a.artifactId)])]) } : cl,
    ),
  };
  const reset: MethodCandidate = {
    ...mc,
    proposal: rewritten,
    lifecycle: "PROPOSED",
    validation: null,
    modelClaims: { observedOn: c.observedOn ?? null, permission: c.permission ?? null, recordClass: c.recordClass ?? null },
    provenanceRederived: {
      at: STAMP,
      rule: "observedOn = earliest recordedAt (the vault stamp) among the cited artifact records; permission = the same-host read_permission rung's verdict, else the retrieval's own statement; recordClass = the obligation's (RULING 243)",
      derivedFrom: cited.map((a) => a.artifactId),
      before: { origin: mc.proposal.origin, observedOn: c.observedOn ?? null, permission: c.permission ?? null },
    },
  };
  store = { ...store, candidates: store.candidates.map((x) => (x.id === mc.id ? reset : x)) };
  /* RE-VALIDATE through the existing path. Never admit. */
  let lifecycle: string;
  let note: string;
  try {
    const prospective = learnBatch(knowledge, [rewritten], STAMP).knowledge;
    const { introduced, preExisting } = introducedIssues(knowledge, prospective);
    if (introduced.length === 0) {
      const v = markValidated(store, mc.id, { at: STAMP, againstMethodVersion: knowledge.version, introduced: [], preExisting, ok: true });
      store = v.store;
      lifecycle = v.candidate.lifecycle;
      note = `re-validated against method version ${knowledge.version} (${preExisting} pre-existing issue(s), 0 introduced)`;
    } else {
      const r = markRejected(store, mc.id, { at: STAMP, code: "VALIDATION_FAILED", reason: `the rewritten proposal would introduce ${introduced.length} validator issue(s)`, issues: introduced });
      store = r.store;
      lifecycle = r.candidate.lifecycle;
      note = introduced.map((i) => `${i.id} ${i.rule}: ${i.detail}`).join("; ");
    }
  } catch (error) {
    const r = markRejected(store, mc.id, { at: STAMP, code: "PROPOSAL_MALFORMED", reason: error instanceof Error ? error.message : String(error), issues: [] });
    store = r.store;
    lifecycle = r.candidate.lifecycle;
    note = r.candidate.rejection?.reason ?? "malformed";
  }
  outcomes.push({ id: mc.id, routeId: mc.proposal.id, before: mc.proposal.origin, after: reset.proposal.origin, lifecycle, note: `${note}; permission ${permission.slice(0, 60)}; model claimed observedOn ${c.observedOn}, permission ${c.permission}, recordClass ${c.recordClass}` });
}

console.log();
/* RULING 159: floored on the store's population; an empty store says so rather than printing "0 re-derived". */
line(
  floorLine(
    floored(
      "candidates re-derived from the machine record",
      "the candidates in data/method/candidates.json",
      store.candidates.length,
      outcomes.filter((o) => o.after !== o.before || /re-validated/.test(o.note)).length,
      store.candidates.length === 0 ? "the candidate store holds no candidate" : undefined,
    ),
  ),
);
for (const o of outcomes) {
  line(`${o.id} ${o.routeId}`);
  line(`    before: ${o.before}`);
  line(`    after:  ${o.after}`);
  line(`    ${o.lifecycle} — ${o.note}`);
}
if (DRY) {
  line("--dry: nothing written");
} else {
  writeCandidateStore(candidatePath, store, STAMP);
  line(`wrote: ${candidatePath} (updatedOn ${STAMP})`);
}
