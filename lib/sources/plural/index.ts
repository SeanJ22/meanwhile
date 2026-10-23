import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
} from "../../officials/types.ts";

import { parse as parseYaml } from "yaml";
import { nativePersonIdFromUrl } from "../../officials/people-identity.ts";
import { officeIdentity } from "../../officials/office-identity.ts";
import { PLURAL_STATES } from "./targets.ts";
;

const SOURCE_NAME = "plural";

const SOURCE_ORG = "Plural Open States (CC-0)";

export function bulkUrl(state: string): string {
  return `https://data.openstates.org/people/current/${state.toLowerCase()}.csv`;
}

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
  id: string;
  name: string;
  current_party: string;
  current_district: string;
  current_chamber: "upper" | "lower" | string;
  roles?: readonly PluralRole[];
  identifiers?: Readonly<Record<string, readonly string[]>>;
  sourceUrl?: string;
  birthDate?: string;
  offices?: readonly { name: string; address: string; voice: string; email?: string; sourceUrl?: string }[];
  email: string;
  image: string;
  capitol_address: string;
  capitol_voice: string;
  district_address: string;
  district_voice: string;
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
  readonly ended?: boolean;
  readonly sourceUrl?: string;
}

const STATE_EXECUTIVE_OFFICES = new Set(["governor", "lieutenant_governor", "secretary_of_state", "attorney_general",
  "state_treasurer", "superintendent_of_public_instruction", "state_mine_inspector", "corporation_commissioner",
  "state_auditor", "state_comptroller", "insurance_commissioner", "executive_councilor", "chief_election_officer"]);
const LOCAL_OFFICES = new Set(["mayor", "municipal_council", "county_commissioner", "county_supervisor", "county_sheriff",
  "county_attorney", "county_treasurer", "register_of_deeds", "register_of_probate", "county_clerk", "county_assessor", "county_recorder", "school_board"]);
const NATIVE_ROLE_TITLES: Readonly<Record<string, string>> = {
  governor: "Governor", lt_governor: "Lieutenant Governor", lieutenant_governor: "Lieutenant Governor",
  secretary_of_state: "Secretary of State", attorney_general: "Attorney General", treasurer: "State Treasurer",
  state_treasurer: "State Treasurer", auditor: "State Auditor", state_auditor: "State Auditor", comptroller: "State Comptroller",
  superintendent_of_public_instruction: "Superintendent of Public Instruction", insurance_commissioner: "Insurance Commissioner",
  "chief election officer": "Chief Election Officer", chief_election_officer: "Chief Election Officer",
  mayor: "Mayor", councilmember: "Councilmember", council_member: "Councilmember",
};

export function nativeRoleBinding(role: PluralRole, state: string): {
  officeTitle: string; officeKey: string; divisionId?: string; level: "STATE" | "LOCAL"; gap?: string;
} | { issue: string } {
  const nativeTitle = role.title || NATIVE_ROLE_TITLES[role.type] || role.type.replace(/_/g, " ");
  // OpenStates uses its governor category for the District's chief executive.
  // Preserve the exact District jurisdiction while displaying the real office.
  const districtExecutive = state === "dc" && role.jurisdiction === "ocd-jurisdiction/country:us/district:dc/government";
  const sourceTitle = districtExecutive && role.type === "governor" && officeIdentity(nativeTitle) === "governor" ? "Mayor" : nativeTitle;
  const officeKey = officeIdentity(sourceTitle);
  if (!officeKey || !STATE_EXECUTIVE_OFFICES.has(officeKey) && !LOCAL_OFFICES.has(officeKey)) return { issue: `PLURAL_ROLE_UNSUPPORTED:${role.type}:${role.title ?? ""}` };
  const match = /^ocd-jurisdiction\/(country:us\/(?:state|district|territory):([a-z]{2})(?:\/[^/]+:[^/]+)*)\/government$/.exec(role.jurisdiction ?? "");
  if (!match) return { issue: `PLURAL_ROLE_JURISDICTION_MISSING_OR_INVALID:${role.jurisdiction ?? ""}` };
  if (match[2] !== state) return { issue: `PLURAL_ROLE_WRONG_STATE:${match[2]}:${state}` };
  const path = match[1], local = /\/(?:place|county|county_subdivision|school_district):[^/]+/.test(path);
  const districtMayor = districtExecutive && officeKey === "mayor";
  if (STATE_EXECUTIVE_OFFICES.has(officeKey) && local || LOCAL_OFFICES.has(officeKey) && !local && !districtMayor) return { issue: `PLURAL_ROLE_JURISDICTION_MISMATCH:${officeKey}:${role.jurisdiction}` };
  // Some counties, including Hawaii's, elect a mayor. The native county is
  // the represented division; a municipality must never be fabricated for it.
  if (officeKey === "municipal_council" && !/\/(?:place|county_subdivision):[^/]+/.test(path)) return { issue: `PLURAL_ROLE_MUNICIPAL_JURISDICTION_REQUIRED:${role.jurisdiction}` };
  if (officeKey === "mayor" && !districtMayor && !/\/(?:place|county|county_subdivision):[^/]+/.test(path)) return { issue: `PLURAL_ROLE_MUNICIPAL_JURISDICTION_REQUIRED:${role.jurisdiction}` };
  const district = role.district?.trim();
  const districtScoped = officeKey === "executive_councilor" || Boolean(district && !/^(?:at[ -]large|statewide|citywide)$/i.test(district));
  const nativeDistrict = /\/(?:ward|district|council_district|executive_council_district):([^/]+)$/.exec(path)?.[1];
  const unresolvedDistrict = districtScoped && (!nativeDistrict || district && nativeDistrict !== district);
  return { officeTitle: sourceTitle, officeKey, ...(unresolvedDistrict ? {
    gap:`PLURAL_ROLE_DISTRICT_DIVISION_UNRESOLVED:${officeKey}:${district ?? ""}:${role.jurisdiction}`,
  } : {divisionId:`ocd-division/${path}`}), level: local ? "LOCAL" : "STATE" };
}

export function yamlToPeople(text: string, state: string, sourceUrl: string, asOf: string, unresolved: (detail: string) => void = () => {}, includeInactive = false): PluralPerson[] {
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
  const roles: PluralRole[] = (Array.isArray(row.roles) ? row.roles : []).flatMap((value, index) => {
    try {
      const role = value as Record<string, unknown>;
      if (!role || typeof role.type !== "string") throw new Error("PLURAL_ROLE_IDENTITY_INVALID");
      const start_date = date(role.start_date), end_date = date(role.end_date);
      if (start_date && end_date && start_date.slice(0, Math.min(start_date.length,end_date.length)) > end_date.slice(0, Math.min(start_date.length,end_date.length))) throw new Error("PLURAL_ROLE_DATE_ORDER_INVALID");
      return [{ type: role.type, district: typeof role.district === "string" || typeof role.district === "number" ? String(role.district) : undefined,
        title: typeof role.title === "string" ? role.title : undefined, jurisdiction: typeof role.jurisdiction === "string" ? role.jurisdiction : undefined,
        start_date, end_date, current: startsBy(start_date) && endsAfter(end_date), ended: Boolean(end_date && !endsAfter(end_date)), sourceUrl }];
    } catch (error) {
      unresolved(`${error instanceof Error ? error.message : String(error)}:person=${row.id}:role=${index}`);
      return [];
    }
  });
  const current = roles.filter(role => {
    if (!role.current) return false;
    if (["upper", "lower", "legislature"].includes(role.type)) {
      if (role.jurisdiction && !new RegExp(`^ocd-jurisdiction/country:us/(?:state|district|territory):${state}/government$`).test(role.jurisdiction)) {
        unresolved(`PLURAL_LEGISLATIVE_JURISDICTION_MISMATCH:${role.jurisdiction}`); return false;
      }
      return true;
    }
    const binding = nativeRoleBinding(role, state);
    if ("issue" in binding) { unresolved(`${binding.issue}:person=${row.id}`); return false; }
    if (binding.gap) unresolved(`${binding.gap}:person=${row.id}`);
    return true;
  });
  // An upstream person slot occasionally contains a collective body. Require
  // both explicit structured body naming and its own council contact page;
  // a person's surname or an unrelated council link cannot reject a person.
  const councilName = typeof row.family_name === "string" && /^(?:City|Town|Borough|Village) Council$/i.test(row.family_name) &&
    typeof row.given_name === "string" && row.name === `${row.given_name} ${row.family_name}`;
  const collectiveSource = councilName && current.some(role => role.type === "mayor") &&
    [...(Array.isArray(row.links) ? row.links : []), ...(Array.isArray(row.sources) ? row.sources : [])].find(value => {
      const url = typeof value === "string" ? value : value && typeof value === "object" ? (value as {url?:unknown}).url : null;
      if (typeof url !== "string") return false;
      try { const parsed = new URL(url); return /(?:^|\.)[^.]+\.gov$/.test(parsed.hostname) &&
        /\/(?:city|town|borough|village)-council\/contact-(?:the-)?(?:city|town|borough|village)-council\/?$/.test(parsed.pathname); } catch { return false; }
    });
  if (collectiveSource) {
    unresolved(`PLURAL_PERSON_IS_GOVERNING_BODY:person=${row.id}:name=${row.name}`);
    return [];
  }
  if (!roles.length) unresolved(`PLURAL_PERSON_HAS_NO_ROLES:${row.id}`);
  if (!roles.length || !current.length && !includeInactive) return [];
  const offices = (Array.isArray(row.offices) ? row.offices : []).filter(value => value && typeof value === "object").map(value => {
    const office = value as Record<string, unknown>;
    const text = (value: unknown) => typeof value === "string" ? value : "";
    return { name: text(office.classification) || text(office.name), address: text(office.address), voice: text(office.voice), email: typeof office.email === "string" ? office.email : undefined, sourceUrl };
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
  const role = current.find(role => ["upper", "lower", "legislature"].includes(role.type)) ?? current[0] ?? roles[0]!;
  const safeDate = (value: unknown) => { try { return date(value); } catch { return undefined; } };
  return [{ id: row.id, name: row.name, state, sourceUrl, roles: roles.map(role => ({...role,current:current.includes(role)})), identifiers, offices,
    birthDate: safeDate(row.birth_date),
    current_party: party, current_chamber: role.type, current_district: role.district ?? "",
    email: typeof row.email === "string" ? row.email : capitol?.email ?? district?.email ?? "",
    image: typeof row.image === "string" ? row.image : "", links: urls(row.links).join(";"), sources: urls(row.sources).join(";"),
    capitol_address: capitol?.address ?? "", capitol_voice: capitol?.voice ?? "", district_address: district?.address ?? "", district_voice: district?.voice ?? "" }];
}

export function designationKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Strip leading zeros so "<County> 08" meets "<County> 8".
    .replace(/\b0+(\d)/g, "$1")
    .replace(/\bAND\b/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

const LABEL_PREFIX = /^(?:State (?:Senate|House|Representative|Legislative(?: Sub)?) ?District|Assembly District|Senate District|Delegate District|Legislative \((?:House|Senate)\) District|Senatorial District|Representative District)\s*/i;
const LABEL_SUFFIX = /(?: State House District| Senatorial District| District)$/i;

export function designationFromLabel(label: string): string {
  return designationKey(
    label.replace(/^[A-Z]{2} /, "").replace(/\s*\(\d{4} plan\)$/, "").replace(LABEL_PREFIX, "").replace(LABEL_SUFFIX, ""),
  );
}

export interface RegistryDivisionLite {
  ocdId: string;
  label: string;
  divisionType: string;
}

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

export const PLURAL_REQUIRED_COLUMNS = ["id", "name", "current_chamber", "current_district"] as const;

export const PLURAL_ROSTER_FLOOR = 1;

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

export function normalize(
  raw: PluralPerson[],
  divisionIndex: Map<string, string>,
  collectedAt: string,
  scope: string,
): OfficeholderSet {
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  const unmatched: OfficeholderSet["unmatched"] = [];
  const endedMemberships: NonNullable<OfficeholderSet["endedMemberships"]>[number][] = [];
  const chamberFor = (state: string, type: string) => type === "legislature" && ["ne", "dc"].includes(state) ? "upper" : type;
  const letteredChambers = new Set([...divisionIndex.keys()].filter(key => /\|\d+[A-Z]$/.test(key)).map(key => key.slice(0, key.lastIndexOf("|"))));
  const heldChambers = new Set([...divisionIndex.keys()].map(key => key.slice(0, key.lastIndexOf("|"))));

  for (const person of raw) {
    const uuid = person.id.replace("ocd-person/", "");
    const id = `${SOURCE_NAME}:${person.state}:${uuid}`;
    const personId = `${SOURCE_NAME}:${uuid}`;
    const sourceRoles: readonly PluralRole[] = person.roles ?? [{ type: person.current_chamber, district: person.current_district, current: true }];
    const mapped = sourceRoles.flatMap<{
      role:PluralRole;title:string;chamber:string|undefined;level:"STATE"|"LOCAL";divisionId:string|undefined;officeId:string;membershipId:string;
    }>(role => {
      const chamber = chamberFor(person.state, role.type);
      const legislative = ["upper", "lower", "legislature"].includes(role.type);
      if (legislative) {
        if (role.jurisdiction && !new RegExp(`^ocd-jurisdiction/country:us/(?:state|district|territory):${person.state}/government$`).test(role.jurisdiction)) return [];
        const title = role.title || CHAMBER_TITLE[person.state]?.[chamber as "upper" | "lower"];
        if (!["upper", "lower"].includes(chamber) || !title) {
          if (role.current) unmatched.push({officeholderId:id,reason:`PLURAL_LEGISLATIVE_ROLE_UNRESOLVED:${role.type}`});
          return [];
        }
        const key = designationKey(role.district ?? "");
        const chamberKey = `${person.state}|${chamber}`;
        let divisionId = divisionIndex.get(`${chamberKey}|${key}`);
        if (!divisionId && /^\d+[A-Z]$/.test(key) && !letteredChambers.has(chamberKey)) {
          divisionId = divisionIndex.get(`${chamberKey}|${key.slice(0, -1)}`);
        }
        if (!divisionId && (key === "ATLARGE" || person.state === "dc" && key === "CHAIRMAN")) {
          const jurisdiction = /^ocd-jurisdiction\/(country:us\/(?:state|district|territory):[a-z]{2})\/government$/.exec(role.jurisdiction ?? "");
          if (jurisdiction) divisionId = `ocd-division/${jurisdiction[1]}`;
        }
        return [{role, title, chamber, level:"STATE" as const, divisionId,
          officeId:`openstates-office:${person.state}:${officeIdentity(title)}:${role.district ?? ""}`,
          membershipId:`${personId}:${person.state}:${role.type}:${role.district ?? ""}:${role.start_date ?? ""}`}];
      }
      const binding = nativeRoleBinding(role,person.state);
      if ("issue" in binding) {
        if (role.current) unmatched.push({officeholderId:id,reason:binding.issue});
        return [];
      }
      return [{role,title:binding.officeTitle,chamber:undefined,level:binding.level,divisionId:binding.divisionId,
        officeId:`openstates-office:${role.jurisdiction}:${binding.officeKey}:${role.district ?? ""}`,
        membershipId:`${personId}:${role.jurisdiction}:${binding.officeKey}:${role.district ?? ""}:${role.start_date ?? ""}`}];
    });
    const memberships = mapped.map(item => ({
      id:item.membershipId,personId,officeId:item.officeId,
      jurisdiction:item.role.jurisdiction ?? `US-${person.state.toUpperCase()}`,
      chamber:item.chamber,district:item.role.district,officeTitle:item.title,level:item.level,
      current:item.role.current !== false,divisionId:item.divisionId,
      termStart:item.role.start_date ?? null,termEnd:item.role.end_date ?? null,
      sourceUrl:item.role.sourceUrl ?? person.sourceUrl ?? bulkUrl(person.state),
    }));
    for (let i=0;i<mapped.length;i++) if (mapped[i].role.ended) endedMemberships.push({...memberships[i],current:false});
    const current = mapped.filter(item=>item.role.current !== false);
    const primary = current.find(item=>item.chamber) ?? current[0];
    if (!primary) {
      if (sourceRoles.some(role=>role.current)) unmatched.push({officeholderId:id,reason:"PLURAL_PERSON_HAS_NO_BOUND_CURRENT_ROLE"});
      continue;
    }
    const {role,title,chamber,level}=primary;

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
      memberships,
      offices: (person.offices ?? [
        { name: "capitol", address: person.capitol_address, voice: person.capitol_voice },
        { name: "district", address: person.district_address, voice: person.district_voice },
      ]).filter(office => office.address || office.voice || ("email" in office && office.email)).map(office => ({
        name: office.name, address: office.address || undefined, phone: office.voice || undefined,
        email: "email" in office ? office.email : undefined,
        sourceUrl: "sourceUrl" in office ? office.sourceUrl ?? person.sourceUrl ?? bulkUrl(person.state) : person.sourceUrl ?? bulkUrl(person.state), collectedAt,
      })),
      name: person.name,
      officeTitle: title,
      level,
      // The CSV carries no term dates; empty, never guessed.
      termStart: role?.start_date ?? "",
      termEnd: role?.end_date ?? "",
      birthDate: person.birthDate ?? null,
      partyLabel: person.current_party || null,
      websiteUrl: person.links.split(";").find(link => {
        try { return ["http:", "https:"].includes(new URL(link).protocol); } catch { return false; }
      }) || null,
      profileUrls: [...new Set([...person.links.split(";"), ...person.sources.split(";")].filter(link => {
        try { return ["http:", "https:"].includes(new URL(link).protocol); } catch { return false; }
      }))],
      contactFormUrl: null,
      // Capitol office first; the district office where the capitol number is
      // not published. Empty strings are absences.
      phone: person.capitol_voice || person.district_voice || person.offices?.find(office=>office.voice)?.voice || null,
      email: person.email || person.offices?.find(office=>office.email)?.email || null,
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

    const seenDivisions = new Set<string>();
    for (const item of current) {
      const district = item.role.district ?? "";
      const ocdId = item.divisionId;
      if (!ocdId) {
        const areaOutsideCensus = item.chamber === "lower" && (
          person.state === "nh" && heldChambers.has("nh|lower") || person.state === "me" && /\btribe\b/i.test(district));
        unmatched.push({ officeholderId: id,
          reason: item.chamber ? `no ${item.chamber} division for ${person.state.toUpperCase()} "${district}" — ${areaOutsideCensus ? "area not in the Census district file" : "missing boundary coverage or an unresolved designation"}`
            : `PLURAL_ROLE_DISTRICT_DIVISION_UNRESOLVED:${item.role.type}:${district}:${item.role.jurisdiction}` });
      } else if (!seenDivisions.has(`${ocdId}|${item.membershipId}`)) {
        divisions.push({ officeholderId: id, ocdId, bodyId: null, membershipId:item.membershipId });
        seenDivisions.add(`${ocdId}|${item.membershipId}`);
      }
    }
  }

  return { scope, generatedAt: collectedAt, officeholders, divisions, unmatched,
    ...(endedMemberships.length ? {endedMemberships:[...new Map(endedMemberships.map(row=>[row.id,row])).values()]} : {}) };
}

export { SOURCE_ORG, SOURCE_NAME, CHAMBER_TITLE };
