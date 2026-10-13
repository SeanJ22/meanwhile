/** Public Open States session CSV archives retain native person IDs. JSON
 * session exports contain names only, so they cannot provide these joins. */
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "../../reference/csv.ts";
import { openZipFile, type FileArchiveMember } from "../archive.ts";
import { pluralVoteJurisdiction, pluralVoteState, type PluralBillEvidence, type PluralVoteFact } from "./votes.ts";

type Row = Record<string, string>;
const nativeId = (value: string | undefined, kind: string) => !!value && new RegExp(`^ocd-${kind}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).test(value);
const text = (value: string | undefined) => value?.trim() ?? "";
const archiveLimits = { maxEntries: 64, maxMemberBytes: 512 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };

/** Decode a CSV record at a time: position files can be much larger than the
 * normalized votes. Embedded quoted newlines and chunk-split quotes survive. */
async function* rows(member: FileArchiveMember, required: readonly string[]): AsyncIterable<Row> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let record = "", quoted = false, headers: string[] | undefined;
  const decodeRecord = (): Row | null => {
    const parsed = parseCsv(record);
    record = "";
    if (!parsed.length) return null;
    if (parsed.length !== 1) throw new Error(`PLURAL_BULK_CSV_RECORD_INVALID:${member.name}`);
    const values = parsed[0]!;
    if (!headers) {
      headers = values.map(value => value.replace(/^\uFEFF/, ""));
      if (new Set(headers).size !== headers.length || headers.some(value => !value)) throw new Error(`PLURAL_BULK_CSV_HEADER_INVALID:${member.name}`);
      if (required.some(value => !headers!.includes(value))) throw new Error(`PLURAL_BULK_CSV_REQUIRED_HEADER_MISSING:${member.name}`);
      return null;
    }
    if (values.length !== headers.length) throw new Error(`PLURAL_BULK_CSV_COLUMNS_INVALID:${member.name}`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index]!]));
  };
  for await (const bytes of member.stream()) {
    const chunk = decoder.decode(bytes, { stream: true });
    for (const character of chunk) {
      record += character;
      if (character === '"') quoted = !quoted;
      if (character === "\n" && !quoted) {
        const row = decodeRecord();
        if (row) yield row;
      }
    }
    if (record.length > 8 * 1024 * 1024) throw new Error(`PLURAL_BULK_CSV_RECORD_TOO_LARGE:${member.name}`);
  }
  record += decoder.decode();
  if (quoted) throw new Error(`PLURAL_BULK_CSV_QUOTE_INVALID:${member.name}`);
  if (record) { const row = decodeRecord(); if (row) yield row; }
  if (!headers) throw new Error(`PLURAL_BULK_CSV_HEADER_MISSING:${member.name}`);
}

function date(value: string | undefined, checkedAt: string): string | null {
  const raw = text(value), day = raw.slice(0, 10), stamp = Date.parse(day);
  return /^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(raw) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day && day <= checkedAt.slice(0, 10) ? day : null;
}

export async function parsePluralBulkSession(state: string, session: string, bytes: Uint8Array, evidence: PluralBillEvidence): Promise<{
  votes: PluralVoteFact[]; held: { key: string; detail: string }[]; members: string[];
}> {
  const normalizedState = pluralVoteState(state), stateCode = normalizedState.toUpperCase();
  if (!session || !/^[A-Za-z0-9_-]+$/.test(session)) throw new Error("PLURAL_BULK_SESSION_INVALID");
  const source = new URL(evidence.finalUrl);
  if (source.origin !== "https://data.openstates.org" || source.username || source.password ||
      !source.pathname.startsWith(`/csv/latest/${stateCode}_${session}_csv_`) || !source.pathname.endsWith(".zip")) throw new Error("PLURAL_BULK_SOURCE_ROUTE_INVALID");
  if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256 || !Number.isFinite(Date.parse(evidence.retrievedAt))) throw new Error("PLURAL_BULK_SOURCE_EVIDENCE_INVALID");
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-openstates-votes-"));
  try {
    const path = join(directory, "session.zip");
    await writeFile(path, bytes);
    const entries = await openZipFile(path, archiveLimits), prefix = `${stateCode}/${session}/${stateCode}_${session}_`;
    if (entries.some(entry => entry.name !== "README" && !entry.name.startsWith(prefix))) throw new Error("PLURAL_BULK_ARCHIVE_SCOPE_INVALID");
    const readme = entries.find(entry => entry.name === "README");
    if (!readme || readme.size > 4096) throw new Error("PLURAL_BULK_ARCHIVE_METADATA_MISSING");
    const metadataChunks: Uint8Array[] = [];
    for await (const chunk of readme.stream()) metadataChunks.push(chunk);
    const metadata = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(metadataChunks));
    if (!metadata.split(/\r?\n/).includes(`State: ${stateCode}`) || !metadata.split(/\r?\n/).includes(`Session: ${session}`)) throw new Error("PLURAL_BULK_ARCHIVE_METADATA_SCOPE_INVALID");
    const selected: string[] = [];
    const member = (suffix: string, required = false) => {
      const entry = entries.find(entry => entry.name === `${prefix}${suffix}.csv`);
      if (!entry && required) throw new Error(`PLURAL_BULK_MEMBER_MISSING:${suffix}`);
      if (entry) selected.push(entry.name);
      return entry;
    };
    const billFile = member("bills", true)!, voteFile = member("votes"), orgFile = member("organizations");
    const peopleFile = member("vote_people"), countFile = member("vote_counts"), sourceFile = member("vote_sources");
    const bills = new Map<string, Row>(), organizations = new Map<string, Row>();
    let jurisdictionName: string | undefined;
    for await (const bill of rows(billFile, ["id", "identifier", "title", "session_identifier", "jurisdiction"])) {
      if (!nativeId(bill.id, "bill") || bill.session_identifier !== session || !text(bill.jurisdiction) || !text(bill.identifier) || !text(bill.title) || bills.has(bill.id!)) throw new Error("PLURAL_BULK_BILL_IDENTITY_INVALID");
      jurisdictionName ??= bill.jurisdiction;
      if (bill.jurisdiction !== jurisdictionName) throw new Error("PLURAL_BULK_BILL_JURISDICTION_CONFLICT");
      bills.set(bill.id!, bill);
    }
    // The exporter omits a file when its query has zero rows. An archive with
    // bills and no vote file is an unchanged/empty successful source read.
    if (!voteFile) return { votes: [], held: [], members: selected };
    if (!orgFile) throw new Error("PLURAL_BULK_MEMBER_MISSING:organizations");
    for await (const organization of rows(orgFile, ["id", "jurisdiction_id", "classification"])) {
      if (!nativeId(organization.id, "organization") || organization.jurisdiction_id !== pluralVoteJurisdiction(normalizedState) || organizations.has(organization.id!)) throw new Error("PLURAL_BULK_ORGANIZATION_IDENTITY_INVALID");
      organizations.set(organization.id!, organization);
    }
    const votes = new Map<string, PluralVoteFact>(), seen = new Set<string>(), rejected = new Set<string>();
    const held: { key: string; detail: string }[] = [];
    for await (const row of rows(voteFile, ["id", "bill_id", "organization_id", "session_identifier", "jurisdiction", "start_date", "motion_text", "result"])) {
      const key = text(row.id), bill = bills.get(row.bill_id!), organization = organizations.get(row.organization_id!), day = date(row.start_date, evidence.retrievedAt);
      if (!nativeId(key, "vote") || seen.has(key) || !bill || !organization || !["upper", "lower", "legislature"].includes(text(organization.classification)) ||
          row.session_identifier !== session || row.jurisdiction !== bill.jurisdiction || !day || !text(row.motion_text) || !text(row.result)) {
        rejected.add(key); votes.delete(key); held.push({ key, detail: "native vote identity, session, date, motion or legislative chamber is unresolved" });
      } else {
        votes.set(key, { id: key, billId: bill.id!, billNumber: bill.identifier!, billTitle: bill.title!, session,
          organizationId: organization.id!, chamber: organization.classification as PluralVoteFact["chamber"], date: day,
          motion: row.motion_text!, result: row.result!, counts: [], positions: [], unresolvedPositions: 0,
          sourceUrls: [], sourceApiUrl: evidence.finalUrl, retrievedAt: evidence.retrievedAt });
      }
      seen.add(key);
    }
    const people = new Map<string, Map<string, string>>(), conflictingPeople = new Map<string, Set<string>>();
    if (peopleFile) for await (const row of rows(peopleFile, ["vote_event_id", "voter_id", "option"])) {
      const vote = votes.get(row.vote_event_id!);
      if (!vote || rejected.has(vote.id)) continue;
      if (!nativeId(row.voter_id, "person") || !text(row.option)) { vote.unresolvedPositions++; continue; }
      const joined = people.get(vote.id) ?? new Map<string, string>(), conflicts = conflictingPeople.get(vote.id) ?? new Set<string>();
      if (conflicts.has(row.voter_id!)) continue;
      const previous = joined.get(row.voter_id!);
      if (previous === row.option) continue;
      if (previous !== undefined) {
        conflicts.add(row.voter_id!); conflictingPeople.set(vote.id, conflicts);
        joined.delete(row.voter_id!);
        vote.positions = vote.positions.filter(position => position.personId !== row.voter_id);
        // Count a conflicting native person once; its raw contradictory rows
        // remain in the source archive, while neighboring facts still publish.
        vote.unresolvedPositions++;
        held.push({ key: `${vote.id}:${row.voter_id}`, detail: "the native person has conflicting publisher positions" });
        continue;
      }
      joined.set(row.voter_id!, row.option!); people.set(vote.id, joined);
      vote.positions.push({ personId: row.voter_id!, option: row.option!, retrievedAt: evidence.retrievedAt });
    }
    if (countFile) for await (const row of rows(countFile, ["vote_event_id", "option", "value"])) {
      const vote = votes.get(row.vote_event_id!);
      if (!vote || rejected.has(vote.id)) continue;
      if (!text(row.option) || !/^\d+$/.test(text(row.value)) || !Number.isSafeInteger(Number(row.value)) || vote.counts.some(count => count.option === row.option)) {
        rejected.add(vote.id); held.push({ key: vote.id, detail: "publisher count is invalid or repeats an option" }); continue;
      }
      vote.counts.push({ option: row.option!, value: Number(row.value) });
    }
    if (sourceFile) for await (const row of rows(sourceFile, ["vote_event_id", "url"])) {
      const vote = votes.get(row.vote_event_id!);
      if (!vote || rejected.has(vote.id)) continue;
      try {
        const url = new URL(row.url!);
        if (url.protocol === "https:" && !url.username && !url.password && !vote.sourceUrls.includes(url.href)) vote.sourceUrls.push(url.href);
      } catch { /* A missing official link does not hide a verified native vote. */ }
    }
    for (const vote of votes.values()) if (!rejected.has(vote.id) && !vote.positions.length) {
      rejected.add(vote.id); held.push({ key: vote.id, detail: "no exact native person position was acquired" });
    }
    return { votes: [...votes.values()].filter(vote => !rejected.has(vote.id)), held, members: selected };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
