/** Source-native Congress people and independent directory facts at an explicit as-of date. */
import type { OfficeholderSet } from "./types.ts";
import type { Provenance } from "../sources/types.ts";
import type { DirectoryFile } from "./directory.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
interface RawTerm {
  type: string;
  start: string;
  end: string;
  state: string;
  district?: number;
  party?: string;
  phone?: string;
  url?: string;
  office?: string;
  contact_form?: string;
  class?: number;
}

interface RawLegislator {
  id: { bioguide: string; fec?: string[]; govtrack?: number; icpsr?: number };
  name: { first: string; last: string; official_full?: string };
  bio?: { birthday?: string; gender?: string };
  terms: RawTerm[];
}

interface RawSocial {
  id: { bioguide: string };
  social?: {
    twitter?: string;
    facebook?: string;
    youtube?: string;
    youtube_id?: string;
    instagram?: string;
    mastodon?: string;
  };
}

interface RawOfficeSet {
  id: { bioguide: string };
  offices?: {
    id?: string;
    city?: string;
    state?: string;
    address?: string;
    building?: string;
    suite?: string;
    zip?: string;
    phone?: string;
    fax?: string;
    latitude?: number;
    longitude?: number;
  }[];
}

interface RawCommittee {
  type: string;
  name: string;
  thomas_id: string;
  jurisdiction?: string;
  jurisdiction_source?: string;
  url?: string;
  subcommittees?: { name: string; thomas_id: string; address?: string }[];
}

interface RawMembership {
  name: string;
  party?: string;
  rank?: number;
  title?: string;
  bioguide?: string;
}


const termDate=(value:unknown):string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value ? value : "";

/** A future or expired term is never the current office just because it is last. */
export function currentCongressTerm(terms: readonly RawTerm[], asOf: string): RawTerm | null {
  const day = asOf.slice(0,10);
  const active = terms.filter(term=>term && ["sen","rep"].includes(term.type)).map(term=>({...term,start:termDate(term.start),end:termDate(term.end)})).filter(term => (!term.start || term.start <= day) && (!term.end || term.end > day));
  return active.sort((a,b)=>(b.start ?? "").localeCompare(a.start ?? ""))[0] ?? null;
}

function congressName(person: RawLegislator): string | null {
  if(typeof person?.name?.official_full === "string" && person.name.official_full.trim()) return person.name.official_full.trim();
  return typeof person?.name?.first === "string" && person.name.first.trim() && typeof person.name.last === "string" && person.name.last.trim()
    ? `${person.name.first.trim()} ${person.name.last.trim()}` : null;
}

export function normalizeCongressDirectory(raw: Readonly<Record<string,unknown>>, SHA: string, collectedAt: string,
  prior?: FederalDirectoryReadModel | null, sourceDates: Readonly<Record<string,string>> = {}, asOf: string = collectedAt): FederalDirectoryReadModel {
  const legislators = (raw["legislators-current"] ?? []) as RawLegislator[];
  const socials = ((raw["legislators-social-media"] ?? []) as RawSocial[]).filter(row=>row?.id?.bioguide);
  const officeSets = ((raw["legislators-district-offices"] ?? []) as RawOfficeSet[]).filter(row=>row?.id?.bioguide);
  const committees = ((raw["committees-current"] ?? []) as RawCommittee[]).filter(row=>row?.thomas_id && row.name);
  const memberships = (raw["committee-membership-current"] ?? {}) as Record<
    string,
    RawMembership[]
  >;

  // ------------------------------------------------------------------
  // Members. Joined by BIOGUIDE downstream, never by name.
  const socialByBioguide = new Map(socials.map((s) => [s.id.bioguide, s.social && typeof s.social === "object" && !Array.isArray(s.social) ? s.social : {}]));
  const officesByBioguide = new Map(
    officeSets.map((s) => [s.id.bioguide, Array.isArray(s.offices) ? s.offices.filter(row=>row && typeof row === "object") : []]),
  );

  const members = legislators.flatMap((person) => {
    const name=congressName(person);
    if (!person || !/^[A-Z]\d{6}$/.test(person.id?.bioguide ?? "") || !name) return [];
    const term = currentCongressTerm(Array.isArray(person.terms) ? person.terms : [], asOf);
    if (!term) return [];
    const social = socialByBioguide.get(person.id.bioguide) ?? {};
    const offices = officesByBioguide.get(person.id.bioguide) ?? [];

    return [{
      terms: person.terms,
      nativeIds: Object.fromEntries(Object.entries(person.id).flatMap(([key,value]) => value == null ? [] : [[key, (Array.isArray(value) ? value : [value]).map(String)]])),
      bioguide: person.id.bioguide,
      fecIds: (Array.isArray(person.id.fec) ? person.id.fec : []).filter(id=>/^[HSP][A-Z0-9]{8}$/.test(id)),
      name,
      birthDate: termDate(person.bio?.birthday ?? "") || null,
      chamber: term?.type === "sen" ? "senate" : term?.type === "rep" ? "house" : null,
      state: term?.state ?? null,
      district: term?.district ?? null,
      party: term?.party ?? null,
      termStart: term?.start ?? null,
      termEnd: term?.end ?? null,
      phone: term?.phone ?? null,
      url: term?.url ?? null,
      contactForm: term?.contact_form ?? null,
      social: {
        // The file's field is `twitter`; it renders as X. The name in the
        // data is the source's name and is not rewritten here.
        twitter: social.twitter ?? null,
        facebook: social.facebook ?? null,
        youtube: social.youtube ?? null,
        youtubeId: social.youtube_id ?? null,
        instagram: social.instagram ?? null,
        mastodon: social.mastodon ?? null,
      },
      districtOffices: offices
        .filter((o) => o.city && (o.address || o.phone))
        .map((o) => ({
          city: o.city ?? null,
          state: o.state ?? null,
          address: [o.address, o.building, o.suite].filter(Boolean).join(", ") || null,
          zip: o.zip ?? null,
          phone: o.phone ?? null,
          lat: typeof o.latitude === "number" ? o.latitude : null,
          lng: typeof o.longitude === "number" ? o.longitude : null,
        })),
    }];
  });

  // ------------------------------------------------------------------
  // Committees, and who sits on them.
  //
  // `committee-membership-current.yaml` is keyed by committee/subcommittee
  // id, so the per-member view is built here rather than at render.
  const committeeById = new Map<string, { name: string; type: string; url: string | null; jurisdiction: string | null; jurisdictionSource: string | null }>();
  for (const committee of committees) {
    committeeById.set(committee.thomas_id, {
      name: committee.name,
      type: committee.type,
      url: committee.url ?? null,
      jurisdiction: committee.jurisdiction ?? null,
      jurisdictionSource: committee.jurisdiction_source ?? null,
    });
    for (const sub of Array.isArray(committee.subcommittees) ? committee.subcommittees.filter(row=>row?.thomas_id && row.name) : []) {
      committeeById.set(`${committee.thomas_id}${sub.thomas_id}`, {
        name: `${committee.name} — ${sub.name}`,
        type: committee.type,
        url: committee.url ?? null,
        jurisdiction: null,
        jurisdictionSource: null,
      });
    }
  }

  const membershipsByBioguide = new Map<
    string,
    { committeeId: string; name: string; rank: number | null; title: string | null }[]
  >();
  let membershipRows = 0;
  for (const [committeeId, rows] of Object.entries(memberships)) {
    const committee = committeeById.get(committeeId);
    if (!committee) continue;
    for (const row of Array.isArray(rows) ? rows : []) {
      // Joined by bioguide. A row without one is DROPPED and counted, never
      // matched on the name string.
      if (!row?.bioguide) continue;
      membershipRows += 1;
      const list = membershipsByBioguide.get(row.bioguide) ?? [];
      list.push({
        committeeId,
        name: committee.name,
        rank: typeof row.rank === "number" ? row.rank : null,
        title: row.title ?? null,
      });
      membershipsByBioguide.set(row.bioguide, list);
    }
  }

  const subcommitteeCount = committees.reduce(
    (n, c) => n + (Array.isArray(c.subcommittees) ? c.subcommittees.length : 0),
    0,
  );

  const snapshot = {
    source: {
      project: "unitedstates/congress-legislators",
      repoUrl: "https://github.com/unitedstates/congress-legislators",
      sha: SHA,
      licence: "CC0 1.0 Universal (public domain dedication)",
      licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      /* Names the project: an aggregation of official sources, not itself an official record. */
      sourceOrg: "unitedstates/congress-legislators (community project)",
      collectedAt,
    },
    counts: {
      ...Object.fromEntries(Object.entries(raw).map(([key,value]) => [key, Array.isArray(value) ? value.length : Object.keys(value as object).length])),
      members: members.length,
      membersWithBirthday: members.filter((m) => m.birthDate).length,
      membersWithFecId: members.filter((m) => m.fecIds.length > 0).length,
      membersWithTwitter: members.filter((m) => m.social.twitter).length,
      districtOffices: members.reduce((n, m) => n + m.districtOffices.length, 0),
      committees: committees.length,
      subcommittees: subcommitteeCount,
      membershipRows,
      membersWithCommittee: membershipsByBioguide.size,
    },
    members,
    committees: [...committeeById.entries()].map(([id, c]) => ({ id, ...c })),
    memberships: Object.fromEntries(membershipsByBioguide),
  };

  const nonVotingDelegates = new Set(["AS", "DC", "GU", "MP", "PR", "VI"]);
  const officeholders: OfficeholderSet["officeholders"] = members.map((member) => ({
    id: `congress:${member.bioguide}`,
    personId: `congress:${member.bioguide}`,
    nativeIds: { ...member.nativeIds, congress: [member.bioguide] },
    fecCandidateIds: member.fecIds,
    memberships: member.terms.map(term => ({id:`congress:${member.bioguide}:${term.type}:${term.state}:${term.district ?? ""}:${term.start ?? ""}`, personId:`congress:${member.bioguide}`, officeId:`US:${term.type}:${term.state}:${term.district ?? term.class ?? ""}`, jurisdiction:"US", chamber:term.type, district:term.district == null ? undefined : String(term.district), termStart:term.start ?? null, termEnd:term.end ?? null, sourceUrl:`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`})),
    name: member.name,
    officeTitle: member.chamber === "senate" ? "U.S. Senator" : member.state === "PR" ? "Resident Commissioner" : nonVotingDelegates.has(member.state ?? "") ? "Delegate to the U.S. House" : "U.S. Representative",
    level: "FEDERAL",
    termStart: member.termStart ?? "",
    termEnd: member.termEnd ?? "",
    birthDate: member.birthDate,
    partyLabel: member.party,
    websiteUrl: member.url,
    contactFormUrl: member.contactForm,
    phone: member.phone,
    email: null,
    campaignUrl: null,
    photo: null,
    social: Object.fromEntries(Object.entries(member.social).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    state: member.state ?? undefined,
    chamber: member.chamber ?? undefined,
    provenance: {
      sourceUrl: `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`,
      sourceOrg: snapshot.source.sourceOrg,
      collectedAt: sourceDates["legislators-current"] ?? collectedAt,
      verifiedAt: null,
    },
  }));
  const divisions: OfficeholderSet["divisions"] = [];
  const unmatched: OfficeholderSet["unmatched"] = [];
  for (const member of members) {
    const officeholderId = `congress:${member.bioguide}`;
    if (!member.state || !member.chamber || (member.chamber === "house" && member.district === null)) {
      unmatched.push({ officeholderId, reason: "current term lacks an exact state, chamber, or House district" });
      continue;
    }
    const stateEntry = Object.values(FIPS_TO_STATE).find(entry => entry.postal === member.state);
    if (!stateEntry) { unmatched.push({officeholderId,reason:"unknown native jurisdiction"}); continue; }
    const jurisdiction = `ocd-division/country:us/${stateEntry.prefix}:${member.state.toLowerCase()}`;
    divisions.push({
      officeholderId,
      ocdId: member.chamber === "senate"
        ? jurisdiction
        : `${jurisdiction}/cd:${stateEntry.prefix !== "state" || member.district === 0 ? "at-large" : member.district}`,
      bodyId: null,
    });
  }
  const roster: OfficeholderSet = { scope: "us", generatedAt: collectedAt, officeholders, divisions, unmatched };
  const directory: DirectoryFile = {
    source: snapshot.source,
    counts: {
      members: snapshot.members.length,
      districtOffices: snapshot.counts.districtOffices,
      committees: snapshot.committees.length,
      membershipRows: snapshot.counts.membershipRows,
      membersWithCommittee: snapshot.counts.membersWithCommittee,
    },
    committees: Object.fromEntries(snapshot.committees.map((committee) => [committee.id, committee])),
    byMember: Object.fromEntries(snapshot.members.map((member) => [member.bioguide, {
      districtOffices: member.districtOffices,
      committees: snapshot.memberships[member.bioguide] ?? [],
    }])),
  };
  // Files are independent. A failed optional acquisition retains the held fact and its source clock.
  for (const holder of officeholders) {
    const held = prior?.roster.officeholders.find(row => row.id === holder.id);
    if (held?.photo) holder.photo = held.photo;
    const fieldSources: Record<string, Provenance> = { ...held?.fieldSources };
    if (held) {
      holder.nativeIds={...held.nativeIds,...holder.nativeIds};
      if(!holder.fecCandidateIds?.length)holder.fecCandidateIds=held.fecCandidateIds;
      for(const field of ["birthDate","partyLabel","websiteUrl","contactFormUrl","phone","email","campaignUrl"] as const) {
        if (holder[field]) {
          // The current core file supplies this value; its own provenance now applies.
          delete fieldSources[field];
        } else if (held[field]) {
          holder[field] = held[field];
          fieldSources[field] = held.fieldSources?.[field] ?? held.provenance;
        }
      }
    }
    const entry = directory.byMember[holder.id.slice(9)];
    const old = prior?.directory.byMember[holder.id.slice(9)];
    if (held?.social && !Array.isArray(held.social)) holder.social = {...held.social,...holder.social};
    if (old && !entry.districtOffices.length) entry.districtOffices = old.districtOffices;
    if ((!raw["committees-current"] || !raw["committee-membership-current"]) && old) entry.committees = old.committees;
    holder.fieldSources = {
      ...fieldSources,
      ...Object.fromEntries(["social","districtOffices","committees"].flatMap(field => {
        const filename = field === "social" ? "legislators-social-media" : field === "districtOffices" ? "legislators-district-offices" : "committee-membership-current";
        const id=holder.id.slice(9);
        const fresh=field==="social" ? Object.values(socialByBioguide.get(id) ?? {}).some(Boolean) : field==="districtOffices" ? (officesByBioguide.get(id)?.length ?? 0)>0 : Boolean(raw["committees-current"] && raw[filename]);
        return fresh ? [[field,{sourceUrl:`https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/${filename}.yaml`,sourceOrg:snapshot.source.sourceOrg,collectedAt:sourceDates[filename] ?? collectedAt,verifiedAt:null}]] : [];
      })),
    };
  }
  if (prior && (!raw["committees-current"] || !raw["committee-membership-current"])) directory.committees = {...prior.directory.committees,...directory.committees};
  const currentMembershipComplete = legislators.length > 0 && legislators.every(row=>row && /^[A-Z]\d{6}$/.test(row.id?.bioguide ?? "") && congressName(row) && Array.isArray(row.terms) && row.terms.length && row.terms.every(term=>term && ["sen","rep"].includes(term.type) && term.state && termDate(term.start) && termDate(term.end)));
  if (prior && !currentMembershipComplete) {
    const missing=prior.roster.officeholders.filter(row=>!roster.officeholders.some(current=>current.id===row.id));
    roster.officeholders.push(...missing);
    const ids=new Set(missing.map(row=>row.id));
    roster.divisions.push(...prior.roster.divisions.filter(row=>ids.has(row.officeholderId)));
    for(const row of missing) if(prior.directory.byMember[row.id.slice(9)])directory.byMember[row.id.slice(9)]=prior.directory.byMember[row.id.slice(9)];
  }
  return JSON.parse(JSON.stringify({ formatVersion: 1, currentMembershipComplete, sourceSha: SHA, roster, directory }));
}
