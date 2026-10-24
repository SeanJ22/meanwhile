import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { POST } from "../app/api/reactions/route.ts";
import { activateCanonicalFixture, installReaderValues } from "./helpers/canonical-reader-fixtures.ts";
import { manualEdgeEntry, promotedFamily } from "./helpers/promoted-edge-entry.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { factDb } from "./helpers/fact-db.ts";
import { identitySourceTables, identityEventTables, readerIdentityMigration } from "./helpers/reader-identity-db.ts";
import { installFactReader } from "../lib/facts/db.ts";

// Public record ids present in production reactions when RB-A1 was built.
const targets: Readonly<Record<string, readonly string[]>> = {
  "AZ": [
    "ballot-az-pima:governor|Katie Hobbs",
    "ballot-az-pima:secretary-of-state|Adrian Fontes",
    "ballot-az-pima:governor|Andy Biggs",
    "ballot-az-pima:attorney-general|Kris Mayes",
    "ballot-az-pima:us-house-7|Adelita Grijalva",
    "ballot-az-pima:state-treasurer|Nick Mansour",
    "ballot-az-pima:superintendent|Kimberly Yee",
    "ballot-az-pima:superintendent|Teresa Leyba Ruiz"
  ],
  "NH": [
    "ballot-nh-merrimack:governor:ayotte-kelly",
    "ballot-nh-merrimack:register-of-probate:bradstreet-jane",
    "ballot-nh-merrimack:governor:warmington-cinde",
    "ballot-nh-merrimack:us-senate:pappas-chris"
  ],
  "CO": [
    "co-sos-2026-general-governor-state-phil-weiser",
    "co-sos-2026-general-us-senate-state-john-hickenlooper",
    "co-sos-2026-general-secretary-of-state-state-sean-vadney",
    "co-sos-2026-general-state-treasurer-state-jeff-bridges",
    "co-sos-2026-general-attorney-general-state-michael-j-allen"
  ]
};

test("the reaction API retains all 17 existing candidate targets", async () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";
  const db = await factDb({ withResolver: false });
  try {
    await identitySourceTables(db.pg);
    await identityEventTables(db.pg);
    await db.pg.exec(readerIdentityMigration());
    await db.pg.exec(`INSERT INTO entity(id,kind,name,state) VALUES
      ('plural:6e522a2a-e7b7-4713-a40f-c897e4341a87','person','Katie Hobbs','AZ'),
      ('ballot-az-pima:governor:biggs-andy','person','Andy Biggs','AZ');
      INSERT INTO entity_external_id VALUES
      ('plural:6e522a2a-e7b7-4713-a40f-c897e4341a87','campaign-person:AZ','ballot-az-pima:governor|Katie Hobbs'),
      ('plural:6e522a2a-e7b7-4713-a40f-c897e4341a87','campaign-person:AZ','unseen-old-key'),
      ('ballot-az-pima:governor:biggs-andy','campaign-person:AZ','ballot-az-pima:governor|Andy Biggs');
      INSERT INTO reactions VALUES('ballot-az-pima:governor|Katie Hobbs','CANDIDATE'),('ballot-az-pima:governor|Andy Biggs','CANDIDATE')`);
    for (const [state, ids] of Object.entries(targets)) {
      const raw = JSON.parse(readFileSync(`data/ballot/2026-general/${state.toLowerCase()}.json`, "utf8")) as { ballots: Record<string, BallotSet> };
      const version = `candidate-continuity:${state}`;
      installReaderValues({ stateAuthorities: { "ballot-contests": { [state]: promotedFamily([
        manualEdgeEntry(stateBallotContractId("ballot-contests", state), { kind: "ballot-contests", ballots: raw.ballots }, version),
      ], version) } } }, version);
      installFactReader(db.query);
      const divisions = [`ocd-division/country:us/state:${state.toLowerCase()}`];
      if (state === "AZ") divisions.push("ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/cd:7");
      if (state === "NH") divisions.push("ocd-division/country:us/state:nh/county:merrimack", "ocd-division/country:us/state:nh/cd:2");
      for (const targetId of ids) {
        const url = new URL("https://local.invalid/api/reactions");
        for (const division of divisions) url.searchParams.append("division", division);
        // LOVE is a valid reaction value on the funding scale. Candidate authority is checked first,
        // then this off-scale answer returns before the rate limiter or event writer can run.
        const response = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetType: "CANDIDATE", targetId, reaction: "LOVE", reactionKey: "1234567890abcdef1234567890abcdef" }) }));
        assert.equal(response.status, 400, targetId);
        assert.equal((await response.json()).error, "that answer is not on this question's scale", targetId);
      }
    }
    for (const [state, targetId] of [["AZ", "unseen-old-key"], ["NH", "ballot-az-pima:governor|Katie Hobbs"]]) {
      activateCanonicalFixture(`candidate-continuity:${state}`);
      installFactReader(db.query);
      const url = new URL("https://local.invalid/api/reactions");
      url.searchParams.append("division", `ocd-division/country:us/state:${state.toLowerCase()}`);
      const response = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType: "CANDIDATE", targetId, reaction: "LOVE", reactionKey: "1234567890abcdef1234567890abcdef" }) }));
      assert.equal((await response.json()).error, "unknown targetId", "a saved person alone or a different state cannot admit a candidate");
    }
  } finally {
    installFactReader(undefined);
    await db.pg.close();
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});
