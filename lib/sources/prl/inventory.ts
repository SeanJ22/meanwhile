/**
 * Every downloadable file of America's Political Pulse, one typed row each:
 * URL, native join key and coverage date field.
 *
 * The federal `rhetoric-all*` and state `state-rhetoric-all` files carry a
 * `last_updated` distinct from the publication `date`, because PRL reclassifies
 * old statements; their cursor is `last_updated`, never `date`. The primary and
 * full-text files only append, keyed by a stable row id, and their cursor is
 * `date`. The aggregate profile files are recomputed wholesale each publish
 * (one `communication_last_update` across every row) and are replaced whole.
 */

export const PRL_DATA_BASE = "https://americaspoliticalpulse.com/data/elite/" as const;

/** Where a dataset's rows come to rest. */
export type PrlTarget =
  | "reference" // committed dictionary CSV; field meanings become code
  | "profile" // small per-official aggregate → promotion plane (Postgres)
  | "archive"; // large raw rows → object storage bucket

export type PrlFormat = "csv" | "csv-zip" | "json-zip";

/** The official identity a row keys to. `null` for a dictionary. */
export type PrlKeyField = "bioguide_id" | "openstates_id" | "candidate_id" | "id" | null;

/** Source modification/publication field used for coverage metadata, never an exclusion cursor. */
export type PrlCursorField = "last_updated" | "date" | null;

export interface PrlDataset {
  /** Stable slug used for object keys, contract ids, and scopes. */
  readonly id: string;
  /** The tab and title as the site names it. */
  readonly tab: "federal" | "state" | "meta";
  readonly title: string;
  readonly file: string;
  readonly url: string;
  readonly target: PrlTarget;
  readonly format: PrlFormat;
  readonly key: PrlKeyField;
  /** The source coverage date field. See {@link PrlCursorField}. */
  readonly cursorField: PrlCursorField;
  /** The publication-date column, used for the display-time future-date rule. */
  readonly dateField: string | null;
  /**
   * Whether PRL is known to REVISE existing rows (not merely append). True only
   * where a per-row modification stamp proves it. Drives the row-hash fallback
   * discussion, though `last_updated` is the cheaper instrument where present.
   */
  readonly revises: boolean;
  /** Verbatim from the site, so drift is visible on the next read. */
  readonly declared: {
    readonly sizeLabel: string;
    readonly rows?: string;
    readonly documents?: string;
    readonly officials?: string;
    readonly from: string | null;
    readonly through: string | null;
  };
  /**
   * Dataset identity retained inside the canonical PRL_ARCHIVE manifest.
   * Federal aggregate profiles retain their existing PRL_PROFILE scope.
   */
  readonly scope?: string;
  /** Free-text note carried into the report and code review. */
  readonly note?: string;
}

const u = (file: string): string => `${PRL_DATA_BASE}${file}`;

/** The five data dictionaries; their field meanings are encoded in `dictionaries.ts`. */
export const PRL_DICTIONARIES: readonly PrlDataset[] = [
  { id: "dict-communication", tab: "meta", title: "Communication Data Dictionary (federal classified statements)", file: "communication-meta.csv", url: u("communication-meta.csv"), target: "reference", format: "csv", key: null, cursorField: null, dateField: null, revises: false, declared: { sizeLabel: "2 KB", from: null, through: null } },
  { id: "dict-profiles", tab: "meta", title: "Profiles Data Dictionary (federal legislator profiles)", file: "profiles-meta.csv", url: u("profiles-meta.csv"), target: "reference", format: "csv", key: null, cursorField: null, dateField: null, revises: false, declared: { sizeLabel: "2 KB", from: null, through: null } },
  { id: "dict-primary", tab: "meta", title: "Primary Rhetoric Data Dictionary (2026 primary candidates)", file: "primary-meta.csv", url: u("primary-meta.csv"), target: "reference", format: "csv", key: null, cursorField: null, dateField: null, revises: false, declared: { sizeLabel: "1 KB", from: null, through: null } },
  { id: "dict-state-rhetoric", tab: "meta", title: "Rhetoric Data Dictionary (state classified rhetoric)", file: "state-meta.csv", url: u("state-meta.csv"), target: "reference", format: "csv", key: null, cursorField: null, dateField: null, revises: false, declared: { sizeLabel: "2 KB", from: null, through: null } },
  { id: "dict-state-profiles", tab: "meta", title: "Profiles Data Dictionary (state legislator profiles)", file: "state-profiles-meta.csv", url: u("state-profiles-meta.csv"), target: "reference", format: "csv", key: null, cursorField: null, dateField: null, revises: false, declared: { sizeLabel: "2 KB", from: null, through: null } },
] as const;

/**
 * The three aggregate profile files. PRL has already computed the per-official
 * shares; we read its means, refuse its ranks/percentiles/ideology, and promote
 * the small result. `profiles-all-national` is served through the separate
 * `PRL_PROFILE` path and is listed here only so the inventory is complete.
 */
export const PRL_PROFILES: readonly PrlDataset[] = [
  {
    id: "profiles-current", tab: "federal", title: "Legislator Profiles (Current Members)",
    file: "profiles.zip", url: u("profiles.zip"),
    target: "profile", format: "csv-zip", key: "bioguide_id",
    cursorField: null, dateField: "communication_last_update", revises: false,
    declared: { sizeLabel: "261 KB", officials: "537", from: "2017-06", through: "2026-09" },
    scope: "US:congressional-rhetoric:attributed-profiles:current",
  },
  {
    id: "profiles-national", tab: "federal", title: "Legislator Profiles (All National)",
    file: "profiles-all-national.zip", url: u("profiles-all-national.zip"),
    target: "profile", format: "csv-zip", key: "bioguide_id",
    cursorField: null, dateField: "communication_last_update", revises: false,
    declared: { sizeLabel: "317 KB", officials: "902", from: "2017-06", through: "2026-09" },
    scope: "US:congressional-rhetoric:attributed-profiles",
    note: "Existing shipped path (lib/sources/prl/{snapshot,data-plane}.ts). Acquired by the shared refresh service and promoted through the existing PRL_PROFILE reader.",
  },
  {
    id: "profiles-state", tab: "state", title: "State Legislator Profiles",
    file: "state-profiles.zip", url: u("state-profiles.zip"),
    target: "profile", format: "csv-zip", key: "openstates_id",
    cursorField: null, dateField: null, revises: false,
    declared: { sizeLabel: "844 KB", officials: "7,757", from: "2024-05", through: "2026-09" },
    scope: "US:state-legislative-rhetoric:attributed-profiles",
    note: "openstates_id keyed. Carries within-state rank columns — refused by the allowlist; only the five means promote.",
  },
] as const;

/**
 * The seven large files. Their raw rows land in object storage, never in
 * Postgres; a small receipt (object keys + high-water mark) promotes so the
 * standing runner has a clock and a restart cursor. `primary-rhetoric` is also
 * the source for the primary per-candidate aggregate (there is no primary
 * profile file), so it additionally derives a primary candidate summary.
 */
export const PRL_ARCHIVES: readonly PrlDataset[] = [
  {
    id: "statements-current", tab: "federal", title: "Classified Statements (Current Members)",
    file: "rhetoric-all.zip", url: u("rhetoric-all.zip"),
    target: "archive", format: "csv-zip", key: "bioguide_id",
    cursorField: "last_updated", dateField: "date", revises: true,
    declared: { sizeLabel: "298 MB", rows: "2.2M", from: "2023-01", through: "2026-09" },
    scope: "US:congressional-rhetoric:classified:current",
  },
  {
    id: "statements-national", tab: "federal", title: "Classified Statements (All National)",
    file: "rhetoric-all-national.zip", url: u("rhetoric-all-national.zip"),
    target: "archive", format: "csv-zip", key: "bioguide_id",
    cursorField: "last_updated", dateField: "date", revises: true,
    declared: { sizeLabel: "461 MB", rows: "6.7M", from: "2017-06", through: "2026-09" },
    scope: "US:congressional-rhetoric:classified:national",
  },
  {
    id: "primary-rhetoric", tab: "federal", title: "2026 Primary Candidate Rhetoric",
    file: "primary-rhetoric.zip", url: u("primary-rhetoric.zip"),
    target: "archive", format: "csv-zip", key: "candidate_id",
    cursorField: "date", dateField: "date", revises: false,
    declared: { sizeLabel: "20.8 MB", rows: "262K", from: "2025-10", through: "2026-09" },
    scope: "US:2026-primary-rhetoric:classified",
    note: "Also the source for the per-candidate aggregate (FEC candidate_id keyed); no primary profile file exists.",
  },
  {
    id: "state-rhetoric", tab: "state", title: "State Classified Rhetoric",
    file: "state-rhetoric-all.zip", url: u("state-rhetoric-all.zip"),
    target: "archive", format: "csv-zip", key: "openstates_id",
    cursorField: "last_updated", dateField: "date", revises: true,
    declared: { sizeLabel: "48 MB", rows: "947K", from: "2024-05", through: "2026-09" },
    scope: "US:state-legislative-rhetoric:classified",
    note: "text column blanked for tweets by PRL. Carries last_updated → revises.",
  },
  {
    id: "newsletters", tab: "federal", title: "Newsletters (Full Text)",
    file: "newsletters-fulltext.zip", url: u("newsletters-fulltext.zip"),
    target: "archive", format: "json-zip", key: "bioguide_id",
    cursorField: "date", dateField: "date", revises: false,
    declared: { sizeLabel: "139 MB", documents: "85K", from: "2010-01", through: "2026-09" },
    scope: "US:congressional-newsletters:fulltext",
  },
  {
    id: "press-releases", tab: "federal", title: "Press Releases (Full Text)",
    file: "statements-fulltext.zip", url: u("statements-fulltext.zip"),
    target: "archive", format: "json-zip", key: "bioguide_id",
    cursorField: "date", dateField: "date", revises: false,
    declared: { sizeLabel: "148 MB", documents: "131K", from: "2014-11", through: "2027-07" },
    scope: "US:congressional-press-releases:fulltext",
    note: "Site advertises a range ending Jul 2027 — future. Stored in full; nothing dated after now is displayed or counted. The high-water mark is capped at now so a single future row cannot skip everything after it.",
  },
  {
    id: "floor-speeches", tab: "federal", title: "Floor Speeches (Full Text)",
    file: "floor-fulltext.zip", url: u("floor-fulltext.zip"),
    target: "archive", format: "json-zip", key: "bioguide_id",
    cursorField: "date", dateField: "date", revises: false,
    declared: { sizeLabel: "72 MB", documents: "114K", from: "2022-09", through: "2026-09" },
    scope: "US:congressional-floor-speeches:fulltext",
  },
] as const;

export const PRL_DATASETS: readonly PrlDataset[] = [
  ...PRL_DICTIONARIES,
  ...PRL_PROFILES,
  ...PRL_ARCHIVES,
] as const;

export function prlDataset(id: string): PrlDataset | null {
  return PRL_DATASETS.find((dataset) => dataset.id === id) ?? null;
}

export function requiredPrlDataset(id: string): PrlDataset {
  const dataset = prlDataset(id);
  if (!dataset) throw new Error(`PRL_DATASET_UNKNOWN:${id}`);
  return dataset;
}
