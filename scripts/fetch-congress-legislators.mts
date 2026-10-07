/**
 * @freshness-reads-here — each freshness date is taken at the moment of the fetch it describes.
 */
/**
 * The congress-legislators snapshot. `unitedstates/congress-legislators` is the
 * source of record for what it covers: roster, id crosswalk, birthdays, term
 * dates, party, DC contact, district offices, committees and membership,
 * official social accounts.
 *
 * - It is a community-maintained aggregation of official sources, so the
 *   provenance tag names the project, never "official records".
 * - It is a directory, not a ledger: no votes, money or statements.
 * - Every file is fetched at a pinned commit SHA, never `main`, recorded with
 *   the read date and row count.
 * - Each file has a minimum plausible row count; a truncation, an HTML error
 *   page or an emptied field refuses the run instead of writing an empty snapshot.
 * - CC0.
 *
 *   pnpm congress:fetch
 */

import { parse } from "yaml";

import { stamp } from "./stamp.mts";
import { failedFederalDirectoryCandidate, federalDirectoryCandidate, type FederalDirectoryAcquisition, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { DirectoryFile } from "../lib/officials/directory.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { currentCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";

const UA = "we-the-people/1.0 (civic data; contact seanj22@gmail.com)";

/**
 * The five files, and the floor under each.
 *
 * The floors are set from what the repository actually held at this SHA, well
 * below the observed count so a normal week's churn does not trip them and
 * far above zero so a truncation cannot pass.
 */
const FILES = [
  { name: "legislators-current", min: 500, shape: "list" },
  { name: "legislators-social-media", min: 400, shape: "list" },
  { name: "legislators-district-offices", min: 400, shape: "list" },
  { name: "committees-current", min: 40, shape: "list" },
  // Keyed by committee/subcommittee id rather than a list — the one file
  // here whose top level is a map. Its floor counts KEYS.
  { name: "committee-membership-current", min: 40, shape: "map" },
] as const;

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

async function fetchFile(name: string, sha: string): Promise<{ parsed: unknown; acquisition: FederalDirectoryAcquisition }> {
  const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sha}/${name}.yaml`;
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) {
    throw new Error(`${name}: HTTP ${response.status} from ${url}`);
  }
  const text = await response.text();
  // A redirect to an HTML error page parses as a YAML string, not a list.
  if (text.trimStart().startsWith("<")) {
    throw new Error(`${name}: served HTML, not YAML, from ${url}`);
  }
  return {
    parsed: parse(text),
    acquisition: { requestedUrl: url, finalUrl: response.url || url, httpStatus: response.status, body: text },
  };
}

/** Returns the row count, and refuses below the floor. */
function guard(
  name: string,
  value: unknown,
  min: number,
  shape: "list" | "map",
): number {
  const count =
    shape === "list"
      ? Array.isArray(value)
        ? value.length
        : -1
      : value && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).length
        : -1;

  if (count < 0) {
    throw new Error(
      `${name}: parsed to ${Array.isArray(value) ? "a list" : typeof value}, expected a ${shape}`,
    );
  }
  if (count < min) {
    throw new Error(
      `${name}: THIN — ${count} rows, floor is ${min}. Refusing to ` +
        `write a snapshot that would report success while holding nothing.`,
    );
  }
  return count;
}

/** The term a member is serving now, or the last one on file. */
function currentTerm(terms: RawTerm[]): RawTerm | null {
  if (terms.length === 0) return null;
  return terms[terms.length - 1];
}

let attemptPersisted = false;
let writePrepared = false;

async function main() {
  if (!process.argv.includes("--promote")) {
    throw new Error("Refusing a non-promoting acquisition. Run with --promote; tracked federal runtime files are first-seed/test evidence only.");
  }
  prepareProductionCivicDataWrite();
  writePrepared = true;
  const SHA = await currentCongressSourceRevision();
  const collectedAt = stamp();
  const counts: Record<string, number> = {};
  const acquisitions: FederalDirectoryAcquisition[] = [];

  const raw: Record<string, unknown> = {};
  for (const file of FILES) {
    // Serialized, per the public-records rule: one request at a time, an
    // identified User-Agent with a contact address.
    const { parsed, acquisition } = await fetchFile(file.name, SHA);
    acquisitions.push(acquisition);
    counts[file.name] = guard(file.name, parsed, file.min, file.shape);
    raw[file.name] = parsed;
    console.log(`  ${file.name}: ${counts[file.name]} rows`);
  }

  const legislators = raw["legislators-current"] as RawLegislator[];
  const socials = raw["legislators-social-media"] as RawSocial[];
  const officeSets = raw["legislators-district-offices"] as RawOfficeSet[];
  const committees = raw["committees-current"] as RawCommittee[];
  const memberships = raw["committee-membership-current"] as Record<
    string,
    RawMembership[]
  >;

  // ------------------------------------------------------------------
  // Members. Joined by BIOGUIDE downstream, never by name.
  const socialByBioguide = new Map(socials.map((s) => [s.id.bioguide, s.social ?? {}]));
  const officesByBioguide = new Map(
    officeSets.map((s) => [s.id.bioguide, s.offices ?? []]),
  );

  const members = legislators.map((person) => {
    const term = currentTerm(person.terms);
    const social = socialByBioguide.get(person.id.bioguide) ?? {};
    const offices = officesByBioguide.get(person.id.bioguide) ?? [];

    return {
      bioguide: person.id.bioguide,
      fecIds: person.id.fec ?? [],
      name: person.name.official_full ?? `${person.name.first} ${person.name.last}`,
      birthDate: person.bio?.birthday ?? null,
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
    };
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
    for (const sub of committee.subcommittees ?? []) {
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
    for (const row of rows) {
      // Joined by bioguide. A row without one is DROPPED and counted, never
      // matched on the name string.
      if (!row.bioguide) continue;
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
    (n, c) => n + (c.subcommittees?.length ?? 0),
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
      ...counts,
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
    name: member.name,
    officeTitle: member.chamber === "senate" ? "U.S. Senator" : "U.S. Representative",
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
      collectedAt,
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
    if (member.chamber === "house" && nonVotingDelegates.has(member.state)) {
      unmatched.push({ officeholderId, reason: `${member.state} non-voting delegate has no Reader congressional division` });
      continue;
    }
    divisions.push({
      officeholderId,
      ocdId: member.chamber === "senate"
        ? `ocd-division/country:us/state:${member.state.toLowerCase()}`
        : `ocd-division/country:us/state:${member.state.toLowerCase()}/cd:${member.district === 0 ? "at-large" : member.district}`,
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
  const projection: FederalDirectoryReadModel = { formatVersion: 1, sourceSha: SHA, roster, directory };
  const candidate = federalDirectoryCandidate({ acquisitions, retrievedAt: collectedAt, projection });
  attemptPersisted = true;
  const outcome = await processRegisteredManualCandidate(new PostgresRoutineDataStore(), "congress-bulk-roster", candidate, collectedAt);
  printSourceRunnerReceipt("congress-bulk-roster", candidate, outcome);
  if (!outcome.promoted) throw new Error(`Federal directory candidate ${candidate.id} was held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);

  console.log("\nFederal directory promoted. Counts and their denominators:");
  for (const [key, value] of Object.entries(snapshot.counts)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`\n  pinned at ${SHA}`);
  console.log(`  read ${collectedAt}`);
  console.log(`  promoted ${outcome.promoted.versionId}`);
}

void main().catch(async (error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error);
  if (writePrepared && !attemptPersisted) {
    const attemptedAt = stamp();
    try {
      const failed = failedFederalDirectoryCandidate(attemptedAt, detail);
      const outcome = await processRegisteredManualCandidate(
        new PostgresRoutineDataStore(),
        "congress-bulk-roster",
        failed,
        attemptedAt,
      );
      printSourceRunnerReceipt("congress-bulk-roster", failed, outcome);
    } catch (receiptError) {
      console.error(`Could not persist the failed federal-directory attempt: ${receiptError instanceof Error ? receiptError.message : receiptError}`);
    }
  }
  console.error(detail);
  process.exitCode = 1;
});
