import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FederalMoneyBenchmarkStore } from "../scripts/lib/federal-money-benchmark-store.mts";
import { seedFederalMoneyBenchmarkIdentities } from "../scripts/lib/federal-money-benchmark-identities.mts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { saveFederalMoneyCapture } from "../lib/federal-money/vault.ts";
import { readFederalMoneyJoinInput } from "../lib/federal-money/held-identities.ts";
import { locateFederalMoneyFacts } from "../lib/federal-money/locations.ts";
import { joinFederalMoneyFacts } from "../lib/federal-money/join.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";

test("actual PostgreSQL migrations and store publish bounded federal partitions through the Neon driver", async () => {
  const directory = mkdtempSync(join(tmpdir(), "federal-postgres-"));
  const store = await FederalMoneyBenchmarkStore.open(join(directory, "database"), "openfema");
  try {
    const governments = referenceGovernmentListings(loadRegistrationReference(process.cwd(), "AR")).map(government => ({ ...government,
      nativeIds: { ...government.nativeIds, uei: createHash("sha256").update(government.id).digest("hex").slice(0, 12).toUpperCase() },
    }));
    mkdirSync(join(directory, "seeds"));
    writeFileSync(join(directory, "seeds", "ar.jsonl"), governments.map(government => JSON.stringify({ government, state: "AR", uei: government.nativeIds.uei })).join("\n") + "\n");
    assert.equal((await seedFederalMoneyBenchmarkIdentities(store, directory, ["AR"])).governments, governments.length);
    const vault = new DurableEvidenceStore(join(directory, "vault"), { remote: null });
    const entityBody = JSON.stringify({ entityData: governments.slice(0, 500).map(government => ({ entityRegistration: { ueiSAM: government.nativeIds.uei, legalBusinessName: government.name } })) });
    const entityCapture = await saveFederalMoneyCapture({ body: entityBody, url: "https://api.sam.gov/entity-information/v3/entities", retrievedAt: new Date().toISOString(), publicationDate: null }, vault);
    const entities = parseFederalMoney("sam-gov-entities", entityCapture, "AR", entityBody);
    const identities = await readFederalMoneyJoinInput("AR", entities, store.query);
    assert.equal(identities.governments.length, 500);
    assert.ok(joinFederalMoneyFacts(entities, identities).every(row => row.joinStatus === "JOINED"));
    const fixture = readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8");
    const native = JSON.parse(fixture).DisasterDeclarationsSummaries[0];
    let page = 0;
    const result = await refreshFederalMoney({ source: "openfema", store, states: ["AR"], acquireOptions: { evidenceStore: vault },
      identities: (state, facts) => readFederalMoneyJoinInput(state, facts, store.query),
      locate: (state, facts) => locateFederalMoneyFacts("openfema", state, facts, store.query),
      acquire: async (_source, state) => {
        const body = page++ === 0 ? fixture : JSON.stringify({ DisasterDeclarationsSummaries: Array.from({ length: 500 }, (_, index) => ({
          ...native, id: `generated-postgres-${index}`, declarationTitle: "Generated PostgreSQL partition check",
        })) });
        const capture = await saveFederalMoneyCapture({ body, url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries", retrievedAt: new Date().toISOString(), publicationDate: null }, vault);
        return { facts: parseFederalMoney("openfema", capture, state, body), captures: [capture], complete: page === 2, declaredTotal: 501,
          continuation: page === 2 ? null : { source: "openfema", phase: "declarations", offset: 1 } };
      },
    });
    assert.ok(result.outcome.promoted);
    assert.equal(result.projection.counts.loaded, 501);
    const [rows] = await store.query([{ text: "SELECT max(jsonb_array_length(payload->'records')) AS largest FROM civic_data_promotions WHERE record_class = 'FEDERAL_MONEY' AND payload ? 'records'", params: [] }]);
    assert.ok(Number(rows[0]?.largest) <= 500);
    assert.ok(store.bytes.read > 0 && store.bytes.written > 0 && store.bytes.statements > 0);
    assert.ok(store.bytes.largestRead < 8 * 1024 * 1024);
    const before = { ...store.bytes };
    const repeated = await refreshFederalMoney({ source: "openfema", store, states: ["AR"], acquireOptions: { evidenceStore: vault },
      identities: (state, facts) => readFederalMoneyJoinInput(state, facts, store.query),
      acquire: async () => { throw new Error("Fresh source must not download again"); },
    });
    assert.equal(repeated.projection.counts.loaded, 501);
    assert.ok(store.bytes.read - before.read < before.read);
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
