/**
 * The New Hampshire General Court's own roster. `gc.nh.gov/downloads/Members.txt`
 * is a tab-delimited file of every member of both chambers with district,
 * party, phone, work email, committee assignments and `electedStatus`, the
 * body's own statement of who currently sits.
 *
 * `electedStatus` reads `" Incumbent"`, with a leading space; compare trimmed.
 * The file states no count of its own, so the outcome is `COULD_NOT_ASSERT`
 * against a stated total, and the extraction reports produced/dropped/total.
 * The freshness stamp is the date this script fetched, carried forward
 * unchanged when regenerated from a cached copy.
 *
 * Usage:
 *   pnpm nh:members            # fetch, parse, report; writes nothing
 *   pnpm nh:members --from <path>   # parse a local copy instead of fetching
 * Production cadence and owner-initiated promotion enter through the installed
 * runtime dispatcher; this file is the internal `nh-members` adapter.
 */

import { readFileSync } from "node:fs";

import { acquireKnownRelease, knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { nhMembersCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { routineReceiptFields } from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  recordRegisteredSourceAcquisitionFailure,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import {
  decodeNhPublisherBytes,
  joinNhCurrentMemberIdentities,
  NH_LEGISLATORS_URL,
  NH_MEMBERS_URL,
  NH_ROLL_HISTORY_URL,
  parseNhLegislators,
  parseNhRollCallHistory,
  readNhOfficialDocumentsSerially,
  type NhCurrentMemberIdentityCrosswalk,
  type NhOfficialDocument,
} from "../lib/sources/nh-general-court/official-data.ts";

const SOURCE_URL = NH_MEMBERS_URL;
const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

export type ElectedStatus = "INCUMBENT" | "NEW" | "FORMER" | "UNSTATED";

export interface GencourtMember {
  /** `H` or `S`, as the file writes it. */
  readonly chamber: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly middleName: string | null;
  /** The body's own seat number. NOT the `member=` id on a member page. */
  readonly seatNo: string;
  readonly county: string;
  readonly district: string;
  readonly electedStatus: ElectedStatus;
  readonly party: string | null;
  readonly title: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly town: string | null;
  readonly committees: readonly string[];
}

export interface MembersExtraction {
  readonly members: readonly GencourtMember[];
  readonly counts: {
    readonly logicalInput: number;
    readonly produced: number;
    readonly dropped: number;
    /** The source states no total of its own. */
    readonly statedTotal: null;
    readonly verdict: "COULD_NOT_ASSERT";
  };
  readonly byStatus: Readonly<Record<ElectedStatus, number>>;
  readonly byChamber: Readonly<Record<string, number>>;
}

/** The file writes `" Incumbent"` with a leading space. Trim, then compare. */
export function readElectedStatus(raw: string): ElectedStatus {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "incumbent") return "INCUMBENT";
  if (v === "new") return "NEW";
  if (v === "former") return "FORMER";
  return "UNSTATED";
}

export function parseMembers(text: string): MembersExtraction {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `nh:members: the file carries ${lines.length} non-empty line(s). A roster of the New Hampshire ` +
        "General Court is 400-odd rows, so this is a failed retrieval, not an empty legislature.",
    );
  }

  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const required = ["LastName", "FirstName", "LegislativeBody", "District", "electedStatus"];
  const missing = required.filter((r) => col(r) < 0);
  if (missing.length > 0) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `nh:members: the file's header does not carry ${missing.join(", ")}. The columns present are: ` +
        `${header.join(", ")}. A parser that guessed positions here would silently mis-read every row.`,
    );
  }

  const body = lines.slice(1);
  const members: GencourtMember[] = [];
  let dropped = 0;

  for (const line of body) {
    const c = line.split("\t");
    const at = (name: string) => (col(name) >= 0 ? (c[col(name)] ?? "").trim() : "");
    const family = at("LastName");
    const given = at("FirstName");
    if (!family || !given) {
      dropped += 1;
      continue;
    }
    const committees = ["Committee1", "Committee2", "Committee3", "Committee4", "Committee5"]
      .map(at)
      .filter((x) => x.length > 0);
    members.push({
      chamber: at("LegislativeBody"),
      familyName: family,
      givenName: given,
      middleName: at("MiddleName") || null,
      seatNo: at("seatno"),
      county: at("County"),
      district: at("District"),
      electedStatus: readElectedStatus(at("electedStatus")),
      party: at("party") || null,
      title: at("PersonTitle") || null,
      phone: at("Phone") || null,
      email: at("WorkEmail") || null,
      town: at("city") || null,
      committees,
    });
  }

  const byStatus: Record<ElectedStatus, number> = { INCUMBENT: 0, NEW: 0, FORMER: 0, UNSTATED: 0 };
  const byChamber: Record<string, number> = {};
  for (const m of members) {
    byStatus[m.electedStatus] += 1;
    byChamber[m.chamber] = (byChamber[m.chamber] ?? 0) + 1;
  }

  // Every logical record has one disposition, and the sum is exact.
  if (members.length + dropped !== body.length) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `nh:members: ${members.length} produced + ${dropped} dropped does not equal ${body.length} input ` +
        "rows. A record with no disposition vanished.",
    );
  }

  return {
    members,
    counts: {
      logicalInput: body.length,
      produced: members.length,
      dropped,
      statedTotal: null,
      verdict: "COULD_NOT_ASSERT",
    },
    byStatus,
    byChamber,
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const invokedDirectly = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/nh-gencourt-members.mts");

async function main(): Promise<void> {
  installNeonRequestDeadline();
  if (process.argv.includes("--write")) {
    throw new Error(
      "The tracked NH members writer is retired. Run the registered nh-members contract " +
        "through the installed runtime dispatcher; direct tracked output is refused.",
    );
  }
  const local = arg("from");
  const promote = process.argv.includes("--promote");
  if (promote && local) {
    throw new Error(
      "The registered nh-members production contract refuses local --from input: a local " +
        "copy is not a live authoritative retrieval.",
    );
  }
  let store: PostgresRoutineDataStore | null = null;
  if (promote) {
    prepareProductionCivicDataWrite();
    store = new PostgresRoutineDataStore();
  }

  let text: string;
  let readOn: string;
  let retrievedAt = new Date().toISOString();
  let finalUrl = SOURCE_URL;
  let httpStatus = 200;
  let identityText: string | null = null;
  let identityHistoryText: string | null = null;
  let identityFinalUrl: string | null = null;
  let identityHttpStatus: number | null = null;
  let identityCrosswalk: NhCurrentMemberIdentityCrosswalk | null = null;
  let sourceCheck:import("../lib/civic-data/types.ts").SourceCheckEvidence|undefined;
  let extraction: MembersExtraction;
  try {
    if (local) {
      text = readFileSync(local, "utf8");
      // A local copy carries no evidence of when it was read, so the read stamp
      // is UNKNOWN rather than today's date.
      readOn = "UNKNOWN";
    } else {
      const acquired = await withPublisherAcquisitionDeadline(
        "NH General Court members",
        ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
        async (signal) => {
          return readNhOfficialDocumentsSerially(
            promote ? [SOURCE_URL, NH_LEGISLATORS_URL, NH_ROLL_HISTORY_URL] : [SOURCE_URL],
            async (url): Promise<NhOfficialDocument> => {
              const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
              try {
                const held=await acquireKnownRelease({sourceId:"nh-general-court",releaseId:url,url,parserVersion:"nh-general-court/3",maxBytes:64*1024*1024,checkAfterMs:86400000,signal:requestSignal,headers:{"user-agent":UA,accept:"text/plain,*/*"},validate:bytes=>{const body=decodeNhPublisherBytes(bytes);if(url===SOURCE_URL)parseMembers(body);else if(url===NH_LEGISLATORS_URL)parseNhLegislators(body);else parseNhRollCallHistory(body);}});
                return {requestedUrl:held.requestedUrl,finalUrl:held.finalUrl,httpStatus:held.httpStatus,body:decodeNhPublisherBytes(held.bytes),retrievedAt:held.retrievedAt,sourceCheck:knownReleaseSourceCheck(held)};
              } catch(error) {
                if(url!==NH_ROLL_HISTORY_URL)throw error;
                console.error(`NH optional identity-history unavailable: ${error instanceof Error ? error.message : String(error)}`);
                return {requestedUrl:url,finalUrl:url,httpStatus:0,body:""};
              }
            },
            { signal },
          );
        },
      );
      const memberDocument = acquired[0]!;
      text = memberDocument.body;
      retrievedAt = memberDocument.retrievedAt ?? new Date().toISOString();
      sourceCheck = memberDocument.sourceCheck;
      finalUrl = memberDocument.finalUrl;
      httpStatus = memberDocument.httpStatus;
      const identityDocument = acquired[1];
      if (identityDocument) {
        identityText = identityDocument.body;
        identityFinalUrl = identityDocument.finalUrl;
        identityHttpStatus = identityDocument.httpStatus;
      }
      identityHistoryText = acquired[2]?.body ?? null;
      // @freshness-reads-here — this clock call sits in the reading path, so the
      // stamp it produces names the day somebody actually looked.
      readOn = retrievedAt.slice(0,10);
    }
    extraction = parseMembers(text);
    if (promote) {
      if (identityText === null || identityHistoryText === null || identityFinalUrl === null || identityHttpStatus === null) {
        throw sourceAcquisitionFailure(
          "PUBLISHER_DOCUMENT_INVALID",
          "nh:members: the canonical promotion did not acquire legislators.txt for official PersonID identity.",
        );
      }
      const identityRows = parseNhLegislators(identityText);
      const historyRows = identityHistoryText ? parseNhRollCallHistory(identityHistoryText) : [];
      identityCrosswalk = joinNhCurrentMemberIdentities(
        extraction,
        identityRows,
        identityText,
        historyRows,
        identityHistoryText,
      );
    }
  } catch (error) {
    if (!promote || store === null || !isSourceAcquisitionFailure(error)) throw error;
    const failed = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: "nh-members",
      failure: error,
    });
    console.log(failed.line);
    process.exitCode = 2;
    return;
  }
  console.log(`nh:members · ${SOURCE_URL}`);
  console.log(`  read on              ${readOn}`);
  console.log(`  logical input rows   ${extraction.counts.logicalInput}`);
  console.log(`  produced             ${extraction.counts.produced}`);
  console.log(`  dropped              ${extraction.counts.dropped}`);
  console.log(`  stated total         none — the file states no count (${extraction.counts.verdict})`);
  console.log(`  by chamber           ${JSON.stringify(extraction.byChamber)}`);
  console.log(`  by elected status    ${JSON.stringify(extraction.byStatus)}`);
  console.log(`  with an email        ${extraction.members.filter((m) => m.email).length}`);
  console.log(`  with a phone         ${extraction.members.filter((m) => m.phone).length}`);

  if (promote) {
    if (store === null) throw new Error("NH_PRODUCTION_STORE_NOT_INITIALIZED");
    if (identityText === null || identityHistoryText === null || identityFinalUrl === null || identityHttpStatus === null || identityCrosswalk === null) {
      throw new Error("NH_OFFICIAL_PERSON_ID_CROSSWALK_NOT_INITIALIZED");
    }
    const now = new Date().toISOString();
    const prior = await readNhMembers({store,now,bypassCache:true});
    if (prior.kind === "STORE_UNREACHABLE") throw Error("NH_PRIOR_UNAVAILABLE");
    const candidate = nhMembersCandidate({
      prior: prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value : null,
      priorRetrievedAt: prior.metadata.retrievedAt ?? undefined,
      rawText: text,
      rawIdentityText: `${identityText}\n${identityHistoryText}`,
      finalUrl,
      identityFinalUrl,
      httpStatus,
      identityHttpStatus,
      retrievedAt,
      sourceCheck,
      extraction,
      identityCrosswalk,
    });
    const outcome = await processRegisteredRoutineCandidate(store, "nh-members", candidate, now, undefined, { confirmUnchanged: true });
    console.log("RCD_RECEIPT=" + JSON.stringify({ source: "nh-members", ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    if (!outcome.promoted && !outcome.confirmed) process.exitCode = 2;
  }
}

if (invokedDirectly) await main();
