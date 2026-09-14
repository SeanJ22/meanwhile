import { currentBodyRosters } from "../registry/body-rosters.ts";
import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";

/**
 * **WHICH BODY IS THIS — read off the canonical registry, synchronously.**
 * (2026-08-29, the exact-body-identity session.)
 *
 * ## The defect this exists to close
 *
 * A reader asked *"What's on the Pima County Board of Supervisors agenda?"* and
 * the product answered with **"CAP University: Deeper Dive on How Water is
 * Accounted for in the Lower Basin"**, describing it as the Board's next
 * meeting. The trace said `GROUNDED_CLAUDE` — the model had stayed inside its
 * evidence pack. **The application had retrieved the wrong civic record**, and
 * the evidence pack itself was wrong, which is the worse of the two failures
 * because every downstream check was working correctly on a false input.
 *
 * The mechanism was one line. `lib/ask/inventory.ts` built the Ask body
 * inventory from `meeting.ocdId` — the DIVISION — and labelled the result
 * `nameClass: "body"`. So the Ask pipeline called a division a body, and
 * retrieval then filtered meetings by division. The Pima County division
 * carries 42 meetings: 30 belong to the Board of Supervisors and **12 belong to
 * the Central Arizona Water Conservation District**, a wholly separate
 * government whose meetings are recorded against the same geography. Selecting
 * the NEXT sitting out of that set picked a water-district event.
 *
 * This is not a Pima peculiarity. Nine divisions in the committed snapshot
 * carry more than one body, and `az/place:tucson` carries **fifteen** — Mayor &
 * Council alongside the Planning Commission, the Design Review Board, the
 * Commission on Disability Issues and eleven more. Every one of them was a
 * possible wrong answer to a question about the Tucson city council.
 *
 * `lib/sources/types.ts` had already said what the fix is, in capitals:
 * `Meeting.bodyId` is *WHICH BODY IS MEETING — the registry id, not the
 * geography.* `lib/meetings/snapshot.ts` already refuses to serve a snapshot
 * whose meetings lack it. The identity existed and was being thrown away one
 * layer above.
 *
 * ## Why this reads the registry rather than the meeting's `bodyName`
 *
 * Because `bodyName` is not the body's name. It is carried onto the body from
 * the meeting's own title, so the corpus records the Vail school board as
 * *"Governing Board Meeting"*, and it records the water district's meetings
 * under four different `bodyName` values including *"CAP University"* — the
 * name of a public-education series, not of a government.
 *
 * `lib/registry/registry.json` is the authority (RULING 197: *the registry is
 * the authority* for the body identity a serving source publishes under). All
 * 78 body ids in the committed snapshot resolve in it, and 64 carry a sourced
 * name. The rest are `DERIVED_FROM_DIVISION_TYPE` rows whose registry name is
 * legitimately null — the derivation knows the body EXISTS and may not mint
 * what it is CALLED (`lib/registry/derive.ts`, held by
 * `tests/registry-oracle.test.ts`). **Nothing here mints an identity; it reads
 * one** — and for a derived row it reads the next sourced record the
 * repository holds: `BODY_ROSTERS` (`lib/registry/body-rosters.ts`), where a
 * curated roster carries the body's own name as its own page states it, cited
 * and dated. Only a body with neither a registry name nor a roster renders its
 * division's label — the same `name ?? divisionLabel` rule `lib/routing/ask.ts`
 * and `lib/registry/coverage.ts` apply.
 *
 * That roster fallback is NH288's repair. Before it, the Pima County Board of
 * Supervisors reached every Ask surface as "Pima" — a geography standing in
 * for a government — while `BODY_ROSTERS` line 280 had held the sourced name
 * since 2026-08-13, cited to the Board's own page. The roster stays the single
 * store of that fact; this module reads it exactly as it reads the registry,
 * and `tests/body-rosters.test.ts` holds the two views to one answer.
 *
 * ## Why synchronous, and why a second reader of `registry.json` is not a
 * second registry
 *
 * `lib/registry/server.ts` reads the same file with `await readFile` behind the
 * geo resolver. The Ask grounded route needs body identity on a path that is
 * already holding the meetings snapshot in hand and is not doing geometry, so
 * it needs the index and not the resolver. This is a VIEW of the canonical
 * store, cached on the file's mtime exactly as `readSnapshot` caches the
 * snapshot — not a parallel store, and it never writes.
 *
 * `/api/ask/grounded` already traces `./lib/registry/*.json` in
 * `next.config.ts`, so the file is in the deployed bundle. That is not
 * incidental: a runtime read Next cannot see statically is absent from the
 * deploy, the read throws, and the failure renders as honest missing data —
 * indistinguishable from a government that publishes nothing.
 */

/**
 * One body, as the identity rungs need it. The `bodyId` is the identity; the
 * division is CONTEXT and may never be substituted for it.
 */
export interface CanonicalBodyIdentity {
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  /** The registry's own id. `<ocdId>#<slot>`, or a `curated:`/`wtp-body/` id. */
  bodyId: string;
  /** Reader-safe. Sourced from the registry, or the division's own label. */
  name: string;
  /** WHERE this body sits. Null for a body with no division at all. */
  ocdId: string | null;
  /** The division's type, for the binder's class tie-break. */
  divisionType: string | null;
  /** `GOVERNING`, `ADVISORY`, `COMMISSION`, ... — the registry's own value. */
  bodyClass: string | null;
  /**
   * The division's own sourced label — "Warner", "Tucson", "Pima".
   *
   * Carried separately from `name` because a caller may need to QUALIFY a body
   * whose own name identifies nothing: seven towns in this corpus each have a
   * body called exactly "Planning Board", and the division label is the only
   * sourced thing that tells them apart. See `lib/ask/inventory.ts`.
   */
  divisionLabel: string | null;
  /**
   * True when the name is the BODY'S OWN — read off the registry's sourced
   * `name`, or off the body's curated roster (`BODY_ROSTERS.bodyName`, itself
   * read from the body's own cited page). False when the name shown is the
   * division's label standing in for a derived row nothing has named yet.
   *
   * Load-bearing for reporting rather than for matching: a caller that wants to
   * say *whose* name it is showing can, and one that wants to know whether the
   * registry has read this body's own identity yet does not have to infer it
   * from the string.
   */
  nameIsBodysOwn: boolean;
}

interface RegistryBodyRow {
  id: string;
  ocdId: string | null;
  name: string | null;
  bodyClass?: string | null;
  provenance?: { sourceUrl?: string | null; collectedAt?: string | null };
}

interface RegistryDivisionRow {
  ocdId: string;
  divisionType?: string | null;
  label?: string | null;
}

interface RegistryFile {
  bodies?: RegistryBodyRow[];
  divisions?: RegistryDivisionRow[];
}

interface LoadedIndex {
  runtime: RegistryRuntimeReadModel;
  byBodyId: Map<string, CanonicalBodyIdentity>;
}

let cached: LoadedIndex | null = null;

/**
 * A parenthetical acronym is decoration on a name, not part of it.
 *
 * The registry records *"Design Review Board (DRB)"* and *"Citizens' Water
 * Advisory Committee (CWAC)"* because that is how Tucson's own board index
 * prints them. A reader types neither acronym, and the binder requires EVERY
 * distinctive token of a name to appear in the question — so leaving `(DRB)`
 * in would make the Design Review Board unbindable by anyone who did not
 * happen to type its initials.
 *
 * Stripping is mechanical and it is reversible-by-inspection: the canonical id
 * is still the identity, the registry file is untouched, and only the string a
 * human reads and types is trimmed. Conservative in the direction that matters
 * — it can only ever make a name EASIER to say, never make it name something
 * else.
 */
function withoutTrailingAcronym(name: string): string {
  return name.replace(/\s*\([A-Z][A-Za-z0-9&.\-\/ ]{0,15}\)\s*$/, "").trim();
}

/**
 * The curated roster's name for a body, or "" where no roster holds one.
 *
 * **NH288.** Twelve of the snapshot's derived-null bodies — the Pima County
 * Board of Supervisors first among them — had a sourced, cited, dated
 * `bodyName` sitting in `BODY_ROSTERS` while this index fell straight through
 * to the division label, so a reader was shown "Pima" where the repository
 * already knew "Pima County Board of Supervisors". The roster is read here as
 * a FALLBACK only: a registry row that names the body itself wins, because the
 * registry is the authority for the identity a serving source publishes under
 * (RULING 197), and the roster fills exactly the null the derivation is
 * forbidden to fill. Two sourced stores, one precedence, no second authority.
 */
function rosterBodyName(bodyId: string): string {
  const name = rosterNames().get(bodyId);
  return name ?? "";
}

function rosterNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const roster of currentBodyRosters()) {
    // First writer wins; projection validation separately forbids duplicates.
    if (!names.has(roster.bodyId)) {
      names.set(roster.bodyId, roster.bodyName);
    }
  }
  return names;
}

function buildIndex(runtime: RegistryRuntimeReadModel): Map<string, CanonicalBodyIdentity> {
  const registry = runtime.registry as RegistryFile;

  const divisions = new Map<string, RegistryDivisionRow>();
  for (const division of registry.divisions ?? []) {
    divisions.set(division.ocdId, division);
  }

  const byBodyId = new Map<string, CanonicalBodyIdentity>();

  const add = (row: RegistryBodyRow): void => {
    if (!row?.id || byBodyId.has(row.id)) return;
    const division = row.ocdId ? divisions.get(row.ocdId) ?? null : null;
    const own = row.name ? withoutTrailingAcronym(row.name) : "";
    /*
     * The roster's name for this body, consulted only where the registry row
     * holds none (NH288). Both are the body's own sourced name; the registry's
     * wins where both exist because it is the canonical store's own claim.
     */
    const roster = own ? "" : rosterBodyName(row.id);
    /*
     * The fallback order: the registry's sourced name, the roster's sourced
     * name, then the division's sourced label, then a mechanical un-slugging
     * of the id. The fourth is reached only by a body that is in no registry
     * at all, and it un-slugs the BODY half of the id — never the division
     * half, which is the substitution this whole module exists to prevent.
     */
    const name =
      own ||
      roster ||
      division?.label ||
      unslugBodySuffix(row.id) ||
      row.id;
    byBodyId.set(row.id, {
      sourceUrl: own ? row.provenance?.sourceUrl ?? null : currentBodyRosters().find((r) => r.bodyId === row.id)?.sourceUrl ?? row.provenance?.sourceUrl ?? null,
      retrievedAt: row.provenance?.collectedAt ?? null,
      bodyId: row.id,
      name,
      ocdId: row.ocdId ?? null,
      divisionType: division?.divisionType ?? null,
      bodyClass: row.bodyClass ?? null,
      divisionLabel: division?.label ?? null,
      nameIsBodysOwn: own.length > 0 || roster.length > 0,
    });
  };

  for (const row of registry.bodies ?? []) add(row);

  return byBodyId;
}

/** The `#slot` half of a body id, un-slugged. Never the division half. */
function unslugBodySuffix(bodyId: string): string {
  const at = bodyId.lastIndexOf("#");
  if (at < 0) return "";
  return bodyId
    .slice(at + 1)
    .replace(/[-_]/g, " ")
    .trim();
}

/**
 * The whole index, cached on the registry file's mtime.
 *
 * Cached because the Ask route builds an inventory on every request and the
 * file is 2,267 divisions and 1,998 bodies; keyed on mtime because a scheduled
 * regeneration commits a new one and a process that had cached the old would
 * serve a stale identity without any signal that it had.
 */
export function bodyIdentityIndex(root?: string): Map<string, CanonicalBodyIdentity> {
  if (root !== undefined) throw new Error("Tracked registry roots are test evidence only; initialize the canonical runtime projection instead.");
  const runtime = getRegistryRuntimeReadModel();
  if (cached?.runtime === runtime) return cached.byBodyId;
  const byBodyId = buildIndex(runtime);
  cached = { runtime, byBodyId };
  return byBodyId;
}

/**
 * The canonical identity of ONE body, or null where the registry holds no such
 * body.
 *
 * **Null is an answer and it is never a licence to fall back to the division.**
 * A caller that cannot identify a body has not identified a government; it has
 * failed to identify a body, and those are different facts.
 */
export function canonicalBodyIdentity(
  bodyId: string | null | undefined,
  root?: string,
): CanonicalBodyIdentity | null {
  if (!bodyId) return null;
  return bodyIdentityIndex(root).get(bodyId) ?? null;
}

/** Drop the cache. For tests and for a long-lived process that regenerates. */
export function resetBodyIdentityCache(): void {
  cached = null;
}
