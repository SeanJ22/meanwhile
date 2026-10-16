import type { Query } from "../facts/publish.ts";
import { readFactCommentAccess } from "../facts/comment-read.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeCarton } from "../registry/runtime-data-plane.ts";
import { registryWithFactFields } from "../registry/runtime-read-model.ts";
import { assembleAuthorityRecords, authorityRecordSource, publishStateAuthorityRecords, type AuthorityPatch, type AuthorityPlacePublication, type StateRecordPublication } from "../meetings/authority-records.ts";
import { readPublishedAuthorityIndex, type PublishAuthorityCarried, type PublishAuthorityIndex } from "../meetings/edge-serving.ts";
import { sha256OfJson, type AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { PromotionPlaceRecords, RoutineDataStore } from "./store.ts";

interface PublicationInput {
  readonly artifacts: ReaderArtifactStore;
  readonly served: AuthorityArtifactRef | undefined;
  readonly query: Query | null;
  readonly onFailure: (state: string, error: unknown) => void;
}

async function readFactStateVersions(query: Query | null, family: string): Promise<ReadonlyMap<string, string>> {
  const rows = query ? await query("SELECT state,revision::text FROM reader_fact_state_versions WHERE family=$1 ORDER BY state", [family]) : [];
  return new Map(rows.map(row => [String(row.state), String(row.revision)]));
}

async function* changedPlaces(query: Query | null, family: string, state: string, afterRevision: string, through: string) {
  if (!query) return;
  let after = "";
  for (;;) {
    const rows = await query(`SELECT owner_key,revision::text FROM reader_fact_place_versions WHERE family=$1 AND state=$2
      AND revision>$3::bigint AND revision<=$4::bigint AND owner_key>$5 ORDER BY owner_key LIMIT 128`, [family, state, afterRevision, through, after]);
    if (!rows.length) return;
    for (const row of rows) yield { owner: String(row.owner_key), revision: String(row.revision) };
    after = String(rows.at(-1)!.owner_key);
  }
}

async function registryPlace(raw: PromotionPlaceRecords, store: RoutineDataStore, query: Query | null, base: unknown): Promise<PromotionPlaceRecords> {
  const carton = assembleAuthorityRecords(base, raw.records, { keys: new Set() }) as RegistryRuntimeCarton;
  const value = await registryWithFactFields(carton, query, keys => store.readRegistryPhotos(REGISTRY_RUNTIME_SCOPE, keys));
  const bodies = new Map(value.registry.bodies.map(body => [body.id, body]));
  const bodyPaths = new Map(raw.records.filter(row => row.path.at(-2) === "bodies")
    .map(row => [(row.value as { id: string }).id, row.path.at(-1)!]));
  const records: AuthorityPatch[] = raw.records.map(row => row.path.at(-2) === "bodies"
    ? { ...row, value: bodies.get((row.value as { id: string }).id) ?? row.value } : row);
  const added = authorityRecordSource({ bodyRosters: value.bodyRosters, rosterReaderDispositions: value.rosterReaderDispositions,
    officialPhotos: value.officialPhotos, rosterPhotos: value.rosterPhotos }).records;
  const membership = new Map(value.bodyRosters.flatMap(roster => roster.members.map(member => [member.id, bodyPaths.get(roster.bodyId)] as const)));
  for (const row of added) {
    if (row.path[0] === "bodyRosters") {
      const roster = row.value as { bodyId: string };
      const index = bodyPaths.get(roster.bodyId);
      if (index === undefined) throw new Error("READER_ROSTER_BODY_MISSING");
      records.push({ ...row, path: ["bodyRosters", index] });
    } else if (row.path[0] === "rosterReaderDispositions") {
      const member = row.value as { sourceId: string; canonicalId?: string };
      const index = membership.get(member.canonicalId ?? member.sourceId);
      records.push({ ...row, path: ["rosterReaderDispositions", `${index ?? "held"}:${member.sourceId}`] });
    } else if (row.path[0] === "officialPhotos") {
      records.push({ ...row, path: ["officialPhotos", "photos", (row.value as { officeholderId: string }).officeholderId] });
    } else records.push(row);
  }
  return { base, records };
}

export async function publishRegistryStateAuthority(input: PublicationInput & { readonly store: RoutineDataStore }): Promise<PublishAuthorityCarried | PublishAuthorityIndex | null> {
  const pointer = await input.store.readPromotionIdentity("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE);
  if (!pointer) return null;
  const held = await readPublishedAuthorityIndex(input.served, input.artifacts);
  const previous = held?.kind === "READER_STATE_RECORDS" ? held : undefined;
  const facts = await readFactStateVersions(input.query, "registry-runtime");
  const replaced = previous?.sourceVersion !== pointer.versionId;
  const states = new Set(replaced ? await input.store.listPromotionStates("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, pointer.versionId) : previous.expectedStates);
  for (const state of facts.keys()) states.add(state);
  if (!states.size) states.add("us");
  const version = (state: string) => `${pointer.versionId}+${facts.get(state) ?? "0"}`;
  if (previous && input.served && previous.expectedStates.length === states.size &&
    [...states].every(state => previous.shards[state]?.version === version(state))) return { carried: true, versionId: input.served.version };
  const canonicalBase = await input.store.readPromotionBase("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, pointer.versionId);
  if (!canonicalBase) throw new Error("REGISTRY_BASE_VERSION_CHANGED");
  const base = { ...canonicalBase, bodyRosters: [], rosterReaderDispositions: [] };
  async function* publications(): AsyncGenerator<StateRecordPublication> {
    for (const state of [...states].sort()) {
      const prior = previous?.shards[state];
      const replace = !prior || prior.version.slice(0, prior.version.lastIndexOf("+")) !== pointer!.versionId;
      const through = facts.get(state) ?? "0";
      async function* places(): AsyncGenerator<AuthorityPlacePublication> {
        if (replace) {
          let after = "";
          for (;;) {
            const rows = await input.store.listPromotionPlaces("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, pointer!.versionId, state, after);
            if (!rows.length) break;
            const revisions = input.query ? await input.query(`SELECT owner_key,revision::text FROM reader_fact_place_versions
              WHERE family='registry-runtime' AND state=$1 AND owner_key=ANY($2::text[])`, [state, rows.map(row => row.owner)]) : [];
            const byOwner = new Map(revisions.map(row => [String(row.owner_key), String(row.revision)]));
            for (const row of rows) yield publication(row.owner, pointer!.versionId + ":" + row.version + "+" + (byOwner.get(row.owner) ?? "0"));
            after = rows.at(-1)!.owner;
          }
        } else for await (const row of changedPlaces(input.query, "registry-runtime", state, prior.version.slice(prior.version.lastIndexOf("+") + 1), through)) {
          yield publication(row.owner, `fact:${row.revision}`);
        }
      }
      function publication(owner: string, placeVersion: string): AuthorityPlacePublication {
        return { owner, version: placeVersion, load: async () => {
          const raw = await input.store.readPromotionPlace("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, pointer!.versionId, owner);
          if (!raw) throw new Error("REGISTRY_PLACE_VERSION_CHANGED");
          return registryPlace(raw, input.store, input.query, base);
        } };
      }
      yield { state, version: version(state), base, replace, places };
    }
  }
  const index = { ...await publishStateAuthorityRecords(publications(), input.artifacts, previous, input.onFailure), sourceVersion: pointer.versionId };
  return { index, versionId: pointer.versionId + "+" + sha256OfJson([index.expectedStates, index.shards]) };
}

export async function publishCommentStateAuthority(input: PublicationInput): Promise<PublishAuthorityCarried | PublishAuthorityIndex> {
  const held = await readPublishedAuthorityIndex(input.served, input.artifacts);
  const previous = held?.kind === "READER_STATE_RECORDS" ? held : undefined;
  const facts = await readFactStateVersions(input.query, "comment-access");
  const states = new Set(["us", ...facts.keys()]);
  const version = (state: string) => facts.get(state) ?? "0";
  if (previous && input.served && previous.expectedStates.length === states.size &&
    [...states].every(state => previous.shards[state]?.version === version(state))) return { carried: true, versionId: input.served.version };
  const base = { kind: "comment-access", records: [] };
  async function* publications(): AsyncGenerator<StateRecordPublication> {
    for (const state of [...states].sort()) {
      const prior = previous?.shards[state];
      async function* places(): AsyncGenerator<AuthorityPlacePublication> {
        for await (const place of changedPlaces(input.query, "comment-access", state, prior?.version ?? "0", version(state))) {
          yield { owner: place.owner, version: place.revision, load: async () => {
            const bodies = input.query ? await input.query(`SELECT e.id FROM entity e WHERE e.kind='body' AND
              (e.id=$1 OR split_part(e.id,'#',1)=$1 OR EXISTS(SELECT 1 FROM entity_place p WHERE p.entity_id=e.id AND p.place_id=$1)
                OR EXISTS(SELECT 1 FROM reader_place_records r WHERE r.owner_key=$1 AND r.selectors && ARRAY[e.id]
                  AND r.pointer_key LIKE 'REGISTRY_RUNTIME_BINDING:%' AND r.path->>-2='bodies'))`, [place.owner]) : [];
            const records = input.query ? await readFactCommentAccess(input.query, bodies.map(body => String(body.id))) : [];
            const value = authorityRecordSource({ ...base, records: records.map(record => ({ id: `comment-access:${record.bodyId}`, ...record })) });
            return { base, records: value.records.map(row => ({ ...row, path: ["records", (row.value as { bodyId: string }).bodyId] })) };
          } };
        }
      }
      yield { state, version: version(state), base, replace: !prior, places };
    }
  }
  const index = await publishStateAuthorityRecords(publications(), input.artifacts, previous, input.onFailure);
  return { index, versionId: sha256OfJson([index.expectedStates, index.shards]) };
}

export async function publishIndexedPromotedFamily(input: Omit<PublicationInput, "query"> & {
  readonly store: RoutineDataStore;
  readonly pointers: readonly { readonly recordClass: import("./types.ts").RoutineRecordClass; readonly scope: string }[];
  readonly versionId: string;
}): Promise<PublishAuthorityIndex> {
  const held = await readPublishedAuthorityIndex(input.served, input.artifacts);
  const previous = held?.kind === "READER_STATE_RECORDS" ? held : undefined;
  const pointers = await Promise.all(input.pointers.map(async pointer => {
    const identity = await input.store.readPromotionIdentity(pointer.recordClass, pointer.scope);
    const header = identity ? await input.store.readPromotionHeader(pointer.recordClass, pointer.scope, identity.versionId)
      : { kind: "NOT_RECORDED" as const, ...pointer };
    if (!header) throw new Error("READER_POINTER_VERSION_CHANGED");
    const states = identity ? await input.store.listPromotionStates(pointer.recordClass, pointer.scope, identity.versionId) : [];
    return { ...pointer, identity, header, states, tag: `pointer:${pointer.recordClass}:${pointer.scope}` };
  }));
  const base = { kind: "PROMOTED_POINTERS", entries: [] };
  const states = new Set(["us", ...pointers.flatMap(pointer => pointer.states)]);
  async function* publications(): AsyncGenerator<StateRecordPublication> {
    for (const state of [...states].sort()) {
      async function* places(): AsyncGenerator<AuthorityPlacePublication> {
        for (const [index, pointer] of pointers.entries()) {
          const prefix = ["entries", index, "projection", "payload"] as const;
          const metadata = (tag: string) => tag.startsWith("frame:") ? `frame:${pointer.tag}:${tag.slice(6)}` : tag;
          if (state === "us") {
            yield { owner: pointer.tag, version: sha256OfJson(pointer.header), load: async () => ({ base, records: [{
              path: ["entries", index], value: pointer.header.kind === "PROMOTED"
                ? { ...pointer.header, attested: { ...pointer.header.attested, payloadSha256: "" } } : pointer.header,
              tags: [pointer.tag, "shared"], initialize: true,
            }] }) };
          }
          if (!pointer.identity || !pointer.states.includes(state)) continue;
          let after = "";
          for (;;) {
            const rows = await input.store.listPromotionPlaces(pointer.recordClass, pointer.scope, pointer.identity.versionId, state, after);
            if (!rows.length) break;
            for (const row of rows) yield { owner: pointer.tag + ":" + row.owner, version: row.version, load: async () => {
              const raw = await input.store.readPromotionPlace(pointer.recordClass, pointer.scope, pointer.identity!.versionId, row.owner);
              if (!raw) throw new Error("READER_PLACE_VERSION_CHANGED");
              return { base, records: raw.records.map(record => ({ ...record, path: [...prefix, ...record.path],
                tags: record.tags.map(metadata), metadata: [pointer.tag, ...record.metadata?.map(metadata) ?? []] })) };
            } };
            after = rows.at(-1)!.owner;
          }
        }
      }
      yield { state, version: input.versionId, base, replace: true, places };
    }
  }
  const index = { ...await publishStateAuthorityRecords(publications(), input.artifacts, previous, input.onFailure), sourceVersion: input.versionId };
  return { index, versionId: input.versionId };
}
