import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { reconcileNationalStatePointers, retireNationalStatePointers } from "../lib/civic-data/state-pointer-retirement.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { STATE_BALLOT_FAMILIES, stateBallotContractId, stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";

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


test("terminal preparation stays scalar and serializes same-state origins before releasing exact pins", async t => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-dispatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origins = [
    { key: "BALLOT_CANDIDACY:US:state-election-ballots", current_version_id: "national-after-A", promoted_at: "2026-10-15T12:00:00Z", normalized_hash: "a".repeat(64) },
    { key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general", current_version_id: "nh-after-A", promoted_at: "2026-10-15T13:00:00Z", normalized_hash: "b".repeat(64) },
  ];
  const running = new Set<string>(), settled: string[] = [];
  const actual = await reconcileNationalStatePointers({ query: async sql => { assert.ok(!sql.includes("p.payload")); return origins; },
    env: { NODE_ENV: "test", DATABASE_URL: "postgres://fixture/retirement", WTP_CONTROL_PLANE_READS_DIR: "/var/lib/meanwhile/control-plane-reads",
      WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) },
    slots: { async acquire(id) { assert.ok(!running.has(id!)); running.add(id!); return () => { running.delete(id!); }; } },
    launch: async command => {
      const value = (key: string) => command.args.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
      let stdout: string;
      if (value("prepare")) {
        const manifestPath = join(value("prepare")!, "manifest.json");
        const units = origins.map((origin, index) => ({ family: "ballot-contests", state: "NH", contractId: "ballot-contests:NH",
          originVersionId: origin.current_version_id, inputFile: join(value("prepare")!, `${index}.json`), fileSha256: "c".repeat(64) }));
        await writeFile(manifestPath, JSON.stringify({ units, unassigned: [] }));
        stdout = "STATE_RETIREMENT_PREPARED=" + JSON.stringify({ manifestPath });
      } else {
        assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CONTRACT, "ballot-contests:NH");
        assert.equal(running.size, 1, "two origins for one state never publish concurrently");
        settled.push(command.id);
        stdout = 'STATE_RETIREMENT_UNIT={"family":"ballot-contests","state":"NH","status":"PUBLISHED"}';
      }
      return { id: command.id, status: 0, signal: null, termination: "EXITED", errorMessage: null, stdout, stderr: "" };
    } });
  assert.deepEqual(actual.map(row => row.versionId), ["national-after-A", "nh-after-A"]);
  assert.deepEqual(settled, ["ballot-contests:NH:retirement:national-after-A", "ballot-contests:NH:retirement:nh-after-A"]);
  assert.equal(running.size, 0);
});

test("retirement uses canonical state replacements and atomically refuses a moved original", async () => {
  const rows = new Map<string, Record<string, unknown>>();
  for (const state of REGISTRY_STATES) {
    const descriptors = [{ family: "registry-runtime", contract: requiredManualProductionContract(stateRegistryRuntimeContractId(state)) },
      ...STATE_BALLOT_FAMILIES.map(family => ({
        family: family === "candidate-corpus" ? "candidate-publications" : family,
        contract: family === "candidate-campaign-sites-derived" ? requiredRoutineContract(stateBallotContractId(family, state)) : requiredManualProductionContract(stateBallotContractId(family, state)),
      }))];
    for (const { family, contract } of descriptors) {
      const key = `${contract.recordClass}:${contract.scope}`, version = `${family}-${state}`;
      rows.set(key, { key, source_id: contract.sourceId, current_version_id: version, last_known_good_version_id: version, decision: "GOOD" });
    }
  }
  const origins = [{ family: "ballot-contests" as const, recordClass: "BALLOT_CANDIDACY" as const, scope: "US-NH:merrimack:2026-general", versionId: "pinned-NH", promotedAt: "2026-10-15T12:00:00Z", hash: "a".repeat(64) }];
  let changed = false;
  const query = async (sql: string, params: readonly unknown[]): Promise<readonly Record<string, unknown>[]> => {
    if (sql.startsWith("SELECT key")) return (params[0] as string[]).flatMap(key => { const row = rows.get(key); return row ? [row] : []; });
    assert.match(sql, /FOR UPDATE OF p/);
    assert.match(sql, /LEFT JOIN locked/);
    assert.deepEqual(JSON.parse(params[0] as string), [{ key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general", current_version_id: "pinned-NH" }]);
    return changed ? [] : [{ key: "BALLOT_CANDIDACY:US-NH:merrimack:2026-general" }];
  };
  assert.equal(await retireNationalStatePointers(query, origins), 1);
  changed = true;
  await assert.rejects(retireNationalStatePointers(query, origins), /ORIGIN_MOVED/);
});

test("retirement stops at the pass deadline: units it reconciled stay done, the rest wait for the next pass, nothing is a failure", async t => {
  const directory = await mkdtemp(join(tmpdir(), "retirement-deadline-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const origins = ["US-NH:merrimack:2026-general", "US-AZ:2026-general:supported-ballot"].map((scope, index) => ({ key: `BALLOT_CANDIDACY:${scope}`, current_version_id: `${index ? "AZ" : "NH"}-v`,
    promoted_at: "2026-10-15T12:00:00Z", normalized_hash: String(index).repeat(64) }));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_URL: "postgres://fixture/retirement", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) };
  const slots = { async acquire() { return () => undefined; } };
  const started: string[] = [];
  let clock = 0;
  const launch = async (command: { id: string; args: readonly string[] }) => {
    started.push(command.id);
    const prepare = command.args.find(arg => arg.startsWith("--prepare="))?.slice("--prepare=".length);
    let stdout: string;
    if (prepare) {
      const units = origins.map((origin, index) => ({ family: "ballot-contests", state: index ? "AZ" : "NH", contractId: `ballot-contests:${index ? "AZ" : "NH"}`,
        originVersionId: origin.current_version_id, inputFile: join(prepare, `${index}.json`), fileSha256: "c".repeat(64) }));
      await writeFile(join(prepare, "manifest.json"), JSON.stringify({ units: [units[0], { ...units[1], contractId: units[0]!.contractId }], unassigned: [] }));
      stdout = "STATE_RETIREMENT_PREPARED=" + JSON.stringify({ manifestPath: join(prepare, "manifest.json") });
    } else {
      stdout = 'STATE_RETIREMENT_UNIT={"family":"ballot-contests","state":"NH","status":"PUBLISHED"}';
      clock = 2_000; // the first unit used up the pass's remaining time
    }
    return { id: command.id, status: 0, signal: null, termination: "EXITED" as const, errorMessage: null, stdout, stderr: "" };
  };
  const realNow = Date.now;
  Date.now = () => 1_000_000 + clock;
  t.after(() => { Date.now = realNow; });
  await assert.rejects(reconcileNationalStatePointers({ query: async () => origins, env, slots, launch, deadlineMs: 1_001_000 }), /^Error: PASS_TIME_BUDGET:/);
  assert.deepEqual(started, ["state-retirement:prepare", "ballot-contests:NH:retirement:NH-v"], "the second unit for the state waits for the next pass");

  started.length = 0; clock = 0;
  await assert.rejects(reconcileNationalStatePointers({ query: async () => origins, env, slots, launch, deadlineMs: 999_000 }), /^Error: PASS_TIME_BUDGET:/);
  assert.deepEqual(started, [], "past the deadline nothing starts");
});
