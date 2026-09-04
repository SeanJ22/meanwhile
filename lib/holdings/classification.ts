import { createHash } from "node:crypto";
import { FIPS_TO_STATE } from "../ocd/fips.ts";

export type HoldingDisposition = "MOVE" | "EXEMPT" | "NON_HOLDING";
export interface HoldingClassification {
  oldPath: string;
  state: string | null;
  domain: string;
  newPath: string | null;
  disposition: HoldingDisposition;
  reason: string;
  servingProjection?: string;
  /** Generic code is retained at this distinct consumer path after its data moves. */
  consumerPath?: string;
  holdingSelector?: string;
}
export interface HoldingPlanRow extends HoldingClassification {
  sha256: string;
  bytes: number;
  referenceCount: number;
  references: { path: string; count: number }[];
}
export interface HistoricalReference {
  path: string;
  jsonPointer: string;
  sha256: string;
  reason: string;
  /** An exact immutable adoption-source line, when the authority is TypeScript. */
  sourceText?: string;
}
export interface HoldingMovePlan {
  schemaVersion: 1;
  baseSha: string;
  generatedBy: string;
  universeDefinition: string;
  referenceDefinition: string;
  sourceFiles: { path: string; blob: string }[];
  discoveredStateInputs: { path: string; sha256: string }[];
  discoveredStates: string[];
  rows: HoldingPlanRow[];
  exemptions: HoldingPlanRow[];
  excluded: HoldingPlanRow[];
  allowedHistoricalReferences: HistoricalReference[];
  classificationCorrections?: { reason: string; initialCandidates: number; initialHoldings: number; addedCanonicalModules: number }[];
  counts: { candidates: number; classifiedHoldings: number; moved: number; exempted: number; excluded: number; references: number };
}

export const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

const FIPS: Record<string, string> = Object.fromEntries(Object.entries(FIPS_TO_STATE).map(([fips, state]) => [fips, state.postal.toLowerCase()]));
const STATE_CODES = Object.values(FIPS);
const OPERATIONAL_DOMAINS = new Set(["control-plane", "workstate", "method", "health", "ops", "tracker", "git", "feedback", "fixtures"]);
const HUNT_OPERATIONS = new Set([
  "85641-detective-2026-08-29.json", "85641-obligation-ledger.json", "api-keys-walk.json",
  "argued-absences-03255.json", "argued-absences-07866.json", "ask-walk-0828/captures.json",
  "azleg-walk.log.err", "congress-corpus-walk.json", "map-ask-endpoint-2026-08-28.json",
  "nh-cfs-ladder.json", "nh-remaining-routes.json", "nj-slogan-audit.json",
  "novus-control-2026-08-28.json", "vail-novus-2026-08-28.json",
  "vail-novus-custom-2026-08-28.json", "vail-novus-probe.json",
]);
const HUNT_STATE: Record<string, string> = {
  "kearsarge-bodies.urls": "nh", "merrimack-county-bodies.urls": "nh", "newbury-bodies.urls": "nh",
  "wiki-citation-follow.json": "nj", "lead-promotion-0823.json": "nj",
};

/** The broad candidate universe deliberately includes ambiguous data and serving copies. */
export function isHoldingCandidate(path: string): boolean {
  return path.startsWith("data/") || /^public\/(geo|streets|candidates|officials)\//.test(path)
    || /^lib\/.*\.(?:ts|tsx)$/.test(path)
    || /^lib\/(registry|geo)\/[^/]+\.json$/.test(path)
    || /^states\/[^/]+\/descent\.json$/.test(path)
    || /^[^/]+\.(xlsx|xls|csv|pdf|geojson|jsonl)$/.test(path);
}

export function stateFromLegacyName(file: string): string | null {
  const named = /(?:^|[-_])(az|nh|nj)(?:[-_.]|$)/i.exec(file);
  if (named) return named[1].toLowerCase();
  if (/(?:^|[-_])85641(?:[-_.]|$)|^(pima|vail|azleg)[-_.]/.test(file)) return "az";
  if (/(?:^|[-_])03255(?:[-_.]|$)/.test(file)) return "nh";
  if (/(?:^|[-_])07866(?:[-_.]|$)/.test(file)) return "nj";
  return null;
}

export function classifyHolding(path: string): HoldingClassification {
  const parts = path.split("/");
  const domain = parts[0] === "data" ? parts[1] : parts[0] === "public" ? parts[1] : parts[0] === "lib" ? parts[1] : "reference";
  const relative = parts.slice(2).join("/");
  const file = parts.at(-1)!;
  const result = (disposition: HoldingDisposition, reason: string, state: string | null = null, targetDomain = domain): HoldingClassification => ({
    oldPath: path, state, domain: targetDomain, disposition, reason,
    newPath: disposition === "MOVE" ? `data/states/${state}/${targetDomain}/${file}` : disposition === "EXEMPT" ? path : null,
  });
  if (parts[0] === "lib" && /\.(?:ts|tsx)$/.test(file)) {
    const split: Record<string, [string, string, string, string]> = {
      "rosters-az-cawcd.ts": ["officials", "cawcd-rosters.json", "registry/cawcd-rosters.ts", "AZ_CAWCD_ROSTERS: one sourced body, fifteen current members"],
      "body-composition.ts": ["officials", "body-compositions.json", "registry/body-membership.ts", "BODY_COMPOSITIONS: six source-backed legal compositions"],
      "measure-summaries.ts": ["ballot", "measure-summaries.json", "ballot/measure-summary.ts", "MEASURE_SUMMARIES: eleven sourced Arizona measure summaries"],
      "body-blurbs.ts": ["reference", "body-blurbs.json", "officials/body-description.ts", "BODY_BLURBS and DIVISION_BODY_BLURBS: three sourced descriptions"],
      "notice-summaries.ts": ["meetings", "notice-summaries.json", "meetings/notice-summary.ts", "NOTICE_SUMMARIES: one source-hash-bound TUSD notice summary"],
      "clients.ts": ["meetings", "legistar-venues.json", "sources/legistar/client-registry.ts", "LEGISTAR_CLIENTS: two acquired Pima venue rows; adapter configuration stays in code"],
      "tenants.ts": ["meetings", "insite-venues.json", "sources/legistar-insite/tenant-registry.ts", "INSITE_TENANTS: one acquired Mesa venue row; Pima venue rows derive from the separately held Legistar corpus"],
    };
    const entry = split[file];
    if (entry && (file !== "clients.ts" || parts.slice(1,-1).join("/") === "sources/legistar") && (file !== "tenants.ts" || parts.slice(1,-1).join("/") === "sources/legistar-insite")) {
      return { ...result("MOVE", "A1 correction: this code module itself held canonical single-state sourced data. Move its exact data to JSON, preserve provenance/commentary, and put generic consumer code at a distinct path so the old holding path disappears.", "az", entry[0]), newPath: `data/states/az/${entry[0]}/${entry[1]}`, consumerPath: `lib/${entry[2]}`, holdingSelector: entry[3] };
    }
    const canonical = new Set(["body-rosters.ts", "statewide-executives.ts", "curated-bodies.ts", "comment-access.ts", "tribal-nations.ts", "facts.ts", "election-dates.ts", "polling-place-links.ts", "registration-links.ts", "minutes-summaries.ts", "venue-cache.ts", "campaign-sites.ts", "everyday.ts", "body-definitions.ts", "form-definitions.ts", "office-blurbs.ts"]);
    return canonical.has(file)
      ? result("EXEMPT", "A1 correction: canonical sourced civic records embedded in a genuinely multi-state or national module. Keep the shared corpus in its domain; a typed pure-export adapter inventories its rows and dependency bytes.")
      : result("NON_HOLDING", "Code, types, adapters, configuration, labels, or a generated projection of separately classified source records; it is not itself an authoritative acquired civic dataset.");
  }
  if (parts[0] === "data" && OPERATIONAL_DOMAINS.has(domain)) return result("NON_HOLDING", "Operational control, work, verification, fixture, or project-management record; not a canonical civic data holding.");
  if (parts[0] === "states") return result("NON_HOLDING", "Legacy descent execution/work-state record; canonical civic holdings remain in the source stores.");
  if (parts[0] === "public" && ["candidates", "officials"].includes(domain)) return result("NON_HOLDING", "Deploy-serving portrait copy. Canonical bytes are in the content-addressed external asset store, inventoried by the committed asset manifest.");
  if (parts[0] === "public" && domain === "geo") {
    const state = FIPS[/-([0-9]{2})\.geojson$/.exec(file)?.[1] ?? ""] ?? (file === "body-territories.geojson" ? "az" : null);
    if (!state) return result("EXEMPT", "National or multi-state Census geometry corpus; kept together in its domain folder.");
    return { ...result("MOVE", "State-scoped acquired boundary geometry is canonical resolver data, despite its legacy public serving location.", state), servingProjection: `public/states/${state}/geo/${file}` };
  }
  if (parts[0] === "public" && domain === "streets") {
    const state = /^03/.test(file) ? "nh" : /^0[7]/.test(file) ? "nj" : /^85/.test(file) ? "az" : null;
    if (!state) throw new Error(`Unclassified street-index state: ${path}`);
    return { ...result("MOVE", "Canonical normalized TIGER street-to-jurisdiction index for a single state's ZIP; the client-serving copy is a projection.", state), servingProjection: `public/states/${state}/streets/${file}` };
  }
  if (parts[0] === "lib") {
    const state = FIPS[/^officeholders-([0-9]{2})\.json$/.exec(file)?.[1] ?? ""];
    return state ? result("MOVE", "Canonical normalized state officeholder roster stored beside consumer code.", state, "officials")
      : result("EXEMPT", "National or genuinely multi-state registry, geometry index, roster, or portrait/projection metadata.");
  }
  if (parts.length === 1 && /^nh-village-rates-\d{4}\.xlsx$/.test(file)) return result("MOVE", "Acquired New Hampshire village tax-rate workbook; a source artifact, not a test fixture.", "nh", "reference");
  if (domain === "photos") return result("NON_HOLDING", "Portrait approval workflow, acquisition/review run evidence, or a proposed patch; canonical portrait bytes have a separate asset store.");
  if (domain === "questionnaire") return result("NON_HOLDING", "Unsent invitation workflow/output; not an acquired response or canonical civic holding.");
  if (domain === "hunt" && (HUNT_OPERATIONS.has(relative) || /^vail-novus(?:-custom)?\.json$/.test(file))) return result("NON_HOLDING", "Dated execution, probe, audit, route-description, or verification evidence; not the canonical held civic source corpus.");
  if (domain === "campaign-finance" && (file === "az-route-descriptors.json" || relative.startsWith("route-descriptors/"))) return result("NON_HOLDING", "Unwired route descriptors and operational frontier handoff, not an acquisition artifact or normalized holding.");
  if (domain === "derived" && (file.endsWith(".md") || file.endsWith(".txt") || file === "class-stamp-sweep.json" || relative.startsWith("zip-add/"))) return result("NON_HOLDING", "Generated derivation report, audit, or ZIP-onboarding execution evidence; canonical inputs remain separately inventoried.");
  if (domain === "reference" && file.endsWith(".md")) return result("NON_HOLDING", "Reference dataset documentation; the corresponding data file is independently classified.");
  if (domain === "ballot" && file === "candidate-hunt-state.json") return result("NON_HOLDING", "Per-candidate field-hunt execution state; candidate data and sources live in the canonical ballot/corpus stores.");
  if (domain === "audit" && /^universe-/.test(file)) return result("NON_HOLDING", "Frozen universe-audit execution/evidence artifact; not a canonical registry or acquisition snapshot.");
  const sourceCorpusReasons: Record<string, string> = {
    "azleg-actions-progress.json": "Canonical acquired/extracted session-law chapters and governor letters consumed by hunt-azleg-build-store; progress counters are incidental metadata, not its only content.",
    "nj-hunt4-search.json": "Acquired search-result corpus (URL, title, snippet) consumed by mine-campaign-sites to derive source leads without repeating acquisition.",
    "lead-promotion-0823.json": "Canonical control-checked candidate-site acquisition facts consumed by wire-campaign-sites-0823 to populate sourced candidate links.",
    "lead-adjudication-07866-0825.json": "Normalized source-backed candidate/page identity and campaign-site verdicts consumed by wire-0825; retained acquisition facts, not a gate-run report.",
    "citation-confirmations.json": "Canonical retained confirmations for the New Jersey municipal/candidate corpus, consumed by build-nj-rosters to preserve proved facts through a temporary source outage; all base rows concern New Jersey.",
  };
  if (sourceCorpusReasons[file]) return result("MOVE", sourceCorpusReasons[file], file.startsWith("azleg") ? "az" : "nj");
  const special: Record<string, { state: string; domain: string }> = {
    "gus-2022-merrimack-sullivan-hillsborough.json": { state: "nh", domain: "reference" },
    "krsd-board-2026-08-16.json": { state: "nh", domain: "officials" },
    "special-district-territory.json": { state: "nh", domain: "jurisdictions" },
    "legistar-outcomes.json": { state: "az", domain: "outcomes" },
  };
  if (special[file]) return result("MOVE", "Source-backed civic holding whose single-state scope is established by its canonical rows, although its filename lacks a state code.", special[file].state, special[file].domain);
  const state = domain === "zcta" ? FIPS[/^zcta-([0-9]{2})\.json$/.exec(file)?.[1] ?? ""]
    : domain === "jurisdictions" ? /^(az|nh|nj)\.json$/.exec(file)?.[1]
      : HUNT_STATE[file] ?? stateFromLegacyName(file);
  if (state) return result("MOVE", "State-scoped acquired, extracted, identity, reference, discovery-corpus, or normalized civic holding; preserve its source/provenance when moving.", state);
  return result("EXEMPT", "National or genuinely multi-state canonical corpus/index; a single state's directory would misrepresent its scope.");
}

/** Recognizes future legacy layouts as well as the fixed migration denominator. */
export function isLegacyStateHoldingPath(path: string): boolean {
  if (/^data\/states\//.test(path)) return false;
  if (/^public\/geo\/.+-\d{2}\.geojson$/.test(path) || /^public\/streets\/\d{5}\.json$/.test(path)) return true;
  if (/^lib\/registry\/officeholders-\d{2}\.json$/.test(path)) return true;
  if (new RegExp(`^lib/registry/rosters-(?:${STATE_CODES.join("|")})-.+\\.(?:json|ts)$`).test(path)) return true;
  if (!/^data\/(ballot|campaign-finance|candidates|funding|hunt|identity|jurisdictions|officials|reference|zcta)\//.test(path)) return false;
  if (classifyHolding(path).disposition === "NON_HOLDING") return false;
  const file = path.split("/").at(-1)!;
  if (new RegExp(`(?:^|[-_])(?:${STATE_CODES.join("|")})(?:[-_.]|$)`, "i").test(file)) return true;
  if (/\$\{[^}]*state[^}]*\}|<(?:state|st)>/i.test(file)) return true;
  return /(?:^|[-_])[a-z]{2}(?:[-_]\d{4}|[-_](?:candidate|statewide|county|morris|merrimack|pima))|^state-money-[a-z]{2}-|^zcta-\d{2}\.json$|^[a-z]{2}\.json$/i.test(file)
    || stateFromLegacyName(file) !== null;
}

export interface HoldingPathCheck { checkedFiles: number; expectedHoldings: number; issues: string[]; }

/** An explicit JSON-pointer allowance preserves an immutable historical claim, never an entire directory. */
function withoutHistoricalClaims(path: string, text: string, allowances: HistoricalReference[], issues: string[]): string {
  const matching = allowances.filter((row) => row.path === path && !row.sourceText);
  for (const allowance of allowances.filter((row) => row.path === path && row.sourceText)) {
    const source = allowance.sourceText!;
    if (!allowance.reason.trim() || sha256(source) !== allowance.sha256 || text.split(source).length !== 2) {
      issues.push(`${path}: immutable adoption-source claim is missing, duplicated or changed`);
    } else text = text.replace(source, "[immutable adoption-source line: hash verified]");
  }
  if (!matching.length) return text;
  let value: unknown;
  try { value = path.endsWith(".jsonl") ? text.trim().split(/\r?\n/).map((line) => JSON.parse(line)) : JSON.parse(text); } catch { issues.push(`${path}: historical allowances require JSON-pointer evidence fields`); return text; }
  for (const allowance of matching) {
    if (!allowance.reason.trim() || !allowance.jsonPointer.startsWith("/")) { issues.push(`${path}: invalid historical allowance`); continue; }
    const keys = allowance.jsonPointer.slice(1).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
    let parent = value as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) parent = parent?.[key] as Record<string, unknown>;
    const key = keys.at(-1)!;
    const claim = parent?.[key];
    if (typeof claim !== "string" || sha256(claim) !== allowance.sha256) { issues.push(`${path}${allowance.jsonPointer}: historical claim is missing or changed`); continue; }
    parent[key] = "[immutable historical evidence field: hash verified]";
  }
  return JSON.stringify(value);
}

export function checkHoldingPaths(plan: HoldingMovePlan, files: ReadonlyMap<string, Buffer>, planPath = "data/state-holdings/move-plan.json"): HoldingPathCheck {
  const issues: string[] = [];
  const classified = [...plan.rows, ...plan.exemptions, ...plan.excluded];
  const oldPaths = new Set(classified.map((row) => row.oldPath));
  if (oldPaths.size !== classified.length) issues.push("Move plan contains duplicate candidate paths");
  if (plan.sourceFiles.some((row) => !oldPaths.has(row.path)) || new Set(plan.sourceFiles.map((row) => row.path)).size !== oldPaths.size) issues.push("Move plan source inventory differs from its classification denominator");
  if (plan.counts.classifiedHoldings !== plan.rows.length + plan.exemptions.length
      || plan.counts.moved !== plan.rows.length || plan.counts.exempted !== plan.exemptions.length
      || plan.counts.excluded !== plan.excluded.length || plan.counts.candidates !== classified.length
      || plan.sourceFiles.length !== classified.length) issues.push("Move plan denominator identity failed");
  if (!/^[0-9a-f]{40}$/.test(plan.baseSha)) issues.push("Move plan lacks an exact session base SHA");
  for (const row of plan.rows) {
    if (!row.newPath || !row.state || !row.newPath.startsWith(`data/states/${row.state}/`)) issues.push(`${row.oldPath}: invalid canonical destination`);
    else if (!files.has(row.newPath)) issues.push(`${row.newPath}: planned canonical holding is missing`);
    if (files.has(row.oldPath)) issues.push(`${row.oldPath}: legacy canonical holding still exists`);
  }
  const moved = new Set(plan.rows.map((row) => row.oldPath));
  const exemptions = new Set(plan.exemptions.map((row) => row.oldPath));
  const excluded = new Set(plan.excluded.map((row) => row.oldPath));
  const exactPattern = plan.rows.length ? new RegExp(plan.rows.map((row) => row.oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  let checkedFiles = 0;
  for (const [path, bytes] of files) {
    // The plan is the typed historical mapping itself, not a consumer of its old paths.
    if (path === planPath) continue;
    if (!excluded.has(path) && !exemptions.has(path) && isLegacyStateHoldingPath(path)) issues.push(`${path}: newly introduced legacy state layout`);
    if (bytes.includes(0)) continue;
    checkedFiles++;
    const text = withoutHistoricalClaims(path, bytes.toString("utf8"), plan.allowedHistoricalReferences, issues);
    const found = new Set<string>();
    if (exactPattern) for (const match of text.matchAll(exactPattern)) {
      // A fixture rooted under tests/fixtures is its own path, not the canonical store path.
      const before = text[match.index! - 1];
      if (before === "/" || before === "\\") continue;
      found.add(match[0]);
    }
    const references = text.matchAll(/(?:^|[\s"'`(=])((?:data\/(?:ballot|campaign-finance|candidates|funding|hunt|identity|jurisdictions|officials|reference|zcta)|lib\/registry|public\/(?:geo|streets))\/[^\s"'`),;<>]+)/g);
    for (const match of references) {
      // Record evidence may append a JSON pointer to a holding filename. Classify
      // the file itself; a fragment neither creates a new file nor exempts an old one.
      const reference = match[1].split("#/")[0].replace(/[.:]+$/, "");
      if (moved.has(reference) || (!excluded.has(reference) && !exemptions.has(reference) && isLegacyStateHoldingPath(reference))) found.add(reference);
      if (/^data\/(?:funding|identity|jurisdictions|officials|zcta)\/.*(?:\$\{|<state|<st>)/.test(reference)) found.add(reference);
    }
    // Path.join and path-array readers must not evade the guard by splitting a literal.
    for (const match of text.matchAll(/["'](data|lib|public)["']\s*,\s*["']([a-z-]+)["']\s*,\s*["'`]([^"'`]+)["'`]/g)) {
      const reference = `${match[1]}/${match[2]}/${match[3]}`;
      if (moved.has(reference) || (!excluded.has(reference) && !exemptions.has(reference) && isLegacyStateHoldingPath(reference))) found.add(reference);
    }
    // These former directories held only state datasets. A directory variable
    // plus a later dynamic filename must not evade the full-path checks above.
    for (const match of text.matchAll(/["']data["']\s*,\s*["'](funding|identity|jurisdictions|officials|zcta)["']\s*(?:\)|,\s*[a-zA-Z_$])/g)) {
      found.add(`data/${match[1]} (legacy state-holding directory variable)`);
    }
    for (const match of text.matchAll(/["']data["']\s*,\s*["']ballot["']\s*,\s*([a-zA-Z_$][\w$]*)\s*[,)]/g)) {
      found.add(`data/ballot (dynamic dataset ${match[1]} must resolve through the canonical holding path)`);
    }
    if (/lib\/registry\/\$\{(?:roster|officeholder)[^}]*\}/i.test(text)) found.add("lib/registry (dynamic state roster)");
    if (found.size) issues.push(`${path}: stale state-holding reference(s): ${[...found].sort().join(", ")}`);
  }
  return { checkedFiles, expectedHoldings: plan.rows.length + plan.exemptions.length, issues };
}
