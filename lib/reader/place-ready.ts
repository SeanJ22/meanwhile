import { Buffer } from "node:buffer";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, inflateRawSync } from "node:zlib";
import { PAGE_DICTIONARY } from "./page-dictionary.ts";

interface PackedReadyPlace {
  readonly encoding: "br-json-v1" | "gzip-json-v1" | "dfl-dict-v1";
  readonly data: string;
}

/** Brotli, which the release before this one reads. Pages against the shared dictionary ("dfl-dict-v1") are read here but not yet written, so a rollback never meets a page it cannot decode. */
function pack(page: unknown): PackedReadyPlace {
  return { encoding: "br-json-v1", data: brotliCompressSync(JSON.stringify(page), {params:{[constants.BROTLI_PARAM_QUALITY]:5}}).toString("base64") };
}

function unpack<T>(page: unknown): T {
  if (!page || typeof page !== "object" || !("encoding" in page)) return page as T;
  if (!["br-json-v1","gzip-json-v1","dfl-dict-v1"].includes(String(page.encoding)) || !("data" in page) || typeof page.data !== "string")
    throw new Error("PLACE_PAGE_ENCODING_INVALID");
  const bytes=Buffer.from(page.data,"base64");
  const text=page.encoding==="br-json-v1"?brotliDecompressSync(bytes):page.encoding==="dfl-dict-v1"?inflateRawSync(bytes,{dictionary:PAGE_DICTIONARY}):gunzipSync(bytes);
  return JSON.parse(text.toString("utf8")) as T;
}

type Row = Record<string,unknown>;


/** The page without its agenda documents and archived texts, which a first look does not read. */
export function briefPlaceRow(full: Row): Row {
  return {...full,agenda_texts:[],archived_documents:[],archived_document_links:[],
    meeting_rows:(full.meeting_rows as Row[]).map(partition=>({...partition,
      payload:{...partition.payload as Row,agendaDocuments:[],agendaDocumentLinks:[]}}))};
}

/** The brief page without the registry, governments and divisions, for a read of boards' facts alone. */
export const factsPlaceRow = (brief: Row): Row => ({...brief,registry:null,governments:[],divisions:[],registration_held:false});

/** Build each requested transfer shape once; readers select one compressed row. */
export function packPlaceContext(context: Row): Row {
  const packed:Row={formatVersion:context.formatVersion};
  for(const key of ["current","history","emptyCurrent","emptyHistory"]) {
    const source=context[key] as Row|undefined;
    if(!source)continue;
    const full={...source};
    delete full.body_aliases;
    const brief=briefPlaceRow(full);
    packed[key]={full:pack(full),brief:pack(brief),facts:pack(factsPlaceRow(brief))};
  }
  return packed;
}

export function unpackPlaceContextRow(row:unknown):Row { return unpack(row); }
