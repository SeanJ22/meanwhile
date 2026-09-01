/**
 * **A PROOF ALREADY TAKEN DOES NOT EVAPORATE WHEN THE HOST GOES DOWN.**
 * (2026-09-01.)
 *
 * ## The measurement this is written from
 *
 * Re-walking `pnpm wiki:muni` on the permitted Wikipedia route returned every
 * Wikipedia-derived number identically — 39 of 39 municipalities reached, 908
 * official rows, 270 distinct officials — and moved **8 citations from
 * CONFIRMED to UNREACHABLE**. Those citations are not Wikipedia; they are the
 * primary sources RULING 87 requires, on municipal hosts.
 *
 * Regenerating the rosters then **deleted David A. Runfeldt, Mayor of Lincoln
 * Park Borough, from the reader's page.** His citation is
 * `www.lincolnpark.org/130/Mayors-Office`; measured the same day, that host does
 * not resolve at all while `lincolnpark.org` answers 200. **A borough dropped a
 * `www` and a sitting mayor vanished from this product.**
 *
 * ## Why that is the failure class this repository refuses
 *
 * A wall never renders as an emptiness. A failed retrieval is a failed
 * retrieval, reported as one. `UNREACHABLE` is a fact about a host on a date —
 * it is not evidence that the proof was never taken, and it is certainly not
 * evidence about who governs Lincoln Park.
 *
 * RULING 53 gives an ABSENCE a clock, so a branch that came back empty is
 * re-walked and can change. **A CONFIRMATION is the other direction.** It was
 * taken, against a named URL, on a named date, and nothing that happened to the
 * host afterwards unmakes it. Treating today's unreachability as retroactive
 * doubt is how a transient outage becomes a false statement about a government.
 *
 * ## What this is, and the three things it is careful not to be
 *
 * An append-only ledger of confirmations: person, the URL that confirmed them,
 * and the day it was first confirmed. `wiki:muni` MERGES into it rather than
 * overwriting, and `build-nj-rosters` treats a person as confirmed when today's
 * walk confirms them **or** this ledger already holds a confirmation for one of
 * the citation URLs the encyclopedia currently cites for them.
 *
 * 1. **It never invents a confirmation.** A row enters only from a live
 *    `CONFIRMED` verdict. Nothing else writes it.
 * 2. **It is scoped to the CITATION URL, not to the person.** A held
 *    confirmation applies only while the encyclopedia still cites that same URL
 *    for that same person. If the article's citation changes, the old proof does
 *    not travel to the new one — that would be a proof inherited by a source
 *    nobody read, which is the same shape as a portrait approval inherited by a
 *    swapped file.
 * 3. **It does not close the obligation.** An unreachable citation stays an
 *    unreachable citation and keeps its re-walk; the ledger decides what the
 *    READER sees meanwhile, and RULING 208's separation of a route from the
 *    record it concerns is exactly this.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the ledger lives. Committed, because it is evidence. */
export const CITATION_LEDGER_PATH = "data/hunt/citation-confirmations.json";

export interface ConfirmationRow {
  /** The name as the encyclopedia gave it, which is the key the walk uses. */
  person: string;
  /** The URL that actually confirmed them. */
  url: string;
  /** The day it was FIRST confirmed. Never moved forward by a later run. */
  firstConfirmedOn: string;
  /** The most recent day a live walk confirmed it again. */
  lastConfirmedOn: string;
  /** Which walk wrote it, so a row can be traced to a run. */
  source: string;
}

export interface CitationLedger {
  note: string;
  rows: ConfirmationRow[];
}

const NOTE =
  "Append-only. A row is written ONLY from a live CONFIRMED verdict and is never " +
  "invented, never removed by a later run, and never transferred to a different URL. " +
  "It records that a proof was taken, so a host that is unreachable today cannot delete " +
  "an officeholder from a reader's page. See lib/hunt/citation-ledger.ts.";

function key(person: string, url: string): string {
  /*
   * JSON, not a delimiter. The first version of this line joined with a
   * control byte, and a literal NUL makes ripgrep and `git grep` classify the
   * whole FILE as binary and skip it SILENTLY — so a class sweep of this
   * repository would have reported nothing found without having looked.
   * `tests/repo-hygiene.test.ts` caught it in the same session that wrote it.
   * The key is now printable and cannot be produced by a name or a URL.
   */
  return JSON.stringify([person.trim(), url.trim()]);
}

export function readCitationLedger(root: string): CitationLedger {
  const path = join(root, CITATION_LEDGER_PATH);
  if (!existsSync(path)) return { note: NOTE, rows: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CitationLedger;
    return { note: parsed.note ?? NOTE, rows: Array.isArray(parsed.rows) ? parsed.rows : [] };
  } catch {
    /*
     * An unreadable ledger is NOT "nothing was ever confirmed". It is a broken
     * instrument, and returning an empty ledger would let a parse error delete
     * every carried confirmation at once — the loudest possible version of the
     * defect this file exists to prevent. Throw instead.
     */
    throw new Error(
      `${CITATION_LEDGER_PATH} exists and could not be parsed. Refusing to proceed as though ` +
        "nothing was ever confirmed: that would drop every carried officeholder in one run.",
    );
  }
}

/**
 * Merge today's confirmations in. Returns the ledger and what moved.
 *
 * `firstConfirmedOn` is the day the proof was taken and never moves.
 * `lastConfirmedOn` moves, because how recently a source re-answered is a
 * different fact from when it was proved, and running them together is how a
 * stale row starts looking fresh.
 */
export function mergeConfirmations(
  ledger: CitationLedger,
  confirmations: readonly { person: string; url: string }[],
  on: string,
  source: string,
): { ledger: CitationLedger; added: number; refreshed: number } {
  const byKey = new Map(ledger.rows.map((r) => [key(r.person, r.url), r] as const));
  let added = 0;
  let refreshed = 0;

  for (const c of confirmations) {
    if (!c.person?.trim() || !c.url?.trim()) continue;
    const existing = byKey.get(key(c.person, c.url));
    if (existing) {
      if (existing.lastConfirmedOn !== on) refreshed++;
      existing.lastConfirmedOn = on;
    } else {
      const row: ConfirmationRow = {
        person: c.person.trim(),
        url: c.url.trim(),
        firstConfirmedOn: on,
        lastConfirmedOn: on,
        source,
      };
      byKey.set(key(row.person, row.url), row);
      added++;
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) => a.person.localeCompare(b.person) || a.url.localeCompare(b.url),
  );
  return { ledger: { note: NOTE, rows }, added, refreshed };
}

export function writeCitationLedger(root: string, ledger: CitationLedger): void {
  writeFileSync(
    join(root, CITATION_LEDGER_PATH),
    `${JSON.stringify({ note: NOTE, rows: ledger.rows }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Was this person's citation ever confirmed, against a URL the encyclopedia
 * STILL cites for them?
 *
 * The second half is the whole safety of it. A held confirmation is not a
 * standing endorsement of the person; it is a receipt for one URL. If the
 * article now cites something else, the receipt does not apply and the name
 * needs proving again.
 */
export function heldConfirmation(
  ledger: CitationLedger,
  person: string,
  currentCitationUrls: readonly string[],
): ConfirmationRow | null {
  if (currentCitationUrls.length === 0) return null;
  const urls = new Set(currentCitationUrls.map((u) => u.trim()));
  for (const row of ledger.rows) {
    if (row.person.trim() !== person.trim()) continue;
    if (urls.has(row.url)) return row;
  }
  return null;
}
