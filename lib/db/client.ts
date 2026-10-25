import { Client as RawClient, Pool as RawPool, neon as rawNeon, neonConfig } from "@neondatabase/serverless";
import { installDatabaseTransferCounter } from "./transfer.ts";
import { installDatabaseClientAccounting } from "./transfer-by-caller.ts";
import { assertDatabaseReadTarget } from "./read-target.ts";
import { afterResponse } from "../log/after-response.ts";

export * from "@neondatabase/serverless";

function install(connection?: string): void {
  assertDatabaseReadTarget(connection);
  installDatabaseTransferCounter();
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
}

/** Check at invocation too: diagnostic scripts may compose a fetch hook after creating their client. */
export const neon: typeof rawNeon = new Proxy(rawNeon, {
  apply(target, receiver, args) {
    install(args[0]);
    const client = Reflect.apply(target, receiver, args);
    return new Proxy(client, {
      apply(fn, self, query) { install(args[0]); return Reflect.apply(fn, self, query); },
      get(fn, key, self) {
        const value = Reflect.get(fn, key, self);
        if ((key === "query" || key === "transaction") && typeof value === "function") {
          return (...query: unknown[]) => { install(args[0]); return Reflect.apply(value, fn, query); };
        }
        return value;
      },
    });
  },
});

const connectionOf = (config: unknown): string | undefined => typeof config === "string" ? config
  : config && typeof config === "object" && "connectionString" in config ? String(config.connectionString) : undefined;
function accountedInstance<T extends object>(instance: T, connection: string | undefined): T {
  for (const key of ["connect", "query"]) {
    const method = Reflect.get(instance, key);
    if (typeof method !== "function") continue;
    Reflect.set(instance, key, (...args: unknown[]) => {
      install(connection);
      const result = Reflect.apply(method, instance, args);
      if (result && typeof result.then === "function") {
        const finish = () => { void afterResponse(async () => {
          const { flushDatabaseTransfer } = await import("./transfer.ts");
          await flushDatabaseTransfer();
        }, { backgroundFallback: true }); };
        void result.then(finish, finish);
      }
      return result;
    });
  }
  return instance;
}
export const Pool: typeof RawPool = new Proxy(RawPool, {
  construct(target, args, constructor) { const connection = connectionOf(args[0]); install(connection); return accountedInstance(Reflect.construct(target, args, constructor), connection); },
});
export type Pool = RawPool;
export const Client: typeof RawClient = new Proxy(RawClient, {
  construct(target, args, constructor) { const connection = connectionOf(args[0]); install(connection); return accountedInstance(Reflect.construct(target, args, constructor), connection); },
});
export type Client = RawClient;
