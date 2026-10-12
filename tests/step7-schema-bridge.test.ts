import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { askCoverageStamp, askKeyHash, prepareAskInteraction } from "../lib/db/ask-signal.ts";
import { writeAskInteraction } from "../lib/db/ask-interaction-writer.ts";
import { getDb } from "../lib/db/index.ts";
import { logSearchEvent } from "../lib/db/search-log.ts";
import { writeSpeakYourMind } from "../lib/db/speak.ts";
import { raiseWriteAlarm } from "../lib/db/write-alarm.ts";

const quote = (value: unknown): string => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const bind = (text: string, params: unknown[]): string => text.replace(/\$(\d+)/g, (_, n: string) => quote(params[Number(n) - 1]));

/** Run with STEP7_POSTGRES_CONTAINER naming a disposable, unpublished local Postgres container. */
test("STEP-7 stores full Ask and location rows across the contract, and a refused Speak save writes its alarm", {
  skip: !process.env.STEP7_POSTGRES_CONTAINER,
}, async () => {
  const journal = JSON.parse(readFileSync("lib/db/migrations/meta/_journal.json", "utf8"));
  const entry = journal.entries.find((row: { tag: string }) => row.tag.toLowerCase().replaceAll("-", "").includes(["step7", "reader_location_capture"].join("_")));
  assert.ok(entry);
  const numberedSnapshot = `lib/db/migrations/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`;
  const snapshot = JSON.parse(readFileSync(existsSync(numberedSnapshot) ? numberedSnapshot : `lib/db/migrations/meta/${entry.tag}_snapshot.json`, "utf8"));
  const schemaName = `step7_fixture_${randomUUID().replaceAll("-", "")}`;
  const tableSql = (name: string) => {
    const columns = Object.values(snapshot.tables[`public.${name}`].columns) as { name: string; type: string; notNull: boolean; primaryKey: boolean; default?: string | number }[];
    return `CREATE TABLE "${name}" (${columns.filter(column => !(name === "search_log" && column.name === "continuity_hash"))
      .map(column => `"${name === "ask_interactions" && column.name === "question" ? "question_scrubbed" : column.name}" ${column.type}${column.notNull ? " NOT NULL" : ""}${column.primaryKey ? " PRIMARY KEY" : ""}${column.default !== undefined ? ` DEFAULT ${column.default}` : ""}`).join(", ")});`;
  };

  const beforeEnv = { DATABASE_URL: process.env.DATABASE_URL, WTP_DB_ROLE: process.env.WTP_DB_ROLE };
  process.env.DATABASE_URL ??= "postgresql://postgres:fixture@localhost/step7";
  process.env.WTP_DB_ROLE = "local";
  const client = getDb().$client;
  const originalQuery = client.query;
  const captured: string[] = [];
  const setQuery = (query: (text: string, params?: unknown[]) => Promise<unknown>) => {
    Object.defineProperty(client, "query", { configurable: true, writable: true, value: query });
  };
  setQuery(async (text, params = []) => { captured.push(bind(text, params)); return []; });
  const key = "step7-fixture-reader-key-123456789";
  const districts = ["cd:7", "sldu:20", "sldl:20", "county:pima", "place:tucson", "school_district:unified:tucson"]
    .map(id => `ocd-division/country:us/state:az/${id}`);
  const questions = ["Who represents 412 elm st phoenix?", "What happened at the 2026 Budget Hearing?", `  ${"q".repeat(900)}\n`];
  const answers = ["Here is the answer exactly as delivered.", "The 2026 Budget Hearing approved the budget.", "answer ".repeat(900)];
  try {
    const rows = questions.map((question, index) => prepareAskInteraction({ ...askCoverageStamp(districts),
        question, answerText: answers[index], answerMode: "STRUCTURED_GROUNDED", answerModel: null,
        intent: "OFFICIAL", temporalKind: "CURRENT", subjectIds: [], resolutionState: "NONE", validationPassed: true,
        evidenceRecordCount: 0, evidenceSourceCount: 0, namedGapCount: 0,
        evidenceProvenance: { recordRefs: [], sourceUrls: [], sourceOrgs: [], retrievedFrom: null, retrievedTo: null },
        surface: "MAP", approximateLocation: "85701", ocdIds: districts, divisionVintage: "TIGER_GENZ2025",
        residencyRelation: "CURRENT_HOME", locationConfidence: "ADDRESS_RESOLVED", continuityKey: key,
        occurredAt: "2026-10-12T00:00:00.000Z" }));
    const collectInserts = async () => {
      captured.length = 0;
      for (const row of rows) await writeAskInteraction(row);
      for (const eventType of ["ADDRESS_ENTERED", "BALLOT_VIEWED"] as const) {
        assert.equal(await logSearchEvent({ eventType, approximateLocation: "85701", ocdIds: districts,
          continuityKey: key, detail: { page: "BALLOT" } }), true);
      }
      return [...captured];
    };
    const beforeInserts = await collectInserts();
    const afterInserts = await collectInserts();
    captured.length = 0;
    setQuery(async (text, params = []) => { captured.push(bind(text, params)); throw Object.assign(new Error("fixture refused Speak"), { code: "23514" }); });
    const refused = await writeSpeakYourMind({ subjectType: "BODY", subjectId: "fixture-body", ocdIds: districts,
      divisionVintage: "TIGER_GENZ2025", text: "Please fix our sidewalks.", continuityKey: key });
    assert.equal(refused.kind, "FAILED");
    const speakInsert = captured.pop()!;
    setQuery(async (text, params = []) => { captured.push(bind(text, params)); return []; });
    assert.equal(await raiseWriteAlarm("speak_your_mind", refused.kind === "FAILED" ? refused.error : undefined), true);
    const alarmInsert = captured.pop()!;

    const checks = (questionColumn: string, phase: string) => `DO $checks$ BEGIN
      ${questions.map((question, index) => `IF NOT EXISTS (SELECT 1 FROM ask_interactions WHERE "${questionColumn}" = ${quote(question)} AND answer_text = ${quote(answers[index])} AND ocd_ids = ${quote(JSON.stringify(districts))}::jsonb AND ask_key_hash = ${quote(askKeyHash(key))}) THEN RAISE EXCEPTION '${phase} Ask words or districts changed'; END IF;`).join("\n")}
      END $checks$;`;
    const migration = readFileSync(`lib/db/migrations/${entry.tag}.sql`, "utf8");
    const script = `BEGIN; CREATE SCHEMA "${schemaName}"; SET LOCAL search_path = "${schemaName}", public;
      ${["ask_interactions", "search_log", "speak_your_mind", "write_alarm"].map(tableSql).join("\n")}
      ALTER TABLE speak_your_mind ADD CONSTRAINT fixture_refuses_speak CHECK (false);
      ${beforeInserts.join(";\n")};
      ${checks("question_scrubbed", "before migration")}
      DO $checks$ BEGIN IF (SELECT count(*) FROM search_log WHERE detail->>'__step7_continuity_hash' = ${quote(askKeyHash(key))}) <> 2 THEN RAISE EXCEPTION 'Old schema lost continuity hashes'; END IF; END $checks$;
      ${migration}
      ${checks("question", "after migration")}
      ${afterInserts.join(";\n")};
      DO $checks$ BEGIN
        IF (SELECT count(*) FROM search_log WHERE continuity_hash = ${quote(askKeyHash(key))} AND ocd_ids = ${quote(JSON.stringify(districts))}::jsonb AND approximate_location = '85701') <> 4 THEN RAISE EXCEPTION 'New schema lost district or reader counts'; END IF;
        IF EXISTS (SELECT 1 FROM search_log WHERE detail ? '__step7_continuity_hash') THEN RAISE EXCEPTION 'Migration left bridge data'; END IF;
        BEGIN ${speakInsert}; EXCEPTION WHEN check_violation THEN ${alarmInsert}; END;
        IF NOT EXISTS (SELECT 1 FROM write_alarm WHERE store = 'speak_your_mind' AND error_code = '23514') THEN RAISE EXCEPTION 'Refused Speak did not write alarm'; END IF;
      END $checks$;
      SELECT 'STEP-7: old/new Ask words, long answers, districts, location hashes and refused Speak alarm verified';
      ROLLBACK;`;
    const output = execFileSync("env", ["-u", "DOCKER_HOST", "-u", "DOCKER_CONTEXT", "-u", "DOCKER_TLS", "-u", "DOCKER_TLS_VERIFY", "-u", "DOCKER_CERT_PATH", "docker", "--host=unix:///var/run/docker.sock", "exec", "-i", process.env.STEP7_POSTGRES_CONTAINER!, "psql", "-U", "postgres", "-d", process.env.STEP7_POSTGRES_DATABASE ?? "step7", "-v", "ON_ERROR_STOP=1"], { input: script, encoding: "utf8" });
    assert.match(output, /STEP-7: old\/new Ask words/);
  } finally {
    client.query = originalQuery;
    for (const [name, value] of Object.entries(beforeEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
