import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { decodeEntities, politeGetText } from "./http.ts";

interface CalendarMove { from: string; to: string; linkedFrom: string; checkedAt: string; pageHash: string; link: string }
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const missing = (error: unknown) => /(?:HTTP[ _]|HTTP_)(?:404|410)\b/.test(String(error));

/** A moved calendar is learned from an actual link on the government's own site and kept as route data. */
export async function readCalendarRoute<T>(options: {
  url: string; read: (url: string) => Promise<T>; fetchImpl?: typeof fetch; signal?: AbortSignal; store?: EvidenceStore;
  pages?: Map<string, Promise<{ text: string }>>;
}): Promise<{ url: string; value: T }> {
  const store = options.store ?? new DurableEvidenceStore(join(process.cwd(), "data", "control-plane", "vault"));
  const key = `project/meeting-calendar-routes/${sha(options.url)}.json`;
  const held = await store.get(key);
  const move = held ? JSON.parse(new TextDecoder().decode(held.bytes)) as CalendarMove : null;
  const original = new URL(options.url);
  const current = move?.from === options.url && new URL(move.to).origin === original.origin ? move.to : options.url;
  try { return { url: current, value: await options.read(current) }; }
  catch (error) {
    if (!missing(error)) throw error;
    const home = new URL("/", original).href;
    let pending = options.pages?.get(home);
    if (!pending) {
      pending = politeGetText(home, { fetchImpl: options.fetchImpl, signal: options.signal, accept: "text/html" });
      options.pages?.set(home, pending);
    }
    let page: { text: string };
    try { page = await pending; } catch { throw error; }
    const links = [...page.text.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(match => {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
      if (!href) return [];
      let target: URL; try { target = new URL(decodeEntities(href), home); } catch { return []; }
      if (target.origin !== original.origin || target.href === current || target.href === options.url) return [];
      const label = decodeEntities(match[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
      const feed = /(?:\.ics(?:\?|$)|ical|feed=calendar)/i.test(target.href);
      const archive = /(?:agenda|minutes|archive|meetings)/i.test(`${label} ${target.pathname}`);
      if (/\.ics|ical|feed=calendar/i.test(options.url) ? !feed : !archive) return [];
      return [{ url: target.href, link: match[0], rank: Number(target.pathname.toLowerCase().startsWith(original.pathname.split("/").slice(0, 2).join("/").toLowerCase())) }];
    }).sort((a, b) => b.rank - a.rank);
    for (const link of links) {
      try {
        const value = await options.read(link.url);
        const learned: CalendarMove = { from: options.url, to: link.url, linkedFrom: home, link: link.link,
          checkedAt: new Date().toISOString(), pageHash: sha(page.text) };
        const bytes = new TextEncoder().encode(JSON.stringify(learned));
        await store.put(key, bytes, { contentType: "application/json", byteLength: bytes.length,
          contentHash: `manifest:calendar-route:${sha(options.url)}`, objectClass: "MUTABLE_INDEX" });
        return { url: link.url, value };
      } catch (next) { if (!missing(next)) throw next; }
    }
    throw error;
  }
}
