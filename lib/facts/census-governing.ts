import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { door } from "../core/door.ts";
import { readStateReference } from "../control-plane/expansion/state-references.ts";
import { withBatchedReaderInvalidation, type ReaderCachePurger } from "../reader/cache.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import { REGISTRATION_HELD_RETRIEVED_AT, REGISTRATION_SOURCE_LAST_MODIFIED, REGISTRATION_SOURCE_SHA256, REGISTRATION_SOURCE_URL } from "../registration/publication.ts";
import { slotsFor } from "../registry/derive.ts";
import type { Division } from "../registry/types.ts";
import type { SavedCopy } from "./check.ts";
import { readPassCursor, writePassCursor } from "./db.ts";
import type { Registration } from "./entities.ts";
import type { Clocks, FactDb, Query } from "./publish.ts";

export const CENSUS_GOVERNING_CURSOR = "census-governing-bodies";
const FIRST_STATE = "or";
const BATCH = 200;
/** One reader pool holds four connections; the other maintenance steps keep one. */
const PARALLEL = 3;

/** The Census record's own fields each governing board carries: the government's mailing address and recorded website. */
const FIELDS = [["office_address", "mailingAddress"], ["homepage", "website"]] as const;

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

/** The attested Census of Governments release every board fact cites (data/reference/census_govt_units_2022.md). */
async function censusCopy(query: Query): Promise<SavedCopy> {
  const key = `release:census-governments-registration:${REGISTRATION_SOURCE_SHA256}`;
  await query(`INSERT INTO source_copy (url, final_url, fetched_at, http_status, sha256, blob_key, last_modified, is_archive)
    VALUES ($1, $1, $2, 200, $3, $4, $5, false) ON CONFLICT (blob_key) DO NOTHING`,
  [REGISTRATION_SOURCE_URL, REGISTRATION_HELD_RETRIEVED_AT, REGISTRATION_SOURCE_SHA256, key, REGISTRATION_SOURCE_LAST_MODIFIED]);
  const [row] = await query("SELECT id FROM source_copy WHERE blob_key = $1", [key]);
  return { id: Number(row!.id), finalUrl: REGISTRATION_SOURCE_URL, text: "", fetchedAt: new Date(REGISTRATION_HELD_RETRIEVED_AT), isArchive: false };
}

/** Each held government on a place, with the fields its governing board already shows. */
async function heldGovernments(query: Query, ids: readonly string[]): Promise<Map<string, ReadonlySet<string>>> {
  const rows = await query(`SELECT g.id, coalesce((SELECT array_agg(f.field) FROM fact f WHERE f.entity_id = b.id AND f.status = 'live'
      AND f.field = ANY($2::text[])), '{}') AS held
    FROM unnest($1::text[]) AS w(id) JOIN entity g ON g.id = w.id AND g.kind = 'government'
    JOIN entity p ON p.id = g.parent_id AND p.kind = 'place'
    LEFT JOIN LATERAL (SELECT e.id FROM entity e WHERE e.kind = 'body' AND e.parent_id = g.id
      AND (e.id LIKE '%#governing' OR e.id LIKE '%#board') ORDER BY e.id LIMIT 1) b ON true`, [ids, FIELDS.map(([field]) => field)]);
  return new Map(rows.map(row => [String(row.id), new Set(row.held as string[])]));
}

/**
 * Makes every governing board the Census of Governments implies, one state at a time and Oregon first, through the front door.
 * Each board is `<government id>#governing` (`#board` for a school district), made by the door when it publishes the Census
 * record's address or website for it. The cursor resumes inside a state; once every state is done a pass reads only the cursor.
 */
export async function makeCensusGoverningBodies(input: {
  readonly db: FactDb & { readonly query: Query }; readonly root: string; readonly states: readonly string[]; readonly clocks: Clocks;
  readonly more: () => boolean; readonly purge?: ReaderCachePurger;
}): Promise<CensusGoverningReport> {
  const { db } = input;
  const order = censusGoverningOrder(input.states);
  const version = createHash("sha256").update("GB-01\n").update(readFileSync(join(input.root, "data", "derived", "registration", "index.json"))).digest("hex");
  const held = await readPassCursor(db.query, CENSUS_GOVERNING_CURSOR);
  const prior = held ? JSON.parse(held) as Cursor : null;
  let at = prior?.version === version ? order.indexOf(prior.state) + (prior.done ? 1 : 0) : 0;
  let after = prior?.version === version && !prior.done ? prior.after : null;
  const report = { states: [] as string[], live: 0, confirmed: 0, held: 0, unheld: 0, refused: {} as Record<string, number> };
  if (at < 0 || at >= order.length || !input.more()) return report;
  const copy = await censusCopy(db.query);
  for (; at < order.length && input.more(); at++, after = null) {
    const state = order[at]!;
    report.states.push(state.toUpperCase());
    const boards = censusBoards(input.root, state).filter(board => after === null || board.government > after);
    let finished = true;
    for (let start = 0; start < boards.length; start += BATCH) {
      if (!input.more()) { finished = false; break; }
      const batch = boards.slice(start, start + BATCH);
      const governments = await heldGovernments(db.query, batch.map(board => board.government));
      const queue = [...batch];
      // Governments go through the door side by side; one government's fields stay in order, so its board is made once.
      await withBatchedReaderInvalidation(purge => Promise.all(Array.from({ length: PARALLEL }, async () => {
        for (let board = queue.shift(); board; board = queue.shift()) {
          const shown = governments.get(board.government);
          if (!shown) { report.unheld++; continue; }
          for (const [field, key] of FIELDS) {
            const value = board.record[key];
            if (typeof value !== "string" || !value.trim() || shown.has(field)) continue;
            const outcome = await door(db, { subjectId: board.subject, field, fieldKind: "contact", value, valueText: value, quote: "",
              provenance: "OFFICIAL", producedBy: `census-governing:${state.toUpperCase()}`, acquisition: "loader", costUsd: 0, copy,
              sourceField: { record: board.record as unknown as Readonly<Record<string, unknown>>, key } }, input.clocks, new Date(), { purge });
            if ("refused" in outcome) report.refused[outcome.refused] = (report.refused[outcome.refused] ?? 0) + 1;
            else if (outcome.decision === "PUBLISH") report.live++;
            else if (outcome.decision === "CONFIRM") report.confirmed++;
            else report.held++;
          }
        }
      })), input.purge);
      after = batch.at(-1)!.government;
      await writePassCursor(db.query, CENSUS_GOVERNING_CURSOR, JSON.stringify({ version, state, after, done: false } satisfies Cursor));
    }
    if (!finished) break;
    await writePassCursor(db.query, CENSUS_GOVERNING_CURSOR, JSON.stringify({ version, state, after: null, done: true } satisfies Cursor));
  }
  return report;
}
