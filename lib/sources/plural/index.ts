import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
} from "../../officials/types.ts";

import { parse as parseYaml } from "yaml";
import { nativePersonIdFromUrl } from "../../officials/people-identity.ts";
import { PLURAL_STATES } from "./targets.ts";
export { PLURAL_STATES } from "./targets.ts";

/**
 * State legislators from Open States (Plural Open) native people YAML and
 * its separately parsed current CSV export. CC-0 attribution stays on each
 * person, membership and contact field.
 */

const SOURCE_NAME = "plural";

const SOURCE_ORG = "Plural Open States (CC-0)";

/** Acquisition is national; a missing local boundary never suppresses a roster. */
export type PluralState = (typeof PLURAL_STATES)[number];

export function bulkUrl(state: string): string {
  return `https://data.openstates.org/people/current/${state.toLowerCase()}.csv`;
}

/**
 * What a chamber's members are called, per state. Not derivable: some lower
 * chambers' members are Assemblymembers, not Representatives.
 */
const CHAMBER_TITLE: Record<string, { upper: string; lower: string }> = {
  az: { upper: "State Senator", lower: "State Representative" },
  nh: { upper: "State Senator", lower: "State Representative" },
  nj: { upper: "State Senator", lower: "Assemblymember" },
  pr: { upper: "Senator", lower: "Representative" },
};

for (const state of PLURAL_STATES) {
  CHAMBER_TITLE[state] ??= {
    upper: state === "dc" ? "Councilmember" : "State Senator",
    lower: ["ca", "nv", "ny", "wi"].includes(state) ? "Assemblymember"
      : ["md", "va", "wv"].includes(state) ? "Delegate" : "State Representative",
  };
}

export interface PluralPerson {
  /** An `ocd-person/<uuid>` identifier. Stable across runs. */
  id: string;
  name: string;
  current_party: string;
  /** `"19"` in most states; `"<County> 8"` where districts are designated by county. */
  current_district: string;
  current_chamber: "upper" | "lower" | string;
  roles?: readonly PluralRole[];
  identifiers?: Readonly<Record<string, readonly string[]>>;
  sourceUrl?: string;
  offices?: readonly { name: string; address: string; voice: string; email?: string }[];
  email: string;
  image: string;
  /** The capitol office address, as Open States publishes it ("…, City, ST 12345"). */
  capitol_address: string;
  /** The capitol office phone, as the legislature publishes it. */
  capitol_voice: string;
  /** The district office address, where one is published. */
  district_address: string;
  /** The district office phone, where one is published. */
  district_voice: string;
  /** Semicolon-separated. */
  links: string;
  sources: string;
  state: string;
}

export interface PluralRole {
  readonly type: string;
  readonly district?: string;
  readonly title?: string;
  readonly jurisdiction?: string;
  readonly start_date?: string;
  readonly end_date?: string;
  readonly current?: boolean;
}

/** The native YAML record keeps fields absent from the reduced held CSV export. */
export function yamlToPeople(text: string, state: string, sourceUrl: string, asOf: string, unresolved: (detail: string) => void = () => {}): PluralPerson[] {
  const value: unknown = parseYaml(text, { maxAliasCount: 0, uniqueKeys: true });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PLURAL_YAML_RECORD_INVALID");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.startsWith("ocd-person/") || typeof row.name !== "string" || !row.name.trim()) throw new Error("PLURAL_YAML_PERSON_IDENTITY_INVALID");
  const day = asOf.slice(0, 10);
  const date = (value: unknown): string | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const text = String(value);
    if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, text.length) !== text) throw new Error("PLURAL_ROLE_DATE_INVALID");
    return text;
  };
  // Compare at the precision actually supplied. A year-only end date does
  // not claim January 1, and the exact native value remains on the membership.
  const startsBy = (value: string | undefined) => !value || value <= day.slice(0, value.length);
  const endsAfter = (value: string | undefined) => !value || value >= day.slice(0, value.length);
  const roles: PluralRole[] = (Array.isArray(row.roles) ? row.roles : []).map(value => {
    const role = value as Record<string, unknown>;
    if (!role || typeof role.type !== "string") throw new Error("PLURAL_ROLE_IDENTITY_INVALID");
    const start_date = date(role.start_date), end_date = date(role.end_date);
    return { type: role.type, district: typeof role.district === "string" || typeof role.district === "number" ? String(role.district) : undefined,
      title: typeof role.title === "string" ? role.title : undefined, jurisdiction: typeof role.jurisdiction === "string" ? role.jurisdiction : undefined,
      start_date, end_date, current: startsBy(start_date) && endsAfter(end_date) };
  });
  const current = roles.filter(role => role.current && ["upper", "lower", "legislature"].includes(role.type));
  if (sourceUrl.includes("/legislature/") && !roles.some(role => ["upper", "lower", "legislature"].includes(role.type))) unresolved("PLURAL_LEGISLATIVE_ROLE_UNRESOLVED");
  if (!current.length) return [];
  const offices = (Array.isArray(row.offices) ? row.offices : []).filter(value => value && typeof value === "object").map(value => {
    const office = value as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value : "";
    return { name: text(office.classification) || text(office.name), address: text(office.address), voice: text(office.voice), email: typeof office.email === "string" ? office.email : undefined };
  });
  const urls = (value: unknown) => (Array.isArray(value) ? value : []).flatMap(value => {
    const url = typeof value === "string" ? value : value && typeof value === "object" ? (value as { url?: unknown }).url : null;
    if (typeof url !== "string") return [];
    try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) ? [url] : []; } catch { return []; }
  });
  const parties = Array.isArray(row.party) ? row.party as { name?: string; start_date?: string; end_date?: string }[] : [];
  const party = parties.filter(p => {
    if (!p || typeof p.name !== "string") return false;
    try { return startsBy(date(p.start_date)) && endsAfter(date(p.end_date)); } catch { return false; }
  }).at(-1)?.name ?? "";
  const identifiers: Record<string, string[]> = Object.create(null);
  for (const value of Array.isArray(row.other_identifiers) ? row.other_identifiers : []) {
    if (!value || typeof value !== "object") continue;
    const item = value as { scheme?: unknown; identifier?: unknown };
    if (typeof item.scheme === "string" && typeof item.identifier === "string") (identifiers[item.scheme] ??= []).push(item.identifier);
  }
  const capitol = offices.find(o => /capitol/i.test(o.name)), district = offices.find(o => /district/i.test(o.name));
  // One person, every current membership. Display chooses a role; identity never does.
  const role = current[0]!;
  return [{ id: row.id, name: row.name, state, sourceUrl, roles, identifiers, offices,
    current_party: party, current_chamber: role.type, current_district: role.district ?? "",
    email: typeof row.email === "string" ? row.email : capitol?.email ?? district?.email ?? "",
    image: typeof row.image === "string" ? row.image : "", links: urls(row.links).join(";"), sources: urls(row.sources).join(";"),
    capitol_address: capitol?.address ?? "", capitol_voice: capitol?.voice ?? "", district_address: district?.address ?? "", district_voice: district?.voice ?? "" }];
}

/**
 * Reduces a district designation to something two spellings agree on. Some
 * districts are designated by county and number ("<County> 8") and the two
 * sides zero-pad differently; everything else is a bare number.
 */
export function designationKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Strip leading zeros so "<County> 08" meets "<County> 8".
    .replace(/\b0+(\d)/g, "$1");
}

const LABEL_PREFIX = /^(?:State (?:Senate|House)|State Legislative Districts?\s*-?\s*(?:Upper|Lower)|Senatorial|Representative) District\s*/i;
const NJ_LABEL_PREFIX = /^(Assembly|Senate) District\s*/i;

/** The designation a registry division's Census-sourced label encodes. */
export function designationFromLabel(label: string): string {
  return designationKey(
    label.replace(LABEL_PREFIX, "").replace(NJ_LABEL_PREFIX, ""),
  );
}

export interface RegistryDivisionLite {
  ocdId: string;
  label: string;
  divisionType: string;
}

/**
 * Indexes the registry's legislative divisions by state, chamber and
 * designation. The registry ids are Census codes (`sldl:608`) and Plural uses
 * the statutory designation; the Census-sourced label bridges them. Matching
 * is exact within one state and chamber, and every miss is reported.
 */
export function indexDivisions(
  divisions: RegistryDivisionLite[],
): Map<string, string> {
  const index = new Map<string, string>();

  for (const division of divisions) {
    if (division.divisionType !== "sldu" && division.divisionType !== "sldl") {
      continue;
    }
    const state = /(?:state|district|territory):([a-z]{2})\//.exec(division.ocdId)?.[1];
    if (!state) continue;

    const chamber = division.divisionType === "sldu" ? "upper" : "lower";
    index.set(
      `${state}|${chamber}|${designationFromLabel(division.label)}`,
      division.ocdId,
    );
  }

  return index;
}

/** Minimal CSV reader — quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r") {
      // ignore
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (quoted) throw new Error("PLURAL_CSV_TRUNCATED_QUOTED_FIELD");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function rowsToPeople(csv: string, state: string): PluralPerson[] {
  const issue = pluralRosterIssue(csv);
  if (issue) throw new Error(`PLURAL_CSV_INVALID:${issue}`);
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const header = rows[0];
  const at = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? "" : (row[i] ?? "");
  };

  return rows
    .slice(1)
    .filter(row => row.some(value => value.trim() !== ""))
    .map((row) => ({
      id: at(row, "id"),
      name: at(row, "name"),
      current_party: at(row, "current_party"),
      current_district: at(row, "current_district"),
      current_chamber: at(row, "current_chamber"),
      email: at(row, "email"),
      image: at(row, "image"),
      capitol_address: at(row, "capitol_address"),
      capitol_voice: at(row, "capitol_voice"),
      district_address: at(row, "district_address"),
      district_voice: at(row, "district_voice"),
      links: at(row, "links"),
      sources: at(row, "sources"),
      state,
    }));
}

/** The columns `rowsToPeople` reads to build a legislator; a header without them is not the roster. */
export const PLURAL_REQUIRED_COLUMNS = ["id", "name", "current_chamber", "current_district"] as const;

/** Refuse an empty response. */
export const PLURAL_ROSTER_FLOOR = 1;

/**
 * Is this 200 body actually a Plural roster, and the whole of it? Returns the
 * reason it is not, or null. An HTML error page passes the comma check and
 * parses to zero people, so the header and the floor are checked here.
 */
export function pluralRosterIssue(csv: string): string | null {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const missing = PLURAL_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return `a CSV whose header is missing ${missing.join(", ")} — a truncated file or an error page, not the roster`;
  }
  if (new Set(header).size !== header.length) return "duplicate CSV column names";
  const data = rows.slice(1).filter(row => row.some(value => value.trim() !== ""));
  const malformed = data.find(row => row.length !== header.length || PLURAL_REQUIRED_COLUMNS.some(column => !row[header.indexOf(column)]?.trim()));
  if (malformed) return "a data row has missing required fields or does not match the complete CSV header";
  const ids = data.map(row => row[header.indexOf("id")]);
  if (ids.some(id => !/^ocd-person\/\S+$/.test(id))) return "a native person identifier is not an Open States person ID";
  if (new Set(ids).size !== ids.length) return "duplicate native person identifiers";
  const dataRows = data.length;
  if (dataRows < PLURAL_ROSTER_FLOOR) {
    return `${dataRows} data row(s), below the floor of ${PLURAL_ROSTER_FLOOR} — refusing a truncated roster`;
  }
  return null;
}

/**
 * Maps people onto officeholders and division links. Everything unattached
 * lands in `unmatched` with a reason that separates a missing boundary from an
 * identifier mismatch.
 */
export function normalize(
  raw: PluralPerson[],
  divisionIndex: Map<string, string>,
  collectedAt: string,
  scope: string,
): OfficeholderSet {
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  const unmatched: OfficeholderSet["unmatched"] = [];
  const chamberFor = (state: string, type: string) => type === "legislature" && ["ne", "dc"].includes(state) ? "upper" : type;

  for (const person of raw) {
    const uuid = person.id.replace("ocd-person/", "");
    const id = `${SOURCE_NAME}:${person.state}:${uuid}`;
    const personId = `${SOURCE_NAME}:${uuid}`;
    const chamber = chamberFor(person.state, person.current_chamber);

    if (chamber !== "upper" && chamber !== "lower") {
      unmatched.push({ officeholderId: id, reason: `unknown chamber "${chamber}"` });
      continue;
    }

    const role = person.roles?.find(role => role.current && ["upper", "lower", "legislature"].includes(role.type));
    const title = role?.title || CHAMBER_TITLE[person.state]?.[chamber];
    if (!title) {
      // No title table for this state: never invent a title for its members.
      unmatched.push({
        officeholderId: id,
        reason: `no chamber title recorded for ${person.state}`,
      });
      continue;
    }

    officeholders.push({
      id,
      personId,
      state: person.state.toUpperCase(), chamber,
      nativeIds: (() => {
        const native: Record<string, readonly string[]> = { ...person.identifiers, plural: [uuid], "ocd-person": [person.id] };
        for (const link of person.links.split(";")) {
          const binding = nativePersonIdFromUrl(link);
          if (binding) native[binding.source] = [...new Set([...(native[binding.source] ?? []), binding.id])];
        }
        return native;
      })(),
      memberships: (person.roles?.filter(role => ["upper", "lower", "legislature"].includes(role.type)) ?? [{ type: person.current_chamber, district: person.current_district }]).map(role => ({
        id: `${personId}:${person.state}:${role.type}:${role.district ?? ""}:${"start_date" in role ? role.start_date ?? "" : ""}`,
        personId, officeId: `openstates-office:${person.state}:${role.type}:${role.district ?? ""}`,
        jurisdiction: "jurisdiction" in role ? role.jurisdiction ?? `US-${person.state.toUpperCase()}` : `US-${person.state.toUpperCase()}`,
        chamber: role.type, district: role.district,
        termStart: "start_date" in role ? role.start_date : null, termEnd: "end_date" in role ? role.end_date : null,
        sourceUrl: person.sourceUrl ?? bulkUrl(person.state),
      })),
      offices: (person.offices ?? [
        { name: "capitol", address: person.capitol_address, voice: person.capitol_voice },
        { name: "district", address: person.district_address, voice: person.district_voice },
      ]).filter(office => office.address || office.voice || ("email" in office && office.email)).map(office => ({
        name: office.name, address: office.address || undefined, phone: office.voice || undefined,
        email: "email" in office ? office.email : undefined,
        sourceUrl: person.sourceUrl ?? bulkUrl(person.state), collectedAt,
      })),
      name: person.name,
      officeTitle: title,
      level: "STATE",
      // The CSV carries no term dates; empty, never guessed.
      termStart: role?.start_date ?? "",
      termEnd: role?.end_date ?? "",
      // State rosters publish no birth date.
      birthDate: null,
      partyLabel: person.current_party || null,
      websiteUrl: person.links.split(";").find(link => {
        try { return ["http:", "https:"].includes(new URL(link).protocol); } catch { return false; }
      }) || null,
      contactFormUrl: null,
      // Capitol office first; the district office where the capitol number is
      // not published. Empty strings are absences.
      phone: person.capitol_voice || person.district_voice || null,
      email: person.email || null,
      campaignUrl: null,
      // A lead for the shared portrait source check, not a reader image.
      photo: null,
      ...(person.image ? { portraitCandidate: { imageUrl: person.image, sourceUrl: person.sourceUrl ?? bulkUrl(person.state), collectedAt } } : {}),
      provenance: {
        sourceUrl: person.sourceUrl ?? bulkUrl(person.state),
        sourceOrg: SOURCE_ORG,
        collectedAt,
        verifiedAt: null,
      },
    });

    const currentRoles = person.roles?.filter(role => role.current && ["upper", "lower", "legislature"].includes(role.type)) ??
      [{ type: person.current_chamber, district: person.current_district }];
    const seenDivisions = new Set<string>();
    for (const current of currentRoles) {
      const currentChamber = chamberFor(person.state, current.type);
      const district = current.district ?? "";
      const ocdId = divisionIndex.get(`${person.state}|${currentChamber}|${designationKey(district)}`);
      if (!ocdId) {
        unmatched.push({ officeholderId: id,
          reason: `no ${currentChamber} division for ${person.state.toUpperCase()} "${district}" — missing boundary coverage or an unresolved designation` });
      } else if (!seenDivisions.has(ocdId)) {
        divisions.push({ officeholderId: id, ocdId, bodyId: null });
        seenDivisions.add(ocdId);
      }
    }
  }

  return { scope, generatedAt: collectedAt, officeholders, divisions, unmatched };
}


export { SOURCE_ORG, SOURCE_NAME, CHAMBER_TITLE };
