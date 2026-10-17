import {
  projectFieldManual,
  type FieldManualEntry,
  type FieldManualProjection,
  type FieldManualQuery,
  type FieldManualRead,
} from "../field-manual.ts";

import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { stateOfPlace } from "../../method/fix-map.ts";

const STATE_CODES=new Set(Object.values(FIPS_TO_STATE).map(state=>state.postal.toLowerCase()));

export function scoutStateHint(subjectId: string | null | undefined, obligationId: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const value of [subjectId, obligationId]) {
    if (!value) continue;
    const state=stateOfPlace(value)??/^([a-z]{2}):/i.exec(value)?.[1]?.toLowerCase();
    if(state)out.add(state);
    const token=value.replace(/^[a-z]+:/i, "").toLowerCase().split(/\b/).find(word=>STATE_CODES.has(word));
    if(token)out.add(token);
  }
  return [...out];
}

export interface ScoutManualOptions {

  readonly subjectId?: string | null;
  readonly obligationId?: string | null;

  readonly divisions?: readonly string[];

  readonly recordClasses?: readonly string[];
  readonly limit?: number;
}

const FAMILY_RECORD_CLASS: Readonly<Record<string, string>> = {
  GOV: "local-jurisdiction", OFF: "official_roster", MTG: "meetings", DOC: "meetings", PAR: "public_comment_rule",
  ELE: "ballot_contest", CAN: "candidate-enrichment", CAM: "campaign_finance_filing",
};

const RELATED: Readonly<Record<string, readonly string[]>> = {
  "local-jurisdiction": ["official_board_directory", "body", "jurisdiction", "roster", "verifiedpage"],
  official_roster: ["officeholder", "official", "roster", "contact", "email", "photo", "verifiedpage"],
  meetings: ["meetings-discovery", "meeting", "agenda", "minutes", "packet", "document", "outcome", "vote", "official_document_sitemap"],
  public_comment_rule: ["service_contact", "meeting", "agenda", "contact"],
  ballot_contest: ["voter_access_route", "election", "contest", "ballot", "measure", "voting_site"],
  "candidate-enrichment": ["candidate_filing_document", "candidate", "candidacy", "campaignsite", "contact", "photo", "blurb", "filing"],
  campaign_finance_filing: ["campaign_finance_document", "filing", "document", "contribution", "expenditure"],
};

export function blankRecordClass(checklistId: string): string | null {
  const family = /^([A-Z]+)-\d+$/.exec(checklistId)?.[1];
  return family === undefined ? null : FAMILY_RECORD_CLASS[family] ?? family.toLowerCase();
}

function scoutPlaces(subjectId: string | null | undefined, divisions: readonly string[] = []): string[] {
  const subject = subjectId?.split("#")[0];
  return [...new Set([subject,...divisions].filter((id):id is string=>id!==undefined && (id.startsWith("ocd-division/") || /^government:US-[a-z]{2}:/i.test(id))))];
}

export function scoutFieldManualQuery(opts: ScoutManualOptions): FieldManualQuery {
  const states = scoutStateHint(opts.subjectId, opts.obligationId);
  const places = scoutPlaces(opts.subjectId, opts.divisions);
  return {
    role: "SCOUT", subjectId: opts.subjectId ?? undefined,
    ...(states[0] ? { state: states[0] } : {}),
    ...(places.length > 0 ? { ocdIds: places } : {}),
  };
}

export function scoutFieldManualProjection(
  read: Pick<FieldManualRead, "store" | "evidence">,
  opts: ScoutManualOptions,
): FieldManualProjection {
  const store = read.store;
  const classes = new Set((opts.recordClasses ?? []).map(value => value.toLowerCase()));
  const hints = new Set([...classes].flatMap(value => [value, ...(RELATED[value] ?? [])]));
  const full = projectFieldManual(store, { ...scoutFieldManualQuery(opts), limit: store.entries.length }, read.evidence);
  const byId = new Map(store.entries.map(entry => [entry.id, entry] as const));
  const indexed = full.entryIds.map((id, index) => ({ id, line: full.lines[index]!, tier: full.tiers[index]!, entry: byId.get(id)! }))
    .filter(row => row.entry.kind !== "PLAYBOOK" && (row.entry.kind !== "EXHAUSTED_RUNGS" || classes.size === 0 || row.entry.recordClasses.some(value => classes.has(value))));

  const helps = (entry: FieldManualEntry) => entry.recordClasses.some(value => hints.has(value.toLowerCase())) ? 0 : 1;
  const anyClass = (entry: FieldManualEntry) => entry.recordClasses.length === 0 ? 0 : 1;
  indexed.sort((a, b) => helps(a.entry) - helps(b.entry) || a.tier - b.tier || anyClass(a.entry) - anyClass(b.entry));
  const chosen = indexed.slice(0, opts.limit ?? 30);
  return { lines: chosen.map(row => row.line), entryIds: chosen.map(row => row.id), tiers: chosen.map(row => row.tier),
    leftOutFailingHere: full.leftOutFailingHere, matched: full.matched, total: full.total };
}
