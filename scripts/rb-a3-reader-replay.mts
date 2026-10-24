import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { door, type DoorInput } from "../lib/core/door.ts";
import { resolveId } from "../lib/core/resolve.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { isOfficialUrl } from "../lib/facts/check.ts";
import { isSourceApiUrl } from "../lib/control-plane/scheduler/scout-api.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { canonicalJson } from "../lib/control-plane/repository/types.ts";
import { pageCopy, jsonValues } from "../lib/facts/source-copy.ts";
import { parse as parseYaml } from "yaml";
import { openFactCopy, replayCopiedFacts, type FactSnapshot } from "./rb-a3-copy.mts";
import { bindReaderSources, readerReplayField, type ReaderSample, type HeldApiDoor, type MeetingSourceHosts } from "./rb-a3-reader-sample.mts";

const directory = resolve(process.argv[2] ?? ".scratch/rb-a3/snapshots");
const states = process.argv[4] ? [process.argv[4]] : Object.values(FIPS_TO_STATE).map(s => s.postal).sort();
const report = [];
const digest = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");
for (const state of states) {
  const snapshot = JSON.parse(readFileSync(resolve(directory, `${state}.json`), "utf8")) as FactSnapshot;
  const sample = JSON.parse(readFileSync(resolve(directory, "reader", `${state}.json`), "utf8")) as ReaderSample;
  bindReaderSources(sample, JSON.parse(readFileSync(resolve(directory, "reader", "held-api-doors.json"), "utf8")) as HeldApiDoor[],
    JSON.parse(readFileSync(resolve(directory, "reader", "meeting-source-hosts.json"), "utf8")) as MeetingSourceHosts[],
    JSON.parse(readFileSync(resolve(directory, "reader", "legistar-tenants.json"), "utf8")) as string[]);
  const merged = { ...snapshot };
  for (const key of ["entities", "hosts", "externalIds", "places"] as const) {
    const rows = [...snapshot[key] ?? [], ...(sample.context?.[key] ?? []) as Record<string, unknown>[]];
    const keyOf = (row: Record<string, unknown>) => key === "entities" ? String(row.id)
      : canonicalJson(key === "places" ? [row.entity_id, row.place_id, row.boundary_year ?? 0]
        : key === "hosts" ? [row.entity_id, row.host] : [row.entity_id, row.scheme, row.value]);
    (merged as unknown as Record<string, unknown>)[key] = [...new Map(rows.map(row => [keyOf(row), row])).values()];
  }
  const db = await openFactCopy(merged);
  const beforeSample = digest(sample), failures: unknown[] = [];
  let preserved = 0, repeated = 0;
  const inputs: DoorInput[] = [];
  const byFamily: Record<string, number> = {};
  try {
    // These are real identities from the selected published records, supplied as loader context.
    // No fact is seeded from them: each selected legacy value must publish through the door first.
    for (const value of sample.values) {
      if (!await resolveId(value.subjectId, db.query)) await db.query(
        "INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [value.subjectId, value.subjectKind, value.subjectName, state, value.parentId ?? null]);
      if (value.registeredSourceHost) await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [await resolveId(value.subjectId, db.query), value.registeredSourceHost]);
    }
    const baseline = await db.query("SELECT id,value,status FROM fact ORDER BY id");
    const identityState = () => db.query(`SELECT jsonb_build_object('entities',(SELECT jsonb_agg(e ORDER BY id) FROM entity e),
      'aliases',(SELECT jsonb_agg(x ORDER BY entity_id,scheme,value) FROM entity_external_id x),
      'hosts',(SELECT jsonb_agg(h ORDER BY entity_id,host) FROM entity_host h),
      'places',(SELECT jsonb_agg(p ORDER BY entity_id,place_id) FROM entity_place p)) value`);
    const identitiesBefore = await identityState();
    const existing = await replayCopiedFacts(db, snapshot, 100);
    assert.equal(existing.unavailable, 0);
    for (const value of sample.values) {
      const official = isOfficialUrl(value.sourceUrl, value.hosts ?? []) || isSourceApiUrl(value.sourceUrl) || !!value.linkingPage;
      const savedCopy = sample.copies[value.sourceUrl];
      if (!official && !savedCopy) { failures.push({ subjectId: value.subjectId, field: value.field, reason: "SAVED_SOURCE_UNAVAILABLE" }); continue; }
      const text = official ? "" : readFileSync(resolve(directory, "reader", savedCopy.file), "utf8");
      if (!official) assert.equal(createHash("sha256").update(text).digest("hex"), savedCopy.sha256);
      const observedAt = new Date(official ? value.observedAt : savedCopy.observedAt).toISOString();
      const key = readerReplayField(value);
      const sha = digest({ pointer: value.pointer, version: value.version, sourceUrl: value.sourceUrl, record: value.sourceRecord });
      const [source] = await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key,is_archive)
        VALUES($1,$1,$2,$3,$4,false) ON CONFLICT(blob_key) DO UPDATE SET blob_key=EXCLUDED.blob_key RETURNING id`,
      [value.sourceUrl, observedAt, official ? sha : savedCopy.sha256, `local-published-reader-copy:${sha}`]);
      const sourcePath = value.sourcePath.split(".");
      const sourceKey = sourcePath.pop()!;
      const sourceRecord = sourcePath.reduce<unknown>((record, key) => (record as Record<string, unknown>)[key], value.sourceRecord) as Record<string, unknown>;
      assert.deepEqual(sourceRecord[sourceKey], value.value);
      const fieldKind = value.subjectKind === "agenda_item" ? "agenda" as const
        : value.recordClass === "MEETING" || value.recordClass === "MEETING_OUTCOME" ? "meeting" as const
        : value.recordClass === "FEDERAL_MONEY" ? "money" as const
        : value.recordClass === "BALLOT_CANDIDACY" ? "ballot" as const : "contact" as const;
      const interpreted = pageCopy({ finalUrl: value.sourceUrl, body: text, contentType: "", fetchedAt: observedAt });
      // The live Open States adapter uses this same YAML decoder; escaped scalars remain values on the saved source.
      const checkedText = !official && /\.ya?ml$/i.test(new URL(value.sourceUrl).pathname)
        ? `${interpreted.text}\n${jsonValues(parseYaml(text)).join("\n")}` : interpreted.text;
      const input = { subjectId: value.subjectId, field: key, fieldKind,
        value: value.value, valueText: typeof value.value === "string" ? value.value : canonicalJson(value.value),
        quote: official ? "" : typeof value.value === "string" ? value.value : canonicalJson(value.value),
        provenance: official ? "OFFICIAL" as const : "REFERENCE" as const, acquisition: official ? "loader" as const : "walker" as const,
        producedBy: "rb-a3-published-reader-replay", costUsd: 0,
        copy: { ...interpreted, text: checkedText, id: Number(source!.id) },
        sourceField: { record: sourceRecord, key: sourceKey } };
      const claim: DoorInput = value.linkingPage ? { ...input, linkingPage: { url: value.linkingPage.url,
        html: readFileSync(resolve(directory, "reader", value.linkingPage.file), "utf8") } } : input;
      const outcome = await door(db, claim, factClocks(null), new Date(sample.capturedAt), { purge: async () => ({ purged: true }) });
      if (!("decision" in outcome) || outcome.decision !== "PUBLISH") { failures.push({ subjectId: value.subjectId, field: value.field, outcome }); continue; }
      const [saved] = await db.query("SELECT value FROM fact WHERE id=$1 AND status='live'", [outcome.factId]);
      assert.deepEqual(saved!.value, value.value);
      inputs.push(claim);
      preserved++; byFamily[value.recordClass] = (byFamily[value.recordClass] ?? 0) + 1;
    }
    const stateOfCopy = () => db.query(`SELECT jsonb_build_object('facts',(SELECT jsonb_agg(f ORDER BY id) FROM fact f),
      'sources',(SELECT jsonb_agg(s ORDER BY id) FROM source_copy s),'counts',(SELECT jsonb_agg(c ORDER BY state,hour,step) FROM count_hour c),
      'queue',(SELECT jsonb_agg(q ORDER BY place_id) FROM rebuild_queue q)) AS value`);
    const beforeRepeat = await stateOfCopy();
    for (const input of inputs) {
      const again = await door(db, input, factClocks(null), new Date(sample.capturedAt), { purge: async () => ({ purged: true }) });
      assert.equal("decision" in again && again.decision, "CONFIRM"); repeated++;
    }
    assert.deepEqual(await stateOfCopy(), beforeRepeat);
    assert.deepEqual(await db.query("SELECT id,value,status FROM fact WHERE id=ANY($1::bigint[]) ORDER BY id", [baseline.map(row => row.id)]), baseline);
    assert.equal(digest(sample), beforeSample);
    assert.deepEqual(await identityState(), identitiesBefore);
    report.push({ state, selected: existing.replayed + sample.values.length, existingFactValues: existing.replayed, legacyReaderValues: sample.values.length,
      legacyValuesPreserved: preserved, repeatUnchanged: repeated, distinctLegacyRecords: new Set(sample.values.map(v => v.subjectId)).size,
      byFamily, failures, zero: existing.replayed + sample.values.length === 0 });
    console.log(JSON.stringify(report.at(-1)));
  } finally { await db.pg.close(); }
}
const output = { observedAt: new Date().toISOString(), states: report, zeroStates: report.filter(s => s.zero).map(s => s.state) };
if (process.argv[3]) writeFileSync(resolve(process.argv[3]), JSON.stringify(output, null, 2) + "\n");
if (report.some(s => s.zero || s.failures.length || s.legacyValuesPreserved !== s.legacyReaderValues)) process.exitCode = 1;
