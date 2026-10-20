/** National input, partition inventory and ordering stay on disk. Only the current
 * place (or a bounded native-source page) is decoded for publication. */
import type { OpenDataFact } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";
import { openDataDiskIndex } from "./disk-index.ts";

export const OpenDataSpool = { async create() {
  const disk = await openDataDiskIndex(`CREATE TABLE rows(position INTEGER PRIMARY KEY,state TEXT NOT NULL,partition TEXT NOT NULL,native_id TEXT NOT NULL,value TEXT NOT NULL,
    UNIQUE(state,partition,native_id)); CREATE INDEX rows_order ON rows(state,partition,position)`);
  const insert = disk.db.prepare("INSERT INTO rows(state,partition,native_id,value) VALUES(?,?,?,?)");
  const records = disk.db.prepare("SELECT partition,value FROM rows ORDER BY position");
  const partitions = disk.db.prepare("SELECT state,partition,value FROM rows ORDER BY state,partition,position");
  let writing = false;
  const flush = () => { if (writing) { disk.db.exec("COMMIT"); writing = false; } };
  return {
    async append(partition: string, row: OpenDataFact, capture: Omit<OpenDataCapture, "sourceRows">) {
      if (!writing) { disk.db.exec("BEGIN"); writing = true; }
      const { sourceRows: _sourceRows, ...metadata } = capture as OpenDataCapture;
      insert.run(row.state ?? "UNRESOLVED", partition, row.id, JSON.stringify({ row, capture: metadata }));
    },
    async *records(): AsyncGenerator<{ partition: string; row: OpenDataFact; capture: Omit<OpenDataCapture, "sourceRows"> }> {
      flush();
      for (const found of records.iterate()) yield { partition: String(found.partition), ...JSON.parse(String(found.value)) };
    },
    async *partitions(options: { readonly pageRows?: number; readonly pageBytes?: number } = {}): AsyncGenerator<{ partition: string; rows: OpenDataFact[]; captures: OpenDataCapture[] }> {
      for (const size of [options.pageRows, options.pageBytes]) if (size !== undefined && (!Number.isSafeInteger(size) || size < 1)) throw new Error("OPEN_DATA_PAGE_SIZE_INVALID");
      flush();
      let partition = "", state = "", rows: OpenDataFact[] = [], captures = new Map<string, OpenDataCapture>(), page = 0, bytes = 0;
      const take = () => {
        const result = { partition: options.pageRows || options.pageBytes ? `${partition}:page:${page++}` : partition, rows, captures: [...captures.values()] };
        rows = []; captures = new Map(); bytes = 0; return result;
      };
      for (const found of partitions.iterate()) {
        const next = String(found.partition), nextState = String(found.state);
        if (next !== partition || nextState !== state) { if (rows.length) yield take(); partition = next; state = nextState; page = 0; }
        const text = String(found.value), { row, capture } = JSON.parse(text) as { row: OpenDataFact; capture: Omit<OpenDataCapture, "sourceRows"> };
        rows.push(row); bytes += Buffer.byteLength(text);
        const key = JSON.stringify(capture), prior = captures.get(key);
        if (prior) (prior.sourceRows as Record<string, unknown>[]).push(row.sourceRow);
        else captures.set(key, { ...capture, sourceRows: [row.sourceRow] });
        if (options.pageRows && rows.length >= options.pageRows || options.pageBytes && bytes >= options.pageBytes) yield take();
      }
      if (rows.length) yield take();
    },
    async dispose() { flush(); await disk.dispose(); },
  };
} };
