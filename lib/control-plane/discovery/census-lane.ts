import { knownRecipes, recordRecipeOutcome, recipeEntry, RECIPE_KIND } from "../../hunt/meetings-recipes.ts";
import { createHash } from "node:crypto";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { DEFAULT_USER_AGENT } from "../scheduler/route-executor.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { siteOrigins } from "../../hunt/meetings-site-discovery.ts";
import { accessControlIn } from "../../hunt/access-control.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import { recordAcquisition } from "../evidence/artifact.ts";
import { fieldManualEntryId, newFieldManualEntry, readFieldManual, writeFieldManual, type FieldManualEntry } from "../field-manual.ts";
import { searchCostEntry } from "./meetings-discovery-executor.ts";
import { requestPrice } from "../../hunt/discovery-search.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { discoveryFieldManualEntries, walkMeetingsDiscoveryNeed, type DiscoveryOpen, type DiscoveryRuntime } from "./meetings-discovery-executor.ts";
import { namesItself, routeHintsFor } from "../../hunt/meetings-route-hints.ts";
import { readDiscoveryRouteHints, routeHintEntriesBySubject } from "./route-hints.ts";
import { printedNames } from "./auto-crosswalk.ts";

export const CENSUS_LANE_INTERVAL_MS = 5 * 60_000;
const CHECK_MS = 12 * 3_600_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type CensusPage = Awaited<ReturnType<DiscoveryOpen>> & { url: string; artifactId: string };
type Repos = Pick<ControlPlaneRepositories, "fieldManual" | "discoveryAttempts" | "doors" | "boxFindings" | "scoutResults" | "workItems">;

export async function censusStateNotDue(repos: Pick<Repos, "fieldManual">, state: string, referenceSha256: string, now: string): Promise<boolean> {
  const row = await repos.fieldManual.readNarrowed(fieldManualEntryId("census-lane", state.toLowerCase()), { payload: ["nextCheck", "referenceSha256"] });
  const payload = (row?.value as { payload?: { nextCheck?: string; referenceSha256?: string } } | undefined)?.payload;
  return payload?.referenceSha256 === referenceSha256 && Date.parse(payload?.nextCheck ?? "") > Date.parse(now);
}

export function censusCheckEntry(need: MeetingsDiscoveryNeed, payload: unknown, now: string): FieldManualEntry {
  return newFieldManualEntry("census-check", need.jurisdictionId, { role: "SHARED", kind: "PLATFORM_CENSUS_CHECK",
    title: `${need.name} website check`, summary: "Official website and meeting-platform source checks",
    states: [need.stateCode.toLowerCase()], outcome: "REFERENCE", observedAt: now, payload });
}

export function censusReader(runtime: DiscoveryRuntime, subjectId: string) {
  const pages = new Map<string, Promise<CensusPage>>();
  const read = (url: string): Promise<CensusPage> => {
    if (pages.has(url)) return pages.get(url)!;
    const pending = (async () => {
      assertPublicUrl(url);
      await runtime.spaceOut(new URL(url).hostname);
      const got = await runtime.open({ url, headers: { "user-agent": DEFAULT_USER_AGENT, accept: "*/*" }, timeoutMs: runtime.timeoutMs ?? 20_000 });
      const at = runtime.now();
      const acquired = recordAcquisition({ canonicalUrl: url, retrievedAt: at, httpStatus: got.status ?? 0,
        contentType: got.contentType, sourceId: "platform-census", workItemId: `census:${subjectId}`,
        attemptId: `census:${subjectId}:${at}`, methodRouteId: "platform-census", permission: "ALLOWED",
        transport: got.transportError ? "OTHER_NAMED_FAILURE" : "REACHABLE" }, got.body);
      const stored = await runtime.vault(acquired.artifact, got.body);
      if (!stored.stored) throw new Error(`Census evidence not saved: ${stored.why}`);
      return { ...got, url, retrievedAt: at, artifactId: acquired.artifact.id };
    })();
    pages.set(url, pending);
    return pending;
  };
  const get = async (url: string): Promise<CensusPage | null> => {
    const seen = new Set<string>();
    for (let hops = 0; hops < 6; hops++) {
      if (seen.has(url)) return null;
      seen.add(url);
      await read(`${new URL(url).origin}/robots.txt`);
      const page = await read(url);
      if (page.status !== null && page.status >= 300 && page.status < 400 && page.location) {
        url = new URL(page.location, url).href;
        continue;
      }
      if (page.transportError || page.status === null || page.status < 200 || page.status >= 300 || accessControlIn({ status: page.status, text: page.body })) return null;
      return page;
    }
    return null;
  };
  const inventory = (url: string) => /\/bodies(?:[?]|$)|\/v1\/Categories(?:[?]|$)|\/Board\.nsf\/Public(?:[?]|$)|\/iCalendar\.aspx$|\/AgendaCenter(?:[/?]|$)|\/Public\/Organization\/\d+$|\/Citizens\/Calendar\.aspx$/i.test(url);
  const open: DiscoveryOpen = input => input.method === "POST" || (!pages.has(input.url) && !inventory(input.url))
    ? runtime.open(input) : read(input.url);
  return { get, open, pages };
}

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function exactDomainFor(need: MeetingsDiscoveryNeed, entries: readonly FieldManualEntry[]): FieldManualEntry | null {
  if (!need.city) return null;
  const matches = entries.filter(entry => {
    const row = entry.payload as { organization?: string; city?: string; state?: string } | null;
    return row?.state === need.stateCode.toUpperCase() && normalized(row.organization ?? "") === normalized(need.name) &&
      normalized(row.city ?? "") === normalized(need.city!) && entry.url;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function officialWebsiteQuery(need: MeetingsDiscoveryNeed): string {
  const county = (need.countyName ?? "").replace(/\s+County$/i, "");
  return `"${need.name}" ${county ? `${county} County ` : ""}${need.stateCode} official website`;
}

export function websiteNamesGovernment(html: string, need: MeetingsDiscoveryNeed): boolean {
  const text = normalized(html.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&"));
  const state = US_STATES.find(state => state.code === need.stateCode.toLowerCase())?.name;
  return text.includes(normalized(need.name)) && (new RegExp(`\\b${need.stateCode.toLowerCase()}\\b`).test(text) || Boolean(state && text.includes(normalized(state))));
}

async function saveStateDirectories(repos: Repos, need: MeetingsDiscoveryNeed, page: CensusPage, now: string): Promise<void> {
  if (need.govClass !== "STATE" || !new URL(page.url).hostname.endsWith(".gov")) return;
  const rows: FieldManualEntry[] = [];
  for (const link of page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = normalized(link[2].replace(/<[^>]*>/g, " "));
    if (!/local governments?|municipal|cities|towns/.test(label)) continue;
    const url = new URL(link[1].replace(/&amp;/g, "&"), page.url).href;
    rows.push(newFieldManualEntry("government-website-directory", url, { role: "SHARED", kind: "SOURCE_REGISTER", title: label,
      summary: `${need.stateCode} official government website directory`, states: [need.stateCode.toLowerCase()],
      recordClasses: ["government-websites"], outcome: "REFERENCE", observedAt: now, url,
      payload: { officialPageUrl: page.url, copyId: page.artifactId } }));
  }
  const saved = await writeFieldManual(repos, rows, now);
  if (saved.error) throw new Error(saved.error);
}

async function saveHost(repos: Repos, need: MeetingsDiscoveryNeed, page: CensusPage, source: string, now: string) {
  const host = new URL(page.url).hostname;
  const entry = newFieldManualEntry("entity-host", need.jurisdictionId, { role: "SHARED", kind: "ENTITY_HOST",
    title: need.name, summary: `${need.name} publishes at ${host}`, states: [need.stateCode.toLowerCase()],
    outcome: "YIELDED", url: new URL(page.url).origin, observedAt: now,
    payload: { jurisdictionId: need.jurisdictionId, govClass: need.govClass, countyFips: need.countyFips, host, source, copyId: page.artifactId, sourceUrl: page.url } });
  const saved = await writeFieldManual(repos, [entry], now);
  if (saved.error) throw new Error(saved.error);
}

function censusEntriesByGovernment(entries: readonly FieldManualEntry[]) {
  const index = new Map<string, FieldManualEntry[]>();
  const add = (key: string, entry: FieldManualEntry) => {
    const rows = index.get(key) ?? [];
    rows.push(entry);
    index.set(key, rows);
  };
  for (const entry of entries) {
    const row = entry.payload as { jurisdictionId?: string; name?: string; organization?: string; city?: string; state?: string;
      govClass?: string; countyFips?: string } | null;
    if (entry.kind === "ENTITY_HOST") {
      if (row?.jurisdictionId) add(row.jurisdictionId, entry);
      if (row?.govClass === "COUNTY" && row.countyFips) add(`county:${row.countyFips}`, entry);
    } else if (entry.kind === "PLATFORM_CENSUS_DOMAIN") {
      add(`domain:${row?.state}:${normalized(row?.organization ?? "")}:${normalized(row?.city ?? "")}`, entry);
    } else if (["NCES_WEBSITE", "GOVERNMENT_WEBSITE"].includes(entry.kind)) {
      if (row?.jurisdictionId) add(row.jurisdictionId, entry);
      add(`name:${normalized(row?.name ?? entry.title)}`, entry);
    } else if (entry.kind === "SOURCE_REGISTER" && entry.recordClasses.includes("government-websites")) add("directories", entry);
  }
  return (need: MeetingsDiscoveryNeed) => [...new Set([
    ...(index.get(need.jurisdictionId) ?? []), ...(index.get(`name:${normalized(need.name)}`) ?? []),
    ...(index.get(`domain:${need.stateCode.toUpperCase()}:${normalized(need.name)}:${normalized(need.city ?? "")}`) ?? []),
    ...(["SPECIAL DISTRICT", "SPECIAL_DISTRICT"].includes(need.govClass) ? index.get(`county:${need.countyFips}`) ?? [] : []),
    ...(index.get("directories") ?? []),
  ])];
}

export async function resolveCensusWebsite(input: { repos: Repos; need: MeetingsDiscoveryNeed; runtime: DiscoveryRuntime;
  entries: readonly FieldManualEntry[]; reader: ReturnType<typeof censusReader> }): Promise<MeetingsDiscoveryNeed> {
  const { need, entries, runtime, reader, repos } = input;
  const hintedSite = routeHintsFor(need.jurisdictionId, runtime.routeHints ?? [])?.officialSite;
  const saved = entries.find(entry => entry.kind === "ENTITY_HOST" && (entry.payload as { jurisdictionId?: string })?.jurisdictionId === need.jurisdictionId);
  const domain = exactDomainFor(need, entries.filter(entry => entry.kind === "PLATFORM_CENSUS_DOMAIN"));
  const directory = entries.filter(entry => ["NCES_WEBSITE", "GOVERNMENT_WEBSITE"].includes(entry.kind)).filter(entry => {
    const row = entry.payload as { jurisdictionId?: string; name?: string; city?: string } | null;
    return row?.jurisdictionId === need.jurisdictionId || normalized(row?.name ?? entry.title) === normalized(need.name);
  });
  const parent = need.govClass === "SPECIAL DISTRICT" || need.govClass === "SPECIAL_DISTRICT" ? entries.find(entry => {
    const row = entry.payload as { govClass?: string; countyFips?: string } | null;
    return entry.kind === "ENTITY_HOST" && row?.govClass === "COUNTY" && row.countyFips && row.countyFips === need.countyFips;
  }) : null;
  const addresses = [hintedSite?.origin, domain?.url, directory.length === 1 ? directory[0].url : null, saved?.url, need.ownWebAddress, parent?.url];
  for (const address of [...new Set(addresses.filter((address): address is string => Boolean(address)))]) {
    for (const origin of siteOrigins(address)) {
      const page = await reader.get(`${origin}/`);
      if (!page) continue;
      if (hintedSite?.origin === address && !namesItself(page.body, hintedSite.selfName)) continue;
      await saveStateDirectories(repos, need, page, runtime.now());
      await saveHost(repos, need, page, hintedSite?.origin === address ? "ROUTE_HINT" : domain?.url === address ? "CISA"
        : directory.some(entry => entry.url === address) ? "DIRECTORY" : "CENSUS", runtime.now());
      return { ...need, ownWebAddress: new URL(page.url).origin, addressSource: { source: "WEBSITE_EVIDENCE", versionId: page.artifactId } };
    }
  }
  for (const entry of entries.filter(entry => entry.kind === "SOURCE_REGISTER" && entry.recordClasses.includes("government-websites") && entry.url)) {
    const page = await reader.get(entry.url!);
    if (!page || !new URL(page.url).hostname.endsWith(".gov")) continue;
    for (const anchor of page.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = normalized(anchor[2].replace(/<[^>]*>/g, " "));
      if (!label.includes(normalized(need.name)) && !(need.city && label === normalized(need.city))) continue;
      const link = new URL(anchor[1].replace(/&amp;/g, "&"), page.url).href;
      const target = await reader.get(link);
      if (!target || !websiteNamesGovernment(target.body, need)) continue;
      await saveHost(repos, need, target, page.artifactId, runtime.now());
      return { ...need, ownWebAddress: new URL(target.url).origin, addressSource: { source: "WEBSITE_EVIDENCE", versionId: target.artifactId } };
    }
  }
  if (runtime.search) {
    const result = await runtime.search({ query: officialWebsiteQuery(need), ownSiteDomain: null });
    for (const request of result.requests) {
      if (request.status === "BUDGET_REFUSED") continue;
      const price = requestPrice(request.provider, request.status === "DELIVERED");
      await runtime.recordCost?.(searchCostEntry({ attemptId: `census-search:${need.jurisdictionId}:${runtime.now()}`,
        jurisdictionId: need.jurisdictionId, routeId: "government-website", host: price.price.host,
        usd: price.usd, bytes: request.bytes, recordedAt: runtime.now() }));
    }
    for (const hit of result.hits) {
      const page = await reader.get(hit.url);
      if (!page || !websiteNamesGovernment(page.body, need)) continue;
      const gov = new URL(page.url).hostname.endsWith(".gov");
      const official = gov || Boolean(await runtime.officialLinkingPageFor?.(page.url));
      if (!official) continue;
      await saveHost(repos, need, page, "SEARCH", runtime.now());
      return { ...need, ownWebAddress: new URL(page.url).origin, addressSource: { source: "WEBSITE_EVIDENCE", versionId: page.artifactId } };
    }
  }
  return { ...need, ownWebAddress: null };
}

interface CensusStateReport { nextCheck: string | null; state: string; checked: number; walked: number; unchanged: number; notDue: number; platforms: Record<string, number>;
  hintMeetings: { jurisdictionId: string; name: string; body: string; url: string; count: number }[]; failures: string[] }
export async function runCensusState(input: { repos: Repos; state: string; needs: readonly MeetingsDiscoveryNeed[];
  runtime: DiscoveryRuntime; entries?: readonly FieldManualEntry[]; concurrency?: number; onProgress?: (report: CensusStateReport) => void }): Promise<CensusStateReport> {
  const report: CensusStateReport = { nextCheck: null, state: input.state, checked: 0, walked: 0, unchanged: 0, notDue: 0, platforms: {}, hintMeetings: [], failures: [] };
  const markers = new Map((await input.repos.fieldManual.readMany(input.needs.map(need =>
    censusCheckEntry(need, null, input.runtime.now()).id))).map(row => [row.id, row.value.payload]));
  let scheduled = 0;
  let earliestNext = Infinity;
  const finish = () => {
    report.nextCheck = scheduled === input.needs.length && Number.isFinite(earliestNext) ? new Date(earliestNext).toISOString() : null;
    return report;
  };
  const due = input.needs.flatMap(original => {
    const marker = censusCheckEntry(original, null, input.runtime.now());
    const prior = markers.get(marker.id) as { nextCheck?: string; needHash?: string; inputHash?: string; pagesHash?: string; urls?: string[] } | undefined;
    const needHash = hash(original);
    if (prior?.needHash === needHash && Date.parse(prior.nextCheck ?? "") > Date.parse(input.runtime.now())) {
      report.notDue++;
      scheduled++;
      earliestNext = Math.min(earliestNext, Date.parse(prior.nextCheck!));
      return [];
    }
    return [{ original, prior, needHash }];
  });
  if (due.length === 0) return finish();
  const bank = input.entries === undefined ? await censusBank(input.repos, input.state) : {
    entries: input.entries, fingerprints: input.runtime.fingerprints ?? [], recipes: input.runtime.recipes ?? [],
  };
  const sharedRuntime = { ...input.runtime, fingerprints: input.runtime.fingerprints ?? bank.fingerprints,
    recipes: input.runtime.recipes ?? bank.recipes };
  const fingerprintHash = hash(sharedRuntime.fingerprints);
  const entriesFor = censusEntriesByGovernment(bank.entries);
  const hintEntries = routeHintEntriesBySubject(bank.entries);
  let index = 0;
  const work = async () => {
    while (index < due.length && !sharedRuntime.budget.spent()) {
      const { original, prior, needHash } = due[index++];
      try {
        const routeHints = await readDiscoveryRouteHints(input.repos, original, hintEntries);
        const runtime = { ...sharedRuntime, routeHints };
        const inputHash = hash([needHash, fingerprintHash, routeHints]);
        const reader = censusReader(runtime, original.jurisdictionId);
        for (const hint of routeHints.flatMap(row => row.routes)) await reader.get(hint.url);
        const need = await resolveCensusWebsite({ repos: input.repos, need: original, runtime, entries: entriesFor(original), reader });
        report.checked++;
        let pagesHash: string | null = null;
        let unfinished = false;
        if (need.ownWebAddress || routeHints.some(row => row.routes.length)) {
          const priorWalks = await input.repos.discoveryAttempts.read(need.jurisdictionId);
          if (need.ownWebAddress) for (const path of ["/", "/agendas", "/meetings", "/calendar", "/sitemap.xml"]) await reader.get(new URL(path, need.ownWebAddress).href);
          for (const url of prior?.urls ?? []) await reader.get(url);
          const pages = await Promise.all(reader.pages.values());
          pagesHash = hash(pages.filter(page => !page.url.endsWith("/robots.txt")).map(page => [page.url, page.status, page.transportError, hash(page.body)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
          unfinished = Boolean(priorWalks.at(-1)?.steps.some(step => step.status === null && /bound|website reached/.test(step.note)));
          if (!unfinished && prior?.inputHash === inputHash && prior.pagesHash === pagesHash) report.unchanged++;
          else {
            const attempt = await walkMeetingsDiscoveryNeed(need, { ...runtime, open: reader.open,
              maxRequestsPerWalk: Infinity, priorAttempts: priorWalks });
            await input.repos.discoveryAttempts.append(need.jurisdictionId, attempt.attemptId, attempt, attempt.finishedAt);
            const recipes = new Map(sharedRuntime.recipes.map(recipe => [recipe.recipeId, recipe]));
            const touched = new Set<string>();
            for (const outcome of attempt.recipes.applied) {
              const recipe = recipes.get(outcome.recipeId);
              if (!recipe) continue;
              const note = { at: attempt.finishedAt, jurisdictionId: need.jurisdictionId, url: outcome.url, conditions: outcome.detail };
              recipes.set(recipe.recipeId, recordRecipeOutcome(recipe, outcome.verdict === "YIELDED" ? { succeeded: true, note }
                : { succeeded: false, note: { ...note, limit: outcome.detail } }));
              touched.add(recipe.recipeId);
            }
            const written = await writeFieldManual(input.repos, [...discoveryFieldManualEntries(attempt),
              ...[...touched].map(id => recipeEntry(recipes.get(id)!, attempt.finishedAt))], attempt.finishedAt);
            if (written.error) throw new Error(written.error);
            report.walked++;
            const namedHints = new Set(attempt.found.filter(found => found.hintUrl && found.bodyName && (found.count ?? 0) > 0 &&
              printedNames(found.bodyName, need.jurisdictionId).length === 1).map(found => found.hintUrl));
            for (const found of attempt.found) {
              if (found.bodyName && printedNames(found.bodyName, need.jurisdictionId).length !== 1) continue;
              if (!found.bodyName && namedHints.has(found.hintUrl)) continue;
              const hint = routeHints.flatMap(row => row.routes).find(row => row.url === found.hintUrl);
              const site = found.hintUrl !== undefined && routeHints.some(row => row.officialSite?.origin === found.hintUrl);
              if ((hint || site) && found.count !== null && found.count > 0) report.hintMeetings.push({ jurisdictionId: need.jurisdictionId,
                name: need.name, body: found.bodyName ?? hint?.body ?? need.name, url: found.url, count: found.count });
            }
            unfinished = attempt.steps.some(step => step.status === null && /bound|website reached/.test(step.note));
            for (const platform of new Set(attempt.platformCensus?.matches.map(match => match.platform))) report.platforms[platform] = (report.platforms[platform] ?? 0) + 1;
            if (attempt.outcome === "COULD_NOT_READ" || attempt.outcome === "BLOCKED") report.failures.push(`${need.jurisdictionId}: ${attempt.outcome}`);
          }
          const allPages = await Promise.all(reader.pages.values());
          pagesHash = hash(allPages.filter(page => !page.url.endsWith("/robots.txt")).map(page => [page.url, page.status, page.transportError, hash(page.body)]).sort(([a], [b]) => String(a).localeCompare(String(b))));
        } else report.failures.push(`${need.jurisdictionId}: official website could not be read`);
        const now = input.runtime.now();
        const nextCheck = new Date(Date.parse(now) + (unfinished ? 3_600_000 : CHECK_MS)).toISOString();
        const saved = await writeFieldManual(input.repos, [censusCheckEntry(original, { needHash, inputHash, pagesHash, nextCheck, urls: [...reader.pages.keys()].filter(url => !url.endsWith("/robots.txt")) }, now)], now);
        if (saved.error) throw new Error(saved.error);
        scheduled++;
        earliestNext = Math.min(earliestNext, Date.parse(nextCheck));
        input.onProgress?.(report);
      } catch (error) { report.failures.push(`${original.jurisdictionId}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  };
  await Promise.all(Array.from({ length: input.concurrency ?? 4 }, work));
  return finish();
}

async function censusBank(repos: Repos, state: string) {
  const [fingerprints, sites, recipes] = await Promise.all([
    readFieldManual(repos, { kinds: ["PLATFORM_FINGERPRINT"], everywhere: true }),
    readFieldManual(repos, { kinds: ["ENTITY_HOST", "PLATFORM_CENSUS_DOMAIN", "NCES_WEBSITE", "GOVERNMENT_WEBSITE", "SOURCE_REGISTER", "SCOUT_DISCOVERY", "ROUTE"], state, withinState: state }),
    readFieldManual(repos, { kinds: [RECIPE_KIND], state }),
  ]);
  if (fingerprints.error || sites.error || recipes.error) throw new Error(fingerprints.error ?? sites.error ?? recipes.error);
  return { fingerprints: fingerprints.store.entries, entries: sites.store.entries, recipes: knownRecipes(recipes.store.entries) };
}

export function censusDivisionPrefix(state: string): string {
  const entry = Object.values(FIPS_TO_STATE).find(entry => entry.postal === state.toUpperCase());
  if (!entry) throw new Error("Unknown census state");
  return `ocd-division/country:us/${entry.prefix}:${state.toLowerCase()}`;
}

export async function censusStateCoverage(query: (sql: string, parameters: unknown[]) => Promise<unknown>, state: string, publishedGovernments: () => Promise<number | null>) {
  if (!/^[A-Z]{2}$/i.test(state)) throw new Error("Invalid census state");
  const rows = await query(`WITH walked AS (
    SELECT value FROM cp_field_manual_entries
    WHERE value->>'kind' = 'PLATFORM_CENSUS' AND value->'states' ? $1
      AND value #>> '{payload,subjectKind}' = 'GOVERNMENT'
  ), platforms AS (
    SELECT match->>'platform' AS platform, count(*) AS tenants
    FROM walked CROSS JOIN LATERAL jsonb_array_elements(value #> '{payload,matches}') match GROUP BY match->>'platform'
  ), doors AS (
    SELECT value->>'kind' AS platform, count(*) AS doors FROM cp_doors
    WHERE value->>'ocdId' LIKE $2 AND value->'meeting' <> 'null'::jsonb GROUP BY value->>'kind'
  ) SELECT (SELECT count(*) FROM walked)::int AS governments_walked,
    coalesce((SELECT jsonb_object_agg(platform, tenants) FROM platforms), '{}'::jsonb) AS platforms,
    coalesce((SELECT jsonb_object_agg(platform, doors) FROM doors), '{}'::jsonb) AS doors`,
    [state.toLowerCase(), `${censusDivisionPrefix(state)}%`]);
  if (!Array.isArray(rows) || !rows[0]) throw new Error("Census coverage counts could not be read");
  const row = rows[0] as { governments_walked: number; platforms: Record<string, number>; doors: Record<string, number>; governments_with_meetings: number };
  return { governmentsWalked: row.governments_walked, platformsFound: row.platforms, doorsByPlatform: row.doors,
    governmentsWithPublishedMeetings: await publishedGovernments() };
}
