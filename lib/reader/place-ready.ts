import { Buffer } from "node:buffer";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PlacePackage } from "./place-types.ts";
import type { BodyTerritorySelection } from "../registry/body-territory.ts";
import { preparePlaceRosters } from "./body-roster.ts";
import { shareReaderValues, expandReaderValues } from "./shared.ts";

interface PackedReadyPlace {
  readonly encoding: "gzip-json-v1";
  readonly data: string;
  readonly territory?: PackedReadyPlace;
}

function pack(page: unknown): PackedReadyPlace {
  return { encoding: "gzip-json-v1", data: gzipSync(JSON.stringify(page)).toString("base64") };
}

function unpack<T>(page: unknown): T {
  if (!page || typeof page !== "object" || !("encoding" in page)) return page as T;
  if (page.encoding !== "gzip-json-v1" || !("data" in page) || typeof page.data !== "string")
    throw new Error("PLACE_PAGE_ENCODING_INVALID");
  return JSON.parse(gunzipSync(Buffer.from(page.data, "base64")).toString("utf8")) as T;
}

/** Compress the complete JSON response before it crosses the database connection. */
export function packReadyPlace(page: PlacePackage,territory?:BodyTerritorySelection|null): PackedReadyPlace {
  return {...pack(shareReaderValues(preparePlaceRosters(page).place)),...(territory===undefined?{}:{territory:pack(territory)})};
}

/** Previously built uncompressed pages remain readable until their next rebuild. */
export function unpackReadyPlace(page: unknown): PlacePackage { return expandReaderValues(unpack<PlacePackage>(page)); }

/** Undefined is a legacy page; null is a saved selection with no territory geometry. */
export function unpackReadyTerritory(page:unknown):BodyTerritorySelection|null|undefined {
  return page && typeof page==='object' && 'encoding' in page && 'territory' in page
    ? unpack<BodyTerritorySelection|null>(page.territory) : undefined;
}

type Row = Record<string,unknown>;

/** Build each requested transfer shape once; readers select one compressed row. */
export function packPlaceContext(context: Row): Row {
  const packed:Row={formatVersion:context.formatVersion};
  for(const key of ["current","history","emptyCurrent","emptyHistory"]) {
    const original=context[key] as Row|undefined;
    if(!original)continue;
    const full:Row=original;
    const brief={...full,...(original.roster_refs ? { rosters: [], registry: original.registry ? {
        ...original.registry as Row,
        bodyRosters: ((original.registry as Row).bodyRosters as Row[]).map(roster => {
          const { members, membershipHistory, ...header } = roster; void members; void membershipHistory;
          return { ...header, members: [] };
        }),
        rosterReaderDispositions: [], rosterPhotos: {}, officialPhotos: { photos: [] },
        officialCandidacies: { ...(original.registry as Row).officialCandidacies as Row, rows: [] },
      } : null } : {}),agenda_texts:[],archived_documents:[],archived_document_links:[],
      meeting_rows:(full.meeting_rows as Row[]).map(partition=>({...partition,
        payload:{...partition.payload as Row,agendaDocuments:[],agendaDocumentLinks:[]}}))};
    const facts={...brief,rosters:original.rosters,roster_refs:undefined,registry:null,everyday_routing:null,governments:[],divisions:[],registration_held:false};
    packed[key]={full:pack(full),brief:pack(brief),facts:pack(facts)};
  }
  return packed;
}

export function unpackPlaceContextRow(row:unknown):Row { return unpack(row); }
