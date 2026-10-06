import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerEvidence, WorkerResultRecord } from "../control-plane/workers/types.ts";
import { projectReaderRoster, type BodyRoster } from "../registry/body-rosters.ts";
import type { OfficialCandidacyBridgeRow, RegistryRuntimePackage, RegistryRuntimePrior, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readCompletedWorkerResults } from "../control-plane/repository/worker-completion.ts";
import type { WorkItem } from "../control-plane/work-item.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, registryBaseSourceReceipt } from "../registry/runtime-data-plane.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import type { PromotionOutcome } from "./promotion.ts";
import type { RoutineDataStore } from "./store.ts";
import { processRegisteredManualCandidate } from "./promotion.ts";
import { recordRoutineReaderProjectionReadback } from "./reader-verification.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { heldDirectoryReading, materializeBodyDirectoryWork, workerBodyDirectoryPackage, type DirectoryReading } from "./worker-body-directory.ts";
import { runtimeKinds } from "../registry/kinds-runtime.ts";
import { publicationRecordChanges } from "./publication-record-changes.ts";
import { auditPull, capturesForPublication, captureIntact, latestParserResult, registryEdition, section3SourceReceipt, validatorObservation } from "./worker-publication-evidence.ts";
import { readValidatorManual, writeValidatorLessons, type ValidatorObservation } from "../control-plane/promotion/validator-manual.ts";
import { readHeldRoster } from "./worker-held-roster.ts";
import { heldBodySchedule, type HeldBodySchedule } from "./worker-held-meetings.ts";
import { localHeldCaptureReader } from "./worker-publication-context.ts";
import { isOfficialSource, type OfficialLinkingPage } from "./source-authority.ts";
import { linkingPageFrom, pageWords, section3Page, section3Record } from "../control-plane/promotion/section3.ts";
import { isoTermDate, isoTermDateOnPage } from "./term-dates.ts";
import { inventoryRecordEvidence } from "../control-plane/workers/record-evidence.ts";
import { compareCandidateWithSource } from "../control-plane/workers/record-verification.ts";
import { recordPublishedPageDoor, withPageDoor } from "./worker-page-doors.ts";

export interface WorkerPublicationCapture {
  readonly sourcePolicy?: import("../control-plane/promotion/source-kinds.ts").SourcePolicy;
  readonly evidence: WorkerEvidence;
  /** Latest successful network observation, not the time an old blob was replayed. */
  readonly observedAt: string;
  readonly httpStatus: number | null;
  readonly transport: string;
  readonly partial: boolean;
}

/** One roster read from one saved official page: by a parser result, or by plain code from held evidence. */
export interface RosterReading {
  /** The parser result id, or `held:<artifactId>` for a page read in code. */
  readonly id: string;
  readonly capture: WorkerPublicationCapture;
  readonly linkingPage: OfficialLinkingPage | null;
  readonly members: readonly { readonly recordId: string; readonly fields: Readonly<Record<string, unknown>> }[];
  /** Every member row on the page was read, so a prior member absent from it has left. */
  readonly complete: boolean;
  readonly method: string;
}

const requireThat = (value: unknown, reason: string): void => { if (!value) throw new Error(reason); };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Carry the exact candidate accepted by the existing atomic door and typed readback. */
export function acceptedRegistryPrior(published: PromotionOutcome): RegistryRuntimePrior {
  if (!published.promoted) throw new Error("REGISTRY_PUBLICATION_NOT_ACCEPTED");
  const candidate = published.candidate.candidate;
  return { versionId: published.promoted.versionId, payload: candidate.readModel as RegistryRuntimeReadModel,
    sourceReceipt: registryBaseSourceReceipt(candidate), readModelSha256: digest(canonicalCivicDataJson(candidate.readModel)) };
}
const words = (text: string) => text.replace(/<[^>]*>/g, " ").replace(/&(?:amp|nbsp);/g, " ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const titleOf = (html: string) => words([/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "", ...[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1])].join(" "));
const GOVERNING = /\b(council|mayor|select ?board|selectmen|board of (supervisors|commissioners|aldermen|selectmen)|township committee|commission(ers)?)\b/;
const SCHOOL_BOARD = /\b(governing board|school board|board of (education|trustees)|board members?|trustees)\b/;
const BODY_NAME = [/\b(city|town|village|borough|township) (council|commission|committee)\b/, /\bboard of (supervisors|commissioners|education|trustees|aldermen|selectmen)\b/,
  /\b(governing board|school board|select ?board|township committee)\b/, /\bcouncil\b/];
const titleCase = (text: string) => text.replace(/\b\p{L}/gu, c => c.toUpperCase());
/** The division a body governs: the place its page must name when the body has no name yet. */
const governmentOf = <D extends { readonly ocdId: string }>(divisions: readonly D[], { ocdId }: { readonly ocdId: string | null }): D | null =>
  divisions.find(row => row.ocdId === ocdId) ?? null;

/**
 * The saved page is about this body. A page read in code (`inTitle`) must say
 * so in its title or main heading — a city page's navigation names many
 * bodies. An extraction bound to this body needs only to name it.
 */
export function pageIsAboutBody(html: string, body: { readonly id: string; readonly name: string | null }, divisionLabel: string | null, inTitle = true): boolean {
  // A legislative seat: its holder's own page names the district.
  const seat = /\/(?:sldl|sldu|cd):([a-z0-9-]+)#seat$/.exec(body.id)?.[1];
  if (seat) return seat === "at-large" ? ` ${words(html)} `.includes(" at large ") : ` ${words(html)} `.includes(` district ${seat.replace(/^0+/, "")} `);
  if (!inTitle && body.name) return words(html).includes(words(body.name));
  const title = titleOf(html);
  if (body.name) {
    const own = words(divisionLabel ? body.name.replace(new RegExp(divisionLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "") : body.name);
    if (own.length > 0 && title.includes(own)) return true;
    // A governing body named from its own pages is still the body its "Mayor & Council" page names;
    // a bare "Commission" title is another body once the governing body has a name.
    return body.id.endsWith("#governing") && GOVERNING.test(title.replace(/\bcommission\b/g, ""));
  }
  if (body.id.endsWith("#governing")) return GOVERNING.test(title);
  if (body.id.endsWith("#board")) return SCHOOL_BOARD.test(title);
  return false;
}

/** The body's name as its own page states it, for a registry body not yet named. */
export function bodyNameFromPage(html: string, divisionLabel: string): string | null {
  const text = pageWords(html);
  for (const pattern of BODY_NAME) {
    const match = pattern.exec(text);
    if (match) return `${divisionLabel} ${titleCase(match[0])}`;
  }
  return null;
}

/**
 * The registry door for a roster that passes §3: members whose seat and name
 * are on a saved official page from the right place, inside its freshness
 * window, go live; contact details attach when they are on the page too;
 * blanks stay open. A complete roster records departures; a partial one keeps
 * prior members on their own earlier source.
 */
export function workerRosterPublication(input: {
  readonly bodyId: string;
  readonly reading: RosterReading;
  readonly prior: RegistryRuntimePrior;
  readonly now: string;
  /** The body's regular schedule and agenda link from a saved official page, when one states them. */
  readonly schedule?: HeldBodySchedule | null;
}): RegistryRuntimePackage & { readonly departed: readonly string[]; readonly accepted: readonly { recordId: string; memberId: string }[]; readonly unresolved: readonly string[] } {
  const { reading, prior, now } = input;
  const capture = reading.capture;
  requireThat(captureIntact(capture), "ROSTER_CAPTURE_INCOMPLETE");
  const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt, linkingPage: reading.linkingPage, sourcePolicy: capture.sourcePolicy };
  const pageVerdict = section3Page(page, "OFFICIAL_ROSTER", now);
  requireThat(pageVerdict.ok, `ROSTER_PAGE_UNVERIFIED:${pageVerdict.reason}`);
  const body = prior.payload.registry.bodies.find(row => row.id === input.bodyId);
  requireThat(body, "ROSTER_BODY_UNREGISTERED");
  if (!body) throw new Error("ROSTER_BODY_UNREGISTERED");
  const division = governmentOf(prior.payload.registry.divisions, body);
  // The right place: the page is about this body, and names its government when the body is not yet named.
  requireThat((body.name !== null || division === null || pageWords(capture.evidence.text).includes(division.label.toLowerCase())) &&
    pageIsAboutBody(capture.evidence.text, body, division?.label ?? null, reading.id.startsWith("held:")), "ROSTER_PAGE_NOT_THIS_BODY");
  const previous = prior.payload.bodyRosters.find(roster => roster.bodyId === body.id);
  const bodyName = body.name ?? previous?.bodyName ?? (division ? bodyNameFromPage(capture.evidence.text, division.label) : null);
  if (!bodyName) throw new Error("ROSTER_BODY_NAME_UNVERIFIED");
  const live: { recordId: string; fields: Readonly<Record<string, unknown>>; verified: readonly string[] }[] = [];
  const unresolved: string[] = [];
  for (const member of reading.members) {
    const verdict = section3Record({ recordClass: "OFFICIAL_ROSTER", fields: member.fields, page, now, pageVerdict,
      ...(typeof member.fields.nameAsWritten === "string" ? { derived: { name: "nameAsWritten" } } : {}) });
    if (verdict.live) live.push({ ...member, verified: verdict.verifiedFields });
    else unresolved.push(member.recordId);
  }
  requireThat(live.length > 0, "ROSTER_NO_MEMBER_MEETS_MINIMUMS");
  const phones = new Map<string, number>();
  for (const member of live) {
    const phone = member.verified.includes("phone") ? member.fields.phone : null;
    if (typeof phone === "string" && phone.trim()) phones.set(phone.trim(), (phones.get(phone.trim()) ?? 0) + 1);
  }
  const verifiedValue = (member: typeof live[number], field: string): string | null => {
    const value = member.fields[field];
    return member.verified.includes(field) && typeof value === "string" && value.trim() ? value.trim() : null;
  };
  const source = { sourceUrl: capture.evidence.canonicalUrl, sourceOrg: capture.evidence.sourceId, collectedAt: capture.observedAt.slice(0, 10) };
  const accepted: { recordId: string; memberId: string }[] = [];
  const members: BodyRoster["members"] = live.map(member => {
    const name = verifiedValue(member, "name")!, officeTitle = verifiedValue(member, "office")!;
    const matching = previous?.members.filter(old => old.name === name && old.officeTitle === officeTitle) ?? [];
    requireThat(matching.length <= 1, "ROSTER_PRIOR_PERSON_IDENTITY_CONFLICT");
    const old = matching[0];
    const { membershipSource: _oldMembership, retainedFieldSources: _oldRetained, ...identity } = old ??
      { id: `roster:${body.id}#${digest(member.recordId).slice(0, 16)}`, termNote: null, email: null, phone: null, websiteUrl: null };
    const priorSource = old?.membershipSource ?? (previous ? { sourceUrl: previous.sourceUrl, sourceOrg: previous.sourceOrg, collectedAt: previous.collectedAt } : null);
    const retainedFieldSources: NonNullable<BodyRoster["members"][number]["retainedFieldSources"]> = {};
    // A public office line only: a field the page marks personal never reaches the card.
    const publicContact = member.fields.contactKind !== "PERSONAL";
    const value = (field: "termNote" | "email" | "phone" | "websiteUrl", allowed = true): string | null => {
      const fresh = allowed ? verifiedValue(member, field) : null;
      if (fresh !== null) return fresh;
      const retained = old?.[field] ?? null;
      if (retained !== null && priorSource) retainedFieldSources[field] = old?.retainedFieldSources?.[field] ?? priorSource;
      return retained;
    };
    const pageText = pageWords(capture.evidence.text);
    const termDate = (field: "termStart" | "termEnd"): string | null => {
      const fresh = isoTermDate(member.fields[field]);
      if (fresh !== null && isoTermDateOnPage(fresh, pageText)) return fresh;
      const retained = isoTermDate(old?.[field]);
      if (retained !== null && priorSource) retainedFieldSources[field] = old?.retainedFieldSources?.[field] ?? priorSource;
      return retained;
    };
    const termStart = termDate("termStart"), termEnd = termDate("termEnd");
    const phone = value("phone", publicContact), email = value("email", publicContact);
    const freshContact = publicContact && (verifiedValue(member, "phone") !== null || verifiedValue(member, "email") !== null);
    accepted.push({ recordId: member.recordId, memberId: identity.id });
    return { ...identity, name, officeTitle, termNote: value("termNote"), ...(termStart ? { termStart } : {}), ...(termEnd ? { termEnd } : {}), email, phone, websiteUrl: value("websiteUrl"),
      ...(freshContact ? { contactKind: "PUBLIC_OFFICE" as const } : old?.contactKind ? { contactKind: old.contactKind } : {}),
      ...(phone && freshContact ? { contactScope: (phones.get(phone) ?? 0) > 1 ? "SHARED_OFFICE" as const : old?.contactScope ?? "INDIVIDUAL_OFFICE" as const }
        : old?.contactScope ? { contactScope: old.contactScope } : {}),
      ...(Object.keys(retainedFieldSources).length ? { retainedFieldSources } : {}) };
  });
  const proposed: BodyRoster = { bodyId: body.id, bodyName, sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg, collectedAt: source.collectedAt,
    partisanship: previous?.partisanship ?? "UNDETERMINED", ...(previous?.partisanshipSourceUrl ? { partisanshipSourceUrl: previous.partisanshipSourceUrl } : {}), members };
  const rendered = projectReaderRoster(proposed);
  requireThat(rendered.roster.members.length > 0, "ROSTER_NO_READER_ELIGIBLE_MEMBERS");
  // A row the reader roster refuses as a person (navigation text) stays open too.
  for (const row of rendered.dispositions.filter(row => row.state === "IDENTITY_UNRESOLVED")) {
    const binding = accepted.findIndex(a => a.memberId === row.sourceId);
    if (binding >= 0) unresolved.push(accepted.splice(binding, 1)[0].recordId);
  }
  for (const recordId of unresolved) rendered.dispositions.push({ sourceId: recordId, canonicalId: null, state: "IDENTITY_UNRESOLVED",
    reason: "The row's seat or name is not yet verified on the saved official page; it stays open as work." });
  const departed: string[] = [];
  const departures: { bodyId: string; holderId: string; sourceUrl: string }[] = [];
  if (previous) {
    for (const member of previous.members.filter(old => !rendered.roster.members.some(current => current.id === old.id))) {
      // A complete official roster that no longer lists someone is the departure's evidence:
      // the member leaves the reader with their disposition, candidacy and photo rows.
      if (reading.complete && unresolved.length === 0) {
        departed.push(`${member.name} (${member.officeTitle})`);
        departures.push({ bodyId: body.id, holderId: member.id, sourceUrl: source.sourceUrl });
        continue;
      }
      rendered.roster.members.push({ ...member, membershipSource: member.membershipSource ?? { sourceUrl: previous.sourceUrl, sourceOrg: previous.sourceOrg, collectedAt: previous.collectedAt } });
      rendered.dispositions.push({ sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE",
        reason: "Retained from the prior verified roster; this page was not a complete roster, so it does not establish a departure." });
    }
  }
  // Holding office and running for it are separate facts; candidacy stays owed, never asserted.
  const pendingCandidacies: OfficialCandidacyBridgeRow[] = rendered.roster.members
    .filter(member => !prior.payload.officialCandidacies.rows.some(row => row.holder.id === member.id))
    .map(member => ({ holder: { id: member.id, name: member.name, officeTitle: member.officeTitle,
      divisions: body.ocdId ? [body.ocdId] : [], authority: "REGISTRY_BODY_ROSTER", sourceUrl: source.sourceUrl },
      status: "NOT_CHECKED", candidacy: null, unresolvedCandidacyIds: [],
      reason: "Officeholding verified on the body's official page. Ballot candidacy remains owed; no candidacy or absence is asserted." }));
  // The body itself: named and sourced from its own roster page when it was only Census-derived,
  // and its regular schedule and agenda link attached when a saved official page states them.
  const own = (division ? bodyName.toLowerCase().split(division.label.toLowerCase()).join(" ") : bodyName.toLowerCase()).replace(/\s+/g, " ").trim();
  const named = body.name === null && own.length > 0 && pageWords(capture.evidence.text).includes(own);
  const schedule = input.schedule?.schedule;
  const updated = { ...body,
    ...(named ? { name: bodyName, bodyOrigin: "SOURCED" as const, provenance: { ...source, collectedAt: capture.observedAt, verifiedAt: now } } : {}),
    ...(schedule?.cadence ? { meetingCadence: schedule.cadence,
      meetingCadenceSource: { sourceUrl: input.schedule!.capture.evidence.canonicalUrl, collectedAt: input.schedule!.capture.observedAt } } : {}),
    ...(schedule?.agendaUrl ? { agendaSourceRef: schedule.agendaUrl } : {}) };
  const bodies = canonicalJson(updated) === canonicalJson(body) ? [] : [updated];
  const pages = bodies.length && input.schedule && input.schedule.capture.evidence.artifactId !== capture.evidence.artifactId ? [capture, input.schedule.capture] : [capture];
  return { contractId: "registry-runtime-bindings", scope: "MEMBERS", ...(departures.length ? { departures } : {}), version: registryEdition(`section3-roster:${reading.id}${bodies.length ? `:${digest(canonicalJson(updated)).slice(0, 12)}` : ""}`), sourceThrough: now,
    sourceReceipt: section3SourceReceipt(pages, now, `section3-validator:${reading.id}`,
      `${reading.method}: ${members.length} member(s) with seat and name on the saved official page inside its freshness window (§3).` +
      (schedule?.cadence || schedule?.agendaUrl ? ` The body's regular schedule and agenda link were read in code from ${input.schedule!.capture.evidence.canonicalUrl}.` : "")),
    // The source-scoped door carries unchanged bodies on their prior authority; this supplies only the verified roster.
    payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions: [], bodies },
      bodyRosters: [rendered.roster], rosterReaderDispositions: rendered.dispositions,
      statewideExecutives: [], officialCandidacies: { ...prior.payload.officialCandidacies, rows: pendingCandidacies },
      officialPhotos: { photos: [] }, rosterPhotos: {} },
    departed, accepted, unresolved };
}

/** A roster from the work's latest parser result, checked in code. */
function parserReading(parser: WorkerResultRecord, contract: NonNullable<WorkItem["autonomousPlan"]>["contract"], captures: readonly WorkerPublicationCapture[]): RosterReading | null {
  if (parser.result.role !== "PARSER" || contract.schemaVersion !== 2) return null;
  const extraction = parser.result;
  const capture = captures.find(c => c.evidence.artifactId === extraction.artifactId);
  if (!capture) return null;
  const replay = compareCandidateWithSource(extraction, contract, capture.evidence, inventoryRecordEvidence(capture.evidence, contract.extraction));
  return { id: parser.id, capture, linkingPage: linkingPageFrom(capture.evidence.canonicalUrl, captures.map(c => c.evidence)),
    members: extraction.records.filter(record => !replay.some(f => f.recordId === record.id && (!f.field || ["name", "office"].includes(f.field))))
      .map(record => ({ recordId: record.id, fields: record.fields })),
    complete: !replay.some(f => f.code.startsWith("COMPLETENESS_") || f.code === "DECLARED_COUNT_MISMATCH"), method: `Parser result ${parser.id}` };
}

/**
 * A roster read in plain code from saved official pages held for this body by
 * any job — newest first — before any model is asked. The first intact,
 * official, fresh page about this body with a member table is the reading.
 */
export async function heldRosterReading(input: {
  readonly bodyId: string; readonly prior: RegistryRuntimePrior; readonly now: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
  readonly limit?: number;
}): Promise<RosterReading | null> {
  const body = input.prior.payload.registry.bodies.find(row => row.id === input.bodyId);
  if (!body) return null;
  const division = governmentOf(input.prior.payload.registry.divisions, body);
  const seen = new Set<string>();
  const candidates = [...input.artifacts].filter(a => !a.partial && /html/i.test(a.contentType) && isOfficialSource(a.canonicalUrl))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .filter(a => !seen.has(a.contentHash) && Boolean(seen.add(a.contentHash)))
    .slice(0, input.limit ?? 40);
  for (const record of candidates) {
    const capture = await input.readHeld(record);
    if (!capture || !captureIntact(capture)) continue;
    const page = { url: capture.evidence.canonicalUrl, text: capture.evidence.text, retrievedAt: capture.observedAt };
    if (!section3Page(page, "OFFICIAL_ROSTER", input.now).ok || !pageIsAboutBody(capture.evidence.text, body, division?.label ?? null)) continue;
    const roster = readHeldRoster(capture.evidence.text, capture.evidence.canonicalUrl);
    if (!roster?.rows.length) continue;
    return { id: `held:${capture.evidence.artifactId}`, capture, linkingPage: null, complete: roster.complete, method: `Saved page ${capture.evidence.artifactId} read in code`,
      members: roster.rows.map(row => ({ recordId: `held:${digest(`${row.nameAsWritten}\n${row.office}`).slice(0, 16)}`,
        fields: Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) })) };
  }
  return null;
}

/**
 * Publish every roster and body-directory item that now meets §3, in one
 * pass. No live Send, auditor or owner instruction is required. Each body
 * advances independently; a hold goes back onto its own work item.
 */
export async function publishWorkerRosterResults(input: {
  readonly repos: ControlPlaneRepositories; readonly store: RoutineDataStore;
  readonly workItemIds: readonly string[]; readonly now: string;
  readonly readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>;
  /** Reads a held page straight from the vault by its artifact record; enables reuse of any job's saved evidence. */
  readonly readHeld?: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null>;
}): Promise<readonly { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[]> {
  if (!input.workItemIds.length) return [];
  const kinds = runtimeKinds((await input.repos.adminConfig.read("current"))?.value ?? null);
  const records = await readCompletedWorkerResults(input.repos);
  const readHeld = input.readHeld ?? localHeldCaptureReader();
  const allItems = (await input.repos.workItems.list()).map(row => row.value);
  const report: { workItemId: string; outcome: NonNullable<WorkItem["publicationOutcome"]> }[] = [];
  // Carry accepted snapshots through the pass; reload only after an external base change.
  let registry: RegistryRuntimePrior | null | undefined;
  // Several jobs can owe the same body. Its saved pages are read once per pass, and
  // once a reading is published every other job for that body reuses that publication.
  const heldByBody = new Map<string, Promise<RosterReading | null>>();
  const heldDirectories = new Map<string, Promise<DirectoryReading | null>>();
  const schedules = new Map<string, Promise<HeldBodySchedule | null>>();
  const publishedByBody = new Map<string, NonNullable<WorkItem["publicationOutcome"]>>();
  // The Validator reads what earlier passes learned before it checks anything, and writes back once at the end.
  const manual = await readValidatorManual(input.repos);
  const learned: ValidatorObservation[] = [];
  for (const id of [...new Set(input.workItemIds)]) {
    const item = (await input.repos.workItems.mustRead(id)).value;
    const plan = item.autonomousPlan;
    if (plan?.publication?.contractId !== "registry-runtime-bindings" || plan.contract.schemaVersion !== 2) continue;
    const bodyId = plan.publication.bodyId;
    let outcome: NonNullable<WorkItem["publicationOutcome"]>;
    let candidateId: string | null = null, versionId: string | null = null, readingId: string | null = null, parserId: string | null = null;
    let captures: WorkerPublicationCapture[] = [], reading: RosterReading | null = null, heldDirectory: DirectoryReading | null = null, wentLive = 0;
    let schedule: HeldBodySchedule | null = null;
    try {
      if (registry === undefined) registry = await readRegistryRuntimePrior(input.store, input.now);
      const prior = registry;
      if (!prior) throw new Error("ROSTER_PRIOR_READER_AUTHORITY_MISSING");
      const parser = latestParserResult(records, id);
      parserId = parser?.id ?? null;
      const directory = plan.contract.recordClass === "OFFICIAL_BOARD_DIRECTORY";
      captures = parser ? await capturesForPublication({ repos: input.repos, workItemId: id, primaryId: (parser.result as { artifactId: string }).artifactId, results: records, readCapture: input.readCapture, officialLinks: manual.officialLinks }) : [];
      if (directory && !parser) {
        // No extraction yet: read the government's saved directory pages in code, once per government per pass.
        const government = plan.directorySubject?.jurisdiction.id ?? id;
        if (!heldDirectories.has(government)) heldDirectories.set(government, (async () => {
          const siblings = allItems.filter(other => (other.autonomousPlan?.directorySubject?.jurisdiction.id ?? other.id) === government);
          const artifacts = (await Promise.all(siblings.map(other => input.repos.artifacts.read(other.id)))).flat();
          return heldDirectoryReading({ plan, prior, now: input.now, artifacts, readHeld });
        })());
        heldDirectory = await heldDirectories.get(government)!;
        if (!heldDirectory) throw new Error("DIRECTORY_NO_READABLE_SAVED_PAGE:No saved official page for this government lists a board or commission that passes §3 yet");
      }
      if (!directory) {
        const pull = parser ? auditPull(records, parser) : null;
        reading = parser && !pull?.all ? parserReading(parser, plan.contract, captures) : null;
        if (reading && pull) reading = { ...reading, members: reading.members.filter(member => !pull.recordIds.has(member.recordId)) };
        if (!reading) {
          if (!heldByBody.has(bodyId)) heldByBody.set(bodyId, (async () => {
            const siblings = allItems.filter(other => other.autonomousPlan?.publication?.bodyId === bodyId);
            const artifacts = (await Promise.all(siblings.map(other => input.repos.artifacts.read(other.id)))).flat();
            return heldRosterReading({ bodyId, prior, now: input.now, artifacts, readHeld });
          })());
          reading = await heldByBody.get(bodyId)!;
        }
        if (!reading) throw new Error("ROSTER_NO_READABLE_SAVED_PAGE:No extraction yet, and no saved official page for this body has a member table that passes §3");
        // The body's regular schedule, from any job's saved official pages for the same government.
        if (!schedules.has(bodyId)) schedules.set(bodyId, (async () => {
          const body = prior.payload.registry.bodies.find(row => row.id === bodyId);
          if (!body) return null;
          const place = allItems.filter(other => other.autonomousPlan?.publication?.bodyId === bodyId || other.autonomousPlan?.contract.subjectId === plan.contract.subjectId);
          const artifacts = (await Promise.all(place.map(other => input.repos.artifacts.read(other.id)))).flat();
          return heldBodySchedule({ body: { id: bodyId, name: body.name ?? prior.payload.bodyRosters.find(r => r.bodyId === bodyId)?.bodyName ?? null },
            divisionLabel: governmentOf(prior.payload.registry.divisions, body)?.label ?? null, artifacts, readHeld, now: input.now });
        })());
        schedule = await schedules.get(bodyId)!;
      }
      // The roster package is pure code over the reading, so it is built before the "already published" check:
      // a newly saved schedule page, or a body fact the reading now supports, is new work even when the roster is unchanged.
      const roster = directory ? null : workerRosterPublication({ bodyId, reading: reading!, prior, now: input.now, schedule });
      const bodyChange = roster?.payload.registry.bodies.length ? `+body:${digest(canonicalJson(roster.payload.registry.bodies)).slice(0, 12)}` : "";
      readingId = directory ? parser?.id ?? heldDirectory!.id : `${reading!.id}${schedule ? `+${schedule.capture.evidence.artifactId}` : ""}${bodyChange}`;
      const brokeAfter = parser ? auditPull(records, parser) : null;
      if (item.publicationOutcome?.workerResultId === readingId && item.publicationOutcome.status !== "HELD" && !(brokeAfter && brokeAfter.at > item.publicationOutcome.at)) { report.push({ workItemId: id, outcome: item.publicationOutcome }); continue; }
      const already = publishedByBody.get(`${bodyId}
${readingId}`);
      if (already) throw Object.assign(new Error("REUSED"), { reused: already });
      const directoryPackage = !directory ? null : parser ? workerBodyDirectoryPackage({ plan, parser, captures, prior, now: input.now, results: records, kinds })
        : workerBodyDirectoryPackage({ plan, held: heldDirectory!, prior, now: input.now, kinds });
      const prepared: RegistryRuntimePackage = directoryPackage?.prepared ?? roster!;
      const unresolved = directoryPackage?.unresolved ?? roster!.unresolved;
      const before = prior.payload.bodyRosters.find(r => r.bodyId === bodyId)?.members ?? [];
      const bodyFacts = (row: RegistryRuntimeReadModel["registry"]["bodies"][number]) => ({ name: row.name, bodyClass: row.bodyClass, ocdId: row.ocdId, homepageUrl: row.homepageUrl });
      const changes = publicationRecordChanges({ previousVersionId: prior.versionId, accepted: directoryPackage
        ? prepared.payload.registry.bodies.map(body => {
          const previous = prior.payload.registry.bodies.find(row => row.id === body.id);
          return { recordId: body.id, readerId: body.id, value: bodyFacts(body), previous: previous ? bodyFacts(previous) : undefined };
        })
        : roster!.accepted.map(binding => ({ recordId: binding.recordId, readerId: binding.memberId,
          value: prepared.payload.bodyRosters[0].members.find(row => row.id === binding.memberId)!,
          previous: before.find(row => row.id === binding.memberId) })) });
      const candidate = registryRuntimeCandidate(prepared, { prior });
      requireThat(prepared.payload.registry.bodies.every(body => canonicalJson(body) ===
        canonicalJson((candidate.readModel as RegistryRuntimeReadModel).registry.bodies.find(row => row.id === body.id))), directoryPackage ? "WORKER_PUBLICATION_DIRECTORY_READER_FACTS_HELD" : "ROSTER_BODY_READER_FACTS_HELD");
      if (!directoryPackage) requireThat(canonicalJson((candidate.readModel as RegistryRuntimeReadModel).bodyRosters.find(r => r.bodyId === bodyId)) ===
        canonicalJson(prepared.payload.bodyRosters[0]), "ROSTER_READER_FACTS_HELD");
      candidateId = candidate.id;
      const published = await processRegisteredManualCandidate(input.store, "registry-runtime-bindings", candidate, input.now, prior.versionId);
      if (!published.promoted) { if (published.candidate.failureCode === "PROMOTION_BASE_CHANGED") registry = undefined; throw new Error(`${published.candidate.failureCode === "PROMOTION_BASE_CHANGED" ? "PROMOTION_BASE_CHANGED" : "ROSTER_READER_GATE_HELD"}:${published.candidate.failureDetail ?? published.candidate.state}`); }
      versionId = published.promoted.versionId;
      registry = undefined;
      const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
        requiredManualProductionContract("registry-runtime-bindings"), published.promoted, input.now);
      if (readback?.status !== "PASS") throw new Error(`ROSTER_READER_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
      registry = acceptedRegistryPrior(published);
      const count = directoryPackage ? prepared.payload.registry.bodies.length : prepared.payload.bodyRosters[0].members.length;
      outcome = { at: input.now, workerResultId: readingId, status: unresolved.length ? "PARTIALLY_PUBLISHED" : "PUBLISHED",
        code: unresolved.length ? directoryPackage ? "DIRECTORY_ROWS_REQUIRE_REPAIR" : "ROSTER_IDENTITIES_REQUIRE_REPAIR" : published.confirmed ? "VERIFIED_RESULT_REUSED" : "VERIFIED_RESULT_PUBLISHED",
        detail: `§3 passed for ${count} reader ${directoryPackage ? "bodies" : "members"}; the registry door accepted ${versionId} and typed reader readback passed.` +
          (roster?.departed.length ? ` No longer on the complete official roster, so removed from the reader: ${roster.departed.join("; ")}.` : "") +
          (unresolved.length ? ` ${unresolved.length} row(s) stay open as work: ${unresolved.join(", ")}.` : " Remaining information stays open as work."),
        ...(unresolved.length ? { recovery: "WORKER" as const } : {}), candidateId, versionId, ...changes,
        ...(roster ? { acceptedRecordIds: roster.accepted.map(row => row.recordId), acceptedMembers: roster.accepted } : {}),
        ...(directoryPackage ? { bodyIds: prepared.payload.registry.bodies.map(body => body.id) } : {}) };
      if (directoryPackage) {
        try { await materializeBodyDirectoryWork({ repos: input.repos, parent: { ...item, publicationOutcome: outcome }, bodies: prepared.payload.registry.bodies, now: input.now }); }
        catch { throw new Error("DIRECTORY_DOWNSTREAM_WRITE_FAILED:Verified bodies remain published; recover their downstream assignments on the next publisher cycle"); }
      }
      wentLive = count;
      if (outcome.status !== "HELD") publishedByBody.set(`${bodyId}
${readingId}`, outcome);
    } catch (error) {
      const reused = (error as { reused?: NonNullable<WorkItem["publicationOutcome"]> }).reused;
      // The same reading for the same body gets the same result in one pass: its publication, or its hold.
      if (reused) outcome = reused.status === "HELD" ? { ...reused, at: input.now } : { ...reused, at: input.now, code: "VERIFIED_RESULT_REUSED",
        detail: `The same verified reading was published for this body in this pass (${reused.versionId}). ${reused.detail}` };
      else {
      const detail = sanitizedErrorDiagnostic(error);
      const code = detail.split(":")[0];
      const recovery = (code.startsWith("ROSTER_") && !["ROSTER_PRIOR_READER_AUTHORITY_MISSING", "ROSTER_READER_READBACK_FAILED"].includes(code)) || code.startsWith("WORKER_PUBLICATION_") || code === "DIRECTORY_NO_READABLE_SAVED_PAGE" ? "WORKER" : "PUBLISHER";
      // A hold names the extraction it judged, so owed worker repair waits for a newer one instead of retrying every pass.
      outcome = { at: input.now, workerResultId: readingId ?? parserId ?? "none", status: "HELD", code,
        detail: `${detail}. ${recovery === "WORKER" ? "Continue source work through the existing worker" : "Retry the publication with the verified evidence retained"}; no owner approval is required.`, recovery, candidateId, versionId };
      // A moved base is retried by the next job for this body; any other hold is this reading's result for the pass.
      if (readingId && code !== "PROMOTION_BASE_CHANGED") publishedByBody.set(`${bodyId}\n${readingId}`, outcome);
      }
    }
    // The data operation is already durable; failing to store this receipt never marks it published.
    const current = await input.repos.workItems.mustRead(id);
    const pages = captures.length ? captures : [reading?.capture ?? heldDirectory?.checked.primary].filter((c): c is WorkerPublicationCapture => Boolean(c));
    outcome = withPageDoor(outcome, pages[0], plan.contract.recordClass);
    await input.repos.workItems.compareAndSet(id, current.revision, { ...current.value, publicationOutcome: outcome }, input.now);
    report.push({ workItemId: id, outcome });
    if (outcome.code !== "VERIFIED_RESULT_REUSED") await recordPublishedPageDoor({ repos: input.repos, page: pages[0], recordClass: plan.contract.recordClass, bodyId, published: wentLive, now: input.now });
    if (outcome.code !== "VERIFIED_RESULT_REUSED") learned.push(validatorObservation({ plan, workItemId: id, page: pages[0], captures: pages, published: wentLive, outcome }));
  }
  await writeValidatorLessons(input.repos, learned, input.now);
  return report;
}

/**
 * Publish one §3 roster reading that did not come from a work item — for
 * example an official's own profile page found through a national lead. The
 * reading's members go live on the same registry door; a one-person reading
 * is partial, so prior members stay on their own source.
 */
export async function publishRosterReading(input: {
  readonly store: RoutineDataStore; readonly bodyId: string; readonly reading: RosterReading; readonly now: string;
  readonly prior?: RegistryRuntimePrior;
  readonly onPublished?: (prior: RegistryRuntimePrior) => void;
}): Promise<{ readonly versionId: string; readonly confirmed: boolean; readonly departed: readonly string[]; readonly unresolved: readonly string[] }> {
  const prior = input.prior ?? await readRegistryRuntimePrior(input.store, input.now);
  if (!prior) throw new Error("ROSTER_PRIOR_READER_AUTHORITY_MISSING");
  const roster = workerRosterPublication({ bodyId: input.bodyId, reading: input.reading, prior, now: input.now });
  const candidate = registryRuntimeCandidate(roster, { prior });
  requireThat(canonicalJson((candidate.readModel as RegistryRuntimeReadModel).bodyRosters.find(r => r.bodyId === input.bodyId)) ===
    canonicalJson(roster.payload.bodyRosters[0]), "ROSTER_READER_FACTS_HELD");
  const published = await processRegisteredManualCandidate(input.store, "registry-runtime-bindings", candidate, input.now, prior.versionId);
  if (!published.promoted) throw new Error(`ROSTER_READER_GATE_HELD:${published.candidate.failureCode ?? ""}:${published.candidate.failureDetail ?? published.candidate.state}`);
  const readback = published.readerReadback ?? await recordRoutineReaderProjectionReadback(input.store,
    requiredManualProductionContract("registry-runtime-bindings"), published.promoted, input.now);
  if (readback?.status !== "PASS") throw new Error(`ROSTER_READER_READBACK_FAILED:${readback?.detail ?? "missing typed reader receipt"}`);
  input.onPublished?.(acceptedRegistryPrior(published));
  return { versionId: published.promoted.versionId, confirmed: Boolean(published.confirmed), departed: roster.departed, unresolved: roster.unresolved };
}
