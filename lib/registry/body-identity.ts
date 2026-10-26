import type { Body, Division } from "./types.ts";
import { governingBoardName } from "../civic-data/governing-board-name.ts";
import { readerBodyName, readerGovernmentName } from "../text/reader-names.ts";
import { DEFAULT_KINDS, kindFromSource } from "./kinds.ts";

export type GovernmentType = NonNullable<Body["governmentType"]>;
export interface BodyIdentity {
  governmentId: string;
  governmentName: string;
  governmentType: GovernmentType;
  bodyClass: string;
  name: string;
  meetingBodyId?: string;
}

const words = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const SPECIAL = /\b(?:(?:fire|water|irrigation|library|flood|sanitation|sewer|transit|stadium|hospital|health|park|recreation|conservation|utility|utilities|improvement|drainage|mosquito|cemetery|port|airport|lighting|service|community facilities)[\w\s-]*(?:district|authority)|community college|housing authority|district board)\b/i;
const MEETING = /\b(?:work\s*sessions?|briefings?|roundtables?|workshops?|retreats?|study sessions?|joint (?:meetings?|sessions?)|(?:special|regular)(?: board)? meetings?|executive sessions?|addend(?:um|a)|recessed sessions?|public hearings?)\b|^joint$|^meetings?$/i;
const ADMIN = /\b(?:clerk|department|division|bureau|staff|office of|business parks|developable|properties|administration|administrator|manager|attorney|sheriff|treasurer|assessor|recorder|register of deeds|comptroller|corporation counsel|medical examiner|child support services)\b/i;
const COURT = /\b(?:court|judiciary|judicial|judge)\b/i;
const ADVISORY = /\b(?:advisory|(?:sub)?committ?ee|task\s*force|work(?:ing)?\s*group|roundtable|board of (?:adjustment|appeals|review)|plan(?:ning)? commission|zoning|historic preservation|ethics|civil service|arts commission|human rights|council (?:on|for))\b/i;
const DERIVED = new Set(["DERIVED_FROM_DIVISION_TYPE", "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS", "REGISTERED_FROM_TIGER_FUNCSTAT", "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS"]);

function governmentType(body: Body, division?: Division): GovernmentType {
  const registered = body.registeredName ?? body.name ?? "";
  if (ADVISORY.test(registered) && body.governmentType) return body.governmentType;
  if (ADVISORY.test(registered) && !SPECIAL.test(body.governmentName ?? "") && division?.divisionType === "county") return "county";
  if (ADVISORY.test(registered) && !SPECIAL.test(body.governmentName ?? "") && division?.divisionType === "place") return "city";
  if (/\bgoverning board$/i.test(registered) && /\b(?:board of (?:county commissioners|supervisors)|county board)\b/i.test(body.name ?? "")) return "county";
  if (/\b(?:school district|(?:community|cmty) college|education service district)\b/i.test(registered) || /school/i.test(body.censusUnitType ?? "")) return "school_district";
  if (SPECIAL.test(registered) && body.governmentType !== "school_district") return "special_district";
  if (/\b(?:board of (?:county commissioners|supervisors)|county board|county commission)\b/i.test(registered)) return "county";
  if (/\b(?:city council|common council|mayor and (?:city )?council)\b/i.test(registered)) return "city";
  if (body.governmentType) return body.governmentType;
  const kind = /^[a-z]{2}:(city|county|school|depschool|special):/i.exec(body.governmentId ?? body.id)?.[1];
  if (kind) return kind === "special" ? "special_district" : kind === "school" || kind === "depschool" ? "school_district" : kind as GovernmentType;
  if (body.censusUnitType && /special/i.test(body.censusUnitType)) return "special_district";
  if (/district|authority/.test(division?.divisionType ?? "") && division?.divisionType !== "school_district") return "special_district";
  if (SPECIAL.test(body.governmentName ?? body.name ?? "")) return "special_district";
  if (body.censusUnitType && /school/i.test(body.censusUnitType)) return "school_district";
  if (division?.divisionType === "county") return "county";
  if (division?.divisionType === "place") return "city";
  if (division?.divisionType === "school_district") return "school_district";
  if (division?.tier === "state") return "state";
  if (division?.tier === "national") return "national";
  return "other";
}

function ownGovernment(body: Body, division: Division | undefined, type: GovernmentType): string {
  const registered = body.registeredName ?? body.name;
  const specialName = type === "special_district" && !ADVISORY.test(registered ?? "") && SPECIAL.test(registered ?? "")
    ? registered!.replace(/\s+(?:governing board|board of (?:directors|trustees|supervisors|commissioners)|board)(?=\s*(?:#\d|\(|,|$))/i, "")
      .replace(/\s+(?:advisory (?:board|committee)|commission|committee)$/i, "") : null;
  const schoolName = type === "school_district" && !ADVISORY.test(registered ?? "") && /\b(?:school district|(?:community|cmty) college|education service district)\b/i.test(registered ?? "")
    ? registered!.replace(/\s+(?:(?:governing|school) board|board of (?:education|directors|trustees)|board)$/i, "") : null;
  const foreignParent = type === "county" && /\b(?:district|authority)\b/i.test(body.governmentName ?? "");
  const localDistrict = specialName && /^(?:public )?housing authority$/i.test(specialName) && division?.divisionType === "place"
    ? `${division.label.replace(/\s+(?:city|town|village|borough)$/i, "")} ${specialName}` : specialName;
  const label = localDistrict ?? schoolName ?? (foreignParent ? division?.label : body.governmentName) ?? division?.label;
  // A retained body with no geographic record still has its own sourced identity.
  let name = readerGovernmentName(label ?? body.name ?? "Government", type === "city" ? "place" : type);
  if (type === "city") {
    const suffix = /^(.*?)\s+(city|town|village|borough|township)$/i.exec(name);
    if (suffix) name = `${suffix[2][0].toUpperCase()}${suffix[2].slice(1).toLowerCase()} of ${suffix[1]}`;
    else if (!/^(?:city|town|village|borough|township) of\b/i.test(name)) name = `City of ${name}`;
  }
  return name;
}

function classify(body: Body, government: string, type: GovernmentType): string {
  const raw = body.name?.trim() ?? "";
  const supplied = kindFromSource(DEFAULT_KINDS, "body", body.bodyClass);
  if (MEETING.test(raw)) return "MEETING_TYPE";
  if (ADVISORY.test(raw)) return "ADVISORY";
  if (ADMIN.test(raw)) return "EXECUTIVE_AGENCY";
  if (COURT.test(raw) && !/\b(?:fiscal|quorum|levy|commissioners) court\b/i.test(raw)) return "COURT";
  if (/\b(?:demographics|myths|facts about|address guide|information guide)\b/i.test(raw)) return "INFORMATION";
  if (supplied === "ADVISORY" || supplied === "PRIVATE_ASSOCIATION" || supplied === "SOVEREIGN_TRIBAL" || supplied === "EXECUTIVE_AGENCY") return supplied;
  if ((type === "city" || type === "county") && /\bjoint\b/i.test(raw) && /\b(?:(?:city|town|county|common) council|board of (?:supervisors|commissioners|education)|county board)\b/i.test(raw)) return "MEETING_TYPE";
  if (type === "special_district" && (words(raw) === words(`${government} Council`) || /^(?:the )?council(?: meeting)?$/i.test(raw))) return "GOVERNING";
  const governing = raw && governingBoardName(raw, { name: government, county: type === "county", school: type === "school_district", special: type === "special_district" });
  if (governing) {
    const remainder = words(raw).replace(words(governing), " ").split(/\s+/).filter(Boolean);
    const parent = new Set(words(government).split(" "));
    if (remainder.every(word => parent.has(word) || ["the", "of", "our", "members"].includes(word))) return "GOVERNING";
  }
  // A Census/derived board's existence is established by the government record,
  // independently of the spelling of its durable body id.
  if ((!raw || words(raw) === words(government) || /\bgoverning board$|\bschool board$/i.test(raw)) &&
      (DERIVED.has(body.bodyOrigin) || body.governmentId) && ["city", "county", "school_district", "special_district"].includes(type)) return "GOVERNING";
  if (supplied === "REGIONAL" || supplied === "COMMISSION") return supplied;
  if (/\bcommission\b/i.test(raw)) return "COMMISSION";
  if (/\b(?:board|council|authority)\b/i.test(raw)) return "ADVISORY";
  return "BODY";
}

function qualifiedName(raw: string | null, government: string, type: GovernmentType, bodyClass: string): string {
  if (!raw?.trim()) return government;
  if (bodyClass === "GOVERNING" && /\bgoverning board$|\s+school board$/i.test(raw)) return government;
  const county = /^(.*?) (County|Parish|Borough)$/i.exec(government);
  const prefix = county ? `${county[2]} of ${county[1]}` : null;
  const expanded = prefix && raw.toLowerCase().startsWith(prefix.toLowerCase()) ? `${government}${raw.slice(prefix.length)}` : raw;
  const name = bodyClass === "MEETING_TYPE" ? readerGovernmentName(expanded, null) : readerBodyName(readerGovernmentName(expanded, null));
  const normalized = words(name), parent = words(government);
  if (normalized === parent || normalized.startsWith(`${parent} `)) return name;
  const board = /\b(?:governing board|board of (?:directors|trustees|supervisors|commissioners)|board)\b/i.exec(name);
  if (board) {
    const withoutBoard = words(`${name.slice(0, board.index)} ${name.slice(board.index + board[0].length)}`);
    if (withoutBoard === parent || parent.endsWith(` ${withoutBoard}`)) return `${government} ${board[0]}`;
  }
  const place = words(government.replace(/^(?:city|town|village|borough|township) of /i, ""));
  if (type === "city" && normalized.startsWith(`${place} `)) return `${government}${name.slice(government.replace(/^(?:city|town|village|borough|township) of /i, "").length)}`;
  if (type === "city" && /^(?:city|town|village|borough|township) council$/i.test(name)) return `${government} ${name.replace(/^\w+ /, "")}`;
  if (bodyClass === "GOVERNING" && /\bgoverning board$/i.test(name) && normalized.startsWith(parent)) return name;
  return `${government} ${name}`;
}

/** One classification and government identity path. Body ids remain addresses, never evidence of authority. */
export function prepareBodyIdentities(bodies: readonly Body[], divisions: ReadonlyMap<string, Division>, rosterNames: ReadonlyMap<string, string> = new Map()): Map<string, BodyIdentity> {
  const result = new Map<string, BodyIdentity>();
  const byGovernment = new Map<string, Body[]>();
  for (const original of bodies) {
    const rosterName = rosterNames.get(original.id);
    const division = original.ocdId ? divisions.get(original.ocdId) : undefined;
    // A direct governing roster identifies its own body. A later extraction of
    // a court, department or sitting label cannot turn that roster into another body's members.
    const rosterGovernment = rosterName && governingBoardName(rosterName, {name:original.governmentName ?? division?.label,
      county:division?.divisionType === "county",school:division?.divisionType === "school_district"});
    const body = rosterGovernment && (COURT.test(original.name ?? "") || ADMIN.test(original.name ?? "") || MEETING.test(original.name ?? ""))
      ? {...original,name:rosterName!} : original;
    const type = governmentType(body, division), government = ownGovernment(body, division, type);
    const matchesDivision = division && words(readerGovernmentName(division.label, division.divisionType)).replace(/^city of | city$/g, "") === words(government).replace(/^city of | city$/g, "");
    const governmentId = type === "special_district" ? `district:${words(government)}` : matchesDivision ? division.ocdId : body.governmentId ?? body.ocdId ?? `government:${words(government)}`;
    const bodyClass = classify(body, government, type);
    result.set(body.id, { governmentId, governmentName: government, governmentType: type, bodyClass,
      name: qualifiedName(body.name, government, type, bodyClass) });
    const held = byGovernment.get(governmentId) ?? []; held.push(body); byGovernment.set(governmentId, held);
  }
  for (const rows of byGovernment.values()) {
    const governing = rows.filter(body => result.get(body.id)!.bodyClass === "GOVERNING");
    for (const body of rows) {
      const identity = result.get(body.id)!;
      if (identity.bodyClass !== "MEETING_TYPE") continue;
      const stem = words((body.name ?? "").replace(MEETING, "").replace(/\band\b/gi, ""));
      const exact = rows.filter(parent => result.get(parent.id)!.bodyClass !== "MEETING_TYPE" && stem && words(parent.name ?? "").includes(stem));
      const parents = exact.length === 1 ? exact : governing;
      const named = new Set(parents.map(parent => words(parent.name ?? "")));
      if (parents.length === 1 || parents.length > 1 && named.size === 1) identity.meetingBodyId = [...parents].sort((a,b) => a.id.localeCompare(b.id))[0].id;
    }
  }
  // Distinct retained source records must remain addressable and distinguishable.
  const names = new Map<string, string[]>();
  const nameKey = (name: string, bodyClass: string) => words(bodyClass === "MEETING_TYPE" ? name : readerBodyName(name)).replace(/\band\b/g, "").replace(/\s+/g, " ");
  for (const [id, row] of result) {
    const key = nameKey(row.name, row.bodyClass);
    const ids = names.get(key) ?? []; ids.push(id); names.set(key, ids);
  }
  const reserved = new Set(names.keys());
  for (const ids of names.values()) if (ids.length > 1) {
    ids.sort();
    for (const id of ids.slice(1)) {
      const row = result.get(id)!, base = row.name;
      let number = 2;
      while (reserved.has(nameKey(`${base} — ${number}`, row.bodyClass))) number++;
      row.name = `${base} — ${number}`;
      reserved.add(nameKey(row.name, row.bodyClass));
    }
  }
  return result;
}
