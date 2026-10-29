import type { PlaceInput } from "./place-types.ts";

type Row = Record<string, unknown>;
type Page = { readonly row: Row; readonly order: number; readonly at: number };

const records = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const latest = (pages: readonly Page[]): Page | undefined => [...pages].sort((a, b) => a.at - b.at || a.order - b.order).at(-1);

/** An identity is kept once across overlapping ready pages; distinct records keep their own identity. */
function unique(rows: readonly Row[], key: (row: Row) => string): Row[] {
  return [...new Map(rows.map(row => [key(row), row])).values()];
}

function restoreAgendaText(value: unknown, texts: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map(child => restoreAgendaText(child, texts));
  if (!value || typeof value !== "object") return value;
  const row = value as Row;
  if (Object.hasOwn(row, "$readerAgendaText")) {
    const index = row.$readerAgendaText;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || typeof texts[index] !== "string") throw Error("READER_AGENDA_TEXT_MISSING");
    return texts[index];
  }
  return Object.fromEntries(Object.entries(row).map(([key, child]) => [key, restoreAgendaText(child, texts)]));
}

function pageTime(row: Row): number {
  const parsed = Date.parse(String(row.built_at ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Combine ready division and body rows before the single shared reader decoder runs.
 * Selecting each body's newest complete row also carries deletions: an older overlapping
 * county page cannot put back a member or field removed from its newer city page. */
export function mergePlaceRows(input: PlaceInput, rows: readonly Row[]): Row {
  const selected = new Set(input.divisionIds), named = new Set(input.namedDivisionIds ?? []);
  const pages = rows.map((row, order): Page => ({ row, order, at: pageTime(row) }));
  const aliases = Object.assign({},...pages.sort((a,b)=>a.at-b.at).map(page=>record(page.row.body_aliases))) as Record<string,string>;
  const canonical = (id: unknown): string => aliases[String(id)] ?? String(id);
  const canonicalRow = (row: Row,key="bodyId"): Row => row[key] && canonical(row[key])!==row[key] ? {...row,[key]:canonical(row[key])} : row;
  const explicitBodies = new Set((input.bodyIds ?? []).map(canonical));
  const active = pages.filter(({ row }) => input.allBodies || row.page_kind === "body"
    || row.page_kind === "empty" && input.divisionIds.length === 0 && !(input.bodyIds?.length)
    || strings(row.division_ids).some(id => selected.has(id))
    || typeof row.page_id === "string" && selected.has(row.page_id)
    || input.neighbors && !(typeof row.page_id === "string" && named.has(row.page_id))
    || records(row.entities).some(body => explicitBodies.has(canonical(body.id))));
  if (!active.length) throw Error("PLACE_PAGE_SELECTION_EMPTY");
  if (input.neighbors) for (const page of active) for (const id of strings(page.row.division_ids)) selected.add(id);

  const ordered = [...active].sort((a, b) => a.at - b.at || a.order - b.order);
  const bodyOwner = new Map<string, Page>();
  const originalOwner=new Map<string,Page>();
  const entities = new Map<string, Row>();
  for (const page of ordered) for (const body of records(page.row.entities)) {
    if (typeof body.state === "string" && body.state.toUpperCase() !== input.state.toUpperCase()) continue;
    const id = canonical(body.id), prior = entities.get(id);
    originalOwner.set(String(body.id),page);
    bodyOwner.set(id, page);
    const placed = body.placed === true || prior?.placed === true;
    const linked = body.linked === true || prior?.linked === true;
    const divisions = [...new Set([...strings(prior?.divisions),...strings(body.divisions)])].sort();
    entities.set(id, { ...body,id, divisions, ...(linked ? { linked: true } : {}), ...(placed ? { placed: true } : {}) });
  }
  const owns = (page: Page, id: unknown) => (originalOwner.get(String(id)) ?? bodyOwner.get(canonical(id))) === page;
  const ownRows = (key: string, bodyKey: string) => ordered.flatMap(page => records(page.row[key]).filter(row => owns(page, row[bodyKey]))
    .map(row=>({...row,[bodyKey]:canonical(row[bodyKey])})));

  const registries = ordered.flatMap(page => page.row.registry ? [{ page, value: record(page.row.registry) }] : []);
  const lastRegistry = registries.at(-1)?.value;
  const runtimeBodies = unique(registries.flatMap(({ page, value }) => records(record(value.registry).bodies)
    .filter(body => owns(page, body.id)).map(body=>canonicalRow(body,"id"))), row => String(row.id));
  const allRuntimeDivisions = unique(registries.flatMap(({ value }) => records(record(value.registry).divisions)), row => String(row.ocdId));
  const runtimeDivisionIds = new Set([...selected, ...runtimeBodies.flatMap(body => typeof body.ocdId === "string" ? [body.ocdId] : [])]);
  let added = true;
  while (added) {
    added = false;
    for (const division of allRuntimeDivisions) if (runtimeDivisionIds.has(String(division.ocdId)) && typeof division.parentOcdId === "string" && !runtimeDivisionIds.has(division.parentOcdId)) {
      runtimeDivisionIds.add(division.parentOcdId); added = true;
    }
  }
  const agendaOnly = input.meetingIds !== undefined;
  const registry = lastRegistry && !input.bodyFactsOnly ? {
    ...lastRegistry,
    registry: {
      ...record(lastRegistry.registry),
      bodies: runtimeBodies,
      divisions: allRuntimeDivisions.filter(division => runtimeDivisionIds.has(String(division.ocdId))),
    },
    bodyRosters: unique(registries.flatMap(({ page, value }) => records(value.bodyRosters).filter(roster => owns(page, roster.bodyId)).map(roster=>canonicalRow(roster))), row => String(row.bodyId))
      .map(roster => agendaOnly ? { ...roster, members: [] } : roster),
    rosterReaderDispositions: agendaOnly ? [] : unique(registries.flatMap(({ value }) => records(value.rosterReaderDispositions)), row => String(row.sourceId)),
    statewideExecutives: agendaOnly ? [] : unique(registries.flatMap(({ value }) => records(value.statewideExecutives))
      .filter(executive => selected.has(String(executive.stateOcdId))), row => `${row.stateOcdId}:${record(row.holder).id}`),
    officialCandidacies: {
      ...record(lastRegistry.officialCandidacies),
      rows: agendaOnly ? [] : unique(registries.flatMap(({ value }) => records(record(value.officialCandidacies).rows)),
        row => JSON.stringify([record(row.holder).id, record(row.holder).officeTitle, record(row.holder).divisions])),
    },
    officialPhotos: {
      ...record(lastRegistry.officialPhotos),
      photos: agendaOnly ? [] : unique(registries.flatMap(({ value }) => records(record(value.officialPhotos).photos)),
        row => JSON.stringify([row.officeholderId, row.personId])),
    },
    rosterPhotos: agendaOnly ? {} : Object.assign({}, ...registries.map(({ value }) => record(value.rosterPhotos))),
  } : null;

  const meetingRows = new Map<string, { header: Row; payload: Row; meetings: Row[]; documents: Row[]; members: Row[]; links: Row[] }>();
  for (const page of ordered) for (const partition of records(page.row.meeting_rows)) {
    const source = record(restoreAgendaText(partition.payload, strings(page.row.agenda_texts)));
    const meetings = records(source.meetings).filter(meeting => meeting.bodyId ? owns(page, meeting.bodyId) : selected.has(String(meeting.ocdId))
      && strings(page.row.division_ids).includes(String(meeting.ocdId))).map(meeting=>canonicalRow(meeting));
    const members = records(source.derivedMembers).filter(member => owns(page, member.bodyId)).map(member=>canonicalRow(member));
    const bodyScope = /^source:[^:]+:body:([^:]+)(?::|$)/.exec(String(partition.scope));
    const body = bodyScope ? decodeURIComponent(bodyScope[1]!) : null;
    if (!meetings.length && !members.length && !(body && owns(page, body)) && !String(partition.scope).startsWith("source:derived:family:")) continue;
    const scope = String(partition.scope), held = meetingRows.get(scope);
    const ids = new Set(meetings.map(meeting => String(meeting.id)));
    const docs = input.includeAgenda ? records(source.agendaDocuments).filter(document => ids.has(String(document.meetingId))) : [];
    const links = input.includeAgenda ? records(source.agendaDocumentLinks).filter(link => ids.has(String(link.meetingId))) : [];
    if (!held) meetingRows.set(scope, { header: partition, payload: source, meetings, documents: docs, members, links });
    else {
      held.header = partition; held.payload = source;
      held.meetings.push(...meetings); held.documents.push(...docs); held.members.push(...members); held.links.push(...links);
    }
  }

  const archivedByPage = new Map(ordered.map(page => [page, records(page.row.archived_meetings).filter(meeting => owns(page, meeting.bodyId)).map(meeting=>canonicalRow(meeting))]));
  const archived = [...archivedByPage.values()].flat();
  const last = latest(active)!;
  const allDivisions = unique(pages.flatMap(page => records(page.row.divisions)), row => String(row.ocdId));
  return {
    body_aliases: aliases,
    division_ids: [...new Set([...input.divisionIds, ...(input.neighbors ? active.flatMap(page => strings(page.row.division_ids)) : [])])],
    registry,
    everyday_routing: input.bodyFactsOnly || agendaOnly ? null : last.row.everyday_routing ?? null,
    registration_held: !input.bodyFactsOnly && !agendaOnly && active.some(page => page.row.registration_held === true),
    governments: input.bodyFactsOnly || agendaOnly ? [] : unique(ordered.flatMap(page => records(page.row.governments)), row => String(row.id)),
    divisions: input.bodyFactsOnly || agendaOnly ? [] : allDivisions.filter(division => selected.has(String(division.ocdId)) || named.has(String(division.ocdId))),
    entities: [...entities.values()],
    fields: ownRows("fields", "entity_id"),
    rosters: agendaOnly ? [] : ownRows("rosters", "body_id"),
    comments: ownRows("comments", "entity_id"),
    sittings: ownRows("sittings", "body_id"),
    meeting_rows: [...meetingRows.values()].map(({ header, payload, meetings, documents, members, links }) => ({
      ...header,
      payload: {
        ...payload,
        meetings,
        agendaDocuments: unique(documents, document => String(document.id)),
        ...(Object.hasOwn(payload, "derivedMembers") ? { derivedMembers: unique(members, member => JSON.stringify([
          member.bodyId, member.source, member.outcome, member.status, member.id,
        ])) } : {}),
        ...(links.length ? { agendaDocumentLinks: unique(links, link => JSON.stringify([link.meetingId, link.documentUrl])) } : {}),
      },
    })),
    archived_meetings: unique(archived, meeting => String(meeting.id)),
    archived_documents: input.includeAgenda ? unique(ordered.flatMap(page => {
      const ids = new Set((archivedByPage.get(page) ?? []).map(meeting => String(meeting.id)));
      return records(restoreAgendaText(page.row.archived_documents, strings(page.row.agenda_texts))).filter(document => ids.has(String(document.meetingId)));
    }), document => String(document.id)) : [],
    archived_document_links: input.includeAgenda ? unique(ordered.flatMap(page => {
      const ids = new Set((archivedByPage.get(page) ?? []).map(meeting => String(meeting.id)));
      return records(page.row.archived_document_links).filter(link => ids.has(String(link.meetingId)));
    }), link => JSON.stringify([link.meetingId, link.documentUrl])) : [],
    agenda_texts: [],
    parts: {},
  };
}
