/**
 * Plain-code reading of a saved official election page (the cheapest route:
 * held data, then code, before any model). A city or county "Voting" page
 * names the offices that run elections with their phone lines: "Early
 * ballots can be requested through the Cochise County Elections Office,
 * (520) 432-8970." Each becomes an `election_office` field for the
 * government whose page says it; the §3 check in `publishElectionFields`
 * confirms the office, its phone and the sentence are on the saved page.
 */
import type { ElectionFieldInput } from "./election-fields.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import type { RoutineDataStore } from "./store.ts";
import { readRegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { pageWords, section3Record } from "../control-plane/promotion/section3.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { captureIntact, heldPageCopies } from "./worker-publication-evidence.ts";
import { publishElectionFields } from "./election-field-publication.ts";
import { readManualProjectionPrior } from "./manual-projections.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { US_STATES } from "../control-plane/readiness/catalog.ts";
import { inventoryRecordEvidence, RecordEvidenceRefusal } from "../control-plane/workers/record-evidence.ts";
import { electionFieldState } from "./election-fields.ts";

export const NATIONAL_ELECTION_OFFICES_URL = "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/";

/** One saved national directory supplies offices for every jurisdiction it names. */
export function heldNationalElectionOfficeFields(capture: WorkerPublicationCapture): readonly ElectionFieldInput[] {
  if (capture.evidence.canonicalUrl !== NATIONAL_ELECTION_OFFICES_URL || !captureIntact(capture)) return [];
  let inventory: ReturnType<typeof inventoryRecordEvidence>;
  try {
    inventory = inventoryRecordEvidence(capture.evidence, { format: "HTML_TABLE", tableIndex: 0, headerRows: 1,
      fields: { jurisdiction: { source: 0, type: "STRING" }, office: { source: 1, type: "STRING" }, phone: { source: 3, type: "STRING" } } });
  } catch (error) {
    if (error instanceof RecordEvidenceRefusal) return [];
    throw error;
  }
  const nameKey = (name: string) => name.toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/^u\.?s\.?\s+/, "").replace(/[^a-z]/g, "");
  return inventory.rows.flatMap(row => {
    const jurisdiction = String(row.jurisdiction.value), office = String(row.office.value);
    const state = US_STATES.find(state => nameKey(state.name) === nameKey(jurisdiction));
    const geography = state && Object.values(FIPS_TO_STATE).find(entry => entry.postal.toLowerCase() === state.code);
    const phone = /\(?\b\d{3}\)?[\s/.-]*\d{3}[\s/.-]\d{4}\b/.exec(String(row.phone.value))?.[0];
    if (!state || !geography || !office || !phone) return [];
    return [{ divisionId: `ocd-division/country:us/${geography.prefix}:${state.code}`, kind: "election_office" as const,
      sourceUrl: capture.evidence.canonicalUrl, value: office, phone, quote: `${jurisdiction}\n${office}`, dates: [],
      document: { url: capture.evidence.canonicalUrl, text: capture.evidence.text, collectedAt: capture.observedAt, capture } }];
  });
}

export interface HeldElectionOffice {
  /** The office as the page names it. */
  readonly office: string;
  readonly phone: string;
  /** The page's sentence that names the office and its phone, as written. */
  readonly quote: string;
}

const decode = (text: string) => text
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'").replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—")
  .replace(/&[lr]squo;/gi, "’").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&");
const visible = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const ELECTION_PAGE = /\b(elections?|voting|voters?|vote|ballots?|polls?)\b/i;
/** "Cochise County Elections Office", "Cochise County Recorder's Office", "Board of Elections", "the Town Clerk". */
const OFFICE = /\b((?:[A-Z][\w.&-]*\s+){0,4}(?:Elections?|Recorder['’]?s?|Registrar(?: of Voters)?|Board of Elections|Voter Registration|(?:City|Town|County|Township|Village) Clerk['’]?s?)(?:\s+(?:Office|Department|Division|Services))?)\b/g;
const PHONE = /\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]\d{4}\b/;

/** The election offices, with a phone, that a saved election page names; empty when it is not an election page. */
export function readHeldElectionOffices(html: string): readonly HeldElectionOffice[] {
  const title = visible(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1] ?? html;
  const body = main.replace(/<(script|style|template|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  if (!ELECTION_PAGE.test(title) && !ELECTION_PAGE.test(visible(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] ?? ""))) return [];
  const found = new Map<string, HeldElectionOffice>();
  const blocks = body.split(/<\/(?:p|h[1-6]|li|div|td|tr|dd|dt|section|article)\s*>|<br\s*\/?>/i).map(visible).filter(Boolean);
  for (const sentence of blocks.flatMap(block => block.split(/(?<=[.!?])\s+(?=[A-Z])/))) {
    for (const match of sentence.matchAll(OFFICE)) {
      const office = match[1].replace(/^(?:the|through|by|with|at|contact|call)\s+/i, "").trim();
      // The office's phone follows its name in the same sentence, before any other office is named.
      const after = sentence.slice((match.index ?? 0) + match[0].length);
      const next = after.search(OFFICE);
      const phone = PHONE.exec(next >= 0 ? after.slice(0, next) : after)?.[0];
      if (!phone) continue;
      // One office per line: "Cochise County Recorder" in the Spanish paragraph is the Recorder's Office already read.
      const line = phone.replace(/\D/g, "");
      if (office.split(/\s+/).length < 2 || found.has(line)) continue;
      found.set(line, { office, phone, quote: sentence });
    }
  }
  return [...found.values()];
}

/**
 * The saved page's election offices as `election_office` fields for the
 * government whose page it is, ready for `publishElectionFields` with
 * `section3Record` as the verifier.
 */
export function heldElectionOfficeFields(input: { readonly divisionId: string; readonly capture: WorkerPublicationCapture }): readonly ElectionFieldInput[] {
  const { capture } = input;
  if (capture.evidence.canonicalUrl === NATIONAL_ELECTION_OFFICES_URL) {
    const state = electionFieldState(input.divisionId);
    return heldNationalElectionOfficeFields(capture).filter(field => electionFieldState(field.divisionId) === state);
  }
  return readHeldElectionOffices(capture.evidence.text).map(row => ({
    divisionId: input.divisionId, kind: "election_office" as const, sourceUrl: capture.evidence.canonicalUrl,
    value: row.office, phone: row.phone, quote: row.quote, dates: [],
    document: { url: capture.evidence.canonicalUrl, text: capture.evidence.text, collectedAt: capture.observedAt, capture },
  }));
}

/**
 * Owed voter-access work with no extraction yet: read the government's saved
 * election pages (any job's captures for the same government) in plain code
 * and publish each election office that passes §3, through the existing
 * ballot-navigation publisher. Every item gets its outcome; unread pages stay
 * owed work and are re-read hourly.
 */
export async function publishHeldElectionOffices(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore;
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
  readonly limit?: number;
}): Promise<readonly { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[]> {
  const registry = await readRegistryRuntimePrior(input.store, input.now);
  /* Only the owed items and their governments' sibling work are read: point reads by id, and the indexed
     subject filter (a plan's contract subject is its item's subject; the coordinator refuses any other). */
  const owed = (await Promise.all(input.workItemIds.map(id => input.repos.workItems.read(id))))
    .map(row => row?.value).filter((item): item is WorkItem => Boolean(item?.autonomousPlan?.publication));
  const siblings = new Map<string, Promise<readonly WorkItem[]>>();
  const subjectWork = (subjectId: string) => {
    if (!siblings.has(subjectId)) siblings.set(subjectId, input.repos.workItems.listWhere(["subject"], subjectId).then(rows => rows.map(row => row.value)));
    return siblings.get(subjectId)!;
  };
  const fields: ElectionFieldInput[] = [], fieldsByItem = new Map<string, number>(), read = new Map<string, Promise<readonly ElectionFieldInput[]>>();
  let nationalFields: readonly ElectionFieldInput[] = [], nationalFailure: string | null = null;
  try {
    const nationalArtifacts = owed.length && input.repos.artifactsByCanonicalUrl
      ? await input.repos.artifactsByCanonicalUrl(NATIONAL_ELECTION_OFFICES_URL, input.limit ?? 60) : [];
    for (const artifact of heldPageCopies(nationalArtifacts, input.limit ?? 60)) {
      const capture = await input.readHeld(artifact);
      if (!capture || !captureIntact(capture)) continue;
      nationalFields = heldNationalElectionOfficeFields(capture);
      if (nationalFields.length) break;
    }
  } catch (error) {
    nationalFailure = `NATIONAL_ELECTION_OFFICE_SOURCE_UNAVAILABLE:${sanitizedErrorDiagnostic(error)}`;
  }
  for (const item of owed) {
    const plan = item.autonomousPlan!;
    const body = registry?.payload.registry.bodies.find(row => row.id === plan.publication!.bodyId);
    // The government the owed work names: its registry division, whose saved pages speak for it.
    const divisionId = body?.ocdId ?? null;
    const division = divisionId ? registry!.payload.registry.divisions.find(row => row.ocdId === divisionId) : undefined;
    if (!division) { fieldsByItem.set(item.id, -1); continue; }
    const key = `${plan.contract.subjectId}\n${division.ocdId}`;
    if (!read.has(key)) read.set(key, (async () => {
      const place = (await subjectWork(plan.contract.subjectId)).filter(other => other.autonomousPlan?.contract.subjectId === plan.contract.subjectId);
      const artifacts = (await Promise.all(place.map(other => input.repos.artifacts.read(other.id)))).flat();
      const candidates = heldPageCopies(artifacts, input.limit ?? 60);
      const found: ElectionFieldInput[] = [];
      // The newest usable copy of each page speaks for it; a later "Access Denied" capture never shadows a good one.
      const readUrls = new Set<string>();
      for (const artifact of candidates) {
        if (readUrls.has(artifact.canonicalUrl)) continue;
        const capture = await input.readHeld(artifact);
        // The right place: the government's own saved page names that government.
        if (!capture || !captureIntact(capture) ||
          (capture.evidence.canonicalUrl !== NATIONAL_ELECTION_OFFICES_URL && !pageWords(capture.evidence.text).includes(division.label.toLowerCase()))) continue;
        readUrls.add(artifact.canonicalUrl);
        found.push(...heldElectionOfficeFields({ divisionId: division.ocdId, capture }));
      }
      return found;
    })());
    const found = [...await read.get(key)!, ...nationalFields.filter(field => electionFieldState(field.divisionId) === electionFieldState(division.ocdId))];
    fieldsByItem.set(item.id, found.length);
    for (const field of found) if (!fields.includes(field)) fields.push(field);
  }
  let published: Awaited<ReturnType<typeof publishElectionFields>> | null = null, failure: string | null = nationalFailure, fresh: string[] = [];
  if (fields.length) {
    try {
      // Delivery counts what this pass newly put in front of readers, once, not each re-verified office per owed item.
      const before = new Set(((await readManualProjectionPrior("ballot-navigation", input.store, input.now))?.payload as { records?: readonly { id: string }[] } | undefined)?.records?.map(row => row.id) ?? []);
      published = await publishElectionFields({ store: input.store, now: input.now, fields, verify: section3Record });
      fresh = published.fields.filter(id => !before.has(id));
    } catch (error) { failure = sanitizedErrorDiagnostic(error); }
  }
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  for (const item of owed) {
    const count = fieldsByItem.get(item.id) ?? 0;
    const credited = fresh.length > 0 && !report.some(row => row.outcome.acceptedRecordIds?.length);
    const outcome: NonNullable<WorkItem["publicationOutcome"]> = published?.fields.length && count > 0
      ? { at: input.now, workerResultId: "held:election-offices", status: "PARTIALLY_PUBLISHED", code: credited ? "ELECTION_OFFICES_PUBLISHED" : "VERIFIED_RESULT_REUSED",
        detail: `ballot-navigation: ${published.fields.length} election office(s) with their phone lines passed §3 on the government's saved official pages (${fresh.length} new this pass); version ${published.promotedVersionId}. Registration and polling links stay open as work.`,
        recovery: "WORKER", candidateId: published.candidateId, versionId: published.promotedVersionId, ...(credited ? { acceptedRecordIds: fresh } : {}) }
      : { at: input.now, workerResultId: "held:election-offices", status: "HELD",
        code: failure ? failure.split(":")[0] : count < 0 ? "CANONICAL_BODY_MISSING" : "ELECTION_OFFICE_NOT_ON_SAVED_PAGES",
        detail: `${failure ?? (count < 0 ? "The work item's body has no registry division yet" : "No saved official page for this government names an election office with its phone line that passes §3")}. Saved pages are re-read hourly; no approval is required.`,
        recovery: "WORKER", candidateId: published?.candidateId ?? null, versionId: published?.promotedVersionId ?? null };
    const latest = await input.repos.workItems.mustRead(item.id);
    await input.repos.workItems.compareAndSet(item.id, latest.revision, { ...latest.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: item.id, outcome });
  }
  return report;
}
