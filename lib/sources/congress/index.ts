import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
  OfficialSource,
} from "../../officials/types.ts";

import { notADocument, sourceUserAgent } from "../http.ts";
import { shortTransfer } from "../bulk-completeness.ts";

/**
 * The US Congress roster. Phase 5.2 tier 1, tracker **D02**.
 *
 * **Reads the bulk file, not the API.** `unitedstates/congress-legislators` is
 * public-domain and carries the full current roster in one request; the brief's
 * §5.0a says to prefer bulk where one exists, and it is right for three
 * reasons — one request instead of hundreds, no rate limit, no API key, and a
 * reproducible artifact. The Congress.gov API is still the right source for
 * portraits (§5.0b), which this adapter deliberately does not fetch yet.
 *
 * Scope is the whole country. The current Congress snapshot is 539 people — smaller than
 * a single district polygon in this repo — so filtering to one state would cost
 * more code than it saves bytes.
 *
 * **Runs at build time only.** `pnpm officials:build` writes a committed JSON;
 * nothing fetches this on a page load.
 */

const SOURCE_NAME = "congress";

const BULK_URL =
  "https://unitedstates.github.io/congress-legislators/legislators-current.json";

/**
 * The public domain dedication is the project's own, and the underlying facts
 * are federal records. Recorded on every row so it survives a transform.
 */
const SOURCE_ORG = "unitedstates/congress-legislators (public domain)";

/** The shape of one entry in the bulk file. Only the fields we read. */
export interface CongressLegislator {
  id: { bioguide: string };
  name: { official_full?: string; first: string; last: string };
  /**
   * 6d (2026-08-15): the age line's ONLY authoritative federal source.
   * The bioguide records a birthday for every sitting member, and it is a
   * public federal record — which is the whole reason age may render at all.
   * A person whose entry lacks one renders no age; nothing is ever computed
   * from a news profile, a Wikipedia box, or a guess at a graduation year.
   */
  bio?: { birthday?: string };
  terms: CongressTerm[];
}

export interface CongressTerm {
  type: "sen" | "rep";
  start: string;
  end: string;
  /** Two-letter postal code. */
  state: string;
  /** House only. **`0` means at-large**, not district zero. */
  district?: number;
  party?: string;
  url?: string;
  contact_form?: string;
  phone?: string;
}

/**
 * Build the OCD-ID for a House seat.
 *
 * **At-large is the trap.** The bulk file numbers an at-large district `0`;
 * this repo's boundary files and registry call it `cd:at-large`, because that
 * is what the canonical identifier list uses. A naive `cd:${district}` yields
 * `cd:0`, which matches no division and silently loses six voting members —
 * Alaska, Delaware, North Dakota, South Dakota, Vermont and Wyoming. Verified
 * against `registry.json` rather than assumed.
 */
export function houseOcdId(state: string, district: number): string {
  const segment = district === 0 ? "at-large" : String(district);
  return `ocd-division/country:us/state:${state.toLowerCase()}/cd:${segment}`;
}

/**
 * Build the OCD-ID a senator represents: the whole state.
 *
 * **The registry holds no state-level division rows** — it is generated from
 * boundary layers, and there is no state layer. That is fine and does not need
 * one: OCD-IDs are hierarchical, so the state identifier is derivable from any
 * division resolved at a point by taking its `state:` segment. That is the
 * identifier hierarchy doing its job, not a name-string join.
 */
export function stateOcdId(state: string): string {
  return `ocd-division/country:us/state:${state.toLowerCase()}`;
}

/** The term in force. The bulk file lists terms oldest first. */
function currentTerm(person: CongressLegislator): CongressTerm | undefined {
  return person.terms[person.terms.length - 1];
}

function displayName(person: CongressLegislator): string {
  return (
    person.name.official_full ?? `${person.name.first} ${person.name.last}`
  );
}

/**
 * The current Congress is 539 people. A truncated-but-valid JSON array, or an
 * error object served as JSON, parses cleanly and would read as a Congress with
 * almost no members — the silent-partial "correct first" forbids (CLAUDE.md,
 * RULING 273). The floor is set well below the real roster and far above zero,
 * the same shape as the dotgov thin-guard; verified at 539 on 2026-09-18.
 */
export const CONGRESS_ROSTER_FLOOR = 500;

/**
 * Parse the bulk roster and refuse a short one. Separated from `fetch` so the
 * completeness contract is exercised directly rather than only over the
 * network — the bulk adapter uses a bare `fetch` on purpose (one file, its own
 * backoff), so its floor cannot lean on the shared client.
 */
export function parseCongressRoster(text: string): CongressLegislator[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${BULK_URL} returned HTTP 200 with a body that is not JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${BULK_URL} returned HTTP 200 with a body that is not the roster array`);
  }
  if (parsed.length < CONGRESS_ROSTER_FLOOR) {
    throw new Error(
      `${BULK_URL} returned ${parsed.length} legislator(s), below the floor of ${CONGRESS_ROSTER_FLOOR} — the current Congress is ~539; refusing a truncated roster`,
    );
  }
  return parsed as CongressLegislator[];
}

export const congressSource: OfficialSource<CongressLegislator> = {
  name: SOURCE_NAME,

  async fetch(): Promise<CongressLegislator[]> {
    // GitHub Pages serves a transient 503 often enough to fail a build for no
    // reason — observed once while writing this. One URL, so the backoff is
    // small rather than the ladder the Legistar client needs.
    const MAX_ATTEMPTS = 4;
    let lastStatus = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const response = await fetch(BULK_URL, {
        headers: {
          "User-Agent": sourceUserAgent(),
          Accept: "application/json",
        },
      });

      if (response.ok) {
        // A status is not a document (NH Hunt 3, 2026-08-21). This adapter
        // hand-rolls its own backoff rather than using the shared client, so
        // it gets the shared client's checks by hand: a 200 with a blank body,
        // a transfer cut short of its declared length, or a truncated-but-valid
        // roster here is every member of Congress reading as absent.
        const text = await response.text();
        const notDoc = notADocument(text, { label: "a bulk JSON file", marker: "[" });
        if (notDoc !== null) throw new Error(`${BULK_URL} returned HTTP 200 with ${notDoc}`);
        const short = shortTransfer(response.headers, text);
        if (short !== null) throw new Error(`${BULK_URL} returned HTTP 200 with ${short}`);
        return parseCongressRoster(text);
      }

      lastStatus = response.status;
      // A 404 is a moved file and will not fix itself; only 429/5xx retry.
      if (response.status !== 429 && response.status < 500) break;

      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }

    throw new Error(`${BULK_URL} returned HTTP ${lastStatus}`);
  },

  normalize(raw, collectedAt): OfficeholderSet {
    const officeholders: Officeholder[] = [];
    const divisions: OfficeholderDivision[] = [];
    const unmatched: OfficeholderSet["unmatched"] = [];

    for (const person of raw) {
      const term = currentTerm(person);
      const id = `${SOURCE_NAME}:${person.id.bioguide}`;

      if (!term) {
        unmatched.push({ officeholderId: id, reason: "no term on record" });
        continue;
      }

      officeholders.push({
        id,
        name: displayName(person),
        officeTitle:
          term.type === "sen" ? "U.S. Senator" : "U.S. Representative",
        level: "FEDERAL",
        termStart: term.start,
        termEnd: term.end,
        // Sourced, never derived. Null is the normal answer outside the
        // federal roster and renders as no age at all (6d).
        birthDate:
          typeof person.bio?.birthday === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(person.bio.birthday)
            ? person.bio.birthday
            : null,
        // Display only. Nothing downstream may infer from this.
        partyLabel: term.party ?? null,
        websiteUrl: term.url ?? null,
        contactFormUrl: term.contact_form ?? null,
        phone: term.phone ?? null,
        // Congress publishes contact forms, not member email addresses.
        email: null,
        // Curated separately with per-entry verification (3e) — the bulk
        // file does not carry campaign sites, and guessing one is forbidden.
        campaignUrl: null,
        // Portraits are a separate acquisition with their own licence
        // question — §5.0b. Null renders as initials, which is correct.
        photo: null,
        provenance: {
          sourceUrl: BULK_URL,
          sourceOrg: SOURCE_ORG,
          collectedAt,
          verifiedAt: null,
        },
      });

      if (term.type === "sen") {
        divisions.push({
          officeholderId: id,
          ocdId: stateOcdId(term.state),
          bodyId: null,
        });
        continue;
      }

      if (term.district === undefined) {
        unmatched.push({
          officeholderId: id,
          reason: `House seat for ${term.state} with no district number`,
        });
        continue;
      }

      divisions.push({
        officeholderId: id,
        ocdId: houseOcdId(term.state, term.district),
        bodyId: null,
      });
    }

    return {
      scope: "us",
      generatedAt: collectedAt,
      officeholders,
      divisions,
      unmatched,
    };
  },

  async upsert(set: OfficeholderSet) {
    // Same position as every other adapter: lib/db/schema.ts is `export {}`.
    // The generated JSON is the artifact; persistence lands with Phase 5.1.
    return { inserted: 0, updated: set.officeholders.length };
  },
};


export { BULK_URL, SOURCE_ORG };
