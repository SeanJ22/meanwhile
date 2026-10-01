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
    for(const provenance of context.inherited.provenance??[]) {
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
      const result=await toolkit.call(tool,{url,why:'Read the official source for the collector, retaining its exact bytes.'},'other:collector-source');
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
      failures.push(result.rung?.observed??result.forModel);
    }
    throw new Error('SOURCE_PAGE_UNREADABLE: '+failures.join('; '));
  };
}
/**
 * **THE SCOUT'S RESEARCH TOOLS.** (Level 1 activation, 2026-09-01.)
 *
 * Implements `scout-contract.ts`. The model never touches the network; every
 * tool here acts under enforcement the model cannot reach, in this order:
 *
 * ```
 *   public URL guard   -> per-host request cap -> robots.txt READ AND RECORDED
 *   (every verdict travels with the artifact; none refuses a public page:
 *   owner decision 2026-09-25, ROBOTS_BLOCKS_ACQUISITION = false)
 *   -> spaced, identified GET (no credential, no cookie) -> VAULT FIRST
 *   -> derive `forModel` FROM THE VAULTED BODY -> return it with the artifact
 *   id, wrapped as untrusted DATA
 * ```
 *
 * An access control on the answer (401/403/429, a bot challenge, a login) is a
 * WALL: reported, vaulted as DIAGNOSTIC, never defeated. The model is told to
 * walk another public route, never to get past it (`lib/hunt/access-control.ts`).
 *
 * Failure modes, each a named refusal in `forModel` and never a throw:
 * a vault that refuses or throws shows the model NOTHING of the body; a
 * `RESTRICTED_RAW` classification likewise; a wall (401/403/429...) vaults the
 * challenge page as DIAGNOSTIC and shows only the envelope; a binary body with
 * no `vaultBytes` in the runtime is refused by name.
 */

import { accessControlIn } from "../../hunt/access-control.ts";
import { runOcr } from "../../extract/ocr.ts";
import { rowsFromItems, cellsFromRow, tablesFromRows, type ExtractedTable } from "../../extract/tables.ts";
import { assertPublicUrl } from "../../hunt/egress.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import {
  artifactId,
  recordAcquisition,
  type Artifact,
  type RetentionPolicy,
} from "../evidence/artifact.ts";
import { contentHash } from "../ids.ts";

import type { WorkArtifact } from "./dispatch.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, WALL_STATUSES } from "./http-executor.ts";
import { evaluatePermission, DEFAULT_ROBOTS_TOKEN, type PermissionReading } from "./robots.ts";
import { DEFAULT_USER_AGENT, realOpen, type OpenOne } from "./route-executor.ts";
import {
  SCOUT_RESEARCH_TOOLS,
  UNTRUSTED_CONTENT_HEADER,
  type ArtifactProvenance,
  type BytesOutcome,
  type OpenBytes,
  type ScoutResearchTool,
  type ScoutToolCallResult,
  type ScoutToolContext,
  type ScoutToolSpec,
  type ScoutToolkit,
} from "./scout-contract.ts";
import { SCOUT_LADDER } from "./scout-result.ts";

/* ------------------------------------------------------------ constants */

export const TEXT_CAP_CHARS = 12_000;
export const LINK_CAP = 60;
export const REQUEST_LIST_CAP = 80;

const ACCEPT_PAGE = "text/html,application/xhtml+xml,application/json,text/calendar,application/pdf,*/*";
const ACCEPT_ROBOTS = "text/plain,*/*";

const RUNG_SCHEMA = {
  type: "string",
  description:
    `The ladder rung this call walks: one of ${SCOUT_LADDER.join(", ")}, or "other:<name>". ` +
    "Required; it is how the walk is accounted for.",
};
const WHY_SCHEMA = {
  type: "string",
  description: "One sentence: what owed question this call is expected to advance. Required.",
};
const URL_SCHEMA = { type: "string", description: "An absolute public http(s) URL." };

export const SCOUT_TOOL_SPECS: readonly ScoutToolSpec[] = [
  {
    name: "read_permission",
    description:
      "Read https://<host>/robots.txt for the URL's host and report the verdict for that URL: ALLOWED, " +
      "DISALLOWED (the rules name the path), NO_ROBOTS (no document) or CANNOT_TELL (the document could not " +
      "be read as robots). The verdict is RECORDED as evidence and never refuses a public page: the owner " +
      "decided that robots.txt alone does not block acquisition. The robots document is " +
      "vaulted and the operative lines are returned. fetch_public and browse read and record it " +
      "automatically; call this to see the rules themselves.",
    input_schema: {
      type: "object",
      properties: { url: URL_SCHEMA, rung: RUNG_SCHEMA, why: WHY_SCHEMA },
      required: ["url", "rung", "why"],
    },
  },
  {
    name: "fetch_public",
    description:
      "GET one public http(s) URL with identified headers, vault the body, and return a representation " +
      "derived from the vaulted bytes with its artifact id: HTML -> title, visible text and absolute links; " +
      "JSON -> pretty-printed; PDF -> extracted text. Refuses private hosts and requests past the per-host " +
      "cap. robots.txt is read and recorded with the artifact, never a refusal. An access control (401, 403, " +
      "429, a login or a bot challenge) is reported as a wall, never as absence, and is never bypassed: walk " +
      "another public route instead.",
    input_schema: {
      type: "object",
      properties: { url: URL_SCHEMA, rung: RUNG_SCHEMA, why: WHY_SCHEMA },
      required: ["url", "rung", "why"],
    },
  },
  {
    name: "browse",
    description:
      "Open one public URL in a real browser (when the runtime has one), vault the rendered HTML and the " +
      "page's own network requests, and return the visible text plus the observed request list — the " +
      "real API behind a page. Same guards as fetch_public.",
    input_schema: {
      type: "object",
      properties: { url: URL_SCHEMA, rung: RUNG_SCHEMA, why: WHY_SCHEMA },
      required: ["url", "rung", "why"],
    },
  },
  {
    name: "read_inherited",
    description:
      "Prior project evidence for this obligation: earlier route outcomes, prior Scout results, known " +
      "routes for the hosts, and the inherited artifact ids you may cite. No network.",
    input_schema: {
      type: "object",
      properties: { rung: RUNG_SCHEMA, why: WHY_SCHEMA },
      required: ["rung", "why"],
    },
  },
  {
    name: "find_manual",
    description: "Search the complete role/jurisdiction-applicable field-manual catalog handed to this walk. Returns bounded matching entry IDs, titles and method summaries; use read_manual to inspect full content. No network or paid source call.",
    input_schema: { type: "object", properties: {
      query: { type: "string" }, rung: RUNG_SCHEMA, why: WHY_SCHEMA,
    }, required: ["query", "rung", "why"] },
  },
  {
    name: "read_manual",
    description: "Open a bounded passage of one relevant field-manual entry handed to this walk. Its full stored method or referenced document is returned with a content hash and offset; no network or paid call.",
    input_schema: { type: "object", properties: {
      entryId: { type: "string" }, offset: { type: "integer" }, rung: RUNG_SCHEMA, why: WHY_SCHEMA,
    }, required: ["entryId", "offset", "rung", "why"] },
  },
  {
    name: "read_held",
    description: "Open a bounded passage of an inherited sanitized artifact by exact id and offset, or locate a literal phrase anywhere in those saved bytes with query. This reuses saved bytes with no network or paid source call; only handed ids are allowed.",
    input_schema: { type: "object", properties: {
      artifactId: { type: "string" }, offset: { type: "integer" }, query: { type: "string" }, rung: RUNG_SCHEMA, why: WHY_SCHEMA,
    }, required: ["artifactId", "rung", "why"] },
  },
];

/**
 * The `search` spec, APPENDED to the toolkit's specs only when a search seam is
 * configured (a provider key is present). A runtime with no key never offers it,
 * so the tool is fully inert without configuration.
 */
export const SEARCH_TOOL_SPEC: ScoutToolSpec = {
  name: "search",
  description:
    "Look up a query in the compliant paid search indexes (Brave and Exa) and return POINTERS ONLY — a " +
    "ranked list of result URLs and titles, no page content. Use it when direct routes are walled, or to " +
    "discover a candidate's own publication: the \"<name> for <office>\" committee phrasing surfaces campaign " +
    "sites well. It fetches nothing itself — open any promising hit with fetch_public or browse, which read and " +
    "record robots.txt (never a refusal of a public page) and vault the evidence; an access control there is a " +
    "wall, never bypassed. A hit is a lead, never proof, and may be a prior cycle's site.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query. A specific candidate / office / place phrase works best." },
      rung: RUNG_SCHEMA,
      why: WHY_SCHEMA,
      includeDomains: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional: restrict results to these domains (e.g. [\"*.gov\",\"*.us\"]) when the target is an " +
          "official publisher rather than a candidate's own site.",
      },
    },
    required: ["query", "rung", "why"],
  },
};

/**
 * **THE RESEARCH TOOL LIST, FOR ONE SETTING OF THE SEARCH SWITCH — the one
 * answer the toolkit and the pre-warm both read.** (2026-09-25.) The tool list
 * is the first part of the cached prefix, so a pre-warm built from the list
 * WITHOUT `search` while the Attempts send the list WITH it warms an entry no
 * Attempt reads — a paid write and a miss every cycle the owner's paid-search
 * switch is on.
 */
export function scoutToolSpecsFor(search: boolean): readonly ScoutToolSpec[] {
  return search ? [...SCOUT_TOOL_SPECS, SEARCH_TOOL_SPEC] : SCOUT_TOOL_SPECS;
}

/* ------------------------------------------------------------ transport */

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

/* --------------------------------------------------------- derivations */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", times: "×",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

export function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return title === "" ? null : title;
}

/** Visible text: scripts, styles, noscript, templates and comments removed; block ends become newlines. */
export function visibleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table|\/ul|\/ol|\/header|\/footer|\/nav|\/dd|\/dt|\/blockquote|\/pre)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .split(/\n/)
    .map((line) => line.replace(/[ \t\r\f\v ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

export interface DerivedLink {
  readonly url: string;
  readonly text: string;
}

/** Absolute http(s) links, deduplicated, same-host first, capped. */
export function extractLinks(html: string, base: URL, cap: number = LINK_CAP): DerivedLink[] {
  const seen = new Set<string>();
  const same: DerivedLink[] = [];
  const other: DerivedLink[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const m of html.matchAll(re)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (href === "" || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    resolved.hash = "";
    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = visibleText(m[4] ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    (resolved.host.toLowerCase() === base.host.toLowerCase() ? same : other).push({ url: key, text });
  }
  return [...same, ...other].slice(0, cap);
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

/* ------------------------------------------------------------- toolkit */

type Rung = NonNullable<ScoutToolCallResult["rung"]>;

interface CallAccount {
  readonly artifacts: WorkArtifact[];
  /** RULING 243: the machine's record of each artifact this call vaulted. */
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
  readonly rung: string;
  readonly why: string;
}

function isRungLabel(label: unknown): label is string {
  if (typeof label !== "string" || label.trim() === "") return false;
  return (SCOUT_LADDER as readonly string[]).includes(label) || /^other:\S/.test(label);
}

function parseInput(
  input: unknown,
  rungLabel: string | null,
  needsUrl: boolean,
): { readonly ok: true; readonly value: ParsedInput } | { readonly ok: false; readonly why: string } {
  const o = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rung = rungLabel ?? o.rung;
  if (!isRungLabel(rung)) {
    return {
      ok: false,
      why:
        `input.rung must be one of ${SCOUT_LADDER.join(", ")} or "other:<name>"; got ` +
        `${JSON.stringify(rung ?? null)}. Every call is accounted to a rung.`,
    };
  }
  if (typeof o.why !== "string" || o.why.trim() === "") {
    return { ok: false, why: "input.why is required: one sentence naming the owed question this call advances." };
  }
  if (needsUrl && (typeof o.url !== "string" || o.url.trim() === "")) {
    return { ok: false, why: "input.url is required: an absolute public http(s) URL." };
  }
  return { ok: true, value: { url: needsUrl ? (o.url as string).trim() : null, rung, why: o.why } };
}

function workArtifact(artifact: Artifact, recordedAt: string): WorkArtifact {
  return {
    artifactId: artifact.id,
    tier: artifact.tier,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl,
    partial: artifact.extraction?.complete === false,
    recordedAt,
  };
}

/**
 * The envelope carries `retrieved <stamp>` and the permission verdict so the
 * model's provenance CLAIMS can be copied from the record it was shown
 * (RULING 243); the machine still derives the values from the artifact itself.
 */
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
  const openOne: OpenOne = ctx.openOne ?? realOpen;
  /* An injected string opener never falls through to the real network. */
  const openBytes: OpenBytes | null =
    ctx.openBytes ?? (ctx.openOne === undefined || ctx.openOne === realOpen ? realOpenBytes : null);
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const token = DEFAULT_ROBOTS_TOKEN;

  const robotsByHost = new Map<string, HostRobots>();
  const hostCounts = new Map<string, number>();
  const vaulted = new Set<string>();
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
      if (overCap(hostOf(url)) !== null) throw error;
      return open(url);
    }
    if (first.transportError === null && first.status !== null && first.status >= 200 && first.status < 300) return first;
    return overCap(hostOf(url)) === null ? open(url) : first;
  }

  function overCap(host: string): string | null {
    const n = hostCounts.get(host) ?? 0;
    const max = ctx.bound.maxRequestsPerHost;
    if (n < max) return null;
    return (
      `${host} has had ${n} of ${max} requests this Attempt (the per-host bound), so this request is ` +
      "refused. The bound is per host: another host is not bound by this count."
    );
  }

  async function retrieve(url: URL, accept: string, acc: CallAccount): Promise<Retrieved> {
    const host = hostOf(url);
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    await ctx.spaceOut(host);
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
    return await put(artifact, () => ctx.vault(artifact, input.text), at, acc);
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
      retrievedAt: artifact.retrievedAt,
      permission: artifact.permission,
      methodRouteId: artifact.methodRouteId,
      httpStatus: artifact.httpStatus,
    });
    return { artifact, stored: true, why: "stored" };
  }

  /* ------------------------------------------------------- permission */

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

  function permissionText(url: URL, robots: HostRobots, reading: PermissionReading, cached: boolean): string {
    const lines = [
      `PERMISSION for ${url.host}${cached ? " (robots document read earlier this Attempt)" : ""}: ${reading.verdict}`,
      `robots.txt ${robots.robotsUrl}: ${robots.transportError !== null ? `transport failure — ${robots.transportError}` : `HTTP ${robots.status ?? "none"}`}` +
        (robots.artifactIds.length > 0 ? ` | vaulted as ${robots.artifactIds.join(", ")}` : " | nothing vaulted"),
      `Reading for ${url.pathname}${url.search}: ${reading.detail}.`,
    ];
    if (reading.matchedRule !== null) lines.push(`Matched rule: ${reading.matchedRule}`);
    if (reading.crawlDelayMs !== null) lines.push(`Crawl-delay: ${reading.crawlDelayMs} ms (requests are spaced per host).`);
    if (reading.verdict === "DISALLOWED") {
      lines.push(
        "The rules name this path. That is RECORDED with the artifact and does not refuse it: the owner decided on " +
          "2026-09-25 that robots.txt alone never blocks reading a public page. fetch_public and browse will open it.",
      );
    } else if (reading.verdict === "CANNOT_TELL") {
      lines.push(
        "The robots document could not be read as robots; that is recorded as unread, never as 'no robots file', and " +
          "it does not refuse the page. The page's own answer decides: an access control there is a wall, never bypassed.",
      );
    } else if (reading.verdict === "NO_ROBOTS") {
      lines.push("No robots document: recorded as absent.");
    }
    if (reading.operativeLines.length > 0) {
      lines.push(UNTRUSTED_CONTENT_HEADER, DATA_BEGIN, ...reading.operativeLines, DATA_END);
    }
    return lines.join("\n");
  }

  /* ------------------------------------------------------------- tools */

  function refusal(text: string, extra: Partial<ScoutToolCallResult> = {}): ScoutToolCallResult {
    return { ok: false, forModel: `REFUSED: ${text}`, artifacts: [], provenance: [], rung: null, requestCount: 0, bytesFetched: 0, ...extra };
  }

  /** The rung carries the machine's `ok` and, when the call ran under a verdict, its permission. */
  function result(
    ok: boolean,
    forModel: string,
    rung: Rung | null,
    acc: CallAccount,
    permission?: PermissionState,
  ): ScoutToolCallResult {
    const stamped: Rung | null = rung === null ? null : { ...rung, ok, ...(permission !== undefined ? { permission } : {}) };
    return { ok, forModel, artifacts: acc.artifacts, provenance: acc.provenance, rung: stamped, requestCount: acc.requests, bytesFetched: acc.bytes };
  }

  function publicUrl(raw: string): URL | string {
    try {
      return assertPublicUrl(raw);
    } catch (error) {
      return `${raw} is not a public http(s) URL: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function readPermission(input: ParsedInput): Promise<ScoutToolCallResult> {
    const url = publicUrl(input.url ?? "");
    if (typeof url === "string") return refusal(url);
    const host = hostOf(url);
    const acc: CallAccount = { artifacts: [], provenance: [], requests: 0, bytes: 0 };
    const cached = robotsByHost.has(host);
    if (!cached) {
      const cap = overCap(host);
      if (cap !== null) return refusal(cap);
    }
    const robots = await readRobots(url, acc);
    const reading = evaluate(robots, url);
    const rung: Rung = {
      rung: input.rung,
      tool: "read_permission",
      target: url.toString(),
      observed:
        robots.transportError !== null
          ? `robots.txt transport failure: ${robots.transportError}; permission ${reading.verdict}`
          : `robots.txt HTTP ${robots.status ?? "none"}; permission ${reading.verdict}` + (cached ? " (cached)" : ""),
      artifactIds: cached ? [...robots.artifactIds] : acc.artifacts.map((a) => a.artifactId),
      transport: cached ? "NOT_ATTEMPTED" : transportOf(robots.status, robots.transportError),
      httpStatus: robots.status, returnedCount: null, applicableBecause: input.why,
      nextHopUrls: [...(robots.text ?? "").matchAll(/^Sitemap:\s*(https?:\/\/\S+)/gim)].map(match => match[1]),
    };
    return result(true, permissionText(url, robots, reading, cached), rung, acc, permissionState(reading.verdict));
  }

  /** The shared front half of fetch_public and browse. A string is a refusal. */
  async function admit(
    input: ParsedInput,
    tool: "fetch_public" | "browse",
  ): Promise<
    | { readonly kind: "GO"; readonly url: URL; readonly acc: CallAccount; readonly reading: PermissionReading; readonly robots: HostRobots }
    | { readonly kind: "REFUSED"; readonly result: ScoutToolCallResult }
  > {
    const url = publicUrl(input.url ?? "");
    if (typeof url === "string") return { kind: "REFUSED", result: refusal(url) };
    const host = hostOf(url);
    const acc: CallAccount = { artifacts: [], provenance: [], requests: 0, bytes: 0 };
    const capBefore = overCap(host);
    if (capBefore !== null) return { kind: "REFUSED", result: refusal(capBefore) };
    /* Read and recorded, never a refusal: ROBOTS_BLOCKS_ACQUISITION is false (owner decision 2026-09-25). */
    const robots = await readRobots(url, acc);
    const reading = evaluate(robots, url);
    const capAfter = overCap(host);
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
    /* A challenge served at 2xx is CHALLENGED on the rung as on the artifact, never REACHABLE. */
    let challenged = false;
    const rung = (observed: string): Rung => ({
      rung: input.rung,
      tool: "fetch_public",
      target: url.toString(),
      observed,
      artifactIds: acc.artifacts.map((a) => a.artifactId),
      transport: challenged ? "CHALLENGED" : transportOf(got.status, got.transportError), httpStatus: got.status,
      nextHopUrls, returnedCount, applicableBecause: input.why,
    });

    const got = await preferHttps(url, target => retrieve(target, ACCEPT_PAGE, acc));
    if (got.transportError !== null) {
      return result(
        false,
        `nothing was reached at ${url.host}: ${got.transportError}. A transport failure is a fact about this client and this moment, never about the record.\n${permLine}`,
        rung(`transport failure: ${got.transportError}`), acc, permission
      );
    }
    const status = got.status ?? 0;
    const finalUrl = got.finalUrl ?? url.toString();

    if (status >= 200 && status < 300) {
      if (got.byteLength === 0) {
        return result(
          false,
          `${url} answered HTTP ${status} and ZERO BYTES. A zero-byte read is a FAILED read, never an empty document; the record is still owed.\n${permLine}`,
          rung(`HTTP ${status} (0 bytes)`), acc, permission
        );
      }
      if (isBinary(got.contentType, got.bytes)) {
        return await binaryRepresentation({ url, finalUrl, status, got, permission, permLine, acc, rung });
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
          rung(`HTTP ${status} (${control.kind})`), acc, permission
        );
      }
      const report = await vaultText(
        { url, finalUrl, status, contentType: got.contentType, text, methodRouteId: "scout:fetch_public", permission, transport: "REACHABLE" },
        acc,
      );
      const head = `${envelope(report.artifact, url.toString(), finalUrl, status, got.byteLength)}\n${permLine}`;
      if (!report.stored) {
        return result(
          false,
          `${head}\nVAULT REFUSED: ${report.why}. Nothing of the body is shown: a body the vault does not hold cannot be cited, and a finding grounded in it would be grounded in memory. Try another representation of the record.`,
          rung(`HTTP ${status}, ${got.byteLength} bytes, NOT VAULTED`), acc, permission
        );
      }
      if (report.artifact.tier === "RESTRICTED_RAW") {
        return result(
          true,
          `${head}\nQUARANTINED: the body carries a confirmed third-party credential and is stored RESTRICTED_RAW. Nothing of it is shown to you. Cite the artifact id; a sanitized derivative is the acquirer's to make.`,
          rung(`HTTP ${status}, ${got.byteLength} bytes, RESTRICTED_RAW`), acc, permission
        );
      }
      if (/html/i.test(got.contentType)) nextHopUrls = extractLinks(text, url).map(link => link.url);
      if (/json/i.test(got.contentType)) {
        try { const rows: unknown = JSON.parse(text); if (Array.isArray(rows)) returnedCount = rows.length; } catch { /* Raw bytes remain evidence; parsing is another worker's burden. */ }
      }
      return result(true, textRepresentation(head, text, got.contentType, url), rung(`HTTP ${status}, ${got.byteLength} bytes, ${got.contentType}`), acc, permission);
    }

    /* Non-2xx: the answer is DIAGNOSTIC evidence that the rung was walked; the body is never shown. */
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
        rung(`HTTP ${status} (wall)`), acc, permission
      );
    }
    if (status >= 400 && status < 500) {
      return result(
        false,
        `HTTP ${status} at ${url}: a fact about this URL, not about the record; another representation of it is owed. ${diagnostic}.\n${permLine}`,
        rung(`HTTP ${status}`), acc, permission
      );
    }
    return result(
      false,
      `${url.host} answered HTTP ${status}: their side broke. ${diagnostic}. This may be retried later; it is not evidence about the record.\n${permLine}`,
      rung(`HTTP ${status}`), acc, permission
    );
  }

  function textRepresentation(head: string, text: string, contentType: string, url: URL): string {
    const ct = contentType.toLowerCase();
    const parts: string[] = [UNTRUSTED_CONTENT_HEADER, head, DATA_BEGIN];
    const htmlShaped = ct.includes("html") || /^\s*<(!doctype|html)/i.test(text);
    if (htmlShaped) {
      const title = htmlTitle(text);
      const body = capText(visibleText(text));
      parts.push(`TITLE: ${title ?? "(none)"}`, `TEXT (${body.note}):`, body.text);
      const links = extractLinks(text, url);
      parts.push(`LINKS (${links.length}, same-host first):`, ...links.map((l) => `- ${l.url}${l.text ? ` — ${l.text}` : ""}`));
    } else if (ct.includes("json") || /^\s*[[{]/.test(text)) {
      let pretty: string;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        pretty = text;
      }
      const body = capText(pretty);
      parts.push(`JSON (${body.note}):`, body.text);
    } else {
      const body = capText(text);
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
    readonly rung: (observed: string) => Rung;
  }): Promise<ScoutToolCallResult> {
    const { url, finalUrl, status, got, acc } = input;
    const report = await vaultBinary({ url, finalUrl, status, contentType: got.contentType, bytes: got.bytes, permission: input.permission }, acc);
    const head = `${envelope(report.artifact, url.toString(), finalUrl, status, got.byteLength)}\n${input.permLine}`;
    if (!report.stored) {
      return result(false, `${head}\nNOT VAULTED: ${report.why}. Nothing of the body is shown.`, input.rung(`HTTP ${status}, ${got.byteLength} bytes binary, NOT VAULTED`), acc, input.permission);
    }
    if (!isPdf(got.contentType, got.bytes)) {
      return result(true, `${head}\nBINARY body vaulted (${got.contentType}); no text representation is derived for this type.`, input.rung(`HTTP ${status}, ${got.byteLength} bytes, ${got.contentType}`), acc, input.permission);
    }
    const extracted = await extractPdf(got.bytes);
    if (extracted.kind !== "TEXT") {
      return result(
        true,
        `${head}\nPDF vaulted; ${extracted.kind}: ${extracted.why}. Only the artifact id and byte length are available; cite the id.`,
        input.rung(`HTTP ${status}, ${got.byteLength} bytes PDF, ${extracted.kind}`), acc, input.permission
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
      if (captured.tier === "RESTRICTED_RAW") return result(false, `${head}\nPDF transcription contains restricted material; no text is shown.`, input.rung("PDF transcription restricted"), acc, input.permission);
      const artifact: Artifact = { ...captured, id: artifactId("EXTRACTED_DERIVED", captured.contentHash), tier: "EXTRACTED_DERIVED",
        retentionPolicy: extracted.complete ? "EVIDENCE_PERMANENT" : "DIAGNOSTIC",
        extraction: { kind: kind as "PDF_TEXT" | "PDF_TABLES", version: "pdf-transcription/1", complete: extracted.complete, pages: extracted.pages, parent } };
      const saved = await put(artifact, () => ctx.vault(artifact, text), ctx.now(), acc);
      if (!saved.stored) return result(false, `${head}\nPDF transcription NOT VAULTED: ${saved.why}`, input.rung("PDF transcription storage failed"), acc, input.permission);
      transcriptions.push(`${kind} artifact ${artifact.id}; ${capText(text).note}\n${capText(text).text}`);
    }
    return result(
      true,
      [UNTRUSTED_CONTENT_HEADER, head, extracted.extractionNote, DATA_BEGIN, ...transcriptions, DATA_END].join("\n"),
      input.rung(`HTTP ${status}, ${got.byteLength} bytes PDF, ${extracted.pages} page(s)`), acc, input.permission
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
    const rung = (observed: string): Rung => ({
      rung: input.rung,
      tool: "browse",
      target: url.toString(),
      observed,
      artifactIds: acc.artifacts.map((a) => a.artifactId),
      transport: browserTransport, httpStatus: browserHttpStatus, returnedCount: null,
      nextHopUrls: browserNextHopUrls, applicableBecause: input.why,
    });

    let obs: Awaited<ReturnType<typeof browseFn>>;
    try {
      obs = await preferHttps(url, async target => {
        /* Each navigation counts; the page's own calls are observed, not initiated. */
        hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
        await ctx.spaceOut(host);
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
      return result(false, `the browser failed on ${url}: ${why}. A browser failure is a fact about this client, not about the record.`, rung(`browser failure: ${why}`), acc, permission);
    }
    const htmlBytes = Buffer.byteLength(obs.html, "utf8");
    browserTransport = transportOf(obs.status, obs.transportError);
    browserHttpStatus = obs.status;

    if (obs.html.trim() === "") {
      return result(
        false,
        `the browser rendered nothing at ${url}${obs.transportError ? `: ${obs.transportError}` : ""} (HTTP ${obs.status ?? "none"}). Nothing is vaulted and nothing is shown; a blank render is a failed read, never an empty page.`,
        rung(`browser HTTP ${obs.status ?? "none"}, empty render${obs.transportError ? `: ${obs.transportError}` : ""}`), acc, permission
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
        rung(`browser HTTP ${obs.status ?? "none"} (${control.kind})`), acc, permission
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
      browserNextHopUrls = extractLinks(obs.html, new URL(finalUrl), 200).map(link => link.url);
      const body = capText(visibleText(obs.html));
      parts.push(UNTRUSTED_CONTENT_HEADER, head, DATA_BEGIN, `TITLE: ${htmlTitle(obs.html) ?? "(none)"}`, `TEXT (${body.note}):`, body.text, DATA_END);
    }
    if (!network.stored) {
      parts.push(`NETWORK OBSERVATION not vaulted: ${network.why}. The request list is not shown.`);
    } else {
      const ordered = [...obs.requests]
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
      rung(`browser HTTP ${obs.status ?? "none"}, ${htmlBytes} bytes rendered, ${obs.requests.length} request(s) observed`), acc, permission
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

  function readInherited(): ScoutToolCallResult {
    const ids = ctx.inherited.artifactIds;
    const text =
      `INHERITED EVIDENCE — citable artifact ids (${ids.length}): ${ids.length > 0 ? ids.join(", ") : "(none)"}\n` +
      (ctx.inherited.summary.trim() === "" ? "(no inherited summary for this obligation)" : ctx.inherited.summary);
    return { ok: true, forModel: text, artifacts: [], provenance: [], rung: null, requestCount: 0, bytesFetched: 0 };
  }

  const READ_PASSAGE_CHARS = 6_000;
  function readOffset(input: unknown): number | null {
    const offset = (input !== null && typeof input === "object" ? (input as Record<string, unknown>).offset : null);
    return typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
  }
  function knowledgePassage(kind: "MANUAL_ENTRY" | "HELD_ARTIFACT", id: string, text: string, hash: string, offset: number): ScoutToolCallResult {
    if (offset > text.length) return refusal(`READ_OFFSET_OUT_OF_RANGE: ${offset} exceeds ${text.length} UTF-16 characters.`);
    const end = Math.min(text.length, offset + READ_PASSAGE_CHARS);
    return { ok: true, forModel: `${kind} ${id}; ${hash}; UTF-16 passage ${offset}..${end} of ${text.length}; ${end < text.length ? `continue at offset ${end}` : "end of document"}\n${UNTRUSTED_CONTENT_HEADER}\n${DATA_BEGIN}\n${text.slice(offset, end)}\n${DATA_END}`,
      artifacts: [], provenance: [], rung: null, requestCount: 0, bytesFetched: 0,
      knowledgeRead: { kind, id, contentHash: hash, offset, length: end - offset } };
  }
  function findManual(input: unknown): ScoutToolCallResult {
    const raw = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const query = typeof raw.query === "string" ? raw.query.trim().toLowerCase() : "";
    if (!query || query.length > 160) return refusal("FIND_MANUAL_QUERY_INVALID: provide a 1–160 character method, publisher, place or field phrase.");
    const words = query.split(/\s+/).filter(Boolean);
    const entries = ctx.inherited.manualEntries ?? [];
    const matches = entries.filter(entry => {
      const haystack = [entry.title, entry.summary, entry.kind, entry.source, entry.url ?? "", ...entry.recordClasses, ...entry.platforms, ...entry.states]
        .join(" ").toLowerCase();
      return words.every(word => haystack.includes(word));
    }).slice(0, 25);
    return { ok: true, forModel: `FIELD_MANUAL_CATALOG ${matches.length} matching entries of ${entries.length} applicable entries; at most 25 shown. Open a listed ID with read_manual.\n${UNTRUSTED_CONTENT_HEADER}\n${DATA_BEGIN}\n${matches.map(entry => `${entry.id} | ${entry.outcome} | ${entry.title} | ${entry.summary} | ${entry.url ?? "no URL"}`).join("\n")}\n${DATA_END}`,
      artifacts: [], provenance: [], rung: null, requestCount: 0, bytesFetched: 0 };
  }
  async function readManual(input: unknown): Promise<ScoutToolCallResult> {
    const raw = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const offset = readOffset(input);
    if (typeof raw.entryId !== "string" || offset === null) return refusal("READ_MANUAL_INPUT_INVALID: entryId and nonnegative integer offset are required.");
    const entry = ctx.inherited.manualEntries?.find(row => row.id === raw.entryId);
    if (!entry) return refusal("READ_MANUAL_NOT_HANDED: only entries projected into this walk may be opened.");
    const payload = entry.payload as { path?: unknown; body?: unknown } | null;
    let full: string;
    try {
      if (typeof payload?.body === "string") full = payload.body;
      else if (typeof payload?.path === "string") {
        if (!ctx.readManualDocument) return refusal("READ_MANUAL_DOCUMENT_UNAVAILABLE: no scoped document reader is configured.");
        full = await ctx.readManualDocument(payload.path);
      } else full = JSON.stringify(entry.payload) ?? "null";
    } catch (error) { return refusal(`READ_MANUAL_FAILED: ${error instanceof Error ? error.message : String(error)}`); }
    return knowledgePassage("MANUAL_ENTRY", entry.id, full, contentHash(full), offset);
  }
  async function readHeld(input: unknown): Promise<ScoutToolCallResult> {
    const raw = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const query = typeof raw.query === "string" ? raw.query.trim() : null;
    const suppliedOffset = readOffset(input);
    if (typeof raw.artifactId !== "string" || (suppliedOffset === null && query === null) ||
      (query !== null && (query.length < 2 || query.length > 160 || /[\r\n]/.test(query)))) {
      return refusal("READ_HELD_INPUT_INVALID: artifactId and either nonnegative integer offset or bounded literal query are required.");
    }
    if (!ctx.inherited.artifactIds.includes(raw.artifactId)) return refusal("READ_HELD_NOT_HANDED: this artifact is outside the inherited evidence for this walk.");
    if (!ctx.readHeldArtifact) return refusal("READ_HELD_UNAVAILABLE: no sanitized vault reader is configured.");
    try {
      const evidence = await ctx.readHeldArtifact(raw.artifactId);
      if (evidence.artifactId !== raw.artifactId || contentHash(evidence.text) !== evidence.contentHash) return refusal("READ_HELD_HASH_MISMATCH: the vault read did not verify.");
      const provenance = evidence.provenance;
      if (provenance && (provenance.artifactId !== evidence.artifactId || provenance.canonicalUrl !== evidence.canonicalUrl ||
        provenance.retrievedAt !== evidence.retrievedAt || provenance.methodRouteId !== evidence.methodRouteId)) {
        return refusal("READ_HELD_PROVENANCE_MISMATCH: the vault envelope disagrees with the saved bytes.");
      }
      const withProvenance = (passage: ScoutToolCallResult): ScoutToolCallResult => provenance
        ? { ...passage, provenance: [provenance], forModel: `HELD_VAULT_ENVELOPE ${provenance.artifactId}; retrieved ${provenance.retrievedAt}; permission ${provenance.permission}; HTTP ${provenance.httpStatus ?? "none"}; URL ${provenance.canonicalUrl}.\n${passage.forModel}` }
        : passage;
      if (query !== null) {
        const lower = evidence.text.toLowerCase(), needle = query.toLowerCase();
        const positions: number[] = [];
        for (let at = lower.indexOf(needle); at !== -1 && positions.length < 20; at = lower.indexOf(needle, at + needle.length)) positions.push(at);
        if (!positions.length) return refusal(`READ_HELD_QUERY_NOT_FOUND: ${JSON.stringify(query)} has no literal match in this handed artifact.`);
        const offset = Math.max(0, positions[0]! - 500);
        const passage = knowledgePassage("HELD_ARTIFACT", evidence.artifactId, evidence.text, evidence.contentHash, offset);
        return withProvenance({ ...passage, forModel: `HELD_LITERAL_MATCH ${JSON.stringify(query)} at UTF-16 offsets ${positions.join(", ")}${positions.length === 20 ? " (first 20)" : ""}.\n${passage.forModel}` });
      }
      return withProvenance(knowledgePassage("HELD_ARTIFACT", evidence.artifactId, evidence.text, evidence.contentHash, suppliedOffset!));
    } catch (error) { return refusal(`READ_HELD_FAILED: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async function search(
    input: ParsedInput,
    query: string,
    includeDomains: readonly string[] | undefined,
  ): Promise<ScoutToolCallResult> {
    if (ctx.search === undefined) return refusal("search is not available in this runtime (no provider key, or the owner's paid-search switch is off).");
    const acc: CallAccount = { artifacts: [], provenance: [], requests: 0, bytes: 0 };
    let res;
    try {
      res = await ctx.search({ query, includeDomains });
    } catch (error) {
      return refusal(`search failed at transport: ${error instanceof Error ? error.message : String(error)}`);
    }
    acc.requests = res.requestCount;
    acc.bytes = res.bytesFetched;
    requestCount += res.requestCount;
    bytesFetched += res.bytesFetched;
    const answered = res.providersUsed.length > 0;
    const errNote = res.errors.length > 0 ? ` [providers erroring: ${res.errors.join("; ")}]` : "";
    const header = !answered
      ? `SEARCH "${query}" reached no provider${errNote}`
      : res.hits.length === 0
        ? `SEARCH "${query}" — no pointers from ${res.providersUsed.join(", ")}. A search index finding nothing is a real (not failed) negative for this query.${errNote}`
        : `SEARCH "${query}" — ${res.hits.length} pointer(s) from ${res.providersUsed.join(", ")}. LEADS, not evidence: open a promising one with fetch_public or browse (which read and record robots.txt and vault). A hit may be a prior cycle's site.${errNote}`;
    const forModel =
      res.hits.length === 0
        ? header
        : `${header}\n${DATA_BEGIN}\n${res.hits.map((h, i) => `${i + 1}. ${h.url}  [${h.provider}]  ${h.title}`).join("\n")}\n${DATA_END}`;
    const rung: Rung = {
      rung: input.rung,
      tool: "search",
      target: query,
      observed: `${res.hits.length} pointer(s) from ${res.providersUsed.join("+") || "none"}${res.errors.length > 0 ? `; ${res.errors.length} provider error(s)` : ""}`,
      artifactIds: [],
      transport: answered ? "REACHABLE" : "OTHER_NAMED_FAILURE",
      httpStatus: null,
      returnedCount: res.hits.length,
      applicableBecause: input.why,
      nextHopUrls: res.hits.map((h) => h.url),
    };
    return result(answered, forModel, rung, acc);
  }

  /* -------------------------------------------------------------- call */

  async function call(name: string, input: unknown, rungLabel: string | null): Promise<ScoutToolCallResult> {
    if (!(SCOUT_RESEARCH_TOOLS as readonly string[]).includes(name)) {
      return refusal(`${JSON.stringify(name)} is not a research tool; the research tools are ${SCOUT_RESEARCH_TOOLS.join(", ")}.`);
    }
    if (toolCalls >= ctx.bound.maxToolCalls) {
      return refusal(
        `the Attempt's research tool-call bound (${ctx.bound.maxToolCalls}) is reached; no further tool runs. ` +
          "Finish with what the walk established and name the next rungs so the next Attempt resumes rather than restarts.",
      );
    }
    toolCalls += 1;
    const tool = name as ScoutResearchTool;
    const needsUrl = tool === "read_permission" || tool === "fetch_public" || tool === "browse";
    const parsed = parseInput(input, rungLabel, needsUrl);
    if (!parsed.ok) return refusal(parsed.why);
    switch (tool) {
      case "read_permission":
        return await readPermission(parsed.value);
      case "fetch_public":
        return await fetchPublic(parsed.value);
      case "browse":
        return await browse(parsed.value);
      case "read_inherited":
        return readInherited();
      case "find_manual":
        return findManual(input);
      case "read_manual":
        return await readManual(input);
      case "read_held":
        return await readHeld(input);
      case "search": {
        const o = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
        const query = typeof o.query === "string" ? o.query.trim() : "";
        if (query === "") return refusal("input.query is required: a search phrase (a candidate / office / place).");
        const includeDomains = Array.isArray(o.includeDomains)
          ? o.includeDomains.filter((d): d is string => typeof d === "string")
          : undefined;
        return await search(parsed.value, query, includeDomains);
      }
    }
    return refusal(`RESEARCH_TOOL_UNHANDLED: ${name}`);
  }

  return {
    specs: scoutToolSpecsFor(Boolean(ctx.search)),
    heldEvidenceProtocolAvailable: Boolean(ctx.readHeldArtifact),
    call,
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
