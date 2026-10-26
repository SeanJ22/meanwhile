import { Client as RawClient, Pool as RawPool, neon as rawNeon, neonConfig } from "@neondatabase/serverless";
import { installDatabaseTransferCounter } from "./transfer.ts";
import { installDatabaseClientAccounting } from "./transfer-by-caller.ts";
import { assertDatabaseReadTarget } from "./read-target.ts";
import { afterResponse } from "../log/after-response.ts";
import { checkedDriverRead, decodeDriverResult, needsVersionedRead, rawDriverTypes, type DriverResult, type DriverParsers } from "./checked-driver.ts";

export * from "@neondatabase/serverless";

type Options = { arrayMode?: boolean; fullResults?: boolean; types?: DriverParsers; readonly [key: string]: unknown };
type Parameterized = { query: string; params?: readonly unknown[] };
type QueryData = Parameterized | { toParameterizedQuery(): Parameterized };
type Execute = (data: QueryData | readonly QueryData[], options?: Options | readonly Options[], transaction?: Options) => Promise<unknown>;
type LazyQuery = { readonly queryData: QueryData; readonly opts?: Options; readonly execute: Execute };
const parameterized = (data: QueryData): Parameterized => "toParameterizedQuery" in data ? data.toParameterizedQuery() : data;

function install(connection?: string): void {
  assertDatabaseReadTarget(connection);
  installDatabaseTransferCounter();
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
}

/** Keep a batch in one database transaction. Preparing the disposable copy
 * lookups never executes a statement; all SELECTs then use one atomic version
 * comparison each in the same original batch, with its original write mode. */
async function executeChecked(connection: string, defaults: Options, execute: Execute,
  data: QueryData | readonly QueryData[], options: Options | readonly Options[] = {}, transaction?: Options): Promise<unknown> {
  const batch = Array.isArray(data), items = (batch ? data : [data]) as readonly QueryData[];
  const statements = items.map(parameterized);
  if (statements.every(statement => !needsVersionedRead(statement.query))) return execute(data, options, transaction);
  const perQuery = items.map((_, index) => (Array.isArray(options) ? options[index] : options) ?? {}) as Options[];
  const prepared = statements.map((statement, index) => {
    const effective = { ...defaults, ...transaction, ...perQuery[index] };
    if (!needsVersionedRead(statement.query)) return { ready: Promise.resolve(statement), effective };
    let readyResolve!: (query: Parameterized) => void, readyReject!: (error: unknown) => void;
    let replyResolve!: (result: DriverResult) => void, replyReject!: (error: unknown) => void;
    const ready = new Promise<Parameterized>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const reply = new Promise<DriverResult>((resolve, reject) => { replyResolve = resolve; replyReject = reject; });
    const result = checkedDriverRead(connection, statement.query, statement.params ?? [], async (query, params) => {
      readyResolve({ query, params }); return reply;
    });
    void result.catch(readyReject);
    return { ready, effective, result, resolve: replyResolve, reject: replyReject };
  });
  const queries = await Promise.all(prepared.map(item => item.ready));
  const rawOptions = perQuery.map(option => ({ ...option, arrayMode: true, fullResults: true, types: rawDriverTypes }));
  let results: readonly DriverResult[];
  try {
    const raw = await execute(batch ? queries : queries[0], batch ? rawOptions : rawOptions[0],
      transaction === undefined ? undefined : { ...transaction, arrayMode: true, fullResults: true });
    results = (batch ? raw : [raw]) as readonly DriverResult[];
  } catch (error) {
    for (const item of prepared) item.reject?.(error);
    await Promise.allSettled(prepared.flatMap(item => item.result ? [item.result] : []));
    throw error;
  }
  prepared.forEach((item, index) => item.resolve?.(results[index]));
  const decoded = await Promise.all(prepared.map(async (item, index) =>
    decodeDriverResult(item.result ? await item.result : results[index], item.effective)));
  return batch ? decoded : decoded[0];
}

/** Preserve NeonQueryPromise itself: tagged-template composition and batching
 * use queryData/opts, while all executions still enter the shared version path. */
export const neon: typeof rawNeon = new Proxy(rawNeon, {
  apply(target, receiver, args) {
    const connection = String(args[0]);
    install(connection);
    const client = Reflect.apply(target, receiver, args);
    const defaults = (args[1] ?? {}) as Options;
    const rawExecute = client.query("SELECT 1").execute as Execute;
    const held = new WeakMap<object, object>();
    const checked = (query: LazyQuery) => {
      let wrapped = held.get(query);
      if (!wrapped) {
        wrapped = new Proxy(query, { get(promise, key, self) {
          if (key === "execute") return (data: QueryData | readonly QueryData[], options?: Options | readonly Options[], transaction?: Options) => {
            install(connection); return executeChecked(connection, defaults, rawExecute, data, options, transaction);
          };
          return Reflect.get(promise, key, self);
        } });
        held.set(query, wrapped);
      }
      return wrapped;
    };
    const proxy: typeof client = new Proxy(client, {
      apply(fn, self, query) { install(connection); return checked(Reflect.apply(fn, self, query)); },
      get(fn, key, self) {
        const value = Reflect.get(fn, key, self);
        if (key === "query" && typeof value === "function") return (...query: unknown[]) => {
          install(connection); return checked(Reflect.apply(value, fn, query));
        };
        if (key === "transaction" && typeof value === "function") return async (queriesOrFn: unknown, options?: Options) => {
          install(connection);
          const queries = typeof queriesOrFn === "function" ? queriesOrFn(proxy) : queriesOrFn;
          if (!Array.isArray(queries) || queries.some(query => !query || !("queryData" in query))) {
            return Reflect.apply(value, fn, [queriesOrFn, options]);
          }
          return executeChecked(connection, defaults, rawExecute,
            queries.map(query => query.queryData), queries.map(query => query.opts ?? {}), options);
        };
        return value;
      },
    });
    return proxy;
  },
});

const connectionOf = (config: unknown): string | undefined => typeof config === "string" ? config
  : config && typeof config === "object" && "connectionString" in config ? String(config.connectionString) : undefined;
interface ConnectionRuntimeParameters {
  readonly host?: unknown;
  readonly database?: unknown;
  readonly user?: unknown;
  readonly port?: unknown;
  readonly types?: DriverParsers;
  readonly binary?: unknown;
}
const accounted = new WeakSet<object>();
function accountedInstance<T extends object>(instance: T, connection: string | undefined, isPool = false): T {
  if (accounted.has(instance)) return instance;
  accounted.add(instance);
  const parameters = (Reflect.get(instance, "connectionParameters") ?? Reflect.get(instance, "options") ?? {}) as ConnectionRuntimeParameters;
  const address = connection ?? JSON.stringify({ host: parameters.host ?? process.env.PGHOST,
    database: parameters.database ?? process.env.PGDATABASE, user: parameters.user ?? process.env.PGUSER, port: parameters.port });
  const finish = () => { void afterResponse(async () => {
    const { flushDatabaseTransfer } = await import("./transfer.ts");
    await flushDatabaseTransfer();
  }, { backgroundFallback: true }); };
  let submitted = Promise.resolve();
  const reserve = () => {
    if (isPool) return { wait: Promise.resolve(), release() {} };
    let release!: () => void;
    const wait = submitted;
    submitted = new Promise<void>(resolve => { release = resolve; });
    return { wait, release };
  };
  const inheritedParsers: DriverParsers | undefined = typeof Reflect.get(instance, "getTypeParser") === "function"
    ? { getTypeParser: (oid, format) => Reflect.apply(Reflect.get(instance, "getTypeParser") as DriverParsers["getTypeParser"], instance, [oid, format]) }
    : parameters.types;
  const query = Reflect.get(instance, "query");
  if (typeof query === "function") Reflect.set(instance, "query", (...args: unknown[]) => {
    install(connection);
    const callback = typeof args.at(-1) === "function" ? args.pop() as (error: unknown, result?: unknown) => void : undefined;
    // Socket pools submit through their guarded physical clients. This keeps
    // independent pool queries concurrent and retains per-client type overrides.
    if (isPool && !(neonConfig.poolQueryViaFetch && !Reflect.get(instance, "hasFetchUnsupportedListeners"))) {
      const result = Reflect.apply(query, instance, callback ? [...args, callback] : args);
      if (result && typeof result.then === "function") void result.then(finish, finish);
      return result;
    }
    const statement = args[0];
    const config = typeof statement === "string" ? { text: statement } : statement as Record<string, unknown> | undefined;
    const checked = config && typeof config.text === "string" && needsVersionedRead(config.text);
    const slot = reserve();
    const run = async (arguments_: unknown[]) => {
      await slot.wait;
      try { return Reflect.apply(query, instance, arguments_); }
      finally { slot.release(); }
    };
    let result: Promise<unknown>;
    if (!checked || !config || typeof config.text !== "string") {
      result = run(args);
    } else {
      const values = (Array.isArray(args[1]) ? args[1] : config.values ?? []) as readonly unknown[];
      const binary = config.binary || Reflect.get(instance, "binary") || parameters.binary || false;
      result = checkedDriverRead(address + (binary ? ":binary" : ":text"), config.text, values,
        (text, params) => run([{ ...config, text, name: undefined,
          values: [...params], rowMode: "array", types: rawDriverTypes }]) as Promise<DriverResult>)
        .then(raw => decodeDriverResult(raw, { fullResults: true, arrayMode: config.rowMode === "array",
          types: config.types as DriverParsers | undefined ?? inheritedParsers }));
    }
    // A local preparation failure must release its submission reservation too.
    // Otherwise COMMIT/ROLLBACK would wait forever without reaching PostgreSQL.
    void result.finally(slot.release).catch(() => {});
    void result.then(finish, finish);
    if (callback) { void result.then(value => callback(null, value), error => callback(error)); return; }
    return result;
  });
  const connect = Reflect.get(instance, "connect");
  if (typeof connect === "function") Reflect.set(instance, "connect", (...args: unknown[]) => {
    install(connection);
    const callback = typeof args.at(-1) === "function" ? args.pop() as (...args: unknown[]) => void : undefined;
    if (callback) return Reflect.apply(connect, instance, [...args, (error: unknown, client?: object, release?: unknown) =>
      callback(error, client ? accountedInstance(client, connection) : client, release)]);
    const result = Reflect.apply(connect, instance, args);
    return result && typeof result.then === "function" ? result.then((client: unknown) =>
      client && typeof client === "object" ? accountedInstance(client, connection) : client) : result;
  });
  return instance;
}

export const Pool: typeof RawPool = new Proxy(RawPool, {
  construct(target, args, constructor) {
    const connection = connectionOf(args[0]); install(connection);
    const pool = accountedInstance(Reflect.construct(target, args, constructor), connection, true);
    const PhysicalClient = pool.Client;
    pool.Client = new Proxy(PhysicalClient, { construct(Client, clientArgs, NewTarget) {
      return accountedInstance(Reflect.construct(Client, clientArgs, NewTarget), connection);
    } });
    return pool;
  },
});
export type Pool = RawPool;
export const Client: typeof RawClient = new Proxy(RawClient, {
  construct(target, args, constructor) { const connection = connectionOf(args[0]); install(connection); return accountedInstance(Reflect.construct(target, args, constructor), connection); },
});
export type Client = RawClient;
