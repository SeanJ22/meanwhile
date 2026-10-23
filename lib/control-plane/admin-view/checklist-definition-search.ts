import { CHECKLIST_PROFILE } from "../readiness/checklist-score.ts";
export const CHECKLIST_DEFINITION_MAX_PAGE_SIZE = 50;
const CURSOR_FORMAT = 1;

type Definition = (typeof CHECKLIST_PROFILE.definitions)[number];
export interface ChecklistDefinitionQuery {
  readonly q: string;
  readonly group: string | null;
  readonly id: string | null;
  readonly limit: number;
  readonly cursor: string | null;
}
export interface ChecklistDefinitionPage {
  readonly profile: string;
  readonly sourceSha256: string;
  readonly overlapVersion: string;
  readonly definitionScope: "NATIONAL_ADOPTED_PROFILE";
  readonly definitionsTotal: number;
  readonly matchedTotal: number;
  readonly rows: readonly Definition[];
  readonly nextCursor: string | null;
  readonly query: Omit<ChecklistDefinitionQuery, "cursor">;
  readonly instances: {
    readonly state: "NOT_READ_BY_THIS_ENDPOINT";
    readonly total: null;
    readonly applicable: null;
    readonly unresolvedApplicability: null;
    readonly periods: null;
    readonly says: string;
  };
}

export class ChecklistDefinitionQueryError extends Error {
  readonly code: "INVALID_QUERY" | "INVALID_CURSOR";
  constructor(code: "INVALID_QUERY" | "INVALID_CURSOR", message: string) {
    super(message);
    this.code = code;
  }
}

const definitions = [...CHECKLIST_PROFILE.definitions].sort((a, b) => a.id.localeCompare(b.id));
const ids = new Set(definitions.map(row => row.id));
if (definitions.length !== CHECKLIST_PROFILE.definitionCount || ids.size !== definitions.length) {
  throw new Error("CHECKLIST_ADOPTED_DEFINITION_POPULATION_INVALID");
}
const groups = new Set(definitions.map(row => row.group));

type Cursor = { readonly format: 1; readonly profile: string; readonly q: string;
  readonly group: string | null; readonly id: string | null; readonly after: string };

function decodeCursor(raw: string, query: Omit<ChecklistDefinitionQuery, "cursor">): Cursor {
  if (raw.length > 600 || !/^[A-Za-z0-9_-]+$/.test(raw))
    throw new ChecklistDefinitionQueryError("INVALID_CURSOR", "This page link is invalid. Start the search again.");
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error("NONCANONICAL_CURSOR");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch { throw new ChecklistDefinitionQueryError("INVALID_CURSOR", "This page link is invalid. Start the search again."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ChecklistDefinitionQueryError("INVALID_CURSOR", "This page link is invalid. Start the search again.");
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join("|") !== "after|format|group|id|profile|q" ||
    value.format !== CURSOR_FORMAT || value.profile !== CHECKLIST_PROFILE.version ||
    value.q !== query.q || value.group !== query.group || value.id !== query.id ||
    typeof value.after !== "string" || !ids.has(value.after))
    throw new ChecklistDefinitionQueryError("INVALID_CURSOR", "This page link belongs to another search or checklist version. Start the search again.");
  return value as Cursor;
}

function encodeCursor(query: Omit<ChecklistDefinitionQuery, "cursor">, after: string): string {
  return Buffer.from(JSON.stringify({ format: CURSOR_FORMAT, profile: CHECKLIST_PROFILE.version,
    q: query.q, group: query.group, id: query.id, after }), "utf8").toString("base64url");
}

/** Pure, fixed-population search. The returned count is definitions, never inferred civic instances. */
export function searchChecklistDefinitions(input: ChecklistDefinitionQuery): ChecklistDefinitionPage {
  const q = input.q.trim().toLocaleLowerCase("en-US");
  const group = input.group?.trim().toUpperCase() || null;
  const id = input.id?.trim().toUpperCase() || null;
  if (q.length > 100 || (group !== null && !groups.has(group)) ||
    (id !== null && !/^[A-Z]+-[0-9]{2}$/.test(id)) ||
    !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > CHECKLIST_DEFINITION_MAX_PAGE_SIZE)
    throw new ChecklistDefinitionQueryError("INVALID_QUERY", "Use a search of at most 100 characters, a listed group or ID, and a page size from 1 to 50.");
  const query = { q, group, id, limit: input.limit };
  const matched = definitions.filter(row => (!group || row.group === group) && (!id || row.id === id) &&
    (!q || `${row.id} ${row.group} ${row.requirement} ${row.canonicalPredicate} ${row.owner}`.toLocaleLowerCase("en-US").includes(q)));
  const after = input.cursor ? decodeCursor(input.cursor, query).after : null;
  const at = after === null ? 0 : matched.findIndex(row => row.id === after) + 1;
  if (after !== null && at === 0)
    throw new ChecklistDefinitionQueryError("INVALID_CURSOR", "This page link no longer belongs to the matching definitions. Start the search again.");
  const rows = matched.slice(at, at + input.limit);
  const nextCursor = at + rows.length < matched.length && rows.length ? encodeCursor(query, rows.at(-1)!.id) : null;
  return { profile: CHECKLIST_PROFILE.version, sourceSha256: CHECKLIST_PROFILE.sourceSha256,
    overlapVersion: CHECKLIST_PROFILE.overlapVersion, definitionScope: "NATIONAL_ADOPTED_PROFILE",
    definitionsTotal: definitions.length, matchedTotal: matched.length, rows, nextCursor, query,
    instances: { state: "NOT_READ_BY_THIS_ENDPOINT", total: null, applicable: null,
      unresolvedApplicability: null, periods: null,
      says: "This search covers the complete adopted wording. It has not read per-place, per-object or per-period evidence; those counts and applicability remain unknown here." } };
}
