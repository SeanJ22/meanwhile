type Row = Record<string, unknown>;
interface CursorClient {
  query(text: string, params?: unknown[]): Promise<{ readonly rows: readonly Row[] }>;
}

export async function withStateBucketCursor<T>(client: CursorClient, read: (source: {
  query: (text: string, params: readonly unknown[]) => Promise<readonly Row[]>;
  streamRows: (text: string, params: readonly unknown[], onRow: (row: Row) => Promise<void>) => Promise<void>;
}) => Promise<T>): Promise<T> {
  await client.query("BEGIN READ ONLY");
  let sequence = 0;
  try {
    return await read({
      query: async (text, params) => (await client.query(text, [...params])).rows,
      streamRows: async (text, params, onRow) => {
        const cursor = `state_bucket_${++sequence}`;
        await client.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR ${text}`, [...params]);
        try {
          while (true) {
            const { rows } = await client.query(`FETCH FORWARD 1 FROM ${cursor}`);
            if (!rows.length) break;
            if (rows.length !== 1) throw new Error("STATE_BUCKET_CURSOR_ROW_COUNT_INVALID");
            await onRow(rows[0]);
          }
        } finally { await client.query(`CLOSE ${cursor}`); }
      },
    });
  } finally { await client.query("ROLLBACK"); }
}
