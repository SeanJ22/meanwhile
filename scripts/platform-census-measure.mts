import { EMPTY_SPEND } from "../lib/control-plane/spend-window.ts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";
import { legistarClientCatalog, registeredPlatformTenant } from "../lib/control-plane/discovery/platform-catalog.ts";
import { heldPlatformTenants } from "../lib/control-plane/discovery/platform-enumeration.ts";
import { platformRegistrationBinding, platformRegistrationNeed, type PlatformRegistrationPage } from "../lib/control-plane/discovery/platform-registration.ts";
import { platformReviewer } from "../lib/control-plane/discovery/platform-reviewer.ts";
import { readPlatformGovernment, reviewPlatformAttempt } from "../lib/control-plane/discovery/platform-government.ts";
import { artifactId } from "../lib/control-plane/evidence/artifact.ts";
import type { HeldBytes } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { platformRequestPacer } from "../lib/control-plane/discovery/platform-request-pacing.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { readDerivedFamilyMembers } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { readHeldCalendar } from "../lib/control-plane/discovery/derived-wiring-reading.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { derivedWiringKey } from "../lib/civic-data/derived-meeting-wiring.ts";
import { wiringRowFor } from "../lib/control-plane/discovery/derived-wiring.ts";
import type { DiscoveryRuntime } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { withKnownReleaseCache } from "../lib/sources/known-release.ts";
import { primeCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryWebsitePacing, websiteOf, WEBSITE_WINDOW_MS } from "../lib/control-plane/website-pacing.ts";
import { platformFetch, platformHttpProcessIds } from "../lib/doors/platform-http.ts";
import { discoveryWorkId } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { legacyPlatformDoorId, reusePlatformDoor } from "../lib/doors/platform-census.ts";
import type { DoorRecord } from "../lib/doors/registry.ts";

const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const output = arg("report") ?? "/tmp/mp01-platform-measure.json";
const readerUrl = readFileSync(arg("reader-url-file") ?? "/tmp/mp01-reader-readonly-url", "utf8").trim();
const cpUrl = readFileSync(arg("control-url-file") ?? "/tmp/mp01-cp-readonly-url", "utf8").trim();
if (new URL(readerUrl).username !== "readonly" || new URL(cpUrl).username !== "wtp_cp_release_readonly") throw new Error("The measurement requires the production read-only roles");
let productionResponseBytes = 0, controlPlaneResponseBytes = 0, readerResponseBytes = 0;
neonConfig.fetchFunction = async (url: RequestInfo | URL, init?: RequestInit) => { for (let attempt = 0; ; attempt++) { const response = await fetch(url, init); const bytes = (await response.clone().arrayBuffer()).byteLength; productionResponseBytes += bytes;
  const connection = new Headers(init?.headers).get("Neon-Connection-String");
  const controlPlane = connection ? new URL(connection).username === "wtp_cp_release_readonly" : new URL(String(url)).hostname.replace("-pooler.", ".") === new URL(cpUrl).hostname.replace("-pooler.", ".");
  if (controlPlane) controlPlaneResponseBytes += bytes; else readerResponseBytes += bytes;
  appendFileSync(output + ".reads.jsonl", JSON.stringify({ at: new Date().toISOString(), project: controlPlane ? "control-plane" : "reader", bytes, status: response.status }) + "\n");
  if (![429, 502, 503, 504].includes(response.status) || attempt >= 2) return response;
  const retry = response.headers.get("retry-after"), until = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry ?? "");
  const wait = Number.isFinite(until) ? Math.max(0, until - Date.now()) : 500 * 2 ** attempt;
  // The roles above enforce read-only SQL. A long provider hold ends this check rather than blocking a worker.
  if (wait > 30_000) return response;
  await new Promise(resolve => setTimeout(resolve, wait));
} };
const reader = neon(readerUrl), control = neon(cpUrl);
const now = () => new Date().toISOString(), start = Date.now();
const vault = cycleVault(join(output + ".sources"));
mkdirSync(output + ".sources", { recursive: true });
const repos = createMemoryRepositories();
const reviewer = platformReviewer();
let databaseRequests = 0, publicRequests = 0, heldSourceReads = 0;
const sourceIndex = new Map<string, { path: string; contentType: string; retrievedAt: string; status: number }>();
const artifacts = new Map<string, { path: string; contentType: string; sha256: string; evidence: HeldBytes["evidence"] }>();
const artifactsBySource = new Map<string, { path: string; contentType: string; sha256: string; evidence: HeldBytes["evidence"] }>();
const heldGovernments = new Map<string, string>();
for (const directory of (arg("reuse-governments") ?? "").split(",").filter(Boolean)) for (const name of readdirSync(directory)) {
  if (!name.endsWith(".json")) continue;
  const path = join(directory, name), saved = JSON.parse(readFileSync(path, "utf8"));
  heldGovernments.set(saved.tenant.url, path);
}
const reuseMaxAge = Number(arg("reuse-max-age-hours") ?? 1) * 3_600_000;
for (const directory of (arg("reuse-sources") ?? "").split(",").filter(Boolean)) {
  for (const name of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
    if (!name.endsWith(".meta.json")) continue;
    const path = join(directory, name), metadata = JSON.parse(readFileSync(path, "utf8")).meta;
    const source = metadata.custom;
    if (source && ["RAW", "SANITIZED_DERIVED"].includes(source.tier)) {
      const id = artifactId(source.tier, metadata.contentHash);
      const record = { path: path.slice(0, -10), contentType: metadata.contentType, sha256: metadata.contentHash.slice(7),
        evidence: { kind: "VAULTED_EVIDENCE" as const, artifactId: id, contentHash: metadata.contentHash, tier: source.tier, retrievedAt: source.retrievedAt } };
      artifacts.set(`${id}|${source.attemptId}|${source.canonicalUrl}`, record);
      const key = `${id}|${source.workItemId}|${source.canonicalUrl}`, previous = artifactsBySource.get(key);
      if (!previous || record.evidence.retrievedAt < previous.evidence.retrievedAt) artifactsBySource.set(key, record);
    }
    if (!source || source.tier !== "RAW" || Date.now() - Date.parse(source.retrievedAt) > reuseMaxAge) continue;
    const previous = sourceIndex.get(source.canonicalUrl);
    if (!previous || previous.retrievedAt < source.retrievedAt) sourceIndex.set(source.canonicalUrl, {
      path: path.slice(0, -10), contentType: metadata.contentType, retrievedAt: source.retrievedAt, status: Number(source.httpStatus),
    });
  }
}
const query = async (sql: string, parameters: readonly unknown[]) => { databaseRequests++; return reader.query(sql, [...parameters]); };
const existing = await control.query(`SELECT value->>'kind' AS platform, substring(value->>'ocdId' from '/(?:state|district|territory):([a-z]{2})') AS state, count(*)::int AS doors
  FROM cp_doors WHERE value->'meeting' IS NOT NULL AND value->'meeting'<>'null'::jsonb GROUP BY 1,2 ORDER BY 2,1`);
databaseRequests++;
const states = await query(`SELECT substring(scope from '^US-([A-Z]{2}):') AS state,jsonb_array_length(payload->'governments') AS governments
  FROM civic_data_promotions WHERE record_class='REGISTRATION' ORDER BY scope`, []);
// The adapters share this exact, current canonical tool; no database writes or test fixture venues.
const venueRows = await query(`SELECT current_version_id AS version,payload FROM civic_data_promotions
  WHERE key='CURATED_READER_RECORD:US-AZ+US-NH+US-NJ:reviewed-venue-resolutions'
    AND current_version_id=last_known_good_version_id`, []);
if (venueRows.length !== 1) throw new Error("The canonical venue projection is unavailable");
primeCuratedReaderProjection("venue-resolutions", venueRows[0].payload as Parameters<typeof primeCuratedReaderProjection>[1], String(venueRows[0].version));
writeFileSync(output + ".venues.json", JSON.stringify(venueRows[0]));
const results: Record<string, { state: string; platform: string; governmentsMatched: number; doorsWouldOpen: number; meetingsWouldPublish: number;
  dateOnlyMeetings: number; requestsMade: number; peakMemoryBytes: number; failures: string[] }> = {};
const activeRows = new Map<(typeof results)[string], number>();
let lastPeak = process.resourceUsage().maxRSS * 1024;
let peakProcessTreeBytes = lastPeak;
const processRss = (pid: number): number => {
  if (process.platform !== "linux") return pid === process.pid ? process.memoryUsage.rss() : 0;
  try {
    return Number(/^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
  } catch { return 0; }
};
const sampleMemory = () => {
  const peak = process.resourceUsage().maxRSS * 1024;
  const rss = Math.max(processRss(process.pid) + platformHttpProcessIds().reduce((sum, pid) => sum + processRss(pid), 0), peak > lastPeak ? peak : 0);
  lastPeak = peak;
  peakProcessTreeBytes = Math.max(peakProcessTreeBytes, rss);
  for (const row of activeRows.keys()) row.peakMemoryBytes = Math.max(row.peakMemoryBytes, rss);
};
const track = (row: (typeof results)[string], delta: number) => { const n = (activeRows.get(row) ?? 0) + delta; if (n) activeRows.set(row, n); else activeRows.delete(row); };
const memoryTimer = setInterval(sampleMemory, 100); memoryTimer.unref();
const seen = new Set<string>();
const completedTenants = new Set<string>();
if (arg("skip-completed")) for (const url of JSON.parse(readFileSync(arg("skip-completed")!, "utf8")).completedTenants) completedTenants.add(url);
let previousElapsedMs = 0;
if (arg("resume") && existsSync(output)) {
  const previous = JSON.parse(readFileSync(output, "utf8"));
  if (previous.reviewer !== reviewer) throw new Error("A resumed measurement must use the same matcher revision; replay held evidence after a code change");
  for (const row of previous.results) results[`${row.state}|${row.platform}`] = { ...row, peakMemoryBytes: row.peakMemoryBytes ?? 0 };
  for (const url of previous.completedTenants) completedTenants.add(url);
  for (const key of previous.seen) seen.add(key);
  previousElapsedMs = previous.elapsedMs; productionResponseBytes += previous.productionResponseBytes;
  controlPlaneResponseBytes += previous.controlPlaneResponseBytes; readerResponseBytes += previous.readerResponseBytes;
  databaseRequests += previous.databaseRequests; publicRequests += previous.publicRequests; heldSourceReads += previous.heldSourceReads;
}
let complete = false;
let admittedTenants = 0;
const httpPacingPath = "/tmp/mp01-platform-measure-pacing.jsonl", localPacing = memoryWebsitePacing(), ownWebsiteReads = new Map<string, number[]>();
if (existsSync(httpPacingPath)) for (const line of readFileSync(httpPacingPath, "utf8").split("\n").filter(Boolean)) {
  const saved = JSON.parse(line);
  if (saved.at && Date.now() - saved.at < WEBSITE_WINDOW_MS) ownWebsiteReads.set(saved.site, [...ownWebsiteReads.get(saved.site) ?? [], saved.at]);
  if (saved.until > Date.now()) await localPacing.hold(saved.site, saved.until, Date.now());
}
const pacing = { ...localPacing,
  take: async (site: string, limit: number, at: number) => {
    databaseRequests++;
    const rows = await control.query(`SELECT count(*)::int AS count,min(t) AS oldest FROM cp_website_pacing p,unnest(p.requests) t
      WHERE p.site=$1 AND t>$2::timestamptz`, [site, new Date(at - WEBSITE_WINDOW_MS).toISOString()]).catch(() => null);
    if (!rows) return { ok: false as const, until: at + 60_000 };
    const [other] = rows;
    const recent = (ownWebsiteReads.get(site) ?? []).filter(time => at - time < WEBSITE_WINDOW_MS);
    if (recent.length + Number(other.count) >= limit) return { ok: false as const, until: Math.min(recent[0] ?? at, Date.parse(String(other.oldest)) || at) + WEBSITE_WINDOW_MS };
    ownWebsiteReads.set(site, [...recent, at]);
    appendFileSync(httpPacingPath, JSON.stringify({ site, at }) + "\n");
    return { ok: true as const };
  },
  hold: async (site: string, until: number, at: number) => { appendFileSync(httpPacingPath, JSON.stringify({ site, until }) + "\n"); await localPacing.hold(site, until, at); },
};
const paceRequest = platformRequestPacer();
const activeSizes = new Set<(url: string) => ReturnType<ReturnType<typeof websiteSizeFromHoldings>>>();
const sharedFleet = new FleetSafetyController({ now: now(), spend: EMPTY_SPEND, modelHold: "Read-only platform measurement", websitePacing: pacing, websiteSize: url => {
  const sizes = [...new Map([...activeSizes].flatMap(read => read(url) ?? []).map(size => [JSON.stringify(size), size])).values()];
  return sizes.length === 1 ? sizes[0] : null;
} });
const tenants = (function* () { const sources = (function* () {
  if (arg("held-only")) { for (const path of heldGovernments.values()) yield JSON.parse(readFileSync(path, "utf8")).tenant; return; }
  if (arg("legistar-catalog-file")) yield* legistarClientCatalog(readFileSync(arg("legistar-catalog-file")!, "utf8"));
  if (!arg("legistar-catalog-file") || arg("include-held")) yield* heldPlatformTenants();
})(); const seen = new Set<string>(); for (const tenant of sources) if ((!arg("portal") || tenant.url === arg("portal")) && (!arg("platform") || tenant.platform === arg("platform")) && (!arg("tenant") || arg("tenant")!.split(",").some(client => new URL(tenant.url).hostname === `${client}.legistar.com`))) { const key = tenant.platform === "legistar" ? new URL(tenant.url).hostname : tenant.url;
  if (!seen.has(key)) { seen.add(key); if (!completedTenants.has(tenant.url)) yield tenant; }
} })();
const summary = () => ({ complete, reviewer, observedAt: now(), elapsedMs: previousElapsedMs + Date.now() - start, readonly: true, existing, states,
  completedTenants: [...completedTenants], seen: [...seen],
  databaseRequests, productionResponseBytes, controlPlaneResponseBytes, readerResponseBytes, publicRequests, heldSourceReads,
  peakMemoryBytes: Math.max(peakProcessTreeBytes, process.resourceUsage().maxRSS * 1024),
  adapterReading: arg("full-adapters") ? "Full rolling adapter acquisition" : "Existing adapters on this discovery pass's exact saved responses; incomplete publisher pages remain partial",
  meetingsPerHour: Object.values(results).reduce((sum, row) => sum + row.meetingsWouldPublish, 0) * 3_600_000 / (previousElapsedMs + Date.now() - start),
  results: Object.values(results).sort((a, b) => a.state.localeCompare(b.state) || a.platform.localeCompare(b.platform)) });

async function worker() {
  for (;;) {
    if (arg("limit-tenants") && admittedTenants >= Number(arg("limit-tenants"))) return;
    const next = tenants.next();
    if (next.done) return;
    admittedTenants++;
    const tenant = next.value;
    const key = `${tenant.state ?? "UNLOCATED"}|${tenant.platform}`;
    const result = results[key] ??= { state: tenant.state ?? "UNLOCATED", platform: tenant.platform, governmentsMatched: 0,
      doorsWouldOpen: 0, meetingsWouldPublish: 0, dateOnlyMeetings: 0, requestsMade: 0, peakMemoryBytes: 0, failures: [] };
    let requestResult = result, ownRequests = 0;
    track(result, 1); sampleMemory();
    let size = websiteSizeFromHoldings(tenant.state ? [tenant.state] : []);
    const fleet = sharedFleet;
    const spaceOut = async () => {};
    const sizeReader = (url: string) => size(url);
    activeSizes.add(sizeReader);
    const responseHeaders = new Map<string, Headers>();
    const open: DiscoveryRuntime["open"] = async input => {
      const saved = sourceIndex.get(input.url);
      if (saved && saved.status === 200 && Date.now() - Date.parse(saved.retrievedAt) <= reuseMaxAge && input.method !== "POST") {
        heldSourceReads++;
        const body = readFileSync(saved.path, "utf8");
        return { status: saved.status, body, bytes: Buffer.byteLength(body), contentType: saved.contentType,
          location: null, transportError: null, retrievedAt: saved.retrievedAt };
      }
      if (arg("held-only")) return { status: null, body: "", bytes: 0, contentType: "", location: null, transportError: "This public response is not in the retained measurement" };
      databaseRequests++;
      const [held] = await control.query("SELECT hold_until FROM cp_website_pacing WHERE site=$1", [websiteOf(input.url)]);
      if (Date.parse(String(held?.hold_until)) > Date.now()) throw new Error("The publisher's production backoff is still in effect");
      await paceRequest(input.url);
      const got = await fleet.guardedOpenBytes("discovery-web", "platform-census-measure", async (url, init) => {
        publicRequests++; ownRequests++; requestResult.requestsMade++;
        appendFileSync(output + ".requests.jsonl", JSON.stringify({ at: now(), state: requestResult.state, platform: requestResult.platform, url: input.url }) + "\n");
        const headers = new Headers(init?.headers); headers.set("connection", "close");
        const response = await platformFetch(url, { ...init, headers, method: input.method ?? "GET", body: input.body,
          signal: AbortSignal.timeout(input.timeoutMs), redirect: "manual" });
        responseHeaders.set(input.url, response.headers);
        return response;
      }, { followRedirects: false })(input);
      return { status: got.status, body: new TextDecoder().decode(got.bytes), bytes: got.bytes.byteLength,
        contentType: got.contentType, location: got.location ?? null, transportError: got.transportError };
    };
    try {
      const savedGovernment = heldGovernments.get(tenant.url);
      let matches: PlatformRegistrationPage[];
      if (savedGovernment) {
        const saved = JSON.parse(readFileSync(savedGovernment, "utf8")).page as PlatformRegistrationPage;
        const [current] = await query(`SELECT p.current_version_id AS "versionId"
          FROM civic_data_promotions p WHERE p.key=$1 AND p.record_class='REGISTRATION'`,
        [`REGISTRATION:US-${saved.government.state}:registration:v1`]);
        matches = current?.versionId === saved.versionId ? [saved]
          : await registeredPlatformTenant(query, tenant, { open, now, spaceOut, vault: vault.put, budget: { spent: () => false } });
      } else matches = await registeredPlatformTenant(query, tenant, { open, now, spaceOut, vault: vault.put, budget: { spent: () => false } });
      if (matches.length !== 1) { result.failures.push(`${tenant.url}: ${matches.length ? "ambiguous government" : "government unresolved"}`); continue; }
      const page = matches[0], need = platformRegistrationNeed(page);
      if (!need || seen.has(`${need.jurisdictionId}|${tenant.platform}`)) continue;
      seen.add(`${need.jurisdictionId}|${tenant.platform}`);
      size = websiteSizeFromHoldings([need.stateCode]);
      const stateKey = `${need.stateCode}|${tenant.platform}`;
      const actual = results[stateKey] ??= { ...result, state: need.stateCode, governmentsMatched: 0, doorsWouldOpen: 0, meetingsWouldPublish: 0, dateOnlyMeetings: 0, requestsMade: 0, peakMemoryBytes: 0, failures: [] };
      if (actual !== result) { result.requestsMade -= ownRequests; actual.requestsMade += ownRequests; track(result, -1); track(actual, 1); sampleMemory(); }
      requestResult = actual;
      actual.governmentsMatched++;
      const got = arg("rereview") && savedGovernment && JSON.parse(readFileSync(savedGovernment, "utf8")).attempt.found.length ? (() => {
        const saved = JSON.parse(readFileSync(savedGovernment, "utf8")), held = new Map<string, HeldBytes>();
        for (const step of saved.attempt.steps) {
          const record = artifacts.get(`${step.artifactId}|${saved.attempt.attemptId}|${step.url}`)
            ?? artifactsBySource.get(`${step.artifactId}|${saved.attempt.jurisdictionId}|${step.url}`)
            ?? artifactsBySource.get(`${step.artifactId}|${discoveryWorkId(saved.attempt.jurisdictionId)}|${step.url}`);
          if (!record) continue;
          const text = readFileSync(record.path, "utf8");
          if (createHash("sha256").update(text).digest("hex") !== record.sha256) throw new Error("Retained platform source digest changed");
          heldSourceReads++; held.set(step.artifactId, { ...record, text });
        }
        return reviewPlatformAttempt({ attempt: saved.attempt, registered: platformRegistrationBinding(page), held, reviewer, now: now() });
      })() : await readPlatformGovernment({ need, registered: platformRegistrationBinding(page), repos, readonly: true, tenant,
        reviewer, runtime: { open, now, spaceOut, vault: vault.put,
          websiteSize: url => size(url), budget: { spent: () => false }, maxRequestsPerWalk: Number.MAX_SAFE_INTEGER } });
      const existingDoors = got.doors.length ? await control.query(`SELECT id,jsonb_build_object('doorId',id,'kind',value->'kind',
        'meeting',value->'meeting','config',value->'config','bodyIds',value->'bodyIds','status',value->'status') AS value
        FROM cp_doors WHERE id=ANY($1::text[])`, [[...new Set(got.doors.flatMap(door => [door.doorId, legacyPlatformDoorId(door)]))]]) : [];
      if (got.doors.length) databaseRequests++;
      const heldDoors = new Map(existingDoors.map(door => [String(door.id), door]));
      got.doors = got.doors.map(door => reusePlatformDoor(door, (heldDoors.get(legacyPlatformDoorId(door))?.value ?? null) as DoorRecord | null));
      actual.doorsWouldOpen += got.doors.filter(door => !heldDoors.has(door.doorId)).length;
      mkdirSync(output + ".governments", { recursive: true });
      const governmentFile = need.jurisdictionId.replaceAll(":", "_") + "-" + createHash("sha256").update(tenant.url).digest("hex").slice(0, 12);
      const governmentPath = join(output + ".governments", governmentFile + ".json");
      writeFileSync(governmentPath, JSON.stringify({ page, tenant, attempt: got.attempt, review: got.review, doors: got.doors,
        newDoorIds: got.doors.filter(door => !heldDoors.has(door.doorId)).map(door => door.doorId) }, null, 2));
      if (!got.doors.length) actual.failures.push(`${tenant.url}: ${got.attempt.outcome}: ${got.attempt.note}`);

      const unique = new Map(got.review.accepted.map(accepted => [accepted.row.bodyId + "|" + accepted.row.kind + "|" + accepted.row.route, accepted]));
      const countedMeetings = new Set<string>();
      let memberIndex = 0;
      for (const accepted of unique.values()) {
        const responses: { finalUrl: string; body: string; status: number; contentType: string; retrievedAt: string }[] = [];
        const row = wiringRowFor(accepted.row);
        const reads = !arg("full-adapters") ? await (async () => {
          const step = got.attempt.steps.find(step => step.purpose === "endpoint" && step.url === row.route && step.artifactId);
          const bytes = step?.artifactId ? got.held.get(step.artifactId) : null;
          const meetings: Meeting[] = [];
          if (!bytes) return [{ ok: false, error: "The adapter has no saved source bytes", freshMeetings: meetings }];
          const verified = await readHeldCalendar({ key: row.crosswalkRowId, row, others: got.review.accepted.filter(other => other.row.bodyId !== row.bodyId).map(other => other.row.bodyName),
            held: { text: bytes.text, contentType: bytes.contentType ?? "" }, evidence: bytes.evidence }, now(), kind => `readonly-${kind}`, result => meetings.push(...result));
          responses.push({ finalUrl: row.route, body: bytes.text, status: 200, contentType: bytes.contentType ?? "", retrievedAt: bytes.evidence.retrievedAt });
          return [{ ok: "verified" in verified, error: "verified" in verified ? null : JSON.stringify(verified), freshMeetings: meetings }];
        })() : await withKnownReleaseCache({ store: new DurableEvidenceStore(output + ".sources"), locks: repos.locks }, () => readDerivedFamilyMembers([{ id: derivedWiringKey(row.kind, row.bodyId, row.route), status: "ACTIVE", row }], async (url, init) => {
          const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
          const got = await open({ url: target, headers: Object.fromEntries(new Headers(init?.headers)), timeoutMs: 30_000,
            ...(init?.method === "POST" ? { method: "POST", body: typeof init.body === "string" ? init.body : undefined } : {}) });
          if (got.status && got.status >= 200 && got.status < 300) responses.push({ finalUrl: target, body: got.body, status: got.status, contentType: got.contentType, retrievedAt: got.retrievedAt ?? now() });
          if (got.status === null) throw new Error(got.transportError ?? "Publisher could not be read");
          return new Response(got.status === 204 || got.status === 304 ? null : got.body, { status: got.status, headers: responseHeaders.get(target) ?? { "content-type": got.contentType, ...(got.location ? { location: got.location } : {}) } });
        }));
        mkdirSync(output + ".readings", { recursive: true });
        const savedResponses = await Promise.all(responses.map(async response => {
          const bytes = Buffer.from(response.body);
          const hash = createHash("sha256").update(bytes).digest("hex");
          const path = join(output + ".sources", `response-${hash}`);
          if (!existsSync(path)) writeFileSync(path, bytes);
          const { body: _body, ...metadata } = response;
          return { ...metadata, path, sha256: hash };
        }));
        const platform = row.kind === "LEGISTAR_INSITE" ? "legistar" : row.kind === "ICAL" && tenant.platform === "civicplus" ? "civicplus" : row.kind.toLowerCase();
        writeFileSync(join(output + ".readings", governmentFile + "-" + memberIndex++ + ".json"), JSON.stringify({ government: need.jurisdictionId, state: need.stateCode, platform, row, reads, responses: savedResponses }));
        for (const read of reads) {
          if (!read.ok) actual.failures.push(`${row.route}: ${read.error}`);
          else for (const meeting of read.freshMeetings) {
            if (countedMeetings.has(meeting.id) || Math.abs(Date.parse(meeting.startsAt) - Date.now()) > 90 * 86_400_000) continue;
            countedMeetings.add(meeting.id);
            if (meeting.startPrecision === "DAY") actual.dateOnlyMeetings++; else actual.meetingsWouldPublish++;
          }
        }
      }
      for (const hold of got.review.held) actual.failures.push(`${hold.route}: ${hold.reason}`);
      const metadata = JSON.parse(readFileSync(governmentPath, "utf8"));
      writeFileSync(governmentPath, JSON.stringify({ ...metadata, publicRequests: ownRequests, peakMemoryBytes: actual.peakMemoryBytes }));
      console.log(JSON.stringify({ government: need.jurisdictionId, state: need.stateCode, doors: got.doors.length, requests: got.attempt.requestCount }));
    } catch (error) { requestResult.failures.push(`${tenant.url}: ${error instanceof Error ? error.message : String(error)}`); }
    finally { sampleMemory(); track(requestResult, -1); completedTenants.add(tenant.url); activeSizes.delete(sizeReader); writeFileSync(output, JSON.stringify(summary(), null, 2) + "\n"); }
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
clearInterval(memoryTimer);
complete = !arg("limit-tenants") || admittedTenants < Number(arg("limit-tenants"));
writeFileSync(output, JSON.stringify(summary(), null, 2) + "\n");
const { results: _results, completedTenants: _completed, seen: _seen, existing: _existing, states: _states, ...counts } = summary();
console.log(JSON.stringify(counts));
