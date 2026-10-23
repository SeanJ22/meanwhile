import type { Officeholder } from "./types.ts";
import { whiteHouseOffice } from "./white-house-offices.ts";
import { portraitBindingMatches } from "../photos/binding.ts";

/** The publisher's words, with the saved page's date. */
export interface ExecutiveText {
  readonly text: string;
  readonly sourceUrl: string;
  readonly collectedAt: string;
}

/** These facts travel in the same national people projection as Congress's people. */
export interface NationalExecutiveData {
  readonly biography?: ExecutiveText;
  readonly termEndDescription?: ExecutiveText;
  readonly priorOffices?: readonly ExecutiveText[];
  readonly officeSocial?: readonly import("../sources/white-house/profile.ts").ExecutiveOfficeSocial[];
  readonly records?: readonly import("../sources/white-house/presidential-records.ts").SourcedExecutiveRecord[];
  readonly money?: import("../sources/white-house/presidential-records.ts").PresidentialMoney;
  readonly cabinet?: import("../sources/white-house/cabinet-records.ts").CabinetRecords;
  readonly coverage?: Readonly<Record<string, boolean>>;
  readonly complete?: boolean;
  readonly missing?: readonly string[];
}

/** A failed refresh records its gap while retaining the last source-verified fact. */
export function mergeExecutiveFacts(left: NationalExecutiveData | undefined, right: NationalExecutiveData | undefined): NationalExecutiveData | undefined {
  if (!left) return right;
  if (!right) return left;
  const cabinet = right.cabinet ? { ...left.cabinet, ...right.cabinet,
    confirmation: right.cabinet.confirmation ?? left.cabinet?.confirmation,
    department: right.cabinet.department ? { ...left.cabinet?.department, ...right.cabinet.department,
      budget: right.cabinet.department.budget ?? left.cabinet?.department?.budget,
      headcount: right.cabinet.department.headcount ?? left.cabinet?.department?.headcount,
      actions: [...new Map([...(left.cabinet?.department?.actions ?? []), ...right.cabinet.department.actions].map(row => [row.id, row])).values()],
    } : left.cabinet?.department,
  } : left.cabinet;
  return { ...left, ...Object.fromEntries(Object.entries(right).filter(([, value]) => value !== undefined)),
    cabinet, coverage: { ...left.coverage, ...right.coverage },
    records: [...new Map([...(left.records ?? []), ...(right.records ?? [])].map(row => [row.id, row])).values()],
    priorOffices: [...new Map([...(left.priorOffices ?? []), ...(right.priorOffices ?? [])].map(row => [row.text, row])).values()],
    officeSocial: [...new Map([...(left.officeSocial ?? []), ...(right.officeSocial ?? [])].map(row => [row.url, row])).values()],
  };
}

/** Histories and filing totals already have lazy card endpoints; place responses carry the profile only. */
export function executiveCardProfile(data: NationalExecutiveData | undefined): NationalExecutiveData | undefined {
  if (!data) return undefined;
  const { records: _records, money: _money, ...profile } = data;
  return { ...profile, ...(profile.cabinet?.department ? { cabinet: { ...profile.cabinet,
    department: { ...profile.cabinet.department, actions: [] },
  } } : {}) };
}

const sourced = (fact: { sourceUrl?: string | null; collectedAt?: string } | undefined): boolean => {
  if (!fact?.sourceUrl || !Number.isFinite(Date.parse(fact.collectedAt ?? ""))) return false;
  try { return new URL(fact.sourceUrl).protocol === "https:"; } catch { return false; }
};

/** Completion controls the National listing only; partial verified facts still publish everywhere. */
export function executiveCardCompleteness(person: Officeholder): { complete: boolean; missing: string[] } {
  const office = whiteHouseOffice(person.officeTitle), data = person.executive;
  const missing: string[] = [];
  const require = (key: string, holds: boolean | undefined) => { if (!holds) missing.push(key); };
  require("portrait", Boolean(person.photo && portraitBindingMatches(person.personId ?? person.id, person.photo)));
  require("biography", Boolean(data?.biography?.text && sourced(data.biography)));
  for (const key of ["partyLabel", "termStart"] as const) require(key, Boolean(person[key] && sourced(person.fieldSources?.[key])));
  require("termEnd", Boolean(person.termEnd && sourced(person.fieldSources?.termEnd) || data?.termEndDescription?.text && sourced(data.termEndDescription)));
  require("contact", ["phone", "email", "contactFormUrl"].some(key => Boolean(person[key as keyof Officeholder] && sourced(person.fieldSources?.[key]))));
  require("officialSocial", Array.isArray(person.social) && person.social.some(account => account.accountKind === "OFFICIAL" && sourced(account)) || data?.officeSocial?.some(account => account.accountKind === "OFFICIAL" && sourced(account)));
  if (office === "president") for (const key of ["campaignMoney", "executiveOrders", "proclamations", "memoranda", "signedBills", "vetoedBills"]) require(key, data?.coverage?.[key]);
  else if (office === "vice-president") require("tieBreakingVotes", data?.coverage?.tieBreakingVotes);
  else if (office?.startsWith("cabinet:")) for (const key of ["department", "budget", "headcount", "confirmation", "priorOffices", "departmentActions"]) require(key, data?.coverage?.[key]);
  else require("nationalOffice", false);
  return { complete: missing.length === 0, missing };
}

export function withExecutiveCompleteness(person: Officeholder): Officeholder {
  return { ...person, executive: { ...person.executive, ...executiveCardCompleteness(person) } };
}

/** Keep the original API capture as well as the human-readable document citation. */
export function executiveEvidenceReferences(data: NationalExecutiveData | undefined): Set<string> {
  const references = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.collectedAt === "string") for (const key of ["sourceUrl", "evidenceSourceUrl"]) {
      if (typeof row[key] === "string") references.add(`${row[key]}|${row.collectedAt}`);
    }
    Object.values(row).forEach(visit);
  };
  visit(data);
  return references;
}
