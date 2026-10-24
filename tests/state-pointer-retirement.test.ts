import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { reconcileNationalStatePointers, retireNationalStatePointers, RETIRED_STATE_POINTERS } from "../lib/civic-data/state-pointer-retirement.ts";
import { readRetirementProgress, retirementProofTarget } from "../lib/civic-data/state-retirement-progress.ts";

const fixtureEnv = { NODE_ENV: "test" as const, DATABASE_URL: "postgres://fixture/retirement",
  WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) };

test("the production progress SQL reads partitioned proof metadata and survives a later ordinary publication", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,
        acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,validation_receipt jsonb,normalized_hash text,candidate jsonb);
      CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,current_version_id text,last_known_good_version_id text,validation_receipt jsonb,payload jsonb);`);
    const migration = await readFile("lib/db/migrations/0036_ne01.sql", "utf8"), start = migration.indexOf("CREATE FUNCTION reader_payload_node(");
    await db.exec(migration.slice(start, migration.indexOf("--> statement-breakpoint", start)));
    const origin = { versionId: "old-national", recordClass: "CANDIDATE_PROFILE", scope: "US-AZ+US-NH+US-NJ:2026-supported-candidates", readModelHash: "a".repeat(64) };
    const target = retirementProofTarget("candidate-profiles:NH", origin);
    const receipt = (id: string) => ({ decision: "GOOD", candidateId: id, sourceId: target.source_id, recordClass: target.record_class, scope: target.scope });
    await db.query("INSERT INTO civic_data_payload_parts VALUES('proof', $1)", [JSON.stringify({ kind: "object", value: {
      kind: "STATE_AUTHORITY_RETIREMENT", contractId: target.contract_id, state: "NH", origin, readModelHash: "b".repeat(64),
    } })]);
    for (const id of ["proof-version", "ordinary-version"]) await db.query(`INSERT INTO civic_data_candidates VALUES
      ($1,$2,$3,$4,'PROMOTED',true,$1,$1,$5,$6,$7)`, [id,target.source_id,target.record_class,target.scope,JSON.stringify(receipt(id)),"b".repeat(64),
      JSON.stringify({ readModel: {}, ...(id === "proof-version" ? { stateRetirement: { $civicPayloadPart: "proof" } } : {}) })]);
    await db.query("INSERT INTO civic_data_promotions VALUES($1,$2,'ordinary-version','ordinary-version',$3,'{}')", [`${target.record_class}:${target.scope}`,target.source_id,JSON.stringify(receipt("ordinary-version"))]);
    const query = async (sql: string, params: readonly unknown[]) => (await db.query<Record<string, unknown>>(sql,[...params])).rows;
    assert.equal((await readRetirementProgress(query, [target])).get(origin.versionId)?.has("NH"), true);
    await db.query("UPDATE civic_data_candidates SET normalized_hash='different' WHERE id='proof-version'");
    assert.equal((await readRetirementProgress(query, [target])).get(origin.versionId)?.has("NH") ?? false, false);
  } finally { await db.close(); }
});

test("a pass with too little time skips the actual cleanup block and still saves its results", async () => {
  const source = await readFile("scripts/routine-civic-data-runner.mts", "utf8");
  const operation = source.indexOf("    const deadlineMs = PASS_DEADLINE_MS - 30_000, sql = neon(");
  const start = source.lastIndexOf("if (!PUBLISH_NOW", operation), end = source.indexOf("for (const run of readerRuns)", operation);
  let saved = false;
  const code = transpileModule(`(async () => { ${source.slice(start, end)} await saveResults(); })()`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
  }).outputText;
  await runInNewContext(code, { PUBLISH_NOW: false, ONLY: null, PASS_DEADLINE_MS: 1_000_000,
    Date: { now: () => 980_000 }, supervisorFailures: [],
    neon: () => { throw Error("cleanup must not open the database"); },
    saveResults: async () => { saved = true; } });
  assert.equal(saved, true);
  assert.deepEqual(await reconcileNationalStatePointers({ env: fixtureEnv, deadlineMs: Date.now() - 1,
    query: async () => { throw Error("expired cleanup must perform no read"); } }), []);
});

test("nine pointers finish in nine ordinary passes within one day, then cleanup stays quiet", async () => {
  let active = RETIRED_STATE_POINTERS.map(([, recordClass, scope], index) => ({ key: `${recordClass}:${scope}`, recordClass, scope,
    current_version_id: `origin-${index}`, promoted_at: "2026-10-15T12:00:00Z", normalized_hash: "a".repeat(64) }));
  const done = new Set<string>(), prepared: string[] = [];
  const query = async (sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
    if (sql.startsWith("SELECT p.key")) return active;
    if (sql.includes("AS complete FROM expected")) return JSON.parse(params[0] as string).map((row: { origin_version: string; state: string }) => ({ ...row, complete: done.has(`${row.origin_version}:${row.state}`) }));
    assert.match(sql, /DELETE FROM civic_data_promotions/);
    assert.equal(done.size, 339, "all nine origins' state proofs must be durable before retirement");
    const retired = active.map(row => ({ key: row.key })); active = []; return retired;
  };
  const input: Parameters<typeof reconcileNationalStatePointers>[0] = { query, env: fixtureEnv, deadlineMs: Date.now() + 300_000,
    slots: { acquire: async () => () => {} }, launch: async command => {
      const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
      let stdout: string;
      if (arg("prepare")) {
        const origins = JSON.parse(await readFile(arg("origins")!, "utf8")); assert.equal(origins.length, 1);
        const origin = origins[0]; prepared.push(origin.versionId);
        const units = arg("states")!.split(",").map(state => ({ family: origin.family, state,
          contractId: `${origin.family}:${state}`, originVersionId: origin.versionId,
          inputFile: join(arg("prepare")!, `${state}.json`), fileSha256: "b".repeat(64) }));
        const manifestPath = join(arg("prepare")!, "manifest.json"); await writeFile(manifestPath, JSON.stringify({ units, unassigned: [] }));
        stdout = "STATE_RETIREMENT_PREPARED=" + JSON.stringify({ manifestPath });
      } else {
        const [family, state] = arg("contract")!.split(":"); const origin = command.id.split(":retirement:")[1];
        assert.equal(done.has(`${origin}:${state}`), false); done.add(`${origin}:${state}`);
        stdout = "STATE_RETIREMENT_UNIT=" + JSON.stringify({ family, state, status: "PUBLISHED" });
      }
      return { id: command.id, status: 0, signal: null, termination: "EXITED", errorMessage: null, stdout, stderr: "" };
    } };
  let passes = 0, retired = 0;
  while (active.length && passes < 48) {
    passes++; retired += await retireNationalStatePointers(query, await reconcileNationalStatePointers(input));
  }
  assert.equal(retired, 9); assert.equal(passes, 9); assert.ok(passes * 30 * 60_000 < 86_400_000);
  assert.equal(new Set(prepared).size, 9);
  assert.deepEqual(await reconcileNationalStatePointers(input), []); assert.equal(prepared.length, 9);
});

test("national retirement requires every exact GOOD state replacement and keeps ordinary deletion forbidden", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE civic_data_promotions (
      key text PRIMARY KEY, source_id text, record_class text, scope text, current_version_id text,
      last_known_good_version_id text, validation_receipt jsonb, promoted_at timestamptz DEFAULT now());
      CREATE TABLE civic_data_candidates (id text PRIMARY KEY, source_id text, record_class text, scope text,
      state text, promoted_version_id text, last_known_good_version_id text, validation_receipt jsonb);`);
    await db.exec(await readFile(new URL("../lib/db/migrations/0039_sb01b_state_pointer_retirement.sql", import.meta.url), "utf8"));
    await db.exec(`CREATE TRIGGER civic_data_promotions_no_delete_or_rewrite BEFORE UPDATE OR DELETE
      ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION enforce_civic_data_promotion_mutation();`);
    const add = async (recordClass: string, scope: string, source: string) => {
      const key = `${recordClass}:${scope}`, id = `version:${key}`;
      await db.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,'PROMOTED',$1,$1,'{\"decision\":\"GOOD\"}')", [id, source, recordClass, scope]);
      await db.query("INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,validation_receipt) VALUES($1,$2,$3,$4,$5,$5,'{\"decision\":\"GOOD\"}')", [key, source, recordClass, scope, id]);
      return key;
    };
    const national = await add("BALLOT_CANDIDACY", "US:state-election-ballots", "official-ballot-authorities");
    const remove = (key: string) => db.query("DELETE FROM civic_data_promotions WHERE key=$1 RETURNING key", [key]);
    await assert.rejects(remove(national), /replacements are not all GOOD/);
    for (const state of REGISTRY_STATES) await add("BALLOT_CANDIDACY", `US-${state}:state-election-ballots`, "official-ballot-authorities");
    await db.query("UPDATE civic_data_candidates SET source_id='wrong-authority' WHERE scope='US-AZ:state-election-ballots'");
    await assert.rejects(remove(national), /replacements are not all GOOD/);
    await db.query("UPDATE civic_data_candidates SET source_id='official-ballot-authorities',validation_receipt='{\"decision\":\"CANNOT_TELL\"}' WHERE scope='US-AZ:state-election-ballots'");
    await assert.rejects(remove(national), /replacements are not all GOOD/);
    await db.query("UPDATE civic_data_candidates SET validation_receipt='{\"decision\":\"GOOD\"}' WHERE scope='US-AZ:state-election-ballots'");
    assert.equal((await remove(national)).rows.length, 1);
    await assert.rejects(remove("BALLOT_CANDIDACY:US-AZ:state-election-ballots"), /DELETE is forbidden/);
    const nh = await add("BALLOT_CANDIDACY", "US-NH:merrimack:2026-general", "nh-election-authorities");
    assert.equal((await remove(nh)).rows.length, 1, "the real NH Merrimack authority retires");
    const incorrectNh = await add("BALLOT_CANDIDACY", "US-NH:2026-general:supported-ballot", "nh-election-authorities");
    await assert.rejects(remove(incorrectNh), /DELETE is forbidden/);
    for (const [recordClass, oldScope, suffix, source] of [
      ["CANDIDATE_PROFILE", "US-AZ+US-NH+US-NJ:2026-supported-candidates", "candidate-profiles", "candidate-primary-publications"],
      ["CANDIDATE_PUBLICATION", "US-AZ+US-NH+US-NJ:2026-supported-candidates", "candidate-publications", "candidate-primary-publications"],
      ["VOTING_SITE", "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions", "voting-sites", "voting-sites"],
      ["CURATED_READER_RECORD", "US:candidate-campaign-sites-derived", "candidate-campaign-sites-derived", "candidate-campaign-site-chain"],
    ]) {
      const old = await add(recordClass, oldScope, source);
      for (const state of REGISTRY_STATES) await add(recordClass, `US-${state}:${suffix}`, source);
      await db.query("UPDATE civic_data_candidates SET source_id='curated-reader-primary-sources' WHERE scope=$1", [`US-AZ:${suffix}`]);
      await assert.rejects(remove(old), /replacements are not all GOOD/);
      await db.query("UPDATE civic_data_candidates SET source_id=$1 WHERE scope=$2", [source, `US-AZ:${suffix}`]);
      assert.equal((await remove(old)).rows.length, 1, `${suffix} accepts its actual registered source ID`);
    }
    const registry = await add("REGISTRY_RUNTIME_BINDING", "US:reader-registry-runtime-bindings", "registry-reviewed-bindings");
    for (const state of REGISTRY_STATES.filter(state => state !== "MP")) await add("REGISTRY_RUNTIME_BINDING", `US-${state}:reader-registry-runtime`, "registry-reviewed-bindings");
    await assert.rejects(remove(registry), /replacements are not all GOOD/);
    await add("REGISTRY_RUNTIME_BINDING", "US-MP:reader-registry-runtime", "registry-reviewed-bindings");
    assert.equal((await remove(registry)).rows.length, 1);
    const ordinary = await add("MEETING", "ordinary-place", "ordinary-source");
    await assert.rejects(remove(ordinary), /DELETE is forbidden/);
    await assert.rejects(db.query("UPDATE civic_data_promotions SET scope='renamed' WHERE key=$1", [ordinary]), /identity cannot be rewritten/);
  } finally { await db.close(); }
});


test("cleanup resumes one unfinished origin per pass, skips durable state proofs, and caps memory at the pass deadline", async () => {
  const origins = [
    { key: "BALLOT_CANDIDACY:US:state-election-ballots", current_version_id: "national-after-A", promoted_at: "2026-10-15T12:00:00Z", normalized_hash: "a".repeat(64) },
    { key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general", current_version_id: "nh-after-A", promoted_at: "2026-10-15T13:00:00Z", normalized_hash: "b".repeat(64) },
  ];
  const completed = new Set<string>(), prepared: string[] = [], running = new Set<string>();
  const deferred: string[] = []; let refuseFirst = true;
  const deadlineMs = Date.now() + 60_000;
  const input: Parameters<typeof reconcileNationalStatePointers>[0] = { deadlineMs,
    query: async (sql, params) => {
      if (sql.startsWith("SELECT p.key")) return origins;
      return (JSON.parse(params[0] as string) as { origin_version: string; state: string }[]).map(target => ({ ...target,
        complete: completed.has(`${target.origin_version}:${target.state}`) }));
    },
    env: { NODE_ENV: "test", DATABASE_URL: "postgres://fixture/retirement", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) },
    onDeferred: (id, scope, detail) => { assert.match(id, /ballot-contests:AL/); assert.equal(scope, "US-AL:state-election-ballots"); assert.match(detail, /^WORKER_MEMORY_DEADLINE:/); deferred.push(id); },
    slots: { async acquire(id, deadline) {
      assert.equal(deadline, deadlineMs);
      if (refuseFirst && id!.startsWith("ballot-contests:AL:")) { refuseFirst = false; throw Error("WORKER_MEMORY_DEADLINE: memory remains owed"); }
      assert.ok(!running.has(id!)); running.add(id!); return () => { running.delete(id!); };
    } },
    launch: async (command, options) => {
      assert.equal(options.deadlineMs, deadlineMs);
      const value = (key: string) => command.args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
      let stdout: string;
      if (value("prepare")) {
        const selected = JSON.parse(await readFile(value("origins")!, "utf8"));
        assert.equal(selected.length, 1); prepared.push(selected[0].versionId);
        const manifestPath = join(value("prepare")!, "manifest.json");
        const units = value("states")!.split(",").map(state => ({ family: "ballot-contests", state, contractId: `ballot-contests:${state}`,
          originVersionId: selected[0].versionId, inputFile: join(value("prepare")!, `${selected[0].versionId}-${state}.json`), fileSha256: "c".repeat(64) }));
        await writeFile(manifestPath, JSON.stringify({ units, unassigned: [] }));
        stdout = "STATE_RETIREMENT_PREPARED=" + JSON.stringify({ manifestPath });
      } else {
        const state = value("contract")!.split(":")[1], origin = command.id.split(":retirement:")[1];
        assert.ok(!completed.has(`${origin}:${state}`), "completed state units never run again");
        completed.add(`${origin}:${state}`);
        stdout = "STATE_RETIREMENT_UNIT=" + JSON.stringify({ family: "ballot-contests", state, status: "PUBLISHED" });
      }
      return { id: command.id, status: 0, signal: null, termination: "EXITED", errorMessage: null, stdout, stderr: "" };
    } };
  assert.deepEqual(await reconcileNationalStatePointers(input), [], "the second national origin is still owed");
  assert.equal(completed.size, 55); assert.equal(deferred.length, 1);
  assert.deepEqual(await reconcileNationalStatePointers(input), [], "only the unfinished AL copy is prepared before moving to the next origin");
  const done = await reconcileNationalStatePointers(input);
  assert.equal(done.length, 2);
  assert.deepEqual(prepared, ["national-after-A", "national-after-A", "nh-after-A"]);
  await reconcileNationalStatePointers(input);
  assert.equal(prepared.length, 3, "all completed copies skip preparation entirely");
  assert.equal(running.size, 0);
});

test("retirement uses canonical state replacements and atomically refuses a moved original", async () => {
  const origins = [{ family: "ballot-contests" as const, recordClass: "BALLOT_CANDIDACY" as const, scope: "US-NH:merrimack:2026-general", versionId: "pinned-NH", promotedAt: "2026-10-15T12:00:00Z", hash: "a".repeat(64) }];
  let changed = false;
  const query = async (sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
    if (sql.includes("AS complete FROM expected")) return JSON.parse(params[0] as string).map((target: { origin_version: string; state: string }) => ({ ...target, complete: true }));
    assert.match(sql, /FOR UPDATE OF p/);
    assert.match(sql, /LEFT JOIN locked/);
    assert.deepEqual(JSON.parse(params[0] as string), [{ key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general", current_version_id: "pinned-NH" }]);
    return changed ? [] : [{ key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general" }];
  };
  assert.equal(await retireNationalStatePointers(query, origins), 1);
  changed = true;
  await assert.rejects(retireNationalStatePointers(query, origins), /ORIGIN_MOVED/);
});
