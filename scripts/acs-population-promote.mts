/** Direct Census ACS retrieval/validation/promotion; writes no repository file. */
import { fetch as acsFetch, KEY_VAR } from "../lib/sources/census-acs-population/index.ts";
import { censusAcsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const key = process.env[KEY_VAR];
const [zcta, state] = await Promise.all([acsFetch("zcta", key), acsFetch("state", key)]);
const candidate = censusAcsCandidate(zcta, state);
const outcome = await processRoutineCandidate(new PostgresRoutineDataStore(), candidate, candidate.retrieval.retrievedAt);
console.log("RCD_RECEIPT=" + JSON.stringify({ source: "Census ACS", candidateId: candidate.id, acquisitionSucceeded: outcome.candidate.acquisitionSucceeded, state: outcome.candidate.state, decision: outcome.candidate.receipt?.decision ?? null, promotedVersion: outcome.promoted?.versionId ?? null, lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion, releaseEvents: ZERO_RELEASE_EVENTS }));
if (!outcome.promoted) process.exitCode = 2;
