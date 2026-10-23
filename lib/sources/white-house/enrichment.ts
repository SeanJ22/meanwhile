import { createHash } from "node:crypto";
import type { Officeholder, OfficeholderSet } from "../../officials/types.ts";
import { withExecutiveCompleteness, mergeExecutiveFacts } from "../../officials/national-executive.ts";
import { whiteHouseOffice } from "../../officials/white-house-offices.ts";
import { mergePeopleSets } from "../../officials/merge-people.ts";
import { acquireKnownRelease, knownReleaseSourceCheck, resolveKnownReleaseCache, type KnownReleaseOptions, type KnownRelease } from "../known-release.ts";
import { pacedPortraitAcquire } from "../../photos/portrait-work.ts";
import { statePeoplePortraits, type StatePeopleAcquisition } from "../../civic-data/state-people-publication.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { parseExecutiveProfile, parseExecutiveElectionParty, parseExecutiveTerm, EXECUTIVE_TERM_SOURCES, executiveProfileLinks,
  executiveOfficeSources, executiveDirectoryLinks, executiveContactLinks, parseExecutiveOfficeChannels, parseCabinetTenure, CABINET_TENURE_SOURCE_URL,
  inaugurationLinks, INAUGURATION_INDEX_URL } from "./profile.ts";
import { acquirePresidentialRecords } from "./presidential-records.ts";
import { acquireCabinetRecords, acquireOpmHeadcounts, cabinetDepartment, currentOpmRelease, OPM_EMPLOYMENT_URL } from "./cabinet-records.ts";

type Acquired = { roster: OfficeholderSet; acquisitions: readonly StatePeopleAcquisition[]; gaps: readonly { sourceUrl: string; detail: string }[]; releaseId: string };
type PublisherRequest = { readonly method: "POST"; readonly body: Readonly<Record<string, unknown>> };
export interface ExecutiveEnrichmentOptions extends Pick<KnownReleaseOptions, "store" | "locks" | "fetchImpl" | "now"> {
  readonly signal: AbortSignal;
  readonly heldPeople?: OfficeholderSet;
  readonly acquire?: typeof acquireKnownRelease;
  readonly portraits?: typeof statePeoplePortraits;
  /** Source-verified profile facts reach readers before the larger activity crawl finishes. */
  readonly onProfiles?: (release: Acquired) => Promise<void>;
}

/** Merge profile patches without erasing facts independently supplied by another official page. */
export function applyExecutivePatch(person: Officeholder, patch: Partial<Officeholder>): Officeholder {
  const next = { ...person, ...patch, fieldSources: { ...person.fieldSources, ...patch.fieldSources } };
  if (patch.termStart || patch.termEnd) next.memberships = person.memberships?.map(row => row.current === false ? row : {
    ...row, ...(patch.termStart ? { termStart: patch.termStart } : {}), ...(patch.termEnd ? { termEnd: patch.termEnd } : {}),
  });
  return next;
}

/** A 304 checks the fact again without changing the vintage of its saved bytes. */
export function checkedExecutivePerson(person: Officeholder, captures: readonly StatePeopleAcquisition[]): Officeholder {
  const checks = new Map(captures.map(page => [`${page.finalUrl}|${page.retrievedAt}`, page.sourceCheck?.checkedAt ?? page.retrievedAt]));
  const checked = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(checked);
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    const copy = Object.fromEntries(Object.entries(row).map(([key, child]) => [key, checked(child)]));
    if (typeof row.sourceUrl === "string" && typeof row.collectedAt === "string") {
      const source = typeof row.evidenceSourceUrl === "string" ? row.evidenceSourceUrl : row.sourceUrl;
      copy.checkedAt = checks.get(`${source}|${row.collectedAt}`) ?? row.checkedAt ?? row.collectedAt;
    }
    return copy;
  };
  return { ...person, executive: checked(person.executive) as Officeholder["executive"],
    fieldSources: Object.fromEntries(Object.entries(person.fieldSources ?? {}).map(([field, source]) => [field, {
      ...source, verifiedAt: checks.get(`${source.sourceUrl}|${source.collectedAt}`) ?? source.verifiedAt,
    }])),
  };
}

/** Replay held White House bytes first, then fill only the remaining fields from official publishers. */
export async function enrichNationalExecutives<T extends Acquired>(base: T, options: ExecutiveEnrichmentOptions): Promise<T> {
  const acquire = options.acquire ?? pacedPortraitAcquire;
  const releases = new Map<string, Promise<KnownRelease>>();
  const captures = new Map(base.acquisitions.map(page => [`${page.finalUrl}|${page.retrievedAt}`, page]));
  const gaps = [...base.gaps];
  const failed = (url: string, error: unknown) => {
    options.signal.throwIfAborted();
    gaps.push({ sourceUrl: url, detail: `NATIONAL_EXECUTIVE_GAP:${error instanceof Error ? error.message : String(error)}` });
  };
  const readRelease = (url: string, request?: PublisherRequest): Promise<KnownRelease> => {
    if (!isOfficialSource(url) || new URL(url).protocol !== "https:") throw new Error("EXECUTIVE_OFFICIAL_SOURCE_REQUIRED");
    const requestKey = request ? createHash("sha256").update(JSON.stringify(request)).digest("hex") : "";
    const cacheKey = `${url}|${requestKey}`;
    let pending = releases.get(cacheKey);
    if (!pending) {
      pending = acquire({ ...options, sourceId: "statewide-executive-sources", releaseId: `official:${url}${requestKey ? `:${requestKey}` : ""}`, url,
        ...(request ? { fetchImpl: ((resource, init) => (options.fetchImpl ?? fetch)(resource, { ...init, method: request.method, body: JSON.stringify(request.body) })) as typeof fetch } : {}),
        parserVersion: "national-executive/1", maxBytes: 16 * 1024 * 1024, checkAfterMs: 86_400_000,
        allowedHosts: [new URL(url).hostname], headers: { accept: "text/html,application/json,application/xml",
          ...(request ? { "content-type": "application/json" } : {}),
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          ...(new URL(url).hostname === "api.congress.gov" && process.env.CONGRESS_API_KEY ? { "X-Api-Key": process.env.CONGRESS_API_KEY } : {}),
        } });
      releases.set(cacheKey, pending);
    }
    return pending;
  };
  const read = async (url: string, request?: PublisherRequest) => {
    // The roster has just read these pages; never fetch them again under another source key.
    const held = [...captures.values()].find(page => page.finalUrl === url && JSON.stringify(page.request) === JSON.stringify(request));
    if (held) return { url: held.finalUrl, body: held.body, retrievedAt: held.retrievedAt, ...(held.request ? { request: held.request } : {}) };
    const release = await readRelease(url, request);
    const page: StatePeopleAcquisition = { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
      body: new TextDecoder("utf-8", { fatal: true }).decode(release.bytes), retrievedAt: release.retrievedAt,
      rawHash: release.sha256, sourceCheck: knownReleaseSourceCheck(release), ...(request ? { request } : {}) };
    captures.set(`${page.finalUrl}|${page.retrievedAt}|${JSON.stringify(request) ?? ""}`, page);
    return { url: page.finalUrl, body: page.body, retrievedAt: page.retrievedAt, ...(page.request ? { request: page.request } : {}) };
  };
  const profilePage = (page: { url: string; body: string; retrievedAt: string }) => ({ ...page, html: page.body });
  const prior = new Map(options.heldPeople?.officeholders.map(person => [person.id, person]));
  let people = base.roster.officeholders.map(person => {
    const held = prior.get(person.id);
    return held && held.officeTitle === person.officeTitle ? mergePeopleSets([
      { ...base.roster, officeholders: [held], divisions: [] }, { ...base.roster, officeholders: [person], divisions: [] },
    ])!.officeholders[0] : person;
  });
  const parseProfile = (person: Officeholder, page: { url: string; body: string; retrievedAt: string }) => {
    const result = parseExecutiveProfile({ person, page: profilePage(page) });
    const next = applyExecutivePatch(person, result.patch);
    return { ...next, executive: { ...next.executive,
      ...(result.biography ? { biography: result.biography } : {}),
      ...(result.termEndDescription ? { termEndDescription: result.termEndDescription } : {}),
      ...(result.priorOffices.length ? { priorOffices: result.priorOffices } : {}),
    } };
  };
  // Every Cabinet member's biography and portrait is already on the one captured Cabinet page.
  people = people.map(person => {
    const held = [...captures.values()].find(page => page.finalUrl === person.provenance.sourceUrl);
    if (!held) return person;
    try { return parseProfile(person, { url: held.finalUrl, body: held.body, retrievedAt: held.retrievedAt }); }
    catch (error) { failed(held.finalUrl, error); return person; }
  });
  const elected = people.filter(person => ["president", "vice-president"].includes(whiteHouseOffice(person.officeTitle) ?? ""));
  if (elected.length) {
    const termPages = await Promise.allSettled([EXECUTIVE_TERM_SOURCES.inauguration, EXECUTIVE_TERM_SOURCES.schedule, EXECUTIVE_TERM_SOURCES.amendment, EXECUTIVE_TERM_SOURCES.election].map(url => read(url)));
    let inaugurationAlternatives: Awaited<ReturnType<typeof read>>[] = [];
    if (termPages.slice(0, 3).every(row => row.status === "fulfilled")) {
      const pages = termPages.map(row => row.status === "fulfilled" ? profilePage(row.value) : null);
      if (elected.some(person => { try { parseExecutiveTerm({ person, inauguration: pages[0]!, schedule: pages[1]!, amendment: pages[2]! }); return false; } catch { return true; } })) {
        try {
          const links = inaugurationLinks(profilePage(await read(INAUGURATION_INDEX_URL)));
          const alternatives = await Promise.allSettled(links.map(url => read(url)));
          inaugurationAlternatives = alternatives.flatMap(row => row.status === "fulfilled" ? [row.value] : []);
        } catch (error) { failed(INAUGURATION_INDEX_URL, error); }
      }
    }
    people = people.map(person => {
      if (!elected.some(row => row.id === person.id)) return person;
      let next = person;
      try {
        if (termPages.slice(0, 3).some(row => row.status !== "fulfilled")) throw new Error("EXECUTIVE_TERM_SOURCE_UNAVAILABLE");
        const pages = termPages.map(row => row.status === "fulfilled" ? profilePage(row.value) : null);
        let patch: Partial<Officeholder> | undefined;
        for (const page of [pages[0]!, ...inaugurationAlternatives.map(profilePage)]) {
          try { patch = parseExecutiveTerm({ person, inauguration: page, schedule: pages[1]!, amendment: pages[2]! }); break; } catch { /* Try the current source's other published ceremony. */ }
        }
        if (!patch) throw new Error("EXECUTIVE_CURRENT_INAUGURATION_UNRESOLVED");
        next = applyExecutivePatch(next, patch);
      } catch (error) { failed(EXECUTIVE_TERM_SOURCES.inauguration, error); }
      try { if (termPages[3].status === "fulfilled") next = applyExecutivePatch(next, parseExecutiveElectionParty(person, profilePage(termPages[3].value))); }
      catch (error) { failed(EXECUTIVE_TERM_SOURCES.election, error); }
      return next;
    });
  }
  let tenure: Awaited<ReturnType<typeof read>> | undefined;
  try { if (people.some(person => whiteHouseOffice(person.officeTitle)?.startsWith("cabinet:"))) tenure = await read(CABINET_TENURE_SOURCE_URL); }
  catch (error) { failed(CABINET_TENURE_SOURCE_URL, error); }
  // Read direct official profile links already held before seeking a new directory.
  people = await Promise.all(people.map(async person => {
    let next = person;
    if (tenure && whiteHouseOffice(person.officeTitle)?.startsWith("cabinet:")) try {
      const termEndDescription = parseCabinetTenure(person, profilePage(tenure));
      next = { ...next, executive: { ...next.executive, termEndDescription }, fieldSources: { ...next.fieldSources,
        termNote: { sourceUrl: termEndDescription.sourceUrl, sourceOrg: "United States Government Manual", collectedAt: termEndDescription.collectedAt, verifiedAt: termEndDescription.collectedAt, quote: termEndDescription.text } } };
    } catch (error) { failed(tenure.url, error); }
    const leads = new Set(person.profileUrls ?? []);
    for (const page of captures.values()) {
      if (!isOfficialSource(page.finalUrl)) continue;
      for (const url of executiveProfileLinks(person, { url: page.finalUrl, html: page.body, retrievedAt: page.retrievedAt })) leads.add(url);
    }
    for (const url of leads) {
      if (url === person.provenance.sourceUrl || !isOfficialSource(url)) continue;
      try { next = parseProfile(next, await read(url)); } catch (error) { failed(url, error); }
    }
    for (const url of executiveOfficeSources(person.officeTitle)) {
      try {
        const page = await read(url), directory = profilePage(page);
        const pages = [directory];
        for (const link of executiveDirectoryLinks(directory)) {
          try { pages.push(profilePage(await read(link))); } catch (error) { failed(link, error); }
        }
        for (const directoryPage of pages) for (const profile of executiveProfileLinks(person, directoryPage)) {
          try { next = parseProfile(next, await read(profile)); } catch (error) { failed(profile, error); }
        }
        const contacts = [...new Set(pages.flatMap(executiveContactLinks))];
        for (const contact of [url, ...contacts]) {
          try {
            const channels = parseExecutiveOfficeChannels({ person, profileUrl: url, page: profilePage(await read(contact)), departmentName: cabinetDepartment(person.officeTitle)?.name });
            next = applyExecutivePatch(next, channels.patch);
            if (channels.sharedSocial.length) next = { ...next, executive: { ...next.executive,
              officeSocial: [...new Map([...(next.executive?.officeSocial ?? []), ...channels.sharedSocial].map(row => [row.url, row])).values()] } };
          } catch (error) { failed(contact, error); }
        }
      } catch (error) { failed(url, error); }
    }
    return next;
  }));
  const portraits = await (options.portraits ?? statePeoplePortraits)({ roster: { ...base.roster, officeholders: people }, state: "US", signal: options.signal, now: options.now?.() }, {
    now: options.now, acquire: async request => readRelease(request.url),
  });
  people = portraits.roster.officeholders;
  for (const gap of portraits.excludedFacts) gaps.push({ sourceUrl: "https://www.whitehouse.gov/administration/", detail: `${gap.code}:${gap.detail}` });
  if (options.onProfiles) {
    const acquisitions = [...captures.values()];
    await options.onProfiles({ roster: { ...base.roster, officeholders: people.map(person => withExecutiveCompleteness(checkedExecutivePerson(person, acquisitions))) }, acquisitions, gaps: [...gaps],
      releaseId: createHash("sha256").update(acquisitions.map(row => row.rawHash ?? row.body).join("|")).digest("hex") });
  }
  const president = people.find(person => whiteHouseOffice(person.officeTitle) === "president");
  const vicePresident = people.find(person => whiteHouseOffice(person.officeTitle) === "vice-president");
  const activity = await acquirePresidentialRecords({ ...options, acquire,
    ...(president?.termStart ? { president: { person: president,
      congresses: [...new Set([Number(president.termStart.slice(0, 4)), Number((options.now?.() ?? new Date().toISOString()).slice(0, 4))].map(year => Math.floor((year - 1789) / 2) + 1))],
      fecCandidateId: president.fecCandidateIds?.find(id => id.startsWith("P")) } } : {}),
    ...(vicePresident?.termStart ? { vicePresident } : {}),
  });
  for (const page of activity.captures) captures.set(`${page.finalUrl}|${page.retrievedAt}`, page);
  gaps.push(...activity.gaps);
  people = people.map(person => {
    if (person.id !== president?.id && person.id !== vicePresident?.id) return person;
    const records = activity.records.filter(row => row.personId === person.id);
    const coverage = person.id === president?.id ? Object.fromEntries(Object.entries(activity.coverage).filter(([key]) => key !== "tieBreakingVotes")) : { tieBreakingVotes: activity.coverage.tieBreakingVotes };
    const resolved = person.id === president?.id && activity.fecIdentity ? applyExecutivePatch(person, {
      fecCandidateIds: [...new Set([...(person.fecCandidateIds ?? []), activity.fecIdentity.candidateId])],
      nativeIds: { ...person.nativeIds, fec: [...new Set([...(person.nativeIds?.fec ?? []), activity.fecIdentity.candidateId])] },
      fieldSources: { fecCandidateIds: { sourceUrl: activity.fecIdentity.evidenceSourceUrl, sourceOrg: "Federal Election Commission", collectedAt: activity.fecIdentity.collectedAt, verifiedAt: activity.fecIdentity.collectedAt, quote: activity.fecIdentity.quote } },
    }) : person;
    return { ...resolved, executive: { ...resolved.executive, coverage: { ...resolved.executive?.coverage, ...coverage },
      records: [...new Map([...(person.executive?.records ?? []), ...records].map(row => [row.id, row])).values()],
      ...(person.id === president?.id && activity.money ? { money: activity.money } : {}),
    } };
  });
  let opm: Awaited<ReturnType<typeof acquireOpmHeadcounts>> | undefined;
  try { if (people.some(person => cabinetDepartment(person.officeTitle))) {
    const release = currentOpmRelease(await read(OPM_EMPLOYMENT_URL));
    const { store } = await resolveKnownReleaseCache(options);
    const snapshotKey = `project/freshness/source/statewide-executive-sources/opm/${createHash("sha256").update(release.url).digest("hex")}/snapshot-v1.json`;
    const held = await store.get(snapshotKey);
    if (held) opm = JSON.parse(new TextDecoder().decode(held.bytes));
    else {
    opm = await acquireOpmHeadcounts({ read, fetchImpl: options.fetchImpl, signal: options.signal, now: options.now,
      saveRange: async (url, range, byteLength, retrievedAt) => {
      const key = `project/freshness/source/statewide-executive-sources/opm/${range.sha256}.parquet-range`;
      await store.put(key, range.bytes, { contentType: "application/octet-stream", contentHash: `sha256-${range.sha256}`,
        byteLength: range.bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
      const reference = new TextEncoder().encode(JSON.stringify({ url, byteLength, start: range.start, end: range.end, key, sha256: range.sha256, retrievedAt }));
      await store.put(`${key}.${createHash("sha256").update(reference).digest("hex")}.json`, reference, { contentType: "application/json", contentHash: `sha256-${createHash("sha256").update(reference).digest("hex")}`,
        byteLength: reference.byteLength, objectClass: "IMMUTABLE_BODY" });
      },
    });
    const bytes = new TextEncoder().encode(JSON.stringify(opm));
    await store.put(snapshotKey, bytes, { contentType: "application/json", contentHash: `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
      byteLength: bytes.byteLength, objectClass: "IMMUTABLE_BODY" });
    }
  } }
  catch (error) { failed("https://data.opm.gov/api/v1/files/employment?current=true", error); }
  people = await Promise.all(people.map(async person => {
    if (!whiteHouseOffice(person.officeTitle)?.startsWith("cabinet:")) return person;
    const cabinet = await acquireCabinetRecords({ person, read, opm, signal: options.signal,
      biographyPages: [...captures.values()].filter(page => page.finalUrl === person.provenance.sourceUrl || person.profileUrls?.includes(page.finalUrl)).map(page => ({ url: page.finalUrl, body: page.body, retrievedAt: page.retrievedAt })) });
    for (const detail of cabinet.gaps) gaps.push({ sourceUrl: person.provenance.sourceUrl!, detail });
    return { ...person, executive: mergeExecutiveFacts(person.executive, { cabinet, coverage: cabinet.coverage }) };
  }));
  const roster = { ...base.roster, officeholders: people };
  const acquisitions = [...captures.values()];
  return { ...base, roster: { ...roster, officeholders: people.map(person => withExecutiveCompleteness(checkedExecutivePerson(person, acquisitions))) }, acquisitions, gaps,
    releaseId: createHash("sha256").update(acquisitions.map(row => row.rawHash ?? row.body).join("|")).digest("hex") };
}
