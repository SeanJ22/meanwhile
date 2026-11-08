import { federalMoneyGovernmentDivision } from "../federal-money/recipient.ts";
import { CivicPayloadReader } from "../civic-data/payload-reader.ts";
import { stateOcdIdFrom } from "../ocd/state-division.ts";
import { factCommentAccessFromRows } from "../facts/comment-read.ts";
import { sittingFactsFromRows, withSittingFacts } from "../facts/meeting-read.ts";
import { bodyFieldsFromRows, type BodyFacts } from "../facts/registry-overlay.ts";
import { factRostersFromRows } from "../facts/roster-read.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";

import { mergeDuplicateSittingFields, mergeReaderSittings, collapseDuplicateSittings } from "../meetings/sitting-merge.ts";
import { applyPartitionFreshCheck, confirmationCheckedAt, meetingVersionReadsASource } from "../meetings/fresh-checks.ts";
import { parseUnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import { stampMeetingDoor } from "../civic-data/fact-door.ts";
import { accountCarriedCollapses, snapshotCounts, type MeetingsSnapshot, type SnapshotSourceReport } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import { carriedFromAnswer } from "../meetings/carry-forward.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { PublicBodyAttempt } from "../registry/body-attempt-read.ts";
import { attemptFamilyOf } from "../registry/attempt-families.ts";
import { publishedBodyLabel } from "../civic-data/published-body-name.ts";

import type { PlaceInput, PlacePackage, AgendaDocumentLink } from "./place-types.ts";
type Row = Record<string,unknown>;

export async function composePlaceRow(input: PlaceInput,row: Row): Promise<PlacePackage> {
  const state = input.state.toUpperCase();
  const stateRoot = input.divisionIds.map(stateOcdIdFrom).find(Boolean) ?? `ocd-division/country:us/state:${state.toLowerCase()}`;
  const divisionIds = row.division_ids as string[] | undefined ?? input.divisionIds;
  const entities = row.entities as Row[], rawSittings = row.sittings as Row[];
  const names = new Map(entities.map(body => [String(body.id),String(body.name)]));
  const canonicalName=(id:string,label:string|null|undefined)=>{
    const name=names.get(id);
    return typeof label==='string' && publishedBodyLabel(label).kind!=='body' && name && publishedBodyLabel(name).kind==='body' ? name : label;
  };
  const rawRegistry = row.registry as RegistryRuntimeReadModel | null ?? null;
  const registry=rawRegistry ? {...rawRegistry,registry:{...rawRegistry.registry,bodies:rawRegistry.registry.bodies.map(body=>
    ({...body,name:canonicalName(body.id,body.name) ?? body.name}))},bodyRosters:rawRegistry.bodyRosters.map(roster=>
      ({...roster,bodyName:canonicalName(roster.bodyId,roster.bodyName) ?? roster.bodyName}))} : null;
  const governments = row.governments as RegistrationGovernmentListing[] ?? [];
  const governmentRecipients = new Map<string, Map<string, { readonly ids: readonly string[]; readonly names: readonly string[]; readonly state: string; readonly moneyDivisionId?: string }>>();
  for (const government of governments) {
    const nativeBodies = government.nativeIds?.census_pid6 ? registry?.registry.bodies.filter(body =>
      body.censusId === government.nativeIds.census_pid6).map(body => body.id) ?? [] : [];
    const ids = [...new Set([government.id, ...(government.aliases ?? []), ...(government.bodyIds ?? []), ...nativeBodies])];
    const moneyDivisionId = federalMoneyGovernmentDivision(government);
    // The place query already carries both the exact entity parent and native
    // registry bindings. A common name or service division establishes neither.
    for (const key of ids) {
      const recipients = governmentRecipients.get(key) ?? new Map();
      recipients.set(government.id, { ids, names: government.recipientNameUnique === true ? [government.name] : [], state: government.state, moneyDivisionId });
      governmentRecipients.set(key, recipients);
    }
  }
  const fields = bodyFieldsFromRows(row.fields as Row[]), { rosters, dispositions } = factRostersFromRows(row.rosters as Row[]);
  const roster = new Map(rosters.map(r => [r.bodyId,r])), comments = new Map(factCommentAccessFromRows(row.comments as Row[]).map(c => [c.bodyId,c]));
  const sittings = sittingFactsFromRows(rawSittings), disposition = new Map(dispositions.map(d => [d.sourceId,d]));
  const bodies: BodyFacts[] = entities.map(e => {
    const id = String(e.id), own = roster.get(id) ?? null;
    const recipients = new Map([...(governmentRecipients.get(id) ?? []),
      ...(typeof e.parent_id === "string" ? governmentRecipients.get(e.parent_id) ?? [] : [])]);
    const recipient = recipients.size === 1 ? [...recipients.values()][0] : null;
    const divisions = [...new Set([...(e.divisions as string[] | undefined ?? []),String(e.division)].filter(id => id.startsWith("ocd-division/")))];
    const local = divisions.filter(id => id !== stateRoot);
    const served = local.length ? local : divisions;
    const division = served.find(id => divisionIds.includes(id)) ?? served[0] ?? String(e.division);
    const governmentId=typeof e.government_id==="string"?e.government_id
      :typeof e.government==="string"&&typeof e.parent_id==="string"?e.parent_id:null;
    const registeredName = typeof e.registered_name === "string" && e.registered_name.trim() ? e.registered_name : null;
    const governmentClass = typeof e.government_class === "string" ? e.government_class.toUpperCase() : "";
    const governmentType = /SPECIAL/.test(governmentClass) ? "special_district" : /SCHOOL/.test(governmentClass) ? "school_district"
      : /COUNTY/.test(governmentClass) ? "county" : /MUNICIPAL|TOWNSHIP|PLACE GOVERNMENT/.test(governmentClass) ? "city" : undefined;
    return { id, division, fields: fields[id] || e.placed === true || registeredName ? {...fields[id],
      ...(typeof fields[id]?.name==='string' ? {name:canonicalName(id,fields[id]!.name)} : {}),
      ...(!fields[id]?.name && registeredName ? {name:registeredName} : {}),ocdId:division.startsWith("ocd-division/") ? division : null,
      ...(governmentId ? {governmentId,...(typeof e.government==="string"?{governmentName:e.government}:{})} : {}),
      ...(governmentType ? {governmentType} : {}),
      ...(registeredName || typeof e.name === "string" && e.name !== id ? {registeredName:registeredName ?? String(e.name)} : {}),
      ...(served.some(id => id !== division) ? {alsoServesOcdIds:served.filter(id => id !== division)} : {}),
      ...(e.placement_basis === "HOST_COUNTY" ? {placementBasis:"HOST_COUNTY" as const} : {})} : {}, roster: own, comment: comments.get(id) ?? null,
      dispositions: own?.members.flatMap(m => disposition.get(m.id) ?? []) ?? [], sittings: sittings.get(id) ?? [],
      ...(typeof e.name === "string" && e.name !== id ? { name: e.name } : {}),
      ...(recipient ? { recipientIds: [...new Set([id, ...recipient.ids])].sort(), recipientNames: recipient.names, recipientState: recipient.state,
        ...(recipient.moneyDivisionId ? { moneyDivisionId: recipient.moneyDivisionId } : {}) } : {}),
      ...(typeof e.government === "string" ? { government: e.government } : {}) };
  });
  const parts = new CivicPayloadReader({ existing: async () => [], write: async () => {}, read: async () => { throw new Error("PLACE_PACKAGE_PART_MISSING"); } });
  const decoded = await parts.loadOwned({rows:row.meeting_rows,archived:row.archived_meetings ?? [],documents:row.archived_documents ?? []},row.parts as Record<string, unknown>) as {
    rows:{scope: string; payload: MeetingsSnapshot & {agendaDocumentLinks?: AgendaDocumentLink[]}; current_version_id: string; confirmation: string | null}[];
    archived:Meeting[];documents:MeetingsSnapshot["agendaDocuments"];
  };
  const rows = decoded.rows;
  const aliases = row.body_aliases as Record<string,string> | undefined ?? {};
  const foldedTargets=new Set(Object.values(aliases));
  const canonicalMeeting = (meeting: Meeting): Meeting => {
    const id = meeting.bodyId && (aliases[meeting.bodyId] ?? meeting.bodyId);
    if(!id)return meeting;
    const bodyName=foldedTargets.has(id) ? names.get(id) ?? meeting.bodyName : canonicalName(id,meeting.bodyName) ?? meeting.bodyName;
    return id!==meeting.bodyId || bodyName!==meeting.bodyName ? {...meeting,bodyId:id,bodyName} : meeting;
  };
  for (const source of rows) {
    source.payload.meetings = source.payload.meetings.map(canonicalMeeting);
    if(source.payload.derivedMembers)source.payload.derivedMembers=source.payload.derivedMembers.map(member=>
      aliases[member.bodyId] ? {...member,bodyId:aliases[member.bodyId]!} : member);
  }
  decoded.archived = decoded.archived.map(canonicalMeeting);
  // This response's dictionary shares bytes only; every document regains its exact text before composition.
  const agendaTexts = row.agenda_texts as readonly string[] | undefined ?? [];
  for (const document of [...rows.flatMap(row => row.payload.agendaDocuments),...decoded.documents]) {
    const text = document.text as unknown;
    if (!text || typeof text !== "object" || !("$readerAgendaText" in text)) continue;
    const index = (text as { $readerAgendaText: unknown }).$readerAgendaText;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index<0 || typeof agendaTexts[index] !== "string")
      throw new Error("READER_AGENDA_TEXT_MISSING");
    document.text = agendaTexts[index];
  }
  if (!input.includeAgenda) {
    for (const r of rows) r.payload.agendaDocuments = [];
    decoded.documents = [];
  }
  const selected = new Set(entities.map(e => String(e.id))), scopes = new Set(rows.map(r => r.scope));
  const byBody = new Map<string, MeetingsSnapshot[]>();
  const agendaDocumentLinks: AgendaDocumentLink[] = [];
  const snapshots = rows.flatMap(r => {
    const retired = RETIRED_MEETING_ROUTES.find(route => r.scope === `source:${encodeURIComponent(route.meetingSource)}:body:${encodeURIComponent(route.bodyId)}`);
    if (retired && (retired.successorAlreadyWired || scopes.has(`source:${encodeURIComponent(retired.replacedBy)}:body:${encodeURIComponent(retired.bodyId)}`))) return [];
    const family = r.scope.startsWith("source:derived:family:");
    const owned = r.payload.meetings.filter(m => (m.bodyId && selected.has(m.bodyId)) || (!m.bodyId && m.ocdId && divisionIds.includes(m.ocdId)));
    const ids = new Set(owned.map(m => m.id));
    agendaDocumentLinks.push(...r.payload.agendaDocumentLinks?.filter(link => ids.has(link.meetingId)) ?? []);
    const confirmation = r.confirmation ? parseUnchangedConfirmation(r.confirmation) : null;
    const checked = confirmationCheckedAt(confirmation,r.current_version_id,meetingVersionReadsASource(r.payload.sources));
    const scope = /^source:([^:]+):body:([^:]+)(:route:[a-f0-9]{16})?(?::history)?$/.exec(r.scope);
    const sources = family ? familySources(r.payload,owned,selected) : r.payload.sources;
    const own = {...r.payload,sources,meetings:owned,agendaDocuments:r.payload.agendaDocuments.filter(d => ids.has(d.meetingId))};
    const stamped = stampMeetingDoor({id:scope ? `meetings:${decodeURIComponent(scope[1]!)}:${scope[2]}${scope[3] ?? ""}` : r.scope,derivedFamily:family||scope?.[1]?.startsWith("derived~") ? state : null},applyPartitionFreshCheck(own,checked));
    const owners = family ? [...new Set([...owned.flatMap(m => m.bodyId ?? []),...r.payload.derivedMembers?.filter(m => selected.has(m.bodyId)).map(m => m.bodyId) ?? []])]
      : scope ? [decodeURIComponent(scope[2]!)] : [];
    for (const bodyId of owners) {
      const meetings = stamped.meetings.filter(m => m.bodyId === bodyId), ids = new Set(meetings.map(m => m.id));
      const source = {...stamped,meetings,sources:family ? familySources(r.payload,meetings,new Set([bodyId])) : stamped.sources,
        agendaDocuments:stamped.agendaDocuments.filter(d => ids.has(d.meetingId))};
      byBody.set(bodyId,[...byBody.get(bodyId) ?? [],source]);
    }
    return [stamped];
  });
  const liveIds = new Set(snapshots.flatMap(s => s.meetings.flatMap(m => [m.id,...m.mergedMeetingIds ?? []])));
  const archived = decoded.archived.filter(m => !liveIds.has(m.id));
  if (archived.length) {
    const ids = new Set(archived.map(m => m.id));
    agendaDocumentLinks.push(...((row.archived_document_links ?? []) as AgendaDocumentLink[]).filter(link => ids.has(link.meetingId)));
    const snapshot: MeetingsSnapshot = {formatVersion:1,generatedAt:archived.map(m => m.provenance.collectedAt).sort().at(-1)!,
      meetings:archived,agendaDocuments:decoded.documents.filter(d => ids.has(d.meetingId)),sources:[],counts:snapshotCounts(archived,0)};
    snapshots.push(snapshot);
    for (const bodyId of new Set(archived.flatMap(m => m.bodyId ?? []))) {
      const meetings = archived.filter(m => m.bodyId === bodyId), ids = new Set(meetings.map(m => m.id));
      byBody.set(bodyId,[...byBody.get(bodyId) ?? [],{...snapshot,meetings,agendaDocuments:snapshot.agendaDocuments.filter(d => ids.has(d.meetingId))}]);
    }
  }
  const exact = collapseDuplicateSittings(snapshots.flatMap(s => s.meetings),mergeDuplicateSittingFields);
  const merged = mergeReaderSittings(exact.rows), meetings = merged.rows;
  const heldIds = new Set(meetings.flatMap(m => [m.id,...m.mergedMeetingIds ?? []]));
  // An independently published sitting is visible even before its calendar's next refresh.
  const fresh = new Map<string, Row[]>();
  for (const fact of rawSittings) {
    const id = String(fact.entity_id).slice("meeting:".length);
    if (!heldIds.has(id)) fresh.set(id,[...fresh.get(id) ?? [],fact]);
  }
  for (const [id,facts] of fresh) {
    const title = facts.find(f => f.field === "title"), start = facts.find(f => f.field === "starts_at");
    if (!title || !start) continue;
    const date = start.value as { startsAt: string; timeZone: string; precision?: "DAY" | "MINUTE" };
    const sourceUrl = String(title.url), at = new Date(title.checked_at as string).toISOString();
    meetings.push({ id,bodyId: String(title.body_id),bodyName: String(title.body_name),ocdId: String(title.body_id).startsWith("ocd-division/") ? String(title.body_id).split("#")[0]! : null,
      title: String(title.value),startsAt: date.startsAt,timeZone: date.timeZone,...(date.precision ? { startPrecision: date.precision } : {}),location: null,agendaUrl: null,
      jurisdiction: "Local",status: "SCHEDULED",provenance: { sourceUrl,sourceOrg: new URL(sourceUrl).hostname,collectedAt: at,verifiedAt: at } });
  }
  const overlaid = withSittingFacts(meetings,[...sittings.values()].flat()).sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const accounting = accountCarriedCollapses(snapshots,snapshots.flatMap(s => s.sources),[...exact.dropped,...merged.dropped]);
  const snapshotHeldAt = snapshots.map(s => s.generatedAt).sort().at(-1) ?? null;
  // The placeholder only satisfies the snapshot shape for the search; readers get `snapshotHeldAt`.
  const snapshot: MeetingsSnapshot = { formatVersion: 1,generatedAt: snapshotHeldAt ?? new Date(0).toISOString(),
    counts: snapshotCounts(overlaid,accounting.freshCollapsed),sources: [...accounting.sources],meetings: overlaid,agendaDocuments: snapshots.flatMap(s => s.agendaDocuments).map(d => ({...d,meetingId:merged.aliases.get(d.meetingId) ?? d.meetingId})) };
  // A published calendar names its body independently of the reviewed registry.
  // Use that source only where an independently published body-name fact is absent.
  for (const body of bodies) {
    const calendar = overlaid.filter(m => m.bodyId === body.id && m.bodyName.trim() && m.provenance?.sourceUrl);
    // A calendar also supplies the body's source when its independently held
    // registered name has no separate name fact. It never substitutes a sitting label.
    if (calendar[0] && !body.fields.provenance && !Object.values(body.fields.fieldSources ?? {}).some(source => source.sourceUrl)) {
      Object.assign(body.fields, {provenance:calendar[0].provenance,sourceDataset:"DERIVED"});
    }
    if (body.fields.name) continue;
    const candidates = calendar.filter(m => !body.name || m.bodyName.trim().toLowerCase() === body.name.trim().toLowerCase());
    // Different sitting categories never rename the body to whichever met last.
    const names = new Set(candidates.map(m => m.bodyName.trim().toLowerCase()));
    const named = names.size === 1 ? candidates[0] : undefined;
    if (!named) continue;
    Object.assign(body.fields,{name:named.bodyName,bodyOrigin:"SOURCED",sourceDataset:"DERIVED",provenance:named.provenance,
      ocdId:named.ocdId ?? (body.division.startsWith("ocd-division/") ? body.division : null)});
  }
  const bodySnapshots = Object.fromEntries(bodies.map(body => {
    const meetings = overlaid.filter(m => m.bodyId === body.id), ids = new Set(meetings.map(m => m.id)), sources = byBody.get(body.id) ?? [];
    const accounting = accountCarriedCollapses(sources,sources.flatMap(s => s.sources),[...exact.dropped,...merged.dropped].filter(m => m.bodyId === body.id));
    return [body.id,{...snapshot,generatedAt:sources.map(s => s.generatedAt).sort().at(-1) ?? snapshot.generatedAt,meetings,
      counts:snapshotCounts(meetings,accounting.freshCollapsed),sources:[...accounting.sources],agendaDocuments:snapshot.agendaDocuments.filter(d => ids.has(d.meetingId))}];
  }));
  return { registry,everydayRouting:null,
    publicationAttempts:((row.publication_attempts ?? []) as (Omit<PublicBodyAttempt,"family"> & {contractId?:string})[])
      .map(({contractId,...attempt}) => ({...attempt,family:attemptFamilyOf(contractId)})),
    bodies,meetings: overlaid,snapshot,snapshotHeldAt,bodySnapshots,
    agendaDocumentLinks:agendaDocumentLinks.map(link => ({...link,meetingId:merged.aliases.get(link.meetingId) ?? link.meetingId})),
    governments,
    divisions:row.divisions as Division[],registrationHeld:row.registration_held === true };
}

/** A state family's source outcomes are attributed only to the bodies this place includes. */
function familySources(snapshot: MeetingsSnapshot,meetings: readonly Meeting[],bodyIds: ReadonlySet<string>): SnapshotSourceReport[] {
  const members = snapshot.derivedMembers?.filter(m => bodyIds.has(m.bodyId));
  if (!members) return meetings.length ? snapshot.sources : [];
  return members.flatMap(member => {
    const own = meetings.filter(m => m.bodyId === member.bodyId && (m.carried?.source ?? m.id.split(":")[0]) === member.source);
    const fresh = own.filter(m => !m.carried).length;
    const answered = own.filter(m => m.carried && carriedFromAnswer(m.carried.reason)).length;
    const walled = own.filter(m => m.carried && !carriedFromAnswer(m.carried.reason)).length;
    const drops = {placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0};
    return [
      ...(member.outcome === "FRESH" || fresh || answered ? [{source:member.source,ok:true,error:null,fetched:fresh,normalized:fresh,drops,...(answered ? {carriedForward:answered} : {})}] : []),
      ...(member.outcome !== "FRESH" || walled ? [{source:member.source,ok:false,error:member.detail ?? `${member.bodyId}: the last verified sittings are held`,failure:"WALL" as const,
        fetched:0,normalized:0,drops,...(walled ? {carriedForward:walled} : {}),
        unreachableOcdIds:[...new Set([...own.flatMap(m => m.ocdId ?? []),...(member.bodyId.startsWith("ocd-division/") ? [member.bodyId.split("#")[0]!] : [])])]}] : []),
    ];
  });
}
