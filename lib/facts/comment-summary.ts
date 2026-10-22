import { findingFact, finishBoxFinding, takeBoxFinding, type BoxFinding } from "../control-plane/box.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { heldCaptureReader } from "../civic-data/worker-publication-context.ts";
import { translateText } from "../translate/worker.ts";
import { translationRecordIssue, type TextTranslation } from "../translate/records.ts";
import { captureProvenance } from "./capture.ts";
import { boardFor } from "./box-publication.ts";
import { canonicalSubject } from "./entities.ts";
import { readCheckEntity } from "./entity-read.ts";
import { COMMENT_SUMMARY_LEAD } from "./finding-slots.ts";
import { publishClaim, type Clocks, type FactDb, type PublishOutcome, type Query } from "./publish.ts";
import { saveCaptureCopy } from "./source-copy.ts";
import type { ReaderCachePurger } from "../reader/cache.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

const BUILDER = "comment-summary";
const LEASE_MS = 30 * 60_000;

/** The board's comment rule, written in plain English from the page: each sentence carries the passage of the page it came from, and the checker model has confirmed each one. The page is its source. */
export async function publishCommentSummary(input: {
  readonly facts: FactDb & { readonly query: Query }; readonly record: TextTranslation; readonly entityId: string;
  readonly capture: Parameters<typeof saveCaptureCopy>[1]; readonly clocks: Clocks; readonly now: Date; readonly purge?: ReaderCachePurger;
}): Promise<PublishOutcome> {
  const { facts, record } = input;
  if (record.kind !== "COMMENT_RULES" || translationRecordIssue(record) !== null) return { blank: "SUMMARY_NOT_CHECKED" };
  const entity = await readCheckEntity(facts.query, input.entityId);
  if (!entity) return { blank: "BOARD_NOT_IN_THE_FACT_STORE" };
  const copy = await facts.transaction(query => saveCaptureCopy(query, input.capture));
  const derived = record.sentences.map(sentence => ({ text: sentence.text, quote: sentence.quote }));
  const claim = (field: string, value: unknown, valueText: string, quote: string, parts?: typeof derived) =>
    publishClaim(facts, { entity, field, fieldKind: "comment_rule", provenance: captureProvenance(input.capture, entity.hosts), value, valueText, quote,
      ...(parts ? { derived: parts } : {}), copy, producedBy: "box-summary", costUsd: 0 }, input.clocks, input.now, { purge: input.purge });
  const detail = await claim("comment:detail", record.text, record.text, derived[0]!.quote, derived);
  if ("blank" in detail) return detail;
  // The page's own words on how to take part show the body takes comment.
  await claim("comment:period", "YES", derived[0]!.quote, derived[0]!.quote);
  return detail;
}

/** Long participation pages that hunters handed off become checked plain-English comment rules. The caller's transport is the paid-work guard: it refuses when Admin has paused or capped model spending, and then the page waits. */
export async function summarizeCommentPages(input: {
  readonly repos: ControlPlaneRepositories; readonly facts: FactDb & { readonly query: Query }; readonly vault: EvidenceStore;
  readonly clocks: Clocks; readonly now: string; readonly limit: number;
  readonly transportFor: Parameters<typeof translateText>[0]["transportFor"];
  readonly purge?: ReaderCachePurger;
}) {
  const report = { looked: 0, published: 0, held: {} as Record<string, number> };
  const now = new Date(input.now), end = new Date(now.getTime() + LEASE_MS).toISOString();
  const readHeld = heldCaptureReader(input.vault);
  const hold = (reason: string) => { report.held[reason] = (report.held[reason] ?? 0) + 1; };
  for (const row of await input.repos.boxFindings.waitingFor(COMMENT_SUMMARY_LEAD, input.limit)) {
    report.looked++;
    const fact = findingFact(row);
    if (!fact || typeof fact.value !== "string") { hold("PAGE_NOT_NAMED"); continue; }
    const claim = await takeBoxFinding(input.repos.boxFindings, row.id, BUILDER, input.now, end);
    if (!claim) continue;
    const fail = async (reason: string) => { hold(reason); await finishBoxFinding(input.repos.boxFindings, row.id, claim.token, { state: "failed", reason }, input.now); };
    try {
      const capture = await savedPage(input.repos, readHeld, fact.origin, fact.value, input.clocks, now);
      if (!capture) { await fail("PAGE_NOT_SAVED_INSIDE_ITS_CLOCK"); continue; }
      const board = await boardFor(input.facts.query, await canonicalSubject(input.facts.query, row.subjectId));
      const [place] = board ? await input.facts.query("SELECT place_id FROM entity_place WHERE entity_id = $1 ORDER BY place_id LIMIT 1", [board.body.id]) : [];
      const ocdId = place ? String(place.place_id) : null, usps = ocdId ? jurisdictionFromOcdId(ocdId)?.usps : undefined;
      if (!board || !ocdId || !usps) { await fail("BOARD_HAS_NO_PLACE"); continue; }
      const { record } = await translateText({ repos: input.repos, evidence: capture.evidence, now: input.now, transportFor: input.transportFor,
        subject: { kind: "COMMENT_RULES", subjectId: `comment_rules:${board.body.id}`, label: row.exactQuote ?? "", ocdId, state: usps } });
      const outcome = await publishCommentSummary({ facts: input.facts, record, entityId: board.body.id, capture, clocks: input.clocks, now, purge: input.purge });
      if ("blank" in outcome) { await fail(outcome.blank); continue; }
      await finishBoxFinding(input.repos.boxFindings, row.id, claim.token, { state: "built", buildResultId: `comment-summary:${record.id}` }, input.now);
      report.published++;
    } catch (error) {
      await fail(error instanceof Error ? error.message.slice(0, 160) : "SUMMARY_FAILED");
    }
  }
  return report;
}

/** The page a finding cites, as saved by the walk, while it is inside the comment clock. */
async function savedPage(repos: Pick<ControlPlaneRepositories, "artifacts">, readHeld: ReturnType<typeof heldCaptureReader>, origin: BoxFinding["origins"][number],
  url: string, clocks: Clocks, now: Date) {
  const records = (await repos.artifacts.read(origin.workItemId)).filter(record => origin.artifactIds.includes(record.artifactId) && record.canonicalUrl === url);
  for (const record of records) {
    const held = await readHeld(record);
    if (held && (now.getTime() - Date.parse(held.observedAt)) / 3_600_000 <= clocks.windowHours("comment_rule")) return held;
  }
  return null;
}
