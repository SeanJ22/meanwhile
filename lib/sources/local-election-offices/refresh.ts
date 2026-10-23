import type { RoutineDataStore } from "../../civic-data/store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { failedAcquisitionCandidate, sha256 } from "../../civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../../civic-data/promotion.ts";
import { admitWebsiteRequest, holdWebsiteAfter, type WebsitePacing } from "../../control-plane/website-pacing.ts";
import { votingFetchSession } from "../../ballot/voting-source-fetch.ts";
import { recordDoorEvidence } from "../../doors/shut.ts";
import type { DoorRepository } from "../../doors/registry.ts";
import { extractLocalElectionOffices, type LocalElectionOfficeDocument } from "./extraction.ts";
import { LOCAL_ELECTION_OFFICE_FIELDS, type LocalElectionOffice, type LocalElectionOfficeBlank, type LocalElectionOfficeFile } from "./model.ts";
import type { LocalElectionOfficeRoute } from "./routes.ts";
import { localElectionOfficeRouteDoorId, readLocalElectionOfficeRoutes } from "./doors.ts";
import { saveLocalElectionOfficeRoutes } from "./doors.ts";
import { localElectionOfficeHoursRoute, localElectionOfficePageLinks } from "./enrichment.ts";
import { extractHtmlText } from "../../extract/html-text.ts";
import { publisherSizeForState } from "../publisher-size.ts";
import { websiteRequestLimit } from "../../control-plane/scheduler/host-supervision.ts";
import { localElectionOfficesCandidate, readLocalElectionOfficeDocuments, prepareLocalElectionOfficeProjection, referencedLocalElectionOfficeDocuments, type LocalElectionOfficePayload } from "./publication.ts";
import { LOCAL_ELECTION_OFFICES_PARSER_VERSION, LOCAL_ELECTION_OFFICES_RECORD_CLASS, LOCAL_ELECTION_OFFICES_SOURCE_ID, localElectionOfficesContractId, localElectionOfficesScope, requireLocalElectionOfficeState } from "./targets.ts";

/** Independent source fields attach without clearing working contact details. */
export function mergeLocalElectionOfficeRows(previous: LocalElectionOffice | undefined, incoming: LocalElectionOffice): LocalElectionOffice {
  if (!previous) return incoming;
  const fields = { ...previous.fields }, facts = { ...previous };
  for (const field of LOCAL_ELECTION_OFFICE_FIELDS) {
    const source = incoming.fields[field], value = incoming[field];
    if (!source || !value) continue;
    const prior = fields[field];
    if (prior && Date.parse(prior.checkedAt) > Date.parse(source.checkedAt)) continue;
    if (previous[field] && previous[field] !== value) console.info(JSON.stringify({ event: "local_election_office_source_change", office: incoming.id, field,
      kept: { value, source: source.sourceUrl }, replaced: { value: previous[field], source: prior?.sourceUrl } }));
    facts[field] = value; fields[field] = source;
  }
  const checkedAt = Object.keys(incoming.fields).length || incoming.directorySource ? incoming.checkedAt > previous.checkedAt ? incoming.checkedAt : previous.checkedAt : previous.checkedAt;
  return { ...facts, fields, checkedAt,
    directorySource: incoming.directorySource ?? previous.directorySource, directoryJurisdiction: incoming.directoryJurisdiction ?? previous.directoryJurisdiction,
    excludedMunicipalities: incoming.excludedMunicipalities ?? previous.excludedMunicipalities };
}

export async function refreshLocalElectionOffices(input: {
  readonly state: string;
  readonly store: RoutineDataStore;
  readonly vault: EvidenceStore;
  readonly doors?: DoorRepository;
  readonly routes?: readonly LocalElectionOfficeRoute[];
  readonly fetchImpl?: typeof fetch;
  readonly pacing?: WebsitePacing;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
  /** Read-only production replays can supply real captures while keeping all stores local. */
  readonly capture?: (route: LocalElectionOfficeRoute) => Promise<LocalElectionOfficeDocument>;
  readonly enrichOwnPages?: boolean;
}) {
  const state = requireLocalElectionOfficeState(input.state), now = input.now ?? (() => new Date().toISOString()), at = now();
  const scope = localElectionOfficesScope(state), contractId = localElectionOfficesContractId(state);
  const previous = await input.store.readPromotion<LocalElectionOfficeFile>(LOCAL_ELECTION_OFFICES_RECORD_CLASS, scope);
  const previousCandidate = previous ? await input.store.readCandidate(previous.versionId) : null;
  const payload = previousCandidate?.candidate.normalizedPayload as LocalElectionOfficePayload | null;
  const documents = await readLocalElectionOfficeDocuments(input.vault, payload?.documents ?? []);
  const offices = new Map((previous?.payload.offices ?? []).map(office => [office.id, office]));
  const blanks: LocalElectionOfficeBlank[] = [];
  const failures: { route: string; reason: string }[] = [];
  let successfulReads = 0;
  const routes = [...(input.routes ?? (input.doors ? await readLocalElectionOfficeRoutes(input.doors, state) : []))].sort((a, b) => Number(!!a.scope) - Number(!!b.scope));
  const fetched = new Map<string, Promise<LocalElectionOfficeDocument>>();
  const publisherSize = publisherSizeForState(state);
  const fetchImpl: typeof fetch = async (url, init) => {
    input.signal?.throwIfAborted();
    const href = String(url), epoch = Date.parse(now());
    if (input.pacing) {
      const admitted = await admitWebsiteRequest(input.pacing, href, websiteRequestLimit(publisherSize(href)), epoch);
      if (!admitted.ok) throw new Error(`The publisher asks us to wait until ${new Date(admitted.until).toISOString()}.`);
    }
    const response = await (input.fetchImpl ?? fetch)(url, { ...init, signal: input.signal ? AbortSignal.any([input.signal, init?.signal ?? AbortSignal.timeout(20_000)]) : init?.signal });
    if (input.pacing) await holdWebsiteAfter(input.pacing, href, response.status, response.headers.get("retry-after"), epoch);
    return response;
  };
  const session = votingFetchSession({ fetch: fetchImpl, now, captureCache: new Map() });
  const acquire = (url: string, request?: LocalElectionOfficeRoute["request"]): Promise<LocalElectionOfficeDocument> => {
    const key = `${url}:${request?.body ?? ""}`;
    let capture = fetched.get(key);
    if (!capture) {
      capture = session.get(url, request ? { method: request.method, body: request.body, headers: { "content-type": request.contentType ?? "application/x-www-form-urlencoded" } } : {}).then(raw => {
        if (!raw.bytes.length) throw new Error("The local election-office publisher returned an empty source page.");
        return { ...raw, url, checkedAt: now(), text: new TextDecoder().decode(raw.bytes), documentHash: sha256(raw.bytes) };
      });
      fetched.set(key, capture);
    }
    return capture;
  };
  for (const route of routes) {
    input.signal?.throwIfAborted();
    if (route.state !== state) throw new Error("A local election-office child cannot read another state's route.");
    const doorId = localElectionOfficeRouteDoorId(state, route.id);
    try {
      const source = await (input.capture ? input.capture(route) : acquire(route.url, route.request));
      const read = await extractLocalElectionOffices(route, source);
      successfulReads++;
      documents.push(read.document);
      if (route.directoryUrl !== route.url && !input.capture) documents.push(await acquire(route.directoryUrl));
      for (const office of read.offices) offices.set(office.id, mergeLocalElectionOfficeRows(offices.get(office.id), office));
      blanks.push(...read.blanks);
      if (!read.offices.length) failures.push({ route: route.url, reason: "The state directory returned no office rows; previous verified contacts remain held." });
      if (input.doors) await recordDoorEvidence(input.doors, doorId, read.offices.length ? { kind: "GOOD", rows: read.offices.length } : { kind: "EMPTY", lastGoodRows: previous?.payload.offices.length ?? 0 }, now());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ route: route.url, reason });
      blanks.push({ id: `${route.id}:source`, divisionId: route.scope?.divisionId ?? `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`, field: "directory", reason, sourceUrl: route.url, status: "OPEN" });
      if (input.doors) await recordDoorEvidence(input.doors, doorId, { kind: "PARSE_FAILURE", detail: reason }, now());
    }
  }
  const discoveredRoutes: LocalElectionOfficeRoute[] = [];
  if (input.enrichOwnPages ?? !input.capture) for (const office of offices.values()) {
    if (office.hours || !office.directorySource) continue;
    const route = localElectionOfficeHoursRoute(office);
    if (!route || routes.some(existing => existing.id === route.id)) continue;
    try {
      const home = await acquire(route.url);
      const links = /(?:election|vot|clerk|registrar|canvass)/i.test(new URL(route.url).pathname) ? [route.url] : localElectionOfficePageLinks(new TextDecoder().decode(home.bytes), route.url);
      if (!links.length) throw new Error("The directory-linked website has not exposed a local election or clerk page to read for office hours.");
      let found = false;
      for (const url of links.slice(0, 2)) {
        const source = url === route.url ? home : await acquire(url), text = extractHtmlText(source.text);
        const label = route.jurisdictionQuote!;
        const native = new RegExp(label.split("").map(char => /[a-z0-9\s]/i.test(char) ? char : "\\" + char).join(""), "i").exec(text)?.[0];
        if (!native) continue;
        const ownRoute = { ...route, url, jurisdictionQuote: native };
        const read = await extractLocalElectionOffices(ownRoute, source);
        const hours = read.offices.find(row => row.fields.hours);
        documents.push(read.document);
        discoveredRoutes.push(ownRoute);
        if (!hours) continue;
        offices.set(office.id, mergeLocalElectionOfficeRows(offices.get(office.id), hours));
        successfulReads++; found = true; break;
      }
      if (!found) blanks.push({ id: `${office.id}:hours:own-page`, divisionId: office.divisionId, officeId: office.id, field: "hours", reason: "The local office's election or clerk pages checked have no acquired office-hours section.", sourceUrl: route.url, status: "OPEN" });
    } catch (error) {
      blanks.push({ id: `${office.id}:hours:own-page`, divisionId: office.divisionId, officeId: office.id, field: "hours", reason: error instanceof Error ? error.message : String(error), sourceUrl: route.url, status: "OPEN" });
    }
  }
  if (input.doors && discoveredRoutes.length) await saveLocalElectionOfficeRoutes(input.doors, state, [...routes, ...discoveredRoutes], now());
  const latestDocuments = [...new Map(documents.map(document => [`${document.url}:${document.documentHash}`, document])).values()];
  const { projection } = prepareLocalElectionOfficeProjection({ projection: { formatVersion: 1, state, checkedAt: now(), offices: [...offices.values()], blanks }, documents: latestDocuments, previous: previous?.payload });
  const ready = projection.offices;
  const uniqueDocuments = referencedLocalElectionOfficeDocuments(projection, latestDocuments);
  let published = null;
  if (ready.length && successfulReads) {
    const candidate = await localElectionOfficesCandidate({ vault: input.vault, projection, documents: uniqueDocuments, previous: previous?.payload });
    const outcome = await processRegisteredRoutineCandidate(input.store, contractId, candidate, now());
    published = { candidate, outcome };
    if (failures.length === 0) return { candidate, outcome, projection, failures, published };
  }
  const candidate = failedAcquisitionCandidate({ sourceId: LOCAL_ELECTION_OFFICES_SOURCE_ID, recordClass: LOCAL_ELECTION_OFFICES_RECORD_CLASS, scope,
    requestedUrl: routes[0]?.url ?? "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/",
    attemptedAt: at, failureDetail: failures.map(row => `${row.route}: ${row.reason}`).join("\n") || "No state-published local election-office acquisition routes are registered.", parserVersion: LOCAL_ELECTION_OFFICES_PARSER_VERSION });
  const outcome = await processRegisteredRoutineCandidate(input.store, contractId, candidate, now());
  return { candidate, outcome, projection, failures, published };
}
