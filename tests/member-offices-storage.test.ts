import assert from "node:assert/strict";
import test from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { freezeDurableJson } from "../lib/civic-data/durable-json.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { civicPayloadBytes } from "../lib/civic-data/payload-codec.ts";
import { parseValidationReceipt } from "../lib/civic-data/receipt.ts";
import { MEMBER_OFFICES_SCOPE } from "../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type RoutineCandidate, type ValidationReceipt } from "../lib/civic-data/types.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const at = "2026-10-01T00:00:00.000Z";
const sourceUrl = "https://data.openstates.org/people/current/az.csv";
const records = Array.from({ length: 256 }, (_, index) => ({
  id: `member-office:plural:az:${index}:capitol`, kind: "MEMBER_OFFICE", officeholderId: `plural:az:${index}`, officeKind: "CAPITOL",
  office: { address: `${index} ${"1700 W Washington public office ".repeat(1536)}`, city: "Phoenix", state: "AZ", zip: "85007", phone: "602-555-0100", email: "office@example.gov", lat: null, lng: null },
  sourceUrl, sourceOrg: "Open States (Plural, CC-0)", official: false, collectedAt: at,
}));

function candidate(now = at, phone = "602-555-0100"): RoutineCandidate {
  const payload = { kind: "member-offices", records: records.map((row, index) => index ? row : { ...row, office: { ...row.office, phone } }),
    rosterDigests: { "US-AZ": now }, pending: ["US-TX"] };
  return freezeDurableJson({ ...manualProjectionCandidate({ contractId: "member-offices", version: now, sourceThrough: now,
    sourceReceipt: { contractVersion: 1, reviewedAt: now, reviewedBy: "test:member-office-storage", sources: [{ requestedUrl: sourceUrl,
      finalUrl: sourceUrl, publisher: "Open States (Plural, CC-0)", sourceClass: "REFERENCE_PUBLISHER", retrievedAt: now,
      httpStatus: 200, rawHash: (now === at ? "a" : "b").repeat(64), reviewedEvidence: "Exact acquired office evidence. ".repeat(3000) }] }, payload }),
    excludedFacts: payload.records.map(row => ({ key: row.id, code: "MANUAL_MEMBER_HELD_LKG", detail: "Exact earlier sourced office retained.", record: row })),
  });
}

function goodReceipt(value: RoutineCandidate): ValidationReceipt {
  return { contractVersion: 2, candidateId: value.id, sourceId: value.sourceId, recordClass: value.recordClass, scope: value.scope,
    decision: "GOOD", validatedAt: value.retrieval.retrievedAt,
    checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "MEMBER_OFFICE_STORAGE", detail: "Exact source office fixture." })),
    excludedFacts: value.excludedFacts ?? [] };
}

test("a member-office package exceeding 42 MiB uses bounded immutable writes, exact receipts and restartable creation", async () => {
  installFactReader(async () => []);
  try {
    await withMigratedRoutineStore("member-offices", async (store, _vault, pg) => {
      const owned = store as unknown as { writeAuthority: Record<string, unknown> };
      owned.writeAuthority = { ...owned.writeAuthority, capability: "MANUAL_CONTRACT" };
      const transport = neonConfig.fetchFunction!;
      let writingReplacement = false, replacementWrites = 0;
      const requests: { query: string; params?: unknown[] }[] = [];
      const promoteQueries: string[] = [];
      let promoting = false;
      neonConfig.fetchFunction = (async (...args: Parameters<typeof transport>) => {
        const init = args[1] as { body: string };
        const request = JSON.parse(init.body) as { query?: string; params?: unknown[]; queries?: { query: string; params?: unknown[] }[] };
        const statements = request.queries ?? (request.query ? [{ query: request.query, params: request.params }] : []);
        assert.ok(Buffer.byteLength(init.body) < 5 * 1024 * 1024, "every HTTP request stays bounded, including JSON parameter escaping");
        if (promoting) promoteQueries.push(...statements.map(statement => statement.query));
        for (const statement of statements) if (/insert into "civic_data_payload_parts"/i.test(statement.query)) {
          requests.push(statement);
          if (writingReplacement && ++replacementWrites === 2) throw new Error("TEST_PART_WRITE_INTERRUPTED");
        }
        return transport(...args);
      }) as typeof neonConfig.fetchFunction;
      try {
        const first = candidate();
        assert.ok(civicPayloadBytes(first) > 42 * 1024 * 1024, "exercise the failed production package size");
        const create = async (value: RoutineCandidate, base: string | null = null) => store.create({ candidate: value, state: "FETCHED", acquisitionSucceeded: true,
          receipt: null, promotedVersion: null, lastKnownGoodVersion: base, failureCode: null, failureDetail: null },
        { candidateId: value.id, sequence: 1, state: "FETCHED", at: value.retrieval.retrievedAt, detail: "Exact source office acquisition." });
        await create(first);
        const receipt = goodReceipt(first);
        await store.transition(first.id, "NORMALIZED", at, "Office facts parsed.", undefined, undefined, { candidate: first });
        await store.transition(first.id, "VALIDATED", at, "Office facts validated.", receipt, undefined, { candidate: first });
        promoting = true;
        const published = await store.promote(first.id, receipt, at, { candidate: first });
        promoting = false;
        assert.deepEqual(published.payload, first.readModel);
        assert.ok(promoteQueries.every(query => !/select[^;]*"candidate"\s*,[^;]*from "civic_data_candidates"/is.test(query)), "promotion uses held candidate and persisted scalar envelope");
        const stored = (await pg.query<{ bytes: number; model: unknown; facts: unknown; identity: unknown }>(
          "SELECT octet_length(candidate::text) AS bytes, candidate->'readModel' AS model, validation_receipt->'excludedFacts' AS facts, identity FROM civic_data_candidates WHERE id=$1", [first.id])).rows[0]!;
        assert.ok(stored.bytes < 32 * 1024);
        for (const value of [stored.model, stored.facts, stored.identity]) assert.equal(typeof (value as { $civicPayloadPart?: unknown }).$civicPayloadPart, "string");
        const loaded = (await store.readCandidate(first.id))!;
        assert.equal(canonicalCivicDataHash(loaded.candidate), canonicalCivicDataHash(first, { durable: true }));
        assert.deepEqual(loaded.receipt, receipt);
        assert.ok(parseValidationReceipt((await store.readPublishedCandidateMetadata(first.id))?.receipt));
        assert.equal((await store.clock(first.sourceId, first.recordClass, first.scope)).continuationPending, true);

        const next = candidate("2026-10-02T00:00:00.000Z", "602-555-0200");
        writingReplacement = true;
        const interruptedAt = requests.length;
        await assert.rejects(create(next, first.id), (error:unknown) => {
          const pending=[error],seen=new Set<unknown>();
          while(pending.length){
            const cause=pending.pop();if(!(cause instanceof Error)||seen.has(cause))continue;
            seen.add(cause);if(cause.message.includes("TEST_PART_WRITE_INTERRUPTED"))return true;
            pending.push(cause.cause,(cause as Error&{sourceError?:unknown}).sourceError);
          }
          return false;
        });
        writingReplacement = false;
        assert.equal((await pg.query("SELECT id FROM civic_data_candidates WHERE id=$1", [next.id])).rows.length, 0);
        assert.equal((await store.readPromotionIdentity("CURATED_READER_RECORD", MEMBER_OFFICES_SCOPE))?.versionId, first.id);
        const accepted = new Set(requests[interruptedAt].params?.filter(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)));
        const retriedAt = requests.length;
        await create(next, first.id);
        assert.ok(requests.slice(retriedAt).every(statement => statement.params?.every(value => !accepted.has(value))), "retry reuses content-addressed parts committed before interruption");
        const nextReceipt = goodReceipt(next);
        await store.transition(next.id, "NORMALIZED", next.retrieval.retrievedAt, "Changed office parsed.", undefined, undefined, { candidate: next });
        await store.transition(next.id, "VALIDATED", next.retrieval.retrievedAt, "Changed office validated.", nextReceipt, undefined, { candidate: next });
        const promoted = await store.promote(next.id, nextReceipt, next.retrieval.retrievedAt, { candidate: next });
        assert.deepEqual(promoted.payload, next.readModel);
        assert.deepEqual((await store.readCandidate(first.id))?.receipt, receipt, "the earlier edition and every retained source remain intact");
      } finally { neonConfig.fetchFunction = transport; }
    });
  } finally { installFactReader(undefined); }
});
