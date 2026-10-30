import type { Unlock } from "../core/capability.ts";
import { newestFirst, type WorkInput, type WorkList, type WorkRow } from "../core/work.ts";
import type { Query } from "../facts/publish.ts";
import { platformOf } from "../sources/platform-of.ts";

/** How long a place waits between free tries; a changed blank brings the next one forward. */
export const FREE_TRY_MS = 24 * 3_600_000;
const BLANKS_READ = 300, PAGES_PER_TRY = 80;

const attempt = (value: unknown): string | null => {
  try {
    const url = new URL(String((JSON.parse(String(value)) as { sourceUrl?: unknown }).sourceUrl ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
};

/**
 * The free try at a place's open blanks: no model, no paid search. It looks only at what Meanwhile already holds about the place:
 * the page a failed check read, the pages that gave its other facts, and the websites its bodies and government are known by.
 * Each becomes a link on the work list, which the page readers read with the reader of its kind of website; whatever they find
 * goes through the Slide. A place with open blanks and no page to read is a dead end that a new source unlocks.
 */
export async function freeTry(deps: { readonly facts: Query; readonly list: WorkList; readonly now: () => string }, row: WorkRow):
  Promise<{ readonly blanks: number; readonly pages: number; readonly unlock: Unlock | undefined }> {
  const place = row.subjectId!;
  const blanks = await deps.facts(`SELECT b.entity_id, b.detail FROM blank b JOIN entity_place p ON p.entity_id = b.entity_id
    WHERE p.place_id = $1 ORDER BY b.updated_at DESC LIMIT ${BLANKS_READ}`, [place]);
  if (blanks.length === 0) return { blanks: 0, pages: 0, unlock: undefined };
  const entities = [...new Set([place, ...blanks.map(blank => String(blank.entity_id))])];
  const [saved, hosts] = await Promise.all([
    deps.facts(`SELECT DISTINCT ON (c.url) c.url FROM fact f JOIN source_copy c ON c.id = f.source_copy_id
      WHERE f.entity_id = ANY($1::text[]) AND f.status = 'live' AND NOT c.is_archive ORDER BY c.url, c.fetched_at DESC LIMIT ${PAGES_PER_TRY}`, [entities]),
    deps.facts("SELECT DISTINCT host FROM entity_host WHERE entity_id = ANY($1::text[]) LIMIT 40", [entities]),
  ]);
  const pages = [...new Set([...blanks.map(blank => attempt(blank.detail)), ...saved.map(copy => String(copy.url)),
    ...hosts.map(host => `https://${host.host}/`)].filter((url): url is string => url !== null && URL.canParse(url)))].slice(0, PAGES_PER_TRY);
  const now = deps.now();
  await deps.list.ensure(pages.map((url): WorkInput => ({ kind: "lead", state: row.state, placeId: place, subjectId: place, url, value: { platform: platformOf(url) },
    priority: newestFirst(now), dueAt: now, origin: { from: "planner" }, source: { source: "Free try for open blanks" } })));
  const state = row.state === "US" ? undefined : row.state.toLowerCase();
  return { blanks: blanks.length, pages: pages.length, unlock: pages.length > 0 || state === undefined ? undefined
    : { kind: "source", state, text: "No page is known for this place; a new source for its state unlocks it" } };
}
