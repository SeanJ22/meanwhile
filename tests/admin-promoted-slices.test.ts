import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { GeographyType } from "../lib/census-geography/contract.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, censusGeographyScope } from "../lib/census-geography/publication.ts";
import {
  containersOfCode,
  oneContainer,
  stateContainers,
  type ReadOnlyQuery,
  type Row,
  type Statement,
} from "../lib/control-plane/admin-view/promoted-slices.ts";

const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
const lookup = createLookup(dataset, "cv-test");
const TYPES: readonly GeographyType[] = ["county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

/** What Postgres answers, computed from the dataset the way each statement selects it. */
function postgresOver(ds: BuiltDataset | null, seen: Statement[] = []): ReadOnlyQuery {
  return async (statements) => {
    seen.push(...statements);
    return statements.map((s): Row[] => {
      if (s.text.startsWith("SELECT CASE")) return ds === null ? [] : [{ version_id: "cv-test" }];
      if (ds === null) return [];
      if (s.text.includes("zctaUniverse")) return [{ known: ds.zctaUniverse.includes(String(s.params[2])) }];
      const [, , types, arg] = s.params as [string, string, string[], string];
      const withOverlaps = s.text.includes(",actual_overlaps");
      const rows: Row[] = ds.scopes.map((scope) => ({ row_kind: "scope", type: scope.type, version: scope.version, plan: scope.versionMeta.plan }));
      for (const scope of ds.scopes) {
        if (!types.includes(scope.type)) continue;
        for (const g of scope.groupings) {
          const selected = s.text.includes("g->>'stateAbbr' = $4")
            ? g.stateAbbr === arg || g.memberStates.includes(arg)
            : s.text.includes("g->>'geoid' = $4")
              ? g.geoid === arg
              : g.overlaps.some((o) => o.zcta5 === arg);
          if (!selected) continue;
          rows.push({
            row_kind: "grouping",
            type: scope.type,
            version: scope.version,
            plan: scope.versionMeta.plan,
            geoid: g.geoid,
            ocd_id: g.ocdId,
            label: g.label,
            state_fips: g.stateFips,
            state_abbr: g.stateAbbr,
            cbsa_class: g.cbsaClass ?? null,
            member_states: g.memberStates,
            overlaps: withOverlaps ? g.overlaps : null,
          });
        }
      }
      return rows;
    });
  };
}

const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "en", { numeric: true });

test("a state's slice holds exactly the refs the whole lookup lists for that state, type by type", async () => {
  const slice = await stateContainers("az", TYPES, false, postgresOver(dataset));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  assert.equal(slice.versionId, "cv-test");
  assert.deepEqual(slice.value.scopes.map((s) => s.type).sort(), [...TYPES].sort());
  for (const type of TYPES) {
    const whole = (await lookup.enumerateGroupings(type)).instances.filter((g) => g.stateAbbr === "AZ" || g.memberStates.includes("AZ")).sort(byLabel);
    const sliced = slice.value.containers.filter((c) => c.ref.type === type).map((c) => c.ref).sort(byLabel);
    assert.ok(whole.length > 0, `the bootstrap lists ${type}`);
    assert.deepEqual(sliced, whole, type);
  }
  assert.ok(slice.value.containers.every((c) => c.overlaps === null), "a list asks for no codes");
});

test("one container carries the lookup's own codes and plan", async () => {
  const pima = dataset.scopes.find((s) => s.type === "county")!.groupings.find((g) => g.geoid === "04019")!;
  assert.ok(pima, "Pima County is in the bootstrap");
  const slice = await oneContainer("county", "04019", postgresOver(dataset));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  const whole = await lookup.zctasForGrouping({ type: "county", geoid: "04019", version: "county:2020" });
  assert.equal(slice.value.containers.length, 1);
  assert.deepEqual(slice.value.containers[0]!.ref, whole.geography);
  assert.deepEqual(slice.value.containers[0]!.overlaps, whole.overlaps.map((o) => ({ zcta5: o.zcta5, whole: o.whole, fraction: o.fraction })));
  assert.equal(slice.value.containers[0]!.plan, whole.version.plan);

  const none = await oneContainer("county", "99999", postgresOver(dataset));
  assert.equal(none.kind, "HELD", "a geoid the pointer does not carry is answered, with no container, and its scope named");
  if (none.kind === "HELD") {
    assert.equal(none.value.containers.length, 0);
    assert.ok(none.value.scopes.some((s) => s.type === "county"));
  }
});

test("a code's memberships match the lookup's reverse index, and a code outside the universe says so", async () => {
  const zcta = dataset.zctaUniverse[0]!;
  const slice = await containersOfCode(zcta, TYPES, postgresOver(dataset));
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") return;
  assert.equal(slice.value.known, true);
  const whole = await lookup.groupingsForZcta(zcta);
  const key = (m: { type: string; geoid: string; whole: boolean; fraction: number | null }) => `${m.type}|${m.geoid}|${m.whole}|${m.fraction}`;
  assert.deepEqual(
    slice.value.containers.map((c) => key({ type: c.ref.type, geoid: c.ref.geoid, whole: c.overlaps![0]!.whole, fraction: c.overlaps![0]!.fraction })).sort(),
    whole.memberships.map((m) => key({ type: m.geography.type, geoid: m.geography.geoid, whole: m.whole, fraction: m.fraction })).sort(),
  );
  assert.ok(slice.value.containers.every((c) => c.overlaps!.length === 1 && c.overlaps![0]!.zcta5 === zcta), "each carries that code's overlap alone");

  const outside = await containersOfCode("00000", TYPES, postgresOver(dataset));
  assert.equal(outside.kind === "HELD" && outside.value.known, false);
});

test("no pointer is 'not published', never an empty list", async () => {
  const q = postgresOver(null);
  assert.equal((await stateContainers("AZ", TYPES, false, q)).kind, "NOT_PUBLISHED");
  assert.equal((await oneContainer("county", "04019", q)).kind, "NOT_PUBLISHED");
  assert.equal((await containersOfCode("85701", TYPES, q)).kind, "NOT_PUBLISHED");
});

test("a failed read names the error and never the connection", async () => {
  const failing: ReadOnlyQuery = async () => {
    throw new Error("could not connect to postgres://reader:secret@ep-example.neon.tech/neondb");
  };
  for (const read of [stateContainers("AZ", TYPES, true, failing), oneContainer("county", "04019", failing)]) {
    const r = await read;
    assert.equal(r.kind, "UNREAD");
    if (r.kind === "UNREAD") {
      assert.match(r.detail, /\(Error\)/);
      assert.doesNotMatch(r.detail, /postgres:|secret|neon\.tech/);
    }
  }
  assert.equal((await stateContainers("AZ", TYPES, false, null)).kind, "UNREAD", "no reader store is not an empty state");
});

test("every statement is scoped to the promoted pointer, the state is matched upper-case", async () => {
  const seen: Statement[] = [];
  await stateContainers("az", ["county"], true, postgresOver(dataset, seen));
  await oneContainer("county", "04019", postgresOver(dataset, seen));
  await containersOfCode("85701", TYPES, postgresOver(dataset, seen));
  for (const s of seen) {
    assert.equal(s.params[0], CENSUS_GEO_RECORD_CLASS);
    assert.ok([CENSUS_GEO_SCOPE,censusGeographyScope("AZ")].includes(String(s.params[1])));
    assert.match(s.text, /^(SELECT|WITH) /, "reads only");
  }
  assert.ok(seen.some((s) => s.params[3] === "AZ"));
});

test("real state geography SQL carries each scope's metadata once and preserves every selected plan and overlap", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const held = { ...dataset, scopes: dataset.scopes.map(scope => ({ ...scope, versionMeta: { ...scope.versionMeta,
    applicability: [{ purpose: "representation", from: "2025-01-03", through: "2027-01-02" }],
    states: ["AZ"], retrievalComplete: true,
  } })) };
  const afterRows: Row[] = [];
  const query: ReadOnlyQuery = async statements => {
    const results: Row[][] = [];
    for (const statement of statements) {
      const result = await pg.query<Record<string, unknown>>(statement.text, [...statement.params]);
      results.push(result.rows);
      if (statement.text.includes("'grouping'")) {
        afterRows.push(...result.rows);

      }
    }
    return results;
  };
  try {
    await pg.exec("CREATE TABLE civic_data_promotions(record_class text,scope text,current_version_id text,payload jsonb); CREATE TABLE civic_data_payload_parts(hash text,payload jsonb)");
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4)",[CENSUS_GEO_RECORD_CLASS,CENSUS_GEO_SCOPE,"cv-real-sql",JSON.stringify(held)]);
    const slice = await stateContainers("AZ", TYPES, true, query);
    assert.equal(slice.kind,"HELD");
    if (slice.kind !== "HELD") return;
    assert.equal(slice.versionId,"cv-real-sql");
    assert.equal(slice.value.containers.length,held.scopes.reduce((sum,scope)=>sum+scope.groupings.length,0));
    assert.equal(slice.value.scopes.length,held.scopes.length);
    for (const scope of slice.value.scopes) {
      const expected = held.scopes.find(row => row.type === scope.type && row.version === scope.version)!;
      assert.deepEqual(scope.applicability,expected.versionMeta.applicability);
      assert.deepEqual(scope.states,["AZ"]);
      assert.equal(scope.retrievalComplete,true);
      assert.deepEqual(scope.sourceUrls,expected.versionMeta.provenance.sourceUrls);
      assert.equal(scope.observedAt,expected.versionMeta.provenance.computedAt);
    }
    assert.ok(slice.value.containers.length > 1 && slice.value.containers.some(row => row.overlaps?.length));
    assert.ok(afterRows.filter(row => row.row_kind === "scope").every(row => row.version_meta));
    assert.ok(afterRows.filter(row => row.row_kind === "grouping").every(row => row.version_meta === null));

  } finally { await pg.close(); }
});
