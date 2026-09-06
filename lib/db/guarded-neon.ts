/**
 * Every application/control-plane SQL dispatch passes this boundary, including
 * Drizzle raw execute, batches and tagged SQL. Denied writers may still read:
 * PostgreSQL enforces READ ONLY for those queries, so a SELECT calling a mutating
 * function or a write inside a CTE cannot evade an application keyword check.
 */
import {
  neon,
  NeonQueryPromise,
  SqlTemplate,
  type NeonQueryFunction,
  type HTTPTransactionOptions,
} from "@neondatabase/serverless";
import {
  describeWriteContext,
  ProductionWriteRefused,
  runtimeWriteEnvironment,
  type WriteDestination,
  type WriteEnvironment,
} from "./write-guard.ts";

type Client = NeonQueryFunction<false, false>;
type Query = NeonQueryPromise<boolean, boolean>;

export interface GuardedSqlOptions {
  destination?: WriteDestination;
  operation?: string;
  environment?: () => WriteEnvironment;
}

/** Only candidate reads enter a denied writer's READ ONLY transaction. */
function isCandidateRead(query: Query): boolean {
  const data = query.queryData;
  const text = data instanceof SqlTemplate ? data.toParameterizedQuery().query : data.query;
  // Multiple statements, transaction control and unrecognised commands fail
  // closed. The database, rather than this lexical test, proves read-onlyness.
  const statement = text.trim().replace(/;\s*$/, "");
  return /^(SELECT|WITH|SHOW)\b/i.test(statement) && !statement.includes(";");
}

export function guardNeonClient(
  client: Client,
  connection: string,
  options: GuardedSqlOptions = {},
): Client {
  const destination = options.destination ?? "application";
  const operation = options.operation ?? `a ${destination} database query`;
  const environment = options.environment ?? runtimeWriteEnvironment;
  const context = () => describeWriteContext({
    ...environment(),
    // Guard the connection the client actually holds, not an env var changed
    // after client construction or a different database used by another store.
    [destination === "application" ? "DATABASE_URL" : "WTP_CONTROL_PLANE_DATABASE_URL"]: connection,
  }, operation, destination);

  const queryOptions = <T extends { fetchOptions?: unknown }>(value: T | undefined): T | undefined => {
    if (value?.fetchOptions !== undefined) {
      throw new ProductionWriteRefused(operation, {
        ...context(),
        allowed: false,
        reason: "query transport overrides could change the measured destination or READ ONLY transaction, so fetchOptions is forbidden.",
      });
    }
    if (value === undefined) return undefined;
    const safe = { ...value };
    // Never forward a transport property, including one supplied by a getter.
    delete safe.fetchOptions;
    return safe;
  };

  const dispatch = async (queries: Query[], transactionOptions: HTTPTransactionOptions<boolean, boolean> = {}) => {
    const safeTransactionOptions = queryOptions(transactionOptions);
    const safeQueries = queries.map((query) => new NeonQueryPromise(
      query.execute, query.queryData, queryOptions(query.opts),
    ));
    const verdict = context();
    if (verdict.allowed) return client.transaction(safeQueries as NeonQueryPromise<false, false>[], safeTransactionOptions);
    if (!safeQueries.every(isCandidateRead)) throw new ProductionWriteRefused(operation, verdict);
    try {
      return await client.transaction(safeQueries as NeonQueryPromise<false, false>[], { ...safeTransactionOptions, readOnly: true });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "25006") {
        throw new ProductionWriteRefused(operation, verdict);
      }
      throw error;
    }
  };

  const wrapQuery = (query: Query): Query => new NeonQueryPromise(
    async (data, suppliedOptions) => {
      const verdict = context();
      // A fresh query owns its real queryData even when awaited after the env
      // changes. Keep the underlying client entirely inside this closure.
      if (Array.isArray(data) || Array.isArray(suppliedOptions)) {
        throw new Error("A single guarded query cannot dispatch a hidden batch; use the guarded transaction method.");
      }
      const safeOptions = queryOptions(suppliedOptions);
      const current = new NeonQueryPromise(query.execute, data, safeOptions);
      if (verdict.allowed) return current;
      const results = await dispatch([current], safeOptions);
      return results[0];
    },
    query.queryData,
    query.opts,
  );

  const guarded = new Proxy(client, {
    apply(target, _thisArg, args) {
      return wrapQuery(Reflect.apply(target, target, args));
    },
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<Client["query"]>) => wrapQuery(target.query(...args));
      }
      if (property === "transaction") {
        return (queriesOrFn: Query[] | ((sql: Client) => Query[]), transactionOptions?: HTTPTransactionOptions<boolean, boolean>) => {
          const queries = typeof queriesOrFn === "function" ? queriesOrFn(guarded) : queriesOrFn;
          return dispatch(queries, transactionOptions);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return guarded;
}

export function createGuardedNeon(connection: string, options?: GuardedSqlOptions): Client {
  let client: Client;
  try {
    client = neon(connection);
  } catch {
    // Driver/URL parser errors can carry the full connection string. Never
    // wrap or retain the original error as a cause.
    throw new Error("The database connection is invalid; no database query was dispatched.");
  }
  return guardNeonClient(client, connection, options);
}
