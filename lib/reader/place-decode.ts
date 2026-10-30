import { federalMoneyGovernmentDivision } from "../federal-money/recipient.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { stateOcdIdFrom } from "../ocd/state-division.ts";
import { factCommentAccessFromRows } from "../facts/comment-read.ts";
import { meetingsFromFactRows, sittingFactsFromRows } from "../facts/meeting-read.ts";
import { bodyFieldsFromRows, type BodyFacts } from "../facts/registry-overlay.ts";
import { factRostersFromRows } from "../facts/roster-read.ts";
import { RETIRED_MEETING_ROUTES } from "../registry/source-wiring.ts";
import { collapseDuplicateSittings } from "../sources/composite/index.ts";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "../meetings/sitting-merge.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { Division } from "../registry/types.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
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
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => {}, read: async () => { throw new Error("PLACE_PACKAGE_PART_MISSING"); } });
  const decoded = await parts.loadOwned({documents:row.agenda_documents ?? []},row.parts as Record<string, unknown>) as {documents:MeetingsSnapshot["agendaDocuments"]};
  // This response's dictionary shares bytes only; every document regains its exact text before composition.
  const agendaTexts = row.agenda_texts as readonly string[] | undefined ?? [];
  for (const document of decoded.documents) {
    const text = document.text as unknown;
    if (!text || typeof text !== "object" || !("$readerAgendaText" in text)) continue;
    const index = (text as { $readerAgendaText: unknown }).$readerAgendaText;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index<0 || typeof agendaTexts[index] !== "string")
      throw new Error("READER_AGENDA_TEXT_MISSING");
    document.text = agendaTexts[index];
  }
  if (!input.includeAgenda) decoded.documents = [];
  const agendaDocumentLinks = (row.agenda_document_links ?? []) as AgendaDocumentLink[];
  const bodyOf = new Map(bodies.map(body => [body.id,body]));
  const held = meetingsFromFactRows(rawSittings, id => {
    const body = bodyOf.get(id);
    return { name: names.get(id) ?? body?.name ?? id, ocdId: body?.division.startsWith("ocd-division/") ? body.division : null, jurisdiction: body?.government ?? "Local" };
  }, new Date());
  const hiddenRetired = (meeting: Meeting) => RETIRED_MEETING_ROUTES.some(route => meeting.bodyId === route.bodyId && meeting.id.startsWith(`${route.meetingSource}:`)
    && (route.successorAlreadyWired || held.some(other => other.bodyId === route.bodyId && other.id.startsWith(`${route.replacedBy}:`))));
  const exact = collapseDuplicateSittings(held.filter(meeting => !hiddenRetired(meeting)),mergeDuplicateSittingFields);
  const merged = mergeReaderSittings(exact.rows), meetings = merged.rows;
  const overlaid = meetings.sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  const heldAt = rawSittings.filter(fact => fact.field === "title").map(fact => new Date(fact.checked_at as string).toISOString()).sort().at(-1) ?? null;
  const agendaDocuments = decoded.documents.map(d => ({...d,meetingId:merged.aliases.get(d.meetingId) ?? d.meetingId}));
  const duplicates = exact.dropped.length + merged.dropped.length;
  const snapshotHeldAt = heldAt;
  // The placeholder only satisfies the snapshot shape for the search; readers get `snapshotHeldAt`.
  const snapshot: MeetingsSnapshot = { formatVersion: 1,generatedAt: snapshotHeldAt ?? new Date(0).toISOString(),
    counts: snapshotCounts(overlaid,duplicates),sources: [],meetings: overlaid,agendaDocuments };
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
    const meetings = overlaid.filter(m => m.bodyId === body.id), ids = new Set(meetings.map(m => m.id));
    const checked = rawSittings.filter(fact => fact.body_id === body.id && fact.field === "title").map(fact => new Date(fact.checked_at as string).toISOString()).sort().at(-1);
    return [body.id,{...snapshot,generatedAt:checked ?? snapshot.generatedAt,meetings,
      counts:snapshotCounts(meetings,[...exact.dropped,...merged.dropped].filter(m => m.bodyId === body.id).length),agendaDocuments:snapshot.agendaDocuments.filter(d => ids.has(d.meetingId))}];
  }));
  return { registry,everydayRouting:row.everyday_routing as EverydayRoutingProjection | null ?? null,
    publicationAttempts:((row.publication_attempts ?? []) as (Omit<PublicBodyAttempt,"family"> & {contractId?:string})[])
      .map(({contractId,...attempt}) => ({...attempt,family:attemptFamilyOf(contractId)})),
    bodies,meetings: overlaid,snapshot,snapshotHeldAt,bodySnapshots,
    agendaDocumentLinks:agendaDocumentLinks.map(link => ({...link,meetingId:merged.aliases.get(link.meetingId) ?? link.meetingId})),
    governments,
    divisions:row.divisions as Division[],registrationHeld:row.registration_held === true };
}
