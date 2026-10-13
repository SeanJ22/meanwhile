import { decodeEntities } from "../http.ts";
import type { LegislatureChamber } from "./targets.ts";

const LATIN_ENTITIES: Readonly<Record<string, string>> = {
  Aacute: "Á", aacute: "á", Eacute: "É", eacute: "é", Iacute: "Í", iacute: "í", Oacute: "Ó", oacute: "ó", Uacute: "Ú", uacute: "ú",
  Ntilde: "Ñ", ntilde: "ñ", Ccedil: "Ç", ccedil: "ç", Auml: "Ä", auml: "ä", Euml: "Ë", euml: "ë", Iuml: "Ï", iuml: "ï", Ouml: "Ö", ouml: "ö", Uuml: "Ü", uuml: "ü",
};
export function decodeRosterEntities(value: string): string {
  return decodeEntities(value).replace(/&#(x[\da-f]+|\d+);?/gi, (_, digits: string) => {
    const code = digits[0]?.toLowerCase() === "x" ? Number.parseInt(digits.slice(1), 16) : Number(digits);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  }).replace(/&([A-Za-z]+);/g, (entity: string, key: string) => LATIN_ENTITIES[key] ?? entity);
}

export interface StateRosterRecord {
  readonly name: string;
  readonly district: string;
  /** A separate seat label explicitly printed by the publisher within a district. */
  readonly seat?: string;
  readonly chamber: LegislatureChamber;
  readonly sourceUrl: string;
  readonly nativeId?: string;
  /** The publisher keys this profile by the seat rather than the person. */
  readonly seatBound?: boolean;
  readonly party?: string | null;
  readonly vacant?: boolean;
  readonly since?: string | null;
  readonly termStart?: string | null;
  readonly divisionId?: string;
}

/** Small source-document tree; scripts and styles never become roster text. */
export interface HtmlNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: (HtmlNode | string)[];
  readonly parent: HtmlNode | null;
}

export function parseHtml(body: string): HtmlNode {
  const root: HtmlNode = { tag: "root", attrs: {}, children: [], parent: null };
  let current = root;
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const input = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  for (const token of input.matchAll(/<[^>]*>|[^<]+/g)) {
    const part = token[0];
    if (!part.startsWith("<")) { current.children.push(part); continue; }
    const close = /^<\/\s*([\w:-]+)/.exec(part)?.[1]?.toLowerCase();
    if (close) {
      let node: HtmlNode | null = current;
      while (node && node.tag !== close) node = node.parent;
      if (node?.parent) current = node.parent;
      continue;
    }
    const tag = /^<\s*([\w:-]+)/.exec(part)?.[1]?.toLowerCase();
    if (!tag) continue;
    // HTML tables often omit these closing tags.
    if ((tag === "tr" && current.tag === "tr") || ((tag === "td" || tag === "th") && (current.tag === "td" || current.tag === "th"))) current = current.parent ?? root;
    const attrs: Record<string, string> = {};
    const attributes = part.slice((/^<\s*[\w:-]+/.exec(part)?.[0] ?? "").length);
    for (const match of attributes.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+)))?/g)) attrs[match[1]!.toLowerCase()] = decodeRosterEntities(match[2] ?? match[3] ?? match[4] ?? "");
    const node: HtmlNode = { tag, attrs, children: [], parent: current };
    current.children.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(part)) current = node;
  }
  return root;
}

export function nodes(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const result: HtmlNode[] = [];
  const visit = (node: HtmlNode) => { if (predicate(node)) result.push(node); for (const child of node.children) if (typeof child !== "string") visit(child); };
  visit(root);
  return result;
}

export function hasClass(node: HtmlNode, value: string): boolean { return (node.attrs.class ?? "").split(/\s+/).includes(value); }
export function textOf(node: HtmlNode): string {
  const pieces = node.children.map(child => typeof child === "string" ? child : textOf(child));
  return decodeRosterEntities(pieces.join(" ")).replace(/\s+/g, " ").trim();
}
export function first(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | undefined { return nodes(root, predicate)[0]; }
export function linkUrl(node: HtmlNode, base: string): string { return new URL((node.attrs.href ?? "").trim(), base).href; }
export function ancestor(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | undefined {
  let parent = node.parent;
  while (parent) { if (predicate(parent)) return parent; parent = parent.parent; }
  return undefined;
}
