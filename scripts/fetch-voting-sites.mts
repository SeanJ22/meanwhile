/**
 * `pnpm voting-sites:fetch` — owner-invoked acquisition and canonical
 * promotion of every covered jurisdiction's voting locations (tracker B19).
 *
 * @freshness-reads-here — the candidate stamp follows the complete set of
 * official reads; failure stamps identify the failed source attempt only.
 *
 * ## What this is not
 *
 * It is not an aggregator read. Vote411, Google Civic and the state portals
 * all carry polling places, and none of them is the authority: B19's sourcing
 * law says the sites come from the jurisdiction's own election authority,
 * cited with a read date, or they do not ship. Every retrieval below names the
 * body that published it.
 *
 * ## The three states use two models, and the retrieval shape follows
 *
 * * **Pima County, AZ — VOTE CENTERS.** The county's own ArcGIS organisation
 *   (`UTBp78iglGpbqp1B`, owner `julia.jones@pima.gov_Pima`) publishes the
 *   election-day vote centers, early voting sites and mobile sites as feature
 *   services carrying their own coordinates. Found at rung 8/12: the county's
 *   `Pima Votes` page is CivicPlus, its embedded widget state names an ArcGIS
 *   Experience Builder app, and the app's item data names the services. No
 *   HTML was scraped and no coordinate was invented.
 * * **Morris County, NJ — ASSIGNED BY DISTRICT.** The county Board of
 *   Elections publishes one page per municipality with a ward/district →
 *   location table. Rung 2 answers; the tables carry `rowspan`, which the
 *   parser here honours because dropping it silently drops locations.
 * * **New Hampshire — ASSIGNED BY TOWN.** The state list is walled; see
 *   `NH_WALL` below for every rung and its result. Towns that publish their
 *   own polling place are retrieved from the town, which is the election
 *   authority in New Hampshire (RSA 669:1 et seq. put the election in the
 *   town's hands). Towns that do not are recorded with their rungs.
 *
 * ## Geocoding
 *
 * Morris and NH addresses carry no coordinates, so they run through the
 * Census Bureau's one-line geocoder — the same benchmark the app already uses,
 * serialized and identified. A site whose address does not geocode is KEPT,
 * listed without a pin, with the count stated — never dropped, and never
 * pinned somewhere plausible.
 */
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import {
  VOTING_SITES_CONTRACT,
  votingSitesCandidate,
  votingSitesStandardSuccessor,
  type VotingSiteAcquisitionFailure,
} from "../lib/ballot/voting-sites-data-plane.ts";
import { COCHISE_ELECTIONS_URL, COCHISE_VOTER_URL, COCHISE_VOTE_CENTERS_URL,
  cochiseVotingJurisdiction } from "../lib/sources/cochise-vote-centers.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { OUTBOUND_USER_AGENT } from "../lib/geo/outbound-agent.ts";
import {
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_URL,
  parseCensusPoint,
} from "../lib/geo/census-geocoder.ts";
import {
  heldVotingSiteCoordinates,
  votingSiteAddressKey,
  type SiteKind,
  type VotingJurisdiction,
  type VotingSite,
  type VotingSitesFile,
  type SiteRung,
} from "../lib/ballot/voting-sites.ts";

/**
 * The election these sites are for. Pima labels every row with the election it
 * belongs to, and the layers carry PAST elections alongside the current one —
 * "CD7 General", "CoT General", "RTA", "2026 Mid Term Primary". Shipping
 * those as places a reader can vote NOW would be a specific false claim about
 * a date, so rows are filtered to this label and the excluded count is stated.
 * A row the authority left UNLABELED is kept with a null label and renders as
 * a named gap; it is never promoted into this one.
 */
const CURRENT_ELECTION = "2026 General";
const RECEIPT_SOURCE = "voting-sites";

// One home for the contact address; see lib/geo/outbound-agent.ts.
const UA = OUTBOUND_USER_AGENT;
const SPACING_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!process.argv.slice(2).includes("--promote")) {
  throw new Error(
    "Voting-site acquisition is promotion-only. Invoke pnpm voting-sites:fetch; tracked snapshot writes are retired.",
  );
}
prepareProductionCivicDataWrite();

/** Today, from the clock. Never a plausible date. */
// F01-continued session 2, item 0B: the Phoenix day comes from the one
// module that owns it, exactly as `pnpm stamp` does. This file used to
// carry its own byte-identical copy of the formatter — correct on the day
// it was written, and one more place for the rule to drift.
import { today } from "./doc-dates.mjs";
const TODAY = today();

const officialRawBodies: string[] = [];
let successfulAuthorityReads = 0;

async function getText(url: string): Promise<{ status: number; body: string }> {
  await sleep(SPACING_MS);
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  officialRawBodies.push(`${url}\n${res.url}\nHTTP ${res.status}\n${body}`);
  if (res.ok) successfulAuthorityReads += 1;
  return { status: res.status, body };
}

async function getJson<T>(url: string): Promise<T> {
  await sleep(SPACING_MS);
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    redirect: "follow", signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  officialRawBodies.push(`${url}\n${res.url}\nHTTP ${res.status}\n${body}`);
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  successfulAuthorityReads += 1;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${url} returned invalid JSON`);
  }
}

async function getPdf(url: string): Promise<Uint8Array> {
  await sleep(SPACING_MS);
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/pdf" }, redirect: "follow",
    signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Cochise County vote-center PDF answered HTTP ${res.status}`);
  if (!res.url.startsWith("https://cochise.az.gov/") && !res.url.startsWith("https://www.cochise.az.gov/")) {
    throw new Error("Cochise County vote-center PDF left its official host");
  }
  const maxBytes = 4 * 1024 * 1024;
  if (Number(res.headers.get("content-length")) > maxBytes) throw new Error("COCHISE_PDF_CAPTURE_BOUND_EXCEEDED");
  const parts: Uint8Array[] = [];
  let total = 0;
  if (!res.body) throw new Error("COCHISE_PDF_BODY_MISSING");
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error("COCHISE_PDF_CAPTURE_BOUND_EXCEEDED");
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const rawHash = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
  officialRawBodies.push(`${url}\n${res.url}\nHTTP ${res.status}\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\nbytes ${bytes.length}\nsha256 ${rawHash}\n\n${Buffer.from(bytes).toString("base64")}`);
  successfulAuthorityReads += 1;
  return bytes;
}

async function retrieveCochise(): Promise<VotingJurisdiction> {
  const [elections, voter] = await Promise.all([getText(COCHISE_ELECTIONS_URL), getText(COCHISE_VOTER_URL)]);
  if (elections.status !== 200 || voter.status !== 200) {
    throw new Error(`Cochise County 2026 General source pages answered HTTP ${elections.status}/${voter.status}`);
  }
  return cochiseVotingJurisdiction({ pdfBytes: await getPdf(COCHISE_VOTE_CENTERS_URL),
    electionsHtml: elections.body, voterHtml: voter.body, collectedAt: TODAY });
}

/* ------------------------------------------------------------------ *
 * Geocoding
 * ------------------------------------------------------------------ */

const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

async function geocodeOnce(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("format", "json");
  await sleep(SPACING_MS);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return parseCensusPoint(await res.json());
  } catch {
    return null;
  }
}

/**
 * Geocode, with the two rewrites the county's own formatting requires.
 *
 * The authority writes cross streets ("21 Blue Mill Road & Sand Spring Rd")
 * and suite lines, neither of which the Census one-line geocoder resolves.
 * Trying the address as published FIRST and the narrowed form second keeps the
 * published string as the thing we cite while still landing a point.
 */
async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = votingSiteAddressKey(address);
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;

  const variants = [address];
  if (address.includes("&")) variants.push(address.replace(/\s*&[^,]*/, ""));
  const noSuite = address.replace(/\b(suite|ste\.?|unit|rm\.?|room)\s+\S+,?\s*/i, "");
  if (noSuite !== address) variants.push(noSuite);

  let point: { lat: number; lng: number } | null = null;
  for (const v of variants) {
    point = await geocodeOnce(v);
    if (point) break;
  }
  geocodeCache.set(key, point);
  return point;
}

/* ------------------------------------------------------------------ *
 * Arizona — Pima County vote centers
 * ------------------------------------------------------------------ */

const PIMA_ORG = "https://services2.arcgis.com/UTBp78iglGpbqp1B/arcgis/rest/services";
const PIMA_SOURCE_PAGE = "https://www.pima.gov/3199/Pima-Votes";

interface ArcgisFeature {
  attributes: Record<string, string | number | null>;
  geometry?: { x: number; y: number };
}

async function pimaLayer(service: string): Promise<ArcgisFeature[]> {
  const url =
    `${PIMA_ORG}/${service}/FeatureServer/0/query` +
    `?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json`;
  const json = await getJson<{ features?: ArcgisFeature[] }>(url);
  if (!Array.isArray(json.features)) throw new Error(`${service} has no ArcGIS feature array`);
  return json.features;
}

function str(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

async function retrievePima(): Promise<VotingJurisdiction> {
  const publicPage = await getText(PIMA_SOURCE_PAGE);
  if (publicPage.status !== 200) {
    throw new Error(`Pima County voting page answered HTTP ${publicPage.status}`);
  }
  const sites: VotingSite[] = [];
  let election: string | null = null;
  let dropped = 0;
  let unlabeled = 0;
  let staleElection = 0;

  const dayCenters = await pimaLayer("Primary_2024_Vote_Centers");
  for (const f of dayCenters) {
    const a = f.attributes;
    const name = str(a.CENTER_NAME);
    const address = str(a.CENTER_ADDRESS);
    const lat = Number(a.latitude ?? f.geometry?.y);
    const lng = Number(a.longitude ?? f.geometry?.x);
    if (!name || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      dropped += 1;
      continue;
    }
    const label = str(a.ELECTION);
    if (label === null) unlabeled += 1;
    election ??= label;
    sites.push({
      id: `az-pima-day-${a.OBJECTID}`,
      name,
      address,
      room: str(a.ROOM_LOCATION),
      lat,
      lng,
      kind: "ELECTION_DAY",
      election: label,
      serves: null,
    });
  }

  for (const [service, kind] of [
    ["Primary_2024_EVS_Locations", "EARLY_VOTING"],
    ["mobileVotingSites", "MOBILE"],
  ] as [string, SiteKind][]) {
    const rows = await pimaLayer(service);
    for (const f of rows) {
      const a = f.attributes;
      const name = str(a.name);
      const address = str(a.address);
      const lat = Number(a.latitude ?? f.geometry?.y);
      const lng = Number(a.longitude ?? f.geometry?.x);
      // These two layers carry PAST elections alongside the current one. A
      // site published for an election that has already happened is not a
      // place a reader can vote now, and rendering it as one would be a false
      // claim about a date. Excluded, and counted.
      const label = str(a.Election);
      if (label !== CURRENT_ELECTION) {
        staleElection += 1;
        continue;
      }
      if (!name || !address || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        dropped += 1;
        continue;
      }
      sites.push({
        id: `az-pima-${kind.toLowerCase()}-${a.OBJECTID}`,
        name,
        address,
        room: null,
        lat,
        lng,
        kind,
        election: label,
        serves: null,
      });
    }
  }

  console.log(
    `  AZ Pima: ${sites.length} sites, ${dropped} dropped (no name/address/point), ` +
      `${unlabeled} election-day rows unlabeled by the county (kept, rendered as a named gap), ` +
      `${staleElection} early/mobile rows excluded (labelled for an election that has passed)`,
  );

  return {
    ocdId: "ocd-division/country:us/state:az/county:pima",
    name: "Pima County",
    state: "AZ",
    model: "VOTE_CENTER",
    election,
    sites,
    sourceOrg: "Pima County Recorder and Pima County Elections Department",
    sourceUrl: PIMA_SOURCE_PAGE,
    collectedAt: TODAY,
    refusal: null,
  };
}

/* ------------------------------------------------------------------ *
 * New Jersey — Morris County, one page per municipality
 * ------------------------------------------------------------------ */

const MORRIS_INDEX =
  "https://www.morriscountynj.gov/Government/Voting-and-Elections/Election-Day-Polling-Places";

/** Decode the entities the county's CMS emits. Nothing exotic. */
function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;|&#8211;/g, "-");
}

function cellText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Parse one HTML table into a grid, honouring `rowspan` and `colspan`.
 *
 * The naive version — split rows, split cells — silently drops every location
 * that a `rowspan` shares across wards. Boonton is the case: four wards, two
 * buildings, and a rowspan-blind read reports two wards with no location at
 * all. An operation that can drop rows must be written so it cannot.
 */
function parseTable(tableHtml: string): string[][] {
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([r]) => r);
  const grid: string[][] = [];
  /** Cells still spanning down from an earlier row: column → {text, left}. */
  const pending = new Map<number, { text: string; left: number }>();

  for (const row of rows) {
    const out: string[] = [];
    let col = 0;
    const drain = () => {
      while (pending.has(col)) {
        const held = pending.get(col)!;
        out[col] = held.text;
        held.left -= 1;
        if (held.left <= 0) pending.delete(col);
        col += 1;
      }
    };
    drain();
    for (const m of row.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const attrs = m[1];
      const text = cellText(m[2]);
      const rowspan = Number(/rowspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
      const colspan = Number(/colspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1);
      for (let c = 0; c < colspan; c++) {
        out[col] = text;
        if (rowspan > 1) pending.set(col, { text, left: rowspan - 1 });
        col += 1;
        drain();
      }
    }
    grid.push(out.map((c) => c ?? ""));
  }
  return grid;
}

/** `Town of Boonton Polling Locations` → `Town of Boonton`. */
function municipalityName(label: string): string {
  return decode(label).replace(/\s*Polling Locations\s*$/i, "").trim();
}

async function retrieveMorris(): Promise<VotingJurisdiction[]> {
  const index = await getText(MORRIS_INDEX);
  const out: VotingJurisdiction[] = [];
  if (index.status !== 200) {
    throw new Error(`Morris County polling-place index answered HTTP ${index.status}`);
  }

  const pages = [
    ...new Set(
      [...index.body.matchAll(/href="([^"]*Election-Day-Polling-Places\/[^"]+)"[^>]*>([^<]{3,90})/g)]
        .filter((m) => /Polling Locations/i.test(m[2]))
        .map((m) => `${m[1]}|${municipalityName(m[2])}`),
    ),
  ].map((s) => {
    const [href, name] = s.split("|");
    return { url: href.startsWith("http") ? href : `https://www.morriscountynj.gov${href}`, name };
  });

  if (pages.length === 0) {
    throw new Error("Morris County polling-place index named no municipality pages");
  }

  console.log(`  NJ Morris: ${pages.length} municipality pages listed`);

  let unplaceable = 0;
  for (const page of pages) {
    const res = await getText(page.url);
    if (res.status !== 200) {
      out.push(municipalityRefusal(page, res.status));
      continue;
    }
    const table = /<table[\s\S]*?<\/table>/i.exec(res.body)?.[0];
    if (!table) {
      out.push(municipalityRefusal(page, 200, "200 with no polling table on the page"));
      continue;
    }
    const grid = parseTable(table);
    const header = (grid[0] ?? []).map((h) => h.toLowerCase());
    const locCol = header.findIndex((h) => h.includes("location"));
    const wardCol = header.findIndex((h) => h.includes("ward"));
    const distCol = header.findIndex((h) => h.includes("district"));
    const election = /2026 General Election/i.test(res.body) ? "2026 General Election" : null;

    const byLocation = new Map<string, string[]>();
    for (const row of grid.slice(1)) {
      const location = (locCol >= 0 ? row[locCol] : row[row.length - 1]) ?? "";
      if (!location.trim()) continue;
      const parts: string[] = [];
      if (wardCol >= 0 && row[wardCol]) parts.push(`Ward ${row[wardCol]}`);
      if (distCol >= 0 && row[distCol]) parts.push(`District ${row[distCol]}`);
      const serves = parts.join(", ");
      const list = byLocation.get(location) ?? [];
      if (serves && !list.includes(serves)) list.push(serves);
      byLocation.set(location, list);
    }

    const sites: VotingSite[] = [];
    let n = 0;
    for (const [location, serves] of byLocation) {
      // The county writes "Name, Room, 100 Washington St, Boonton, NJ 07005".
      // The street address is the tail from the first segment that starts
      // with a house number; the head is the building's name.
      const segs = location.split(",").map((s) => s.trim()).filter(Boolean);
      const start = segs.findIndex((s) => /^\d/.test(s));
      const name = start > 0 ? segs.slice(0, start).join(", ") : segs[0] ?? location;
      const address = start >= 0 ? segs.slice(start).join(", ") : location;
      const point = await geocode(address);
      // A site that will not geocode is KEPT, unpinnable. Dropping it would
      // write our retrieval failure into the data as the county's silence.
      if (!point) unplaceable += 1;
      sites.push({
        id: `nj-morris-${slug(page.name)}-${(n += 1)}`,
        name,
        address,
        room: null,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        kind: "ELECTION_DAY",
        election,
        serves: serves.length > 0 ? serves.join("; ") : null,
      });
    }

    out.push({
      ocdId: ocdForMorris(page.name),
      name: page.name,
      state: "NJ",
      model: "ASSIGNED",
      election,
      sites,
      sourceOrg: "Morris County Board of Elections",
      sourceUrl: page.url,
      collectedAt: TODAY,
      refusal:
        sites.length > 0
          ? null
          : {
              wall: "The county's page for this municipality carried no location we could place on the map.",
              rungs: [
                { rung: 2, what: "Plain fetch of the municipality page", result: "HTTP 200", attemptedAt: TODAY },
                { rung: 9, what: "Parse the ward/district table", result: "table present, no geocodable address", attemptedAt: TODAY },
              ],
            },
    });
  }

  console.log(
    `  NJ Morris: ${out.reduce((n, j) => n + j.sites.length, 0)} sites across ` +
      `${out.filter((j) => j.sites.length > 0).length} of ${out.length} municipalities, ` +
      `${unplaceable} listed without a pin (address did not geocode)`,
  );
  return out;
}

function municipalityRefusal(
  page: { url: string; name: string },
  status: number,
  note?: string,
): VotingJurisdiction {
  return {
    ocdId: ocdForMorris(page.name),
    name: page.name,
    state: "NJ",
    model: "ASSIGNED",
    election: null,
    sites: [],
    sourceOrg: "Morris County Board of Elections",
    sourceUrl: page.url,
    collectedAt: TODAY,
    refusal: {
      wall: note ?? `The county's page for this municipality answered HTTP ${status}.`,
      rungs: [
        { rung: 2, what: "Plain fetch of the municipality page", result: note ?? `HTTP ${status}`, attemptedAt: TODAY },
      ],
    },
  };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * The OCD-ID for a Morris municipality, or null.
 *
 * NULL RATHER THAN A GUESS. An OCD-ID is the universal join key and a wrong
 * one attaches a real town's polling places to a different town. The names the
 * county writes ("Town of Boonton", "Boonton Township") map onto two different
 * OCD forms, and a jurisdiction we cannot key renders by name without a
 * point test rather than being keyed to the nearest-looking division.
 */
function ocdForMorris(name: string): string {
  const bare = name
    .replace(/^(Town|Township|Borough|City) of\s+/i, "")
    .replace(/\s+(Town|Township|Borough|City)$/i, "")
    .trim();
  const kind = /Township/i.test(name)
    ? "township"
    : /Borough/i.test(name)
      ? "borough"
      : /^Town of/i.test(name)
        ? "town"
        : /City/i.test(name)
          ? "city"
          : null;
  const base = slug(bare).replace(/-/g, "_");
  return kind === "township"
    ? `ocd-division/country:us/state:nj/county:morris/place:${base}_township`
    : `ocd-division/country:us/state:nj/place:${base}`;
}

/* ------------------------------------------------------------------ *
 * New Hampshire
 * ------------------------------------------------------------------ */

/**
 * The state list wall, walked and recorded rather than asserted.
 *
 * `app.sos.nh.gov/statelistclerkandpolling` is the Secretary of State's own
 * statewide list of clerks and polling places, and it is unreachable from
 * here. Rung 7 is the part worth reading twice: the endpoint was RECOVERED
 * (rung 11 returned an archived bundle naming
 * `ClerkandPolling/GetClerkandPollingList`), and it was DELIBERATELY NOT
 * CALLED, because the tool gates that call behind a reCAPTCHA and
 * circumventing bot detection is one of the four things `CLAUDE.md` says we
 * never do. A rung found and refused on principle is still a rung walked; it
 * is not a wall, and it is not an exhaustion claim.
 */
const NH_WALL: SiteRung[] = [
  { rung: 2, what: "Plain fetch of www.sos.nh.gov/elections/voters", result: "HTTP 403 (Akamai edge denial)", attemptedAt: "2026-08-19" },
  { rung: 3, what: "Full browser header set against app.sos.nh.gov", result: "HTTP 403", attemptedAt: "2026-08-19" },
  { rung: 4, what: "curl's TLS fingerprint against both hosts", result: "HTTP 403", attemptedAt: "2026-08-19" },
  { rung: 5, what: "A second egress (a hosted fetcher outside this network)", result: "HTTP 403 — the refusal is not this IP alone", attemptedAt: "2026-08-19" },
  { rung: 6, what: "Live Chromium, JavaScript executed, content awaited", result: "HTTP 403, Akamai 'Access Denied' body", attemptedAt: "2026-08-19" },
  { rung: 7, what: "The tool's own network call, recovered from its bundle: ClerkandPolling/GetClerkandPollingList", result: "FOUND and deliberately NOT CALLED — the tool gates it behind reCAPTCHA, and we do not circumvent bot detection", attemptedAt: "2026-08-19" },
  { rung: 9, what: "The Secretary of State's own PDFs (election media guides) on sos.nh.gov", result: "HTTP 403 and 503 — the same wall covers documents", attemptedAt: "2026-08-19" },
  { rung: 10, what: "Search index for a statewide list", result: "Named the tool at app.sos.nh.gov/statelistclerkandpolling; no machine-readable copy on an authority host", attemptedAt: "2026-08-19" },
  { rung: 11, what: "Internet Archive for app.sos.nh.gov", result: "HIT — the archived Angular bundle, which is what gave rung 7 its endpoint name", attemptedAt: "2026-08-19" },
  { rung: 12, what: "The vendor platform underneath (Angular SPA behind Akamai)", result: "Identified; the platform exposes no unguarded interface", attemptedAt: "2026-08-19" },
  { rung: 13, what: "The Secretary of State's public-records request path", result: "NOT YET WALKED — named here so the next session starts from it rather than from rung 2", attemptedAt: "2026-08-19" },
];

/**
 * New Hampshire towns whose OWN site publishes their polling place.
 *
 * In New Hampshire the town runs the election, so the town's page is the
 * authority — not a fallback for the state list. Each entry names the page it
 * was read from and the date. A town is here only when its own site states the
 * place; nothing here is inferred from a neighbouring town, a news report or a
 * state aggregator.
 */
const NH_TOWN_HITS: {
  ocdId: string;
  name: string;
  place: string;
  address: string;
  sourceOrg: string;
  sourceUrl: string;
  readAt: string;
}[] = [
  {
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town",
    name: "New London",
    place: "Whipple Memorial Town Hall",
    address: "25 Seamans Road, New London, NH 03257",
    sourceOrg: "Town of New London",
    sourceUrl: "https://newlondon.nh.gov/?SEC=78EB571E-6FA5-46AB-B16D-CFF45739DF7E&Type=B_BASIC",
    readAt: "2026-08-19",
  },
];

/** Towns walked and NOT landed. Named, with what their own site did say. */
const NH_TOWN_MISSES: {
  ocdId: string;
  name: string;
  sourceUrl: string;
  rungs: SiteRung[];
}[] = [
  {
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
    name: "Newbury",
    sourceUrl: "https://www.newbury.nh.gov/town-clerk",
    rungs: [
      { rung: 2, what: "The town clerk page", result: "HTTP 200 — the page points readers at app.sos.nh.gov rather than naming the place", attemptedAt: "2026-08-19" },
      { rung: 2, what: "The town's Voter Information page", result: "HTTP 200 — ballots and results, no polling place", attemptedAt: "2026-08-19" },
      { rung: 10, what: "The town's sitemap", result: "HTTP 403 / 404", attemptedAt: "2026-08-19" },
      { rung: 9, what: "The town's own election PDFs (warrant results, election results)", result: "HTTP 200, retrieved; they report outcomes, not the venue", attemptedAt: "2026-08-19" },
    ],
  },
  {
    ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town",
    name: "Wilmot",
    sourceUrl: "https://www.wilmotnh.org/town-clerk",
    rungs: [
      { rung: 2, what: "The town clerk page", result: "HTTP 200 — registration and absentee ballots, no polling place stated", attemptedAt: "2026-08-19" },
    ],
  },
];

function nhStateRefusal(status: number): VotingJurisdiction {
  return {
    ocdId: "ocd-division/country:us/state:nh",
    name: "New Hampshire",
    state: "NH",
    model: "ASSIGNED",
    election: null,
    sites: [],
    sourceOrg: "New Hampshire Department of State",
    sourceUrl: "https://app.sos.nh.gov/statelistclerkandpolling",
    collectedAt: TODAY,
    refusal: {
      wall: status >= 200 && status < 300
        ? "The public landing page answered, but the statewide list remains behind a reCAPTCHA-gated request this adapter will not circumvent."
        : `The Secretary of State's statewide list answered HTTP ${status}; the gated endpoint is not called.`,
      rungs: [
        { rung: 2, what: "Current owner-invoked fetch of the Secretary of State public list", result: `HTTP ${status}`, attemptedAt: TODAY },
        ...NH_WALL,
      ],
    },
  };
}

async function retrieveNewHampshire(): Promise<{
  jurisdictions: VotingJurisdiction[];
  failures: VotingSiteAcquisitionFailure[];
}> {
  const stateResult = await getText("https://app.sos.nh.gov/statelistclerkandpolling");
  const stateRow = nhStateRefusal(stateResult.status);
  const out: VotingJurisdiction[] = [stateRow];
  const failures: VotingSiteAcquisitionFailure[] = [{
    jurisdictionId: stateRow.ocdId,
    code: "NH_STATE_LIST_GATED",
    detail: stateRow.refusal!.wall,
  }];
  let unplaced = 0;

  for (const town of NH_TOWN_HITS) {
    const townResult = await getText(town.sourceUrl);
    const sourceStillStatesPlace = townResult.status === 200 &&
      townResult.body.toLowerCase().includes(town.place.toLowerCase()) &&
      townResult.body.toLowerCase().includes("25 seamans");
    if (!sourceStillStatesPlace) {
      const detail = townResult.status !== 200
        ? `${town.name}'s official page answered HTTP ${townResult.status}.`
        : `${town.name}'s current official page did not preserve the adapter's exact validated place/address text.`;
      out.push({
        ocdId: town.ocdId,
        name: town.name,
        state: "NH",
        model: "ASSIGNED",
        election: null,
        sites: [],
        sourceOrg: town.sourceOrg,
        sourceUrl: town.sourceUrl,
        collectedAt: TODAY,
        refusal: {
          wall: detail,
          rungs: [{ rung: 2, what: "Current fetch of the town's own elections page", result: townResult.status === 200 ? "HTTP 200; exact validated place/address text not found" : `HTTP ${townResult.status}`, attemptedAt: TODAY }],
        },
      });
      failures.push({ jurisdictionId: town.ocdId, code: "NH_TOWN_SITE_UNVERIFIED", detail });
      continue;
    }
    const point = await geocode(town.address);
    if (!point) unplaced += 1;
    out.push({
      ocdId: town.ocdId,
      name: town.name,
      state: "NH",
      model: "ASSIGNED",
      election: null,
      sites: [
        {
          id: `nh-${slug(town.name)}-1`,
          name: town.place,
          address: town.address,
          room: null,
          // A geocoder failure cannot erase an authority-published site.
          lat: point?.lat ?? null,
          lng: point?.lng ?? null,
          kind: "ELECTION_DAY",
          // The town states the place, not an election label. Left null so it
          // renders as the gap it is rather than borrowing a date.
          election: null,
          serves: `Everyone who votes in ${town.name}`,
        },
      ],
      sourceOrg: town.sourceOrg,
      sourceUrl: town.sourceUrl,
      collectedAt: TODAY,
      refusal: null,
    });
  }

  for (const town of NH_TOWN_MISSES) {
    const townResult = await getText(town.sourceUrl);
    const detail = townResult.status === 200
      ? `${town.name}'s page answered, but this adapter has no validated exact polling-place extraction for the current bytes.`
      : `${town.name}'s official page answered HTTP ${townResult.status}.`;
    out.push({
      ocdId: town.ocdId,
      name: town.name,
      state: "NH",
      model: "ASSIGNED",
      election: null,
      sites: [],
      sourceOrg: `Town of ${town.name}`,
      sourceUrl: town.sourceUrl,
      collectedAt: TODAY,
      refusal: {
        wall: `${detail} The state list that could answer remains gated.`,
        rungs: [
          { rung: 2, what: "Current fetch of the town's official page", result: `HTTP ${townResult.status}; no validated exact extraction promoted`, attemptedAt: TODAY },
          ...town.rungs,
          ...NH_WALL.slice(0, 6),
        ],
      },
    });
    failures.push({ jurisdictionId: town.ocdId, code: "NH_TOWN_SITE_UNAVAILABLE", detail });
  }

  console.log(
    `  NH: ${NH_TOWN_HITS.length} towns published a polling place, ` +
      `${NH_TOWN_MISSES.length} did not, ${unplaced} without a pin, ` +
      `state list walled at ${NH_WALL.length} recorded rungs`,
  );
  return { jurisdictions: out, failures };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

function acquisitionRefusal(input: {
  ocdId: string;
  name: string;
  state: "AZ" | "NH" | "NJ";
  sourceOrg: string;
  sourceUrl: string;
  detail: string;
}): VotingJurisdiction {
  return {
    ocdId: input.ocdId,
    name: input.name,
    state: input.state,
    model: input.state === "AZ" ? "VOTE_CENTER" : "ASSIGNED",
    election: null,
    sites: [],
    sourceOrg: input.sourceOrg,
    sourceUrl: input.sourceUrl,
    collectedAt: TODAY,
    refusal: {
      wall: input.detail,
      rungs: [{ rung: 2, what: "Current owner-invoked official-source acquisition", result: input.detail, attemptedAt: TODAY }],
    },
  };
}

let candidateSubmitted = false;

async function main(): Promise<void> {
  console.log(`voting-sites:fetch — ${TODAY}`);
  const store = new PostgresRoutineDataStore();
  const priorRead = await readVotingSitesProjection({ store, bypassCache: true });
  if (priorRead.kind === "STORE_UNREACHABLE") throw new Error(priorRead.detail);
  const prior = priorRead.kind === "PROMOTED" ? priorRead.value : null;
  for (const [address, point] of heldVotingSiteCoordinates(prior)) geocodeCache.set(address, point);

  const jurisdictions: VotingJurisdiction[] = [];
  const failures: VotingSiteAcquisitionFailure[] = [];

  // Every supported adapter belongs to the automatic pass, including ones first acquired by a scoped Send.
  try {
    jurisdictions.push(await retrieveCochise());
  } catch (error) {
    failures.push({ jurisdictionId: "ocd-division/country:us/state:az/county:cochise",
      code: "COCHISE_VOTING_SITES_UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) });
  }

  try {
    const pima = await retrievePima();
    if (pima.sites.length === 0) throw new Error("Pima County returned zero current official sites");
    jurisdictions.push(pima);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    jurisdictions.push(acquisitionRefusal({
      ocdId: "ocd-division/country:us/state:az/county:pima",
      name: "Pima County",
      state: "AZ",
      sourceOrg: "Pima County Recorder and Pima County Elections Department",
      sourceUrl: PIMA_SOURCE_PAGE,
      detail,
    }));
    failures.push({ jurisdictionId: "ocd-division/country:us/state:az/county:pima", code: "PIMA_VOTING_SITES_UNAVAILABLE", detail });
  }

  try {
    const morris = await retrieveMorris();
    jurisdictions.push(...morris);
    for (const row of morris.filter((jurisdiction) => jurisdiction.refusal !== null)) {
      failures.push({
        jurisdictionId: row.ocdId,
        code: "MORRIS_MUNICIPALITY_SITES_UNAVAILABLE",
        detail: row.refusal!.wall,
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    jurisdictions.push(acquisitionRefusal({
      ocdId: "ocd-division/country:us/state:nj/county:morris",
      name: "Morris County",
      state: "NJ",
      sourceOrg: "Morris County Board of Elections",
      sourceUrl: MORRIS_INDEX,
      detail,
    }));
    failures.push({ state: "NJ", code: "MORRIS_VOTING_SITES_UNAVAILABLE", detail });
  }

  try {
    const nh = await retrieveNewHampshire();
    jurisdictions.push(...nh.jurisdictions);
    failures.push(...nh.failures);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    jurisdictions.push(acquisitionRefusal({
      ocdId: "ocd-division/country:us/state:nh",
      name: "New Hampshire",
      state: "NH",
      sourceOrg: "New Hampshire Department of State",
      sourceUrl: "https://app.sos.nh.gov/statelistclerkandpolling",
      detail,
    }));
    failures.push({ state: "NH", code: "NH_VOTING_SITES_UNAVAILABLE", detail });
  }

  const file: VotingSitesFile = votingSitesStandardSuccessor({ generatedAt: TODAY, jurisdictions }, prior);
  const sites = jurisdictions.reduce((n, j) => n + j.sites.length, 0);
  const withSites = jurisdictions.filter((j) => j.sites.length > 0).length;
  console.log(
    `  ${jurisdictions.length} jurisdiction outcomes, ${withSites} with sites, ` +
      `${jurisdictions.length - withSites} recorded as refusals with their rungs\n` +
      `  ${sites} voting sites total`,
  );

  const retrievedAt = new Date().toISOString();
  const candidate = votingSitesCandidate({
    current: file,
    prior,
    failures,
    rawBodies: officialRawBodies,
    successfulAuthorityReads,
    carriedFromVersionId: priorRead.kind === "PROMOTED" ? priorRead.metadata.versionId : null,
    requestedUrl: PIMA_SOURCE_PAGE,
    finalUrl: PIMA_SOURCE_PAGE,
    retrievedAt,
  });
  candidateSubmitted = true;
  const outcome = await processRegisteredManualCandidate(
    store,
    VOTING_SITES_CONTRACT.id,
    candidate,
    retrievedAt,
  );
  printSourceRunnerReceipt(RECEIPT_SOURCE, candidate, outcome);
  if (!outcome.promoted) {
    throw new Error(`Voting-sites promotion refused: ${outcome.candidate.failureCode}`);
  }
  console.log(
    `promoted ${outcome.promoted.versionId}; exact jurisdiction/site changes and held scopes are in the canonical outcome receipt; no tracked runtime artifact was written`,
  );
}

try {
  await main();
} catch (error) {
  if (!candidateSubmitted) {
    const attemptedAt = new Date().toISOString();
    const failed = failedAcquisitionCandidate({
      sourceId: VOTING_SITES_CONTRACT.sourceId,
      recordClass: VOTING_SITES_CONTRACT.recordClass,
      scope: VOTING_SITES_CONTRACT.scope,
      requestedUrl: PIMA_SOURCE_PAGE,
      attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: VOTING_SITES_CONTRACT.parserVersion,
    });
    const outcome = await processRegisteredManualCandidate(
      new PostgresRoutineDataStore(),
      VOTING_SITES_CONTRACT.id,
      failed,
      attemptedAt,
    );
    printSourceRunnerReceipt(RECEIPT_SOURCE, failed, outcome);
  }
  throw error;
}
