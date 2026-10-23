import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import { indexReportedFinding } from "../lib/control-plane/box.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishBoxFindings } from "../lib/facts/box-publication.ts";
import { summarizeCommentPages } from "../lib/facts/comment-summary.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { COMMENT_SUMMARY_LEAD } from "../lib/facts/finding-slots.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import { factDb } from "./helpers/fact-db.ts";

await installRegistryAuthority();

const ROOT = join(import.meta.dirname, ".."), NOW = "2026-10-22T12:00:00.000Z", SAVED = "2026-10-22T11:00:00.000Z";
const BREWTON = "al:city:city-of-brewton", URL = "https://www.cityofbrewton.org/government/public-comment";
const RULES = [
  "Anyone who wishes to speak at a City Council meeting must sign the speaker sheet at the clerk's desk before the meeting begins.",
  "Each speaker is limited to three minutes.",
  "Written comments may be emailed to the City Clerk and will be read into the record.",
];
const PAGE = `<html><head><title>Public Comment - City of Brewton, Alabama</title></head><body><main><h1>Public Comment at Council Meetings</h1>
  <p>The City of Brewton welcomes the voices of its residents. ${RULES[0]} ${RULES[1]} ${RULES[2]}</p>
  <p>${"The City Council meets in the Council Chambers of City Hall, 1010A Douglas Ave., Brewton, Alabama. ".repeat(6)}</p></main></body></html>`;
const reply = (request: ModelRequest, input: unknown): ModelResponse => ({ model: request.model, stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "t", name: request.tools[0].name, input }], usage: { input_tokens: 100, output_tokens: 100 } });

async function world() {
  const facts = await factDb(), repos = createMemoryRepositories(), vault = new MemoryEvidenceStore();
  await ensureFactEntities(facts, ROOT, ["al"]);
  const { artifact } = recordAcquisition({ canonicalUrl: URL, retrievedAt: SAVED, httpStatus: 200, contentType: "text/html", sourceId: "www.cityofbrewton.org",
    methodRouteId: "scout:fetch_public", workItemId: "wi-walk", attemptId: "at-walk", permission: "ALLOWED", transport: "REACHABLE" }, PAGE);
  await putArtifact(vault, "freshness", artifact, Buffer.from(PAGE));
  await repos.artifacts.append("wi-walk", artifact.id, { artifactId: artifact.id, workItemId: "wi-walk", routeTaskId: null, attemptId: artifact.attemptId, tier: artifact.tier,
    contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: URL, partial: false, recordedAt: SAVED }, SAVED);
  await indexReportedFinding(repos.boxFindings, { workItemId: "wi-walk", attemptId: "at-walk", obligationId: `hunt:packet:${BREWTON}`, missionPart: null,
    finding: { index: 0, subjectId: `${BREWTON}#governing`, subjectHint: "Brewton", field: "publicComment.page", value: URL, sourceUrl: URL,
      exactQuote: "Public Comment at Council Meetings", artifactIds: [artifact.id] } }, SAVED);
  const clocks = factClocks(null);
  const noFetch = async () => { throw new Error("the page is held inside its clock"); };
  const handed = await publishBoxFindings({ repos, facts, vault, fetch: noFetch, store: new MemoryRoutineDataStore(), clocks, now: NOW, limit: 10 });
  return { facts, repos, vault, clocks, handed };
}
const summary = RULES.join(" ");

test("a long page about taking part becomes the board's plain-English comment rule: each sentence quoted from the page and checked by a second model", async () => {
  const { facts, repos, vault, clocks, handed } = await world();
  assert.equal(handed.handed, 1, "the page is handed to the comment-rules writer, not published as a link");
  assert.equal((await repos.boxFindings.list())[0]!.value.waitingFor?.reason, COMMENT_SUMMARY_LEAD);
  let calls = 0;
  const transportFor = () => async (request: ModelRequest) => {
    calls++;
    const sentences = RULES.map(text => ({ field: "text", text, quote: text }));
    return reply(request, request.tools[0].name === "write_text_translation" ? { text: summary, sentences }
      : { checked: sentences.map(({ field, text }) => ({ field, text, supported: true })) });
  };
  const report = await summarizeCommentPages({ repos, facts, vault, clocks, now: NOW, limit: 10, transportFor });
  assert.deepEqual([report.looked, report.published, calls], [1, 1, 2], JSON.stringify(report));
  const rows = await facts.query(`SELECT e.id, f.field, f.value_text, f.quote, f.status, f.produced_by, s.url FROM fact f JOIN entity e ON e.id = f.entity_id JOIN source_copy s ON s.id = f.source_copy_id
    WHERE e.parent_id = $1 ORDER BY f.field`, [BREWTON]);
  assert.deepEqual(rows.map(row => [row.id, row.field, row.status, row.url]), [
    [`${BREWTON}#governing`, "comment:detail", "live", URL], [`${BREWTON}#governing`, "comment:period", "live", URL]]);
  assert.equal(rows[0]!.value_text, summary);
  assert.equal(rows[0]!.quote, RULES[0], "the fact quotes the page's own passage");
  assert.equal((await repos.boxFindings.list())[0]!.value.state, "built");
});

test("a sentence the checker will not support, or a quote that is not on the page, publishes nothing and the page waits", async () => {
  for (const mode of ["unsupported", "invented quote"] as const) {
    const { facts, repos, vault, clocks } = await world();
    const transportFor = () => async (request: ModelRequest) => {
      const sentences = RULES.map(text => ({ field: "text", text, quote: mode === "invented quote" ? `${text} Fees apply.` : text }));
      return reply(request, request.tools[0].name === "write_text_translation" ? { text: summary, sentences }
        : { checked: sentences.map(({ field, text }, at) => ({ field, text, supported: at !== 1 })) });
    };
    const report = await summarizeCommentPages({ repos, facts, vault, clocks, now: NOW, limit: 10, transportFor });
    assert.equal(report.published, 0, mode);
    assert.deepEqual(await facts.query("SELECT 1 FROM fact f JOIN entity e ON e.id = f.entity_id WHERE e.parent_id = $1", [BREWTON]), [], mode);
    const [row] = await repos.boxFindings.list();
    assert.equal(row!.value.state, "waiting", mode);
    assert.equal(row!.value.attempts.at(-1)?.outcome, "failed", mode);
  }
});

test("when paid model work is closed the page waits and nothing is published", async () => {
  const { facts, repos, vault, clocks } = await world();
  const report = await summarizeCommentPages({ repos, facts, vault, clocks, now: NOW, limit: 10, transportFor: () => async () => { throw new Error("The owner's model ceiling is reached"); } });
  assert.deepEqual([report.published, Object.keys(report.held).length], [0, 1]);
  assert.equal((await repos.boxFindings.list())[0]!.value.waitingFor?.reason, COMMENT_SUMMARY_LEAD);
});
