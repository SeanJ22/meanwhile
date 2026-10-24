/** The private list shared by the browser cache and saved-picks store. */
export interface StoredPick {
  contestId: string;
  contestTitle: string;
  /** Selected choice IDs, in tap order. */
  choiceIds: string[];
  labels: Record<string, string>;
}

export interface PicksFile {
  version: 2;
  picks: Record<string, StoredPick>;
  suppressedDerived: Record<string, string[]>;
  unsure?: Record<string, true>;
}

export const emptyPicks = (): PicksFile => ({ version: 2, picks: {}, suppressedDerived: {}, unsure: {} });
export const PRIVATE_PICK_SECRET = /^[A-Za-z0-9_-]{43}$/;
export const MAX_PICKS_BYTES = 256_000;
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9/_.:#=+-]{1,200}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length <= 500;
const choiceId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500 && !["__proto__", "constructor", "prototype"].includes(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 100 && v.every(choiceId) && new Set(v).size === v.length;

/** Rebuild from allowed fields: contact details and other metadata have no storage slot. */
export function parsePicksFile(value: unknown): PicksFile | null {
  if (!record(value) || value.version !== 2 || !record(value.picks) || !record(value.suppressedDerived)) return null;
  if (value.unsure !== undefined && !record(value.unsure)) return null;
  const out = emptyPicks();
  if ([value.picks, value.suppressedDerived, value.unsure ?? {}].some(v => Object.keys(v).length > 1000)) return null;
  for (const [key, pick] of Object.entries(value.picks)) {
    if (!id(key) || !record(pick) || pick.contestId !== key || !text(pick.contestTitle) || !ids(pick.choiceIds) || !record(pick.labels)) return null;
    const labels: Record<string, string> = {};
    for (const choice of pick.choiceIds) {
      if (!text(pick.labels[choice])) return null;
      labels[choice] = pick.labels[choice];
    }
    out.picks[key] = { contestId: key, contestTitle: pick.contestTitle, choiceIds: [...pick.choiceIds], labels };
  }
  for (const [key, choices] of Object.entries(value.suppressedDerived)) {
    if (!id(key) || !ids(choices)) return null;
    out.suppressedDerived[key] = [...choices];
  }
  for (const [key, unsure] of Object.entries(value.unsure ?? {})) {
    if (!id(key) || unsure !== true) return null;
    out.unsure![key] = true;
  }
  return JSON.stringify(out).length <= MAX_PICKS_BYTES ? out : null;
}

export function contestIds(file: PicksFile): string[] {
  return [...new Set([...Object.keys(file.picks), ...Object.keys(file.suppressedDerived), ...Object.keys(file.unsure ?? {})])];
}

/** Replace only the contests this device edited; deletions travel as absent entries in that patch. */
export function applyPickChanges(base: PicksFile, file: PicksFile, changed: readonly string[]): PicksFile {
  const out = structuredClone(base);
  out.unsure ??= {};
  for (const key of changed) {
    delete out.picks[key]; delete out.suppressedDerived[key]; delete out.unsure[key];
    if (file.picks[key]) out.picks[key] = file.picks[key];
    if (file.suppressedDerived[key]) out.suppressedDerived[key] = file.suppressedDerived[key];
    if (file.unsure?.[key]) out.unsure[key] = true;
  }
  return out;
}
