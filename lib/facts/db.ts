import { neonConfig, Pool } from "@neondatabase/serverless";
import type { FactDb, Query } from "./publish.ts";

let pool: Pool | null = null;

/** The reader database over the pooled WebSocket client, so each publish is one real transaction. */
export function readerFactDb(url: string | undefined = process.env.DATABASE_URL): FactDb & { readonly query: Query } {
  if (!url) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
  pool ??= new Pool({ connectionString: url, max: 4 });
  const held = pool;
  return {
    query: async (text, params = []) => (await held.query(text, [...params])).rows,
    async transaction(work) {
      const client = await held.connect();
      try {
        await client.query("BEGIN");
        const out = await work(async (text, params = []) => (await client.query(text, [...params])).rows);
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
