import type { CountProblem } from "../counts/hour.ts";

export interface RunnerRead {
  readonly hour: string;
  readonly database: string;
  readonly job: string;
  readonly table: string;
  readonly file?: string;
  readonly responseBytes: number;
}
export interface RunnerReadFamily {
  readonly family: string;
  readonly readerBytes: number;
  readonly controlPlaneBytes: number;
  readonly jobs: readonly string[];
  readonly files: readonly string[];
  readonly tables: readonly string[];
}

const states = new Set("al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy as gu mp pr vi us".split(" "));
/** State partitions are one job family; an unfamiliar job remains visible. */
export function runnerReadFamily(job: string): string {
  const family = job.split(":")[0].replace(/\.m?[jt]s$/, "");
  const pieces = family.split("-");
  if (pieces.length > 1 && states.has(pieces.at(-1)!.toLowerCase())) pieces.pop();
  if (pieces.length > 1 && states.has(pieces[0].toLowerCase())) pieces.shift();
  return pieces.join("-") || family;
}
export function runnerFamilyLabel(family: string): string {
  return family.replaceAll(/[_:-]+/g, " ").replace(/^./, value => value.toUpperCase());
}
export function runnerReadFamilies(rows: readonly RunnerRead[]): RunnerReadFamily[] {
  const families = new Map<string, { readerBytes: number; controlPlaneBytes: number; jobs: Set<string>; files: Set<string>; tables: Set<string> }>();
  for (const row of rows) {
    const family = runnerReadFamily(row.job);
    const held = families.get(family) ?? { readerBytes: 0, controlPlaneBytes: 0, jobs: new Set(), files: new Set(), tables: new Set() };
    held[row.database === "reader" ? "readerBytes" : "controlPlaneBytes"] += row.responseBytes;
    held.jobs.add(row.job);
    if (row.file) held.files.add(row.file);
    if (row.table) held.tables.add(row.table);
    families.set(family, held);
  }
  return [...families].map(([family, held]) => ({ family, readerBytes: held.readerBytes, controlPlaneBytes: held.controlPlaneBytes,
    jobs: [...held.jobs].sort(), files: [...held.files].sort(), tables: [...held.tables].sort() }))
    .sort((a, b) => b.readerBytes + b.controlPlaneBytes - a.readerBytes - a.controlPlaneBytes || a.family.localeCompare(b.family));
}

export interface RunnerReadComparison {
  readonly database: string;
  readonly job: string;
  readonly responseBytes: number;
  readonly previousBytes: number;
  readonly previousHours: number;
  readonly files: readonly string[];
  readonly tables: readonly string[];
}
const gb = (bytes: number) => (bytes / 1e9).toFixed(3);
/** An hourly report creates repair work, using the preceding 24 complete hours. */
export function runnerReadProblems(rows: readonly RunnerReadComparison[]): CountProblem[] {
  const current = runnerReadFamilies(rows.map(row => ({ ...row, hour: "", table: "" })));
  return current.flatMap(family => {
    const sources = rows.filter(row => runnerReadFamily(row.job) === family.family);
    if (sources.some(row => row.previousHours < 24)) return [];
    const bytes = family.readerBytes + family.controlPlaneBytes;
    const average = sources.reduce((sum, row) => sum + row.previousBytes, 0) / 24;
    if (bytes === 0 || bytes < average * 2) return [];
    const files = [...new Set(sources.flatMap(row => row.files))].sort();
    const tables = [...new Set(sources.flatMap(row => row.tables))].sort();
    const details = `Jobs: ${family.jobs.join(", ")}. Files: ${files.length ? files.join(", ") : "not recorded for this hour"}. Data: ${tables.join(", ") || "not recorded"}.`;
    return [{ key: `runner-reads:${family.family}`, where: `Runner database reads · ${runnerFamilyLabel(family.family)}`,
      says: `${runnerFamilyLabel(family.family)} read ${gb(bytes)} GB in the last full hour (reader ${gb(family.readerBytes)} GB; control plane ${gb(family.controlPlaneBytes)} GB), at least twice its previous 24-hour average of ${gb(average)} GB/hour. ${details}`,
      owner: "the database workers", next: `Repair repeated reads for ${family.jobs.join(", ")}${files.length ? ` in ${files.join(", ")}` : " and restore file attribution"}.` }];
  });
}
