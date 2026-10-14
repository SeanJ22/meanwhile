import { decodeEntities } from "../http.ts";

const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? "");

export interface ArchivedSitting {
  id: string;
  categoryId: string;
  date: string;
  agendaHref: string | null;
  title: string;
  links: { label: string; href: string }[];
  hour: number | null;
  minute: number | null;
  location: string;
  agendaSlotObservedEmpty: boolean;
  evidence: string;
}

function categoryBlocks(html: string): { id: string; name: string; html: string }[] {
  const blocks: { id: string; name: string; html: string }[] = [];
  for (const match of html.matchAll(/<div\b[^>]*\bid\s*=\s*["']cat(\d+)["'][^>]*>/gi)) {
    const start = match.index! + match[0].length;
    let depth = 1, end = html.length;
    for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) { end = start + tag.index!; break; }
    }
    const block = html.slice(start, end);
    const heading = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(block)?.[1] ?? "";
    blocks.push({ id: match[1], name: plain(heading).replace(/^[▼▶\s]+/, ""), html: block });
  }
  return blocks;
}

export function parseAgendaCenterCategories(html: string): { id: string; name: string }[] {
  return categoryBlocks(html).map(({ id, name }) => ({ id, name }));
}

export function agendaCenterRssUrl(pageUrl: string): string {
  return new URL("/RSSFeed.aspx?CID=All-0&ModID=65", pageUrl).href;
}

export function parseAgendaCenterUpdates(xml: string): { id: string; postedAt: string; href: string }[] {
  const updates = new Map<string, { id: string; postedAt: string; href: string }>();
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const field = (name: string) => decodeEntities(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(item[1])?.[1] ?? "")
      .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim();
    const href = field("link"), id = /\/AgendaCenter\/PreviousVersions\/(\d+)(?:\/|$)/i.exec(href)?.[1];
    const posted = Date.parse(field("pubDate"));
    if (!id || !Number.isFinite(posted)) continue;
    const update = { id, postedAt: new Date(posted).toISOString(), href };
    if (!updates.has(id) || updates.get(id)!.postedAt < update.postedAt) updates.set(id, update);
  }
  return [...updates.values()];
}

export function parseAgendaCenter(html: string, categoryId: string): ArchivedSitting[] {
  const block = categoryBlocks(html).find(category => category.id === categoryId);
  if (!block) return [];
  const rows: ArchivedSitting[] = [];
  for (const match of block.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const token = /(?:ViewFile\/(?:Agenda|Minutes)\/|\bid=["']h\d+)_?(\d{2})(\d{2})(\d{4})-(\d+)/i.exec(row);
    if (!token) continue;
    const date = `${token[3]}-${token[1]}-${token[2]}`;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) continue;
    const links = new Map<string, { label: string; href: string }>();
    let agendaHref: string | null = null, title = "";
    for (const anchor of row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(anchor[1], "href");
      if (!href || /^(?:javascript:|#)/i.test(href)) continue;
      const label = plain(anchor[2]) || attr(anchor[1], "aria-label") || attr(anchor[2], "alt");
      const agenda = /\/ViewFile\/Agenda\//i.test(href);
      if (agenda && !agendaHref) { agendaHref = href; title = plain(anchor[2]); }
      links.set(href, { label: /\/ViewFile\/Minutes\//i.test(href) ? "Minutes" : label || "Document", href });
    }
    const description = [...row.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match => plain(match[1])).join(" ");
    title = title && !/^agenda$/i.test(title) ? title : description || block.name;
    const clock = /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(title);
    const validClock = clock && +clock[1] >= 1 && +clock[1] <= 12 && +clock[2] < 60;
    const location = /\b(?:Location|Venue):\s*([^<\r\n]+)/i.exec(description)?.[1]?.trim() ?? "";
    rows.push({ id: token[4], categoryId, date, agendaHref, title, links: [...links.values()],
      hour: validClock ? +clock[1] % 12 + (/^p/i.test(clock[3]) ? 12 : 0) : null,
      minute: validClock ? +clock[2] : null, location,
      agendaSlotObservedEmpty: agendaHref === null && /<td\b/i.test(row), evidence: plain(row),
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function agendaCenterPages(html: string, pageUrl: string, categoryIds?: string): string[] {
  const origin = new URL(pageUrl).origin;
  const urls = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const href = attr(match[1], "href");
    if (!href || /^(?:javascript:|#)/i.test(href)) continue;
    const url = new URL(href, pageUrl);
    if (url.origin === origin && /^\/AgendaCenter\/(?:Search|\d+)(?:\/|$)/i.test(url.pathname)) urls.add(url.href);
  }
  // The publisher's year selector lists real archive years; the public search reads that category and year.
  for (const block of categoryBlocks(html).filter(block => categoryIds?.split(",").map(id => id.trim()).includes(block.id))) {
    const current = /<li\b[^>]*class=["']?current["']?[^>]*>[\s\S]*?changeYear\((\d{4})/i.exec(block.html)?.[1];
    for (const match of block.html.matchAll(/changeYear\((\d{4}),\s*(\d+)/gi)) {
      if (match[1] === current || match[2] !== block.id) continue;
      const url = new URL("/AgendaCenter/Search/", pageUrl);
      url.searchParams.set("CIDs", block.id);
      url.searchParams.set("startDate", `01/01/${match[1]}`);
      url.searchParams.set("endDate", `12/31/${match[1]}`);
      urls.add(url.href);
    }
  }
  return [...urls];
}
