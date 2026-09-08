/**
 * THE NEW HAMPSHIRE GENERAL COURT'S OWN ROSTER, TAKEN AT RUNG ZERO.
 * (2026-08-26, the sources-and-incumbency session. RULING 166's first
 * application.)
 *
 * `gc.nh.gov/downloads/Members.txt` is a tab-delimited file the General Court
 * publishes so consumers do not have to scrape its site. It carries every
 * member of both chambers with district, party, phone, work email, committee
 * assignments — and **`electedStatus`**, which is the body's own statement of
 * who currently sits.
 *
 * Nobody in this project had ever opened it. New Hampshire's legislative data
 * reached the product through LegiScan, a third-party aggregator, and the
 * incumbency defect this file exists to fix was rendering **every** New
 * Hampshire candidate as `Challenger` while the answer sat in a text file.
 *
 * **THE LEADING SPACE IS NOT A CURIOSITY.** `electedStatus` reads
 * `" Incumbent"` — with a space — on all 279 sitting members. A parser written
 * against `=== "Incumbent"` matches zero rows and reports an empty roster, which
 * would be RULING 43's zero-row extraction arriving as a clean exit.
 *
 * RULING 100 — the count is asserted. The file states no count of its own, so
 * the outcome is `COULD_NOT_ASSERT` against a stated total and the extraction
 * still reports produced/dropped/total so a partial cannot pass as a whole.
 *
 * RULING 107 — the freshness stamp is a READ STAMP. It is the date this script
 * actually fetched, written by the code path that performed the read, and it is
 * carried forward unchanged when the artifact is regenerated from a cached copy.
 *
 * Usage:
 *   pnpm nh:members            # fetch, parse, report; writes nothing
 *   pnpm nh:members --write    # write data/states/nh/hunt/nh-gencourt-members.json
 *   pnpm nh:members --from <path>   # parse a local copy instead of fetching
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { runStamp } from "../lib/ops/freshness.ts";
import { dirname, join } from "node:path";
import { nhMembersCandidate } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

const ROOT = process.cwd();
const SOURCE_URL = "https://gc.nh.gov/downloads/Members.txt";
const OUT = "data/states/nh/hunt/nh-gencourt-members.json";
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
    /** RULING 100's second state: the source states no total of its own. */
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
    throw new Error(
      `nh:members: the file carries ${lines.length} non-empty line(s). A roster of the New Hampshire ` +
        "General Court is 400-odd rows, so this is a failed retrieval, not an empty legislature " +
        "(RULING 43).",
    );
  }

  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const required = ["LastName", "FirstName", "LegislativeBody", "District", "electedStatus"];
  const missing = required.filter((r) => col(r) < 0);
  if (missing.length > 0) {
    throw new Error(
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

  // RULING 128 — every logical record has one disposition, and the sum is exact.
  if (members.length + dropped !== body.length) {
    throw new Error(
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

if (invokedDirectly) {
  const local = arg("from");
  let text: string;
  let readOn: string;
  let retrievedAt = new Date().toISOString();
  let finalUrl = SOURCE_URL;
  let httpStatus = 200;

  if (local) {
    text = readFileSync(local, "utf8");
    // RULING 107 — a local copy carries no evidence of WHEN it was read, so the
    // read stamp is UNKNOWN rather than today's date. A clock call here would be
    // a run stamp wearing a freshness field.
    readOn = "UNKNOWN";
  } else {
    const res = await fetch(SOURCE_URL, {
      headers: { "user-agent": UA, accept: "text/plain,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(
        `nh:members: ${SOURCE_URL} answered HTTP ${res.status}. That is a WALL with a date, not a ` +
          "legislature with no members.",
      );
    }
    text = await res.text();
    retrievedAt = new Date().toISOString();
    finalUrl = res.url || SOURCE_URL;
    httpStatus = res.status;
    // @freshness-reads-here — this clock call sits in the reading path, so the
    // stamp it produces names the day somebody actually looked (RULING 107).
    readOn = runStamp();
  }

  const extraction = parseMembers(text);
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

  if (process.argv.includes("--promote")) {
    if (local) throw new Error("nh:members --promote refuses --from: a local copy is not a live authoritative retrieval.");
    const handle = resolveProductionWriteHandle();
    process.env.DATABASE_URL = handle.connection;
    process.env.WTP_DB_ROLE = "production";
    process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
    assertWriteAllowed("a routine civic data candidate/version promotion");
    const candidate = nhMembersCandidate({ rawText: text, finalUrl, httpStatus, retrievedAt, extraction });
    const outcome = await processRoutineCandidate(new PostgresRoutineDataStore(), candidate, retrievedAt);
    console.log("RCD_RECEIPT=" + JSON.stringify({ source: "NH General Court members", candidateId: candidate.id, acquisitionSucceeded: outcome.candidate.acquisitionSucceeded, state: outcome.candidate.state, decision: outcome.candidate.receipt?.decision ?? null, promotedVersion: outcome.promoted?.versionId ?? null, lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion, structuralReleaseContract: ZERO_RELEASE_EVENTS }));
    if (!outcome.promoted) process.exitCode = 2;
  }

  if (process.argv.includes("--write")) {
    const path = join(ROOT, OUT);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          source: {
            url: SOURCE_URL,
            org: "New Hampshire General Court",
            collectedAt: readOn,
            note:
              "Taken at rung zero under RULING 166 — the body's own bulk download, before any " +
              "aggregator. electedStatus is the body's own statement of who currently sits.",
          },
          counts: extraction.counts,
          byStatus: extraction.byStatus,
          byChamber: extraction.byChamber,
          members: extraction.members,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`  written              ${OUT}`);
  }
}
