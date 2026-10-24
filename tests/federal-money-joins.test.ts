import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { ReadOnlyQuery, Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { readFederalMoneyJoinInput } from "../lib/federal-money/held-identities.ts";
import { joinFederalMoneyFacts } from "../lib/federal-money/join.ts";
import { federalMoneyRows } from "../lib/federal-money/view.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { locateFederalMoneyFacts } from "../lib/federal-money/locations.ts";
import { federalMoneyLookupKeys, federalMoneyPartitionOf, federalMoneyPartitionScope, type FederalMoneyFact } from "../lib/federal-money/model.ts";

const county = "ocd-division/country:us/state:ar/county:ouachita";
const body = `${county}#governing`;
const governmentId = "government:US-AR:cog:001";
const government = { id: governmentId, state: "AR", nativeIds: { census_pid6: "001" }, bodyIds: [],
  associations: [{ divisionId: county, layer: "county", geoid: "05103", basis: "SOURCE_CODE" as const }] };
const fact: FederalMoneyFact = { id: "synthetic:findings:1", source: "federal-audit-clearinghouse", sourceId: "findings:1", state: "AR", kind: "AUDIT",
  title: "Synthetic finding", amount: null, amountLabel: null, period: "2025", recipient: null, uei: null,
  identifiers: { reportId: "2025-AR-001" }, geography: [], bodyIds: [], divisionIds: [], joinStatus: "UNJOINED", joinReason: "Not joined",
  details: { table: "findings" }, provenance: { sourceUrl: "https://api.fac.gov/findings", sourceOrg: "Federal Audit Clearinghouse", publicationDate: "2025-10-01", retrievedAt: "2026-10-15T00:00:00.000Z", official: true, rawHash: "synthetic" } };

test("FAC source-reported state locates audits on the state card and never assigns its recipient government", () => {
  const state = "ocd-division/country:us/state:ar";
  const general = { ...fact, id: "synthetic:general", details: { table: "general", reportedState: "AR" } };
  const child = { ...fact, id: "synthetic:child" };
  const input = { divisions: [], bodies: [], governments: [] };
  const [report, finding] = joinFederalMoneyFacts([general, child], input);
  for (const joined of [report, finding]) {
    assert.deepEqual(joined.divisionIds, [state]);
    assert.deepEqual(joined.bodyIds, []);
    const rows = federalMoneyRows([joined], { divisionId: state });
    assert.equal(rows.length, 1);
    assert.match(rows[0].text, /Auditee location: AR/);
    assert.deepEqual(federalMoneyRows([joined], { divisionId: state, bodyId: governmentId }), []);
    assert.deepEqual(federalMoneyRows([joined], { divisionId: county }), []);
  }
  const later = joinFederalMoneyFacts([child], { ...input, auditReports: [{ reportId: report.identifiers.reportId, uei: report.uei, identifiers: report.identifiers, bodyIds: report.bodyIds, divisionIds: report.divisionIds }] });
  assert.deepEqual(later[0].divisionIds, [state]);
  for (const reportedState of [null, "CA", "ZZ"]) {
    const [unlocated] = joinFederalMoneyFacts([{ ...general, details: { table: "general", reportedState } }], input);
    assert.deepEqual(unlocated.divisionIds, []);
    assert.equal(unlocated.joinStatus, "UNJOINED");
  }
});

test("federal identity SQL reads only each page's exact native recipients and geography", async t => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE civic_data_promotions (record_class text, scope text, payload jsonb, key text GENERATED ALWAYS AS (record_class || ':' || scope) STORED UNIQUE, PRIMARY KEY (record_class, scope)); CREATE INDEX money_identity ON civic_data_promotions USING gin ((payload->'lookupKeys') jsonb_path_ops) WHERE payload ? 'lookupKeys'");
    const insert = (recordClass: string, scope: string, payload: unknown) => db.query("INSERT INTO civic_data_promotions VALUES ($1,$2,$3::jsonb)", [recordClass, scope, JSON.stringify(payload)]);
    await insert("REGISTRATION", "US-AR:registration:v1", { governments: [government, { ...government, id: "unrelated-government", nativeIds: { census_pid6: "999" } },
      { ...government, id: "synthetic-school", nativeIds: { nces_leaid: "0500001" } }, { ...government, id: "synthetic-ocd", nativeIds: { ocd_id: county } }],
      bodies: [{ id: body, ocdId: county, censusId: "001" }], divisions: [{ ocdId: county, state: "AR", geoid: "05103", divisionType: "county" }] });
    await insert("REGISTRATION", "US-CA:registration:v1", { governments: [{ ...government, id: "foreign-government", state: "CA" }], bodies: [], divisions: [] });
    await insert("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("AR"), { registry: { bodies: [{ id: body, ocdId: county, censusId: "001" }], divisions: [] } });
    await insert("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope("CA"), { registry: { bodies: [
      { id: "ocd-division/country:us/state:ca/county:foreign#governing", ocdId: "ocd-division/country:us/state:ca/county:foreign", censusId: "001" }], divisions: [] } });
    await insert(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, { scopes: [{ type: "county", groupings: [
      { ocdId: county, geoid: "05103", stateAbbr: "AR" }, { ocdId: "unrelated-county", geoid: "05001", stateAbbr: "AR" },
      { ocdId: "foreign-county", geoid: "05103", stateAbbr: "CA" }] }] });
    await insert("FEDERAL_MONEY", "synthetic-audit-partition", { formatVersion: 2, source: "federal-audit-clearinghouse", state: "AR", lookupKeys: ["report:2025-AR-001"], records: [
      { ...fact, id: "synthetic:general:1", uei: "SYNTHETICUEI", details: { table: "general" } },
      { ...fact, id: "unrelated-audit", identifiers: { reportId: "foreign-report" }, details: { table: "findings" }, title: "x".repeat(100_000) }] });
    const entities: FederalMoneyFact[] = [
      { ...fact, id: "synthetic:entity:1", kind: "ENTITY", source: "sam-gov-entities", uei: "SYNTHETICUEI", identifiers: { census_pid6: "001" }, details: { congressionalDistrict: "04" } },
      { ...fact, id: "unrelated-entity", kind: "ENTITY", source: "sam-gov-entities", uei: "FOREIGN", title: "x".repeat(100_000), details: { congressionalDistrict: "04" } }];
    const entityPartition = federalMoneyPartitionOf(entities[0]);
    await insert("FEDERAL_MONEY", federalMoneyPartitionScope("sam-gov-entities", "AR", entityPartition), {
      formatVersion: 2, source: "sam-gov-entities", state: "AR", partition: entityPartition, lookupKeys: federalMoneyLookupKeys(entities), records: entities });
    await insert("FEDERAL_MONEY", "synthetic-foreign-entity-partition", { formatVersion: 2, source: "sam-gov-entities", state: "CA", lookupKeys: ["uei:SYNTHETICUEI"], records: [
      { ...fact, id: "synthetic:foreign-entity", kind: "ENTITY", state: "CA", uei: "SYNTHETICUEI", identifiers: { census_pid6: "999" } }] });
    await db.exec("INSERT INTO civic_data_promotions (record_class, scope, payload) SELECT 'FEDERAL_MONEY', 'synthetic-noise-' || n, jsonb_build_object('formatVersion', 2, 'source', CASE WHEN n % 2 = 0 THEN 'sam-gov-entities' ELSE 'federal-audit-clearinghouse' END, 'state', 'AR', 'lookupKeys', jsonb_build_array('uei:NOISE-' || n, 'report:NOISE-' || n), 'records', '[]'::jsonb) FROM generate_series(1,4096) n");
    let returnedBytes = 0;
    const plans = new Map<string, string>();
    const query: ReadOnlyQuery = async statements => {
      const result: Row[][] = [];
      for (const statement of statements) {
        assert.doesNotMatch(statement.text, /REGISTRY_RUNTIME_BINDING|CENSUS_GEOGRAPHY/);
        if (statement.text.includes("p.payload->'lookupKeys'")) {
          const plan = await db.query(`EXPLAIN (FORMAT JSON) ${statement.text}`, [...statement.params]);
          plans.set(statement.text, JSON.stringify(plan.rows));
        }
        const { rows } = await db.query(statement.text, [...statement.params]);
        returnedBytes += Buffer.byteLength(JSON.stringify(rows));
        result.push(rows as Row[]);
      }
      return result;
    };
    await t.test("a child on another page inherits the held report identity without inventing a child UEI", async () => {
      const input = await readFederalMoneyJoinInput("ar", [fact], query);
      assert.equal(input.auditReports?.length, 1);
      assert.equal(input.entities?.length, 1);
      assert.deepEqual(input.governments.map(row => row.id), [governmentId]);
      assert.deepEqual([...new Set(input.bodies.map(row => row.id))], [body]);
      const [joined] = joinFederalMoneyFacts([fact], input);
      assert.deepEqual(joined.bodyIds, [governmentId, body].sort());
      assert.deepEqual(joined.divisionIds, [county]);
      assert.equal(joined.uei, null);
      assert.ok(returnedBytes < 16_384, `Only identity fields should leave the database, got ${returnedBytes} bytes`);
    });
    await t.test("geographic awards reach the county without assigning a private recipient to its government", async () => {
      const grant = { ...fact, id: "synthetic:grant", source: "usaspending" as const, kind: "GRANT" as const, uei: "PRIVATE", identifiers: {}, geography: [{ type: "county" as const, geoid: "05103" }] };
      const input = await readFederalMoneyJoinInput("AR", [grant], query);
      assert.equal(input.governments.length, 0);
      const [joined] = joinFederalMoneyFacts([grant], input);
      assert.deepEqual(joined.bodyIds, []);
      assert.deepEqual(joined.divisionIds, [county]);
    });
    await t.test("grouped SAM registrations resolve through indexed UEI without claiming their address district", async () => {
      const source = JSON.stringify({ entityData: [{ entityRegistration: { ueiSAM: "SYNTHETICUEI", legalBusinessName: "Synthetic government" },
        coreData: { congressionalDistrict: "04", physicalAddress: { stateOrProvinceCode: "AR" } } }] });
      const parsed = parseFederalMoney("sam-gov-entities", { url: "https://api.sam.gov/entity-information/v3/entities", rawHash: "synthetic-native-uei",
        vaultKey: "synthetic-native-uei", byteLength: Buffer.byteLength(source), format: "json", retrievedAt: "2026-10-15T00:00:00.000Z", publicationDate: null }, "AR", source);
      assert.equal(federalMoneyPartitionOf(parsed[0]).place, "registration-address-district:04");
      assert.deepEqual(parsed[0].geography, []);
      const input = await readFederalMoneyJoinInput("AR", parsed, query);
      assert.deepEqual(input.entities?.map(row => row.uei), ["SYNTHETICUEI"]);
      const [joined] = joinFederalMoneyFacts(parsed, input);
      assert.deepEqual(joined.bodyIds, [governmentId, body].sort());
      assert.deepEqual(joined.divisionIds, [county]);
    });
    await t.test("foreign reports stay retained and unknown states cannot leak through a page", async () => {
      const foreign = { ...fact, identifiers: { reportId: "foreign-report" } };
      const input = await readFederalMoneyJoinInput("AR", [foreign], query);
      const [joined] = joinFederalMoneyFacts([foreign], input);
      assert.equal(joined.joinStatus, "UNJOINED");
      assert.deepEqual(joined.bodyIds, []);
      await assert.rejects(readFederalMoneyJoinInput("AR", [{ ...fact, state: "CA" }], query), /one state/);
    });
    await t.test("native congressional codes use the existing canonical district identities", async () => {
      const grant = { ...fact, source: "usaspending" as const, kind: "GRANT" as const, identifiers: {},
        geography: [{ type: "congressional" as const, geoid: "0504" }, { type: "congressional" as const, geoid: "0601" }] };
      const input = await readFederalMoneyJoinInput("AR", [grant], query);
      const [joined] = joinFederalMoneyFacts([grant], input);
      assert.deepEqual(joined.divisionIds, ["ocd-division/country:us/state:ar/cd:4"]);
      assert.deepEqual(joined.bodyIds, []);
    });
    await t.test("parsed source NCES and OCD identifiers bind the exact held government", async () => {
      const source = JSON.stringify({ results: [
        { report_id: "SYNTHETIC-NCES", auditee_state: "AR", nces_id: "0500001" },
        { report_id: "SYNTHETIC-OCD", auditee_state: "AR", ocd_division_id: county },
      ] });
      const parsed = parseFederalMoney("federal-audit-clearinghouse", {
        url: "https://api.fac.gov/general", rawHash: "synthetic-native-ids", vaultKey: "synthetic-native-ids", byteLength: Buffer.byteLength(source),
        format: "json", retrievedAt: "2026-10-15T00:00:00.000Z", publicationDate: null,
      }, "AR", source);
      assert.equal(parsed[0].identifiers.nces_leaid, "0500001");
      assert.equal(parsed[1].identifiers.ocd_id, county);
      const input = await readFederalMoneyJoinInput("AR", parsed, query);
      assert.deepEqual(input.governments.map(row => row.id).sort(), ["synthetic-ocd", "synthetic-school"]);
      const joined = joinFederalMoneyFacts(parsed, input);
      assert.deepEqual(joined[0].bodyIds, ["synthetic-school"]);
      assert.deepEqual(joined[1].bodyIds, [body, "synthetic-ocd"].sort());
      assert.ok(joined.every(row => row.joinStatus === "JOINED"));
    });
    await t.test("both exact recipient lookups use the partition key index", () => {
      assert.equal(plans.size, 2);
      for (const plan of plans.values()) assert.match(plan, /money_identity/);
    });
  } finally { await db.close(); }
});

test("an unavailable identity database leaves a nonempty source page pending", async () => {
  await assert.rejects(readFederalMoneyJoinInput("AR", [fact], null), /recipient identity index is unavailable/);
  assert.deepEqual(await readFederalMoneyJoinInput("AR", [], null), { divisions: [], bodies: [], governments: [] });
  assert.deepEqual(await readFederalMoneyJoinInput("ZZ", [{ ...fact, state: "ZZ" }], null), { divisions: [], bodies: [], governments: [] });
});

test("one funded recipient's UEI index excludes its award history and keeps its SAM registration", () => {
  const uei = "SYNTHETICUEI";
  const history: FederalMoneyFact[] = Array.from({ length: 500 }, (_, index) => ({ ...fact,
    id: `usaspending:synthetic:${index}`, source: "usaspending", kind: "GRANT", state: index % 2 ? "CA" : "TX",
    period: `${2000 + index % 26}-01-01`, uei, identifiers: { uei }, details: {},
  }));
  const registration: FederalMoneyFact = { ...fact, id: "sam-gov-entities:synthetic", source: "sam-gov-entities", kind: "ENTITY", uei, identifiers: { uei }, details: {} };
  const report: FederalMoneyFact = { ...fact, uei, details: { table: "general" } };
  const partitions = [history, [report], [registration]].map(records => federalMoneyLookupKeys(records));
  assert.deepEqual(partitions.flatMap((keys, index) => keys.includes(`uei:${uei}`) ? [index] : []), [2]);
  assert.deepEqual(partitions[0], history.map(row => `id:${row.id}`).sort());
  assert.ok(partitions[1].includes("report:2025-AR-001"));
  assert.ok(partitions[2].includes(`id:${registration.id}`));
});

test("cold native lookup plans select one partition among 100,000 facts and expand it once", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE civic_data_promotions (key text PRIMARY KEY, record_class text, scope text, payload jsonb);" +
      " CREATE UNIQUE INDEX promotion_scope ON civic_data_promotions (record_class, scope);" +
      " CREATE INDEX money_native ON civic_data_promotions USING gin ((payload->'lookupKeys') jsonb_path_ops) WHERE payload ? 'lookupKeys';" +
      " INSERT INTO civic_data_promotions SELECT 'partition:' || part, 'FEDERAL_MONEY', 'partition:' || part," +
      " jsonb_build_object('formatVersion',2,'source','sam-gov-entities','state','AR','partition',jsonb_build_object('year','registration','place','fixture:' || part,'shard','')," +
      " 'lookupKeys',jsonb_agg('id:sam-gov-entities:' || n) || jsonb_agg('uei:UEI' || n)," +
      " 'records',jsonb_agg(jsonb_build_object('id','sam-gov-entities:' || n,'uei','UEI' || n,'kind','ENTITY','identifiers','{}'::jsonb,'bodyIds','[]'::jsonb,'title',repeat(md5(n::text),8))))" +
      " FROM (SELECT n, (n-1)/500 AS part FROM generate_series(1,100000) n) native GROUP BY part");
    const stats = await db.query("SELECT last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE relname = 'civic_data_promotions'");
    assert.deepEqual(stats.rows, [{ last_analyze: null, last_autoanalyze: null }]);
    const plans: Record<string, unknown>[] = [];
    const query: ReadOnlyQuery = async statements => {
      const rows: Row[][] = [];
      for (const statement of statements) {
        if (statement.text.startsWith("WITH matched")) {
          const plan = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${statement.text}`, [...statement.params]);
          plans.push(((plan.rows[0] as Record<string, unknown>)["QUERY PLAN"] as { Plan: Record<string, unknown> }[])[0].Plan);
        }
        rows.push((await db.query(statement.text, [...statement.params])).rows as Row[]);
      }
      return rows;
    };
    const facts = Array.from({ length: 500 }, (_, index): FederalMoneyFact => ({ ...fact, source: "sam-gov-entities", kind: "ENTITY",
      id: `sam-gov-entities:${index + 1}`, uei: `UEI${index + 1}`, identifiers: {},
    }));
    const hits = await locateFederalMoneyFacts("sam-gov-entities", "AR", facts, query);
    assert.equal(hits.length, 500);
    assert.equal(new Set(hits.map(row => row.partition.place)).size, 1);
    assert.deepEqual(await locateFederalMoneyFacts("sam-gov-entities", "AR", facts.map(row => ({ ...row, id: `${row.id}:missing` })), query), []);
    assert.equal((await readFederalMoneyJoinInput("AR", facts, query)).entities?.length, 500);
    const nodes = (plan: Record<string, unknown>): Record<string, unknown>[] => [plan, ...(plan.Plans as Record<string, unknown>[] ?? []).flatMap(nodes)];
    for (const plan of plans) {
      const all = nodes(plan);
      assert.ok(all.some(node => node["Index Name"] === "money_native"));
      assert.ok(all.every(node => node["Relation Name"] !== "civic_data_promotions" || node["Node Type"] !== "Seq Scan"));
      for (const node of all.filter(node => node["Node Type"] === "Function Scan")) assert.ok(Number(node["Actual Loops"]) <= 1);
    }
  } finally { await db.close(); }
});

test("unresolved historical FAC geography stays retained without reading an invented state", async () => {
  const row = { ...fact, state: "ZZ" };
  const input = await readFederalMoneyJoinInput("ZZ", [row], async () => { throw new Error("No source state is held"); });
  assert.equal(joinFederalMoneyFacts([row], input)[0].joinStatus, "UNJOINED");
});

test("conflicting held audit recipients remain unjoined and no source row is discarded", () => {
  const report = { reportId: "2025-AR-001", uei: "FIRST", identifiers: {}, bodyIds: [body], divisionIds: [county] };
  const joined = joinFederalMoneyFacts([fact, { ...fact, id: "unrelated", identifiers: { reportId: "unrelated" } }], {
    bodies: [], governments: [], divisions: [], auditReports: [report, { ...report, uei: "SECOND" }],
  });
  assert.equal(joined.length, 2);
  assert.ok(joined.every(row => row.joinStatus === "UNJOINED"));
  assert.match(joined[0].joinReason, /more than one/);
});
