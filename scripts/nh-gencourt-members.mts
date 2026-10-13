/** The NH House and Senate current roster pages supply exact PersonIDs and sitting status.
 * Members.txt enriches those exact current seats. Every read reuses saved source bytes after a conditional check.
 * The installed runtime dispatcher runs this adapter daily and after an Admin officials check. */

import { readFileSync } from "node:fs";

import { acquireKnownRelease, knownReleaseSourceCheck, requestedSourceCheckAfter } from "../lib/sources/known-release.ts";
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
  NH_MEMBERS_URL,
  type NhCurrentMemberIdentityCrosswalk,
  type NhOfficialDocument,
} from "../lib/sources/nh-general-court/official-data.ts";
import { readNhCurrentMemberIdentities, NH_CURRENT_HOUSE_URL, NH_CURRENT_SENATE_URL, parseNhCurrentHouseRoster, parseNhCurrentSenateRoster } from "../lib/sources/nh-general-court/current-identities.ts";

const SOURCE_URL = NH_MEMBERS_URL;
const UA = "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)";

/** The current official roster supplies identity and sitting status; the bulk file enriches exact matched seats. */
export async function acquireNhMembersSource(input: {
  signal: AbortSignal;
  read?: (url: string) => Promise<NhOfficialDocument>;
}) {
  const read = input.read ?? (async (url: string): Promise<NhOfficialDocument> => {
    const decode = (bytes: Uint8Array) => url === SOURCE_URL ? decodeNhPublisherBytes(bytes) : new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    const held = await acquireKnownRelease({sourceId: "nh-general-court", releaseId: url, url, parserVersion: "nh-current-members/1",
      maxBytes: 16 * 1024 * 1024, checkAfterMs: 86_400_000, checkedAfter: requestedSourceCheckAfter(), signal: input.signal,
      headers: {"user-agent": UA, accept: "text/html,text/plain,*/*"}, validate: bytes => {
        const body = decode(bytes);
        if (url === SOURCE_URL) parseMembers(body);
        else if (url === NH_CURRENT_HOUSE_URL) parseNhCurrentHouseRoster(body);
        else if (url === NH_CURRENT_SENATE_URL) parseNhCurrentSenateRoster(body);
      }});
    return {requestedUrl: held.requestedUrl, finalUrl: held.finalUrl, httpStatus: held.httpStatus, body: decode(held.bytes),
      retrievedAt: held.retrievedAt, sourceCheck: knownReleaseSourceCheck(held)};
  });
  // A failed enrichment file cannot withhold independently verified current roster rows.
  let memberDocument: NhOfficialDocument;
  try { memberDocument = await read(SOURCE_URL); }
  catch (error) {
    input.signal.throwIfAborted();
    memberDocument = {requestedUrl: SOURCE_URL, finalUrl: SOURCE_URL, httpStatus: 0, body: ""};
    console.warn(`NH bulk enrichment unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const extraction = memberDocument.body ? parseMembers(memberDocument.body) : {members: [], counts: {logicalInput: 0, produced: 0, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" as const}, byStatus: {INCUMBENT: 0, NEW: 0, FORMER: 0, UNSTATED: 0}, byChamber: {}};
  const current = await readNhCurrentMemberIdentities({extraction, read, signal: input.signal});
  const sourceCheck = current.documents.flatMap(row => row.sourceCheck ? [row.sourceCheck] : []).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  return {...current, memberDocument, sourceCheck};
}

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
  let currentRosterComplete = false;
  let memberSourceUrls: Readonly<Record<string,readonly string[]>> | undefined;
  let sourceCheck:import("../lib/civic-data/types.ts").SourceCheckEvidence|undefined;
  let extraction!: MembersExtraction;
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
        signal => acquireNhMembersSource({signal}),
      );
      const memberDocument = acquired.memberDocument;
      text = memberDocument.body;
      retrievedAt = acquired.documents.map(row => row.retrievedAt ?? "").sort().at(-1) || new Date().toISOString();
      sourceCheck = acquired.sourceCheck;
      finalUrl = acquired.identityFinalUrl;
      httpStatus = acquired.identityHttpStatus;
      identityText = acquired.rawIdentityText;
      identityFinalUrl = acquired.identityFinalUrl;
      identityHttpStatus = acquired.identityHttpStatus;
      identityHistoryText = "";
      identityCrosswalk = acquired.crosswalk;
      extraction = acquired.extraction;
      currentRosterComplete = acquired.currentRosterComplete;
      memberSourceUrls = acquired.memberSourceUrls;
      // @freshness-reads-here — this clock call sits in the reading path, so the
      // stamp it produces names the day somebody actually looked.
      readOn = retrievedAt.slice(0,10);
    }
    if (local) extraction = parseMembers(text);
    if (promote) {
      if (identityText === null || identityHistoryText === null || identityFinalUrl === null || identityHttpStatus === null) {
        throw sourceAcquisitionFailure(
          "PUBLISHER_DOCUMENT_INVALID",
          "nh:members: the current official roster did not supply exact PersonID identity.",
        );
      }
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
      currentRosterComplete,
      memberSourceUrls,
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
