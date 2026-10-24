import defaults from "./kinds/defaults.json" with { type: "json" };

/** Data read for this pass/request. It describes kinds, never legal powers or
 * territorial membership. The existing Admin setting owns changes and undo. */
export type KindGroup = "division" | "body" | "office" | "statement" | "measurePart";
export type KindRow = { readonly key: string; readonly label: string; readonly tier?: "local" | "state" | "national" };
export type KindTable = { readonly [G in KindGroup]: readonly KindRow[] };
export const KINDS_SETTING = "registry.kinds";
export const DEFAULT_KINDS: KindTable = defaults as KindTable;
const groups: readonly KindGroup[] = ["division", "body", "office", "statement", "measurePart"];
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
export function kindTableValid(value: unknown): value is KindTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const table = value as Record<string, unknown>;
  return Object.keys(table).length === groups.length && groups.every(group => {
    const rows = table[group];
    return Array.isArray(rows) && rows.length > 0 && rows.every(row => row && typeof row === "object" &&
      Object.keys(row).every(key => ["key", "label", "tier"].includes(key)) &&
      (row.tier === undefined || group === "division" && ["local", "state", "national"].includes(row.tier)) &&
      typeof row.key === "string" && keyPattern.test(row.key) &&
      typeof row.label === "string" && row.label.trim().length > 0 && row.label.length <= 200) &&
      new Set(rows.map(row => row.key.toLowerCase())).size === rows.length;
  });
}
export function registeredKind(table: KindTable, group: KindGroup, key: unknown): string | null {
  return typeof key === "string" ? table[group].find(row => row.key === key)?.key ?? null : null;
}
/** Literal key/label spelling only. This does not infer a class from a name. */
export function kindFromSource(table: KindTable, group: KindGroup, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const words = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  const matches = table[group].filter(row => [row.key, row.label].some(key => words(key) === words(value)));
  return matches.length === 1 ? matches[0].key : null;
}
export function kindLabel(table: KindTable, group: KindGroup, key: string): string | null {
  return table[group].find(row => row.key === key)?.label ?? null;
}

/** Canonical body identities carry the structural kind independently of their sourced name. */
export function bodyClassFromIdentity(id: string, kind?: string | null, table: KindTable = DEFAULT_KINDS): string | null {
  const suffix = id.split("#")[1] ?? "";
  if (suffix === "governing" || suffix === "board") return "GOVERNING";
  const structural = suffix.replace(/^body:/, "");
  const registered = kindFromSource(table, "body", kind) ?? kindFromSource(table, "body", structural);
  if (registered) return registered;
  if (suffix.startsWith("office-")) return "EXECUTIVE_AGENCY";
  if (/(?:^|[-:])(?:advisory|committee)(?:-|$)/.test(suffix)) return "ADVISORY";
  if (/^(?:(?:city|town|county|village|borough|municipal|common)-council|board-of-(?:supervisors|commissioners|legislators|directors|education)|(?:governing|school)-board|county-commission|town-meeting)(?:-|$)/.test(structural)) return "GOVERNING";
  if (/(?:^|[-:])commission(?:-|$)/.test(suffix)) return "COMMISSION";
  return kind ?? null;
}
