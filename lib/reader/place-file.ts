import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { briefPlaceRow, factsPlaceRow } from "./place-ready.ts";
import { placeCheckRequest, type PlaceChecks } from "./place-checks.ts";
import { shownFields } from "./place-identity.ts";
import { mergeSelectedPages } from "./place-compose.ts";
import { composePlaceRow } from "./place-decode.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import type { PlaceInput, PlacePackage } from "./place-types.ts";

type Row = Record<string, unknown>;
export type PlaceFileVariant = "current" | "history" | "emptyCurrent" | "emptyHistory";
export const PLACE_FILE_VARIANTS: readonly PlaceFileVariant[] = ["current", "history", "emptyCurrent", "emptyHistory"];
/** The agenda documents and archived texts a first look does not read, kept beside the brief page so a longer look can restore the whole page. */
export type PlaceAgenda = Pick<Row, "agenda_texts" | "archived_documents" | "archived_document_links"> & { readonly meetingAgenda: readonly (readonly [unknown, unknown])[] };

/**
 * One place's file. It is the same for every reader and holds nothing about any one of them: the saved page with the body identities already
 * applied, the dates its facts were last checked, and (for a place of a state) the place's share of the state's answer.
 */
export interface PlaceFile {
  readonly v: 1;
  readonly id: string;
  readonly kind: "place" | "body";
  readonly state: string | null;
  readonly version: number;
  /** When the page was built, in milliseconds. */
  readonly builtAt: number;
  /** When the dates its facts were checked were read, in milliseconds. */
  readonly readAt: number;
  readonly variants: Readonly<Partial<Record<PlaceFileVariant, { readonly row: Row; readonly agenda?: PlaceAgenda; readonly checks?: PlaceChecks }>>>;
  /** The place's share of its state's answer. */
  readonly share?: unknown;
  /** The statewide part of the state's answer, on the state's own file. */
  readonly wide?: unknown;
}

const records = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];

/** The brief page and what the brief leaves out of the full page. */
export function splitAgenda(full: Row): { readonly brief: Row; readonly agenda?: PlaceAgenda } {
  const brief = briefPlaceRow(full);
  const meetingAgenda = records(full.meeting_rows).map(part => [(part.payload as Row).agendaDocuments ?? null, (part.payload as Row).agendaDocumentLinks ?? null] as const);
  const none = (value: unknown) => !(value as unknown[] | null | undefined)?.length;
  const bare = none(full.agenda_texts) && none(full.archived_documents) && none(full.archived_document_links) && meetingAgenda.every(([docs, links]) => none(docs) && none(links));
  return bare ? { brief } : { brief, agenda: { agenda_texts: full.agenda_texts, archived_documents: full.archived_documents, archived_document_links: full.archived_document_links, meetingAgenda } };
}

const withAgenda = (brief: Row, agenda: PlaceAgenda | undefined): Row => !agenda ? brief : { ...brief, agenda_texts: agenda.agenda_texts, archived_documents: agenda.archived_documents,
  archived_document_links: agenda.archived_document_links, meeting_rows: records(brief.meeting_rows).map((part, n) => {
    const [docs, links] = agenda.meetingAgenda[n]!, { agendaDocuments: _docs, agendaDocumentLinks: _links, ...rest } = part.payload as Row;
    return { ...part, payload: { ...rest, ...(docs === null ? {} : { agendaDocuments: docs }), ...(links === null ? {} : { agendaDocumentLinks: links }) } };
  }) };

/** What a ZIP's places are read as: the shape of a read decides which saved row of the page it takes. */
export interface PlaceFileRead { readonly history: boolean; readonly empty: boolean; readonly includeAgenda: boolean; readonly bodyFactsOnly: boolean; readonly zip: boolean }

/** The saved row a read takes from a file, with its check dates as they were last read, or null when the file holds none for this shape. */
export function placeFileRow(file: PlaceFile, read: PlaceFileRead): Row | null {
  const held = file.variants[read.empty ? (read.history ? "emptyHistory" : "emptyCurrent") : read.history ? "history" : "current"];
  if (!held) return null;
  const row = read.includeAgenda ? withAgenda(held.row, held.agenda) : read.bodyFactsOnly ? factsPlaceRow(held.row) : held.row;
  return shownFields(placeCheckRequest(row).apply(held.checks), read.zip);
}

/** The files a read of places is made from. */
export interface PlaceFileSource {
  readonly file: (id: string) => Promise<PlaceFile | null>;
  /** Whether the place is one of this state's published places: a ZIP crossing a state line names the places of the other side too. */
  readonly has: (id: string) => boolean;
  /** A board folded into another is read as the board it was folded into. */
  readonly canonicalBody: (id: string) => string;
  readonly routing: () => Promise<EverydayRoutingProjection | null>;
}

/** The places a read of a ZIP selects: its divisions, the ones it only names, and the boards its territory names. */
export function selectedPlaceIds(input: PlaceInput, canonicalBody: (id: string) => string): string[] {
  if (input.neighbors || input.allBodies) throw new Error("PLACE_FILES_SELECTION_UNSUPPORTED");
  const empty = !input.divisionIds.length && !input.bodyIds?.length;
  const state = input.state.toLowerCase();
  return [...new Set(empty ? ["ocd-division/country:us", `ocd-division/country:us/state:${state}`]
    : [...input.divisionIds, ...input.namedDivisionIds ?? [], ...(input.bodyIds ?? []).map(canonicalBody)])].sort();
}

/** The same package a read of the saved pages makes, from the places' files alone. */
export async function loadPlaceFromFiles(input: PlaceInput, source: PlaceFileSource): Promise<PlacePackage> {
  const wanted = selectedPlaceIds(input, source.canonicalBody).filter(source.has);
  const empty = !input.allBodies && !input.divisionIds.length && !input.bodyIds?.length;
  const read: PlaceFileRead = { history: input.includeHistory ?? false, empty, includeAgenda: input.includeAgenda ?? false, bodyFactsOnly: input.bodyFactsOnly ?? false, zip: input.placeId !== undefined };
  const state = input.state.toUpperCase();
  const pages = (await Promise.all(wanted.map(async id => ({ id, file: await source.file(id) }))))
    .filter(({ file }) => file === null || file.state === null || file.state === state);
  const rows = pages.map(({ id, file }) => {
    const row = file && placeFileRow(file, read);
    if (!file || !row) throw new Error(`PLACE_FILE_MISSING:${id}`);
    return { page_id: id, page_kind: file.kind, built_at: file.builtAt, row };
  });
  const bodies = (input.bodyIds ?? []).map(source.canonicalBody);
  const { canonical, merged } = mergeSelectedPages(input, bodies, rows);
  const routing = input.bodyFactsOnly || input.meetingIds !== undefined ? null : await source.routing();
  return { ...await composePlaceRow(canonical, merged), everydayRouting: routing };
}

/* ---- the bytes ------------------------------------------------------------------------------------------------------ */

/** The file as stored: the JSON, brotli compressed. */
export const packFile = (value: unknown): Uint8Array => brotliCompressSync(JSON.stringify(value), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
export const unpackFile = <T>(bytes: Uint8Array): T => JSON.parse(brotliDecompressSync(bytes).toString("utf8")) as T;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);
/** The file's version stamp, which is its name: the hash of everything it says. */
export const fileHash = (value: unknown): string => digest(JSON.stringify(value));
/** What the file says apart from the dates its facts were checked, so a check alone is not a change. */
export const contentHash = (file: PlaceFile): string => fileHash({ ...file, readAt: 0, variants: Object.fromEntries(Object.entries(file.variants).map(([name, held]) => [name, { ...held, checks: undefined }])) });
export const FILE_PREFIX = "reader/files/";
export const fileKey = (hash: string): string => `${FILE_PREFIX}${hash}.json`;
