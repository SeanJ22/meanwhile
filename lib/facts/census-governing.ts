import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { readStateReference } from "../control-plane/expansion/state-references.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import { REGISTRATION_HELD_RETRIEVED_AT, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL } from "../registration/publication.ts";
import { slotsFor } from "../registry/derive.ts";
import type { Division } from "../registry/types.ts";
import { readReleaseCheck } from "../sources/known-release.ts";
import { withFactConfirmations } from "./confirmation.ts";
import { csvWritten } from "./check.ts";
import { readPassCursor, writePassCursor } from "./db.ts";
import type { Registration } from "./entities.ts";
import { retireRenamed } from "../core/door.ts";
import { publishLoaded, STALE, type Clocks, type FactDb, type Query } from "./publish.ts";
import { saveReleaseCopy } from "./source-copy.ts";

export const CENSUS_GOVERNING_CURSOR = "census-governing-bodies";
const FIRST_STATE = "or";
const BATCH = 200;
/** One reader pool holds four connections; two stay free for the pass's other reader work while this runs for minutes. */
const PARALLEL = 2;

/** What the Census row writes for each field a governing board carries, from one column to another: the government's mailing address and recorded website. */
const FIELDS = [["mailing_address", "address1", "zip4"], ["homepage", "web_address", "web_address"]] as const;

/** A Census of Governments unit as the division its government governs; every listed unit is an active government (FUNCSTAT A). */
const DIVISION_OF: Readonly<Record<string, string>> = {
  COUNTY: "county", "COUNTY-EQUIVALENT GOVERNMENT": "county",
  MUNICIPAL: "place", TOWNSHIP: "place", "PLACE GOVERNMENT": "place", "COUNTY SUBDIVISION GOVERNMENT": "place",
  "SCHOOL DISTRICT": "school_district", "DEPENDENT SCHOOL SYSTEM": "school_district",
};

/** One government's board as the door names it, with the Census record its facts come from. */
export interface CensusBoard { readonly government: string; readonly subject: string; readonly record: RegistrationGovernmentListing }

interface Cursor { readonly version: string; readonly state: string; readonly after: string | null; readonly done: boolean }

export interface CensusGoverningReport {
  readonly states: readonly string[];
  readonly live: number;
  readonly confirmed: number;
  readonly held: number;
  /** Governments the fact store does not hold on a place yet. */
  readonly unheld: number;
  readonly refused: Readonly<Record<string, number>>;
}

/** Oregon first, then every other registered state in order. */
export function censusGoverningOrder(states: readonly string[]): string[] {
  return [...states.filter(state => state === FIRST_STATE), ...states.filter(state => state !== FIRST_STATE)];
}

/** The governing boards one state's Census of Governments implies, by the division rule in lib/registry/derive.ts, in a stable order. */
export function censusBoards(root: string, state: string): CensusBoard[] {
  const registration = JSON.parse(readFileSync(join(root, "data", "derived", "registration", `${state}.json`), "utf8")) as Registration;
  const records = new Map((readStateReference(root, state, { listings: true, units: new Set(), shares: new Set() }).listings ?? [])
    .flatMap(listing => listing.nativeIds.census_pid6 ? [[listing.nativeIds.census_pid6, listing] as const] : []));
  const boards: CensusBoard[] = [];
  for (const [pid6, government, , govType] of registration.governments) {
    const record = records.get(pid6);
    if (!record) continue;
    const division = { ocdId: government, divisionType: DIVISION_OF[govType] ?? govType.toLowerCase(), funcstat: "A", lsad: null } as Division;
    const [slot] = slotsFor(division).slots;
    if (slot?.bodyClass === "GOVERNING") boards.push({ government, subject: `${government}#${slot.slot}`, record });
  }
  // Code-unit order, the same order the cursor resumes by.
  return boards.sort((a, b) => a.government < b.government ? -1 : a.government > b.government ? 1 : 0);
}

/** The saved release's own header and row for each government, by its Census id: the line each board fact is quoted from. */
function censusRows(root: string, pids: ReadonlySet<string>): { readonly header: string; readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  let header = "";
  for (const file of ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"]) {
    const lines = readFileSync(join(root, "data", "reference", file), "utf8").split("\n");
    header = lines[0]!.replace(/\r$/, "");
    for (const line of lines) {
      const pid = line.slice(0, line.indexOf(","));
      if (pids.has(pid)) rows.set(pid, line.replace(/\r$/, ""));
    }
  }
  return { header, rows };
}

/** Each held government on a place. */
async function heldGovernments(query: Query, ids: readonly string[]): Promise<ReadonlySet<string>> {
  const rows = await query(`SELECT g.id FROM unnest($1::text[]) AS w(id) JOIN entity g ON g.id = w.id AND g.kind = 'government'
    JOIN entity p ON p.id = g.parent_id AND p.kind = 'place'`, [ids]);
  return new Set(rows.map(row => String(row.id)));
}

/**
 * Makes every governing board the Census of Governments implies, one state at a time and Oregon first, through the front door.
 * Each board is `<government id>#governing` (`#board` for a school district), made by the door when it publishes the Census
 * record's address or website for it. The cursor resumes inside a state; once every state is done a pass reads only the cursor.
 */
export async function makeCensusGoverningBodies(input: {
  readonly db: FactDb & { readonly query: Query }; readonly root: string; readonly states: readonly string[]; readonly clocks: Clocks;
  /** Holds the registration check of the Census release: when the publisher last confirmed the fingerprint of the file the rows come from. */
  readonly vault: EvidenceStore; readonly more: () => boolean; readonly purge?: ReaderCachePurger;
}): Promise<CensusGoverningReport> {
  const { db } = input;
  const order = censusGoverningOrder(input.states);
  // The facts count as captured on the release's latest check when it still has the fingerprint of the file we keep; a newer check files them again.
  const check = await readReleaseCheck(input.vault, { sourceId: "census-governments-registration", releaseId: "cog-2022", url: REGISTRATION_SOURCE_URL });
  const checkedAt = check?.sha256 === REGISTRATION_SOURCE_SHA256 ? check.checkedAt : REGISTRATION_HELD_RETRIEVED_AT;
  // The release's own re-check keeps them fresh; one that has not happened (or found a different file) is fix work, and nothing is claimed fresh meanwhile.
  if (Date.now() - Date.parse(checkedAt) > input.clocks.windowHours("contact") * 3_600_000) throw new Error(`CENSUS_RELEASE_NOT_CONFIRMED_SINCE:${checkedAt}`);
  const version = createHash("sha256").update("SPN-01C:census-row\n").update(checkedAt).update(readFileSync(join(input.root, "data", "derived", "registration", "index.json"))).digest("hex");
  const held = await readPassCursor(db.query, CENSUS_GOVERNING_CURSOR);
  const prior = held ? JSON.parse(held) as Cursor : null;
  let at = prior?.version === version ? order.indexOf(prior.state) + (prior.done ? 1 : 0) : 0;
  let after = prior?.version === version && !prior.done ? prior.after : null;
  const report = { states: [] as string[], live: 0, confirmed: 0, held: 0, unheld: 0, refused: {} as Record<string, number> };
  if (at < 0 || at >= order.length || !input.more()) return report;
  const release = await saveReleaseCopy(db.query, { name: "census-governments-registration", url: REGISTRATION_SOURCE_URL, sha256: REGISTRATION_SOURCE_SHA256,
    checkedAt, text: "" });
  for (; at < order.length && input.more(); at++, after = null) {
    const state = order[at]!;
    report.states.push(state.toUpperCase());
    const boards = censusBoards(input.root, state).filter(board => after === null || board.government > after);
    const { header, rows } = censusRows(input.root, new Set(boards.flatMap(board => board.record.nativeIds.census_pid6 ?? [])));
    const copy = { ...release, text: [header, ...rows.values()].join("\n") };
    let finished = true;
    for (let start = 0; start < boards.length; start += BATCH) {
      if (!input.more()) { finished = false; break; }
      const batch = boards.slice(start, start + BATCH);
      const governments = await heldGovernments(db.query, batch.map(board => board.government));
      const queue = [...batch], verified: number[] = [], failed: string[] = [];
      // Governments go through the door side by side; one government's fields stay in order, so its board is made once.
      await withBatchedReaderInvalidation(async purge => {
        await withFactConfirmations(db, () => Promise.all(Array.from({ length: PARALLEL }, async () => {
        for (let board = queue.shift(); board; board = queue.shift()) {
          const row = rows.get(board.record.nativeIds.census_pid6 ?? "");
          if (!governments.has(board.government)) { report.unheld++; continue; }
          for (const [field, from, to] of FIELDS) {
            const written = row === undefined ? null : csvWritten(header, row, from, to);
            if (written === null) continue;
            const outcome = await publishLoaded(db, { subjectId: board.subject, field, fieldKind: "contact", value: written, valueText: written, quote: row!,
              provenance: "OFFICIAL", producedBy: `census-governing:${state.toUpperCase()}`, costUsd: 0, copy },
            () => ({ quote: row!, valueText: written }), input.clocks, new Date(), { purge });
            if (field === "mailing_address") { if ("refused" in outcome) { if (outcome.refused !== STALE) failed.push(board.subject); } else if (outcome.factId !== null) verified.push(outcome.factId); }
            if ("refused" in outcome) report.refused[outcome.refused] = (report.refused[outcome.refused] ?? 0) + 1;
            else if (outcome.decision === "PUBLISH") report.live++;
            else if (outcome.decision === "CONFIRM") report.confirmed++;
            else report.held++;
          }
        }
        })), purge);
        // The Census's address was filed as office_address before mailing_address: the old name leaves once the new one is verified, and is held when it fails.
        await retireRenamed(db, { verified, failed, from: "office_address", producedBy: `census-governing:${state.toUpperCase()}`, reason: "CHECK_FAILED:RENAMED_FIELD", purge });
      }, input.purge);
      after = batch.at(-1)!.government;
      await writePassCursor(db.query, CENSUS_GOVERNING_CURSOR, JSON.stringify({ version, state, after, done: false } satisfies Cursor));
    }
    if (!finished) break;
    await writePassCursor(db.query, CENSUS_GOVERNING_CURSOR, JSON.stringify({ version, state, after: null, done: true } satisfies Cursor));
  }
  return report;
}
