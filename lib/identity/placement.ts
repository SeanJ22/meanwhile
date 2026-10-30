import type { Query } from "../facts/publish.ts";
import { governingBoardName, governingContext, type GoverningContext } from "../civic-data/governing-board-name.ts";
import { bodyNameKey, publishedBodyLabel } from "../civic-data/published-body-name.ts";

/**
 * Where every body belongs, decided from what is already held. A body sits under the government that runs it. Plain code moves a
 * body only when held evidence proves it: an alias it already carries, a Census of Governments or NCES id in its own id, the one
 * government a place has, the one government of the kind the place is, the one government whose own site it uses, or the
 * calendar label a sitting is printed under. Everything else is a question for the placement agent.
 */

export interface PlacedBody {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly parentKind: string | null;
  readonly parentName: string | null;
  /** The body this one was already folded into, when it was. */
  readonly aliasOf: string | null;
  /** Whether this body's page has no rebuild waiting. */
  readonly ready: boolean;
  /** For a governing board: how much is filed on it, so the fullest record survives a merge. */
  readonly weight: number;
  readonly hosts: readonly string[];
}

export interface PlacedGovernment {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** Census of Governments and NCES ids. */
  readonly ids: readonly string[];
  readonly hosts: readonly string[];
}

export type PlacementBasis = "ALIAS" | "SITTING" | "TWIN" | "CENSUS_ID" | "ONLY_GOVERNMENT" | "GOVERNMENT_KIND" | "OWN_SITE";
export interface PlacementQuestion {
  /** OWNER: which government runs this body. BODY: which body is this one. */
  readonly kind: "OWNER" | "BODY";
  readonly subject: string;
  readonly candidates: readonly string[];
}
/** What the placement agent settled: a quoted line of the government's own page, or a tie. */
export type PlacementDecision =
  | { readonly action: "MOVE" | "MERGE" | "KEEP"; readonly subject: string; readonly target?: string; readonly url: string; readonly quote: string }
  | { readonly action: "TIE"; readonly subject: string; readonly why: string };
export interface PlacementPlan {
  /** `retire`: the loser's own record and page go too. A body folded now keeps its page until the body that took it over is rebuilt. */
  readonly merges: readonly { readonly loser: string; readonly survivor: string; readonly basis: PlacementBasis; readonly retire: boolean; readonly name?: string }[];
  readonly parents: readonly { readonly body: string; readonly government: string; readonly basis: PlacementBasis }[];
  readonly questions: readonly PlacementQuestion[];
}

const STATE_ROOT = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/;
const GOVERNING_SLOT = /#(?:governing|board)$/;
/** The kind of government that runs a place of each kind. */
const GOVERNMENT_OF_PLACE: readonly (readonly [place: RegExp, government: RegExp])[] = [
  [/\/county:[^/]+$/, /^[a-z]{2}:county:/], [/\/place:[^/]+$/, /^[a-z]{2}:city:/],
  [/\/school_district:[^/]+$/, /^[a-z]{2}:(?:school|depschool):/], [/\/special_district:[^/]+$/, /^[a-z]{2}:special:/]];
const rootOf = (id: string): string => id.split("#")[0]!;
/** A body id that carries its government's Census of Governments or NCES id. */
const CENSUS_ROOT = /^(?:government:US-[A-Z]{2}:(?:cog|nces):(\d+)$|wtp-body\/country:us\/state:[a-z]{2}\/census:(\d+)\/)/;
const censusIdOf = (id: string): string | undefined => { const found = CENSUS_ROOT.exec(rootOf(id)); return found ? found[1] ?? found[2] : undefined; };

/** The government that owns a body that hangs on a place or on nothing, with the evidence, or the governments it could be. */
function ownerOf(body: PlacedBody, state: ReadonlyMap<string, PlacedGovernment[]>, governments: readonly PlacedGovernment[],
  uniqueHost: ReadonlyMap<string, string>): { readonly government: string; readonly basis: PlacementBasis } | readonly string[] | null {
  const census = censusIdOf(body.id);
  if (census) {
    const found = governments.filter(g => g.ids.includes(census));
    if (found.length === 1) return { government: found[0]!.id, basis: "CENSUS_ID" };
  }
  const place = body.parentId ?? rootOf(body.id);
  if (STATE_ROOT.test(place)) return null;
  const here = state.get(place) ?? [];
  if (here.length === 1) return { government: here[0]!.id, basis: "ONLY_GOVERNMENT" };
  const kind = GOVERNMENT_OF_PLACE.find(([pattern]) => pattern.test(place))?.[1];
  const ofKind = kind ? here.filter(g => kind.test(g.id)) : [];
  if (ofKind.length === 1) return { government: ofKind[0]!.id, basis: "GOVERNMENT_KIND" };
  const ownSite = new Set(body.hosts.flatMap(host => here.filter(g => uniqueHost.get(host) === g.id).map(g => g.id)));
  if (ownSite.size === 1) return { government: [...ownSite][0]!, basis: "OWN_SITE" };
  return here.length > 1 ? here.map(g => g.id) : null;
}

/** A governing board filed under the government's own id, its Census place, or its Census of Governments id is that government's board. */
function isOwnBoard(body: PlacedBody, government: PlacedGovernment): boolean {
  const root = rootOf(body.id), census = censusIdOf(body.id);
  return root === government.id || root === government.parentId || census !== undefined && government.ids.includes(census);
}

/** The sitting's own body: a sibling whose name it contains, else the government's governing board when the label names no other body. */
function sittingTarget(body: PlacedBody, siblings: readonly PlacedBody[], context: GoverningContext): PlacedBody | undefined {
  const label = publishedBodyLabel(body.name), key = ` ${bodyNameKey(body.name)} `;
  const real = siblings.filter(other => other.id !== body.id && publishedBodyLabel(other.name).kind === "body");
  const matched = real.map(other => ({ other, at: key.indexOf(` ${bodyNameKey(other.name)} `) })).filter(row => row.at >= 0)
    .sort((a, b) => a.at - b.at || b.other.name.length - a.other.name.length)[0]?.other;
  const governing = real.find(other => GOVERNING_SLOT.test(other.id));
  return matched ?? (!label.name || governingBoardName(label.name, context) !== null ? governing : undefined);
}

/** Every move plain code can prove, and every question it cannot settle. A pure reading of one state's rows. */
export function planPlacements(bodies: readonly PlacedBody[], governments: readonly PlacedGovernment[]): PlacementPlan {
  const merges: { loser: string; survivor: string; basis: PlacementBasis; retire: boolean; name?: string }[] = [], parents: { body: string; government: string; basis: PlacementBasis }[] = [], questions: PlacementQuestion[] = [];
  const aliases = new Map(bodies.flatMap(body => body.aliasOf ? [[body.id, body.aliasOf] as const] : []));
  const survivorOf = (id: string): string => { let at = id; for (let hops = 0; aliases.has(at) && hops < 8; hops += 1) at = aliases.get(at)!; return at; };
  const held = new Map(bodies.map(body => [body.id, body]));
  for (const body of bodies) if (body.aliasOf) {
    const survivor = survivorOf(body.aliasOf);
    // A government's governing board folded into some other body is a wrong fold until the agent says otherwise.
    if (GOVERNING_SLOT.test(body.id) && !GOVERNING_SLOT.test(survivor)) questions.push({ kind: "BODY", subject: body.id, candidates: [survivor, ...bodies.filter(other => other.parentId === body.parentId && other.id !== body.id && GOVERNING_SLOT.test(other.id)).map(other => other.id)] });
    else merges.push({ loser: body.id, survivor, basis: "ALIAS", retire: held.get(survivor)?.ready ?? true });
  }
  const live = bodies.filter(body => !aliases.has(body.id)), government = new Map(governments.map(g => [g.id, g]));
  const byPlace = new Map<string, PlacedGovernment[]>();
  for (const g of governments) if (g.parentId) byPlace.set(g.parentId, [...byPlace.get(g.parentId) ?? [], g]);
  const hostCounts = new Map<string, string[]>();
  for (const g of governments) for (const host of g.hosts) hostCounts.set(host, [...hostCounts.get(host) ?? [], g.id]);
  const uniqueHost = new Map([...hostCounts].flatMap(([host, ids]) => ids.length === 1 ? [[host, ids[0]!] as const] : []));
  const parentOf = new Map(live.map(body => [body.id, body.parentId] as const));
  for (const body of live) {
    if (body.parentKind === "government") continue;
    const owner = ownerOf(body, byPlace, governments, uniqueHost);
    if (owner === null) continue;
    if ("government" in owner) { parents.push({ body: body.id, ...owner }); parentOf.set(body.id, owner.government); }
    else questions.push({ kind: "OWNER", subject: body.id, candidates: owner });
  }
  const siblingsOf = (body: PlacedBody) => live.filter(other => parentOf.get(other.id) === parentOf.get(body.id) || rootOf(other.id) === rootOf(body.id));
  const folded = new Set<string>();
  for (const body of live) {
    if (publishedBodyLabel(body.name).kind === "body") continue;
    const owner = parentOf.get(body.id) ?? rootOf(body.id);
    const target = sittingTarget(body, siblingsOf(body), governingContext(owner, government.get(owner)?.name ?? body.parentName));
    if (target) { merges.push({ loser: body.id, survivor: target.id, basis: "SITTING", retire: false }); folded.add(body.id); }
    else if (!GOVERNING_SLOT.test(body.id)) questions.push({ kind: "BODY", subject: body.id, candidates: siblingsOf(body).map(other => other.id).slice(0, 8) });
  }
  const boards = new Map<string, PlacedBody[]>();
  for (const body of live) {
    const owner = parentOf.get(body.id);
    if (GOVERNING_SLOT.test(body.id) && !folded.has(body.id) && owner && government.has(owner)) boards.set(owner, [...boards.get(owner) ?? [], body]);
  }
  for (const [owner, held] of boards) {
    const g = government.get(owner)!, own = held.filter(body => isOwnBoard(body, g));
    const survivor = own.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id))[0];
    const context = governingContext(g.id, g.name), fits = (body: PlacedBody) => governingBoardName(body.name, context) !== null;
    // A record named for another body (a transit authority) takes the name of its twin that is named for this government's board.
    const name = survivor && !fits(survivor) ? own.find(fits)?.name : undefined;
    for (const body of own.slice(1)) merges.push({ loser: body.id, survivor: survivor!.id, basis: "TWIN", retire: survivor!.ready, ...name ? { name } : {} });
    const left = held.filter(body => !own.includes(body) || body === survivor);
    if (left.length > 1) questions.push({ kind: "BODY", subject: left[0]!.id, candidates: left.map(body => body.id) });
  }
  return { merges, parents, questions };
}

/** One state's bodies and governments, and the one thing each body is parked on. */
export async function readPlacementRows(query: Query, state: string): Promise<{ readonly bodies: readonly PlacedBody[]; readonly governments: readonly PlacedGovernment[] }> {
  const bodies = await query(`SELECT b.id,b.name,b.parent_id,p.kind AS parent_kind,p.name AS parent_name,a.entity_id AS alias_of,
      NOT EXISTS (SELECT 1 FROM rebuild_queue q WHERE q.place_id=b.id AND (q.built_generation IS NULL OR q.generation>q.built_generation)) AS ready,
      CASE WHEN b.id LIKE '%#governing' OR b.id LIKE '%#board' THEN (SELECT count(*) FROM fact f WHERE f.entity_id=b.id) + (SELECT count(*) FROM entity c WHERE c.parent_id=b.id)
        + (SELECT count(*) FROM entity_external_id x WHERE x.entity_id=b.id) ELSE 0 END AS weight,
      coalesce((SELECT array_agg(h.host) FROM entity_host h WHERE h.entity_id=b.id),'{}') AS hosts
    FROM entity b LEFT JOIN entity p ON p.id=b.parent_id
    LEFT JOIN entity_external_id a ON a.scheme='body-alias' AND a.value=b.id AND a.entity_id<>b.id AND EXISTS (SELECT 1 FROM entity s WHERE s.id=a.entity_id AND s.kind='body')
    WHERE b.kind='body' AND b.state=$1 ORDER BY b.id`, [state]);
  const governments = await query(`SELECT g.id,g.name,g.parent_id,
      coalesce((SELECT array_agg(x.value) FROM entity_external_id x WHERE x.entity_id=g.id AND x.scheme IN ('census-pid6','nces')),'{}') AS ids,
      coalesce((SELECT array_agg(h.host) FROM entity_host h WHERE h.entity_id=g.id),'{}') AS hosts
    FROM entity g WHERE g.kind='government' AND g.state=$1 ORDER BY g.id`, [state]);
  const text = (value: unknown) => value === null || value === undefined ? null : String(value);
  return { bodies: bodies.map(row => ({ id: String(row.id), name: String(row.name), parentId: text(row.parent_id), parentKind: text(row.parent_kind),
      parentName: text(row.parent_name), aliasOf: text(row.alias_of), ready: row.ready === true, weight: Number(row.weight), hosts: row.hosts as string[] })),
    governments: governments.map(row => ({ id: String(row.id), name: String(row.name), parentId: text(row.parent_id), ids: row.ids as string[], hosts: row.hosts as string[] })) };
}
