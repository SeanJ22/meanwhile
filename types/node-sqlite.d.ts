declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { get(...parameters: readonly (string | number)[]): Record<string, number> | undefined };
    close(): void;
  }
}
