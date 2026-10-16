import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { CandidacyRemoval } from "../lib/ballot/types.ts";
import { extractTextLayer } from "../lib/extract/text-layer.ts";
import {
  NJ_FILING_SOURCES,
  morrisCurrentFilingDocumentSet,
  newestFilingPdfs,
  parseNjFiling,
  type FiledCandidate,
  type FiledNoElection,
  type FiledUnfilledSeat,
} from "../lib/hunt/nj-filing.ts";
import { today } from "./doc-dates.mjs";
import { njMorrisFilingCandidate, sha256 } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import {
  isSourceAcquisitionFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  type SourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import { writeRoutineReceiptLine } from "../lib/civic-data/receipt-output.ts";
import { ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS } from "../lib/sources/acquisition-deadline.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";

const PROMOTE = process.argv.includes("--promote");
installNeonRequestDeadline();
if (process.argv.includes("--write")) {
  throw new Error("nj:ballot --write was retired; use the registered --promote data operation.");
}
const ROOT = process.cwd();
const STAMP = today();
const RETRIEVED_AT = new Date().toISOString();
const ELECTION = { id: "nj-2026-11-03", date: "2026-11-03", name: "2026 General Election", state: "NJ" };
const VINTAGE = "TIGER_GENZ2025";
const UA = "we-the-people/1.0 (civic data; seanj22@gmail.com)";

type Feature = { properties: Record<string, string> };
const layers = new Map<string, Feature[]>();
for (const name of readdirSync(join(ROOT, "data", "states", "nj", "geo"))) {
  if (!/^(place|cousub|unsd|elsd|scsd)-34\.geojson$/.test(name)) continue;
  const parsed = JSON.parse(readFileSync(join(ROOT, "data", "states", "nj", "geo", name), "utf8")) as {
    features?: Feature[];
  };
  layers.set(name.replace(/-34\.geojson$/, ""), parsed.features ?? []);
}

const GOVERNING_FUNCSTAT = new Set(["A", "B", "C", "G"]);
const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

const placeByGeoidTail = new Map<string, Feature>();
for (const f of layers.get("place") ?? []) {
  const g = String(f.properties.geoid ?? "");
  if (g.length > 2) placeByGeoidTail.set(g.slice(2), f);
}

function municipalDivision(jurisdiction: string): string | null {
  const want = norm(jurisdiction);
  const sub = (layers.get("cousub") ?? []).find((f) => norm(f.properties.label) === want);
  if (!sub) return null;
  if (String(sub.properties.funcstat ?? "") === "F") {
    const twin = placeByGeoidTail.get(String(sub.properties.geoid ?? "").slice(5));
    if (twin && GOVERNING_FUNCSTAT.has(String(twin.properties.funcstat ?? ""))) {
      return String(twin.properties.ocdId);
    }
  }
  return String(sub.properties.ocdId);
}

function schoolDivision(jurisdiction: string): { ocdId: string; label: string } | null {
  const all = [...(layers.get("unsd") ?? []), ...(layers.get("elsd") ?? []), ...(layers.get("scsd") ?? [])];
  const match = (want: string) => {
    const hits = all.filter(
      (f) => norm(f.properties.label).replace(/\s+(SCHOOL|DISTRICT)\b/g, "").trim() === want,
    );
    return hits.length === 1 ? hits[0]! : null;
  };

  const candidates =
    jurisdiction.includes("/")
      ? (() => {
          const [head, ...rest] = jurisdiction.split("/");
          const stem = head!.replace(/\s+\S+$/, "").trim();
          const headType = head!.split(/\s+/).pop() ?? "";
          return [jurisdiction, `${stem} ${headType}`, ...rest.map((t) => `${stem} ${t.trim()}`)];
        })()
      : [jurisdiction];
  for (const name of candidates) {
    const hit = match(norm(name));
    if (hit) return { ocdId: String(hit.properties.ocdId), label: String(hit.properties.label) };
  }
  return null;
}

type PriorCandidacy = {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel?: string | null;
  slogan?: string | null;
  provenance?: { sourceUrl: string; sourceOrg: string; collectedAt: string };
};
type PriorFile = {
  contests: { id: string; ocdId: string; title: string }[];
  candidacies: PriorCandidacy[];
  removals?: CandidacyRemoval[];
};
let prior: PriorFile = { contests: [], candidacies: [] };
let productionStore: PostgresRoutineDataStore | null = null;
if (PROMOTE) {
  prepareProductionCivicDataWrite();
  productionStore = new PostgresRoutineDataStore();
  const promoted = await productionStore.readPromotion<{ ballot: PriorFile }>("BALLOT_FILING", "US-NJ:county:morris:2026-general");
  if (promoted) prior = promoted.payload.ballot;
}

const officeKey = (title: string) =>
  title
    .toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\bMEMBER OF THE\b/, "")
    .trim();

const priorContestsByDivisionOffice = new Map<string, { id: string }[]>();
for (const c of prior.contests ?? []) {
  const key = `${c.ocdId}|${officeKey(c.title)}`;
  const bucket = priorContestsByDivisionOffice.get(key);
  if (bucket) bucket.push({ id: c.id });
  else priorContestsByDivisionOffice.set(key, [{ id: c.id }]);
}

function carriedContestId(
  ocdId: string,
  office: string,
  jurisdiction: string,
): string | undefined {
  const bucket = priorContestsByDivisionOffice.get(`${ocdId}|${officeKey(office)}`) ?? [];
  if (bucket.length === 0) return undefined;
  if (bucket.length === 1) return bucket[0]?.id;
  const wanted = `ballot-nj-morris:${slug(jurisdiction)}-`;
  return bucket.find((p) => p.id.startsWith(wanted))?.id;
}
const priorCandidacyId = new Map<string, string>();
for (const c of [...(prior.candidacies ?? []), ...(prior.removals ?? [])]) {
  priorCandidacyId.set(
    `${c.contestId}|${norm(c.familyName)}|${norm(c.givenName)}`,
    c.id,
  );
}
let idsCarried = 0;
let idsMinted = 0;

async function readPdf(url: string, signal: AbortSignal) {
  const res = await requestPublisher("Morris County Clerk filing PDF", () =>
    fetch(url, { headers: { "user-agent": UA }, signal }));
  if (!res.ok) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `${url}: HTTP ${res.status}`,
    );
  }
  const body = await readPublisherBody("Morris County Clerk filing PDF", () => res.arrayBuffer());
  signal.throwIfAborted();
  const bytes = new Uint8Array(body);
  const byteCount = bytes.length;
  const text = await extractTextLayer(bytes, url);
  signal.throwIfAborted();
  if (text.outcome !== "EXTRACTED") {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `${url}: text layer ${text.outcome}`,
    );
  }
  const parsed = parseNjFiling(
    (text.items as { text: string }[]).map((p) => p.text).join("\n"),
    url,
  );
  if (parsed.outcome !== "EXTRACTED") {
    throw sourceAcquisitionFailure(
      "PUBLISHER_DOCUMENT_INVALID",
      `${url}: parse ${parsed.outcome} — ${parsed.reason}`,
    );
  }
  const items = parsed.items as Array<FiledCandidate | FiledNoElection | FiledUnfilledSeat>;
  return {
    url,
    bytes: byteCount,
    rawHash: sha256(bytes),
    candidates: items.filter((r): r is FiledCandidate => "familyName" in r),
    noElection: items.filter((r): r is FiledNoElection => !("familyName" in r) && !("office" in r)),
    unfilled: items.filter((r): r is FiledUnfilledSeat => !("familyName" in r) && "office" in r),
  };
}

async function recordSourceFailureAndExit(failure: SourceAcquisitionFailure): Promise<never> {
  if (!PROMOTE || productionStore === null || !isSourceAcquisitionFailure(failure)) throw failure;
  const failed = await recordRegisteredSourceAcquisitionFailure({
    store: productionStore,
    contractId: "nj-morris-filing",
    failure,
  });
  await writeRoutineReceiptLine(failed.line);
  process.exit(2);
}

async function acquireFilingDocuments(signal: AbortSignal) {
  const clerkResponse = await requestPublisher("Morris County Clerk filing page", () =>
    fetch(NJ_FILING_SOURCES.morrisClerkCandidates, {
      headers: { "user-agent": UA },
      signal,
    }));
  if (!clerkResponse.ok) {
    throw sourceAcquisitionFailure(
      "PUBLISHER_RESPONSE_REFUSED",
      `${NJ_FILING_SOURCES.morrisClerkCandidates}: HTTP ${clerkResponse.status}`,
    );
  }
  const clerkPage = await readPublisherBody("Morris County Clerk filing page", () => clerkResponse.text());
  signal.throwIfAborted();
  let currentDocumentSet: ReturnType<typeof morrisCurrentFilingDocumentSet>;
  try {
    currentDocumentSet = morrisCurrentFilingDocumentSet(
      newestFilingPdfs(clerkPage, NJ_FILING_SOURCES.morrisClerkCandidates),
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("MORRIS_CURRENT_FILING_DOCUMENT_SET_INCOMPLETE:")) {
      throw error;
    }
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", error.message);
  }
  const pdfs = [
    currentDocumentSet.generalCandidatesUrl,
    currentDocumentSet.schoolCandidatesUrl,
  ];
  console.log(`clerk page → ${pdfs.length} filed-candidate PDF(s)`);

  const docs: Awaited<ReturnType<typeof readPdf>>[] = [];
  for (const url of pdfs) {
    const d = await readPdf(url, signal);
    const logicalRows = d.candidates.length + d.noElection.length + d.unfilled.length;
    if (logicalRows === 0) {
      throw sourceAcquisitionFailure(
        "PUBLISHER_DOCUMENT_INVALID",
        `${url}: current filing document produced zero accounted filing rows.`,
      );
    }
    console.log(
      `  ${url.split("/").pop()} — ${d.bytes} bytes · ${d.candidates.length} candidates · ` +
        `${d.noElection.length} NO LOCAL ELECTION · ${d.unfilled.length} unfilled seat(s)`,
    );
    docs.push(d);
  }
  return { clerkResponse, clerkPage, currentDocumentSet, pdfs, docs };
}

const acquisition = await (async () => {
  try {
    return await withPublisherAcquisitionDeadline(
      "Morris County Clerk filing",
      ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
      acquireFilingDocuments,
    );
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    return recordSourceFailureAndExit(error);
  }
})();
const { clerkResponse, clerkPage, currentDocumentSet, pdfs, docs } = acquisition;

const filed = docs.flatMap((d) => d.candidates.map((c) => ({ ...c, sourceUrl: d.url })));
const noElection = docs.flatMap((d) => d.noElection.map((n) => ({ ...n, sourceUrl: d.url })));
const unfilled = docs.flatMap((d) => d.unfilled.map((u) => ({ ...u, sourceUrl: d.url })));
if (filed.length === 0) {
  await recordSourceFailureAndExit(sourceAcquisitionFailure(
    "PUBLISHER_DOCUMENT_INVALID",
    "ZERO candidates read — a failed extraction, not an empty filing.",
  ));
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function statewideDivision(office: string, jurisdiction: string): string | null {
  if (/UNITED STATES SENATE/.test(office)) return "ocd-division/country:us/state:nj";
  if (/HOUSE OF REPRESENTATIVES/.test(office)) {
    const m = /^(\d+)(?:st|nd|rd|th) Congressional$/.exec(jurisdiction);
    return m ? `ocd-division/country:us/state:nj/cd:${m[1]}` : null;
  }
  if (/BOARD OF COUNTY COMMISSIONERS|COUNTY COMMISSIONER|SHERIFF|SURROGATE|COUNTY CLERK/.test(office)) {
    return "ocd-division/country:us/state:nj/county:morris";
  }
  return null;
}

const SCHOOL_OFFICE = /BOARD OF EDUCATION|REGIONAL BOARD OF EDUCATION/;

type Built = {
  contestId: string;
  ocdId: string;
  title: string;
  voteFor: number;
  termYears: number | null;
  sourceUrl: string;
  scopeNote: string | null;
};

const contests = new Map<string, Built>();
const candidacies: Record<string, unknown>[] = [];
const refused = new Map<string, { why: string; rows: number }>();
let refusedRows = 0;
const contacts: Record<string, unknown>[] = [];

for (const c of filed) {
  const office = c.office.replace(/\s+/g, " ").trim();
  let ocdId = statewideDivision(office, c.jurisdiction);
  let scopeNote: string | null = null;

  if (!ocdId && SCHOOL_OFFICE.test(office)) {

    const bareType = /^(?:Town|Township|Borough|City|Village|Regional|W\d+|At Large)$/i;
    const cell = c.district && !bareType.test(c.district) ? c.district : null;
    const hit = (cell ? schoolDivision(cell) : null) ?? schoolDivision(c.jurisdiction);
    if (hit) {
      ocdId = hit.ocdId;
      scopeNote = `The ${hit.label}, which serves ${c.jurisdiction}.`;
    }
  }
  if (!ocdId) {
    ocdId = municipalDivision(c.jurisdiction);
    if (ocdId) scopeNote = `${c.jurisdiction}'s own contest.`;
  }
  if (!ocdId) {
    const key = `${c.jurisdiction} — ${office}`;
    const prev = refused.get(key);
    refused.set(key, {
      why: "no division in the committed TIGER layers answers to this jurisdiction name",
      rows: (prev?.rows ?? 0) + 1,
    });
    refusedRows++;
    continue;
  }


  const mintedContestId = `ballot-nj-morris:${slug(c.jurisdiction)}-${slug(office)}-${slug(ocdId.split("/").pop() ?? "")}`;
  const carried = carriedContestId(ocdId, office, c.jurisdiction);
  const contestId = carried ?? mintedContestId;
  if (!contests.has(contestId)) {
    if (carried) idsCarried++;
    else idsMinted++;
    contests.set(contestId, {
      contestId,
      ocdId,

      title:
        prior.contests.find((p) => p.id === contestId)?.title ??
        office
          .toLowerCase()
          .replace(/\b([a-z])/g, (m) => m.toUpperCase())
          .replace(/\bOf\b/g, "of")
          .replace(/\bThe\b/g, "the"),
      voteFor: c.voteFor ?? 1,
      termYears: c.termYears,
      sourceUrl: c.sourceUrl,
      scopeNote,
    });
  }

  const personSlug = slug(`${c.familyName} ${c.givenName}`);
  const carriedPerson = priorCandidacyId.get(
    `${contestId}|${norm(c.familyName)}|${norm(c.givenName)}`,
  );
  if (carriedPerson) idsCarried++;
  else idsMinted++;
  candidacies.push({
    id: carriedPerson ?? `${contestId}:${personSlug}`,
    contestId,
    familyName: c.familyName,
    givenName: c.givenName,
    partyLabel: c.party,
    slogan: c.slogan,
    incumbent: null,
    websiteUrl: null,
    provenance: {
      sourceUrl: c.sourceUrl,
      sourceOrg: "Morris County Clerk",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  });


  if (c.email || c.address) {
    contacts.push({
      candidacyId: carriedPerson ?? `${contestId}:${personSlug}`,
      familyName: c.familyName,
      givenName: c.givenName,
      email: c.email,
      route: "filing-county",
      sourceUrl: c.sourceUrl,
      sourceOrg: "Morris County Clerk",
      collectedAt: STAMP,
    });
  }
}

const absences = noElection
  .map((n) => {
    const ocdId = municipalDivision(n.jurisdiction);
    if (!ocdId) {
      refused.set(`${n.jurisdiction} — NO LOCAL ELECTION`, { why: "jurisdiction name resolves to no division", rows: 1 });
      return null;
    }
    return {
      ocdId,
      divisionVintage: VINTAGE,
      statement:
        `NO LOCAL ELECTION — the Morris County Clerk's 2026 general-election candidate list carries this ` +
        `entry for ${n.jurisdiction}: no municipal seats are on the November 2026 ballot.`,
      provenance: {
        sourceUrl: n.sourceUrl,
        sourceOrg: "Morris County Clerk",
        collectedAt: STAMP,
        verifiedAt: STAMP,
      },
    };
  })
  .filter((a): a is NonNullable<typeof a> => a !== null);

const currentIds = new Set(candidacies.map((c) => c.id as string));
const docFor = (priorUrl: string | undefined) =>
  docs.find((d) => /school/i.test(d.url) === /school/i.test(priorUrl ?? "")) ?? docs[0]!;
const contestDivision = (contestId: string) =>
  contests.get(contestId)?.ocdId ?? prior.contests.find((p) => p.id === contestId)?.ocdId ?? null;
const ordinal = (n: number) =>
  `${n}${[11, 12, 13].includes(n % 100) ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

const contestTitle = (contestId: string) => {
  const title =
    contests.get(contestId)?.title ?? prior.contests.find((p) => p.id === contestId)?.title ?? contestId;
  const cd = /\/cd:(\d+)$/.exec(contestDivision(contestId) ?? "");
  return cd ? `${title} (New Jersey's ${ordinal(Number(cd[1]))} Congressional District)` : title;
};

const priorRemovalById = new Map((prior.removals ?? []).map((r) => [r.id, r]));
const removals: CandidacyRemoval[] = [];
for (const c of prior.candidacies ?? []) {
  if (currentIds.has(c.id)) continue;
  const absentFrom = docFor(c.provenance?.sourceUrl);
  const earlier = priorRemovalById.get(c.id);
  const party = c.partyLabel ? ` (${c.partyLabel}${c.slogan ? ` — ${c.slogan}` : ""})` : "";
  const lastListed = c.provenance ?? {
    sourceUrl: absentFrom.url,
    sourceOrg: "Morris County Clerk",
    collectedAt: "unknown",
  };
  removals.push({
    id: c.id,
    contestId: c.contestId,
    familyName: c.familyName,
    givenName: c.givenName,
    partyLabel: c.partyLabel ?? null,
    slogan: c.slogan ?? null,
    status: "REMOVED_FROM_FILING",
    lastListed: { ...lastListed, verifiedAt: lastListed.collectedAt },
    absentFrom: {
      sourceUrl: absentFrom.url,
      sourceOrg: "Morris County Clerk",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
    firstAbsentOn: earlier?.firstAbsentOn ?? STAMP,
    statement:
      `${c.givenName} ${c.familyName}${party}, listed for ${contestTitle(c.contestId)} in the Morris County ` +
      `Clerk's filed-candidate document read ${lastListed.collectedAt}, is not on the clerk's revision ` +
      `${absentFrom.url.split("/").pop()} read ${STAMP}. The revision does not say why.`,
  });
}
for (const r of prior.removals ?? []) {
  if (currentIds.has(r.id) || removals.some((x) => x.id === r.id)) continue;
  removals.push(r);
}
for (const r of removals) {
  const ocdId = contestDivision(r.contestId);
  if (!ocdId) continue;
  absences.push({
    ocdId,
    divisionVintage: VINTAGE,
    statement: r.statement,
    provenance: {
      sourceUrl: r.absentFrom.sourceUrl ?? "",
      sourceOrg: r.absentFrom.sourceOrg,
      collectedAt: r.absentFrom.collectedAt,
      verifiedAt: r.absentFrom.verifiedAt ?? r.absentFrom.collectedAt,
    },
  });
}

const out = {
  formatVersion: 1,
  curatedAt: STAMP,
  curatorNote:
    `Produced by the registered Morris County Clerk ballot adapter from the authority's CURRENT filed-candidate ` +
    `PDFs, discovered from the clerk's own page hrefs on ${STAMP} — the clerk republishes at a new version ` +
    `path on every revision, and a hardcoded URL reads a superseded filing as current. ` +
    `${filed.length} candidates read across ${pdfs.length} document(s). ` +
    `The clerk's ballot-position drawing PDF is a scan with no text layer, so ballot order is not ` +
    `machine-readable and candidates render alphabetically by surname. The filings carry party, slogan, ` +
    `term and seats; they state neither incumbency nor websites, so those fields are null throughout. ` +
    `Filed emails and street addresses are contact data and remain in the canonical scoped projection rather than this bootstrap fixture.`,
  election: ELECTION,
  contests: [...contests.values()].map((b) => ({
    id: b.contestId,
    electionId: ELECTION.id,
    ocdId: b.ocdId,
    divisionVintage: VINTAGE,
    title: b.title,
    type: "CANDIDACY",
    voteFor: b.voteFor,
    termYears: b.termYears,
    scopeNote: b.scopeNote,
    provenance: {
      sourceUrl: b.sourceUrl,
      sourceOrg: "Morris County Clerk",
      collectedAt: STAMP,
      verifiedAt: STAMP,
    },
  })),
  candidacies,
  measures: [],
  absences,
  removals,
};

console.log(`\n  candidates read              ${filed.length}`);
console.log(`  contests built               ${contests.size}`);
console.log(`  candidacies built            ${candidacies.length}`);
console.log(`  removed from the filing      ${removals.length}${removals.length > 0 ? " — " + removals.map((r) => `${r.givenName} ${r.familyName} (first absent ${r.firstAbsentOn})`).join("; ") : ""}`);
console.log(`  contacts carried             ${contacts.length}`);
console.log(`  NO LOCAL ELECTION absences   ${absences.length}`);
console.log(`  seats a party filed nobody for ${unfilled.length}`);
console.log(`  ids carried from the previous file  ${idsCarried} · newly minted ${idsMinted}`);
console.log(`  REFUSED rows (no division)     ${refusedRows}, across ${refused.size} named jurisdiction/office pair(s)`);
for (const [what, r] of refused) console.log(`      ${what} — ${r.rows} row(s) — ${r.why}`);

if (contests.size === 0) {
  await recordSourceFailureAndExit(sourceAcquisitionFailure(
    "PUBLISHER_DOCUMENT_INVALID",
    "ZERO contests built — the filing parser produced no promotable election contests.",
  ));
}

const reconciles = candidacies.length + refusedRows === filed.length;
console.log(
  `\n  ${candidacies.length} built + ${refusedRows} refused = ${candidacies.length + refusedRows} vs ${filed.length} read` +
    (reconciles ? "  (accounted)" : "  *** ROWS VANISHED ***"),
);

const contactsDocument = {
  generatedAt: STAMP,
  route: "filing-county",
  note:
    "Filed contact for Morris County candidates, from the county clerk's own filed-candidate PDFs. " +
    "A filed STREET ADDRESS is a home address in most of these rows and is held for hunt use, never rendered.",
  contacts,
};

if (PROMOTE) {
  if (!productionStore) throw new Error("NJ production store was not opened.");
  const candidate = njMorrisFilingCandidate({
    ballot: out,
    contacts: contactsDocument,
    rawBodies: [clerkPage, ...docs.map((doc) => doc.rawHash)],
    currentDocumentSet,
    finalUrl: clerkResponse.url || NJ_FILING_SOURCES.morrisClerkCandidates,
    retrievedAt: RETRIEVED_AT,
    inputRecords: filed.length,
    refused: [...refused.entries()].map(([key, value]) => ({ key, detail: value.why, record: { rows: value.rows } })),
  });
  const outcome = await processRegisteredRoutineCandidate(productionStore, "nj-morris-filing", candidate, RETRIEVED_AT);
  printSourceRunnerReceipt("nj-morris-filing", candidate, outcome);
  if (!outcome.promoted) process.exitCode = 2;
} else {
  console.log("\n  dry run — pass --promote to validate and atomically promote; repository writes are retired");
}
