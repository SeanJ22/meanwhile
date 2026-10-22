#!/usr/bin/env node
/**
 * @freshness-reads-here
 *
 * **ONE LIVE-AUDIT PASS OVER WHAT READERS ARE SHOWN.**
 *
 * Reads each curated Reader family's promoted version, samples a few facts per
 * area (more where readers ask, where the refresh is overdue, or where one
 * source stands alone), re-reads each fact's own page at plain pacing, and
 * records green or red in the live-audit log and opens Sean's flags.
 *
 * The runner starts it as a child each cycle beside the console publishers:
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/live-audit-pass.mts
 * Exit 0 with a one-line summary; exit 1 when the control plane or every family is unreadable.
 *
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { CURATED_READER_CONTRACT_IDS, readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { readReaderDemand } from "../lib/control-plane/reader-demand.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { curatedReaderCatalog, demandRanker, type LiveFact, type LiveFactCatalog, type PageRead } from "../lib/control-plane/workers/live-audit.ts";
import { combinedCatalog, runLiveAuditCycle } from "../lib/control-plane/workers/live-audit-run.ts";
import { politeGetBytes } from "../lib/sources/http.ts";
import { vaultCapture } from "../lib/facts/capture.ts";
import { readerFactDb } from "../lib/facts/db.ts";
import { flagReaderRecord } from "../lib/facts/owner-flags.ts";
import { factAuditCatalog } from "../lib/facts/audit-catalog.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("live audit: the control plane is not configured; nothing was audited");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });
const factStore = readerFactDb(prepareProductionCivicDataWrite().connection);

const catalogs: LiveFactCatalog[] = [factAuditCatalog(factStore.query)];
const unread: string[] = [];
for (const id of CURATED_READER_CONTRACT_IDS) {
  try {
    const read = await readCuratedReaderProjection(id, { bypassCache: true });
    if (read.kind === "PROMOTED") catalogs.push(curatedReaderCatalog(id, read.value.records));
    else unread.push(`${id} (${read.kind})`);
  } catch (error) {
    unread.push(`${id} (${error instanceof Error ? error.name : "error"})`);
  }
}
if (catalogs.length === 0) {
  console.error(`live audit: no Reader family could be read: ${unread.join(", ")}`);
  process.exit(1);
}

const demand = await readReaderDemand(now).catch(() => null);
const demandRankFor = demand?.kind === "READ"
  ? demandRanker([demand.zips.rows, demand.districts.rows, demand.meetings.rows, demand.officials.rows])
  : undefined;

const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
const pages = new Map<string, Promise<PageRead | null>>();
const fetchPage = (pageUrl: string): Promise<PageRead | null> => {
  if (!pages.has(pageUrl)) pages.set(pageUrl, (async () => {
    const page = await politeGetBytes(pageUrl);
    const saved = await vaultCapture({ vault, url: pageUrl, bytes: page.bytes, contentType: page.contentType,
      httpStatus: page.status, retrievedAt: new Date().toISOString() });
    if ("error" in saved) return null;
    await repos.artifacts.append(saved.record.workItemId, `${saved.record.artifactId}:${saved.record.recordedAt}`, saved.record, saved.record.recordedAt);
    const evidence = saved.capture.evidence;
    return { url: pageUrl, text: evidence.text, retrievedAt: saved.capture.observedAt, contentHash: evidence.contentHash, artifactId: evidence.artifactId };
  })());
  return pages.get(pageUrl)!;
};

/* The fact's page host, for the lesson a red flag writes; remembered as the catalog hands facts over. */
const facts = new Map<string, LiveFact>();
const combined = combinedCatalog(catalogs);
const catalog: LiveFactCatalog = { areas: combined.areas, factsInArea: async (area, limit) => {
  const selected = await combined.factsInArea(area, limit);
  for (const fact of selected) facts.set(fact.id, fact);
  return selected;
} };

const outcome = await runLiveAuditCycle({ repos, catalog, now, passId: randomUUID(), fetchPage,
  isPublished: async result => {
    if (result.family !== "comment-access") return null;
    const [held] = await factStore.query("SELECT 1 FROM fact WHERE entity_id=$1 AND field='comment:period' AND status='live' LIMIT 1",[result.area]);
    return Boolean(held);
  },
  flag: async result => {
    const fact = facts.get(result.factId);
    if (!fact) throw new Error("The audited fact is missing from this pass.");
    await flagReaderRecord(factStore.query, fact, result);
  },
  ...(demandRankFor ? { demandRankFor } : {}) });
const s = outcome.summary;
console.log(`live audit: ${s.sampled} sampled in ${s.areas} areas; ${s.green} green, ${s.red} red, ${s.inconclusive} not judged; ` +
  `${s.fetches} re-read, ${s.deferred} deferred; ${outcome.fixed} marked fixed` +
  (unread.length ? `; not read: ${unread.join(", ")}` : "") +
  (outcome.lessonErrors.length ? `; lessons not kept: ${outcome.lessonErrors.length}` : ""));
for (const flag of outcome.redFlags) console.log(`  red: ${flag.factId} -> ${flag.status}`);
