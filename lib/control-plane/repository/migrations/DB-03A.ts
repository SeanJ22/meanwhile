import { readFileSync } from "node:fs";
import type { Sql } from "../pg-store.ts";
import type { Query } from "../../../facts/publish.ts";
import { LINKING_COPY_SCHEMA, saveLinkingCopy, openLinkingCopy, linkingCopyIdentity } from "../../../facts/linking-copy.ts";
import { isOfficialSource, type OfficialLinkingPage, type OfficialLinkingPageRef } from "../../../civic-data/source-authority.ts";

export const LINKING_SEEDS = "data/reference/voting-linking-copies.json";
export function linkingPagesMigrationDefinition(): string { return LINKING_COPY_SCHEMA; }

/** Save and verify every page before a single door changes. A retry reuses saved copies. */
export async function migrateLinkingPages(control: Sql, reader: Sql): Promise<string> {
  const query: Query = async (text, params) => await reader.query(text, params) as Record<string, unknown>[];
  await reader.query(LINKING_COPY_SCHEMA);
  const seeds = JSON.parse(readFileSync(new URL("../../../../" + LINKING_SEEDS, import.meta.url), "utf8")) as Record<string, { url: string; html: string }>;
  for (const page of Object.values(seeds)) {
    const ref = await saveLinkingCopy(page, new Date().toISOString(), query);
    if ((await openLinkingCopy(ref, query)).html !== page.html) throw Error("Saved linking-page seed differs from its source");
  }
  await control.query("BEGIN");
  try {
    await control.query("LOCK TABLE cp_doors IN SHARE ROW EXCLUSIVE MODE");
    // Only this migration understands the retired representation.
    await control.query("CREATE TEMP TABLE voting_linking_moves(id text PRIMARY KEY,source text,mappings text) ON COMMIT DROP");
    const references = new Map<number, OfficialLinkingPageRef>();
    const saved = new Map<number, string>();
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
    let after = "", doors = 0;
    for (;;) {
      const [row] = await control.query(`SELECT id,value#>>'{config,votingSource}' AS source,value#>>'{config,votingMappings}' AS mappings
        FROM cp_doors WHERE id>$1 AND value#>>'{config,votingSource}' IS NOT NULL ORDER BY id LIMIT 1`, [after]) as { id: string; source: string; mappings: string | null }[];
      if (!row) break;
      after = row.id; doors++;
      const primary = await move(JSON.parse(row.source));
      const mappings = [];
      for (const source of JSON.parse(row.mappings ?? "[]")) mappings.push(await move(source));
      await control.query("INSERT INTO voting_linking_moves VALUES($1,$2,$3)", [row.id, JSON.stringify(primary), row.mappings === null ? null : JSON.stringify(mappings)]);
    }
    // Includes .gov doors' pages, even though the authority fast path never opens them.
    for (const ref of references.values()) {
      const held = await openLinkingCopy(ref, query);
      if (linkingCopyIdentity(held.url, held.html).key !== saved.get(ref.sourceCopyId))
        throw Error("Saved linking page sha256 differs from the original page");
    }
    await control.query(`UPDATE cp_doors d SET value=jsonb_set(d.value,'{config}',
      (d.value->'config')||jsonb_build_object('votingSource',m.source)||
      CASE WHEN m.mappings IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('votingMappings',m.mappings) END),
      revision=revision+1,updated_at=now() FROM voting_linking_moves m WHERE d.id=m.id AND
      (d.value#>>'{config,votingSource}' IS DISTINCT FROM m.source OR d.value#>>'{config,votingMappings}' IS DISTINCT FROM m.mappings)`);
    await control.query("COMMIT");
    return `${references.size} saved linking pages; ${doors} voting doors; no authority changes`;
  } catch (error) { await control.query("ROLLBACK"); throw error; }
}
