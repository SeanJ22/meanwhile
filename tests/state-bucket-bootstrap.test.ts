import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareStateAuthorityBootstrap, type StateBootstrapQuery } from "../lib/civic-data/state-bucket-bootstrap.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { StreamedCivicPayload } from "../lib/civic-data/streamed-payload.ts";
import { REGISTRY_STATES, registryJurisdictions, stateFromRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";

test("streamed payload reads each encoded part once and retains the original mixed-state row order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-stream-"));
  try {
    const rows = Array.from({ length: 48 }, (_, index) => ({ id: `ocd-division/country:us/state:${index % 2 ? "az" : "nh"}/place:${index}`, value: "saved source ".repeat(1400) }));
    const encoded = partitionCivicPayload(rows), calls = new Map<string, number>();
    const decoder = new StreamedCivicPayload(directory, async hashes => hashes.map(hash => { calls.set(hash, (calls.get(hash) ?? 0) + 1); return encoded.parts.find(part => part.hash === hash)!; }));
    const actual = [];
    for await (const row of decoder.members(encoded.value)) actual.push(row);
    assert.deepEqual(actual, rows);
    for await (const _row of decoder.members(encoded.value)) { /* Exhaust the second stream to verify the disk cache. */ }
    assert.ok([...calls.values()].every(count => count === 1));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("registry buckets include territories and recognize only recorded jurisdiction syntax", () => {
  assert.equal(REGISTRY_STATES.length, 56);
  assert.equal(stateFromRegistryRuntimeScope("US-PR:reader-registry-runtime"), "PR");
  assert.deepEqual(registryJurisdictions("ocd-division/country:us/territory:gu"), ["GU"]);
  assert.deepEqual(registryJurisdictions("wtp-body/country:us/state:az/place:tucson"), ["AZ"]);
  assert.deepEqual(registryJurisdictions("curated:nj/morris"), ["NJ"]);
  assert.deepEqual(registryJurisdictions("Arizona body without an identifier"), []);
});

test("prepare retains cross-border body IDs, roster members and photos, and unchanged prepare reads only metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-bootstrap-"));
  const az = "ocd-division/country:us/state:az", nh = "ocd-division/country:us/state:nh", body = `${az}/cross-border-body`;
  const payload = { formatVersion: 1, registry: { generatedAt: "2026-10-01", divisions: [{ ocdId: az }, { ocdId: nh }], bodies: [{ id: body, ocdId: az, alsoServesOcdIds: [nh] }] },
    bodyRosters: [{ bodyId: body, members: [{ id: "held-person", name: "Held Person" }] }], rosterReaderDispositions: [], statewideExecutives: [],
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] },
    officialPhotos: { photos: [{ officeholderId: "held-person", name: "Held Person", url: "https://official.example/photo.jpg" }] }, rosterPhotos: { "held-person": "https://official.example/photo.jpg" } };
  const candidate: Record<string, unknown> = { id: "origin", scope: "US:reader-registry-runtime-bindings", sourceId: "registry-reviewed-bindings", recordClass: "REGISTRY_RUNTIME_BINDING",
    readModel: payload, normalizedPayload: { version: "2026-10-01", sources: [] }, identities: [{ subjectId: body, jurisdiction: "US" }], excludedFacts: [], retrieval: { retrievedAt: "2026-10-01" } };
  const queries: string[] = [];
  let reads = 0, originVersion = "origin";
  const query: StateBootstrapQuery = async (sql, params) => {
    reads++; queries.push(sql);
    if (sql.includes("c.normalized_hash FROM civic_data_promotions")) return params[0] === "REGISTRY_RUNTIME_BINDING" ? [{ current_version_id: originVersion, promoted_at: new Date("2026-10-01T00:00:00.123Z"), normalized_hash: originVersion }] : [];
    if (sql.startsWith("SELECT c.id FROM civic_data_promotions")) return [{ id: originVersion }];
    if (sql.includes("record_class IN ('STATE_LEGISLATOR'")) return [];
    if (sql.includes("validation_receipt-'excludedFacts'")) return [{ receipt: { candidateId: "origin", decision: "GOOD", checks: [], validatedAt: "2026-10-01" } }];
    if (sql.includes("civic_data_candidate_events")) return [];
    let value: unknown = candidate;
    const omit = sql.includes("::text[] AS value") ? params.at(-1) as string[] : [];
    const path = params.slice(1, sql.includes("::text[] AS value") ? -1 : undefined);
    for (const key of path) value = (value as Record<string, unknown> | undefined)?.[String(key)];
    if (omit.length && value && typeof value === "object") value = Object.fromEntries(Object.entries(value).filter(([key]) => !omit.includes(key)));
    return [{ value }];
  };
  const streamRows: Parameters<typeof prepareStateAuthorityBootstrap>[0]["streamRows"] = async (sql, params, onRow) => {
    reads++; queries.push(sql);
    assert.ok(!/LIMIT|e\.key>/.test(sql), "each object is selected once, then streamed by the database cursor");
    let value: unknown = candidate;
    for (const key of params.slice(1)) value = (value as Record<string, unknown> | undefined)?.[String(key)];
    for (const [key, row] of Object.entries((value ?? {}) as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      await onRow({ key, value: row });
  };
  try {
    const plan = await prepareStateAuthorityBootstrap({ directory, query, streamRows });
    assert.deepEqual(plan.unassigned, []);
    assert.equal(plan.units.length, 56);
    for (const state of ["AZ", "NH"]) {
      const unit = plan.units.find(row => row.state === state)!;
      const held = JSON.parse(await readFile(unit.inputFile, "utf8"));
      assert.equal(held.promotedAt, "2026-10-01T00:00:00.123Z");
      assert.equal(held.payload.registry.bodies[0].id, body);
      assert.equal(held.payload.bodyRosters[0].members[0].id, "held-person");
      assert.equal(held.payload.officialPhotos.photos[0].officeholderId, "held-person");
      assert.deepEqual(held.payload.registry.divisions.map((row: { ocdId: string }) => row.ocdId), [state === "AZ" ? az : nh]);
    }
    const before = reads;
    assert.deepEqual(await prepareStateAuthorityBootstrap({ directory, query, streamRows }), plan);
    assert.equal(reads - before, 6);
    assert.ok(queries.slice(before).every(sql => !sql.includes("p.payload") && !sql.includes("c.candidate")), "cached preparation must not decompress a national payload");
    await rm(plan.units.find(row => row.state === "AZ")!.inputFile);
    const regenerated = await prepareStateAuthorityBootstrap({ directory, query, streamRows });
    assert.deepEqual(regenerated, plan);
    originVersion = "origin-2"; candidate.id = originVersion;
    Object.assign(payload.registry.divisions[0], { label: "Updated official Arizona label" });
    const changed = await prepareStateAuthorityBootstrap({ directory, query, streamRows });
    assert.notEqual(changed.units.find(row => row.state === "AZ")!.inputHash, plan.units.find(row => row.state === "AZ")!.inputHash);
    assert.equal(changed.units.find(row => row.state === "NH")!.inputHash, plan.units.find(row => row.state === "NH")!.inputHash);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
