#!/usr/bin/env node
/**
 * @freshness-reads-here
 *
 * **ONE LIVE-AUDIT PASS OVER WHAT READERS ARE SHOWN.**
 *
 * Reads each curated Reader family's promoted version, samples a few facts per
 * area (more where readers ask, where the refresh is overdue, or where one
 * source stands alone), re-reads each fact's own page at plain pacing, and
 * records green or red in the live-audit log. A red flag is answered at once:
 * the fix list, the lesson, and, where the fact traces to its work, the pull.
 * It never calls a model and never writes a reader store.
 *
 * The runner starts it as a child each cycle beside the console publishers:
 *   node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/live-audit-pass.mts
 * Exit 0 with a one-line summary; exit 1 when the control plane or every family is unreadable.
 *
 * WTP_LIVE_AUDIT_PULLS=on traces a red flag to its work and pulls it. Off (the default) until the
 * publishers read live-audit pulls; until then a red flag goes to the fix list unpulled, so nothing
 * claims a fact left the page while it is still shown.
 */
import { createHash, randomUUID } from "node:crypto";

import { readReaderDemand } from "../lib/control-plane/reader-demand.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { demandRanker, type LiveFactCatalog, type PageRead } from "../lib/control-plane/workers/live-audit.ts";
import { runLiveAuditCycle, workItemTrace } from "../lib/control-plane/workers/live-audit-run.ts";
import { withLiveAuditCatalog } from "../lib/control-plane/workers/live-audit-catalog.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const now = new Date().toISOString();
const url = controlPlaneUrlFromEnv();
if (!url) {
  console.error("live audit: the control plane is not configured; nothing was audited");
  process.exit(1);
}
const repos = await createPgRepositories(url, now, { skipBootstrap: true });

const demand = await readReaderDemand(now).catch(() => null);
const demandRankFor = demand?.kind === "READ"
  ? demandRanker([demand.zips.rows, demand.districts.rows, demand.meetings.rows, demand.officials.rows])
  : undefined;

const fetchPage = async (pageUrl: string): Promise<PageRead | null> => {
  const page = await politeGetText(pageUrl, { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" });
  return { url: pageUrl, text: page.text, retrievedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(page.text).digest("hex"), artifactId: null };
};

/* The fact's page host, for the lesson a red flag writes; remembered as the catalog hands facts over. */
await withLiveAuditCatalog(async ({catalog: published, readable, unread}) => {
if (readable === 0) {
  console.error(`live audit: no Reader family could be read: ${unread.join(", ")}`);
  process.exitCode = 1;
  return;
}
const hosts = new Map<string, string>();
const catalog: LiveFactCatalog = { ...published, factsInArea: async (area, limit) => {
  const facts = await published.factsInArea(area, limit);
  for (const fact of facts) { try { hosts.set(fact.id, new URL(fact.sourceUrl).host); } catch { /* not a URL: no host */ } }
  return facts;
} };

const outcome = await runLiveAuditCycle({ repos, catalog, now, passId: randomUUID(), fetchPage,
  ...(process.env.WTP_LIVE_AUDIT_PULLS === "on" ? { trace: workItemTrace(repos, (factId) => hosts.get(factId) ?? null) } : {}),
  ...(demandRankFor ? { demandRankFor } : {}) });
const s = outcome.summary;
console.log(`live audit: ${s.sampled} sampled in ${s.areas} areas; ${s.green} green, ${s.red} red, ${s.inconclusive} not judged; ` +
  `${s.fetches} re-read, ${s.deferred} deferred; ${outcome.fixed} marked fixed` +
  (unread.length ? `; not read: ${unread.join(", ")}` : "") +
  (outcome.lessonErrors.length ? `; lessons not kept: ${outcome.lessonErrors.length}` : ""));
for (const flag of outcome.redFlags) console.log(`  red: ${flag.factId} -> ${flag.status}`);
});
