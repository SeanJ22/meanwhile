/**
 * Explicit adapters for repository-owned, offline holding exports. This is not
 * a module loader: adding a canonical TypeScript holding requires a reviewed
 * adapter and its complete runtime dependency list. Imported modules contain
 * constants and pure local transformations, with no database, vault or network
 * reads. Consumer functions are never invoked here.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AREA_FACTS } from "../area/facts.ts";
import { ELECTION_DATES } from "../ballot/election-dates.ts";
import { POLLING_PLACE_LINKS } from "../ballot/polling-place-links.ts";
import { REGISTRATION_LINKS } from "../ballot/registration-links.ts";
import { MINUTES_SUMMARIES } from "../meetings/minutes-summaries.ts";
import { VENUE_CACHE } from "../meetings/venue-cache.ts";
import { CLASS_DEFINITIONS, BODY_KIND_DEFINITIONS, BODY_KINDS, DEPENDENT_SCHOOL_DEFINITION, UNCLASSIFIED_SCHOOL_DEFINITION } from "../officials/body-definitions.ts";
import { CAMPAIGN_SITES } from "../officials/campaign-sites.ts";
import { FORM_DEFINITIONS } from "../officials/form-definitions.ts";
import { OFFICE_BLURBS, DIVISION_OFFICE_BLURBS, STATE_OFFICE_BLURBS } from "../officials/office-blurbs.ts";
import { STATEWIDE_EXECUTIVES } from "../officials/statewide-executives.ts";
import { HELD_BODY_ROSTERS } from "../registry/body-rosters.ts";
import { COMMENT_ACCESS } from "../registry/comment-access.ts";
import { CURATED_BODIES } from "../registry/curated-bodies.ts";
import { TRIBAL_NATIONS } from "../registry/tribal-nations.ts";
import { EVERYDAY_CONTACTS, EVERYDAY_MISSES } from "../routing/everyday.ts";

type Row = Record<string, unknown>;
export interface ModuleDataset {
  readonly path: string;
  readonly exports: readonly string[];
  readonly dependencies: readonly string[];
  readonly unit: string;
  readonly records: readonly Row[];
}

const rows = (value: readonly object[]): Row[] => value.map((row) => ({ ...row }));
const definitions = (value: readonly object[], exportName: string): Row[] => rows(value).map((row) => ({ ...row, ...(row.definition as object ?? {}), recordExport: exportName }));

export const MODULE_DATASETS: readonly ModuleDataset[] = [
  { path: "lib/area/facts.ts", exports: ["AREA_FACTS"], dependencies: [], unit: "sourced area facts", records: AREA_FACTS.flatMap((set) => set.facts.map((fact) => ({ ...fact, state: set.state, id: `${set.state}:${fact.topic}` }))) },
  { path: "lib/ballot/election-dates.ts", exports: ["ELECTION_DATES"], dependencies: [], unit: "state election calendars", records: rows(ELECTION_DATES) },
  { path: "lib/ballot/polling-place-links.ts", exports: ["POLLING_PLACE_LINKS"], dependencies: [], unit: "polling-place lookup records", records: rows(POLLING_PLACE_LINKS) },
  { path: "lib/ballot/registration-links.ts", exports: ["REGISTRATION_LINKS"], dependencies: [], unit: "registration lookup records", records: rows(REGISTRATION_LINKS) },
  { path: "lib/meetings/minutes-summaries.ts", exports: ["MINUTES_SUMMARIES"], dependencies: [], unit: "sourced minutes summaries", records: rows(MINUTES_SUMMARIES) },
  { path: "lib/meetings/venue-cache.ts", exports: ["VENUE_CACHE"], dependencies: ["lib/ocd/curated.ts"], unit: "sourced venue match records", records: rows(VENUE_CACHE) },
  { path: "lib/officials/body-definitions.ts", exports: ["CLASS_DEFINITIONS", "BODY_KIND_DEFINITIONS", "BODY_KINDS", "DEPENDENT_SCHOOL_DEFINITION", "UNCLASSIFIED_SCHOOL_DEFINITION"], dependencies: ["lib/officials/body-description.ts", "data/states/az/reference/body-blurbs.json", "lib/officials/body-form.ts", "lib/officials/form-definitions.ts", "lib/officials/division-government.ts"], unit: "body definitions and explicit body-kind bindings", records: [...definitions(CLASS_DEFINITIONS, "CLASS_DEFINITIONS"), ...definitions(BODY_KIND_DEFINITIONS, "BODY_KIND_DEFINITIONS"), ...BODY_KINDS.map((row) => ({ ...row, recordExport: "BODY_KINDS" })), { ...DEPENDENT_SCHOOL_DEFINITION, recordExport: "DEPENDENT_SCHOOL_DEFINITION" }, { ...UNCLASSIFIED_SCHOOL_DEFINITION, recordExport: "UNCLASSIFIED_SCHOOL_DEFINITION" }] },
  { path: "lib/officials/campaign-sites.ts", exports: ["CAMPAIGN_SITES"], dependencies: [], unit: "verified campaign-site records", records: Object.entries(CAMPAIGN_SITES).map(([id, row]) => ({ id, ...row })) },
  { path: "lib/officials/form-definitions.ts", exports: ["FORM_DEFINITIONS"], dependencies: [], unit: "sourced government-form definitions", records: definitions(FORM_DEFINITIONS, "FORM_DEFINITIONS") },
  { path: "lib/officials/office-blurbs.ts", exports: ["OFFICE_BLURBS", "DIVISION_OFFICE_BLURBS", "STATE_OFFICE_BLURBS"], dependencies: [], unit: "office-description records", records: [...Object.entries(OFFICE_BLURBS).map(([id, row]) => ({ id, ...row, recordExport: "OFFICE_BLURBS" })), ...DIVISION_OFFICE_BLURBS.map((row) => ({ ...row, ...row.blurb, recordExport: "DIVISION_OFFICE_BLURBS" })), ...STATE_OFFICE_BLURBS.map((row) => ({ ...row, ...row.blurb, recordExport: "STATE_OFFICE_BLURBS" }))] },
  { path: "lib/officials/statewide-executives.ts", exports: ["STATEWIDE_EXECUTIVES"], dependencies: ["lib/officials/lookup.ts", "lib/officials/campaign-sites.ts"], unit: "statewide executive officeholders", records: STATEWIDE_EXECUTIVES.map((row) => ({ ...row, ...row.holder })) },
  { path: "lib/registry/body-rosters.ts", exports: ["HELD_BODY_ROSTERS"], dependencies: ["lib/registry/roster-photos.json", "lib/registry/cawcd-rosters.ts", "data/states/az/officials/cawcd-rosters.json", "lib/registry/rosters-nj-morris.ts"], unit: "assembled body rosters", records: rows(HELD_BODY_ROSTERS) },
  { path: "lib/registry/comment-access.ts", exports: ["COMMENT_ACCESS"], dependencies: [], unit: "body public-comment rules", records: rows(COMMENT_ACCESS) },
  { path: "lib/registry/curated-bodies.ts", exports: ["CURATED_BODIES"], dependencies: [], unit: "curated body identities", records: rows(CURATED_BODIES) },
  { path: "lib/registry/tribal-nations.ts", exports: ["TRIBAL_NATIONS"], dependencies: [], unit: "named sovereign tribal nations", records: rows(TRIBAL_NATIONS) },
  { path: "lib/routing/everyday.ts", exports: ["EVERYDAY_CONTACTS", "EVERYDAY_MISSES"], dependencies: [], unit: "contact or explicitly owed routing records", records: [...EVERYDAY_CONTACTS.map((row) => ({ ...row, holdingStatus: "CONTACT_HELD" })), ...EVERYDAY_MISSES.map((row) => ({ ...row, holdingStatus: "CONTACT_OWED" }))] },
];

const MODULE_ROOT = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const supportingPaths = [...new Set(["lib/holdings/module-datasets.ts", ...MODULE_DATASETS.flatMap((entry) => [entry.path, ...entry.dependencies])])].sort();
// Capture the bytes backing this process's imported values. A reused process
// must not render cached exports after those sources have changed on disk.
const loadedHashes = new Map(supportingPaths.map((path) => [path, existsSync(join(MODULE_ROOT, path)) ? digest(join(MODULE_ROOT, path)) : null]));

export function moduleDatasetInputPaths(paths: readonly string[]): string[] {
  const selected = MODULE_DATASETS.filter((entry) => paths.includes(entry.path));
  return [...new Set(selected.flatMap((entry) => [entry.path, ...entry.dependencies]))].sort();
}

export function readModuleDataset(root: string, path: string): { records: Row[]; recordUnit: string; moduleExports: readonly string[] } {
  const adapter = MODULE_DATASETS.find((entry) => entry.path === path);
  if (!adapter) throw new Error(`canonical TypeScript dataset has no reviewed export adapter: ${path}`);
  if (realpathSync(root) !== MODULE_ROOT) throw new Error(`canonical module context root differs from imported source root: ${path}`);
  for (const input of ["lib/holdings/module-datasets.ts", adapter.path, ...adapter.dependencies]) {
    const expected = loadedHashes.get(input);
    if (!expected || !existsSync(join(root, input)) || digest(join(root, input)) !== expected) throw new Error(`canonical module source hash differs from imported bytes: ${input}; restart generation after source edits`);
  }
  return { records: structuredClone(adapter.records) as Row[], recordUnit: adapter.unit, moduleExports: adapter.exports };
}
