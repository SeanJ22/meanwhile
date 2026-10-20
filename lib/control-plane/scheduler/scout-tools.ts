import {extractLinks,LINK_CAP} from '../../hunt/page-links.ts';
export {extractLinks,LINK_CAP,type DerivedLink} from '../../hunt/page-links.ts';
import { SOURCE_API_TOOLS, SOURCE_API_SPECS, readSourceApi, type SourceApiTool } from "./scout-api.ts";
import { readClientSource, type ClientTool } from './scout-clients.ts';
/** The hunter's research tools. robots.txt is read and recorded, never a refusal;
 * an access control is a wall, saved as diagnostic and never defeated. */

import { accessControlIn } from "../../hunt/access-control.ts";
import { runOcr } from "../../extract/ocr.ts";
import { rowsFromItems, cellsFromRow, tablesFromRows, type ExtractedTable } from "../../extract/tables.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import {
  artifactId,
  recordAcquisition,
  deriveSanitized,
  type Artifact,
  type RetentionPolicy,
} from "../evidence/artifact.ts";
import { contentHash } from "../ids.ts";

import type { WorkArtifact } from "./dispatch.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, WALL_STATUSES } from "./http-executor.ts";
import { websiteRequestLimit, websiteSizeForObligation } from "./host-supervision.ts";
import { evaluatePermission, DEFAULT_ROBOTS_TOKEN, type PermissionReading } from "./robots.ts";
import { DEFAULT_USER_AGENT, realOpen, type OpenOne } from "./route-executor.ts";
import {
  SCOUT_RESEARCH_TOOLS,
  UNTRUSTED_CONTENT_HEADER,
  type ArtifactProvenance,
  type BytesOutcome,
  type HuntStep,
  type OpenBytes,
  type ReportedFinding,
  type ScoutToolCallResult,
  type ScoutToolContext,
  type ScoutToolSpec,
  type ScoutToolkit,
} from "./scout-contract.ts";
import { decodeEntities, visibleText } from "../../extract/visible-text.ts";

/** The ordinary public-page reader for collectors: held bytes, then HTTP, then the existing browser. */
export function savedPageReader(context:ScoutToolContext,options:{maxAgeMs?:number}={}) {
  const fresh=(at:string)=>{
    const age=Date.parse(context.now())-Date.parse(at);
    return Number.isFinite(age) && age>=0 && age<=(options.maxAgeMs??Infinity);
  };
  const parseable=(type:string)=>/^(?:text\/|application\/(?:json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|csv|javascript))(?:[^;]*)(?:;|$)/i.test(type);
  const captured=new Map<string,{artifact:Artifact;text:string}>();
  const requestedArtifacts=new Map<string,string>();
  const toolkit=buildScoutToolkit({...context,vault:async(artifact,text)=>{
    const saved=await context.vault(artifact,text);
    if(saved.stored && artifact.tier!=='RESTRICTED_RAW' && artifact.retentionPolicy!=='DIAGNOSTIC' &&
      ['scout:fetch_public','scout:browse'].includes(artifact.methodRouteId))captured.set(artifact.id,{artifact,text});
    return saved;
  }});
  return async(url:string):Promise<{url:string;text:string;contentType:string|null;collectedAt:string;artifactId:string;artifacts:readonly WorkArtifact[]}>=>{
    for(const saved of captured.values()) {
      if((requestedArtifacts.get(url)===saved.artifact.id || saved.artifact.canonicalUrl===url || saved.artifact.retrievalUrl===url) && saved.artifact.httpStatus===200 &&
        parseable(saved.artifact.contentType) && fresh(saved.artifact.retrievedAt))
        return {url:saved.artifact.retrievalUrl,text:saved.text,contentType:saved.artifact.contentType,collectedAt:saved.artifact.retrievedAt,artifactId:saved.artifact.id,artifacts:[]};
    }
    for(const provenance of context.handed.provenance??[]) {
      if((provenance.canonicalUrl!==url && provenance.retrievalUrl!==url) || provenance.httpStatus!==200 ||
        (url.startsWith('http:') && (provenance.retrievalUrl??provenance.canonicalUrl).startsWith('http:')) ||
        provenance.methodRouteId.endsWith(':network-observation') ||
        !fresh(provenance.retrievedAt) || (provenance.contentType && !parseable(provenance.contentType)) || !context.readHeldArtifact)continue;
      try {
        const held=await context.readHeldArtifact(provenance.artifactId);
        if(held.canonicalUrl===provenance.canonicalUrl && fresh(held.retrievedAt))return {url:provenance.retrievalUrl??held.canonicalUrl,
          text:held.text,contentType:provenance.contentType??null,collectedAt:held.retrievedAt,artifactId:held.artifactId,artifacts:[]};
      } catch { /* The same source remains owed when its prior bytes cannot be read. */ }
    }
    const artifacts:WorkArtifact[]=[];
    const failures:string[]=[];
    for(const tool of context.browse?['fetch_public','browse']:['fetch_public']) {
      const result=await toolkit.call(tool,{url});
      artifacts.push(...result.artifacts);
      if(result.ok) {
        for(const row of [...result.artifacts].reverse()) {
          const saved=captured.get(row.artifactId);
          if(saved && saved.artifact.httpStatus===200 && parseable(saved.artifact.contentType)) {
            requestedArtifacts.set(url,saved.artifact.id);
            return {url:saved.artifact.retrievalUrl,text:saved.text,contentType:saved.artifact.contentType,
              collectedAt:saved.artifact.retrievedAt,artifactId:saved.artifact.id,artifacts};
          }
        }
      }
      failures.push(result.step?.observed??result.forModel);
    }
    throw new Error('SOURCE_PAGE_UNREADABLE: '+failures.join('; '));
  };
}

/** Page text the model is shown: compact by default, the passages that match `look_for` when given. */
export const TEXT_CAP_CHARS = 5_000;
export const REQUEST_LIST_CAP = 40;
const SOURCE_API_CHARS = 8_000;
const READ_PASSAGE_CHARS = 4_000;

const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/json,text/calendar,application/pdf,*/*";
const ACCEPT_ROBOTS = "text/plain,*/*";

const URL_SCHEMA = { type: "string", description: "An absolute public http(s) URL." };
const LOOK_FOR_SCHEMA = { type: "string", description: "Optional: the words you are looking for on the page (names, \"agenda\", \"phone\"). The passages that contain them are shown instead of the page's start." };

export const SCOUT_TOOL_SPECS: readonly ScoutToolSpec[] = [
  {
    name: "read_held",
    description: "What we already hold for this government, and the pages already saved. With no input: every held value with its source and the saved pages. With query only: the held values that mention it. With artifactId: a passage of that saved page (offset to page through it, or query to find a phrase). No network, no cost.",
    input_schema: { type: "object", properties: {
      artifactId: { type: "string" }, offset: { type: "integer" }, query: { type: "string" },
    } },
  },
  {
    name: "fetch_public",
    description: "Open one public http(s) page and save it. HTML gives its title, text and links; JSON is shown as data; a PDF's text is extracted. robots.txt is read and recorded, never a refusal. A login, 403, 429 or bot challenge is a wall: it is never bypassed, so try another route.",
    input_schema: { type: "object", properties: { url: URL_SCHEMA, look_for: LOOK_FOR_SCHEMA }, required: ["url"] },
  },
  {
    name: "browse",
    description: "Open one public page in a real browser when a page needs scripts to show its content. Saves the rendered page and the page's own network requests (the real API behind it). Same rules as fetch_public.",
    input_schema: { type: "object", properties: { url: URL_SCHEMA, look_for: LOOK_FOR_SCHEMA }, required: ["url"] },
  },
  {
    name: "legistar_events",
    description: "Read a Legistar tenant's meeting calendar for a date window of up to 97 days.",
    input_schema: { type: "object", properties: { tenant: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["tenant", "from", "to"] },
  },
];

export const SEARCH_TOOL_SPEC: ScoutToolSpec = {
  name: "search",
  description:
    "Search the web. Results come back with the text of each page that answers the query, so read them here; you rarely need to open a result. " +
    "Set fresh for things that change (meeting dates, agendas, current officeholders, filings). Set deep only when ordinary searches have not found it. " +
    "When a result states a blank's value, report it with report_finding, citing that result's URL.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "A specific phrase: a person, office, body and place." },
      fresh: { type: "boolean" },
      deep: { type: "boolean" },
      includeDomains: { type: "array", items: { type: "string" }, description: "Optional: only these domains, e.g. [\"santacruzcountyaz.gov\"]." },
    },
    required: ["query"],
  },
};

export const REPORT_FINDING_TOOL_SPEC: ScoutToolSpec = {
  name: "report_finding",
  description:
    "Put one fact into the Box the moment a page states it: the subject id in [brackets] from your brief, the field (the blank's checklist id), " +
    "the value as the page states it, the page's URL and the exact sentence on that page that states it. The page is saved for checking; you do not need to open it first. " +
    "Report each fact as you find it; never save them for the end.",
  input_schema: {
    type: "object",
    properties: {
      subjectId: { type: "string" },
      field: { type: "string" },
      value: { type: ["string", "number", "boolean"] },
      sourceUrl: { type: "string" },
      sentence: { type: "string", description: "Copied exactly from the page." },
    },
    required: ["subjectId", "field", "value", "sourceUrl", "sentence"],
  },
};

/** One byte-identical tool list across jobs, so it caches as a prefix. */
const HUNTER_TOOL_SPECS: readonly ScoutToolSpec[] = [...SCOUT_TOOL_SPECS, ...SOURCE_API_SPECS, SEARCH_TOOL_SPEC, REPORT_FINDING_TOOL_SPEC];

/** The runtime's bytes opener. One request; text is decoded by the toolkit. */
export const realOpenBytes: OpenBytes = async ({ url, headers, timeoutMs }) => {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal, redirect: "follow", headers });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      bytes,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      finalUrl: response.url || null,
      durationMs: Date.now() - started,
      transportError: null,
    };
  } catch (error) {
    return {
      status: null,
      bytes: new Uint8Array(0),
      contentType: "",
      finalUrl: null,
      durationMs: Date.now() - started,
      transportError: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

interface Retrieved extends BytesOutcome {
  readonly byteLength: number;
}

function transportOf(status: number | null, transportError: string | null): TransportState {
  if (transportError !== null) return /abort|timeout|timed out/i.test(transportError) ? "TIMEOUT" : "OTHER_NAMED_FAILURE";
  if (status === null) return "OTHER_NAMED_FAILURE";
  if (status >= 200 && status < 300) return "REACHABLE";
  if (WALL_STATUSES.includes(status)) return "CHALLENGED";
  return "FAILED_AT_RUNG";
}

/** Sniffed from the bytes first, the header second. A PDF served as text/html is a PDF. */
function isBinary(contentType: string, bytes: Uint8Array): boolean {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return true;
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("application/pdf") ||
    ct.startsWith("image/") ||
    ct.startsWith("audio/") ||
    ct.startsWith("video/") ||
    ct.startsWith("application/octet-stream") ||
    ct.startsWith("application/zip") ||
    ct.startsWith("application/x-") ||
    ct.startsWith("application/vnd.") ||
    ct.startsWith("application/msword")
  );
}

function isPdf(contentType: string, bytes: Uint8Array): boolean {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return true;
  return contentType.toLowerCase().startsWith("application/pdf");
}

function decodeText(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([A-Za-z0-9_-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}


export function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return title === "" ? null : title;
}

function capText(text: string, cap: number = TEXT_CAP_CHARS): { readonly text: string; readonly note: string } {
  if (text.length <= cap) return { text, note: `${text.length} chars` };
  return { text: text.slice(0, cap), note: `${cap} of ${text.length} chars shown; the vaulted artifact holds the rest` };
}

type PdfExtraction =
  | { readonly kind: "TEXT"; readonly text: string; readonly pages: number; readonly tables: readonly ExtractedTable[]; readonly complete: boolean; readonly extractionNote: string }
  | { readonly kind: "EXTRACTION_UNAVAILABLE"; readonly why: string }
  | { readonly kind: "EXTRACTION_FAILED"; readonly why: string };

export async function extractPdf(bytes: Uint8Array, ocr: typeof runOcr = runOcr): Promise<PdfExtraction> {
  let getDocument: (typeof import("pdfjs-dist/legacy/build/pdf.mjs"))["getDocument"];
  try {
    ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch (error) {
    return { kind: "EXTRACTION_UNAVAILABLE", why: error instanceof Error ? error.message : String(error) };
  }
  try {
    /* A COPY: pdfjs takes ownership of the buffer it is handed and detaches it. */
    const doc = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false }).promise;
    try {
      const pages: string[] = [];
      const tables: ExtractedTable[] = [];
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
        tables.push(...tablesFromRows(rowsFromItems(content.items.flatMap(item => "str" in item && item.str.trim()
          ? [{ x: item.transform[4], y: item.transform[5], width: item.width, text: item.str }] : [])).map(cellsFromRow), i));
      }
      const empty = pages.flatMap((text, index) => text.trim().length < 2 ? [index] : []);
      let extractionNote = "Text layer extracted; ordinary source and claim verification still required.";
      if (empty.length) {
        const scanned = await ocr(new Uint8Array(bytes), "vaulted PDF");
        if (scanned.outcome === "EXTRACTED" && scanned.counts.pages === doc.numPages) {
          const byPage = new Map(scanned.items.map(page => [page.page, page.text]));
          for (const index of empty) pages[index] = byPage.get(index + 1) ?? "";
          const unresolved = empty.filter(index => !pages[index].trim());
          extractionNote = `OCR used on ${empty.length} page(s) without a text layer. ${unresolved.length ? `No text recognized on page(s) ${unresolved.map(index => index + 1).join(", ")}; this does not prove blank source pages. ` : ""}OCR is an unverified transcription; normal independent verification remains required.`;
        } else {
          const why = scanned.outcome === "EXTRACTED" ? "OCR page count disagrees with the PDF" : scanned.reason;
          if (empty.length === pages.length) return { kind: "EXTRACTION_FAILED", why: `Scanned PDF OCR incomplete: ${why}` };
          extractionNote = `PARTIAL EXTRACTION: page(s) ${empty.map(index => index + 1).join(", ")} remain unread. ${why}. Retained text from other pages is not complete-document evidence.`;
        }
      }
      return { kind: "TEXT", text: pages.map((text, index) => `[Page ${index + 1}]\n${text}`).join("\n").replace(/[ \t]+/g, " ").trim(),
        pages: doc.numPages, tables, complete: pages.every(text => text.trim().length >= 2), extractionNote };
    } finally {
      await doc.cleanup();
    }
  } catch (error) {
    return { kind: "EXTRACTION_FAILED", why: error instanceof Error ? error.message : String(error) };
  }
}



interface CallAccount {
  readonly artifacts: WorkArtifact[];
  /** The machine's record of each artifact this call vaulted. */
  readonly provenance: ArtifactProvenance[];
  requests: number;
  bytes: number;
}

/** The robots DOCUMENT, cached per host; the verdict is re-evaluated per URL. */
interface HostRobots {
  readonly robotsUrl: string;
  readonly status: number | null;
  readonly transportError: string | null;
  readonly contentType: string;
  readonly text: string | null;
  readonly artifactIds: readonly string[];
}

interface ParsedInput {
  readonly url: string | null;
  readonly lookFor: string | null;
}

interface SavedPage {
  readonly artifactId: string;
  readonly contentHash: string;
  readonly text: string;
  readonly canonicalUrl: string;
  readonly retrievalUrl: string;
  readonly retrievedAt: string;
  readonly methodRouteId: string;
}

function parseInput(input: unknown): ParsedInput {
  const o = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const lookFor = typeof o.look_for === "string" && o.look_for.trim() ? o.look_for.trim().slice(0, 200) : null;
  return { url: typeof o.url === "string" && o.url.trim() ? o.url.trim() : null, lookFor };
}

/** The passages of `text` that contain any of the words looked for, each with a line of context; the start otherwise. */
function focusedText(text: string, lookFor: string | null, cap: number = TEXT_CAP_CHARS): { readonly text: string; readonly note: string } {
  const words = (lookFor ?? "").toLowerCase().split(/[^\p{L}\p{N}@.]+/u).filter(word => word.length >= 3);
  if (words.length === 0 || text.length <= cap) return capText(text, cap);
  const lines = text.split("\n");
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    const lower = line.toLowerCase();
    if (words.some(word => lower.includes(word))) for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 1); j++) keep.add(j);
  });
  if (keep.size === 0) {
    const start = capText(text, cap);
    return { text: start.text, note: `none of "${lookFor}" appears; ${start.note}` };
  }
  const out: string[] = [];
  let size = 0, last = -2;
  for (const i of [...keep].sort((x, y) => x - y)) {
    const line = (i === last + 1 ? "" : "…\n") + lines[i]!;
    if (size + line.length > cap) break;
    out.push(line);
    size += line.length + 1;
    last = i;
  }
  return { text: out.join("\n"), note: `passages matching "${lookFor}" from ${text.length} chars; read_held with this page's artifact id shows the rest` };
}

function workArtifact(artifact: Artifact, recordedAt: string): WorkArtifact {
  const record={
    httpStatus:artifact.httpStatus,retrievalUrl:artifact.retrievalUrl,permission:artifact.permission,transport:artifact.transport,
    artifactId: artifact.id,
    tier: artifact.tier,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl,
    partial: artifact.extraction?.complete === false,
    recordedAt,
  };
  return record;
}

/** The envelope carries `retrieved <stamp>` and the permission verdict; the machine still derives provenance from the artifact. */
function envelope(artifact: Artifact, url: string, finalUrl: string, status: number | null, byteLength: number): string {
  return (
    `ARTIFACT ${artifact.id} | url ${url}` +
    (finalUrl !== url ? ` | final ${finalUrl}` : "") +
    ` | HTTP ${status ?? "none"} | ${artifact.contentType} | ${byteLength} bytes | ${artifact.contentHash}` +
    ` | retrieved ${artifact.retrievedAt} | permission ${artifact.permission}`
  );
}

const DATA_BEGIN = "--- BEGIN PUBLIC SOURCE DATA ---";
const DATA_END = "--- END PUBLIC SOURCE DATA ---";

function permissionState(verdict: PermissionReading["verdict"]): PermissionState {
  switch (verdict) {
    case "ALLOWED":
      return "ALLOWED";
    case "DISALLOWED":
      return "DISALLOWED";
    /* No document governs the host: the robots-based reading does not apply. Never ALLOWED — an absence is not a grant. */
    case "NO_ROBOTS":
      return "NOT_APPLICABLE";
    default:
      return "CANNOT_TELL";
  }
}

export function buildScoutToolkit(ctx: ScoutToolContext): ScoutToolkit {
  const websiteSize = ctx.websiteSize ?? websiteSizeForObligation(ctx.obligation.obligation, ctx.root);
  const openOne: OpenOne = ctx.openOne ?? realOpen;
  /* An injected string opener never falls through to the real network. */
  const openBytes: OpenBytes | null =
    ctx.openBytes ?? (ctx.openOne === undefined || ctx.openOne === realOpen ? realOpenBytes : null);
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const token = DEFAULT_ROBOTS_TOKEN;

  const robotsByHost = new Map<string, HostRobots>();
  const hostCounts = new Map<string, number>();
  const vaulted = new Set<string>();
  /** Pages this job saved, by artifact id: what read_held and report_finding reuse without fetching again. */
  const savedPages = new Map<string, SavedPage>();
  const savedByUrl = new Map<string,SavedPage>();
  const rememberPage=(page:SavedPage)=>{savedPages.set(page.artifactId,page);savedByUrl.set(page.canonicalUrl,page);savedByUrl.set(page.retrievalUrl,page);};
  let requestCount = 0;
  let bytesFetched = 0;
  let toolCalls = 0;

  const hostOf = (url: URL): string => url.host.toLowerCase();

  function acquiredUrl(requested: URL, finalUrl: string): string {
    const final = publicUrl(finalUrl);
    return requested.protocol === "http:" && final instanceof URL && final.protocol === "https:"
      ? final.toString() : requested.toString();
  }

  async function preferHttps<T extends { readonly status: number | null; readonly transportError: string | null }>(
    url: URL, open: (target: URL) => Promise<T>,
  ): Promise<T> {
    if (url.protocol !== "http:") return open(url);
    const secure = new URL(url);
    secure.protocol = "https:";
    let first: T;
    try {
      first = await open(secure);
    } catch (error) {
      if (overCap(url) !== null) throw error;
      return open(url);
    }
    if (first.transportError === null && first.status !== null && first.status >= 200 && first.status < 300) return first;
    return overCap(url) === null ? open(url) : first;
  }

  function overCap(url: URL): string | null {
    const host = hostOf(url);
    const n = hostCounts.get(host) ?? 0;
    const max = websiteRequestLimit(websiteSize(url.toString()));
    if (max === null || n < max) return null;
    return (
      `${host} has had ${n} of ${max} requests this Attempt (the per-host bound), so this request is ` +
      "refused. The bound is per host: another host is not bound by this count."
    );
  }

  async function retrieve(url: URL, accept: string, acc: CallAccount): Promise<Retrieved> {
    const host = hostOf(url);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    if (websiteRequestLimit(websiteSize(url.toString())) !== null) await ctx.spaceOut(host);
    const headers = { "user-agent": DEFAULT_USER_AGENT, accept };
    let got: Retrieved;
    if (openBytes !== null) {
      const b = await openBytes({ url: url.toString(), headers, timeoutMs });
      got = { ...b, finalUrl: b.finalUrl ?? url.toString(), byteLength: b.bytes.byteLength };
    } else {
      const s = await openOne({ url: url.toString(), method: "GET", headers, timeoutMs });
      got = {
        status: s.status,
        bytes: Buffer.from(s.body, "utf8"),
        contentType: s.contentType,
        finalUrl: url.toString(),
        durationMs: s.durationMs,
        transportError: s.transportError,
        byteLength: s.bytes,
      };
    }
    requestCount += 1;
    bytesFetched += got.byteLength;
    acc.requests += 1;
    acc.bytes += got.byteLength;
    return got;
  }

  interface VaultReport {
    readonly artifact: Artifact;
    readonly stored: boolean;
    readonly why: string;
    readonly text?: string;
  }

  async function vaultText(
    input: {
      readonly url: URL;
      readonly finalUrl: string;
      readonly status: number;
      readonly contentType: string;
      readonly text: string;
      readonly methodRouteId: string;
      readonly permission: PermissionState;
      readonly transport: TransportState;
      readonly retention?: RetentionPolicy;
    },
    acc: CallAccount,
  ): Promise<VaultReport> {
    const at = ctx.now();
    const { artifact } = recordAcquisition(
      {
        canonicalUrl: acquiredUrl(input.url, input.finalUrl),
        retrievalUrl: input.finalUrl,
        retrievedAt: at,
        httpStatus: input.status,
        contentType: input.contentType,
        sourceId: new URL(acquiredUrl(input.url, input.finalUrl)).host.toLowerCase(),
        methodRouteId: input.methodRouteId,
        workItemId: ctx.workItemId,
        attemptId: ctx.attemptId,
        permission: input.permission,
        transport: input.transport,
        ...(input.retention ? { retentionPolicy: input.retention } : {}),
      },
      input.text,
    );
    let saved=await put(artifact, () => ctx.vault(artifact, input.text), at, acc);
    let text=input.text;
    if(artifact.tier==='RESTRICTED_RAW' && artifact.retentionPolicy!=='DIAGNOSTIC') {
      // Same acquisition path as the meetings collector: retain the raw hash
      // and redaction derivation even when no restricted substrate is present.
      const derived=deriveSanitized(artifact,input.text,at);
      const rawNote=saved.stored?'Restricted original vaulted.':`Restricted original not retained: ${saved.why}.`;
      saved=await put(derived.artifact,()=>ctx.vault(derived.artifact,derived.text),at,acc);
      saved={...saved,why:`${rawNote} Sanitized derivative: ${saved.why}`};
      text=derived.text;
    }
    const held=saved.artifact;
    if(saved.stored && held.tier!=='RESTRICTED_RAW' && held.retentionPolicy!=='DIAGNOSTIC' &&
      held.methodRouteId!=='scout:read_permission' && !held.methodRouteId.endsWith(':network-observation')) {
      rememberPage({artifactId:held.id,contentHash:held.contentHash,text,canonicalUrl:held.canonicalUrl,
        retrievalUrl:held.retrievalUrl,retrievedAt:held.retrievedAt,methodRouteId:held.methodRouteId});
    }
    return {...saved,text:saved.stored && held.tier!=='RESTRICTED_RAW'?text:''};
  }

  async function vaultBinary(
    input: {
      readonly url: URL;
      readonly finalUrl: string;
      readonly status: number;
      readonly contentType: string;
      readonly bytes: Uint8Array;
      readonly permission: PermissionState;
    },
    acc: CallAccount,
  ): Promise<VaultReport> {
    const at = ctx.now();
    const hash = contentHash(input.bytes);
    const artifact: Artifact = {
      id: artifactId("RAW", hash),
      tier: "RAW",
      contentHash: hash,
      byteLength: input.bytes.byteLength,
      contentType: input.contentType,
      canonicalUrl: acquiredUrl(input.url, input.finalUrl),
      retrievalUrl: input.finalUrl,
      retrievedAt: at,
      httpStatus: input.status,
      headers: {},
      sourceId: new URL(acquiredUrl(input.url, input.finalUrl)).host.toLowerCase(),
      methodRouteId: "scout:fetch_public",
      workItemId: ctx.workItemId,
      attemptId: ctx.attemptId,
      permission: input.permission,
      transport: "REACHABLE",
      retentionPolicy: "EVIDENCE_PERMANENT",
    };
    const vaultBytes = ctx.vaultBytes;
    if (!vaultBytes) {
      return { artifact, stored: false, why: "binary bodies cannot be vaulted in this runtime (no vaultBytes was supplied)" };
    }
    return await put(artifact, () => vaultBytes(artifact, input.bytes), at, acc);
  }

  async function put(
    artifact: Artifact,
    write: () => Promise<{ readonly stored: boolean; readonly where: string; readonly why: string }>,
    at: string,
    acc: CallAccount,
  ): Promise<VaultReport> {
    try {
      const report = await write();
      if (!report.stored) return { artifact, stored: false, why: `the vault did not persist these bytes: ${report.why}` };
    } catch (error) {
      return { artifact, stored: false, why: `the vault REFUSED these bytes: ${error instanceof Error ? error.message : String(error)}` };
    }
    vaulted.add(artifact.id);
    acc.artifacts.push(workArtifact(artifact, at));
    acc.provenance.push({
      artifactId: artifact.id,
      canonicalUrl: artifact.canonicalUrl,
      retrievalUrl: artifact.retrievalUrl,
      contentType: artifact.contentType,
      retrievedAt: artifact.retrievedAt,
      permission: artifact.permission,
      methodRouteId: artifact.methodRouteId,
      httpStatus: artifact.httpStatus,
    });
    return { artifact, stored: true, why: "stored" };
  }


  async function readRobots(url: URL, acc: CallAccount): Promise<HostRobots> {
    const host = hostOf(url);
    const cached = robotsByHost.get(host);
    if (cached) return cached;
    const robotsUrl = new URL(`${url.protocol}//${url.host}/robots.txt`);
    const got = await retrieve(robotsUrl, ACCEPT_ROBOTS, acc);
    const text = got.transportError === null ? decodeText(got.bytes, got.contentType) : null;
    const artifactIds: string[] = [];
    if (got.transportError === null && got.status !== null && text !== null && text.length > 0) {
      const ok = got.status >= 200 && got.status < 300;
      const report = await vaultText(
        {
          url: robotsUrl,
          finalUrl: got.finalUrl ?? robotsUrl.toString(),
          status: got.status,
          contentType: got.contentType,
          text,
          methodRouteId: "scout:read_permission",
          permission: "ALLOWED",
          transport: transportOf(got.status, null),
          ...(ok ? {} : { retention: "DIAGNOSTIC" as const }),
        },
        acc,
      );
      if (report.stored) artifactIds.push(report.artifact.id);
    }
    const entry: HostRobots = {
      robotsUrl: robotsUrl.toString(),
      status: got.status,
      transportError: got.transportError,
      contentType: got.contentType,
      text,
      artifactIds,
    };
    robotsByHost.set(host, entry);
    return entry;
  }

  function evaluate(robots: HostRobots, url: URL): PermissionReading {
    return evaluatePermission(
      { robotsText: robots.text, status: robots.status, transportError: robots.transportError, contentType: robots.contentType },
      url.toString(),
      token,
    );
  }

  function refusal(text: string, extra: Partial<ScoutToolCallResult> = {}): ScoutToolCallResult {
    return { ok: false, forModel: `REFUSED: ${text}`, artifacts: [], provenance: [], step: null, requestCount: 0, bytesFetched: 0, ...extra };
  }

  /** The step carries the machine's `ok` and, when the call ran under a verdict, its permission. */
  function result(
    ok: boolean,
    forModel: string,
    step: HuntStep | null,
    acc: CallAccount,
    permission?: PermissionState,
  ): ScoutToolCallResult {
    const stamped: HuntStep | null = step === null ? null : { ...step, ok, ...(permission !== undefined ? { permission } : {}) };
    return { ok, forModel, artifacts: acc.artifacts, provenance: acc.provenance, step: stamped, requestCount: acc.requests, bytesFetched: acc.bytes };
  }

  function publicUrl(raw: string): URL | string {
    try {
      return assertPublicUrl(raw);
    } catch (error) {
      return `${raw} is not a public http(s) URL: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /** The shared front half of fetch_public and browse. A string is a refusal. */
  async function admit(
    input: ParsedInput,
    _tool: "fetch_public" | "browse",
  ): Promise<
    | { readonly kind: "GO"; readonly url: URL; readonly acc: CallAccount; readonly reading: PermissionReading; readonly robots: HostRobots }
    | { readonly kind: "REFUSED"; readonly result: ScoutToolCallResult }
  > {
    const url = publicUrl(input.url ?? "");
    if (typeof url === "string") return { kind: "REFUSED", result: refusal(url) };
    const acc: CallAccount = { artifacts: [], provenance: [], requests: 0, bytes: 0 };
    const capBefore = overCap(url);
    if (capBefore !== null) return { kind: "REFUSED", result: refusal(capBefore) };
    /* Read and recorded, never a refusal: ROBOTS_BLOCKS_ACQUISITION is false. */
    const robots = await readRobots(url, acc);
    const reading = evaluate(robots, url);
    const capAfter = overCap(url);
    if (capAfter !== null) {
      return {
        kind: "REFUSED",
        result: { ...result(false, `REFUSED: the permission read consumed the last slot — ${capAfter}`, null, acc) },
      };
    }
    return { kind: "GO", url, acc, reading, robots };
  }

  /** Machine-written: the verdict this call acted under, and the robots artifact it can cite. */
  function permissionLine(url: URL, reading: PermissionReading, robots: HostRobots): string {
    return (
      `PERMISSION ${reading.verdict} for ${url.host}` +
      (robots.artifactIds.length > 0 ? ` | robots.txt artifact ${robots.artifactIds.join(", ")}` : " | no robots document vaulted")
    );
  }

  async function fetchPublic(input: ParsedInput): Promise<ScoutToolCallResult> {
    const admitted = await admit(input, "fetch_public");
    if (admitted.kind === "REFUSED") return admitted.result;
    const { url, acc, reading, robots } = admitted;
    const permission = permissionState(reading.verdict);
    const permLine = permissionLine(url, reading, robots);
    let nextHopUrls: string[] = [];
    let returnedCount: number | null = null;
    /* A challenge served at 2xx is CHALLENGED on the step as on the artifact, never REACHABLE. */
    let challenged = false;
    const step = (observed: string): HuntStep => ({
      tool: "fetch_public",
      target: url.toString(),
      observed,
      artifactIds: acc.artifacts.map((a) => a.artifactId),
      transport: challenged ? "CHALLENGED" : transportOf(got.status, got.transportError), httpStatus: got.status,
      nextHopUrls, returnedCount, 
    });

    const got = await preferHttps(url, target => retrieve(target, ACCEPT_PAGE, acc));
    if (got.transportError !== null) {
      return result(
        false,
        `nothing was reached at ${url.host}: ${got.transportError}. A transport failure is a fact about this client and this moment, never about the record.\n${permLine}`,
        step(`transport failure: ${got.transportError}`), acc, permission
      );
    }
    const status = got.status ?? 0;
    const finalUrl = got.finalUrl ?? url.toString();

    if (status >= 200 && status < 300) {
      if (got.byteLength === 0) {
        return result(
          false,
          `${url} answered HTTP ${status} and ZERO BYTES. A zero-byte read is a FAILED read, never an empty document; the record is still owed.\n${permLine}`,
          step(`HTTP ${status} (0 bytes)`), acc, permission
        );
      }
      if (isBinary(got.contentType, got.bytes)) {
        return await binaryRepresentation({ url, finalUrl, status, got, permission, permLine, acc, step, lookFor: input.lookFor });
      }
      const text = decodeText(got.bytes, got.contentType);
      /* A challenge served at 2xx is an access control: vaulted as DIAGNOSTIC, never shown as the page, never solved. */
      const control = accessControlIn({ status, text });
      if (control !== null) {
        challenged = true;
        const walled = await vaultText(
          {
            url, finalUrl, status, contentType: got.contentType, text, methodRouteId: "scout:fetch_public",
            permission, transport: "CHALLENGED", retention: "DIAGNOSTIC",
          },
          acc,
        );
        const where = walled.stored ? `the answer page is vaulted as ${walled.artifact.id} (DIAGNOSTIC); its body is not shown` : `the answer page was not vaulted: ${walled.why}`;
        return result(
          false,
          `${control.detail} at ${url.host}: a WALL, named. It is never bypassed and is not a fact about the record. ${where}. Walk another public branch: the API behind the page, an official mirror, a feed, an archive.\n${permLine}`,
          step(`HTTP ${status} (${control.kind})`), acc, permission
        );
      }
      const report = await vaultText(
        { url, finalUrl, status, contentType: got.contentType, text, methodRouteId: "scout:fetch_public", permission, transport: "REACHABLE" },
        acc,
      );
      const head = `${envelope(report.artifact, url.toString(), finalUrl, status, got.byteLength)}\n${permLine}${report.artifact.tier==='SANITIZED_DERIVED'?`\n${report.why}`:''}`;
      if (!report.stored) {
        return result(
          false,
          `${head}\nVAULT REFUSED: ${report.why}. Nothing of the body is shown: a body the vault does not hold cannot be cited, and a finding grounded in it would be grounded in memory. Try another representation of the record.`,
          step(`HTTP ${status}, ${got.byteLength} bytes, NOT VAULTED`), acc, permission
        );
      }
      if (report.artifact.tier === "RESTRICTED_RAW") {
        return result(
          true,
          `${head}\nQUARANTINED: the body carries a confirmed third-party credential and is stored RESTRICTED_RAW. Nothing of it is shown to you. Cite the artifact id; a sanitized derivative is the acquirer's to make.`,
          step(`HTTP ${status}, ${got.byteLength} bytes, RESTRICTED_RAW`), acc, permission
        );
      }
      const readable=report.text??'';
      if (/html/i.test(got.contentType)) nextHopUrls = extractLinks(readable, url).map(link => link.url);
      if (/json/i.test(got.contentType)) {
        try { const rows: unknown = JSON.parse(readable); if (Array.isArray(rows)) returnedCount = rows.length; } catch { /* Saved bytes remain evidence; parsing is another worker's burden. */ }
      }
      return result(true, textRepresentation(head, readable, got.contentType, url, input.lookFor), step(`HTTP ${status}, ${got.byteLength} bytes, ${got.contentType}${report.artifact.tier==='SANITIZED_DERIVED'?'; '+report.why:''}`), acc, permission);
    }

    /* Non-2xx: the answer is DIAGNOSTIC evidence that the step was walked; the body is never shown. */
    const wall = WALL_STATUSES.includes(status);
    const text = decodeText(got.bytes, got.contentType);
    let diagnostic = "nothing vaulted (empty body)";
    if (got.byteLength > 0) {
      const report = await vaultText(
        {
          url, finalUrl, status, contentType: got.contentType, text, methodRouteId: "scout:fetch_public",
          permission, transport: transportOf(status, null), retention: "DIAGNOSTIC",
        },
        acc,
      );
      diagnostic = report.stored
        ? `the answer page is vaulted as ${report.artifact.id} (DIAGNOSTIC); its body is not shown`
        : `the answer page was not vaulted: ${report.why}`;
    }
    if (wall) {
      return result(
        false,
        `HTTP ${status} from ${url.host} to this client: a WALL, named — an access control, never bypassed. It is not a fact about whether the record exists. ${diagnostic}. Walk another public branch: another representation of the same record, the API behind the page, an official mirror, an archive.\n${permLine}`,
        step(`HTTP ${status} (wall)`), acc, permission
      );
    }
    if (status >= 400 && status < 500) {
      return result(
        false,
        `HTTP ${status} at ${url}: a fact about this URL, not about the record; another representation of it is owed. ${diagnostic}.\n${permLine}`,
        step(`HTTP ${status}`), acc, permission
      );
    }
    return result(
      false,
      `${url.host} answered HTTP ${status}: their side broke. ${diagnostic}. This may be retried later; it is not evidence about the record.\n${permLine}`,
      step(`HTTP ${status}`), acc, permission
    );
  }

  function textRepresentation(head: string, text: string, contentType: string, url: URL, lookFor: string | null): string {
    const ct = contentType.toLowerCase();
    const parts: string[] = [UNTRUSTED_CONTENT_HEADER, head, DATA_BEGIN];
    const htmlShaped = ct.includes("html") || /^\s*<(!doctype|html)/i.test(text);
    if (htmlShaped) {
      const body = focusedText(visibleText(text), lookFor);
      parts.push(`TITLE: ${htmlTitle(text) ?? "(none)"}`, `TEXT (${body.note}):`, body.text);
      const links = extractLinks(text, url);
      parts.push(`LINKS (${links.length}, same-host first):`, ...links.map((l) => `- ${l.url}${l.text ? ` — ${l.text}` : ""}`));
    } else if (ct.includes("json") || /^\s*[[{]/.test(text)) {
      let pretty: string;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 1);
      } catch {
        pretty = text;
      }
      const body = focusedText(pretty, lookFor);
      parts.push(`JSON (${body.note}):`, body.text);
    } else {
      const body = focusedText(text, lookFor);
      parts.push(`TEXT (${body.note}):`, body.text);
    }
    parts.push(DATA_END);
    return parts.join("\n");
  }

  async function binaryRepresentation(input: {
    readonly url: URL;
    readonly finalUrl: string;
    readonly status: number;
    readonly got: Retrieved;
    readonly permission: PermissionState;
    readonly permLine: string;
    readonly acc: CallAccount;
    readonly step: (observed: string) => HuntStep;
    readonly lookFor: string | null;
  }): Promise<ScoutToolCallResult> {
    const { url, finalUrl, status, got, acc } = input;
    const report = await vaultBinary({ url, finalUrl, status, contentType: got.contentType, bytes: got.bytes, permission: input.permission }, acc);
    const head = `${envelope(report.artifact, url.toString(), finalUrl, status, got.byteLength)}\n${input.permLine}`;
    if (!report.stored) {
      return result(false, `${head}\nNOT VAULTED: ${report.why}. Nothing of the body is shown.`, input.step(`HTTP ${status}, ${got.byteLength} bytes binary, NOT VAULTED`), acc, input.permission);
    }
    if (!isPdf(got.contentType, got.bytes)) {
      return result(true, `${head}\nBINARY body vaulted (${got.contentType}); no text representation is derived for this type.`, input.step(`HTTP ${status}, ${got.byteLength} bytes, ${got.contentType}`), acc, input.permission);
    }
    const extracted = await extractPdf(got.bytes);
    if (extracted.kind !== "TEXT") {
      return result(
        true,
        `${head}\nPDF vaulted; ${extracted.kind}: ${extracted.why}. Only the artifact id and byte length are available; cite the id.`,
        input.step(`HTTP ${status}, ${got.byteLength} bytes PDF, ${extracted.kind}`), acc, input.permission
      );
    }
    // Retain the exact transcription shown to Scout so ordinary workers can
    // replay it by artifact id. Its tier and parent explicitly distinguish it
    // from the publisher's original PDF; verification remains independent.
    const transcriptions: string[] = [];
    for (const kind of ["PDF_TEXT", ...(extracted.tables.length ? ["PDF_TABLES"] : [])] as const) {
      const parent = report.artifact;
      const text = kind === "PDF_TEXT"
        ? `PDF transcription; original ${parent.id} ${parent.contentHash}; complete=${extracted.complete}; pages=${extracted.pages}\n${extracted.text}`
        : JSON.stringify({ originalArtifactId: parent.id, originalHash: parent.contentHash, complete: extracted.complete, tables: extracted.tables });
      const captured = recordAcquisition({ canonicalUrl: parent.canonicalUrl, retrievalUrl: parent.retrievalUrl,
        retrievedAt: parent.retrievedAt, httpStatus: parent.httpStatus, contentType: kind === "PDF_TEXT" ? "text/plain" : "application/json",
        sourceId: parent.sourceId, methodRouteId: "scout:pdf-transcription/1", workItemId: parent.workItemId, attemptId: parent.attemptId,
        permission: parent.permission, transport: parent.transport }, text).artifact;
      if (captured.tier === "RESTRICTED_RAW") return result(false, `${head}\nPDF transcription contains restricted material; no text is shown.`, input.step("PDF transcription restricted"), acc, input.permission);
      const artifact: Artifact = { ...captured, id: artifactId("EXTRACTED_DERIVED", captured.contentHash), tier: "EXTRACTED_DERIVED",
        retentionPolicy: extracted.complete ? "EVIDENCE_PERMANENT" : "DIAGNOSTIC",
        extraction: { kind: kind as "PDF_TEXT" | "PDF_TABLES", version: "pdf-transcription/1", complete: extracted.complete, pages: extracted.pages, parent } };
      const saved = await put(artifact, () => ctx.vault(artifact, text), ctx.now(), acc);
      if (!saved.stored) return result(false, `${head}\nPDF transcription NOT VAULTED: ${saved.why}`, input.step("PDF transcription storage failed"), acc, input.permission);
      const shown = focusedText(text, input.lookFor);
      transcriptions.push(`${kind} artifact ${artifact.id}; ${shown.note}\n${shown.text}`);
    }
    return result(
      true,
      [UNTRUSTED_CONTENT_HEADER, head, extracted.extractionNote, DATA_BEGIN, ...transcriptions, DATA_END].join("\n"),
      input.step(`HTTP ${status}, ${got.byteLength} bytes PDF, ${extracted.pages} page(s)`), acc, input.permission
    );
  }

  async function browse(input: ParsedInput): Promise<ScoutToolCallResult> {
    const browseFn = ctx.browse;
    if (!browseFn) return refusal("BROWSER_UNAVAILABLE in this runtime; use fetch_public.");
    const admitted = await admit(input, "browse");
    if (admitted.kind === "REFUSED") return admitted.result;
    const { url, acc, reading, robots } = admitted;
    const host = hostOf(url);
    const permission = permissionState(reading.verdict);
    const permLine = permissionLine(url, reading, robots);
    let browserTransport: TransportState | "NOT_ATTEMPTED" = "NOT_ATTEMPTED";
    let browserHttpStatus: number | null = null;
    let browserNextHopUrls: string[] = [];
    const step = (observed: string): HuntStep => ({
      tool: "browse",
      target: url.toString(),
      observed,
      artifactIds: acc.artifacts.map((a) => a.artifactId),
      transport: browserTransport, httpStatus: browserHttpStatus, returnedCount: null,
      nextHopUrls: browserNextHopUrls, 
    });

    let obs: Awaited<ReturnType<typeof browseFn>>;
    try {
      obs = await preferHttps(url, async target => {
        /* Each navigation counts; the page's own calls are observed, not initiated. */
        hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
        if (websiteRequestLimit(websiteSize(target.toString())) !== null) await ctx.spaceOut(host);
        requestCount += 1;
        acc.requests += 1;
        const observed = await browseFn({ url: target.toString(), timeoutMs, holder: ctx.holder });
        const bytes = Buffer.byteLength(observed.html, "utf8");
        bytesFetched += bytes;
        acc.bytes += bytes;
        return observed;
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      browserTransport = transportOf(null, why);
      return result(false, `the browser failed on ${url}: ${why}. A browser failure is a fact about this client, not about the record.`, step(`browser failure: ${why}`), acc, permission);
    }
    const htmlBytes = Buffer.byteLength(obs.html, "utf8");
    browserTransport = transportOf(obs.status, obs.transportError);
    browserHttpStatus = obs.status;

    if (obs.html.trim() === "") {
      return result(
        false,
        `the browser rendered nothing at ${url}${obs.transportError ? `: ${obs.transportError}` : ""} (HTTP ${obs.status ?? "none"}). Nothing is vaulted and nothing is shown; a blank render is a failed read, never an empty page.`,
        step(`browser HTTP ${obs.status ?? "none"}, empty render${obs.transportError ? `: ${obs.transportError}` : ""}`), acc, permission
      );
    }

    const status = obs.status ?? 0;
    const finalUrl = obs.finalUrl || url.toString();
    /*
     * An access control is never passed by rendering it: a navigation answered 401/403/429, or a challenge page, is a
     * WALL even when the browser went on to render content behind it. The render is vaulted DIAGNOSTIC and not shown.
     */
    const control = accessControlIn({ status: obs.status, text: obs.html });
    if (control !== null) {
      browserTransport = "CHALLENGED";
      const walled = await vaultText(
        {
          url, finalUrl, status, contentType: "text/html; charset=utf-8", text: obs.html, methodRouteId: "scout:browse",
          permission, transport: "CHALLENGED", retention: "DIAGNOSTIC",
        },
        acc,
      );
      const where = walled.stored ? `the render is vaulted as ${walled.artifact.id} (DIAGNOSTIC); nothing of it is shown` : `the render was not vaulted: ${walled.why}`;
      return result(
        false,
        `${control.detail} at ${url.host}: a WALL, named. The browser does not get past an access control. ${where}. Walk another public branch.\n${permLine}`,
        step(`browser HTTP ${obs.status ?? "none"} (${control.kind})`), acc, permission
      );
    }
    const page = await vaultText(
      {
        url, finalUrl, status, contentType: "text/html; charset=utf-8", text: obs.html, methodRouteId: "scout:browse",
        permission, transport: transportOf(obs.status, obs.transportError),
      },
      acc,
    );
    const observation = JSON.stringify(
      { observedAt: ctx.now(), pageUrl: url.toString(), finalUrl, status: obs.status, transportError: obs.transportError, durationMs: obs.durationMs, requests: obs.requests },
      null,
      2,
    );
    const network = await vaultText(
      {
        url, finalUrl, status, contentType: "application/json", text: observation, methodRouteId: "scout:browse:network-observation",
        permission, transport: transportOf(obs.status, obs.transportError),
      },
      acc,
    );

    const head = `${envelope(page.artifact, url.toString(), finalUrl, obs.status, htmlBytes)}\n${permLine}`;
    const parts: string[] = [];
    if (!page.stored) {
      parts.push(`${head}\nVAULT REFUSED (rendered page): ${page.why}. Nothing of the page is shown.`);
    } else if (page.artifact.tier === "RESTRICTED_RAW") {
      parts.push(`${head}\nQUARANTINED: the rendered page carries a confirmed third-party credential and is stored RESTRICTED_RAW. Nothing of it is shown.`);
    } else {
      const readable=page.text??'';
      browserNextHopUrls = extractLinks(readable, new URL(finalUrl), 200).map(link => link.url);
      const body = focusedText(visibleText(readable), input.lookFor);
      parts.push(UNTRUSTED_CONTENT_HEADER, head, ...(page.artifact.tier==='SANITIZED_DERIVED'?[page.why]:[]), DATA_BEGIN, `TITLE: ${htmlTitle(readable) ?? "(none)"}`, `TEXT (${body.note}):`, body.text, DATA_END);
    }
    if (!network.stored) {
      parts.push(`NETWORK OBSERVATION not vaulted: ${network.why}. The request list is not shown.`);
    } else {
      const requests=(JSON.parse(network.text??'{"requests":[]}') as {requests:typeof obs.requests}).requests;
      const ordered = [...requests]
        .map((r, i) => ({ r, i }))
        .sort((a, b) => rank(a.r, host) - rank(b.r, host) || a.i - b.i)
        .slice(0, REQUEST_LIST_CAP)
        .map(({ r }) => `- ${r.method} ${r.status ?? "-"} ${r.resourceType} ${r.contentType ?? "-"} ${r.url}`);
      parts.push(
        `OBSERVED NETWORK REQUESTS (artifact ${network.artifact.id}; ${ordered.length} of ${obs.requests.length}, same-host and xhr/fetch first):`,
        UNTRUSTED_CONTENT_HEADER,
        DATA_BEGIN,
        ...ordered,
        DATA_END,
      );
    }
    return result(
      page.stored,
      parts.join("\n"),
      step(`browser HTTP ${obs.status ?? "none"}, ${htmlBytes} bytes rendered, ${obs.requests.length} request(s) observed`), acc, permission
    );
  }

  function rank(r: { readonly url: string; readonly resourceType: string }, host: string): number {
    let sameHost = false;
    try {
      sameHost = new URL(r.url).host.toLowerCase() === host;
    } catch {
      sameHost = false;
    }
    const api = /^(xhr|fetch)$/i.test(r.resourceType);
    return (sameHost ? 0 : 2) + (api ? 0 : 1);
  }

  const sameUrl = (a: string, b: string): boolean => a.replace(/#.*$/, "").replace(/\/$/, "") === b.replace(/#.*$/, "").replace(/\/$/, "");

  function passage(page: Pick<SavedPage, "artifactId" | "text" | "canonicalUrl" | "retrievedAt">, offset: number, match: string | null): ScoutToolCallResult {
    if (offset > page.text.length) return refusal(`offset ${offset} is past the end of this page (${page.text.length} characters).`);
    const end = Math.min(page.text.length, offset + READ_PASSAGE_CHARS);
    return { ok: true, step: null, artifacts: [], provenance: [], requestCount: 0, bytesFetched: 0,
      forModel: `SAVED PAGE ${page.artifactId} | ${page.canonicalUrl} | retrieved ${page.retrievedAt}${match ? ` | ${match}` : ""} | characters ${offset}..${end} of ${page.text.length}${end < page.text.length ? `; continue at offset ${end}` : ""}\n${UNTRUSTED_CONTENT_HEADER}\n${DATA_BEGIN}\n${page.text.slice(offset, end)}\n${DATA_END}` };
  }

  async function readHeld(input: unknown): Promise<ScoutToolCallResult> {
    const raw = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const query = typeof raw.query === "string" && raw.query.trim() ? raw.query.trim().slice(0, 160) : null;
    const offset = typeof raw.offset === "number" && Number.isSafeInteger(raw.offset) && raw.offset >= 0 ? raw.offset : 0;
    if (typeof raw.artifactId !== "string") {
      const held = (ctx.held ?? []).filter(fact => query === null ||
        [fact.value, fact.subjectLabel, fact.requirement, fact.checklistId].some(text => text.toLowerCase().includes(query.toLowerCase())));
      const pages = [...new Set([...ctx.handed.artifactIds, ...savedPages.keys()])].map(id =>
        `- ${id}: ${savedPages.get(id)?.canonicalUrl ?? ctx.handed.provenance?.find(p => p.artifactId === id)?.canonicalUrl ?? "saved page"}`);
      return { ok: true, step: null, artifacts: [], provenance: [], requestCount: 0, bytesFetched: 0,
        forModel: [`HELD VALUES (${held.length}${query ? ` mentioning "${query}"` : ""}) — never look for these again:`,
          ...held.map(fact => `- ${fact.subjectLabel} [${fact.subjectId}] ${fact.checklistId}: ${fact.value || "(held)"} <${fact.sourceUrl}> checked ${fact.checkedAt.slice(0, 10)}`),
          `SAVED PAGES (${pages.length}); open one with read_held and its artifactId:`, ...pages].join("\n") };
    }
    let page: SavedPage | undefined = savedPages.get(raw.artifactId);
    if (!page) {
      if (!ctx.handed.artifactIds.includes(raw.artifactId)) return refusal("that page was not saved by this job or handed to it; read_held with no input lists the ones you can open.");
      if (!ctx.readHeldArtifact) return refusal("saved pages cannot be read in this runtime.");
      try {
        const held = await ctx.readHeldArtifact(raw.artifactId);
        if (held.artifactId !== raw.artifactId || contentHash(held.text) !== held.contentHash) return refusal("the saved copy did not match its fingerprint.");
        page = { artifactId: held.artifactId, contentHash: held.contentHash, text: held.text, canonicalUrl: held.canonicalUrl,
          retrievalUrl: held.provenance?.retrievalUrl ?? held.canonicalUrl, retrievedAt: held.retrievedAt, methodRouteId: held.methodRouteId };
        rememberPage(page);
      } catch (error) { return refusal(`the saved page could not be read: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const text = page.text;
    const readable = /^\s*<(!doctype|html)/i.test(text) ? { ...page, text: visibleText(text) } : page;
    if (query === null) return passage(readable, offset, null);
    const at = readable.text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) return refusal(`"${query}" does not appear on saved page ${page.artifactId}.`);
    return passage(readable, Math.max(0, at - 500), `"${query}" found at character ${at}`);
  }

  async function search(raw: unknown): Promise<ScoutToolCallResult> {
    if (ctx.search === undefined) return refusal("search is not available in this runtime (no provider key, or the owner's paid-search switch is off).");
    const o = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const query = typeof o.query === "string" ? o.query.trim() : "";
    if (query === "") return refusal("query is required.");
    const includeDomains = Array.isArray(o.includeDomains) ? o.includeDomains.filter((d): d is string => typeof d === "string") : undefined;
    let res: Awaited<ReturnType<NonNullable<ScoutToolContext["search"]>>>;
    try {
      res = await ctx.search({ query, fresh: o.fresh === true, deep: o.deep === true, ...(includeDomains?.length ? { includeDomains } : {}) });
    } catch (error) {
      return refusal(`search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const bytes = res.charges.reduce((n, charge) => n + charge.bytes, 0);
    requestCount += res.charges.length;
    bytesFetched += bytes;
    for (const charge of res.charges) await ctx.chargeSearch?.(charge);
    const acc: CallAccount = { artifacts: [], provenance: [], requests: res.charges.length, bytes };
    const errors = res.errors.length ? ` [${res.errors.join("; ")}]` : "";
    const forModel = res.provider === null ? `SEARCH "${query}" reached no provider${errors}`
      : res.hits.length === 0 ? `SEARCH "${query}" — nothing found by ${res.provider}.${errors}`
      : [`SEARCH "${query}" — ${res.hits.length} result(s) from ${res.provider}.${errors}`, UNTRUSTED_CONTENT_HEADER, DATA_BEGIN,
        ...res.hits.map((hit, i) => `${i + 1}. ${hit.url} — ${hit.title}\n${hit.text ?? ""}`), DATA_END].join("\n");
    const step: HuntStep = { tool: "search", target: query, observed: `${res.hits.length} result(s) from ${res.provider ?? "no provider"}${errors}`.slice(0, 400),
      artifactIds: [], transport: res.provider ? "REACHABLE" : "OTHER_NAMED_FAILURE", httpStatus: null, returnedCount: res.hits.length };
    return result(res.provider !== null, forModel, step, acc);
  }

    async function sourceApi(name: SourceApiTool | ClientTool, raw: unknown): Promise<ScoutToolCallResult> {
    const acc: CallAccount = { artifacts: [], provenance: [], requests: 0, bytes: 0 };
    try {
      const options = { ...ctx.sourceApi, timeoutMs,
        spaceOut: async host => { const url = new URL(`https://${host}`);
          const exceeded = overCap(url); if (exceeded) throw new Error(exceeded);
          hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
          if (websiteRequestLimit(websiteSize(url.toString())) !== null) await ctx.spaceOut(host);
        } } satisfies import('./scout-api.ts').SourceApiOptions;
      const response = name === 'legistar_events' ? await readClientSource(name,raw as Record<string,unknown>,options) : await readSourceApi(name,raw,options);
      acc.requests = response.requests; acc.bytes = response.bytes;
      requestCount += response.requests; bytesFetched += response.bytes;
      const ok = response.status >= 200 && response.status < 300;
      const saved = await vaultText({url:new URL(response.sourceUrl),finalUrl:response.sourceUrl,status:response.status,
        contentType:'application/json',text:response.text,methodRouteId:'scout:'+name,permission:'NOT_APPLICABLE',
        transport:ok?'REACHABLE':'FAILED_AT_RUNG',...(ok?{}:{retention:'DIAGNOSTIC' as const})},acc);
      const step: HuntStep = {tool:name,target:response.sourceUrl,observed:'HTTP '+response.status,
        artifactIds:acc.artifacts.map(a=>a.artifactId),transport:ok?'REACHABLE':'FAILED_AT_RUNG',httpStatus:response.status,
        returnedCount:null,nextHopUrls:[]};
      if (!saved.stored) return result(false, saved.why, step, acc);
      return result(ok, 'SOURCE '+response.sourceUrl+' | artifact '+saved.artifact.id+' | retrieved '+saved.artifact.retrievedAt+' | permission NOT_APPLICABLE\n'+DATA_BEGIN+'\n'+capText(saved.text??'', SOURCE_API_CHARS).text+'\n'+DATA_END,step,acc);
    } catch(error) { return refusal(name+': '+(error instanceof Error ? error.message : String(error))); }
  }

  /** Facts put into the Box this job, and the page code saved for each cited URL. */
  const reported: ReportedFinding[] = [];
  const reportedKeys = new Map<string, string>();
  const savedForReport = new Map<string, { readonly artifactId: string | null; readonly why: string;readonly canonicalUrl?:string;readonly sourceCheckedAt?:string }>();

  /** The cited page, from this job's saved pages or fetched once by code, with any capture the fetch made. The model never re-fetches it. */
  async function citedPage(sourceUrl: string): Promise<{ readonly artifactId: string | null; readonly why: string;readonly canonicalUrl?:string;readonly sourceCheckedAt?:string; readonly fetched: ScoutToolCallResult | null }> {
    for (const page of new Set(savedByUrl.values())) {
      if (sameUrl(page.canonicalUrl, sourceUrl) || sameUrl(page.retrievalUrl, sourceUrl)) return { artifactId: page.artifactId, why: "saved",canonicalUrl:page.canonicalUrl,sourceCheckedAt:page.retrievedAt, fetched: null };
    }
    const prior = savedForReport.get(sourceUrl);
    if (prior) return { ...prior, fetched: null };
    const fetched = await fetchPublic({ url: sourceUrl, lookFor: null });
    const page = fetched.ok ? fetched.artifacts.find(artifact => savedPages.has(artifact.artifactId)) : undefined;
    const heldPage=page?savedPages.get(page.artifactId):undefined;
    const saved = page ? { artifactId: page.artifactId, why: "saved",canonicalUrl:heldPage?.canonicalUrl,sourceCheckedAt:heldPage?.retrievedAt } : { artifactId: null, why: fetched.step?.observed ?? fetched.forModel.slice(0, 200) };
    savedForReport.set(sourceUrl, saved);
    return { ...saved, fetched };
  }

  async function reportFinding(raw: unknown): Promise<ScoutToolCallResult> {
    const report = ctx.reportFinding;
    if (!report) return refusal("report_finding is not available in this job.");
    const o = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const text = (key: string, max: number) => typeof o[key] === "string" && o[key].trim() !== "" && o[key].length <= max ? o[key].trim() : null;
    const subjectId = text("subjectId", 300), field = text("field", 80), sourceUrl = text("sourceUrl", 2000);
    const sentence = typeof o.sentence === "string" && o.sentence.trim() !== "" && o.sentence.length <= 2000 ? o.sentence : null;
    const value = typeof o.value === "number" && Number.isFinite(o.value) || typeof o.value === "boolean" ? o.value
      : typeof o.value === "string" && o.value.trim() !== "" && o.value.length <= 1000 ? o.value.trim() : null;
    if (!subjectId || !field || value === null || !sentence || !sourceUrl) return refusal("report_finding needs subjectId, field, value, sourceUrl and sentence.");
    if (!report.subjects.has(subjectId)) return refusal(`${JSON.stringify(subjectId)} is not a subject in this brief; use the id in [brackets].`);
    const url = publicUrl(sourceUrl);
    if (typeof url === "string") return refusal(url);
    const page = await citedPage(url.toString());
    const key = JSON.stringify([subjectId, field, String(value),page.canonicalUrl??sourceUrl,sentence]);
    const already = reportedKeys.get(key);
    if (already) return { ok: true, step: null, artifacts: [], provenance: [], requestCount: 0, bytesFetched: 0, forModel: `ALREADY IN THE BOX (${already}).` };
    const finding: ReportedFinding & {sourceCheckedAt?:string} = { subjectId, field, value, exactQuote: sentence, sourceUrl: page.canonicalUrl??url.toString(),sourceCheckedAt:page.sourceCheckedAt,
      artifactIds: page.artifactId ? [page.artifactId] : [], subjectHint: null, index: reported.length };
    try {
      const written = await report.write(finding);
      reported.push(finding);
      reportedKeys.set(key, written.boxId);
      return { ok: true, step: page.fetched?.step ?? null, artifacts: page.fetched?.artifacts ?? [], provenance: page.fetched?.provenance ?? [],
        requestCount: page.fetched?.requestCount ?? 0, bytesFetched: page.fetched?.bytesFetched ?? 0,
        forModel: `IN THE BOX: ${field} = ${JSON.stringify(value)} for ${subjectId}. ` +
          (page.artifactId ? `The page is saved as ${page.artifactId} for checking.` : `The page could not be saved (${page.why}); if another page states it, report that one too.`) };
    } catch (error) {
      return refusal(`the finding was not saved: ${error instanceof Error ? error.message : String(error)}. Report it again.`);
    }
  }

  async function call(name: string, input: unknown): Promise<ScoutToolCallResult> {
    if (!(SCOUT_RESEARCH_TOOLS as readonly string[]).includes(name)) {
      return refusal(`${JSON.stringify(name)} is not a tool; the tools are ${SCOUT_RESEARCH_TOOLS.join(", ")} and finish.`);
    }
    toolCalls += 1;
    if (name === "report_finding") return await reportFinding(input);
    if ((SOURCE_API_TOOLS as readonly string[]).includes(name) || name === "legistar_events") return sourceApi(name as SourceApiTool | ClientTool, input);
    switch (name) {
      case "read_held":
        return await readHeld(input);
      case "search":
        return await search(input);
      case "fetch_public":
      case "browse": {
        const parsed = parseInput(input);
        if (parsed.url === null) return refusal("url is required: an absolute public http(s) URL.");
        return name === "fetch_public" ? await fetchPublic(parsed) : await browse(parsed);
      }
    }
    return refusal(`${name} is not handled in this runtime.`);
  }

  return {
    specs: HUNTER_TOOL_SPECS,
    call,
    reported,
    get vaultedArtifactIds(): ReadonlySet<string> {
      return vaulted;
    },
    get requestCount(): number {
      return requestCount;
    },
    get bytesFetched(): number {
      return bytesFetched;
    },
    get toolCalls(): number {
      return toolCalls;
    },
  };
}
