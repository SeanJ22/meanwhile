/** Export and replay one state's FEC rows at a time through the production readonly role. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { FEDERAL_DIRECTORY_STATES } from "../lib/officials/federal-directory-data-plane.ts";

const [urlFile, output] = process.argv.slice(2);
assert.ok(urlFile && output, "Pass a production readonly URL file and output JSON path");
const connection = (await readFile(urlFile, "utf8")).trim();
const target = new URL(connection);
assert.equal(target.username, "readonly");
assert.ok(target.hostname.replace(/-pooler(?=\.)/, "").startsWith("ep-dry-river-axwtolzc."));
const sql = neon(connection);
const [identity] = await sql.query("SELECT current_user AS role,pg_has_role(current_user,'neon_superuser','member') AS superuser_member");
assert.equal(identity.role, "readonly"); assert.equal(identity.superuser_member, false);
const candidateIds = ["cv-5557822ce8f71240a9df9554d31a1a95", "cv-e65b24eba8737733c2a1ea1bac7e5a7e"];
const query = `WITH state_rows AS (
 SELECT c.id,c.retrieved_at,c.candidate->'retrieval' AS retrieval,
  (c.candidate->'readModel') || jsonb_build_object(
   'candidates',COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(c.candidate->'readModel'->'candidates') r WHERE r->>'state'=$1),'[]'::jsonb),
   'secondHop',COALESCE((SELECT jsonb_agg(h) FROM jsonb_array_elements(c.candidate->'readModel'->'secondHop') h
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(c.candidate->'readModel'->'candidates') r
     WHERE r->>'state'=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'topContributions') t
      WHERE t->>'contributorCommitteeId'=h->>'committeeId'))),'[]'::jsonb)) AS snapshot
 FROM civic_data_candidates c WHERE c.id=ANY($2::text[])
 ) SELECT (SELECT jsonb_agg(to_jsonb(s)) FROM state_rows s) AS snapshots,
  p.current_version_id AS directory_version,reader_payload_value(reader_payload_node(p.payload)->'roster') AS roster
 FROM civic_data_promotions p WHERE p.record_class='FEDERAL_DIRECTORY' AND p.scope=$3`;
const temporary = await mkdtemp(join(tmpdir(), "src-01-fec-states-"));
const states: Record<string, unknown>[] = [];
try {
  for (const state of FEDERAL_DIRECTORY_STATES) {
    const inputPath = join(temporary, `${state}-input.json`), resultPath = join(temporary, `${state}-result.json`);
    try {
      const [input] = await sql.query(query, [state, candidateIds, `US-${state}:current-congress-directory`]);
      assert.ok(input, "The production state directory is not held");
      await writeFile(inputPath, JSON.stringify(input));
      let exitError: unknown;
      try {
        execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
          "scripts/src-01-fec-read-only-replay.mts", state, inputPath, resultPath], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) { exitError = error; }
      const result = JSON.parse(await readFile(resultPath, "utf8")) as Record<string, unknown>;
      states.push(result);
      if (exitError && result.status !== "FAILED") throw exitError;
      console.log(JSON.stringify({ state, status: result.status }));
    } catch (error) {
      states.push({ state, status: "FAILED", failure: error instanceof Error ? error.message : String(error) });
      console.log(JSON.stringify({ state, status: "FAILED" }));
    } finally { await rm(inputPath, { force: true }); await rm(resultPath, { force: true }); }
  }
  const failures = states.filter(row => row.status !== "PASS");
  const totals = { source: 0, published: 0, cardsWithAmounts: 0, registrationOnly: 0, joinedHolderCards: 0 };
  for (const row of states.filter(row => row.status === "PASS")) {
    const runs = row.runs as readonly { publishedRecords: number; readerRecords: number; cardsRendered: number;
      cardsWithAmounts: number; registrationOnlyCards: number; joinedHolderCards: number;
      readerReadback: string; confirmed: boolean }[];
    assert.equal(runs.length, 3);
    for (const run of runs) {
      assert.equal(run.publishedRecords, run.readerRecords); assert.equal(run.readerRecords, run.cardsRendered);
      assert.ok(run.readerReadback === "PASS" || run.confirmed && run.readerReadback === "unchanged-version-confirmed");
    }
    totals.source += Number(row.sourceRecords); totals.published += runs[0].publishedRecords;
    totals.cardsWithAmounts += runs[0].cardsWithAmounts; totals.registrationOnly += runs[0].registrationOnlyCards;
    totals.joinedHolderCards += runs[0].joinedHolderCards;
  }
  await writeFile(output, JSON.stringify({
    kind: "all-covered-states-production-read-only-normalized-projection-replay", productionWrites: 0,
    coverage: "50 states, District of Columbia, AS, GU, MP, PR and VI; all 56 federal-directory jurisdictions",
    sourceCandidate: candidateIds[0], priorCandidate: candidateIds[1], productionRole: identity.role,
    scope: "One state's normalized source/prior rows and real held congressional directory at a time; only contributing committees linked to those state rows are included",
    limitation: "No archived FEC HTTP-body replay, newly observed provider check, deployed-page or future live-run claim. Source dates remain unchanged. Shared contributing committees may appear in more than one state.",
    upstream: "Standing routine scheduler, FEC current-election registrations/filed totals, and exact native FEC IDs from production congressional directories",
    downstream: "projectFecDiscovery → fecFundingCandidate → registered routine publisher → canonical pointer → typed funding reader → fundingAnswerForTarget → every FundingDisplay card",
    coveredStates: FEDERAL_DIRECTORY_STATES.length, passedStates: states.length - failures.length,
    failures: failures.map(row => ({ state: row.state, reason: row.failure })), states, totals,
  }, null, 2) + "\n");
  console.log(JSON.stringify({ covered: states.length, passed: states.length - failures.length, failures: failures.length, output }));
  if (failures.length) process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
