/** Publish already acquired office evidence and future refresh routes through the standing data stores. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { votingFailureDetail } from "../lib/ballot/voting-errors.ts";
import { readLocalElectionOfficeRoutes, saveLocalElectionOfficeRoutes } from "../lib/sources/local-election-offices/doors.ts";
import { mergeLocalElectionOfficeRows } from "../lib/sources/local-election-offices/refresh.ts";
import { localElectionOfficesCandidate, prepareLocalElectionOfficeProjection, readLocalElectionOfficeDocuments, type LocalElectionOfficePayload } from "../lib/sources/local-election-offices/publication.ts";
import { localElectionOfficesContractId, localElectionOfficesScope, requireLocalElectionOfficeState } from "../lib/sources/local-election-offices/targets.ts";
import type { LocalElectionOfficeFile } from "../lib/sources/local-election-offices/model.ts";
import type { LocalElectionOfficeRoute } from "../lib/sources/local-election-offices/routes.ts";
import { loadLocalElectionOfficeReplayDocuments, type ReplayPartition } from "./eo01-replay.mts";

type ImportPartition = ReplayPartition & { routes: string[] };
const json = async <T,>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;

export function localElectionOfficeImportArguments(args: readonly string[]): { manifest: string; state?: string } {
  const manifest = args.filter(arg => arg.startsWith("--manifest=")), states = args.filter(arg => arg.startsWith("--state="));
  if (args.filter(arg => arg === "--promote").length !== 1 || manifest.length !== 1 || !manifest[0].slice(11) || states.length > 1 || args.some(arg => arg !== "--promote" && !arg.startsWith("--manifest=") && !arg.startsWith("--state="))) throw new Error("Held local election-office import requires --promote --manifest=<file> and optional --state=XX.");
  return { manifest: manifest[0].slice(11), ...(states.length ? { state: requireLocalElectionOfficeState(states[0].slice(8)) } : {}) };
}

async function productionStores() {
  // Resolve every required production handle before writing either data or doors.
  const vault = rawCaptureVault();
  if (process.env.WTP_RUNTIME_MODE === "staging") throw new Error("Held office import requires the sanctioned production write handle.");
  const handle = prepareProductionCivicDataWrite();
  const { controlPlaneUrlFromEnv, createPgRepositories } = await import("../lib/control-plane/repository/pg-store.ts");
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("The production Door Registry connection is unavailable; no offices or routes were written.");
  if (new URL(connection).hostname.replace("-pooler.", ".") === new URL(handle.connection).hostname.replace("-pooler.", ".")) throw new Error("Reader and Door Registry connections must name separate production databases.");
  installNeonRequestDeadline();
  const reader = neon(handle.connection), control = neon(connection);
  const [readerIdentity, controlIdentity] = await Promise.all([
    reader.transaction([reader.query(`SELECT current_user AS role,
      has_table_privilege(current_user,'public.civic_data_candidates','INSERT') AND has_table_privilege(current_user,'public.civic_data_candidates','UPDATE')
      AND has_table_privilege(current_user,'public.civic_data_promotions','INSERT') AND has_table_privilege(current_user,'public.civic_data_promotions','UPDATE') AS writable`, [])], { readOnly: true }),
    control.transaction([control.query(`SELECT current_user AS role,
      has_table_privilege(current_user,'public.cp_doors','INSERT') AND has_table_privilege(current_user,'public.cp_doors','UPDATE') AS writable`, [])], { readOnly: true }),
    vault.head("project/freshness/source/local-election-offices/import-readiness"),
  ]);
  if (readerIdentity[0]?.[0]?.writable !== true || controlIdentity[0]?.[0]?.writable !== true) throw new Error("The production office or Door Registry write privileges are unavailable; nothing was written.");
  const repos = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  return { vault, store: new PostgresRoutineDataStore(), doors: repos.doors };
}

async function routesFor(entry: ImportPartition): Promise<LocalElectionOfficeRoute[]> {
  const byId = new Map<string, LocalElectionOfficeRoute>();
  for (const path of entry.routes ?? []) {
    const value = await json<LocalElectionOfficeRoute | LocalElectionOfficeRoute[]>(path);
    for (const route of Array.isArray(value) ? value : [value]) {
      if (route.state !== entry.state || !route.id || !route.publisher || !route.extraction?.fields || !["http:", "https:"].includes(new URL(route.url).protocol) || !["http:", "https:"].includes(new URL(route.directoryUrl).protocol)) throw new Error(`Invalid held office route in ${path}.`);
      const previous = byId.get(route.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(route)) throw new Error(`Conflicting held office route: ${route.id}.`);
      byId.set(route.id, route);
    }
  }
  if (!byId.size) throw new Error(`No future refresh routes were supplied for ${entry.state}.`);
  return [...byId.values()];
}

export async function importLocalElectionOffices(args: readonly string[]) {
  const options = localElectionOfficeImportArguments(args), manifest = await json<ImportPartition[]>(options.manifest);
  const entries = manifest.filter(entry => !options.state || entry.state === options.state);
  if (!entries.length) throw new Error("No matching held office state partitions were supplied.");
  const { vault, store, doors } = await productionStores();
  let failures = 0;
  for (const entry of entries) {
    try {
      const state = requireLocalElectionOfficeState(entry.state), incoming = await json<LocalElectionOfficeFile>(entry.file);
      if (incoming.state !== state) throw new Error("Held office data belongs to another state.");
      const [routes, previousRoutes, incomingDocuments, previous] = await Promise.all([
        routesFor(entry), readLocalElectionOfficeRoutes(doors, state), loadLocalElectionOfficeReplayDocuments(entry.documents), store.readPromotion<LocalElectionOfficeFile>("CURATED_READER_RECORD", localElectionOfficesScope(state)),
      ]);
      const previousCandidate = previous ? await store.readCandidate(previous.versionId) : null;
      const oldPayload = previousCandidate?.candidate.normalizedPayload as LocalElectionOfficePayload | undefined;
      const previousDocuments = oldPayload?.documents ? await readLocalElectionOfficeDocuments(vault, oldPayload.documents) : [];
      const documents = [...new Map([...previousDocuments, ...incomingDocuments].map(document => [`${document.url}:${document.documentHash}`, document])).values()];
      const offices = new Map((previous?.payload.offices ?? []).map(office => [office.id, office]));
      for (const office of incoming.offices) offices.set(office.id, mergeLocalElectionOfficeRows(offices.get(office.id), office));
      const at = new Date().toISOString();
      const prepared = prepareLocalElectionOfficeProjection({ projection: { ...incoming, checkedAt: at, offices: [...offices.values()] }, documents, previous: previous?.payload });
      if (!prepared.projection.offices.length) throw new Error("No acquired office has a verified directory membership and office name; existing records remain published.");
      // The strict constructor rechecks the isolated valid fields before the first evidence write.
      const candidate = await localElectionOfficesCandidate({ vault, projection: prepared.projection, documents, previous: previous?.payload });
      const refreshRoutes = [...new Map([...previousRoutes, ...routes].map(route => [route.id, route])).values()];
      await saveLocalElectionOfficeRoutes(doors, state, refreshRoutes, at);
      const outcome = await processRegisteredRoutineCandidate(store, localElectionOfficesContractId(state), candidate, at, previous?.versionId, { vault });
      console.log(`LOCAL_ELECTION_OFFICE_IMPORT=${JSON.stringify({ state, acquired: incoming.offices.length, publishedOffices: prepared.projection.offices.length, openFields: prepared.projection.blanks?.length ?? 0, sourceIssues: prepared.issues.length, routes: refreshRoutes.length })}`);
      printSourceRunnerReceipt(localElectionOfficesContractId(state), candidate, outcome);
      if (!outcome.promoted && !outcome.confirmed) failures++;
    } catch (error) {
      failures++;
      console.error(JSON.stringify({ state: entry.state, stage: "held-office-import", detail: votingFailureDetail(error) }));
    }
  }
  if (failures) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await importLocalElectionOffices(process.argv.slice(2));
