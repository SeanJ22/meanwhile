import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { gzipSync, gunzipSync } from "node:zlib";
import { routineScopeState } from "../civic-data/state-scope.ts";
import { snapshotCounts } from "../meetings/snapshot.ts";
import { meetingAreaScope, PROMOTED_AUTHORITY_FAMILIES, sha256OfJson, stateOfOcdId, type AuthorityArtifactRef, type AuthorityFamily,
  type PromotedFamilyArtifactValue,
  type ReaderGeoArtifact, type ReaderManifest, type ReaderManifestScope } from "../meetings/edge-artifacts.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore, type StoredManifest } from "../meetings/edge-store.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { Meeting } from "../sources/types.ts";

type Located = { readonly ocdId?: string | null; readonly bodyId?: string | null };
const stateOf = (value: Located): string | null => {
  const state = stateOfOcdId(value.ocdId) ?? stateOfOcdId(value.bodyId);
  if (state) return state.toUpperCase();
  return [value.ocdId, value.bodyId].some(id => id?.startsWith("ocd-division/country:us")) ? "US" : null;
};
const namedState = (scope: ReaderManifestScope): string | null => stateOfOcdId(scope.ocdId)?.toUpperCase() ??
  /^(?:area-)?([a-z]{2})(?:-|$)/i.exec(scope.scope)?.[1]?.toUpperCase() ?? null;
const idsOf = (artifact: ReaderGeoArtifact) => [...new Set([...artifact.meetingIds ?? [],
  ...artifact.meetings.flatMap(row => [row.id, ...row.mergedMeetingIds ?? []]), ...artifact.agendaDocuments.map(row => row.meetingId)])];

function extrasFor(root: ReaderManifest, state: string, bodyIds: ReadonlySet<string>): Partial<ReaderManifest> {
  const inState = (key: string) => routineScopeState(key).replace(/^US-/, "") === state;
  const comments = root.commentAccess?.filter(row => {
    const value = row as Located;
    return stateOf(value) === state || value.bodyId && bodyIds.has(value.bodyId);
  });
  const freshChecks = Object.fromEntries(Object.entries(root.freshChecks ?? {}).filter(([route]) => {
    const bodyId = route.slice(route.indexOf("|") + 1);
    return stateOf({ bodyId }) === state || bodyIds.has(bodyId);
  }));
  return { ...(comments ? { commentAccess: comments } : {}),
    ...(root.extrasVersionIds?.["comment-access"] ? { extrasVersionIds: { "comment-access": root.extrasVersionIds["comment-access"] } } : {}), freshChecks,
    registrations: Object.fromEntries(Object.entries(root.registrations ?? {}).filter(([key]) => inState(key))),
    stateLegislators: Object.fromEntries(Object.entries(root.stateLegislators ?? {}).filter(([key]) => inState(key))) };
}

async function writeState(store: ReaderArtifactStore, root: ReaderManifest, state: string,
  scopes: readonly ReaderManifestScope[], bodyIds: ReadonlySet<string>, sources: ReadonlySet<string>,
  authority: Partial<Record<AuthorityFamily, AuthorityArtifactRef>> = {}): Promise<void> {
  const extras = extrasFor(root, state, bodyIds);
  while (true) {
    const held = await store.readManifest(state), current = held?.manifest;
    if (current && current.generatedAt > root.generatedAt) return;
    const byScope = new Map((current?.scopes ?? []).map(scope => [scope.scope, scope]));
    for (const scope of scopes) {
      const prior = byScope.get(scope.scope);
      if (!prior || prior.generatedAt <= scope.generatedAt) byScope.set(scope.scope, scope);
    }
    const checks = { ...extras.freshChecks, ...current?.freshChecks };
    for (const [key, at] of Object.entries(extras.freshChecks ?? {})) if (!checks[key] || checks[key]! < at) checks[key] = at;
    const comments = new Map((extras.commentAccess ?? []).map(row => [(row as Located).bodyId, row]));
    for (const row of current?.commentAccess ?? []) if (!comments.has((row as Located).bodyId)) comments.set((row as Located).bodyId, row);
    const incomingSources = root.sources.filter(source => sources.has(source.source));
    const sourceRows = new Map(incomingSources.map(source => [source.source, source]));
    for (const source of current?.sources ?? []) if (!sourceRows.has(source.source)) sourceRows.set(source.source, source);
    const manifest: ReaderManifest = { formatVersion: root.formatVersion, sequence: current?.sequence ?? root.sequence,
      meetingLayout: "governing-area",
      ...(root.meetingRegistryVersion !== undefined ? { meetingRegistryVersion: root.meetingRegistryVersion } : {}),
      ...(current ?? {}), ...extras, scopes: [...byScope.values()], sources: [...sourceRows.values()], freshChecks: checks,
      generatedAt: root.generatedAt, sourceThrough: root.sourceThrough, retrievedAt: root.retrievedAt, promotedThrough: root.promotedThrough,
      commentAccess: [...comments.values()],
      authorityArtifacts: { ...current?.authorityArtifacts, ...authority },
      registrations: { ...current?.registrations, ...extras.registrations },
      stateLegislators: { ...current?.stateLegislators, ...extras.stateLegislators } };
    if (current && isDeepStrictEqual(current, manifest)) return;
    const { publicationFingerprint: _fingerprint, ...changed } = manifest;
    if ((await store.writeManifest({ ...changed, sequence: current ? current.sequence + 1 : manifest.sequence }, held?.etag ?? null, state)).modified) return;
  }
}

async function dividedArtifacts(store: ReaderArtifactStore, scope: ReaderManifestScope, artifact: ReaderGeoArtifact) {
  const state = namedState(scope);
  if (state && state !== "US") return [{ state, scope, artifact }];
  const groups = new Map<string, { state: string; ocdId: string; meetings: Meeting[]; agenda: ReaderGeoArtifact["agendaDocuments"] }>();
  const meetingPlaces = new Map<string, { state: string; division?: string | null }>();
  const group = (own: string, ocdId?: string | null) => {
    const division = ocdId?.split("#")[0] ?? `ocd-division/country:us${own === "US" ? "" : `/state:${own.toLowerCase()}`}`;
    const key = `${own}:${division}`;
    let held = groups.get(key);
    if (!held) {
      held = { state: own, ocdId: division, meetings: [], agenda: [] };
      groups.set(key, held);
    }
    return held;
  };
  for (const meeting of artifact.meetings) {
    const own = stateOf(meeting);
    if (!own) throw new Error(`R4_MEETING_ARTIFACT_STATE_MISSING:${meeting.id}`);
    group(own, meeting.ocdId ?? meeting.bodyId).meetings.push(meeting);
    for (const id of [meeting.id, ...meeting.mergedMeetingIds ?? []]) meetingPlaces.set(id, { state: own, division: meeting.ocdId ?? meeting.bodyId });
  }
  for (const doc of artifact.agendaDocuments) {
    const place = meetingPlaces.get(doc.meetingId);
    const own = place?.state ?? await store.readMeetingState(doc.meetingId) ?? stateOf(doc);
    if (!own) throw new Error(`R4_MEETING_ARTIFACT_STATE_MISSING:${doc.meetingId}`);
    group(own, place?.division ?? doc.ocdId).agenda.push(doc);
  }
  const out = [];
  for (const held of groups.values()) {
    const next: ReaderGeoArtifact = { formatVersion: artifact.formatVersion, generatedAt: artifact.generatedAt,
      scope: `${meetingAreaScope(held.ocdId)}-r4-${createHash("sha256").update(scope.scope).digest("hex").slice(0, 12)}`,
      ocdId: held.ocdId, ...(artifact.agendaOnly ? { agendaOnly: true } : {}),
      counts: { ...snapshotCounts(held.meetings, 0), duplicatesCollapsed: 0 }, meetings: held.meetings, agendaDocuments: held.agenda };
    const complete = { ...next, meetingIds: idsOf(next) }, bytes = new TextEncoder().encode(JSON.stringify(complete));
    const key = await store.putImmutable(bytes, "json");
    out.push({ state: held.state, artifact: complete, scope: { scope: complete.scope, ocdId: complete.ocdId,
      meetingIds: complete.meetingIds, ...(complete.agendaOnly ? { agendaOnly: true } : {}), key,
      sha256: createHash("sha256").update(bytes).digest("hex"), meetingCount: complete.meetings.length, generatedAt: complete.generatedAt } });
  }
  return out;
}

async function copyAuthorities(store: ReaderArtifactStore, root: ReaderManifest, states: Set<string>) {
  const rootRefs = { ...root.authorityArtifacts };
  for (const family of ["meeting-outcomes", "comment-access", ...PROMOTED_AUTHORITY_FAMILIES] as const) {
    const ref = root.authorityArtifacts?.[family];
    if (!ref) continue;
    const bytes = await store.readBytes(ref.key);
    if (!bytes) throw new Error(`R4_MEETING_AUTHORITY_MISSING:${family}`);
    const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as { value: unknown; versionId: string; generatedAt: string; family: string; formatVersion: number };
    if (envelope.formatVersion !== root.formatVersion || envelope.family !== family || envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) {
      throw new Error(`R4_MEETING_AUTHORITY_INVALID:${family}`);
    }
    const save = async (value: unknown, state: string) => {
      const version = `${ref.version}:${state}`, next = { ...envelope, versionId: version, value };
      const key = await store.putImmutable(gzipSync(JSON.stringify(next)), "json.gz");
      return { key, version, sha: sha256OfJson(value) };
    };
    const values = new Map<string, unknown>();
    if (family === "meeting-outcomes") {
      const value = envelope.value as OutcomeSnapshot;
      for (const sitting of value.sittings) {
        const state = stateOf(sitting);
        if (!state) throw new Error(`R4_MEETING_OUTCOME_STATE_MISSING:${sitting.meetingId}`);
        states.add(state);
      }
      for (const state of states) {
        const sittings = value.sittings.filter(row => stateOf(row) === state);
        if (!sittings.length) continue;
        const tenants = [...new Set(sittings.map(row => row.slug))];
        values.set(state, { ...value, sittings, tenants, ...(value.pointers ? { pointers: value.pointers.filter(row => tenants.includes(row.tenant)) } : {}) });
      }
      delete rootRefs[family];
    } else if (family === "comment-access") {
      const value = envelope.value as { records: Located[] };
      for (const record of value.records) {
        const state = stateOf(record);
        if (!state) throw new Error("R4_COMMENT_ARTIFACT_STATE_MISSING");
        states.add(state);
      }
      for (const state of states) values.set(state, { ...value, records: value.records.filter(row => stateOf(row) === state) });
      delete rootRefs[family];
    } else {
      const value = envelope.value as PromotedFamilyArtifactValue;
      if (value.kind !== "PROMOTED_POINTERS" || !Array.isArray(value.entries)) throw new Error(`R4_PROMOTED_AUTHORITY_INVALID:${family}`);
      const groups = new Map<string, PromotedFamilyArtifactValue["entries"][number][]>();
      for (const entry of value.entries) {
        const scope = entry.kind === "PROMOTED" ? entry.projection.scope : entry.kind === "NOT_RECORDED" ? entry.scope : null;
        if (typeof scope !== "string") throw new Error(`R4_PROMOTED_AUTHORITY_SCOPE_MISSING:${family}`);
        const state = routineScopeState(scope).replace(/^US-/, ""), rows = groups.get(state) ?? [];
        rows.push(entry); groups.set(state, rows);
      }
      for (const [state, entries] of groups) if (state !== "US") {
        states.add(state); values.set(state, { ...value, entries });
      }
      if (values.size === 0) continue;
      const national = groups.get("US");
      if (national?.length) rootRefs[family] = await save({ ...value, entries: national }, "US");
      else delete rootRefs[family];
    }
    for (const [state, value] of values) {
      await writeState(store, root, state, [], new Set(), new Set(), { [family]: await save(value, state) });
    }
  }
  return rootRefs;
}

async function copyRoot(store: ReaderArtifactStore, root: StoredManifest) {
  const states = new Set<string>();
  let scopes = 0;
  for (const scope of [...root.manifest.scopes].sort((a, b) => Number(!!a.agendaOnly) - Number(!!b.agendaOnly))) {
    const artifact = await store.readArtifact(scope.key);
    if (!artifact) throw new Error(`R4_MEETING_ARTIFACT_MISSING:${scope.key}`);
    for (const part of await dividedArtifacts(store, scope, artifact)) {
      states.add(part.state); scopes++;
      await store.writeMeetingStates(idsOf(part.artifact), part.state);
      await writeState(store, root.manifest, part.state, [part.scope],
        new Set(part.artifact.meetings.flatMap(row => row.bodyId ? [row.bodyId] : [])),
        new Set(part.artifact.meetings.map(row => row.id.split(":")[0]!)));
    }
  }
  const authorityArtifacts = await copyAuthorities(store, root.manifest, states);
  return { states: states.size, scopes, authorityArtifacts };
}

export async function transferMeetingArtifacts(store: ReaderArtifactStore | null = resolveReaderArtifactWriteStore()) {
  if (!store) throw new Error("R4_MEETING_ARTIFACT_STORE_UNAVAILABLE");
  const root = await store.readManifest();
  if (!root) return { states: 0, scopes: 0 };
  const { authorityArtifacts: _refs, ...moved } = await copyRoot(store, root);
  return moved;
}

export async function retireMeetingArtifacts(store: ReaderArtifactStore | null = resolveReaderArtifactWriteStore()) {
  if (!store) throw new Error("R4_MEETING_ARTIFACT_STORE_UNAVAILABLE");
  const root = await store.readManifest();
  if (!root) return { states: 0, scopes: 0 };
  const { authorityArtifacts, ...moved } = await copyRoot(store, root);
  const { freshChecks: _checks, composition: _composition, meetingLayout: _layout, meetingRegistryVersion: _registry,
    commentAccess: _comments, ...authority } = root.manifest;
  const next = { ...authority, scopes: [], sources: [], authorityArtifacts };
  if (isDeepStrictEqual(next, root.manifest)) return moved;
  const { publicationFingerprint: _fingerprint, ...changed } = next;
  if (!(await store.writeManifest({ ...changed, sequence: authority.sequence + 1 }, root.etag)).modified) throw new Error("R4_MEETING_ROOT_MANIFEST_MOVED");
  return moved;
}
