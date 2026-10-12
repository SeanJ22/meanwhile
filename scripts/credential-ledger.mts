/**
 * `pnpm credentials` — proves every credential in `.env.local` by calling it,
 * and prints the result.
 *
 * `PROVEN` requires all of: the call was made, the transport succeeded, the
 * body carried the route's control fact (the payload is about the subject
 * asked for), and a deliberately bogus control request came back different.
 * Anything else is `FAILED` with the reason stated. Status codes alone are not
 * trusted: `api.census.gov` answers a rejected key with HTTP 200 and an HTML
 * page titled "Invalid Key".
 *
 * Connection strings are proven read-only: the control is that `current_user`
 * is the role the string names. No write is attempted against anything.
 * Secrets are never printed: endpoints show `<KEY>` and connection strings
 * print as `role@host/database`.
 *
 * ```
 * pnpm credentials              # call everything, print the ledger
 * pnpm credentials --check      # the same, and exit 1 on any failure
 * ```
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { neon } from "@neondatabase/serverless";

import { resolveBasemap } from "../lib/map/style.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF: string = today();
const UA = "we-the-people/1.0 (civic data for a public-records product; seanj22@gmail.com)";
const CHECK_ONLY = process.argv.includes("--check");

/** `.env.local` is gitignored, so it is read directly rather than via a bundler. */
function env(): Record<string, string> {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_0-9]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m !== null) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const E: Record<string, string> = { ...env(), ...(process.env as Record<string, string>) };

/** Put onto `process.env` so the basemap rows are proven through the app's own `resolveBasemap`. */
for (const [k, v] of Object.entries(E)) if (process.env[k] === undefined) process.env[k] = v;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ types --- */

interface Row {
  /** The variable name in `.env.local`. */
  key: string;
  /** What the credential is for, in one clause a non-coder can read. */
  what: string;
  /** The endpoint called, with the credential replaced by `<KEY>`. */
  endpoint: string;
  status: number | string;
  /** Rows of the thing asked for that were actually parsed out of the body. */
  rows: number;
  /** Did the body carry the control fact — is it ABOUT the thing asked for? */
  aboutIt: boolean;
  /** Did a deliberately bogus request come back DIFFERENT? */
  controlDiffered: boolean | null;
  /** PROVEN or FAILED. */
  verdict: "PROVEN" | "FAILED";
  /** Why it failed, or what it returned when it passed. Plain language. */
  note: string;
  /** Whether any file in the tree reads this credential. */
  readBy: string;
}

const rows: Row[] = [];

interface Answer {
  status: number | string;
  body: string;
  /** Set where the host said, in a header or a redirect, that the key was the problem. */
  keyError: string | null;
}

/**
 * A GET that does not follow a credential-rejection redirect (following it
 * turns a rejected key into HTTP 200 and HTML). Any other redirect is followed once.
 */
async function get(url: string, headers: Record<string, string> = {}): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      redirect: "manual",
      signal: controller.signal,
    });
    const keyHeader = res.headers.get("x-datawebapi-keyerror");
    const location = res.headers.get("location") ?? "";
    let keyError: string | null = null;
    if (keyHeader !== null || /invalid_key|missing_key/.test(location)) {
      keyError = /invalid_key/.test(location)
        ? "the host REJECTED the key as invalid"
        : /missing_key/.test(location)
          ? "the host requires a key and none was sent"
          : `the host flagged a credential error (x-datawebapi-keyerror: ${keyHeader ?? "set"})`;
    }
    if (keyError === null && Number(res.status) >= 300 && Number(res.status) < 400 && location.length > 0) {
      const follow = await fetch(new URL(location, url), {
        headers: { "User-Agent": UA, ...headers },
        signal: controller.signal,
      });
      return { status: follow.status, body: await follow.text(), keyError: null };
    }
    return { status: res.status, body: await res.text(), keyError };
  } catch (error) {
    return { status: `NO RESPONSE — ${(error as Error).message}`, body: "", keyError: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Replace the credential with `<KEY>` so nothing secret is printed. */
function redact(url: string, ...secrets: (string | undefined)[]): string {
  let out = url;
  for (const s of secrets) {
    if (s !== undefined && s.length > 0) out = out.split(s).join("<KEY>");
  }
  return out;
}

/**
 * The one place a row is built. `controlDiffered === null` means the route has
 * no meaningful bogus form; the second test is not applicable, not waived.
 */
function record(r: Omit<Row, "verdict">): void {
  const ok = r.aboutIt && r.controlDiffered !== false;
  rows.push({ ...r, verdict: ok ? "PROVEN" : "FAILED" });
  const mark = ok ? "PROVEN" : "FAILED";
  console.log(`  ${mark.padEnd(6)} ${r.key.padEnd(38)} ${String(r.status).padEnd(6)} rows=${r.rows}`);
}

/** A missing credential is a row, not a skip. */
function absent(key: string, what: string, readBy: string): boolean {
  if (E[key] !== undefined && E[key].length > 0) return false;
  record({
    key,
    what,
    endpoint: "— not called",
    status: "NOT PRESENT",
    rows: 0,
    aboutIt: false,
    controlDiffered: null,
    note: "the variable is absent from `.env.local`, so there was nothing to call",
    readBy,
  });
  return true;
}

console.log(`\ncredential ledger — calling every credential in .env.local (${AS_OF})\n`);

/* --------------------------------------------------- 1. NEXT_PUBLIC_MAPTILER_KEY --- */
{
  const key = "NEXT_PUBLIC_MAPTILER_KEY";
  const readBy = "`lib/map/style.ts`, `components/map/map-entry.tsx`";
  if (!absent(key, "MapTiler vector tiles — the basemap the entry map draws on", readBy)) {
    const url = resolveBasemap("dark")?.styleUrl ?? "";
    const real = await get(url);
    await sleep(400);
    // Control: the SAME style URL with a key that cannot be valid.
    const bogus = await get(url.replace(`key=${E[key]}`, "key=0000000000000000000000"));
    let layers = 0;
    let sources = 0;
    try {
      const j = JSON.parse(real.body) as { layers?: unknown[]; sources?: Record<string, unknown> };
      layers = j.layers?.length ?? 0;
      sources = Object.keys(j.sources ?? {}).length;
    } catch {
      layers = 0;
    }
    record({
      key,
      what: "MapTiler vector tiles — the basemap the entry map draws on",
      endpoint: redact(url, E[key]),
      status: real.status,
      rows: layers,
      aboutIt: layers > 0 && sources > 0,
      controlDiffered: bogus.body !== real.body,
      note:
        layers > 0
          ? `a style document with ${layers} layers and ${sources} vector sources — it is a map style, not an error page`
          : "the body did not parse as a MapLibre style document",
      readBy,
    });
  }
}

/* ------------------------- 2 & 3. the two MAPTILER STYLE NAMES — config, not keys --- */
/**
 * These hold a MapTiler style NAME (`basic-v2-dark`), not a URL; the row is
 * proven on the URL the app's own `resolveBasemap` builds from it.
 */
for (const spec of [
  { key: "NEXT_PUBLIC_MAPTILER_STYLE", theme: "dark" as const },
  { key: "NEXT_PUBLIC_MAPTILER_STYLE_LIGHT", theme: "light" as const },
]) {
  const readBy = "`lib/map/style.ts`";
  const what = `MapTiler style name for the ${spec.theme} basemap — configuration, not a secret`;
  if (absent(spec.key, what, readBy)) continue;
  const url = resolveBasemap(spec.theme)?.styleUrl ?? "";
  const namedInUrl = url.includes(`/maps/${E[spec.key]}/`);
  const real = await get(url);
  await sleep(400);
  let layers = 0;
  try {
    layers = (JSON.parse(real.body) as { layers?: unknown[] }).layers?.length ?? 0;
  } catch {
    layers = 0;
  }
  record({
    key: spec.key,
    what,
    endpoint: redact(url, E.NEXT_PUBLIC_MAPTILER_KEY),
    status: real.status,
    rows: layers,
    aboutIt: layers > 0 && namedInUrl,
    controlDiffered: null,
    note:
      layers > 0 && namedInUrl
        ? `the app builds \`${E[spec.key]}\` into the ${spec.theme} style URL and it returns a document with ${layers} layers`
        : namedInUrl
          ? "the configured style name reached the URL but the style did not return a document"
          : "the configured style name is not what the app builds into the style URL",
    readBy,
  });
}

/* ----------------------------------------------------------- 4. CONGRESS_API_KEY --- */
{
  const key = "CONGRESS_API_KEY";
  const readBy = "`scripts/fetch-votes.mts`, `scripts/fetch-key-vote-positions.mts`";
  const what = "Congress.gov — sitting federal members, their portraits and their official pages";
  if (!absent(key, what, readBy)) {
    const url = `https://api.congress.gov/v3/member/congress/119/NJ?format=json&limit=5&currentMember=true&api_key=${E[key]}`;
    const real = await get(url);
    await sleep(1000);
    // Control: a state code that does not exist.
    const bogus = await get(
      `https://api.congress.gov/v3/member/congress/119/ZZ?format=json&limit=5&currentMember=true&api_key=${E[key]}`,
    );
    let members: { state?: string; bioguideId?: string }[] = [];
    try {
      members = (JSON.parse(real.body) as { members?: { state?: string; bioguideId?: string }[] }).members ?? [];
    } catch {
      members = [];
    }
    const aboutIt = members.length > 0 && members.every((m) => (m.state ?? "").toLowerCase().includes("jersey"));
    record({
      key,
      what,
      endpoint: redact(url, E[key]),
      status: real.status,
      rows: members.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `${members.length} New Jersey members, every one of them stating New Jersey as its state`
        : `the body did not carry New Jersey members (${members.length} rows parsed)`,
      readBy,
    });
  }
}

/* -------------------------------------------------------------- 5. CENSUS_API_KEY --- */
{
  const key = "CENSUS_API_KEY";
  const readBy = "**nothing** — tracker `SRC01`";
  const what = "Census ACS — population and geography by ZCTA";
  if (!absent(key, what, readBy)) {
    const path =
      "https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=zip%20code%20tabulation%20area:07866";
    const real = await get(`${path}&key=${E[key]}`);
    await sleep(400);
    // Control: the same call with no key at all.
    const bogus = await get(path);
    let dataRows = 0;
    let parsed = false;
    try {
      const j = JSON.parse(real.body) as unknown;
      if (Array.isArray(j) && Array.isArray(j[0]) && (j[0] as string[]).includes("NAME")) {
        parsed = true;
        dataRows = j.length - 1;
      }
    } catch {
      parsed = false;
    }
    const htmlTitle = /<title>([^<]*)<\/title>/i.exec(real.body)?.[1]?.trim();
    record({
      key,
      what,
      endpoint: redact(`${path}&key=${E[key]}`, E[key]),
      status: real.status,
      rows: dataRows,
      aboutIt: parsed && dataRows > 0,
      controlDiffered: bogus.body !== real.body,
      note: parsed
        ? `${dataRows} ACS row(s) for ZCTA 07866`
        : real.keyError !== null
          ? `${real.keyError} — the body is not ACS data`
          : htmlTitle !== undefined
            ? `HTTP ${real.status} whose body is an HTML page titled "${htmlTitle}" — the credential is being refused, not the request`
            : "the body did not parse as an ACS response",
      readBy,
    });
  }
}

/* ----------------------------------------------------------------- 6. LDA_API_KEY --- */
{
  const key = "LDA_API_KEY";
  const readBy = "**nothing** — tracker `SRC02`";
  const what = "Senate Lobbying Disclosure Act database — federal lobbying registrations";
  if (!absent(key, what, readBy)) {
    const url = "https://lda.senate.gov/api/v1/filings/?filing_year=2025&page_size=5";
    const real = await get(url, { Authorization: `Token ${E[key]}` });
    await sleep(400);
    // Control: a filing year that cannot exist. Same shape, no rows.
    const bogus = await get("https://lda.senate.gov/api/v1/filings/?filing_year=1801&page_size=5", {
      Authorization: `Token ${E[key]}`,
    });
    let results: { filing_uuid?: string }[] = [];
    try {
      results = (JSON.parse(real.body) as { results?: { filing_uuid?: string }[] }).results ?? [];
    } catch {
      results = [];
    }
    const aboutIt = results.length > 0 && results.every((r) => typeof r.filing_uuid === "string");
    record({
      key,
      what,
      endpoint: url,
      status: real.status,
      rows: results.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `${results.length} lobbying filings, each carrying a filing id. Federal lobbying only — it has no county, municipal or school-district layer`
        : "the body did not carry lobbying filings",
      readBy,
    });
  }
}

/* ----------------------------------------------------------------- 7. FEC_API_KEY --- */
{
  const key = "FEC_API_KEY";
  const readBy = "`scripts/fetch-fec.mts` through the standing production civic-data runner";
  const what = "OpenFEC — federal candidates and committee filings";
  if (!absent(key, what, readBy)) {
    const url = `https://api.open.fec.gov/v1/candidates/?state=NJ&per_page=5&sort=name&api_key=${E[key]}`;
    const real = await get(url);
    await sleep(600);
    const bogus = await get(
      `https://api.open.fec.gov/v1/candidates/?state=ZZ&per_page=5&sort=name&api_key=${E[key]}`,
    );
    let results: { state?: string; candidate_id?: string }[] = [];
    try {
      results = (JSON.parse(real.body) as { results?: { state?: string; candidate_id?: string }[] }).results ?? [];
    } catch {
      results = [];
    }
    const aboutIt = results.length > 0 && results.every((r) => r.state === "NJ" && typeof r.candidate_id === "string");
    record({
      key,
      what,
      endpoint: redact(url, E[key]),
      status: real.status,
      rows: results.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `${results.length} New Jersey federal candidates, each with an FEC candidate id`
        : `the body did not carry New Jersey candidates (${results.length} rows parsed)`,
      readBy,
    });
  }
}

/* -------------------------------------------------------------- 8. PLURAL_API_KEY --- */
{
  const key = "PLURAL_API_KEY";
  const readBy = "`lib/sources/plural/index.ts`";
  const what = "Plural / Open States — state legislators and their official contacts";
  if (!absent(key, what, readBy)) {
    const url = "https://v3.openstates.org/jurisdictions?classification=state&per_page=5";
    const real = await get(url, { "X-API-KEY": E[key] });
    await sleep(600);
    // Control: the same endpoint with a key that cannot be valid.
    const bogus = await get(url, { "X-API-KEY": "0000000-0000-0000-0000-000000000000" });
    let results: { name?: string; classification?: string }[] = [];
    try {
      results = (JSON.parse(real.body) as { results?: { name?: string; classification?: string }[] }).results ?? [];
    } catch {
      results = [];
    }
    const aboutIt = results.length > 0 && results.every((r) => r.classification === "state");
    record({
      key,
      what,
      endpoint: url,
      status: real.status,
      rows: results.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `${results.length} state jurisdictions. The bulk file \`data/reference/openstates_legislators.csv\` (CC-0) is what the hunts read, so this quota is not spent per person`
        : "the body did not carry state jurisdictions",
      readBy,
    });
  }
}

/* ------------------------------------------------------------ 9. LEGISCAN_API_KEY --- */
{
  const key = "LEGISCAN_API_KEY";
  const readBy = "**nothing**";
  const what = "LegiScan — state bills and roll-call votes (CC BY 4.0, attribution is law)";
  if (!absent(key, what, readBy)) {
    const url = `https://api.legiscan.com/?key=${E[key]}&op=getSessionList&state=NJ`;
    const real = await get(url);
    await sleep(600);
    const bogus = await get(`https://api.legiscan.com/?key=${E[key]}&op=getSessionList&state=ZZ`);
    let sessions: { state_id?: number; session_name?: string }[] = [];
    let status = "";
    try {
      const j = JSON.parse(real.body) as { status?: string; sessions?: { state_id?: number }[] };
      status = j.status ?? "";
      sessions = j.sessions ?? [];
    } catch {
      status = "";
    }
    const aboutIt = status === "OK" && sessions.length > 0;
    record({
      key,
      what,
      endpoint: redact(url, E[key]),
      status: real.status,
      rows: sessions.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `status OK with ${sessions.length} New Jersey legislative sessions. **CC BY 4.0 — the attribution ships with the data wherever it appears**`
        : `the body did not report status OK with sessions (status "${status}")`,
      readBy,
    });
  }
}

/* ------------------------------------------------------------ 10. DATA_GOV_API_KEY --- */
{
  const key = "DATA_GOV_API_KEY";
  const readBy = "**nothing** — tracker `SRC03`";
  const what = "api.data.gov — fronts govinfo, whose CDIR collection is the Congressional Directory";
  if (!absent(key, what, readBy)) {
    const url = `https://api.govinfo.gov/collections?api_key=${E[key]}`;
    const real = await get(url);
    await sleep(600);
    const bogus = await get("https://api.govinfo.gov/collections?api_key=INVALID_KEY_CONTROL_QUERY");
    let collections: { collectionCode?: string }[] = [];
    try {
      collections = (JSON.parse(real.body) as { collections?: { collectionCode?: string }[] }).collections ?? [];
    } catch {
      collections = [];
    }
    const hasCdir = collections.some((c) => c.collectionCode === "CDIR");
    record({
      key,
      what,
      endpoint: redact(url, E[key]),
      status: real.status,
      rows: collections.length,
      aboutIt: collections.length > 0 && hasCdir,
      controlDiffered: bogus.body !== real.body,
      note:
        collections.length > 0 && hasCdir
          ? `${collections.length} govinfo collections including CDIR, the Congressional Directory — member offices, phones and staff`
          : `the body did not carry the govinfo collection list with CDIR (${collections.length} rows parsed)`,
      readBy,
    });
  }
}

/* ----------------------------------------------------------- 11. ANTHROPIC_API_KEY --- */
{
  const key = "ANTHROPIC_API_KEY";
  const readBy = "`lib/routing/classifier.ts`";
  const what = "Anthropic API — the ask-box topic classifier";
  if (!absent(key, what, readBy)) {
    const url = "https://api.anthropic.com/v1/models?limit=5";
    const real = await get(url, { "x-api-key": E[key], "anthropic-version": "2023-06-01" });
    await sleep(400);
    const bogus = await get(url, {
      "x-api-key": "sk-ant-invalid-control-query",
      "anthropic-version": "2023-06-01",
    });
    let models: { id?: string }[] = [];
    try {
      models = (JSON.parse(real.body) as { data?: { id?: string }[] }).data ?? [];
    } catch {
      models = [];
    }
    const aboutIt = models.length > 0 && models.some((m) => (m.id ?? "").startsWith("claude"));
    record({
      key,
      what,
      endpoint: url,
      status: real.status,
      rows: models.length,
      aboutIt,
      controlDiffered: bogus.body !== real.body,
      note: aboutIt
        ? `${models.length} models listed, at least one of them a Claude model`
        : "the body did not carry a model list",
      readBy,
    });
  }
}

/* ---------------------------------------------- 12-14. the three connection strings --- */
/** Read-only probes: even the production write string is proven only by asking who it is. */
for (const spec of [
  {
    key: "DATABASE_URL",
    what: "the local Neon branch the app reads in development",
    readBy: "the whole app, via `lib/db/index.ts`",
  },
  {
    key: "WTP_PRODUCTION_DATABASE_URL_READONLY",
    what: "the production database, read-only — what `walk:all` and the census scripts read",
    readBy: "`scripts/walk-all.mts`, the census scripts",
  },
  {
    key: "WTP_PRODUCTION_DATABASE_URL_WRITE",
    what: "the production database, writable — how `pnpm db:apply` reaches production",
    readBy: "`lib/db/write-handle.ts`, `pnpm db:apply`",
  },
] as const) {
  if (absent(spec.key, spec.what, spec.readBy)) continue;
  let url: URL | null = null;
  try {
    url = new URL(E[spec.key]);
  } catch {
    url = null;
  }
  const where = url === null ? "unparseable connection string" : `${url.username}@${url.hostname}${url.pathname}`;
  try {
    const sql = neon(E[spec.key]);
    const result = (await sql`select current_user as who, current_database() as db`) as {
      who?: string;
      db?: string;
    }[];
    const who = result[0]?.who ?? "";
    const aboutIt = result.length === 1 && who.length > 0 && (url === null || who === decodeURIComponent(url.username));
    record({
      key: spec.key,
      what: spec.what,
      endpoint: where,
      status: 200,
      rows: result.length,
      aboutIt,
      controlDiffered: null,
      note: aboutIt
        ? `the database answered as \`${who}\` on \`${result[0]?.db ?? "?"}\` — the role the string names. No write was attempted`
        : `the database answered as \`${who}\`, which is not the role the connection string names`,
      readBy: spec.readBy,
    });
  } catch (error) {
    record({
      key: spec.key,
      what: spec.what,
      endpoint: where,
      status: "REFUSED",
      rows: 0,
      aboutIt: false,
      controlDiffered: null,
      note: `the database refused the connection — ${(error as Error).message}`,
      readBy: spec.readBy,
    });
  }
}

/* --------------------------------------------------------------- 15. WTP_DB_ROLE --- */
/**
 * Not a credential: a declaration of what `DATABASE_URL` points at (`local` or
 * `production`); it is not a Postgres role name. Proven structurally: a
 * `local` declaration must not resolve to either production string's host.
 */
{
  const key = "WTP_DB_ROLE";
  const readBy = "`lib/db/write-guard.ts`, `/api/build`, `pnpm db:apply`";
  const what = "the DECLARATION of what `DATABASE_URL` points at — `local` or `production`";
  if (!absent(key, what, readBy)) {
    const hostOf = (v: string | undefined): string => {
      if (v === undefined) return "";
      try {
        return new URL(v).hostname;
      } catch {
        return "";
      }
    };
    const localHost = hostOf(E.DATABASE_URL);
    const prodHosts = [hostOf(E.WTP_PRODUCTION_DATABASE_URL_READONLY), hostOf(E.WTP_PRODUCTION_DATABASE_URL_WRITE)];
    const declared = E[key];
    const known = declared === "local" || declared === "production";
    const collides = localHost.length > 0 && prodHosts.includes(localHost);
    const consistent = known && (declared === "production" ? collides : !collides);
    record({
      key,
      what,
      endpoint: "— not callable; proven structurally against the hosts the connection strings resolve to",
      status: "N/A",
      rows: consistent ? 1 : 0,
      aboutIt: consistent,
      controlDiffered: null,
      note: !known
        ? `the declaration reads \`${declared}\`, which is neither \`local\` nor \`production\` — the write guard reads anything that is not \`local\` as production`
        : consistent
          ? declared === "local"
            ? "declared `local`, and `DATABASE_URL` resolves to a host that is neither production string's host — a development write cannot reach the sold store"
            : "declared `production`, and `DATABASE_URL` does resolve to a production host"
          : declared === "local"
            ? "**declared `local` while `DATABASE_URL` resolves to a PRODUCTION host** — a development write would reach the sold store"
            : "declared `production` while `DATABASE_URL` resolves to neither production host",
      readBy,
    });
  }
}

/* ------------------------------------------------------------------- result --- */

const proven = rows.filter((r) => r.verdict === "PROVEN").length;
const failed = rows.filter((r) => r.verdict === "FAILED").length;

console.log(`\n${proven} of ${rows.length} proven, ${failed} failed (${AS_OF})\n`);
for (const r of rows) {
  console.log(`${r.verdict.padEnd(6)} ${r.key}`);
  console.log(`  for:              ${r.what}`);
  console.log(`  endpoint:         ${r.endpoint}`);
  console.log(`  status:           ${r.status}; rows ${r.rows}; about it ${r.aboutIt ? "yes" : "no"}; control differed ${r.controlDiffered === null ? "n/a" : r.controlDiffered ? "yes" : "no"}`);
  console.log(`  read by:          ${r.readBy}`);
  console.log(`  what came back:   ${r.note}`);
}

if (failed > 0) {
  console.log("\nFAILED credentials:");
  for (const r of rows.filter((x) => x.verdict === "FAILED")) console.log(`  ${r.key} — ${r.note}`);
  if (CHECK_ONLY) process.exit(1);
}
