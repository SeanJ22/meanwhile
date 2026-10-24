declare module "node:sqlite" {
  /** Native SQLite bindings accept BLOB views as well as scalar SQL values. */
  export type SQLInputValue = string | number | bigint | null | NodeJS.ArrayBufferView;
  export class DatabaseSync {
    constructor(path: string, options?: {readOnly?: boolean});
    readonly isTransaction: boolean;
    exec(sql: string): void;
    prepare(sql: string): {
      get(...parameters: readonly (string | number)[]): Record<string, number> | undefined;
      run(...parameters: readonly SQLInputValue[]): {changes:number|bigint;lastInsertRowid:number|bigint};
      all(...parameters: readonly (string | number)[]): Record<string,string|number>[];
    };
    close(): void;
  }
}
