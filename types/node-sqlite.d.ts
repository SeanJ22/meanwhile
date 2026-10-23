declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...parameters: readonly (string | number)[]): Record<string, number> | undefined;
      run(...parameters: readonly (string | number)[]): {changes:number|bigint;lastInsertRowid:number|bigint};
      all(...parameters: readonly (string | number)[]): Record<string,string|number>[];
    };
    close(): void;
  }
}
