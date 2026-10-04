/** Offline, deterministic state holdings inventory. Only committed readbacks cross the external boundary. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { parseCsv } from "../reference/index.ts";
import { populationLabel, ACQUIRED_CORPORA } from "../candidates/population-label.ts";
import { adaptedSplit, sourcesOf, type JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
import { READER_SURFACES, datasetFamily, validateDatasetMapping } from "./datasets.ts";
import { moduleDatasetInputPaths, readModuleDataset } from "./module-datasets.ts";
import {
  MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  type ManualProductionSourceContract,
} from "../civic-data/manual-contracts.ts";

export const INPUT_PATH = "data/state-holdings/manifest-inputs.json";
export const CONTROL_PATH = "data/state-holdings/control-plane-readback.json";
export const VAULT_PATH = "data/state-holdings/vault-readback.json";
export const PLAN_PATH = "data/state-holdings/move-plan.json";
type Row = Record<string, unknown>;
export interface ExternalSource { store: string; identity: string; schemaVersion: string | number; instrument: string }
export interface ReadbackBase { formatVersion: 1; observed_at: string; source: ExternalSource }
export interface ControlReadback extends ReadbackBase {
  obligations: Row[]; occurrences: Row[]; routeTasks: Row[]; dispositions: Row[]; artifacts: Row[];
  workItems?: Row[];
}
export interface VaultObject { key: string; meta: Row; stateCodes?: string[]; state?: string; originalPath?: string; store?: string; verified?: boolean }
export interface VaultReadback extends ReadbackBase { objects: VaultObject[]; assetSource?: ExternalSource & { observed_at: string; index: string; index_written_at: string }; assetInventory?: Row[]; [key: string]: unknown }
export interface FrozenInputs {
  formatVersion: 1;
  generatedBy: string;
  baseSha: string;
  discoveredStates: string[];
  files: { path: string; basePath: string; sha256: string; source: "SESSION_BASE" | "EXTERNAL_READBACK" }[];
  /**
   * Append-only present-authority classifications for a frozen holding whose
   * tracked path was retired after its exact base bytes were inventoried.
   * The original file/hash row remains immutable historical evidence.
   */
  authorityCutovers?: RuntimeAuthorityCutover[];
  /**
   * Append-only classifications for a frozen static holding whose tracked path
   * was replaced by a successor static holding: the same fact in a new layout.
   * The original file/hash row remains immutable historical evidence.
   */
  supersededHoldings?: SupersededHolding[];
  rule: string;
}
/**
 * A frozen static holding replaced in the repository by a successor holding —
 * as the three-state ZIP index was by one shard per ZIP prefix for every ZIP code
 * (2026-09-23). Its exact frozen bytes stay in Git at a test baseline that the
 * successor's build and tests compare against, and the successor's files are
 * current datasets in their own right.
 */
export interface SupersededHolding {
  formerPath: string;
  frozenSha256: string;
  disposition: "SUPERSEDED_BY_SUCCESSOR_HOLDING";
  successorDirectory: string;
  baselinePath: string;
  reason: string;
}
export interface RuntimeAuthorityCutover {
  formerPath: string;
  frozenSha256: string;
  disposition: "RETIRED_TO_PRODUCTION_DATA_PLANE";
  formerContentDisposition: "NON_SERVING_ACQUISITION_SURPLUS";
  contractId: string;
  recordClass: string;
  scope: string;
  servingSeedPaths: string[];
  readerImplementation: `${string}#${string}`;
  reason: string;
}
export interface ValidatedRuntimeAuthorityCutover {
  classification: RuntimeAuthorityCutover;
  contract: ManualProductionSourceContract;
}
interface MoveEntry {
  oldPath: string;
  newPath?: string | null;
  state?: string | null;
  disposition?: string;
  classification?: string;
  reason?: string;
  sha256?: string;
  referenceCount?: number;
  references?: { path: string; count: number }[];
}
interface Plan { baseSha?: string; baseSHA?: string; rows?: MoveEntry[]; files?: MoveEntry[]; candidates?: MoveEntry[]; moves?: MoveEntry[]; exemptions?: MoveEntry[]; classified?: MoveEntry[]; excluded?: MoveEntry[] }
export interface Dataset {
  path: string;
  family: string;
  domain: string;
  states: string[];
  value: unknown;
  bytes: number;
  sha256: string;
  rowsByState: Map<string, number>;
  totalRows: number;
  unit: string;
}
export interface ManifestContext {
  root: string;
  datasets: Dataset[];
  control: ControlReadback;
  vault: VaultReadback;
  discoveredStates: string[];
  frozen: FrozenInputs | null;
  inputs: { path: string; sha256: string }[];
  authorityCutovers: ValidatedRuntimeAuthorityCutover[];
  supersededHoldings: SupersededHolding[];
  bootstrapFixtureContracts: Map<string, ManualProductionSourceContract[]>;
  obligationStates: Map<string, string[]>;
  workItemStates: Map<string, string[]>;
  vaultStates: Map<string, string[]>;
  assetObjects: VaultObject[];
}

const VALID_STATES = new Set(Object.values(FIPS_TO_STATE).map((s) => s.postal.toLowerCase()));
const asRow = (x: unknown): Row => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
const array = (x: unknown): Row[] => Array.isArray(x) ? x.map(asRow) : [];
const string = (x: unknown): string => typeof x === "string" ? x : "";
const unique = (xs: readonly string[]): string[] => [...new Set(xs)].sort();
const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const normalizeState = (x: unknown): string | null => typeof x === "string" && VALID_STATES.has(x.toLowerCase()) ? x.toLowerCase() : null;

/** Only canonical identity fields are decoded. Free text, URLs and donor locations never create states. */
export function statesFromIdentity(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const hits: string[] = [];
  const direct = normalizeState(value);
  if (direct) hits.push(direct);
  for (const re of [/(?:state|territory|district):([a-z]{2})(?=\/|$|#)/gi, /^([a-z]{2})(?=[:_-])/i, /^ballot-([a-z]{2})-/i, /^curated:([a-z]{2})\//i, /^statewide-([a-z]{2})-/i, /^data\/states\/([a-z]{2})\//i]) {
    for (const match of value.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      const state = normalizeState(match[1]); if (state) hits.push(state);
    }
  }
  return unique(hits);
}

function taggedStates(row: Row): string[] {
  const tags = [...(Array.isArray(row.stateCodes) ? row.stateCodes : []), ...(Array.isArray(row.states) ? row.states : []), ...(Array.isArray(row._manifestStateCodes) ? row._manifestStateCodes : [])];
  const fips = Array.isArray(row.coveredStateFips) ? row.coveredStateFips : [];
  return unique([...tags.flatMap(statesFromIdentity), ...fips.flatMap((code) => FIPS_TO_STATE[string(code)] ? [FIPS_TO_STATE[string(code)].postal.toLowerCase()] : []), ...["stateCode", "state", "jurisdiction", "ocdId", "bodyId", "bodyOcdId", "stateOcdId", "divisionOcdId", "formKey", "contestId", "subjectId", "subject", "id", "canonicalContestId", "candidateKey", "targetKey"].flatMap((key) => statesFromIdentity(row[key]))]);
}

function walkFiles(root: string, dir: string): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walkFiles(root, `${dir}/${entry.name}`) : [`${dir}/${entry.name}`]).sort();
}

function tracked(root: string, ref?: string): string[] {
  return execFileSync("git", ref ? ["ls-tree", "-r", "--name-only", ref] : ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split(/\r?\n/).filter(Boolean).sort();
}

function readJson<T>(root: string, path: string): T { return JSON.parse(readFileSync(join(root, path), "utf8")) as T; }
function entries(plan: Plan): MoveEntry[] { return [...(plan.rows ?? plan.files ?? plan.candidates ?? plan.classified ?? []), ...(plan.moves ?? []), ...(plan.exemptions ?? [])]; }

/**
 * A frozen holding can leave Git only through an exact, fail-closed authority
 * transfer. Its original hash remains in manifest-inputs and the move plan;
 * this classification says why the path is no longer a current dataset and
 * binds the replacement to the executable production contract.
 */
export function validateRuntimeAuthorityCutovers(
  root: string,
  plan: Plan,
  frozen: FrozenInputs | null,
): ValidatedRuntimeAuthorityCutover[] {
  const classifications = frozen?.authorityCutovers ?? [];
  const seen = new Set<string>();
  const planByCurrentPath = new Map(entries(plan).map((entry) => [entry.newPath ?? entry.oldPath, entry]));
  const frozenByPath = new Map((frozen?.files ?? []).map((entry) => [entry.path, entry]));
  return classifications.map((classification) => {
    if (seen.has(classification.formerPath)) throw new Error(`${classification.formerPath}: duplicate runtime-authority cutover classification`);
    seen.add(classification.formerPath);
    if (classification.disposition !== "RETIRED_TO_PRODUCTION_DATA_PLANE") {
      throw new Error(`${classification.formerPath}: unknown runtime-authority cutover disposition`);
    }
    if (classification.formerContentDisposition !== "NON_SERVING_ACQUISITION_SURPLUS") {
      throw new Error(`${classification.formerPath}: former content lacks an explicit non-serving disposition`);
    }
    if (!classification.reason.trim()) throw new Error(`${classification.formerPath}: authority cutover has no reason`);
    const frozenEntry = frozenByPath.get(classification.formerPath);
    if (!frozenEntry || frozenEntry.sha256 !== classification.frozenSha256) {
      throw new Error(`${classification.formerPath}: authority cutover does not bind the exact frozen manifest input`);
    }
    const planEntry = planByCurrentPath.get(classification.formerPath);
    if (!planEntry || planEntry.sha256 !== classification.frozenSha256 || !/exempt/i.test(planEntry.disposition ?? planEntry.classification ?? "")) {
      throw new Error(`${classification.formerPath}: authority cutover does not bind an exact frozen in-place holding`);
    }
    const recordedReferences = planEntry.references ?? [];
    const executableReference = recordedReferences.find(({ path }) => /^(?:app|components|hooks|lib|netlify|scripts)\//.test(path) || /^(?:middleware|next\.config|package)\./.test(path));
    if (
      recordedReferences.reduce((sum, reference) => sum + reference.count, 0) !== planEntry.referenceCount ||
      executableReference
    ) {
      throw new Error(`${classification.formerPath}: non-serving surplus classification conflicts with its frozen consumer census`);
    }
    if (existsSync(join(root, classification.formerPath))) {
      throw new Error(`${classification.formerPath}: retired tracked authority still exists`);
    }
    const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((candidate) => candidate.id === classification.contractId);
    if (
      !contract ||
      contract.recordClass !== classification.recordClass ||
      contract.scope !== classification.scope ||
      contract.classification !== "RUNTIME_CIVIC_DATA" ||
      contract.canonicalProductionStore !== "civic_data_candidates+civic_data_candidate_events+civic_data_promotions" ||
      contract.execution !== "EXPLICIT_OWNER_INVOCATION_ONLY" ||
      !contract.command.some((argument) => argument === "--promote") ||
      contract.bootstrapFixturePaths.some((path) => path === classification.formerPath)
    ) {
      throw new Error(`${classification.formerPath}: permanent production contract does not match the authority cutover`);
    }
    const servingSeedPaths = unique(classification.servingSeedPaths);
    if (
      JSON.stringify(servingSeedPaths) !== JSON.stringify(unique(contract.bootstrapFixturePaths)) ||
      servingSeedPaths.some((path) => !existsSync(join(root, path)))
    ) {
      throw new Error(`${classification.formerPath}: serving first-seed evidence does not match the permanent contract`);
    }
    const [readerPath, readerExport] = classification.readerImplementation.split("#");
    if (!readerPath || !readerExport || !existsSync(join(root, readerPath))) {
      throw new Error(`${classification.formerPath}: permanent Reader implementation does not exist`);
    }
    const readerSource = readFileSync(join(root, readerPath), "utf8");
    const exportPattern = new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${readerExport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!exportPattern.test(readerSource)) {
      throw new Error(`${classification.formerPath}: permanent Reader export is not present`);
    }
    if (servingSeedPaths.some((path) => !readerSource.includes(path.split("/").at(-1)!))) {
      throw new Error(`${classification.formerPath}: serving first-seed evidence is not consumed by the permanent Reader bootstrap`);
    }
    return { classification, contract };
  });
}

/**
 * A frozen holding can also leave its path by being superseded: the same fact
 * re-laid out as a successor holding. Fail-closed like a cutover — the exact
 * frozen hash, an exempt in-place plan row, the old path gone, the frozen bytes
 * kept at a test baseline, and a successor that holds datasets.
 */
export function validateSupersededHoldings(root: string, plan: Plan, frozen: FrozenInputs | null): SupersededHolding[] {
  const classifications = frozen?.supersededHoldings ?? [];
  const cutovers = new Set((frozen?.authorityCutovers ?? []).map((c) => c.formerPath));
  const seen = new Set<string>();
  const planByCurrentPath = new Map(entries(plan).map((entry) => [entry.newPath ?? entry.oldPath, entry]));
  const frozenByPath = new Map((frozen?.files ?? []).map((entry) => [entry.path, entry]));
  for (const c of classifications) {
    const at = c.formerPath;
    if (seen.has(at) || cutovers.has(at)) throw new Error(`${at}: duplicate retirement classification`);
    seen.add(at);
    if (c.disposition !== "SUPERSEDED_BY_SUCCESSOR_HOLDING") throw new Error(`${at}: unknown superseded-holding disposition`);
    if (!c.reason.trim()) throw new Error(`${at}: superseded holding has no reason`);
    const frozenEntry = frozenByPath.get(at);
    if (!frozenEntry || frozenEntry.sha256 !== c.frozenSha256) throw new Error(`${at}: superseded holding does not bind the exact frozen manifest input`);
    const planEntry = planByCurrentPath.get(at);
    if (!planEntry || planEntry.sha256 !== c.frozenSha256 || !/exempt/i.test(planEntry.disposition ?? planEntry.classification ?? "")) {
      throw new Error(`${at}: superseded holding does not bind an exact frozen in-place holding`);
    }
    if (existsSync(join(root, at))) throw new Error(`${at}: superseded tracked holding still exists`);
    const baseline = join(root, c.baselinePath);
    if (!c.baselinePath.startsWith("tests/fixtures/") || !existsSync(baseline) || hash(readFileSync(baseline)) !== c.frozenSha256) {
      throw new Error(`${at}: its exact frozen bytes are not kept at a test baseline`);
    }
    if (!walkFiles(root, c.successorDirectory).some((path) => datasetFamily(path) !== null)) {
      throw new Error(`${at}: its successor holding ${c.successorDirectory} holds no dataset`);
    }
  }
  return classifications;
}

/** Snapshot the base, before the atomic sweep; it does not depend on current moved paths. */
export function snapshotManifestInputs(root: string, baseSha: string): FrozenInputs {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("snapshot requires an exact 40-character base SHA");
  if (existsSync(join(root, INPUT_PATH))) throw new Error("manifest input denominator is already frozen");
  const plan = readJson<Plan>(root, PLAN_PATH);
  if (plan.baseSha !== baseSha) throw new Error("move-plan base does not equal the manifest snapshot base");
  const states: string[] = [];
  const files: FrozenInputs["files"] = [];
  for (const entry of entries(plan)) {
    states.push(...statesFromIdentity(entry.state));
    const bytes = execFileSync("git", ["show", `${baseSha}:${entry.oldPath}`], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    if (/\.(?:json|geojson)$/.test(entry.oldPath)) states.push(...recursiveStates(JSON.parse(bytes.toString("utf8"))));
    if (entry.oldPath.endsWith(".csv")) {
      const [header, ...rows] = parseCsv(bytes.toString("utf8"));
      for (const row of rows) states.push(...taggedStates(Object.fromEntries(header.map((key, i) => [key, row[i] ?? ""]))));
    }
    files.push({ path: entry.newPath ?? entry.oldPath, basePath: entry.oldPath, sha256: hash(bytes), source: "SESSION_BASE" });
  }
  for (const path of [CONTROL_PATH, VAULT_PATH]) {
    const bytes = readFileSync(join(root, path));
    const value = JSON.parse(bytes.toString("utf8"));
    validateReadback(value, path);
    states.push(...recursiveStates(value));
    files.push({ path, basePath: path, sha256: hash(bytes), source: "EXTERNAL_READBACK" });
  }
  const frozen: FrozenInputs = { formatVersion: 1, generatedBy: "scripts/state-manifest.mts --snapshot", baseSha, discoveredStates: unique(states), files: files.sort((a, b) => a.path.localeCompare(b.path)), rule: "Finite session denominator: exact base SHA plus these committed external readback bytes. Later discoveries create future manifest obligations; they do not enlarge this session's denominator unless they falsify A1/A2 or are introduced regressions." };
  mkdirSync(join(root, "data/state-holdings"), { recursive: true });
  writeFileSync(join(root, INPUT_PATH), `${JSON.stringify(frozen, null, 2)}\n`);
  return frozen;
}

/** Domain-level national holdings are retained; operational records and reference prose are not data holdings. */
export function canonicalDatasetPaths(root: string): string[] {
  const plan = existsSync(join(root, PLAN_PATH)) ? readJson<Plan>(root, PLAN_PATH) : {};
  const frozen = existsSync(join(root, INPUT_PATH)) ? readJson<FrozenInputs>(root, INPUT_PATH) : null;
  const retiredPaths = new Set([
    ...validateRuntimeAuthorityCutovers(root, plan, frozen).map(({ classification }) => classification.formerPath),
    ...validateSupersededHoldings(root, plan, frozen).map(({ formerPath }) => formerPath),
  ]);
  const planned = entries(plan).filter((e) => e.newPath || /exempt/i.test(e.disposition ?? e.classification ?? ""));
  const repositoryFiles = tracked(root);
  const base = repositoryFiles.filter((path) =>
    /^data\/(?:ballot|campaign-finance|candidates|congress-legislators|corpus|derived|dotgov|fec|outcomes|prl|reference|votes|zcta)\//.test(path) && /\.(json|csv|geojson)$/.test(path) ||
    /^data\/(meetings-snapshot|voting-sites)\.json$/.test(path) || /^lib\/registry\/[^/]+\.json$/.test(path) || /^public\/geo\/[^/]+\.geojson$/.test(path));
  const oldPaths = new Set([...entries(plan).filter((e) => e.newPath && e.newPath !== e.oldPath).map((e) => e.oldPath), ...(plan.excluded ?? []).map((e) => e.oldPath)]);
  return unique([
    ...base.filter((path) => !oldPaths.has(path) && !retiredPaths.has(path)),
    ...planned.map((entry) => entry.newPath ?? entry.oldPath).filter((path) => !retiredPaths.has(path)),
    ...repositoryFiles.filter((path) => path.startsWith("data/states/")),
  ]);
}

function dataRows(value: unknown, path: string): { rows: Row[]; unit: string } {
  const v = asRow(value);
  if (Array.isArray(v.records) && typeof v.recordUnit === "string") return { rows: array(v.records), unit: v.recordUnit };
  if (v.schemaVersion === 1 && v.records && !Array.isArray(v.records)) {
    const rows = Object.entries(asRow(v.records)).flatMap(([recordExport, value]) => Array.isArray(value)
      ? array(value).map((row) => ({ ...row, ...asRow(row.definition), ...asRow(row.blurb), recordExport }))
      : Object.entries(asRow(value)).flatMap(([tenant, group]) => array(group).map((row) => ({ ...row, tenant, recordExport }))));
    const unit = path.endsWith("cawcd-rosters.json") ? "body rosters" : path.endsWith("body-compositions.json") ? "legal body compositions" : path.endsWith("measure-summaries.json") ? "measure summaries" : path.endsWith("notice-summaries.json") ? "notice summaries" : path.endsWith("venues.json") ? "acquired venue records" : "sourced body descriptions";
    return { rows, unit };
  }
  if (Array.isArray(value)) return { rows: array(value), unit: "records" };
  if (path.startsWith("data/fec/")) return { rows: array(v.candidates), unit: "candidate finance records" };
  if (Array.isArray(v.meetings)) return { rows: array(v.meetings), unit: "meetings" };
  if (Array.isArray(v.candidacies)) return { rows: array(v.candidacies), unit: "candidacies" };
  if (Array.isArray(v.candidates)) return { rows: array(v.candidates), unit: "candidate identities" };
  if (Array.isArray(v.officeholders)) return { rows: array(v.officeholders), unit: "officeholders" };
  if (Array.isArray(v.photos)) return { rows: array(v.photos), unit: "portrait records" };
  if (Array.isArray(v.jurisdictions)) return { rows: array(v.jurisdictions), unit: "jurisdictions" };
  if (Array.isArray(v.divisions)) return { rows: array(v.divisions), unit: "division records" };
  for (const [key, unit] of [["members", "members"], ["officeholders", "officeholders"], ["records", "records"], ["rows", "records"], ["documents", "documents"], ["snapshots", "documents"], ["entities", "entities"], ["electionDomains", "domains"], ["features", "features"], ["locations", "locations"], ["contests", "contests"]]) {
    if (Array.isArray(v[key])) return { rows: array(v[key]), unit };
  }
  if (v.byLocation) return { rows: Object.values(asRow(v.byLocation)).flatMap((x) => array(asRow(x).entities)), unit: "filing entities" };
  if (v.byMember) return { rows: Object.entries(asRow(v.byMember)).map(([id, x]) => ({ id, ...asRow(x) })), unit: "member directories" };
  return { rows: [v], unit: "dataset objects" };
}

function recursiveStates(value: unknown, depth = 0): string[] {
  // Typed identity lists (for example a ZIP → OCD projection) contain strings,
  // not objects. Only these complete namespaces are eligible; prose is not.
  if (typeof value === "string") return /^(?:ocd-division\/|ballot-|curated:|data\/states\/)/.test(value) ? statesFromIdentity(value) : [];
  if (depth > 12 || !value || typeof value !== "object") return [];
  if (Array.isArray(value)) return unique(value.flatMap((x) => recursiveStates(x, depth + 1)));
  const row = asRow(value);
  return unique([...taggedStates(row), ...Object.entries(row).filter(([key]) => !["coordinates", "geometry", "text", "body"].includes(key)).flatMap(([key, child]) => [...statesFromIdentity(key), ...recursiveStates(child, depth + 1)])]);
}

function dataset(root: string, path: string, congressState: Map<string, string>, stateNames: Map<string, string>): Dataset {
  const bytes = readFileSync(join(root, path));
  const extension = extname(path);
  let value: unknown;
  if (extension === ".json" || extension === ".geojson") value = JSON.parse(bytes.toString("utf8"));
  else if (extension === ".csv") {
    const [header, ...rows] = parseCsv(bytes.toString("utf8"));
    value = rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((key, index) => [key, r[index] ?? ""])));
  } else if (extension === ".ts") value = readModuleDataset(root, path);
  else value = { artifact: path };
  const { rows, unit } = dataRows(value, path);
  const fixedState = /^data\/states\/([^/]+)\//.exec(path)?.[1];
  const family = datasetFamily(path);
  const rowsByState = new Map<string, number>();
  const rootStates = taggedStates(asRow(value));
  for (const row of rows) {
    let states = fixedState && VALID_STATES.has(fixedState) ? [fixedState] : taggedStates(row);
    const officeholderBioguide = /^congress:([A-Z]\d{6})$/.exec(string(row.officeholderId ?? row.id))?.[1];
    if (!states.length && officeholderBioguide && congressState.has(officeholderBioguide)) states = [congressState.get(officeholderBioguide)!];
    if (!states.length && path.startsWith("data/congress-legislators/") && congressState.has(string(row.id))) states = [congressState.get(string(row.id))!];
    if (!states.length && row.fips_state && FIPS_TO_STATE[string(row.fips_state).padStart(2, "0")]) states = [FIPS_TO_STATE[string(row.fips_state).padStart(2, "0")].postal.toLowerCase()];
    if (!states.length && stateNames.has(string(row.jurisdiction).toUpperCase())) states = [stateNames.get(string(row.jurisdiction).toUpperCase())!];
    if (!states.length && row.properties) states = taggedStates(asRow(row.properties));
    if (!states.length && rootStates.length) states = rootStates;
    row._manifestStateCodes = unique(states);
    for (const state of unique(states)) rowsByState.set(state, (rowsByState.get(state) ?? 0) + 1);
  }
  let states = fixedState && VALID_STATES.has(fixedState) ? [fixedState] : unique([...rowsByState.keys(), ...(path.startsWith("data/fec/") || path.endsWith("/measure-records-first-seed.json") ? [] : recursiveStates(value))]);
  if (path.includes("/officeholders-") && states.length === 0) states = recursiveStates(value);
  if (path.endsWith("directory.json") && path.startsWith("data/congress-legislators/")) states = unique([...states, ...rowsByState.keys()]);
  return { path, family: family?.id ?? "unmapped", domain: family?.domain ?? (path.split("/")[3] || "unmapped"), states, value, bytes: bytes.length, sha256: hash(bytes), rowsByState, totalRows: rows.length, unit };
}

function validateReadback(value: ReadbackBase, path: string): void {
  if (value.formatVersion !== 1 || !value.observed_at || Number.isNaN(Date.parse(value.observed_at))) throw new Error(`${path}: expected formatVersion 1 and observed_at ISO timestamp`);
  for (const key of ["store", "identity", "schemaVersion", "instrument"] as const) if (value.source?.[key] === undefined || value.source[key] === "") throw new Error(`${path}: missing source.${key}`);
}

export function loadManifestContext(root: string): ManifestContext {
  const control = readJson<ControlReadback>(root, CONTROL_PATH);
  const vault = readJson<VaultReadback>(root, VAULT_PATH);
  const plan = readJson<Plan>(root, PLAN_PATH);
  const frozen = existsSync(join(root, INPUT_PATH)) ? readJson<FrozenInputs>(root, INPUT_PATH) : null;
  const authorityCutovers = validateRuntimeAuthorityCutovers(root, plan, frozen);
  const supersededHoldings = validateSupersededHoldings(root, plan, frozen);
  const bootstrapFixtureContracts = new Map<string, ManualProductionSourceContract[]>();
  for (const contract of MANUAL_PRODUCTION_SOURCE_CONTRACTS) for (const path of contract.bootstrapFixturePaths) {
    bootstrapFixtureContracts.set(path, [...(bootstrapFixtureContracts.get(path) ?? []), contract]);
  }
  validateReadback(control, CONTROL_PATH); validateReadback(vault, VAULT_PATH);
  for (const key of ["obligations", "occurrences", "routeTasks", "dispositions", "artifacts"] as const) if (!Array.isArray(control[key])) throw new Error(`${CONTROL_PATH}: missing ${key} rows`);
  if (!Array.isArray(vault.objects)) throw new Error(`${VAULT_PATH}: missing objects rows`);
  const paths = canonicalDatasetPaths(root);
  const mappingProblems = validateDatasetMapping(paths, (p) => existsSync(join(root, p)));
  if (mappingProblems.length) throw new Error(mappingProblems.join("\n"));
  const congress = existsSync(join(root, "data/congress-legislators/snapshot.json")) ? readJson<Row>(root, "data/congress-legislators/snapshot.json") : {};
  const congressState = new Map(array(congress.members).map((m) => [string(m.bioguide), string(m.state).toLowerCase()]));
  const stateNames = new Map<string, string>();
  const ncesPath = "data/reference/nces_ccd_lea_directory_2025_26.csv";
  if (existsSync(join(root, ncesPath))) {
    const [head, ...rows] = parseCsv(readFileSync(join(root, ncesPath), "utf8"));
    for (const row of rows) { const s = normalizeState(row[head.indexOf("state")]); if (s) stateNames.set(row[head.indexOf("state_name")], s); }
  }
  const datasets = paths.map((p) => dataset(root, p, congressState, stateNames));
  // Scoped records without a state column use exact identities from canonical
  // holdings. ZIPs join the committed ZIP/OCD projection; meeting summaries
  // join meeting IDs (or the same explicit source/tenant scope), never names.
  const identityStates = new Map<string, string[]>();
  const addIdentity = (id: string, states: string[]) => { if (id && states.length) identityStates.set(id, unique([...(identityStates.get(id) ?? []), ...states])); };
  for (const d of datasets) for (const row of dataRows(d.value, d.path).rows) {
    const states = taggedStates(row);
    addIdentity(string(row.id), states);
    for (const member of array(row.members)) addIdentity(string(member.id), states);
    if (d.family === "meetings" && typeof row.id === "string" && row.id.split(":").length >= 3) addIdentity(`sourceTenant:${row.id.split(":").slice(0, 2).join(":")}`, states);
  }
  // The national ZIP index, one shard per two-digit ZIP prefix: each shard lists its divisions once and its ZIPs refer to them by position.
  for (const d of datasets.filter((d) => /^data\/derived\/zip-divisions\/\d{2}\.json$/.test(d.path))) {
    const shard = asRow(d.value);
    const divisions = Array.isArray(shard.divisions) ? shard.divisions.map(String) : [];
    for (const [zip, refs] of Object.entries(asRow(shard.zips))) {
      addIdentity(`zip:${zip}`, Array.isArray(refs) ? unique(refs.flatMap((i) => (divisions[Number(i)] === undefined ? [] : statesFromIdentity(divisions[Number(i)])))) : []);
    }
  }
  for (const d of datasets.filter((d) => d.path.endsWith(".ts"))) {
    const rows = dataRows(d.value, d.path).rows;
    d.rowsByState.clear();
    for (const row of rows) {
      const states = unique([...taggedStates(row), ...(identityStates.get(string(row.id)) ?? []), ...(identityStates.get(string(row.meetingId)) ?? []), ...(typeof row.meetingId === "string" ? identityStates.get(`sourceTenant:${row.meetingId.split(":").slice(0, 2).join(":")}`) ?? [] : []), ...(typeof row.tenant === "string" ? identityStates.get(`sourceTenant:${row.sourceId}:${row.tenant}`) ?? [] : []), ...[row.zip, ...(Array.isArray(row.zips) ? row.zips : [])].flatMap((zip) => identityStates.get(`zip:${zip}`) ?? [])]);
      row._manifestStateCodes = states;
      for (const state of states) d.rowsByState.set(state, (d.rowsByState.get(state) ?? 0) + 1);
    }
    d.states = unique([...d.rowsByState.keys()]);
  }
  const obligationStates = new Map(control.obligations.map((o) => [string(o.id), taggedStates(o)]));
  const workItemStates = new Map((control.workItems ?? []).map((o) => [string(o.id), taggedStates(o)]));
  for (const occurrence of control.occurrences) workItemStates.set(string(occurrence.workItemId), unique([...(workItemStates.get(string(occurrence.workItemId)) ?? []), ...(obligationStates.get(string(occurrence.obligationId)) ?? [])]));
  const movedStates = new Map(entries(plan).filter((e) => e.state).flatMap((e) => [[e.oldPath, e.state!] as const, [e.newPath ?? e.oldPath, e.state!] as const]));
  const portraitStates = new Map<string, string[]>();
  const officialStates = new Map<string, string[]>();
  for (const d of datasets) for (const row of dataRows(d.value, d.path).rows) {
    const stateTags = unique([...taggedStates(row), ...d.states.filter(() => d.states.length === 1)]);
    if (typeof row.id === "string") officialStates.set(row.id, unique([...(officialStates.get(row.id) ?? []), ...stateTags]));
    for (const member of array(row.members)) if (typeof member.id === "string") officialStates.set(member.id, unique([...(officialStates.get(member.id) ?? []), ...stateTags]));
    for (const candidate of [row.photoUrl, row.photo, asRow(row.photo).url]) if (typeof candidate === "string" && candidate.startsWith("/")) portraitStates.set(`public${candidate}`, stateTags);
  }
  const rosterPhotos = asRow(datasets.find((d) => d.path === "lib/registry/roster-photos.json")?.value);
  for (const [id, photo] of Object.entries(rosterPhotos)) if (typeof photo === "string" && photo.startsWith("/") && officialStates.has(id)) portraitStates.set(`public${photo}`, officialStates.get(id)!);
  const assetObjects: VaultObject[] = (vault.assetInventory ?? []).filter((a) => !/^(?:docs|tests|scripts)\//.test(string(a.originalPath))).map((a) => {
    const originalPath = string(a.originalPath);
    const federalId = /^public\/officials\/([A-Z]\d{6})\./.exec(originalPath)?.[1];
    const pluralId = /^public\/officials\/plural-([0-9a-f-]+)\./.exec(originalPath)?.[1];
    const stateCodes = unique([...(movedStates.has(originalPath) ? [movedStates.get(originalPath)!] : []), ...(portraitStates.get(originalPath) ?? []), ...statesFromIdentity(originalPath.replace(/^public\/(?:candidates|officials)\//, "")), ...(federalId && congressState.has(federalId) ? [congressState.get(federalId)!] : []), ...(pluralId ? officialStates.get(`plural:${pluralId}`) ?? [] : [])]);
    return { key: string(a.key), originalPath, stateCodes, store: vault.assetSource?.identity, verified: a.verified === true, meta: { contentHash: a.sha256, byteLength: a.byteLength, storedAt: a.storedAt, custom: { sourceId: "content-addressed asset index", canonicalUrl: originalPath } } };
  });
  const vaultStates = new Map<string, string[]>();
  for (const o of [...vault.objects, ...assetObjects]) vaultStates.set(o.key, unique([...(vaultStates.get(o.key) ?? []), ...taggedStates(o as unknown as Row), ...taggedStates(asRow(o.meta.custom)), ...statesFromIdentity(o.originalPath), ...(workItemStates.get(string(asRow(o.meta.custom).workItemId)) ?? [])]));
  const discoveredStates = unique([...datasets.flatMap((d) => d.states), ...[...obligationStates.values()].flat(), ...[...workItemStates.values()].flat(), ...[...vaultStates.values()].flat()]);
  const inputPaths = unique([...paths, ...moduleDatasetInputPaths(paths), CONTROL_PATH, VAULT_PATH, PLAN_PATH, INPUT_PATH]);
  const inputs = inputPaths.filter((p) => existsSync(join(root, p))).map((path) => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  return { root, datasets, control, vault, discoveredStates, frozen, inputs, authorityCutovers, supersededHoldings, bootstrapFixtureContracts, obligationStates, workItemStates, vaultStates, assetObjects };
}

/** Explicit bootstrap only. Later discoveries never rewrite the session's completion denominator. */
export function freezeManifestInputs(context: ManifestContext, baseSha: string): FrozenInputs {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("snapshot requires an exact 40-character base SHA");
  if (context.frozen) throw new Error("manifest input denominator is already frozen; it may not be silently enlarged");
  const plan = readJson<Plan>(context.root, PLAN_PATH);
  const oldByNew = new Map(entries(plan).filter((e) => e.newPath).map((e) => [e.newPath!, e.oldPath]));
  const atBase = new Set(tracked(context.root, baseSha));
  const files: FrozenInputs["files"] = [];
  for (const current of context.inputs) {
    if (current.path === CONTROL_PATH || current.path === VAULT_PATH) { files.push({ ...current, basePath: current.path, source: "EXTERNAL_READBACK" }); continue; }
    const basePath = oldByNew.get(current.path) ?? current.path;
    if (!atBase.has(basePath)) continue;
    const bytes = execFileSync("git", ["show", `${baseSha}:${basePath}`], { cwd: context.root, maxBuffer: 128 * 1024 * 1024 });
    files.push({ path: current.path, basePath, sha256: hash(bytes), source: "SESSION_BASE" });
  }
  const frozen: FrozenInputs = { formatVersion: 1, generatedBy: "scripts/state-manifest.mts --snapshot", baseSha, discoveredStates: context.discoveredStates, files, rule: "Finite session denominator: exact base SHA plus the committed external readbacks listed here. Subsequent discoveries create future manifest obligations automatically and do not enlarge this session's acceptance denominator unless they falsify A1/A2 or are introduced regressions." };
  mkdirSync(join(context.root, "data/state-holdings"), { recursive: true });
  writeFileSync(join(context.root, INPUT_PATH), `${JSON.stringify(frozen, null, 2)}\n`);
  return frozen;
}

const cell = (x: unknown): string => String(x ?? "not recorded").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const link = (path: string): string => `[${path}](../../${path})`;
export const TRACKED_FIRST_SEED_AUTHORITY_BOUNDARY = "Immutable tracked first-seed/test evidence only — not current mutable authority and not a direct production Reader authority. Production delivery requires the canonical promoted pointer; these bytes can enter that store only through the explicit trusted first-seed adoption path.";
// R16 annotations distinguish cited source clocks/deadlines from authorship stamps.
// These reasons are emitted without consulting today's clock, keeping output stable.
const SOURCE_DATE_REASONS: Readonly<Record<string, string>> = {
  "External observations": "observed_at is copied exactly from the linked readback in UTC; its calendar day can lead America/Phoenix",
  "External asset-store observation": "the linked vault readback supplies the exact UTC observation and asset index date",
  "Canonical datasets and feeds": "recorded observations and source dates are copied from the linked canonical holdings, never stamped by generation",
  "Immutable tracked first-seed/test evidence tagged to this state": "source URL query bounds and civic calendar dates are preserved from immutable first-seed evidence, not asserted as completed work or generation dates",
  "Curated holding records": "record dates and civic calendar dates are preserved from the linked canonical holding",
  "Open route gaps and next_due": "next_due is a future scheduling obligation recorded by the canonical control-plane readback, not a claim of completed work",
  "Control-plane rows without a state identity": "next_due is the scheduling deadline preserved from the canonical control-plane readback",
  "Every state-tagged vaulted acquisition artifact": "source retrieval and UTC vault storage dates are copied from the canonical vault inventory readback",
};
function table(title: string, headers: string[], rows: unknown[][], denominator: string): string[] {
  return [`### ${title}`, "", `${rows.length} of ${rows.length} ${denominator}; every table row is rendered below.`, "", `| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => {
    const line = `| ${row.map(cell).join(" | ")} |`;
    const reason = SOURCE_DATE_REASONS[title];
    return reason && /\b\d{4}-\d{2}-\d{2}/.test(line) ? `${line} <!-- expected-future: ${reason} -->` : line;
  }), ...(rows.length ? [] : ["", "No rows are held in these committed inputs; this is not evidence that the public records do not exist."]), ""];
}
function count(n: number, d: number, unit: string): string { return `${n} of ${d} ${unit}`; }
function observed(value: Row): string {
  return string(value.generatedAt ?? value.fetchedAt ?? value.collectedAt ?? value.acquiredAt ?? value.curatedAt ?? value.generatedOn ?? value.readAt ?? value.readOn ?? value.attemptedAt ?? value.verifiedAt ?? asRow(value.retrieval).retrievedAt ?? asRow(value.source).collectedAt ?? asRow(value.source).readAt) || "not recorded";
}
function datasetObserved(dataset: Dataset): string {
  const rootDate = observed(asRow(dataset.value));
  if (rootDate !== "not recorded") return rootDate;
  const dates = unique(dataRows(dataset.value, dataset.path).rows.map(observed).filter((date) => date !== "not recorded"));
  return dates.length ? dates.join("; ") : "not recorded";
}
function citations(value: unknown, state?: string, path = ""): string {
  const v = asRow(value);
  const candidates = [...array(v.sources).map((s) => string(s.url)), ...array(v.derivedFrom).map((s) => string(s.path)), string(asRow(v.retrieval).url), string(v.sourceUrl), string(asRow(v.source).url ?? asRow(v.source).repoUrl), ...array(v.enumerationSources).map((s) => string(s.path))].filter(Boolean);
  if (!candidates.length) for (const row of dataRows(value, path).rows) {
    const states = taggedStates(row);
    if (state && states.length && !states.includes(state)) continue;
    const p = asRow(row.provenance);
    for (const candidate of [p.sourceUrl, row.documentUrl, row.candidacySourceUrl, row.sourceUrl, row.basisUrl, row.minutesUrl, row.addressSourceUrl, row.coordinateSourceUrl, row.url, typeof row.provenance === "string" ? row.provenance : null]) if (typeof candidate === "string") candidates.push(candidate);
  }
  return unique(candidates).map((p) => p.startsWith("http") ? `[source](${p})` : p.startsWith("data/") ? link(p) : p).join("; ") || "Provenance is in the linked holding; no acquisition date or authority is inferred.";
}
function coverage(dataset: Dataset): { label: string; basis: string } {
  const v = asRow(dataset.value);
  if (Array.isArray(v.derivedFrom) && Array.isArray(v.candidacies)) { const label = populationLabel({ stateCode: string(v.stateCode), cycle: Number(v.cycle), derivedFrom: array(v.derivedFrom).map((r) => ({ path: string(r.path) })) }); return { label: label.provenance, basis: label.authorityLine }; }
  const acquired = ACQUIRED_CORPORA.find((c) => c.path === dataset.path);
  if (acquired) return { label: acquired.provenance, basis: `${acquired.authority}: ${acquired.covers} ${acquired.citation}` };
  if (dataset.family === "identity" && array(v.sources).length) return { label: "PARTIAL_AUTHORITY_ACQUIRED", basis: "Identity population combines source-backed canonical and held projection identities. The acquired corpus and each registry's own denominator are shown separately; no all-offices claim." };
  if (["ballot", "state-money", "candidate-corpus", "meetings", "federal-finance"].includes(dataset.family)) return { label: "PILOT_DERIVED", basis: "Reader/pilot projection. Held rows are its denominator, not the complete state's public-record universe." };
  if (dataset.family === "campaign-finance-corpus") {
    if (Number(v.statedTotalItems) > 0 && Number(v.retrieved) === Number(v.statedTotalItems) && array(v.rows).length === Number(v.statedTotalItems)) return { label: "SOURCE_UNIVERSE_ACQUIRED", basis: `Publisher's filer-index total reconciles: ${v.retrieved} of ${v.statedTotalItems}. This is the index, not every underlying filing.` };
    if (v.byLocation) return { label: "PARTIAL_AUTHORITY_ACQUIRED", basis: "Acquired location slices of the agency corpus. The full filing-location universe is a separate denominator." };
    return { label: "PARTIAL_AUTHORITY_ACQUIRED", basis: "The holding's recorded source, queries, reconciliations and limits define coverage; a statewide route does not establish all records acquired." };
  }
  return { label: "COVERAGE_NOT_ESTABLISHED", basis: "Held reference/registry/acquisition rows only. No source-universe completeness or reader coverage tier is inferred from state-shaped keys." };
}

function currentDisposition(context: ManifestContext, obligation: Row): { verdict: string; note: string; routeTaskId: string; workState: string } {
  const occurrences = context.control.occurrences.filter((o) => o.obligationId === obligation.id).sort((a, b) => string(a.openedAt).localeCompare(string(b.openedAt)) || Number(a.sequence) - Number(b.sequence));
  const last = occurrences.at(-1);
  const task = context.control.routeTasks.find((t) => t.id === last?.routeTaskId);
  const commits = context.control.dispositions.filter((d) => d.routeTaskId === last?.routeTaskId).sort((a, b) => string(a.committedAt).localeCompare(string(b.committedAt)));
  const disposition = asRow(commits.at(-1)?.disposition);
  const work = (context.control.workItems ?? []).find((w) => w.id === last?.workItemId);
  return { verdict: string(disposition.disposition ?? last?.disposition ?? task?.disposition) || "NO_COMMITTED_DISPOSITION", note: string(disposition.note ?? last?.unresolvedReason) || "No committed route result is recorded in this readback.", routeTaskId: string(last?.routeTaskId), workState: string(work?.state) || (obligation.active === false ? "INACTIVE" : "ACTIVE; NO WORK ITEM OBSERVED") };
}

export function renderStateManifest(context: ManifestContext, state: string): string {
  if (!context.frozen) throw new Error("manifest inputs are not frozen; bootstrap with --snapshot --base <SHA>");
  const data = context.datasets.filter((d) => d.states.includes(state));
  const currentData = data.filter((dataset) => !context.bootstrapFixtureContracts.has(dataset.path));
  const bootstrapData = data.filter((dataset) => context.bootstrapFixtureContracts.has(dataset.path));
  const bootstrapAuthority = (dataset: Dataset): string => {
    const contracts = context.bootstrapFixtureContracts.get(dataset.path) ?? [];
    return contracts.map((contract) => `${contract.id}: ${contract.recordClass} / ${contract.scope}; ${contract.canonicalProductionStore}; Reader ${contract.readerProjection.id}`).join("; ");
  };
  const obligations = context.control.obligations.filter((o) => context.obligationStates.get(string(o.id))?.includes(state));
  const vault = [...context.vault.objects, ...context.assetObjects].filter((o) => context.vaultStates.get(o.key)?.includes(state));
  const out = ["<!-- GENERATED by pnpm state-manifest (scripts/state-manifest.mts). DO NOT HAND EDIT. -->", `# ${state.toUpperCase()} — canonical holdings manifest`, "", "The generated answer to “what do we hold for this state?” Registries, acquisitions, snapshots, databases and vaults remain authoritative. This page is a deterministic view of the inputs below, never a second source of truth.", "", `Session base: \`${context.frozen.baseSha}\`.`, `Manifest obligation: ${context.frozen.discoveredStates.includes(state) ? "within the frozen session denominator" : "NEW AFTER SNAPSHOT — durable next obligation, generated automatically"}.`, "Byte-current means current against committed inputs. External observations keep their own observed_at stamps; generation never refreshes them.", ""];
  out.push(...table("External observations", ["Readback", "observed_at", "Source/store identity", "Schema/version", "Read-only instrument"], [[link(CONTROL_PATH), context.control.observed_at, `${context.control.source.store} — ${context.control.source.identity}`, context.control.source.schemaVersion, context.control.source.instrument], [link(VAULT_PATH), context.vault.observed_at, `${context.vault.source.store} — ${context.vault.source.identity}`, context.vault.source.schemaVersion, context.vault.source.instrument]], "external readback artifacts"));
  if (context.vault.assetSource) out.push(...table("External asset-store observation", ["Readback", "observed_at", "Source/store identity", "Schema/version", "Index observation"], [[link(VAULT_PATH), context.vault.assetSource.observed_at, context.vault.assetSource.identity, context.vault.assetSource.schemaVersion, `${context.vault.assetSource.index} recorded ${context.vault.assetSource.index_written_at}`]], "asset-store observations within the vault readback"));
  out.push(...table("Canonical datasets and feeds", ["Dataset", "Domain", "Rows held / file denominator", "Recorded observation", "Reader surfaces", "Provenance / limits"], currentData.map((d) => { const f = datasetFamily(d.path)!; const n = d.rowsByState.get(state); return [link(d.path), d.domain, n !== undefined ? count(n, d.totalRows, d.unit) : `state is tagged in this holding; row partition not declared (${d.totalRows} ${d.unit} in file)`, datasetObserved(d), f.surfaces.map((id) => { const s = READER_SURFACES.find((r) => r.id === id)!; return `[${s.label}](../../${s.path})`; }).join("; ") || "Acquisition inventory — no direct reader surface", `${f.relationship} ${citations(d.value, state, d.path)}`]; }), "current repository dataset files tagged to this state"));
  out.push(...table("Immutable tracked first-seed/test evidence tagged to this state", ["Evidence", "Held row / file denominator", "Permanent production authority", "Authority boundary"], bootstrapData.map((d) => [link(d.path), count(d.rowsByState.get(state) ?? d.totalRows, d.totalRows, d.unit), bootstrapAuthority(d), `${TRACKED_FIRST_SEED_AUTHORITY_BOUNDARY} ${citations(d.value, state, d.path)}`]), "state-tagged tracked first-seed/test evidence files"));
  const sharedUnpartitioned = context.datasets.filter((d) => !d.states.length && !context.bootstrapFixtureContracts.has(d.path));
  out.push(...table("Shared holdings without a state partition", ["Holding", "Held file denominator", "Reader relationship / attribution owed"], sharedUnpartitioned.map((d) => [link(d.path), count(d.totalRows, d.totalRows, d.unit), `${datasetFamily(d.path)!.relationship} This input has no state identity partition; no share is assigned to ${state.toUpperCase()} by inference.`]), "canonical shared inputs without a state partition"));
  const sharedBootstrap = context.datasets.filter((d) => !d.states.length && context.bootstrapFixtureContracts.has(d.path));
  out.push(...table("Shared immutable first-seed/test evidence without a state partition", ["Evidence", "Held file denominator", "Permanent production authority", "Authority / attribution boundary"], sharedBootstrap.map((d) => [link(d.path), count(d.totalRows, d.totalRows, d.unit), bootstrapAuthority(d), `${TRACKED_FIRST_SEED_AUTHORITY_BOUNDARY} This evidence has no state identity partition; no share is assigned to ${state.toUpperCase()} by inference.`]), "shared tracked first-seed/test evidence files without a state partition"));
  out.push(...table(
    "Tracked authorities retired to the production data plane",
    ["Former tracked authority", "Content disposition", "Permanent serving authority", "Only writer", "Reader / serving seed", "LKG / reason"],
    context.authorityCutovers.map(({ classification, contract }) => {
      const [readerPath, readerExport] = classification.readerImplementation.split("#");
      return [
        `\`${classification.formerPath}\` (frozen SHA-256 \`${classification.frozenSha256}\`)`,
        `${classification.disposition}; ${classification.formerContentDisposition}`,
        `${contract.id}: ${contract.recordClass} / ${contract.scope}; ${contract.canonicalProductionStore}`,
        `${contract.execution}: \`${contract.command.join(" ")}\``,
        `${link(readerPath)}#${readerExport}; immutable first-seed/test evidence: ${classification.servingSeedPaths.map(link).join(", ")}; consumers: ${contract.readerProjection.consumers.join(", ")}`,
        `${classification.reason} ${contract.lkgBehavior}`,
      ];
    }),
    "retired tracked authorities with exact permanent data-plane replacements",
  ));
  out.push(...table(
    "Tracked holdings superseded by a successor holding",
    ["Former tracked holding", "Disposition", "Successor holding", "Frozen bytes kept at", "Reason"],
    context.supersededHoldings.map((c) => [`\`${c.formerPath}\` (frozen SHA-256 \`${c.frozenSha256}\`)`, c.disposition, link(c.successorDirectory), link(c.baselinePath), c.reason]),
    "tracked holdings superseded by a successor holding",
  ));
  const curatedDatasets = context.datasets.filter((d) => !context.bootstrapFixtureContracts.has(d.path) && (d.path.endsWith(".ts") || asRow(d.value).schemaVersion === 1 && asRow(d.value).records && !Array.isArray(asRow(d.value).records)));
  const curatedRecords = curatedDatasets.flatMap((d) => dataRows(d.value, d.path).rows.map((row, index) => ({ d, row, index })).filter(({ row }) => taggedStates(row).includes(state) || /^data\/states\/([^/]+)\//.exec(d.path)?.[1] === state));
  const recordName = (row: Row, index: number): string => string(row.bodyId ?? row.id ?? row.meetingId ?? row.formKey ?? row.classKey ?? row.topicId ?? row.officeType ?? row.name ?? row.state) || `${string(row.recordExport) || "record"} #${index + 1}`;
  out.push(...table("Curated holding records", ["Dataset", "Record identity", "Held record denominator", "Membership / detail", "Source / recorded date"], curatedRecords.map(({ d, row, index }) => [link(d.path), recordName(row, index), count(1, d.totalRows, d.unit), Array.isArray(row.members) ? count(row.members.length, row.members.length, "members in this roster; listed below") : Array.isArray(row.steps) ? count(row.steps.length, row.steps.length, "calendar steps in the linked record") : row.holdingStatus ?? row.recordExport ?? d.unit, `${citations({ records: [row] }, state)}; ${observed(row)}`]), "state-attributed curated records"));
  const unpartitionedRecords = curatedDatasets.flatMap((d) => dataRows(d.value, d.path).rows.map((row, index) => ({ d, row, index })).filter(({ row }) => taggedStates(row).length === 0 && !d.path.startsWith("data/states/")));
  out.push(...table("Curated records with national scope or attribution owed", ["Dataset", "Record identity", "Held denominator", "Scope / source"], unpartitionedRecords.map(({ d, row, index }) => [link(d.path), recordName(row, index), count(1, d.totalRows, d.unit), `No state partition is assigned by inference. ${citations({ records: [row] })}`]), "unpartitioned curated records, including national definitions"));
  const rosterMembers = curatedRecords.flatMap(({ d, row }) => array(row.members).map((member) => ({ d, roster: row, member })));
  out.push(...table("Curated roster members", ["Dataset / roster", "Member identity", "Name / role", "Roster denominator", "Source / acquired date"], rosterMembers.map(({ d, roster, member }) => [`${link(d.path)} / ${roster.bodyId}`, member.id, `${member.name} / ${member.officeTitle}`, count(1, array(roster.members).length, "members in this roster"), `${citations({ records: [roster] })}; ${observed(roster)}`]), "held roster member records (assembled rosters and acquired inputs may represent the same person)"));
  const identities = currentData.filter((d) => d.family === "identity" && (Array.isArray(asRow(d.value).candidates) || Array.isArray(asRow(d.value).contests)) || /candidate-universe-/.test(d.path) || d.family === "candidate-acquisitions" || d.family === "ballot" && Array.isArray(asRow(d.value).candidacies));
  out.push(...table("Candidate and contest identity registries", ["Registry / corpus", "Candidate rows / registry denominator", "Contest rows / registry denominator", "Corpus citations"], identities.map((d) => { const v = asRow(d.value); const candidates = array(v.candidates ?? v.candidacies); const contests = Array.isArray(v.contests) ? array(v.contests).length : new Set(candidates.map((c) => string(c.canonicalContestId ?? c.contestIdentityId ?? c.contestId)).filter(Boolean)).size; return [link(d.path), count(candidates.length, candidates.length, "held candidate identities"), count(contests, contests, "held contest identities"), citations(v)]; }), "identity/corpus datasets"));
  const snapshots = currentData.filter((d) => ["state-money", "meetings", "ballot", "federal-finance"].includes(d.family) && (Array.isArray(asRow(d.value).records) || Array.isArray(asRow(d.value).meetings) || Array.isArray(asRow(d.value).candidacies) || d.family === "federal-finance"));
  out.push(...table("Normalized funding, meetings and ballot snapshots", ["Snapshot", "Held state rows / snapshot rows", "Recorded source denominator and limits"], snapshots.map((d) => { const v = asRow(d.value); const split = asRow(v.split); const scope = split.candidaciesInScope ?? "not recorded"; const note = d.family === "state-money" ? `Candidacies in scope: ${scope} of ${scope}; filed ${split.filed ?? "not recorded"} of ${scope}; registered/no activity ${split.registeredNoActivityReported ?? "not recorded"} of ${scope}; no reports ${split.noReportsOnFile ?? "not recorded"} of ${scope}; unresolved ${split.unresolved ?? "not recorded"} of ${scope}. Records and candidacies are different denominators.` : d.family === "meetings" ? `${array(v.agendaDocuments).filter((x) => taggedStates(x).includes(state)).length} of ${array(v.agendaDocuments).length} held agenda documents; configured-source pilot snapshot, not all state meetings.` : "Held reader projection only; every included source/candidate remains cited in the snapshot."; return [link(d.path), count(d.rowsByState.get(state) ?? d.totalRows, d.totalRows, d.unit), note]; }), "normalized snapshot datasets"));
  out.push(...table("Coverage by domain (R-C9)", ["Domain", "Dataset", "Population label", "Denominator / basis"], currentData.map((d) => { const c = coverage(d); return [d.domain, link(d.path), c.label, c.basis]; }), "current repository dataset coverage statements"));
  const jurisdictionRows: unknown[][] = [];
  for (const d of currentData.filter((d) => d.family === "jurisdictions")) {
    const registry = d.value as JurisdictionRegistry; if (!Array.isArray(registry.jurisdictions)) continue;
    const split = adaptedSplit(registry);
    const owed = registry.jurisdictions.filter((j) => sourcesOf(registry, j).some((s) => s.state === "DISCOVERY_OWED")).length;
    jurisdictionRows.push([link(d.path), count(split.enumerated, split.enumerated, "enumerated jurisdictions"), count(split.adapted, split.enumerated, "with any adapted route"), count(split.locallyAdapted, split.enumerated, "with local/county adapted route"), count(owed, split.enumerated, "with discovery owed"), citations(registry)]);
  }
  out.push(...table("Jurisdiction inventory", ["Inventory", "Enumerated", "Adapted", "Locally adapted", "Discovery owed", "Enumeration citations"], jurisdictionRows, "jurisdiction inventories"));
  out.push("Adapted and discovery-owed counts overlap: a jurisdiction may have one executable route and other sources still owed. An adapted statewide source does not make a local custodian adapted.", "");
  const grouped = new Map<string, number>();
  const dispositions = new Map(obligations.map((o) => [string(o.id), currentDisposition(context, o)]));
  for (const o of obligations) { const d = dispositions.get(string(o.id))!; const key = `${o.recordClass}\t${o.active === false ? "INACTIVE" : "ACTIVE"}\t${d.workState}\t${d.verdict}`; grouped.set(key, (grouped.get(key) ?? 0) + 1); }
  out.push(...table("Control-plane obligations by domain and status", ["Domain", "Standing status", "Latest work-item status", "Latest committed route disposition", "Obligations / state denominator"], [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => [...key.split("\t"), count(n, obligations.length, "state-tagged standing obligations")]), "domain/status groups"));
  out.push(`Standing obligations tagged to ${state.toUpperCase()}: ${count(obligations.length, context.control.obligations.length, "observed control-plane obligations")}. Status groups partition that state's standing rows. Route success alone does not establish reader answerability.`, "");
  const unattributedObligations = context.control.obligations.filter((o) => !context.obligationStates.get(string(o.id))?.length);
  out.push(...table("Control-plane rows without a state identity", ["Obligation", "Subject", "Domain", "next_due"], unattributedObligations.map((o) => [o.id, o.subjectId, o.recordClass, o.nextDueAt ?? "not recorded"]), "unattributed standing rows in the control-plane readback"));
  out.push(`${count(unattributedObligations.length, context.control.obligations.length, "standing rows")} have no state identity. These rows remain visible in the readback and are not silently included in any state's obligation count.`, "");
  const gaps = obligations.filter((o) => o.active !== false && !["INGESTED", "NOT_APPLICABLE"].includes(dispositions.get(string(o.id))!.verdict));
  out.push(...table("Open route gaps and next_due", ["Obligation", "Domain / route", "Latest disposition", "next_due", "Recorded gap / next move"], gaps.map((o) => { const d = dispositions.get(string(o.id))!; return [o.id, `${o.recordClass} / ${o.routeId ?? "route discovery owed"}`, d.verdict, o.nextDueAt ?? "NOT RECORDED — scheduling gap remains owed", d.note]; }), "active standing route gaps"));
  out.push(...table("Every state-tagged vaulted acquisition artifact", ["Store / key", "Source / provenance", "Acquired date / vault stamp", "Content / size", "Permission / verification"], vault.map((o) => { const m = o.meta; const custom = asRow(m.custom); return [`${o.store ?? context.vault.source.identity} / ${o.key}`, `${custom.sourceId ?? "source not recorded"}; ${custom.canonicalUrl ?? o.originalPath ?? "URL not recorded"}; work item ${custom.workItemId ?? "not recorded"}; attempt ${custom.attemptId ?? "not recorded"}`, custom.retrievedAt ?? (m.storedAt ? `stored_at ${m.storedAt}; source retrieval date not recorded` : "NOT RECORDED"), `${m.contentHash ?? m.sha256 ?? "hash not recorded"}; ${m.byteLength ?? m.bytes ?? "size not recorded"} bytes; ${custom.tier ?? "tier not recorded"}`, `${custom.permission ?? "permission not recorded"}; ${o.verified === false ? "inventory object not verified" : "observed by inventory instrument"}`]; }), "vault inventory objects tagged to this state"));
  const acquired = context.control.artifacts.filter((a) => (context.workItemStates.get(string(a.workItemId)) ?? taggedStates(a)).includes(state));
  out.push(`Control-plane artifact records: ${count(acquired.length, context.control.artifacts.length, "observed artifact metadata rows")}; vault objects above prove inventory in the observed store. Artifact metadata alone is not proof that bytes are held.`, "");
  out.push(`Unattributed external asset inventory: ${count(context.assetObjects.filter((o) => !context.vaultStates.get(o.key)?.length).length, context.assetObjects.length, "asset-index entries without a state identity join")}. Their verified bytes remain inventoried in ${link(VAULT_PATH)}; assigning these historical assets to a state is a future attribution obligation.`, "");
  out.push("A frozen file remains historical evidence after an authority transfer, but a path classified RETIRED_TO_PRODUCTION_DATA_PLANE is not a current repository holding. That classification is accepted only when its original hash, frozen plan entry, absent tracked path, permanent production contract, promotion-only writer, and Reader export all agree.", "");
  out.push("## Inputs and next obligations", "", `Frozen session denominator: ${link(INPUT_PATH)}. Atomic classification/move plan: ${link(PLAN_PATH)}. Typed reader mapping: ${link("lib/holdings/datasets.ts")}.`, "", "Every future canonical holding under data/states/<st>/ is discovered automatically. A new state's first registry, snapshot, vault artifact or obligation makes its manifest required; --check fails until the generated answer exists. Undeclared dataset-to-surface mappings fail generation and must be classified. External readbacks are refreshed only by their explicit acquisition command, never by generation, handoff --check or CI.", "", `Current discovered manifest universe: ${count(context.discoveredStates.length, context.discoveredStates.length, "states/territories")}: ${context.discoveredStates.map((s) => s.toUpperCase()).join(", ")}.`, `Unattributed vault inventory: ${count(context.vault.objects.filter((o) => !(context.vaultStates.get(o.key)?.length)).length, context.vault.objects.length, "objects without a state join")}. They are retained in ${link(VAULT_PATH)} and never assigned a state by guessing.`, "", "No source-universe completion is claimed for a missing registry, snapshot or route. Open rows above, unprojected acquisitions and absent domain inventories remain owed under the acquisition law.", "");
  return out.join("\n");
}

export function expectedManifests(context: ManifestContext): Map<string, string> {
  return new Map(context.discoveredStates.map((state) => [`docs/states/${state}.md`, renderStateManifest(context, state)]));
}

/** No mkdir, write, network, environment-file read or timestamp stamping on --check. */
export function checkManifests(root: string, expected: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [path, text] of expected) if (!existsSync(join(root, path))) problems.push(`MISSING ${path}`); else if (readFileSync(join(root, path), "utf8") !== text) problems.push(`STALE ${path}`);
  for (const path of walkFiles(root, "docs/states").filter((p) => /\/[a-z]{2}\.md$/.test(p))) if (!expected.has(path)) problems.push(`UNEXPECTED ${path}: no canonical holding discovered`);
  return problems;
}

export function writeManifests(root: string, expected: ReadonlyMap<string, string>): number {
  mkdirSync(join(root, "docs/states"), { recursive: true });
  let changed = 0;
  for (const [path, text] of expected) if (!existsSync(join(root, path)) || readFileSync(join(root, path), "utf8") !== text) { writeFileSync(join(root, path), text); changed++; }
  return changed;
}
