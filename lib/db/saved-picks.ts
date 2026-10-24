import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { assertWriteAllowed } from "./write-guard.ts";
import type { PicksFile } from "../ballot/picks-file.ts";

export type PicksQuery = (statement: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface SavedPicks { revision: number; file: PicksFile }
export const privatePicksDigest = (secret: string) => createHash("sha256").update(`private-ballot:${secret}`).digest("hex");

/** No link to event identity, IP, contact information, ZIP or a reader account. */
export function savedPicksStore(query: PicksQuery = (text, params) => neon(process.env.DATABASE_URL!).query(text, [...params])) {
  const row = (r: Record<string, unknown> | undefined): SavedPicks | null => r ? { revision: Number(r.revision), file: r.file as PicksFile } : null;
  return {
    async read(secret: string) {
      return row((await query("SELECT revision, file FROM saved_ballot_picks WHERE secret_hash = $1", [privatePicksDigest(secret)]))[0]);
    },
    async create(secret: string, file: PicksFile) {
      assertWriteAllowed("private ballot picks");
      const rows = await query(`INSERT INTO saved_ballot_picks (secret_hash, revision, file) VALUES ($1, 0, $2::jsonb)
        ON CONFLICT DO NOTHING RETURNING revision, file`, [privatePicksDigest(secret), JSON.stringify(file)]);
      return row(rows[0]);
    },
    async update(secret: string, revision: number, file: PicksFile) {
      assertWriteAllowed("private ballot picks");
      return row((await query(`UPDATE saved_ballot_picks SET file = $3::jsonb, revision = revision + 1
        WHERE secret_hash = $1 AND revision = $2 RETURNING revision, file`, [privatePicksDigest(secret), revision, JSON.stringify(file)]))[0]);
    },
  };
}
