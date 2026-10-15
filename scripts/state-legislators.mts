#!/usr/bin/env tsx
import { fetchSource } from "../lib/sources/fetch-source.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { readCompleteResponse } from "../lib/sources/source-bytes.ts";


import {
  officialStateLegislatorsCandidate,
} from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { routineReceiptFields } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import {
  AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT,
  parseAzLegislatureRoster,
  validateAzLegislatureRosterFinalUrl,
} from "../lib/sources/az-legislature/roster.ts";
import {
  NJ_LEGISLATURE_ROSTER_URL,
  parseNjLegislatureRoster,
  validateNjLegislatureRosterFinalUrl,
} from "../lib/sources/nj-legislature/roster.ts";
import {
  officialStateLegislatorTargetByState,
  type OfficialStateCode,
} from "../lib/state-rollcalls/authority.ts";

const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

export interface StateLegislatorArguments {
  readonly state: Exclude<OfficialStateCode, "NH">;
}

/** Exact registered CLI shape; NH must continue through its complete adapter. */
export function parseStateLegislatorArguments(args: readonly string[]): StateLegislatorArguments {
  if (args.filter((value) => value === "--promote").length !== 1) {
    throw new Error("STATE_LEGISLATOR_PROMOTION_REQUIRED");
  }
  const stateArgs = args.filter((value) => value.startsWith("--state="));
  const unknown = args.filter((value) => value !== "--promote" && !value.startsWith("--state="));
  if (stateArgs.length !== 1 || unknown.length > 0) {
    throw new Error("STATE_LEGISLATOR_EXACT_SCOPE_REQUIRED");
  }
  const target = officialStateLegislatorTargetByState(stateArgs[0]!.slice("--state=".length));
  if (!target || target.state === "NH") throw new Error("STATE_LEGISLATOR_STATE_UNSUPPORTED");
  return { state: target.state };
}

async function main(): Promise<void> {
  const { state } = parseStateLegislatorArguments(process.argv.slice(2));
  const target = officialStateLegislatorTargetByState(state);
  if (!target || target.state === "NH") throw new Error(`STATE_LEGISLATOR_TARGET_MISSING:${state}`);

  installNeonRequestDeadline();
  prepareProductionCivicDataWrite();
  const store = new PostgresRoutineDataStore();

  let response: Response;
  let body: string;
  let retrievedAt: string;
  let parsed: ReturnType<typeof parseAzLegislatureRoster> | ReturnType<typeof parseNjLegislatureRoster>;
  try {
    const acquired = await withPublisherAcquisitionDeadline(
      `${target.publisher} current legislative roster`,
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      async (signal) => {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
        const result = await requestPublisher(
          `${target.publisher} current legislative roster`,
          () => fetchSource(target.probeUrl, {
            headers: { "user-agent": UA, accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
            redirect: "follow",
            signal: requestSignal,
          }),
        );
        if (!result.ok) {
          throw sourceAcquisitionFailure(
            "PUBLISHER_RESPONSE_REFUSED",
            `${target.publisher} current legislative roster answered HTTP ${result.status}.`,
          );
        }
        const raw = await readPublisherBody(
          `${target.publisher} current legislative roster`,
          async () => new TextDecoder("utf-8",{fatal:true}).decode(await readCompleteResponse(result,16*1024*1024)),
        );
        requestSignal.throwIfAborted();
        if (raw.trim() === "") {
          throw sourceAcquisitionFailure(
            "PUBLISHER_DOCUMENT_INVALID",
            `${target.publisher} current legislative roster returned an empty document.`,
          );
        }
        return { response: result, body: raw };
      },
    );
    response = acquired.response;
    body = acquired.body;
    retrievedAt = new Date().toISOString();
    if (state === "AZ") {
      if (target.probeUrl !== AZ_LEGISLATURE_ROSTER_SOURCE_CONTRACT.requestedUrl) {
        throw new Error("AZ_STATE_LEGISLATOR_REGISTERED_ROUTE_MISMATCH");
      }
      validateAzLegislatureRosterFinalUrl(response.url || target.probeUrl);
      parsed = parseAzLegislatureRoster(body, retrievedAt);
    } else {
      if (target.probeUrl !== NJ_LEGISLATURE_ROSTER_URL) {
        throw new Error("NJ_STATE_LEGISLATOR_REGISTERED_ROUTE_MISMATCH");
      }
      validateNjLegislatureRosterFinalUrl(response.url || target.probeUrl);
      parsed = parseNjLegislatureRoster(body, retrievedAt);
    }
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: target.contractId,
      failure: error,
      requestedUrl: target.probeUrl,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }

  const prior = await readOfficialStateLegislatorsProjection(target.jurisdiction,{store,now:retrievedAt,bypassCache:true});
  if (prior.kind === "STORE_UNREACHABLE") throw Error("STATE_PEOPLE_PRIOR_UNAVAILABLE");
  const candidate = officialStateLegislatorsCandidate({
    priorRoster: prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value.roster : null,
    sourceId: target.sourceId,
    jurisdiction: target.jurisdiction,
    requestedUrl: target.probeUrl,
    finalUrl: response.url || target.probeUrl,
    httpStatus: response.status,
    retrievedAt,
    rawBodies: [body],
    term: parsed.term,
    expectedTerm: parsed.term,
    declaredTotal: parsed.roster.officeholders.length,
    roster: parsed.roster,
    sourceAudit: {
      observedRecords: parsed.observedRecords,
      excludedRecords: "excludedRecords" in parsed
        ? parsed.excludedRecords.map((row) => ({
          officialPersonId: row.officialPersonId,
          chamber: row.chamber,
          disposition: row.disposition,
          sourceUrl: row.sourceUrl,
        }))
        : [],
      legislature: parsed.legislature,
      session: "session" in parsed ? parsed.session : null,
    },
  });
  const outcome = await processRegisteredRoutineCandidate(
    store,
    target.contractId,
    candidate,
    retrievedAt,
    undefined,
    { confirmUnchanged: true },
  );
  console.log("RCD_RECEIPT=" + JSON.stringify({
    source: target.contractId,
    ...routineReceiptFields(candidate, outcome),
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }));
  if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/state-legislators.mts");
if (invokedDirectly) await main();
