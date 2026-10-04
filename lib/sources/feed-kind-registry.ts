/**
 * DB-50: the registry of installed feed kinds, and the declaration they make.
 *
 * Kept free of imports that load adapters or wiring, because `lib/registry/source-wiring.ts` asks it which source
 * serves a door of an installed kind and must not pull the whole source tree into its own load.
 */

import type { MeetingLocation } from "./types.ts";

export interface FeedDoor {
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly timeZone: string;
  readonly jurisdiction: string;
  readonly publishingOrg: string;
  /** Only the settings the kind declared in `configKeys`. */
  readonly config: Readonly<Record<string, string>>;
}

export interface FeedContext {
  /** One polite, identified GET that honors Retry-After and the pacing rules. Never call `fetch` directly. */
  readonly getText: (url: string, accept?: string) => Promise<{ readonly status: number; readonly text: string }>;
  readonly signal?: AbortSignal;
}

export interface FeedSitting {
  /** Stable for this sitting within the door. */
  readonly id: string;
  readonly title: string;
  /** ISO 8601 with a UTC offset (`2026-10-14T18:00:00-07:00`), or a local wall clock `YYYY-MM-DDTHH:mm` in the door's zone. */
  readonly startsAt: string;
  readonly bodyName?: string;
  /** A place with coordinates the kind can stand behind. */
  readonly location?: MeetingLocation | null;
  /** The place as the publisher worded it, when there are no coordinates: kept as words, with the gap named. */
  readonly statedPlace?: string | null;
  readonly agendaUrl?: string | null;
  /** The page the sitting was read from, which readers can follow. */
  readonly sourceUrl: string;
  readonly cancelled?: boolean;
}

export interface FeedKindDeclaration {
  readonly kind: string;
  readonly configKeys: readonly string[];
  read(door: FeedDoor, context: FeedContext): Promise<readonly FeedSitting[]>;
}

const KIND = /^[a-z][a-z0-9-]{2,40}$/;
const CONFIG_KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/** What is wrong with a declaration, or null when it can be installed. */
export function feedKindProblem(value: unknown, taken: ReadonlySet<string> = new Set()): string | null {
  if (typeof value !== "object" || value === null) return "the feed kind is not an object";
  const d = value as Partial<FeedKindDeclaration>;
  if (typeof d.kind !== "string" || !KIND.test(d.kind)) return "the kind must be 3 to 41 lower-case letters, digits or hyphens, starting with a letter";
  if (taken.has(d.kind)) return `the kind ${d.kind} is already taken`;
  if (!Array.isArray(d.configKeys) || d.configKeys.some((k) => typeof k !== "string" || !CONFIG_KEY.test(k))) return "configKeys must be a list of setting names";
  if (new Set(d.configKeys).size !== d.configKeys.length) return "configKeys names a setting twice";
  if (typeof d.read !== "function") return "the kind has no read(door, context)";
  return null;
}

let installed: readonly FeedKindDeclaration[] = [];
/** The kinds installed for this pass. The names of the built-in adapters are never available to a feed kind. */
export function installFeedKinds(kinds: readonly FeedKindDeclaration[], builtIn: ReadonlySet<string>): { readonly installed: readonly string[]; readonly refused: readonly string[] } {
  const taken = new Set(builtIn);
  const accepted: FeedKindDeclaration[] = [];
  const refused: string[] = [];
  for (const kind of kinds) {
    const problem = feedKindProblem(kind, taken);
    if (problem !== null) {
      refused.push(`${(kind as { kind?: unknown })?.kind ?? "?"}: ${problem}`);
      continue;
    }
    taken.add(kind.kind);
    accepted.push(kind);
  }
  installed = accepted;
  return { installed: accepted.map((k) => k.kind), refused };
}

export function installedFeedKinds(): readonly FeedKindDeclaration[] {
  return installed;
}

/** The wiring type a door of this kind carries (the kind's name in capitals), and back. */
export const feedKindWiringType = (kind: string): string => kind.toUpperCase().replace(/-/g, "_");
export function feedKindForWiringType(type: string): FeedKindDeclaration | null {
  return installed.find((k) => feedKindWiringType(k.kind) === type) ?? null;
}

