import { Buffer } from "node:buffer";
import { brotliCompressSync, brotliDecompressSync, constants, deflateRawSync, gunzipSync, inflateRawSync } from "node:zlib";
import { PAGE_DICTIONARY } from "./page-dictionary.ts";

interface PackedReadyPlace {
  readonly encoding: "br-json-v1" | "gzip-json-v1" | "dfl-dict-v1";
  readonly data: string;
}

/** Whichever is smaller: brotli, which wins on a large page, or deflate against the shared dictionary, which wins on a small one. */
function pack(page: unknown): PackedReadyPlace {
  const json = JSON.stringify(page);
  const brotli = brotliCompressSync(json, {params:{[constants.BROTLI_PARAM_QUALITY]:5}});
  const deflated = deflateRawSync(json, {level:9, dictionary:PAGE_DICTIONARY});
  return deflated.length < brotli.length ? { encoding: "dfl-dict-v1", data: deflated.toString("base64") }
    : { encoding: "br-json-v1", data: brotli.toString("base64") };
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

/** Build each requested transfer shape once; readers select one compressed row. */
export function packPlaceContext(context: Row): Row {
  const packed:Row={formatVersion:context.formatVersion};
  for(const key of ["current","history","emptyCurrent","emptyHistory"]) {
    const source=context[key] as Row|undefined;
    if(!source)continue;
    const full={...source};
    delete full.body_aliases;
    const brief={...full,agenda_texts:[],archived_documents:[],archived_document_links:[],
      meeting_rows:(full.meeting_rows as Row[]).map(partition=>({...partition,
        payload:{...partition.payload as Row,agendaDocuments:[],agendaDocumentLinks:[]}}))};
    const facts={...brief,registry:null,governments:[],divisions:[],registration_held:false};
    packed[key]={full:pack(full),brief:pack(brief),facts:pack(facts)};
  }
  return packed;
}

export function unpackPlaceContextRow(row:unknown):Row { return unpack(row); }
