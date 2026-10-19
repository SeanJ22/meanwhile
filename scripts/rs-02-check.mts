/** Compact reader verification against production; all database access uses its readonly role.
 * NODE_USE_ENV_PROXY=1 node --env-file=/tmp/rs02-production.env --experimental-strip-types
 *   --import ./scripts/register-test-loader.mjs scripts/rs-02-check.mts
 * --states=AZ,CA limits an investigative run. The default checks every state in a fresh process.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { personIdentityKeys } from "../lib/officials/people-identity.ts";
import type { ReaderStateResponse } from "../lib/reader/client.ts";
import type { MeetingSearchResult } from "../lib/meetings/query.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const scriptStarted = performance.now();
const MARKER = "RS02_RESULT ";
const PROBES: Probe[] = [
  {"state": "AL", "zip": "36003", "lat": 32.44428, "lng": -86.73004},
  {"state": "AK", "zip": "99631", "lat": 60.59632, "lng": -149.6383},
  {"state": "AZ", "zip": "85701", "lat": 32.21704, "lng": -110.97134},
  {"state": "AR", "zip": "72370", "lat": 35.67287, "lng": -90.05801},
  {"state": "CA", "zip": "93636", "lat": 36.98488, "lng": -119.87752},
  {"state": "CO", "zip": "80757", "lat": 39.79103, "lng": -103.58313},
  {"state": "CT", "zip": "06412", "lat": 41.41173, "lng": -72.48715},
  {"state": "DE", "zip": "19934", "lat": 39.08473, "lng": -75.62735},
  {"state": "FL", "zip": "33183", "lat": 25.7006, "lng": -80.40573},
  {"state": "GA", "zip": "30720", "lat": 34.73365, "lng": -85.00082},
  {"state": "HI", "zip": "96768", "lat": 20.82916, "lng": -156.29722},
  {"state": "ID", "zip": "83537", "lat": 46.63317, "lng": -116.52946},
  {"state": "IL", "zip": "61569", "lat": 40.68323, "lng": -89.90062},
  {"state": "IN", "zip": "46992", "lat": 40.78452, "lng": -85.83051},
  {"state": "IA", "zip": "51047", "lat": 42.94236, "lng": -95.36954},
  {"state": "KS", "zip": "67038", "lat": 37.12017, "lng": -96.68027},
  {"state": "KY", "zip": "41365", "lat": 37.70678, "lng": -83.62887},
  {"state": "LA", "zip": "70757", "lat": 30.36875, "lng": -91.53124},
  {"state": "ME", "zip": "04493", "lat": 45.27814, "lng": -68.53563},
  {"state": "MD", "zip": "21155", "lat": 39.57362, "lng": -76.80608},
  {"state": "MA", "zip": "01879", "lat": 42.66776, "lng": -71.42882},
  {"state": "MI", "zip": "48897", "lat": 42.7039, "lng": -85.13035},
  {"state": "MN", "zip": "56051", "lat": 43.53644, "lng": -93.70847},
  {"state": "MS", "zip": "39145", "lat": 32.34466, "lng": -89.79436},
  {"state": "MO", "zip": "64470", "lat": 40.17336, "lng": -95.22667},
  {"state": "MT", "zip": "59446", "lat": 47.65059, "lng": -110.15244},
  {"state": "NE", "zip": "68725", "lat": 42.19741, "lng": -98.7779},
  {"state": "NV", "zip": "89148", "lat": 36.06336, "lng": -115.29676},
  {"state": "NH", "zip": "03461", "lat": 42.75666, "lng": -72.01325},
  {"state": "NJ", "zip": "07927", "lat": 40.82373, "lng": -74.45635},
  {"state": "NM", "zip": "87735", "lat": 36.04869, "lng": -105.11978},
  {"state": "NY", "zip": "12803", "lat": 43.28844, "lng": -73.63177},
  {"state": "NC", "zip": "28124", "lat": 35.40007, "lng": -80.40829},
  {"state": "ND", "zip": "58443", "lat": 47.46434, "lng": -98.68119},
  {"state": "OH", "zip": "44438", "lat": 41.23965, "lng": -80.53066},
  {"state": "OK", "zip": "73942", "lat": 36.74404, "lng": -101.49636},
  {"state": "OR", "zip": "97414", "lat": 42.96758, "lng": -124.1561},
  {"state": "PA", "zip": "17058", "lat": 40.50104, "lng": -77.54801},
  {"state": "RI", "zip": "02865", "lat": 41.91546, "lng": -71.44982},
  {"state": "SC", "zip": "29512", "lat": 34.61903, "lng": -79.71804},
  {"state": "SD", "zip": "57375", "lat": 43.55641, "lng": -98.47992},
  {"state": "TN", "zip": "37810", "lat": 36.17766, "lng": -83.10196},
  {"state": "TX", "zip": "77346", "lat": 29.99199, "lng": -95.17727},
  {"state": "UT", "zip": "84304", "lat": 41.82184, "lng": -111.97913},
  {"state": "VT", "zip": "05478", "lat": 44.79157, "lng": -73.11776},
  {"state": "VA", "zip": "23418", "lat": 37.64138, "lng": -75.66839},
  {"state": "WA", "zip": "98570", "lat": 46.63071, "lng": -122.65095},
  {"state": "WV", "zip": "25823", "lat": 37.66634, "lng": -81.1828},
  {"state": "WI", "zip": "54161", "lat": 45.13519, "lng": -88.15064},
  {"state": "WY", "zip": "82601", "lat": 43.06992, "lng": -106.34158},
];
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(arg("out") ?? ".scratch/rs02/after.json");
const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection) throw new Error("WTP_PRODUCTION_DATABASE_URL_READONLY is required; this script never guesses a database");
const targetHost = new URL(connection).hostname.replace(/-pooler(?=\.)/, "");
if (!targetHost.startsWith("ep-dry-river-axwtolzc.")) throw new Error("The read-only handle must point at the existing production endpoint");
process.env.DATABASE_URL = connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_VITAL_SIGNS_REPORT = "1"; // Report accounting in memory; never INSERT transfer bookkeeping.

type Probe = { state: string; zip: string; lat: number; lng: number };
type ReaderPayload = MeetingSearchResult & { nearZip?: string | null };
type Round = { zip: string; kind: "cold" | "repeat" | "next-zip"; stateMs: number; placeMs: number; usableMs: number;
  stateStatus: number; placeStatus: number; stateBytes: number; stateGzipBytes: number; placeBytes: number; eventOrder: string[];
  meetings: number; bodies: number; timing: string | null; errors: string[] };
type Result = { state: string; zip: string; importMs?: number; coldWithImportsMs?: number; processMs?: number; rounds?: Round[]; errors: string[];
  baselineAvailable?: boolean; baselineMs?: number; liveBaselineAvailable?: boolean; liveMissing?: string[]; federal?: { id: string; name: string; offices: number; contactMs: number; repeatMs?: number }[]; preserved?: Record<string, number>; missing?: string[] };

function heldPeople(payload: ReaderPayload): SeatHolder[] {
  const coverage = payload.coverage;
  if (!coverage) return [];
  return [...coverage.seats.flatMap(seat => seat.representatives), ...coverage.senators, ...coverage.statewideExecutives,
    ...coverage.bodies.flatMap(body => body.readerRoster?.members ?? [])];
}

function missingHeld(before: ReaderPayload, after: ReaderPayload): { missing: string[]; preserved: Record<string, number> } {
  const missing: string[] = [], preserved: Record<string, number> = {};
  const hasValue = (value: unknown) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
  const check = (kind: string, old: readonly string[], current: ReadonlySet<string>) => {
    preserved[kind] = old.filter(id => current.has(id)).length;
    missing.push(...old.filter(id => !current.has(id)).map(id => `${kind}:${id}`));
  };
  check("meetings", before.meetings.map(row => row.id), new Set(after.meetings.flatMap(row => [row.id, ...row.mergedMeetingIds ?? []])));
  check("bodies", before.coverage?.bodies.map(row => row.bodyId) ?? [], new Set(after.coverage?.bodies.map(row => row.bodyId)));
  check("seats", before.coverage?.seats.map(row => row.ocdId) ?? [], new Set(after.coverage?.seats.map(row => row.ocdId)));
  check("divisions", before.coverage?.divisions.map(row => row.ocdId) ?? [], new Set(after.coverage?.divisions.map(row => row.ocdId)));
  check("governments", before.coverage?.governments?.map(row => row.id) ?? [], new Set(after.coverage?.governments?.map(row => row.id)));
  check("stateOffices", before.coverage?.stateOffices?.map(row => row.id) ?? [], new Set(after.coverage?.stateOffices?.map(row => row.id)));
  const people = heldPeople(before), afterPeople = new Map<string, SeatHolder[]>();
  for (const row of heldPeople(after)) for (const key of personIdentityKeys(row)) afterPeople.set(key, [...afterPeople.get(key) ?? [], row]);
  const currentPeople = (old: SeatHolder) => [...new Set([...personIdentityKeys(old)].flatMap(key => afterPeople.get(key) ?? []))];
  check("officials", [...new Set(people.map(row => row.id))], new Set(people.filter(row => currentPeople(row).length).map(row => row.id)));
  for (const old of people) {
    const current = currentPeople(old);
    if (!current.length) continue;
    for (const key of ["name", "officeTitle", "email", "phone", "websiteUrl", "contactFormUrl", "photoUrl", "sourceUrl", "partyLabel", "termStart", "termEnd", "birthDate", "campaignUrl", "social"] as const) {
      if (hasValue(old[key]) && !current.some(row => hasValue(row[key]))) missing.push(`official-field:${old.id}:${key}`);
    }
  }
  const bodies = new Map(after.coverage?.bodies.map(body => [body.bodyId, body]));
  for (const old of before.coverage?.bodies ?? []) {
    const current = bodies.get(old.bodyId);
    if (!current) continue;
    for (const key of ["name", "homepageUrl", "agendaSourceRef", "meetingCadence"] as const) {
      if (hasValue(old[key]) && !hasValue(current[key])) missing.push(`body-field:${old.bodyId}:${key}`);
    }
    for (const key of ["address", "phone"] as const) {
      if (hasValue(old.officeContact?.[key]) && !hasValue(current.officeContact?.[key])) missing.push(`body-office:${old.bodyId}:${key}`);
    }
    if (hasValue(old.readerRoster?.officePhone?.phone) && !hasValue(current.readerRoster?.officePhone?.phone)) missing.push(`body-office:${old.bodyId}:roster-phone`);
  }
  const governments = new Map(after.coverage?.governments?.map(row => [row.id, row]));
  for (const old of before.coverage?.governments ?? []) {
    const current = governments.get(old.id);
    if (!current) continue;
    for (const key of ["name", "website", "officePhone", "officeAddress", "contactTitle", "mailingAddress"] as const) {
      if (hasValue(old[key]) && !hasValue(current[key])) missing.push(`government-field:${old.id}:${key}`);
    }
  }
  const meetings = new Map(after.meetings.flatMap(row => [row.id, ...row.mergedMeetingIds ?? []].map(id => [id, row] as const)));
  for (const old of before.meetings) {
    const current = meetings.get(old.id);
    if (!current) continue;
    for (const key of ["agendaUrl", "location", "online", "publishedLinks"] as const) {
      if (hasValue(old[key]) && !hasValue(current[key])) missing.push(`meeting-field:${old.id}:${key}`);
    }
    for (const key of ["name", "address"] as const) {
      if (hasValue(old.location?.[key]) && !hasValue(current.location?.[key])) missing.push(`meeting-location:${old.id}:${key}`);
    }
  }
  return { missing, preserved };
}

async function child(probe: Probe): Promise<Result> {
  const [{ GET: stateRoute }, { GET: placeRoute }, { GET: zipRoute }, { GET: directoryRoute }, { lookupZcta }, client, national] = await Promise.all([
    import("../app/api/reader/state/route.ts"), import("../app/api/meetings/route.ts"),
    import("../app/api/location/zip/route.ts"), import("../app/api/directory/route.ts"), import("../lib/geo/zcta.ts"), import("../lib/reader/client.ts"), import("../lib/reader/national.ts"),
  ]);
  const importMs = Math.round(performance.now() - scriptStarted), rounds: Round[] = [];
  let firstState: ReaderStateResponse | null = null, firstPlace: ReaderPayload | null = null;
  const states = new Map<string, ReaderStateResponse>();
  async function round(zip: string, kind: Round["kind"]): Promise<void> {
    const started = performance.now();
    const measurement: Round = { zip, kind, stateMs: 0, placeMs: 0, usableMs: 0, stateStatus: 0, placeStatus: 0,
      stateBytes: 0, stateGzipBytes: 0, placeBytes: 0, eventOrder: [], meetings: 0, bodies: 0, timing: null, errors: [] };
    const locationResponse = await zipRoute(new Request(`http://localhost/api/location/zip?zip=${zip}`));
    const { location } = await locationResponse.json() as { location: Probe | null };
    if (!location) throw new Error(`ZIP ${zip} did not resolve`);
    await client.loadStateAndPlace({
      state: async () => {
        const held = states.get(zip);
        if (held) { measurement.stateStatus = 200; measurement.stateMs = Math.round(performance.now() - started); return held; }
        const response = await stateRoute(new Request(`http://localhost/api/reader/state?state=${probe.state}&zip=${zip}`));
        const text = await response.text();
        measurement.stateStatus = response.status; measurement.stateBytes = Buffer.byteLength(text);
        measurement.stateMs = Math.round(performance.now() - started);
        measurement.stateGzipBytes = gzipSync(text).byteLength;
        if (response.status !== 200) throw new Error(`state HTTP ${response.status}`);
        const value = JSON.parse(text) as ReaderStateResponse;
        states.set(zip, value);
        if (value.zip !== zip || Object.keys(value.zipPlaces).some(code => code !== zip)) measurement.errors.push("State answer includes places outside the requested ZIP");
        return value;
      },
      place: async () => {
        const response = await placeRoute(new Request(`http://localhost/api/meetings?zip=${zip}&lat=${location.lat}&lng=${location.lng}`));
        const text = await response.text();
        measurement.placeStatus = response.status; measurement.placeBytes = Buffer.byteLength(text);
        measurement.placeMs = Math.round(performance.now() - started); measurement.timing = response.headers.get("server-timing");
        if (response.status !== 200) throw new Error(`place HTTP ${response.status}`);
        return JSON.parse(text) as ReaderPayload;
      },
      signal: new AbortController().signal,
      onState: () => { measurement.eventOrder.push("state"); },
      onPlace: (value, held) => {
        measurement.eventOrder.push("place");
        if (!held) measurement.errors.push("State package unavailable");
        const coverage = held ? client.stateCoverageForZip(held, zip, held.zipPlaces[zip] ?? (value.governingOcdIds ? { ids: value.governingOcdIds, partial: value.partialOcdIds ?? [], samples: 0 } : undefined)) : null;
        const final = { ...value, coverage: client.mergeReaderCoverage(coverage, value.coverage, value.meetings.length) };
        measurement.meetings = final.meetings.length; measurement.bodies = final.coverage?.bodies.length ?? 0;
        if (kind === "cold") { firstPlace = final; firstState = held; }
      },
    }).catch(error => measurement.errors.push(String(error)));
    measurement.usableMs = Math.round(performance.now() - started);
    if (measurement.usableMs >= 3000) measurement.errors.push("Reader result took at least three seconds");
    if (measurement.eventOrder.join(",") !== "state,place") measurement.errors.push("State did not publish before place");
    rounds.push(measurement);
  }
  await round(probe.zip, "cold");
  await round(probe.zip, "repeat");
  const stateValue = firstState as ReaderStateResponse | null;
  const nextZip = [...(await national.readStateZipPlaces(probe.state)).keys()].find(zip => zip !== probe.zip && lookupZcta(zip)?.postal?.state === probe.state);
  if (nextZip) await round(nextZip, "next-zip");
  const result: Result = { state: probe.state, zip: probe.zip, importMs, coldWithImportsMs: importMs + rounds[0]!.usableMs, rounds, errors: rounds.flatMap(row => row.errors) };
  if (result.coldWithImportsMs! >= 3000) result.errors.push("Cold data result including route imports took at least three seconds");
  if (firstPlace) {
    try {
      const baseline: { zip: string; ms?: number; body?: ReaderPayload }[] = arg("before")
        ? JSON.parse(await readFile(resolve(arg("before")!), "utf8"))
        : [{ zip: probe.zip, body: (JSON.parse(await readFile(resolve(arg("before-dir") ?? ".scratch/rs02/baseline-payloads", `${probe.state}.json`), "utf8")) as { place: ReaderPayload }).place }];
      const before = baseline.find(row => row.zip === probe.zip && row.body);
      result.baselineAvailable = !!before;
      if (before?.body) {
        result.baselineMs = before.ms;
        Object.assign(result, missingHeld(before.body, firstPlace));
        if (result.missing?.length) result.errors.push(`${result.missing.length} held items or fields are missing`);
        await mkdir(resolve(".scratch/rs02/after"), { recursive: true });
        await writeFile(resolve(`.scratch/rs02/after/${probe.state}-payload.json`), JSON.stringify({ state: stateValue, place: firstPlace }));
      } else result.errors.push("No usable RS-01 baseline response for this state");
    } catch (error) { result.errors.push(`Baseline comparison unavailable: ${String(error)}`); }
    if (arg("live-before")) {
      try {
        const live = JSON.parse(await readFile(resolve(arg("live-before")!), "utf8")) as { zip: string; body?: ReaderPayload }[];
        const before = live.find(row => row.zip === probe.zip && row.body);
        result.liveBaselineAvailable = !!before;
        if (before?.body) {
          result.liveMissing = missingHeld(before.body, firstPlace).missing;
          if (result.liveMissing.length) result.errors.push(`${result.liveMissing.length} live-held items or fields are missing`);
        }
      } catch (error) { result.errors.push(`Live preservation comparison unavailable: ${String(error)}`); }
    }
  }
  if (probe.zip === "85701" && firstPlace && stateValue) {
    const payload: ReaderPayload = firstPlace;
    const representatives = [...payload.coverage?.seats.filter(seat => seat.divisionType === "cd").flatMap(seat => seat.representatives) ?? [], ...payload.coverage?.senators ?? []];
    result.federal = [];
    for (const holder of representatives) {
      const started = performance.now();
      const response = await directoryRoute(new Request(`http://localhost/api/directory?member=${encodeURIComponent(holder.id)}&state=AZ`));
      const directory = await response.json() as { districtOffices?: { address: string | null; phone: string | null }[] };
      const contactMs = Math.round(performance.now() - started);
      const offices = directory.districtOffices ?? [];
      result.federal.push({ id: holder.id, name: holder.name, offices: offices.length, contactMs });
      if (response.status !== 200 || !offices.length || offices.some(office => !office.address || !office.phone)) result.errors.push(`${holder.name}'s held offices are unavailable`);
      if (contactMs >= 3000) result.errors.push(`${holder.name}'s offices took at least three seconds`);
    }
    if (result.federal.length !== 3) result.errors.push("85701 must show its House member and both senators");
    if (result.federal[0]) {
      const started = performance.now();
      const response = await directoryRoute(new Request(`http://localhost/api/directory?member=${encodeURIComponent(result.federal[0].id)}&state=AZ`));
      await response.json();
      result.federal[0].repeatMs = Math.round(performance.now() - started);
      if (response.status !== 200 || result.federal[0].repeatMs >= 3000) result.errors.push("Reopened House member offices failed or took at least three seconds");
    }
  }
  return result;
}

if (arg("child")) {
  const probe = JSON.parse(arg("child")!) as Probe;
  let result: Result;
  try { result = await child(probe); }
  catch (error) { result = { state: probe.state, zip: probe.zip, errors: [String(error)] }; }
  // The measured reads are complete. A fresh-state test need not wait for the
  // reusable socket's idle timer; flush its evidence before ending this child.
  await new Promise<void>(resolve => process.stdout.write(MARKER + JSON.stringify(result) + "\n", () => resolve()));
  process.exit(0);
} else {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connection);
  const rows = await sql.transaction([sql.query(`SELECT current_user AS role,
    bool_and(has_table_privilege(current_user,tablename,'SELECT')) AS can_read,
    bool_or(has_table_privilege(current_user,tablename,'INSERT,UPDATE,DELETE')) AS can_write
    FROM pg_tables WHERE schemaname='public' AND tablename IN ('entity','fact','source_copy','entity_place','civic_data_promotions','civic_data_payload_parts')`, [])], { readOnly: true });
  const identity = rows[0][0];
  if (identity?.role !== "readonly" || !identity.can_read || identity.can_write) throw new Error("Production connection did not prove read-only privileges for the fact and canonical stores");
  const [{ readNationalShelf }, { readCanonicalShelf }, { readPeopleSourceProjection }, { peopleSourceRecordClass, peopleSourceScope }] = await Promise.all([
    import("../lib/reader/national.ts"), import("../lib/reader/canonical.ts"),
    import("../lib/civic-data/people-source-read.ts"), import("../lib/officials/people-sources.ts"),
  ]);
  const shelf = await readNationalShelf();
  const presidentSources = ["statewide-executive-sources", "wikidata-people"];
  const presidentStore = await readCanonicalShelf(presidentSources.map(source => ({ recordClass: peopleSourceRecordClass(source), scope: peopleSourceScope("US", source) })));
  const presidentReads = await Promise.all(presidentSources.map(source => readPeopleSourceProjection("US", source, { store: presidentStore })));
  const canonicalPresidentIds = [...new Set(presidentReads.flatMap(read => {
    if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return [];
    const roster = read.value.roster;
    return roster.officeholders.filter(person => /^President(?: of the United States)?$/i.test(person.officeTitle) && roster.divisions.some(link =>
      link.officeholderId === person.id && link.ocdId === "ocd-division/country:us" && (!link.membershipId || person.memberships?.find(membership => membership.id === link.membershipId)?.current !== false),
    )).map(person => person.id);
  }))].sort();
  const memoryPresidentIds = [...new Set(shelf.president?.officeholders.map(person => person.id) ?? [])].sort();
  const national = {
    members: new Set(shelf.congress.roster.officeholders.map(row => row.id)).size,
    jurisdictions: shelf.federalByState.size, zipPlaces: shelf.zipPlaces.size,
    president: shelf.president?.officeholders.map(row => row.name) ?? [],
    presidentHeld: memoryPresidentIds.length > 0,
    presidentStatus: memoryPresidentIds.length ? "HELD" : "NOT_RECORDED",
    canonicalPresidentIds,
    presidentSourceGap: memoryPresidentIds.length ? null : "Production holds no verified current President record.",
    membersWithoutHeldOffice: shelf.congress.roster.officeholders.filter(row => !shelf.congress.directory.byMember[row.id.replace(/^congress:/, "")]?.districtOffices.length).map(row => ({ id: row.id, name: row.name })),
    errors: [] as string[],
  };
  if (national.members < 500 || national.jurisdictions < 50 || national.zipPlaces < 40_000) national.errors.push("National shelf is incomplete");
  if (memoryPresidentIds.join("|") !== canonicalPresidentIds.join("|")) national.errors.push("The in-memory President holding does not match the canonical current records");
  const requested = arg("states")?.toUpperCase().split(",");
  const probes = (arg("probes") ? JSON.parse(await readFile(resolve(arg("probes")!), "utf8")) as Probe[] : PROBES).filter(probe => !requested || requested.includes(probe.state));
  if (!probes.length || (!requested && new Set(probes.map(probe => probe.state)).size !== 50)) throw new Error("The full check requires one ZIP in every state");
  const results: Result[] = [];
  await mkdir(resolve(output, ".."), { recursive: true });
  for (const probe of probes) {
    const started = performance.now();
    const result = await new Promise<Result>((done, fail) => {
      const worker = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", process.argv[1]!,
        `--child=${JSON.stringify(probe)}`, ...(arg("before") ? [`--before=${arg("before")}`] : []), ...(arg("before-dir") ? [`--before-dir=${arg("before-dir")}`] : []), ...(arg("live-before") ? [`--live-before=${arg("live-before")}`] : [])], {
        cwd: process.cwd(), env: { ...process.env, NODE_USE_ENV_PROXY: "1" }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      worker.stdout.on("data", data => { stdout += data; }); worker.stderr.on("data", data => { stderr += data; });
      const timeout = setTimeout(() => worker.kill("SIGKILL"), 90_000);
      worker.on("error", fail);
      worker.on("close", code => {
        clearTimeout(timeout);
        const line = stdout.split("\n").find(row => row.startsWith(MARKER));
        if (line) done(JSON.parse(line.slice(MARKER.length)) as Result);
        else done({ state: probe.state, zip: probe.zip, errors: [`Child exited ${code}: ${stderr.slice(-1200)}`] });
      });
    });
    result.processMs = Math.round(performance.now() - started); results.push(result);
    await writeFile(output, JSON.stringify({ checkedAt: new Date().toISOString(), targetHost, role: identity.role, readOnly: true, national, results }, null, 2));
    console.log(`${result.state} ${result.zip}: ${result.rounds?.map(row => `${row.kind} ${row.usableMs} ms`).join(", ") ?? "no result"}; ${result.errors.length ? result.errors.join("; ") : "PASS"}`);
  }
  console.log(`Saved ${results.length} states to ${output}`);
  for (const kind of ["cold", "repeat", "next-zip"] as const) {
    const slowest = results.flatMap(result => result.rounds?.filter(round => round.kind === kind).map(round => ({ state: result.state, ...round })) ?? [])
      .sort((left, right) => right.usableMs - left.usableMs)[0];
    if (slowest) console.log(`Slowest ${kind}: ${slowest.state} ${slowest.zip}, ${slowest.usableMs} ms; state information ${slowest.stateMs} ms`);
  }
  console.log(`${results.filter(result => result.errors.length === 0).length} of ${results.length} states passed the data-handler checks`);
  console.log(`National shelf: ${national.members} members, ${national.zipPlaces} ZIPs; ${national.errors.join("; ") || "PASS"}`);
  if (national.errors.length || results.some(result => result.errors.length)) process.exitCode = 1;
}
