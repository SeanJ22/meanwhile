import { isOfficialSource, type OfficialLinkingPage } from "./source-authority.ts";

type SavedOfficialPage = { readonly canonicalUrl: string; readonly text: string };
/** Captures are immutable; retain this append-only array between lookups. */
export type LazyOfficialPage = { readonly canonicalUrl: string; readonly readText: () => Promise<string> };
type IndexedOfficialPage = {
  readonly canonicalUrl: string;
  readonly links: ReadonlySet<string>;
  readonly text?: string;
  readonly readText?: () => Promise<string>;
};
type LinkingNode = {
  readonly page: IndexedOfficialPage;
  source: IndexedOfficialPage;
  readonly position: number;
  readonly host: string | null;
  readonly links: ReadonlySet<string>;
  pass: number;
  parent?: LinkingNode;
};

/** The source-authority host rules, including relative links and www aliases. */
function linkingHost(url: string, base?: string): string | null {
  const absolute = /^(https?):\/\/([^/?#\s]+)/i.exec(url.trim());
  if (absolute) {
    const host = absolute[2].replace(/^[^@]*@/, "").replace(/:\d*$/, "").toLowerCase();
    return /^[a-z0-9.-]+$/.test(host) ? host.replace(/^www\./, "") : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url.trim())) return null;
  if (url.trim().startsWith("//")) return linkingHost(`https:${url.trim()}`);
  return base === undefined ? null : linkingHost(base);
}

function linkingBefore(a: LinkingNode, b: LinkingNode): boolean {
  return a.pass < b.pass || (a.pass === b.pass && a.position < b.position);
}

function savedLinkHosts(page: SavedOfficialPage): ReadonlySet<string> {
  const links = new Set<string>();
  for (const match of page.text.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const host = linkingHost((match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, "&"), page.canonicalUrl);
    if (host !== null) links.add(host);
  }
  return links;
}

/** Saved links are parsed once; the queue follows capture order. */
class OfficialLinkingIndex {
  private readonly nodes: LinkingNode[] = [];
  private readonly urls = new Set<string>();
  private readonly parents = new Map<string, LinkingNode>();
  private readonly waiting = new Map<string, LinkingNode[]>();
  private readonly chosen = new Map<string, LinkingNode>();
  private readonly queue: { node: LinkingNode; pass: number }[] = [];
  private hasRepeatedUrls = false;

  private enqueue(node: LinkingNode): void {
    if (node.host === null || node.pass === -1) return;
    const parent = this.parents.get(node.host);
    if (!parent) return;
    const pass = parent.pass === -1 ? 0 : parent.pass + Number(node.position <= parent.position);
    if (pass > node.pass) return;
    node.parent = parent;
    if (pass === node.pass) return;
    node.pass = pass;
    const entry = { node, pass };
    let i = this.queue.length;
    this.queue.push(entry);
    while (i > 0) {
      const p = (i - 1) >> 1;
      const previous = this.queue[p];
      if (previous.pass < pass || (previous.pass === pass && previous.node.position <= node.position)) break;
      this.queue[i] = previous;
      i = p;
    }
    this.queue[i] = entry;
  }

  private endorse(node: LinkingNode): void {
    for (const host of node.links) {
      const previous = this.parents.get(host);
      if (previous && previous !== node && !linkingBefore(node, previous)) continue;
      this.parents.set(host, node);
      for (const child of this.waiting.get(host) ?? []) this.enqueue(child);
    }
  }

  private drain(): void {
    while (this.queue.length) {
      const first = this.queue[0];
      const last = this.queue.pop()!;
      if (this.queue.length) {
        let i = 0;
        while (2 * i + 1 < this.queue.length) {
          let child = 2 * i + 1;
          const right = child + 1;
          const earlier = (a: typeof last, b: typeof last) => a.pass < b.pass || (a.pass === b.pass && a.node.position < b.node.position);
          if (right < this.queue.length && earlier(this.queue[right], this.queue[child])) child = right;
          if (!earlier(this.queue[child], last)) break;
          this.queue[i] = this.queue[child];
          i = child;
        }
        this.queue[i] = last;
      }
      const { node, pass } = first;
      if (pass !== node.pass) continue;
      const previous = this.chosen.get(node.page.canonicalUrl);
      if (previous && previous !== node) continue;
      this.chosen.set(node.page.canonicalUrl, node);
      this.endorse(node);
    }
  }

  extend(pages: readonly IndexedOfficialPage[]): void {
    const appended: LinkingNode[] = [];
    for (let i = this.nodes.length; i < pages.length; i++) {
      const page = pages[i];
      this.hasRepeatedUrls ||= this.urls.has(page.canonicalUrl);
      this.urls.add(page.canonicalUrl);
      const node: LinkingNode = { page, source: page, position: i, host: linkingHost(page.canonicalUrl), links: page.links,
        pass: Infinity };
      this.nodes.push(node);
      appended.push(node);
    }
    if (!appended.length) return;
    const duplicate = this.hasRepeatedUrls;
    // A repeated URL can replace a root's saved HTML. Replay cached edges in
    // that case, preserving Map's first position / last root value semantics.
    if (duplicate) {
      this.parents.clear(); this.waiting.clear(); this.chosen.clear(); this.queue.length = 0;
      for (const node of this.nodes) { node.pass = Infinity; node.parent = undefined; node.source = node.page; (node as { links: ReadonlySet<string> }).links = node.page.links; }
    }
    const added = duplicate ? this.nodes : appended;
    for (const node of added) {
      if (node.host !== null) {
        const waiting = this.waiting.get(node.host) ?? [];
        waiting.push(node); this.waiting.set(node.host, waiting);
      }
    }
    const roots = new Map<string, LinkingNode>();
    for (const node of added) if (node.host !== null && /(^|\.)gov$/.test(node.host)) {
      const previous = roots.get(node.page.canonicalUrl);
      // Repeated root captures replace HTML without changing lookup order.
      if (previous) { previous.source = node.page; (previous as { links: ReadonlySet<string> }).links = node.links; }
      else roots.set(node.page.canonicalUrl, node);
    }
    for (const root of roots.values()) { root.pass = -1; this.chosen.set(root.page.canonicalUrl, root); }
    for (const root of roots.values()) this.endorse(root);
    for (const node of added) this.enqueue(node);
    this.drain();
  }

  sourcesFor(url: string): IndexedOfficialPage[] {
    const host = linkingHost(url);
    const sources: IndexedOfficialPage[] = [];
    let node = host === null || /(^|\.)gov$/.test(host) ? undefined : this.parents.get(host);
    while (node) { sources.push(node.source); node = node.parent; }
    return sources;
  }
}

type LinkingState = { index: OfficialLinkingIndex; pages: IndexedOfficialPage[] };
const officialLinkingIndexes = new WeakMap<readonly SavedOfficialPage[], LinkingState>();
const lazyOfficialLinkingIndexes = new WeakMap<readonly LazyOfficialPage[], LinkingState & {
  pending: Promise<void>;
  ingested: Map<number, IndexedOfficialPage>;
}>();

function chainFromSources(sources: readonly IndexedOfficialPage[], texts: readonly string[]): OfficialLinkingPage | null {
  let chain: OfficialLinkingPage | null = null;
  for (let i = sources.length - 1; i >= 0; i--) {
    chain = { url: sources[i].canonicalUrl, html: texts[i], ...(chain ? { linkingPage: chain } : {}) };
  }
  return chain;
}

/** One index per append-only saved page set, shared by every caller. */
export function officialLinkingPageFrom(url: string, pages: readonly SavedOfficialPage[]): OfficialLinkingPage | null {
  if (isOfficialSource(url)) return null;
  let state = officialLinkingIndexes.get(pages);
  if (!state) { state = { index: new OfficialLinkingIndex(), pages: [] }; officialLinkingIndexes.set(pages, state); }
  for (let i = state.pages.length; i < pages.length; i++) state.pages.push({ ...pages[i], links: savedLinkHosts(pages[i]) });
  state.index.extend(state.pages);
  const sources = state.index.sourcesFor(url);
  return chainFromSources(sources, sources.map(page => page.text!));
}

// Index links without retaining HTML; reload only the selected chain.
// Concurrent readers share ingestion, and failed captures remain retryable.
export async function officialLinkingPageFromAsync(url: string, pages: readonly LazyOfficialPage[]): Promise<OfficialLinkingPage | null> {
  if (isOfficialSource(url)) return null;
  let state = lazyOfficialLinkingIndexes.get(pages);
  if (!state) {
    state = { index: new OfficialLinkingIndex(), pages: [], pending: Promise.resolve(), ingested: new Map() };
    lazyOfficialLinkingIndexes.set(pages, state);
  }
  const saved = state;
  const pending = saved.pending.catch(() => {}).then(async () => {
    while (saved.pages.length < pages.length) {
      const start = saved.pages.length;
      const end = Math.min(start + 16, pages.length);
      const results = await Promise.allSettled(Array.from({ length: end - start }, async (_, offset) => {
        const i = start + offset;
        if (saved.ingested.has(i)) return;
        const page = pages[i];
        const text = await page.readText();
        saved.ingested.set(i, { canonicalUrl: page.canonicalUrl, readText: page.readText, links: savedLinkHosts({ canonicalUrl: page.canonicalUrl, text }) });
      }));
      // Keep successful decodes even when a neighboring read failed, without
      // changing the source order or retaining the decoded bodies.
      while (saved.ingested.has(saved.pages.length)) {
        const i = saved.pages.length;
        saved.pages.push(saved.ingested.get(i)!);
        saved.ingested.delete(i);
      }
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
    saved.index.extend(saved.pages);
  });
  saved.pending = pending;
  await pending;
  const sources = saved.index.sourcesFor(url);
  const texts: string[] = [];
  for (const page of sources) texts.push(await page.readText!());
  return chainFromSources(sources, texts);
}
