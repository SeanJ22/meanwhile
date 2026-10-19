import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { neon } from "@neondatabase/serverless";

const cases = [
  { state: "AZ", target: "ballot-az-pima:attorney-general:glassman-rodney" },
  { state: "NH", target: "ballot-nh-merrimack:governor:warmington-cinde" },
  { state: "NJ", target: "ballot-nj-morris:county-commissioner:selen" },
  { state: "AZ", target: "statewide:az/governor" },
];
const marker = "SRC_MN_CHECK=";
const arg = process.argv.find(value => value.startsWith("--case="))?.slice(7);

if (process.argv.includes("--unit")) {
  const { FederalMoneyBenchmarkStore } = await import("./lib/federal-money-benchmark-store.mts");
  const { DurableEvidenceStore } = await import("../lib/control-plane/evidence/durable-store.ts");
  const { publishCampaignFinanceResource } = await import("../lib/funding/state-publication.ts");
  const { campaignFinanceSource } = await import("../lib/funding/state-sources.ts");
  const { readCampaignFinanceForPlace } = await import("../lib/funding/state-reader.ts");
  const { stateCampaignEvidence } = await import("../lib/ask/state-campaign.ts");
  const state = process.argv.find(value => value.startsWith("--unit-state="))?.slice(13) ?? "WA";
  assert.ok(["WA", "PR"].includes(state));
  const directory = await mkdtemp(join(tmpdir(), "src-money-unit-"));
  const store = await FederalMoneyBenchmarkStore.open(join(directory, "postgres"), `US-${state}:campaign-finance-source`);
  try {
    const migrations = [];
    for (const name of ["0035_r1_fact_store.sql", "0037_r1_fact_scale.sql"]) for (const text of (await readFile(join("lib/db/migrations", name), "utf8")).split("--> statement-breakpoint")) if (text.trim()) migrations.push({ text, params: [] });
    await store.query(migrations);
    const sql = neon(process.env.DATABASE_URL!);
    const query = async (text: string, params: readonly unknown[] = []) => await sql.query(text, [...params]) as Record<string, unknown>[];
    const facts = { query, async transaction<T>(work: (read: typeof query) => Promise<T>) {
      await query("BEGIN");
      try { const result = await work(query); await query("COMMIT"); return result; }
      catch (error) { await query("ROLLBACK"); throw error; }
    } };
    const registered = campaignFinanceSource(state).resources[0], url = new URL(registered.url);
    if (registered.kind === "SOCRATA") { url.searchParams.set("$limit", "500"); url.searchParams.set("$order", ":id"); }
    const resource = { ...registered, kind: "JSON" as const, url: url.href, offsetParameter: undefined, totalPath: undefined,
      body: registered.method ? { ...registered.body, ...(registered.offsetParameter ? { [registered.offsetParameter]: registered.firstOffset ?? 0 } : {}),
        ...(registered.limitParameter ? { [registered.limitParameter]: 500 } : {}) } : registered.body };
    const before = { ...store.bytes }, started = performance.now();
    const result = await publishCampaignFinanceResource(state, resource, { store, facts, vault: new DurableEvidenceStore(join(directory, "vault"), { remote: null }),
      directory: join(directory, "sources"), signal: AbortSignal.timeout(120_000) });
    const division = state === "PR" ? "ocd-division/country:us/territory:pr" : "ocd-division/country:us/state:wa", readStarted = performance.now();
    const read = await readCampaignFinanceForPlace(division, { query });
    const ask = await stateCampaignEvidence([division], division, { query });
    const readMs = performance.now() - readStarted;
    assert.ok(result.records > 0 && result.records <= 500); assert.equal(read.status, "HELD");
    assert.ok(read.records.length <= 100); assert.equal(ask.records.length, read.records.length); assert.ok(readMs < 3000);
    console.log(marker + JSON.stringify({ kind: "unit", state, source: url.href, loaded: result.records, joined: result.records - result.unjoined, unjoined: result.unjoined,
      readerRecords: read.records.length, askRecords: ask.records.length, readerAndAskMs: readMs, elapsedMs: performance.now() - started,
      peakWorkerRssBytes: process.resourceUsage().maxRSS * 1024, databaseReadBytes: store.bytes.read - before.read, databaseWrittenBytes: store.bytes.written - before.written }));
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
} else {
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!connection) throw new Error("The production readonly handle is required.");
  process.env.DATABASE_URL = connection; process.env.WTP_DB_ROLE = "production"; process.env.WTP_VITAL_SIGNS_REPORT = "1";
  if (arg !== undefined) {
    const probe = cases[Number(arg)]; assert.ok(probe);
    const started = performance.now(), { GET } = await import("../app/api/funding/[target]/route.ts");
    const response = await GET(new Request(`http://localhost/api/funding/${encodeURIComponent(probe.target)}`), { params: Promise.resolve({ target: probe.target }) });
    const answer = await response.json(), elapsedMs = performance.now() - started;
    const held = answer.kind === "state" ? answer.data.records : answer.kind === "combined" ? answer.state.records : [];
    if (response.status !== 200) {
      const { stateMoneyReadState } = await import("../lib/funding/state-snapshot.ts");
      const source = stateMoneyReadState(probe.state as "AZ" | "NH" | "NJ");
      assert.fail(JSON.stringify({ answer, source: { kind: source.kind, detail: "detail" in source ? source.detail : null } }));
    }
    assert.ok(held.length > 0, "The held filing did not reach its candidate or official");
    const [{ withReaderRoute, withReaderSelection }, { settleFundingHoldingAnswer }, { campaignMoneyEvidenceFor }] = await Promise.all([
      import("../lib/db/reader-route.ts"), import("../lib/funding/holding-answer.ts"), import("../lib/ask/campaign-money.ts"),
    ]);
    const division = `ocd-division/country:us/state:${probe.state.toLowerCase()}`;
    const ask = await withReaderRoute("/api/ask/grounded", () => withReaderSelection({ states: [probe.state], keys: new Set([probe.target, division]) }, async () => {
      const settled = await settleFundingHoldingAnswer(probe.target, undefined, undefined, [division]); assert.equal(settled.kind, "ANSWER");
      return campaignMoneyEvidenceFor({ kind: "PERSON", id: probe.target, name: held[0].candidateNameAsFiled }, probe.target);
    }));
    for (const record of held) assert.ok(ask.records.some(evidence => evidence.finance?.registeredName === record.registeredName.trim() &&
      JSON.stringify(evidence.finance?.totals) === JSON.stringify(record.totals)), JSON.stringify({ error: "Ask did not read the filing shown on the card", target: probe.target, expected: { name: record.registeredName, totals: record.totals }, actual: ask.records.map(row => row.finance) }));
    assert.ok(elapsedMs < 3000, `Cold money load took ${elapsedMs}ms`);
    console.log(marker + JSON.stringify({ ...probe, kind: "production-place", status: response.status, moneyRecords: held.length, askRecords: ask.records.length,
      elapsedMs, peakWorkerRssBytes: process.resourceUsage().maxRSS * 1024, serverTiming: response.headers.get("server-timing") }));
  } else {
    const sql = neon(connection);
    const [access] = await sql.transaction([sql.query(`SELECT current_user AS role,has_table_privilege(current_user,'civic_data_promotions','SELECT') AS reads,
      has_table_privilege(current_user,'civic_data_promotions','INSERT,UPDATE,DELETE') AS writes`)], { readOnly: true });
    assert.equal(access[0].reads, true); assert.equal(access[0].writes, false);
    const inventory = async () => (await sql.transaction([sql.query(`SELECT scope,count(*)::int AS records,
      count(*) FILTER(WHERE r->'match'->>'allThreeAgree'='true')::int AS joined,
      count(*) FILTER(WHERE r->'match'->>'allThreeAgree' IS DISTINCT FROM 'true')::int AS unjoined,
      md5(string_agg(r::text,E'\\n' ORDER BY r::text)) AS rows_hash
      FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(p.payload->'records') r WHERE p.record_class='STATE_CAMPAIGN_FINANCE'
      GROUP BY scope ORDER BY scope`), sql.query(`SELECT scope,md5(payload::text) AS rows_hash,
      jsonb_array_length(payload->'transactions'->'contributions') AS contributions,jsonb_array_length(payload->'transactions'->'distributions') AS distributions
      FROM civic_data_promotions WHERE record_class='LOCAL_CAMPAIGN_FINANCE' ORDER BY scope`)], { readOnly: true }));
    const before = await inventory();
    for (let index = 0; index < cases.length; index++) {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", resolve("scripts/src-money-check.mts"), `--case=${index}`], { env: process.env });
      let stdout = "", stderr = "";
      const closed = new Promise(resolve => { child.once("close", resolve); child.once("error", () => resolve(-1)); });
      child.stdout.on("data", chunk => { if (stdout.length < 65_536) stdout += chunk; });
      child.stderr.on("data", chunk => { if (stderr.length < 32_768) stderr += chunk; });
      const status = await closed;
      const line = stdout.split("\n").find(line => line.startsWith(marker));
      if (status !== 0 || !line) throw new Error(`Production case ${index} failed: ${stderr.slice(-2500)}`);
      console.log(line);
    }
    const after = await inventory(); assert.deepEqual(after, before, "Held production money changed during the read-only verification");
    console.log(marker + JSON.stringify({ kind: "production-preservation", access: access[0], state: before[0], local: before[1], unchanged: true }));
  }
}
