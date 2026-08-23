/**
 * **WALK NJ ELEC — `filing-campaign-finance-local`, the largest of `NH71`'s nine
 * unwalked routes.** (NJ Hunt 5 item 2.4, 2026-08-22.)
 *
 * ```
 * pnpm nj:elec                      # both 07866 municipalities, 2026
 * pnpm nj:elec --year 2025
 * pnpm nj:elec --location "ROCKAWAY TOWNSHIP"
 * ```
 *
 * `lib/hunt/nj-elec.ts` carries the finding — the wall was on `elec.nj.gov` and
 * the records are on `njelecefilesearch.com`, one hop away at rung 2 — and the
 * request shape. This is the runner.
 *
 * **Every location is walked with its control** (RULING 68). A location code
 * that cannot exist is asked the same question, and a subject response
 * indistinguishable from the control's is reported EMPTY rather than as rows.
 * That is not a formality here: the first working version of this call used the
 * wrong filter parameter, answered 200 with 326,271 records, and would have been
 * recorded as a hit.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  ELEC_CONTROL_LOCATION,
  ELEC_ENTITY_ENDPOINT,
  ELEC_SEARCH_HOST,
  ELEC_LOCATION_PAGE,
  elecRequestBody,
  normalizeElecRow,
  parseLocationCodes,
  type ElecEntity,
} from "../lib/hunt/nj-elec.ts";
import { today } from "./doc-dates.mjs";

const AS_OF = today();
const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";
const SPACING_MS = 1_000;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const year = arg("--year") ?? "2026";
const only = arg("--location");

interface Answer {
  status: number;
  bytes: number;
  rows: ElecEntity[];
  recordsTotal: number | null;
}

async function askElec(locationCode: string): Promise<Answer> {
  const res = await fetch(ELEC_ENTITY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: elecRequestBody({ locationCode, electionYear: year }),
  });
  const text = await res.text();
  let parsed: { data?: unknown[]; recordsTotal?: number } | null = null;
  try {
    parsed = JSON.parse(text) as { data?: unknown[]; recordsTotal?: number };
  } catch {
    parsed = null;
  }
  const raw = Array.isArray(parsed?.data) ? parsed.data : [];
  return {
    status: res.status,
    bytes: text.length,
    rows: raw.map((r) => normalizeElecRow(r as Record<string, unknown>)),
    recordsTotal: typeof parsed?.recordsTotal === "number" ? parsed.recordsTotal : null,
  };
}

/* ── The codes, READ from the page rather than transcribed ──────────────── */

console.log(`walking filing-campaign-finance-local (NJ ELEC) — election year ${year}`);
const pageRes = await fetch(ELEC_LOCATION_PAGE, { headers: { "User-Agent": UA } });
const pageHtml = await pageRes.text();
console.log(`  ${ELEC_LOCATION_PAGE} — HTTP ${pageRes.status}, ${pageHtml.length} bytes`);
if (pageRes.status !== 200) {
  console.error("the search page did not answer — that is a FAILED walk, not an empty result");
  process.exit(1);
}
const codes = parseLocationCodes(pageHtml);
console.log(`  location codes read from the page: ${codes.size}`);
if (codes.size === 0) {
  console.error("ZERO location codes parsed — a zero-row extraction is a FAILED extraction");
  process.exit(1);
}

/* ── The control, first, so every subject has something to be measured against ─ */

await sleep(SPACING_MS);
const control = await askElec(ELEC_CONTROL_LOCATION);
console.log(
  `  CONTROL location ${ELEC_CONTROL_LOCATION} — HTTP ${control.status}, ${control.bytes} bytes, ` +
    `${control.rows.length} rows, recordsTotal ${control.recordsTotal ?? "?"}`,
);

/* ── The subjects ───────────────────────────────────────────────────────── */

const wanted = ["ROCKAWAY TOWNSHIP", "ROCKAWAY BOROUGH"].filter(
  (n) => only === undefined || n === only.toUpperCase(),
);

interface LocationResult {
  location: string;
  code: string | null;
  status: number | null;
  bytes: number | null;
  rows: ElecEntity[];
  indistinguishableFromControl: boolean;
  note: string;
}

const results: LocationResult[] = [];

for (const name of wanted) {
  const code = codes.get(name) ?? null;
  if (code === null) {
    results.push({
      location: name,
      code: null,
      status: null,
      bytes: null,
      rows: [],
      indistinguishableFromControl: false,
      note: "no location code on the page for this name — a naming mismatch, not an absence",
    });
    console.log(`  ${name.padEnd(20)} — NO CODE ON PAGE`);
    continue;
  }

  await sleep(SPACING_MS);
  const a = await askElec(code);
  const same = a.bytes === control.bytes && a.rows.length === control.rows.length;
  results.push({
    location: name,
    code,
    status: a.status,
    bytes: a.bytes,
    rows: same ? [] : a.rows,
    indistinguishableFromControl: same,
    note: same
      ? "byte-indistinguishable from the control — EMPTY, never a hit (RULING 68)"
      : `${a.rows.length} filed entities, recordsTotal ${a.recordsTotal ?? "?"}`,
  });
  console.log(
    `  ${name.padEnd(20)} code ${code} — HTTP ${a.status}, ${a.bytes} bytes, ` +
      `${same ? "INDISTINGUISHABLE FROM CONTROL → EMPTY" : `${a.rows.length} rows`}`,
  );
  if (!same) {
    for (const r of a.rows) {
      console.log(`      ${r.entityName.padEnd(32)} ${r.office.padEnd(18)} ${r.party}`);
    }
  }
}

const outPath = join(process.cwd(), "data", "hunt", `nj-elec-${year}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      route: "filing-campaign-finance-local",
      tier: "A",
      sourceOrg: "New Jersey Election Law Enforcement Commission",
      sourceUrl: ELEC_ENTITY_ENDPOINT,
      recordsHost: ELEC_SEARCH_HOST,
      electionYear: year,
      walkedAt: AS_OF,
      control: {
        locationCode: ELEC_CONTROL_LOCATION,
        status: control.status,
        bytes: control.bytes,
        rows: control.rows.length,
        recordsTotal: control.recordsTotal,
      },
      locationCodesOnPage: codes.size,
      locations: results,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

const found = results.reduce((n, r) => n + r.rows.length, 0);
console.log("");
console.log(`  locations asked   ${results.length}`);
console.log(`  entities found    ${found}`);
console.log(`  written           ${outPath}`);
