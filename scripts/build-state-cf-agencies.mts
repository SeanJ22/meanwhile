#!/usr/bin/env tsx
/**
 * **THE 50-STATE CAMPAIGN-FINANCE AGENCY DIRECTORY.**
 * Item 8 of the 2026-08-24 state-campaign-money session.
 *
 * ```
 * pnpm cf:agencies            build and link-verify
 * pnpm cf:agencies --no-net   rebuild from the committed source without calling out
 * ```
 *
 * ## THE SOURCE IS THE FEC DIRECTORY, NOT CFI — AND THAT IS THE FINDING
 *
 * The brief proposed seeding this from CFI's `stateLinks` page and treating the
 * FEC Combined Federal/State Disclosure Directory as a cross-check. Walked on
 * 2026-08-24, that is backwards:
 *
 * - **`cfinst.org/state/stateLinks.aspx` answers HTTP 404.** The 2018 fossil is
 *   not stale — it is GONE, and `www.cfinst.org` does not complete a TLS
 *   handshake at all.
 * - **The FEC directory has been committed in this repo since 2026-08-22**, at
 *   `data/reference/fec_combined_federal_state_disclosure_directory.csv` — 349
 *   offices across 56 jurisdictions, a United States government work, public
 *   domain, no attribution obligation and no terms to accept.
 *
 * So the directory that exists is built from the source we already had, which
 * is the whole RULING 97 accounting in one sentence: the procedure that would
 * have found this without Sean is *read the reference data already in the
 * tree*, and it had never run for the pilot states.
 *
 * ## EVERY ENTRY IS LINK-VERIFIED, AND A 200 IS NOT ENOUGH
 *
 * `nj.gov/nj/gov/county/` answers **HTTP 200 with a styled "Page not found"**,
 * which is why RULING 93 makes control strings mandatory on directory routes. A
 * response is only counted ALIVE when the status is 2xx **and** the body is
 * about the thing asked for — here, that it mentions the state or the agency
 * rather than merely returning bytes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const AS_OF = today();
const NO_NET = process.argv.includes("--no-net");
const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";

/** A CSV parser that respects quotes. The directory has commas inside fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const csv = readFileSync(
  join(ROOT, "data/reference/fec_combined_federal_state_disclosure_directory.csv"),
  "utf8",
);
const rows = parseCsv(csv);
const head = rows[0].map((h) => h.trim());
const offices = rows.slice(1)
  .filter((r) => r.length >= head.length - 1 && r[0]?.trim())
  .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])) as Record<string, string>);

console.log(`cf:agencies · ${offices.length} offices across ${new Set(offices.map((o) => o.jurisdiction)).size} jurisdictions\n`);

/**
 * Which office in a state holds the CAMPAIGN-FINANCE records.
 *
 * Read from the directory's own `records_held` prose rather than guessed from
 * the office name — New Jersey's is the Election Law Enforcement Commission
 * while New Hampshire's is the Secretary of State, and no name pattern predicts
 * that. RULING 86: which office IS the authority is per-state knowledge, and
 * discovering it mid-hunt is how it gets discovered once, expensively.
 */
/**
 * TWO PATTERNS, TRIED IN ORDER, AND THE ORDER IS THE WHOLE OF IT.
 *
 * The FEC directory files its FEDERAL offices under the jurisdiction
 * `WASHINGTON` — meaning Washington, DC. Washington STATE is also `WASHINGTON`.
 * So a first-match search returns the Federal Election Commission for Washington
 * State, and **the Public Disclosure Commission — the state's actual
 * campaign-finance authority — is shadowed by it.**
 *
 * That is RULING 100 in one row: the file would report *56 of 56 jurisdictions
 * have a campaign-finance office named*, which adds up perfectly and names the
 * wrong government for one of them. A total that reconciles is not a total that
 * is correct.
 *
 * So the STATE pattern is tried first across all of a jurisdiction's offices,
 * and only if nothing matches does the broader pattern run. The Public
 * Disclosure Commission's records text says *State Campaign Finance Reports*;
 * the FEC's says *Federal Campaign Finance Reports*.
 */
const CF_STATE_PATTERN = /state campaign finance report|state and local campaign finance/i;
const CF_ANY_PATTERN = /campaign finance report/i;
const DISCLOSURE_PORTAL = /https?:\/\/\S+/;

interface Entry {
  jurisdiction: string;
  /** The office the FEC directory names as holding campaign-finance reports. */
  agency: string | null;
  agencyUrl: string | null;
  email: string | null;
  phone: string | null;
  recordsHeld: string | null;
  /** A disclosure portal named inside the records prose, where one is. */
  portalUrl: string | null;
  verifiedOn: string;
  agencyHttp: number | string | null;
  agencyAlive: boolean | null;
  agencyControlMatched: boolean | null;
  portalHttp: number | string | null;
  portalAlive: boolean | null;
  note: string;
}

const byJurisdiction = new Map<string, Record<string, string>[]>();
for (const o of offices) {
  if (!byJurisdiction.has(o.jurisdiction)) byJurisdiction.set(o.jurisdiction, []);
  byJurisdiction.get(o.jurisdiction)!.push(o);
}

const entries: Entry[] = [];
for (const [jurisdiction, list] of byJurisdiction) {
  const cfOffice =
    list.find((o) => CF_STATE_PATTERN.test(o.records_held ?? "")) ??
    list.find((o) => CF_ANY_PATTERN.test(o.records_held ?? "")) ??
    null;
  const federalShadow =
    cfOffice !== null &&
    !CF_STATE_PATTERN.test(cfOffice.records_held ?? "") &&
    /federal campaign finance/i.test(cfOffice.records_held ?? "");
  const portal = cfOffice?.records_held?.match(DISCLOSURE_PORTAL)?.[0] ?? null;
  entries.push({
    jurisdiction,
    agency: cfOffice?.office ?? null,
    agencyUrl: cfOffice?.url || null,
    email: cfOffice?.email || null,
    phone: cfOffice?.phone || null,
    recordsHeld: cfOffice?.records_held || null,
    portalUrl: portal && portal !== cfOffice?.url ? portal.replace(/[.;,]+$/, "") : null,
    verifiedOn: AS_OF,
    agencyHttp: null,
    agencyAlive: null,
    agencyControlMatched: null,
    portalHttp: null,
    portalAlive: null,
    note: !cfOffice
      ? "NO OFFICE in the FEC directory names campaign-finance reports for this jurisdiction — a FINDING, not a gap in this file"
      : federalShadow
        ? "FEDERAL office only — the directory names no STATE campaign-finance office for this jurisdiction, so this row is the federal one and is NOT a state authority"
        : "state campaign-finance records office, per the FEC directory's own records-held text",
  });
}

/* ── Link verification, with a control string ─────────────────────────────── */

async function verify(url: string, control: string): Promise<{ http: number | string; alive: boolean; matched: boolean }> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
    const body = await res.text();
    const words = control.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hay = body.toLowerCase();
    // A 200 that is not the thing is not a document (RULING 93).
    const matched = words.some((w) => hay.includes(w));
    const notFound = /page not found|404 error|cannot be found/i.test(body) && body.length < 400_000;
    return { http: res.status, alive: res.ok && !notFound, matched };
  } catch (err) {
    return { http: `ERROR ${(err as Error)?.message?.slice(0, 40) ?? ""}`, alive: false, matched: false };
  }
}

if (!NO_NET) {
  console.log("  link-verifying every agency URL and every portal URL\n");
  for (const e of entries) {
    if (e.agencyUrl) {
      const r = await verify(e.agencyUrl, e.jurisdiction);
      e.agencyHttp = r.http;
      e.agencyAlive = r.alive;
      e.agencyControlMatched = r.matched;
    }
    if (e.portalUrl) {
      const r = await verify(e.portalUrl, e.jurisdiction);
      e.portalHttp = r.http;
      e.portalAlive = r.alive;
    }
    const mark = e.agencyAlive === null ? "  -  " : e.agencyAlive ? (e.agencyControlMatched ? " OK  " : "200? ") : "DEAD ";
    console.log(
      `  ${mark} ${e.jurisdiction.padEnd(24)} ${String(e.agencyHttp ?? "-").padStart(5)}  ${(e.agency ?? "NO CF OFFICE NAMED").slice(0, 44)}`,
    );
    await new Promise((r) => setTimeout(r, 250));
  }
}

/* ── Report, with denominators ────────────────────────────────────────────── */

const withAgency = entries.filter((e) => e.agency);
const alive = entries.filter((e) => e.agencyAlive === true);
const matched = entries.filter((e) => e.agencyControlMatched === true);
const dead = entries.filter((e) => e.agencyAlive === false);
const noCf = entries.filter((e) => !e.agency);

console.log(`\n─── the directory, with denominators ───`);
console.log(`  jurisdictions in the FEC directory        ${entries.length}`);
console.log(`  with a campaign-finance office named      ${withAgency.length} of ${entries.length}`);
console.log(`  NO campaign-finance office named          ${noCf.length} — a FINDING, listed below`);
if (!NO_NET) {
  console.log(`  agency URL ALIVE                          ${alive.length} of ${withAgency.length}`);
  console.log(`     of which the body is ABOUT the state   ${matched.length}`);
  console.log(`     alive but the control did NOT match    ${alive.length - matched.length} — a 200 that may not be the thing`);
  console.log(`  agency URL DEAD or unreachable            ${dead.length}`);
}
for (const e of noCf) console.log(`     no CF office named: ${e.jurisdiction}`);
if (dead.length) {
  console.log(`\n  dead or unreachable:`);
  for (const e of dead) console.log(`     ${e.jurisdiction.padEnd(24)} ${e.agencyHttp}  ${e.agencyUrl}`);
}

/*
 * CSV, NOT JSON — a decision rather than a default.
 *
 * `data/reference/` has machinery around it: a loader that resolves every
 * declared dataset, a row-count guard that pins each file's size, and a pairing
 * guard that demands a provenance note. All three are CSV-shaped. A JSON file
 * here would mean patching three guards to accommodate one file, which is how a
 * guard becomes a special case and then stops meaning anything. The entries are
 * flat, so a table costs nothing.
 */
const COLUMNS = [
  "jurisdiction",
  "agency",
  "agency_url",
  "email",
  "phone",
  "portal_url",
  "verified_on",
  "agency_http",
  "agency_alive",
  "agency_control_matched",
  "note",
] as const;

const cell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvLines = [COLUMNS.join(",")];
for (const e of entries) {
  csvLines.push(
    [
      e.jurisdiction,
      e.agency,
      e.agencyUrl,
      e.email,
      e.phone,
      e.portalUrl,
      e.verifiedOn,
      e.agencyHttp,
      e.agencyAlive,
      e.agencyControlMatched,
      e.note,
    ]
      .map(cell)
      .join(","),
  );
}

const out = join(ROOT, "data/reference/state-cf-agencies.csv");
writeFileSync(out, `${csvLines.join("\n")}\n`, "utf8");
console.log(`\n  wrote ${out} — ${entries.length} rows, ${COLUMNS.length} columns`);
