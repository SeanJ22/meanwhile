declare module "node:sqlite" {
  type SqlValue = null | string | number | bigint | Uint8Array;
  export interface StatementSync {
    get(...parameters: readonly SqlValue[]): Record<string, SqlValue> | undefined;
    all(...parameters: readonly SqlValue[]): Record<string, SqlValue>[];
    iterate(...parameters: readonly SqlValue[]): IterableIterator<Record<string, SqlValue>>;
    run(...parameters: readonly SqlValue[]): { readonly changes: number | bigint; readonly lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readonly readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
