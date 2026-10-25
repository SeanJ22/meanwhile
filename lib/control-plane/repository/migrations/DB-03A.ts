import { readFileSync } from "node:fs";
import type { Sql } from "../pg-store.ts";
import type { Query } from "../../../facts/publish.ts";
import { LINKING_COPY_SCHEMA, saveLinkingCopy, openLinkingCopy, linkingCopyIdentity } from "../../../facts/linking-copy.ts";
import { isOfficialSource, type OfficialLinkingPage, type OfficialLinkingPageRef } from "../../../civic-data/source-authority.ts";

export const LINKING_SEEDS = "data/reference/voting-linking-copies.json";
export function linkingPagesMigrationDefinition(): string { return LINKING_COPY_SCHEMA; }

/** A door's voting text as read, so a door written after the walk is read again under the lock. */
const READ_HASH = "md5(coalesce(value#>>'{config,votingSource}','')||chr(31)||coalesce(value#>>'{config,votingMappings}',''))";

/**
 * Save and verify every page before a single door changes. A retry reuses saved copies. The walk, the saves and the checks run
 * before cp_doors is locked (1,517 voting doors carried 393 MB of pages on Oct 25), so the runner's door writes wait only while
 * the prepared values replace the doors that did not change since they were read.
 */
export async function migrateLinkingPages(control: Sql, reader: Sql): Promise<string> {
  const query: Query = async (text, params) => await reader.query(text, params) as Record<string, unknown>[];
  await reader.query(LINKING_COPY_SCHEMA);
  const seeds = JSON.parse(readFileSync(new URL("../../../../" + LINKING_SEEDS, import.meta.url), "utf8")) as Record<string, { url: string; html: string }>;
  for (const page of Object.values(seeds)) {
    const ref = await saveLinkingCopy(page, new Date().toISOString(), query);
    if ((await openLinkingCopy(ref, query)).html !== page.html) throw Error("Saved linking-page seed differs from its source");
  }
  // Only this migration understands the retired representation.
  await control.query("CREATE TEMP TABLE IF NOT EXISTS voting_linking_moves(id text PRIMARY KEY,read_hash text NOT NULL,source text,mappings text)");
  await control.query("TRUNCATE voting_linking_moves");
  const references = new Map<number, OfficialLinkingPageRef>();
  const saved = new Map<number, string>();
  const verified = new Set<number>();
  const save = async (page: OfficialLinkingPage): Promise<OfficialLinkingPageRef> => {
    const parent = page.linkingPage ? await save(page.linkingPage) : undefined;
    const { id, key } = linkingCopyIdentity(page.url, page.html);
    if (saved.has(id) && saved.get(id) !== key) throw Error("Saved linking-page ids collide");
    if (!saved.has(id)) {
      await saveLinkingCopy({ url: page.url, html: page.html }, new Date().toISOString(), query);
      saved.set(id, key);
    }
    return { url: page.url, sourceCopyId: id, ...(parent ? { linkingPage: parent } : {}) };
  };
  const move = async (source: Record<string, unknown>) => {
    const page = source.officialLinkingPage as OfficialLinkingPage | undefined;
    const { officialLinkingPage: _retired, ...rest } = source;
    if (!page) return rest;
    const linkingPage = await save(page);
    for (let ref: OfficialLinkingPageRef | null | undefined = linkingPage; ref; ref = ref.linkingPage) references.set(ref.sourceCopyId, ref);
    // The complete original result is compared before replacement, including every authority hop.
    if (isOfficialSource(String(source.url), page) !== await isOfficialSource(String(source.url), linkingPage, undefined, ref => openLinkingCopy(ref, query)))
      throw Error(`Voting source authority changed: ${source.id}`);
    return { ...rest, linkingPage };
  };
  const prepare = async (row: { id: string; source: string; mappings: string | null; read_hash: string }) => {
    const primary = await move(JSON.parse(row.source));
    const mappings = [];
    for (const source of JSON.parse(row.mappings ?? "[]")) mappings.push(await move(source));
    await control.query(`INSERT INTO voting_linking_moves VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE
      SET read_hash=excluded.read_hash,source=excluded.source,mappings=excluded.mappings`,
      [row.id, row.read_hash, JSON.stringify(primary), row.mappings === null ? null : JSON.stringify(mappings)]);
  };
  // Includes .gov doors' pages, even though the authority fast path never opens them.
  const verify = async () => {
    for (const ref of references.values()) {
      if (verified.has(ref.sourceCopyId)) continue;
      const held = await openLinkingCopy(ref, query);
      if (linkingCopyIdentity(held.url, held.html).key !== saved.get(ref.sourceCopyId))
        throw Error("Saved linking page sha256 differs from the original page");
      verified.add(ref.sourceCopyId);
    }
  };
  type Row = { id: string; source: string; mappings: string | null; read_hash: string };
  let after = "", doors = 0;
  for (;;) {
    const rows = await control.query(`SELECT id,value#>>'{config,votingSource}' AS source,value#>>'{config,votingMappings}' AS mappings,${READ_HASH} AS read_hash
      FROM cp_doors WHERE id>$1 AND value#>>'{config,votingSource}' IS NOT NULL ORDER BY id LIMIT 100`, [after]) as Row[];
    if (!rows.length) break;
    for (const row of rows) await prepare(row);
    doors += rows.length;
    after = rows.at(-1)!.id;
  }
  await verify();
  for (let attempt = 1; ; attempt++) {
    await control.query("BEGIN");
    try {
      // A runner transaction holding a door must not leave the build queued ahead of every later door write.
      await control.query("SET LOCAL lock_timeout = '5s'");
      await control.query("LOCK TABLE cp_doors IN SHARE ROW EXCLUSIVE MODE");
      const changed = await control.query(`SELECT d.id,d.value#>>'{config,votingSource}' AS source,d.value#>>'{config,votingMappings}' AS mappings,
        md5(coalesce(d.value#>>'{config,votingSource}','')||chr(31)||coalesce(d.value#>>'{config,votingMappings}','')) AS read_hash
        FROM cp_doors d LEFT JOIN voting_linking_moves m ON m.id=d.id
        WHERE d.value#>>'{config,votingSource}' IS NOT NULL
          AND m.read_hash IS DISTINCT FROM md5(coalesce(d.value#>>'{config,votingSource}','')||chr(31)||coalesce(d.value#>>'{config,votingMappings}',''))`) as Row[];
      for (const row of changed) await prepare(row);
      await verify();
      await control.query(`UPDATE cp_doors d SET value=jsonb_set(d.value,'{config}',
        (d.value->'config')||jsonb_build_object('votingSource',m.source)||
        CASE WHEN m.mappings IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('votingMappings',m.mappings) END),
        revision=revision+1,updated_at=now() FROM voting_linking_moves m WHERE d.id=m.id
        AND md5(coalesce(d.value#>>'{config,votingSource}','')||chr(31)||coalesce(d.value#>>'{config,votingMappings}',''))=m.read_hash AND
        (d.value#>>'{config,votingSource}' IS DISTINCT FROM m.source OR d.value#>>'{config,votingMappings}' IS DISTINCT FROM m.mappings)`);
      await control.query("COMMIT");
      return `${references.size} saved linking pages; ${doors} voting doors; ${changed.length} reread under the lock; no authority changes`;
    } catch (error) {
      await control.query("ROLLBACK");
      if (attempt < 5 && /lock timeout/i.test(error instanceof Error ? error.message : String(error))) continue;
      throw error;
    }
  }
}
