/**
 * **REPLAY HELD RESEARCH FINDINGS THROUGH THE CAMPAIGN-SITE CHAIN — READ-ONLY.**
 * (2026-09-25.)
 *
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs \
 *     scripts/replay-research-findings.mts --vault=<vault root> --out=<dir outside the repository>
 *     [--manifest=<staging manifest.json>] [--runs=<freshness-shadow run records dir>]
 *     [--scout-results=<json array of ScoutResult rows>] [--prior=<json {versionId,payload,sourceReceipt}>]
 *     [--now=<ISO instant>] [--fetch] [--max-reads=<n>]
 *
 * Every input is a FILE it is handed; it opens no database and writes only
 * under `--out`, which must lie outside the repository. The vault is indexed
 * read-only (`lib/control-plane/evidence/read-only-vault.ts`).
 *
 * - Scout findings come from `--scout-results` (an export of the Scout-result
 *   log) or, without one, are RECONSTRUCTED from the vault: every page a Scout
 *   Attempt vaulted, joined to its candidate-enrichment obligation through the
 *   run records in `--runs`. Reconstructed findings say so in the report.
 * - Marginalia answers come from the staging manifest's INGESTED
 *   `candidate-marginalia-index` entries, each read from the vault.
 * - The identity universe is the committed first-seed ballots (AZ, NH, NJ),
 *   the AZ certified lineup, and the Morris filing contacts' DOMAINS.
 *
 * Without `--fetch` the replay is OFFLINE: it judges held bytes and reports the
 * would-be links only. With `--fetch` it reads every lead robots-first
 * (`lib/hunt/robots-first-fetch.ts`), runs the complete chain on an isolated
 * in-memory plane, and writes `candidate-profiles.package.json` for the owner's
 * installed-runtime `manual-promote --contract=candidate-profiles` door. It is
 * never run against production from a development machine.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { indexVault, readHeldBytes, type HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { scoutedFromScoutResult } from "../lib/control-plane/promotion/pipeline.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { HeldMarginaliaResponse } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { nodeResearchGet, memoryInProcess } from "../lib/hunt/robots-first-fetch.ts";
import { campaignSiteSubjects, type FilingChannels, type LineupContest } from "../lib/candidates/campaign-site-subjects.ts";
import { replayResearchFindings, type HeldRead, type HeldScoutFinding } from "../lib/candidates/research-findings-replay.ts";
import { deriveCandidateUniverse, type BallotDocument, type EnrichmentStores } from "../lib/hunt/candidate-universe.ts";
import type { ManualProjectionPrior } from "../lib/civic-data/manual-projections.ts";
import { METHOD_STORE } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { readMethodStore } from "../lib/method/candidate.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { assignment, present } from "./cli-args.mts";

const ROOT = resolve(process.cwd());
const argv = process.argv;
const vaultRoot = assignment(argv, "vault");
const outArg = assignment(argv, "out");
if (!vaultRoot || !outArg) throw new Error("usage: --vault=<vault root> --out=<dir outside the repository> (see the header)");
const outDir = resolve(outArg);
const fromRoot = relative(ROOT, outDir);
if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) throw new Error("REPLAY_OUT_MUST_BE_OUTSIDE_REPOSITORY");
const now = assignment(argv, "now") ?? new Date().toISOString();
function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/* ------------------------------------------------ the identity universe */

const committed = (...parts: string[]) => json<Record<string, unknown>>(join(ROOT, ...parts));
const cards = committed("data", "ballot", "candidate-cards-2026.json") as { cards: Record<string, Record<string, unknown>> };
const links = committed("data", "ballot", "candidate-links-2026.json") as { links: Record<string, { campaign?: { url?: string } | null }>; hunts: EnrichmentStores["linkHunts"] };
const stores: EnrichmentStores = {
  huntState: {},
  cards: cards.cards,
  links: Object.fromEntries(Object.entries(links.links).map(([key, value]) => [key, value.campaign?.url ?? null])),
  linkHunts: links.hunts,
};
const doc = (path: string, ballot: { contests: BallotDocument["contests"]; candidacies: BallotDocument["candidacies"] }): BallotDocument => ({ path, contests: ballot.contests, candidacies: ballot.candidacies });
const az = committed("data", "states", "az", "ballot", "az-pima-2026.json") as unknown as BallotDocument;
const azFilings = committed("data", "states", "az", "candidates", "az-2026-sos-candidate-filings.json") as unknown as Partial<BallotDocument>;
const nh = committed("data", "states", "nh", "ballot", "nh-merrimack-2026.json") as unknown as BallotDocument;
const nj = committed("data", "states", "nj", "ballot", "nj-morris-2026.json") as unknown as BallotDocument;
/* The three first-seed ballot states, keyed as the candidate-enrichment provider keys them. */
const universe = (state: "az" | "nh" | "nj", documents: BallotDocument[]) => deriveCandidateUniverse({ stateCode: state.toUpperCase(), cycle: 2026, generatedBy: "replay-research-findings (committed first seed)", generatedOn: now.slice(0, 10), documents, stores });
const azDocs = [doc("az-pima-2026", az)];
if (Array.isArray(azFilings.contests) && Array.isArray(azFilings.candidacies)) azDocs.push(doc("az-2026-sos-candidate-filings", azFilings as BallotDocument));
const lineup = committed("data", "states", "az", "ballot", "az-general-lineup-2026.json") as { contests: LineupContest[] };
const njContacts = committed("data", "states", "nj", "ballot", "nj-morris-2026-contacts.json") as { contacts: Record<string, FilingChannels> | FilingChannels[] };
const subjects = campaignSiteSubjects({
  universes: [universe("az", azDocs), universe("nh", [doc("nh-merrimack-2026", nh)]), universe("nj", [doc("nj-morris-2026", nj)])],
  lineups: lineup.contests,
  filings: Array.isArray(njContacts.contacts) ? njContacts.contacts : Object.values(njContacts.contacts),
});

/* ---------------------------------------------------------- held bytes */

const index = await indexVault(vaultRoot);
const heldReads = new Map<string, HeldRead>();
const held = async (artifact: HeldVaultArtifact): Promise<HeldRead | null> => {
  const cached = heldReads.get(artifact.id);
  if (cached) return cached;
  if (artifact.canonicalUrl === null || artifact.attemptId === null) return null;
  let body: string;
  try {
    body = new TextDecoder().decode(await readHeldBytes(artifact));
  } catch {
    return null;
  }
  const read: HeldRead = {
    artifactId: artifact.id, attemptId: artifact.attemptId, canonicalUrl: artifact.canonicalUrl, contentType: artifact.contentType,
    httpStatus: artifact.httpStatus ?? 0, retrievedAt: artifact.retrievedAt ?? now, body, sha256: artifact.contentHash.replace(/^sha256-/, ""),
    methodRouteId: artifact.methodRouteId, permission: artifact.permission,
  };
  heldReads.set(artifact.id, read);
  return read;
};
/* Pages and robots.txt readings a Scout vaulted: the bytes a held finding points at, and the permission they ran under. */
for (const artifact of index.byId.values()) {
  if (!(artifact.methodRouteId ?? "").startsWith("scout:")) continue;
  if (!/html|text\/plain/i.test(artifact.contentType)) continue;
  await held(artifact);
}

/* ------------------------------------------------------------ findings */

const findings: HeldScoutFinding[] = [];
let findingsBasis = "none";
const scoutResultsPath = assignment(argv, "scout-results");
const runsDir = assignment(argv, "runs");
if (scoutResultsPath) {
  findingsBasis = `the Scout-result export ${scoutResultsPath}`;
  for (const result of json<ScoutResult[]>(scoutResultsPath)) {
    if (result.recordClass !== "candidate-enrichment") continue;
    for (const scouted of scoutedFromScoutResult(result)) {
      if (scouted.source.kind !== "SCOUT_RESULT") continue;
      findings.push({ attemptId: result.attemptId, obligationId: result.obligationId, subjectId: result.subjectId, outcome: scouted.source.outcome,
        routeId: scouted.source.routeId, canonicalUrl: scouted.canonicalUrl, artifactIds: scouted.artifactIds, recordedAt: result.recordedAt, summary: scouted.summary });
    }
  }
} else if (runsDir) {
  findingsBasis = `RECONSTRUCTED from the vault's Scout pages and the run records in ${runsDir}`;
  const byAttempt = new Map<string, { obligationId: string; outcome: string }>();
  for (const name of readdirSync(runsDir).filter((file) => file.endsWith(".json"))) {
    let run: { research?: { results?: { attemptId?: string; obligationId?: string; outcome?: string }[] } };
    try { run = json(join(runsDir, name)); } catch { continue; }
    for (const r of run.research?.results ?? []) if (r.attemptId && r.obligationId) byAttempt.set(r.attemptId, { obligationId: r.obligationId, outcome: r.outcome ?? "" });
  }
  const pagesByAttempt = new Map<string, HeldRead[]>();
  for (const read of heldReads.values()) if (/html/i.test(read.contentType)) pagesByAttempt.set(read.attemptId, [...(pagesByAttempt.get(read.attemptId) ?? []), read]);
  for (const [attemptId, pages] of pagesByAttempt) {
    const run = byAttempt.get(attemptId);
    if (!run || !run.obligationId.startsWith("freshness:candidate-enrichment:")) continue;
    if (run.outcome !== "EVIDENCE_FOUND" && run.outcome !== "ROUTE_CANDIDATE") continue;
    const subjectId = run.obligationId.slice("freshness:candidate-enrichment:".length).replace(/#.*$/, "");
    findings.push({ attemptId, obligationId: run.obligationId, subjectId, outcome: run.outcome, routeId: null, canonicalUrl: null,
      artifactIds: pages.map((page) => page.artifactId), recordedAt: pages.map((page) => page.retrievedAt).sort().at(-1)!, summary: `reconstructed: ${pages.length} page(s) the Scout vaulted` });
  }
}

/* ---------------------------------------------------------- marginalia */

const marginalia: HeldMarginaliaResponse[] = [];
const manifestPath = assignment(argv, "manifest");
if (manifestPath) {
  const manifest = json<{ entries: { routeId: string; disposition: string | null; subjectId: string; unresolved: string[] }[] }>(manifestPath);
  for (const entry of manifest.entries) {
    if (entry.routeId !== "candidate-marginalia-index" || entry.disposition !== "INGESTED") continue;
    const ids = (entry.unresolved.find((line) => line.startsWith("artifact(s): ")) ?? "").slice("artifact(s): ".length).split(", ").filter(Boolean);
    for (const id of ids) {
      const artifact = index.byId.get(id);
      if (!artifact) continue;
      const read = await held(artifact);
      if (read) marginalia.push({ subjectId: entry.subjectId, artifactId: read.artifactId, attemptId: read.attemptId, retrievedAt: read.retrievedAt, body: read.body });
    }
  }
}

/* --------------------------------------------------------------- replay */

const priorPath = assignment(argv, "prior");
const prior = priorPath ? json<ManualProjectionPrior>(priorPath) : null;
const fetchLive = present(argv, "fetch");
mkdirSync(outDir, { recursive: true });
const report = await replayResearchFindings({
  subjects,
  findings,
  held: [...heldReads.values()],
  marginalia,
  prior,
  gate: readActivationGate(ROOT),
  now,
  live: fetchLive
    ? {
        runtime: { get: nodeResearchGet, memory: memoryInProcess(), now: () => Date.now(), sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
        vaultRoot: join(outDir, "vault"),
        methodVersion: readMethodStore(join(ROOT, ...METHOD_STORE)).version,
        maxReads: Number(assignment(argv, "max-reads") ?? 200),
      }
    : null,
});
writeFileSync(join(outDir, "replay-report.json"), `${JSON.stringify({ findingsBasis, priorSupplied: prior !== null, ...report, plan: report.plan ? { published: report.plan.published, held: report.plan.held } : null }, null, 1)}\n`);
if (report.plan?.package) writeFileSync(join(outDir, "candidate-profiles.package.json"), `${JSON.stringify(report.plan.package, null, 1)}\n`);
// The denominator a green replay stands on: the candidates the committed first seed names. Empty, it judged nobody.
console.log(floorLine(floored("candidates with a verified campaign site to publish", "the committed first-seed candidates", subjects.size, new Set(report.wouldPublish.map((row) => row.candidacyId)).size)));
console.log(JSON.stringify({
  mode: report.mode,
  findingsBasis,
  findings: report.findings,
  counts: report.counts,
  marginaliaRecords: report.marginalia.length,
  marginaliaWithCandidateBrandedLeads: report.marginalia.filter((row) => row.candidateBrandedLeads.length > 0).length,
  wouldPublish: report.wouldPublish.length,
  held: report.held.length,
  out: outDir,
}, null, 1));
