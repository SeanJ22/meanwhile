import { REGISTRY_STATES } from "../civic-data/state-scopes.ts";
import type { BoxLink, BoxRepository } from "../control-plane/box.ts";
import { newestFirst, type WorkInput, type WorkList } from "../core/work.ts";
import { splitSubject } from "../facts/entities.ts";
import { platformOf } from "./platform-of.ts";

/** Links hunters found wait in the Box for a short hop only: each is moved to the work list as a link to read. Small rows cross; no finding is opened. */
export const BOX_LINKS_PER_TURN = 500;

const stateOf = (id: string): string => {
  const found = (/^([a-z]{2}):/.exec(id)?.[1] ?? /\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? /^government:US-([A-Z]{2}):/.exec(id)?.[1])?.toUpperCase();
  return found && (REGISTRY_STATES as readonly string[]).includes(found) ? found : "US";
};

const leadOf = (link: BoxLink): WorkInput | null => {
  if (!/^https?:\/\//i.test(link.url) || !URL.canParse(link.url)) return null;
  const placeId = link.governmentId ?? splitSubject(link.subjectId).root;
  return { kind: "lead", state: stateOf(placeId), placeId, subjectId: link.subjectId, url: link.url, value: { platform: platformOf(link.url) }, priority: newestFirst(link.foundAt),
    dueAt: link.foundAt, origin: { from: "loader" }, source: { source: "Found by a hunter", foundOn: link.foundOn, boxId: link.id } };
};

/** One turn of the move: returns how many findings left the Box. A finding that names no address leaves too, since nothing can read it. */
export async function moveBoxLinks(input: { readonly box: BoxRepository; readonly list: WorkList; readonly now: () => Date; readonly limit?: number }): Promise<number> {
  const links = await input.box.waitingLinks(input.limit ?? BOX_LINKS_PER_TURN);
  if (!links.length) return 0;
  await input.list.ensure(links.flatMap(link => leadOf(link) ?? []));
  return input.box.moved(links.map(link => link.id), input.now().toISOString());
}
