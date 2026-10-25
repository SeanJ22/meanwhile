import { Buffer } from "node:buffer";
import { gzipSync, gunzipSync } from "node:zlib";
import type { PlacePackage } from "./place-types.ts";

interface PackedReadyPlace {
  readonly encoding: "gzip-json-v1";
  readonly data: string;
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
export function packReadyPlace(page: PlacePackage): PackedReadyPlace { return pack(page); }

/** Previously built uncompressed pages remain readable until their next rebuild. */
export function unpackReadyPlace(page: unknown): PlacePackage { return unpack(page); }

type Row = Record<string,unknown>;

/** Build each requested transfer shape once; readers select one compressed row. */
export function packPlaceContext(context: Row): Row {
  const packed:Row={formatVersion:context.formatVersion};
  for(const key of ["current","history","emptyCurrent","emptyHistory"]) {
    const full=context[key] as Row|undefined;
    if(!full)continue;
    const brief={...full,agenda_texts:[],archived_documents:[],archived_document_links:[],
      meeting_rows:(full.meeting_rows as Row[]).map(partition=>({...partition,
        payload:{...partition.payload as Row,agendaDocuments:[],agendaDocumentLinks:[]}}))};
    const facts={...brief,registry:null,everyday_routing:null,governments:[],divisions:[],registration_held:false};
    packed[key]={full:pack(full),brief:pack(brief),facts:pack(facts)};
  }
  return packed;
}

export function unpackPlaceContextRow(row:unknown):Row { return unpack(row); }
