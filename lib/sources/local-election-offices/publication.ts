import { normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import { sourceText } from "../../ballot/voting-source-tables.ts";
import { isPostalOnlyAddress } from "./address.ts";
import { cadenceMsAt } from "../../civic-data/contracts.ts";
import { civicRecordsFor } from "../../civic-data/changes.ts";
import { holdRawCapture, readRawCaptureText, type RawCaptureRef } from "../../civic-data/raw-capture-vault.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { isOfficialSource, type OfficialLinkingPage } from "../../civic-data/source-authority.ts";
import { stateOfficeLinkingPage, stateOfficesForStates } from "../../reference/state-offices.ts";
import { assertLocalElectionOfficeFile, LOCAL_ELECTION_OFFICE_FIELDS, type LocalElectionOffice, type LocalElectionOfficeBlank, type LocalElectionOfficeFile, type LocalElectionOfficeSource } from "./model.ts";
import { localOfficeQuoteAppears, localOfficeValueAppears, type LocalElectionOfficeDocument } from "./extraction.ts";
import { LOCAL_ELECTION_OFFICES_CADENCE, LOCAL_ELECTION_OFFICES_PARSER_VERSION, LOCAL_ELECTION_OFFICES_RECORD_CLASS, LOCAL_ELECTION_OFFICES_SOURCE_ID, localElectionOfficesScope } from "./targets.ts";

export interface HeldLocalElectionOfficeDocument {
  readonly url: string;
  readonly contentType: string;
  readonly checkedAt: string;
  readonly rawCapture: RawCaptureRef;
  readonly transcription: RawCaptureRef;
}
export interface LocalElectionOfficePayload {
  readonly projection: LocalElectionOfficeFile;
  readonly documents: readonly HeldLocalElectionOfficeDocument[];
}

export async function readLocalElectionOfficeDocuments(vault: EvidenceStore, held: readonly HeldLocalElectionOfficeDocument[]): Promise<LocalElectionOfficeDocument[]> {
  return Promise.all(held.map(async source => {
    const object = await vault.get(source.rawCapture.vaultKey);
    if (!object || object.bytes.length !== source.rawCapture.byteLength || sha256(object.bytes) !== source.rawCapture.rawHash) throw new Error(`Local election-office saved page is missing or corrupt: ${source.url}.`);
    return { url: source.url, contentType: source.contentType, checkedAt: source.checkedAt, bytes: object.bytes,
      documentHash: source.rawCapture.rawHash, text: await readRawCaptureText(vault, source.transcription) };
  }));
}

const authorityCache = new WeakMap<readonly LocalElectionOfficeDocument[], Map<string, OfficialLinkingPage[]>>();
const jurisdiction = (value: string) => value.toLowerCase().replace(/^(?:county|town|city|village|township)\s+of\s+/i, "").replace(/\s+(?:county|parish|borough|census area|municipality)$/i, "").replace(/&/g, "and").replace(/\bst\.?\s+/g, "saint ").replace(/[^a-z0-9]/g, "");
function authorityPages(state: string, documents: readonly LocalElectionOfficeDocument[]): OfficialLinkingPage[] {
  const existing = authorityCache.get(documents)?.get(state);
  if (existing) return existing;
  const pages: OfficialLinkingPage[] = stateOfficesForStates([state]).filter(office => office.kind === "ELECTION_OFFICE").map(stateOfficeLinkingPage);
  const pending = [...documents];
  for (let pass = 0; pass <= documents.length && pending.length; pass++) {
    let progress = false;
    for (let at = pending.length - 1; at >= 0; at--) {
      const document = pending[at];
      const parent = pages.find(page => isOfficialSource(document.url, page));
      if (!isOfficialSource(document.url) && !parent) continue;
      pages.push({ url: document.url, html: new TextDecoder().decode(document.bytes), ...(parent ? { linkingPage: parent } : {}) });
      pending.splice(at, 1); progress = true;
    }
    if (!progress) break;
  }
  const byState = authorityCache.get(documents) ?? new Map<string, OfficialLinkingPage[]>();
  byState.set(state, pages); authorityCache.set(documents, byState);
  return pages;
}

/** Keep the current field pages and the official links establishing their authority; older raw bytes remain in the vault. */
export function referencedLocalElectionOfficeDocuments(projection: LocalElectionOfficeFile, documents: readonly LocalElectionOfficeDocument[]): LocalElectionOfficeDocument[] {
  const sources = projection.offices.flatMap(office => [office.directorySource, ...Object.values(office.fields)]).filter((source): source is LocalElectionOfficeSource => !!source);
  const keys = new Set(sources.map(source => `${source.sourceUrl}:${source.documentHash}`));
  const latest = new Map<string, LocalElectionOfficeDocument>();
  for (const document of documents) if (!latest.has(document.url) || document.checkedAt >= latest.get(document.url)!.checkedAt) latest.set(document.url, document);
  for (const office of projection.offices) {
    const directory = latest.get(office.directoryUrl);
    if (directory) keys.add(`${directory.url}:${directory.documentHash}`);
  }
  const pages = authorityPages(projection.state, documents);
  for (const source of sources) {
    if (isOfficialSource(source.sourceUrl)) continue;
    let parent = pages.find(page => isOfficialSource(source.sourceUrl, page));
    const seen = new Set<string>();
    while (parent && !seen.has(parent.url)) {
      seen.add(parent.url);
      const document = latest.get(parent.url);
      if (document) keys.add(`${document.url}:${document.documentHash}`);
      parent = parent.linkingPage ?? undefined;
    }
  }
  return [...new Map(documents.filter(document => keys.has(`${document.url}:${document.documentHash}`)).map(document => [`${document.url}:${document.documentHash}`, document])).values()];
}

const verifiedDocumentHashes = new WeakSet<LocalElectionOfficeDocument>();
function verifySource(source: LocalElectionOfficeSource, documents: readonly LocalElectionOfficeDocument[]): LocalElectionOfficeDocument {
  if (!source.publisher?.trim() || !source.quote?.trim() || !/^[a-f0-9]{64}$/.test(source.documentHash) || !Number.isFinite(Date.parse(source.checkedAt))) throw new Error(`Local election-office source metadata is invalid: ${source.sourceUrl}.`);
  const document = documents.find(document => document.url === source.sourceUrl && document.documentHash === source.documentHash);
  if (document && !verifiedDocumentHashes.has(document)) {
    if (sha256(document.bytes) !== document.documentHash) throw new Error(`Local election-office source bytes differ from their saved hash: ${source.sourceUrl}.`);
    verifiedDocumentHashes.add(document);
  }
  if (!document || Date.parse(source.checkedAt) > Date.parse(document.checkedAt) || !localOfficeQuoteAppears(document, source.quote)) throw new Error(`Local election-office quote is not in its saved dated document: ${source.sourceUrl}.`);
  return document;
}

export function verifyLocalElectionOfficeEvidence(office: LocalElectionOffice, documents: readonly LocalElectionOfficeDocument[], field?: typeof LOCAL_ELECTION_OFFICE_FIELDS[number] | "directory", freshness?: { readonly at: string; readonly previous?: LocalElectionOffice }): void {
  const prefix = `ocd-division/country:us/${office.state === "DC" ? "district" : "state"}:${office.state.toLowerCase()}`;
  if (!office.id || !/^[A-Z]{2}$/.test(office.state) || !(office.divisionId === prefix || office.divisionId.startsWith(`${prefix}/`))) throw new Error(`Local election-office scope is invalid: ${office.id}.`);
  const pages = authorityPages(office.state, documents);
  const membership = office.directorySource;
  if (!membership) throw new Error(`Local election-office has no state-directory row: ${office.id}.`);
  verifySource(membership, documents);
  const landing = documents.filter(document => document.url === office.directoryUrl).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (!landing) throw new Error(`Local election-office state directory landing page has not been saved: ${office.id}/${office.directoryUrl}.`);
  if (membership.sourceUrl !== office.directoryUrl) {
    const host = (value: string) => new URL(value).hostname.replace(/^www\./, "");
    const directoryHost = host(office.directoryUrl), sourceHost = host(membership.sourceUrl);
    const publisher = directoryHost === sourceHost || directoryHost.endsWith(`.${sourceHost}`) || sourceHost.endsWith(`.${directoryHost}`) || directoryHost.endsWith(".gov") && sourceHost.endsWith(".gov") && directoryHost.split(".").slice(-2).join(".") === sourceHost.split(".").slice(-2).join(".");
    let linked = false;
    for (const link of new TextDecoder().decode(landing.bytes).matchAll(/\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)) {
      try { if (host(new URL(link[1].replace(/&amp;/g, "&"), office.directoryUrl).href) === sourceHost) linked = true; } catch { /* An invalid link supplies no directory provenance. */ }
    }
    if (!publisher && !linked) throw new Error(`Local election-office membership source has no captured state-directory link or publisher route: ${office.id}/${membership.sourceUrl}.`);
  }
  const label = (office.directoryJurisdiction ?? office.town ?? office.countyName ?? "").replace(/^(?:Town|City|Village|Township) of\s+/i, "").replace(/\s+(?:County|Parish|Borough|Census Area|Municipality)$/i, "");
  if (label && !jurisdiction(sourceText(membership.quote)).includes(jurisdiction(label))) throw new Error(`Local election-office directory row belongs to another jurisdiction: ${office.id}.`);
  for (const excluded of office.excludedMunicipalities ?? []) {
    if (!excluded.name?.trim() || !excluded.divisionId.startsWith(`${prefix}/`) || !/\/(?:place|cousub):/.test(excluded.divisionId)) throw new Error(`Local election-office municipal exclusion belongs to another scope: ${office.id}.`);
    const name = excluded.name.split("").map(char => /[a-z0-9\s]/i.test(char) ? char : "\\" + char).join("");
    const exception = new RegExp(`\\b(?:other\\s+than|except(?:\\s+for)?|excluding|outside(?:\\s+of)?)\\s+(?:the\\s+)?(?:(?:city|town|village|township)\\s+of\\s+)?${name}(?=\\W|$)`, "i");
    if (!exception.test(sourceText(membership.quote))) throw new Error(`Local election-office municipal exclusion has no explicit saved directory exception: ${office.id}/${excluded.name}.`);
  }
  if (!pages.some(page => isOfficialSource(membership.sourceUrl, page)) || !pages.some(page => isOfficialSource(office.directoryUrl, page))) throw new Error(`Local election-office directory has no official source link: ${office.id}.`);
  const fresh = (source: LocalElectionOfficeSource, prior?: LocalElectionOfficeSource, sameValue = true) => {
    if (!freshness) return;
    const age = Date.parse(freshness.at) - Date.parse(source.checkedAt), every = cadenceMsAt({ cadence: LOCAL_ELECTION_OFFICES_CADENCE }, Date.parse(freshness.at));
    const retained = sameValue && prior?.sourceUrl === source.sourceUrl && prior.documentHash === source.documentHash && prior.checkedAt === source.checkedAt;
    if (age < 0 || age > every && !retained) throw new Error(`Local election-office newly introduced source is outside its freshness window: ${office.id}/${source.sourceUrl}.`);
  };
  fresh(membership, freshness?.previous?.directorySource);
  if (field === "directory") return;
  const linkedHost = (url: string, source: LocalElectionOfficeSource, field: typeof LOCAL_ELECTION_OFFICE_FIELDS[number]) => {
    const host = (value: string) => new URL(value).hostname.replace(/^www\./, "");
    if (host(url) === host(membership.sourceUrl)) return true;
    const website = office.website;
    if (website && host(url) === host(website) && office.fields.website?.sourceUrl === membership.sourceUrl) return true;
    for (const link of membership.quote.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
      try { if (host(new URL(link[1].replace(/&amp;/g, "&"), membership.sourceUrl).href) === host(url)) return true; } catch { /* An invalid directory link establishes no authority. */ }
    }
    // State directories often print only postal/telephone contacts. The local
    // government's own official page can establish its jurisdiction directly.
    const document = documents.find(document => document.url === url && document.documentHash === source.documentHash);
    if (document && source.jurisdictionQuote && localOfficeQuoteAppears(document, source.jurisdictionQuote) && jurisdiction(label) === jurisdiction(source.jurisdictionQuote) && pages.some(page => isOfficialSource(url, page))) return true;
    if (document && source.directoryWide && ["hours", "pollingPlaceLookup"].includes(field) && source.jurisdictionQuote && localOfficeQuoteAppears(document, source.jurisdictionQuote) && pages.some(page => isOfficialSource(url, page))) {
      const stateName = stateOfficesForStates([office.state]).find(contact => contact.kind === "ELECTION_OFFICE")?.stateName;
      if (stateName && jurisdiction(source.jurisdictionQuote).includes(jurisdiction(stateName))) return true;
    }
    return false;
  };
  for (const key of field ? [field] : LOCAL_ELECTION_OFFICE_FIELDS) {
    const value = office[key], source = office.fields[key];
    if (value === undefined && source === undefined) continue;
    if (value === undefined || !source) throw new Error(`Local election-office field has no corresponding saved source or value: ${office.id}/${key}.`);
    if (key === "address" && isPostalOnlyAddress(value)) throw new Error(`Local election-office source supplies a mailing box; the street address remains open: ${office.id}.`);
    verifySource(source, documents);
    fresh(source, freshness?.previous?.fields[key], freshness?.previous?.[key] === value);
    if (!localOfficeValueAppears(value, source.quote, source.sourceUrl)) throw new Error(`Local election-office field differs from its saved source: ${office.id}/${key}.`);
    if (source.sourceUrl === membership.sourceUrl && key !== "office" && !(source.directoryWide && ["hours", "pollingPlaceLookup"].includes(key)) && !localOfficeValueAppears(value, membership.quote, source.sourceUrl)) throw new Error(`Local election-office field comes from another directory row: ${office.id}/${key}.`);
    if (source.sourceUrl !== membership.sourceUrl && !linkedHost(source.sourceUrl, source, key)) throw new Error(`Local election-office field source does not establish this office's jurisdiction: ${office.id}/${key}.`);
  }
}

/** Invalid fields remain specific standing blanks; they never hold neighboring verified facts. */
export function prepareLocalElectionOfficeProjection(input: { readonly projection: LocalElectionOfficeFile; readonly documents: readonly LocalElectionOfficeDocument[]; readonly previous?: LocalElectionOfficeFile }): { projection: LocalElectionOfficeFile; issues: LocalElectionOfficeBlank[] } {
  const { projection, documents, previous } = input, ready: LocalElectionOffice[] = [], issues: LocalElectionOfficeBlank[] = [];
  for (const office of projection.offices) {
    const prior = previous?.offices.find(row => row.id === office.id), freshness = { at: projection.checkedAt, previous: prior };
    let checked = office;
    try {
      if (office.state !== projection.state) throw new Error("This office belongs to another state.");
      verifyLocalElectionOfficeEvidence(office, documents, "directory", freshness);
    } catch (error) {
      issues.push({ id: `${office.id}:directory:source`, divisionId: office.divisionId, officeId: office.id, field: "directory", reason: error instanceof Error ? error.message : String(error), status: "OPEN" });
      if (!prior) continue;
      checked = prior;
    }
    for (const field of LOCAL_ELECTION_OFFICE_FIELDS) {
      try { verifyLocalElectionOfficeEvidence(checked, documents, field, freshness); }
      catch (error) {
        const fields = { ...checked.fields }, facts = { ...checked };
        delete fields[field];
        if (field === "office") facts.office = "";
        else delete facts[field];
        if (prior?.[field] && prior.fields[field] && !(field === "address" && isPostalOnlyAddress(prior.address!))) { facts[field] = prior[field]!; fields[field] = prior.fields[field]; }
        checked = { ...facts, fields };
        issues.push({ id: `${office.id}:${field}:source`, divisionId: office.divisionId, officeId: office.id, field, reason: error instanceof Error ? error.message : String(error), status: "OPEN" });
      }
      if (!checked[field]) issues.push({ id: `${office.id}:${field}`, divisionId: office.divisionId, officeId: office.id, field, reason: "This field has not been acquired from the state directory or the office's own election page.", status: "OPEN" });
    }
    if (checked.office) ready.push(checked);
  }
  return { projection: { ...projection, offices: ready.sort((a, b) => a.id.localeCompare(b.id)), blanks: [...new Map([...(projection.blanks ?? []), ...issues].map(blank => [blank.id, blank])).values()] }, issues };
}

/** Each field is checked against the captured page that supplied it before the existing promotion path runs. */
export async function localElectionOfficesCandidate(input: { readonly vault: EvidenceStore; readonly projection: LocalElectionOfficeFile; readonly documents: readonly LocalElectionOfficeDocument[]; readonly previous?: LocalElectionOfficeFile }): Promise<RoutineCandidate> {
  const { projection, vault } = input, documents = referencedLocalElectionOfficeDocuments(projection, input.documents);
  assertLocalElectionOfficeFile(projection);
  for (const office of projection.offices) verifyLocalElectionOfficeEvidence(office, documents, undefined, { at: projection.checkedAt, previous: input.previous?.offices.find(prior => prior.id === office.id) });
  const held = await Promise.all(documents.map(async document => {
    const rawCapture = await holdRawCapture(vault, LOCAL_ELECTION_OFFICES_SOURCE_ID, document.bytes, document.contentType);
    if (rawCapture.rawHash !== document.documentHash) throw new Error(`Local election-office source changed while publication was being prepared: ${document.url}.`);
    return { url: document.url, contentType: document.contentType, checkedAt: document.checkedAt, rawCapture,
      transcription: await holdRawCapture(vault, LOCAL_ELECTION_OFFICES_SOURCE_ID, document.text, "text/plain") };
  }));
  const normalizedPayload: LocalElectionOfficePayload = { projection, documents: held };
  const scope = localElectionOfficesScope(projection.state), rawHash = normalizedHash(held.map(document => ({ url: document.url, hash: document.rawCapture.rawHash }))), count = projection.offices.length;
  const records = civicRecordsFor(LOCAL_ELECTION_OFFICES_RECORD_CLASS, projection);
  const route = projection.offices[0]?.directoryUrl ?? documents[0]?.url;
  const sourceThrough = projection.offices.flatMap(office => [office.directorySource?.checkedAt, ...Object.values(office.fields).map(source => source.checkedAt)]).filter((at): at is string => !!at).sort().at(-1)!;
  if (!route || count === 0) throw new Error("A local election-office candidate needs at least one directory-verified office.");
  return {
    id: `cv-${sha256(`${scope}:${rawHash}:${projection.checkedAt}:${normalizedHash(projection)}`).slice(0, 32)}`,
    sourceId: LOCAL_ELECTION_OFFICES_SOURCE_ID, recordClass: LOCAL_ELECTION_OFFICES_RECORD_CLASS, scope,
    sourceProjectionEvidence: sourceProjectionEvidence(LOCAL_ELECTION_OFFICES_SOURCE_ID, LOCAL_ELECTION_OFFICES_RECORD_CLASS, scope),
    retrieval: { succeeded: true, requestedUrl: route, finalUrl: route, httpStatus: 200, retrievedAt: sourceThrough, rawHash },
    normalization: { succeeded: true, parserVersion: LOCAL_ELECTION_OFFICES_PARSER_VERSION, schemaVersion: "local-election-offices/1", normalizedHash: normalizedHash(projection), normalizedPayloadHash: normalizedHash(normalizedPayload), inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: projection.offices.map(office => ({ subjectId: office.id, jurisdiction: `US-${office.state}`, identifiers: { office_id: office.id, division_id: office.divisionId }, matchBasis: "EXACT_SCOPED_ID", ambiguous: false })),
    temporal: { version: "current", expectedVersion: "current", sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "Directory-established local election-office contacts, with independently sourced office hours", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: `State-published county or municipal election-office directory for ${projection.state}; missing places and fields remain standing work`, returnedRecords: records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "Where can I vote; local office lookup", passed: true, detail: `${count} office names and each supplied field match their saved jurisdiction-specific source; ${projection.blanks?.length ?? 0} blanks stay open.` }],
    normalizedPayload, readModel: projection, civicRecords: records,
  };
}
