import { storedKeyValue } from "../core/keys-values.ts";
import type { StateResultFeed } from "./feed-types.ts";
import { isResultState } from "./feed-types.ts";
import type { NationalCongressSummary } from "./summary.ts";

export interface ElectionResultFeedStore {
  readState(state: string): Promise<StateResultFeed | null>;
  writeState(state: string, document: StateResultFeed): Promise<void>;
  readNation(): Promise<NationalCongressSummary | null>;
  writeNation(document: NationalCongressSummary): Promise<void>;
}

export interface ResultFeedJSONIO {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
}

const stateKey = (state: string) => {
  if (!isResultState(state)) throw new Error("ELECTION_RESULT_STATE_INVALID");
  return `states/${state}.json`;
};
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function stateResultFeed(value: unknown, state: string): StateResultFeed {
  if (!object(value) || value.formatVersion !== 1 || value.state !== state || typeof value.checkedAt !== "string"
    || typeof value.fingerprint !== "string" || value.ballotVersion !== null && typeof value.ballotVersion !== "string" || !object(value.facts)
    || value.contestIds !== undefined && (!object(value.contestIds) || Object.values(value.contestIds).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== "string"))))
    throw new Error("ELECTION_RESULT_STATE_FEED_INVALID");
  return { formatVersion: 1, state, ballotVersion: value.ballotVersion as string | null, checkedAt: value.checkedAt,
    fingerprint: value.fingerprint, facts: value.facts,
    ...(value.contestIds === undefined ? {} : { contestIds: value.contestIds as StateResultFeed["contestIds"] }) };
}

export function nationalResultFeed(value: unknown): NationalCongressSummary {
  if (!object(value) || typeof value.checkedAt !== "string" || !object(value.states) || !Array.isArray(value.sources))
    throw new Error("ELECTION_RESULT_NATIONAL_FEED_INVALID");
  return { checkedAt: value.checkedAt, states: value.states, sources: value.sources,
    ...(value.statewide === undefined ? {} : { statewide: value.statewide }) } as unknown as NationalCongressSummary;
}

/** Injected IO makes all software tests independent of keys, network and deployment context. */
export function createElectionResultFeedStore(io: ResultFeedJSONIO): ElectionResultFeedStore {
  return {
    async readState(state) { const value = await io.read(stateKey(state)); return value === null ? null : stateResultFeed(value, state); },
    async writeState(state, document) { await io.write(stateKey(state), stateResultFeed(document, state)); },
    async readNation() { const value = await io.read("nation.json"); return value === null ? null : nationalResultFeed(value); },
    async writeNation(document) { await io.write("nation.json", nationalResultFeed(document)); },
  };
}

export function resultFeedScope(environment: Readonly<Record<string, string | undefined>> = process.env): "site" | "deploy" {
  const contexts = [environment.CONTEXT, environment.WTP_BUILD_CONTEXT, environment.WTP_RUNTIME_MODE].filter(Boolean);
  if (/^(?:local|test)(?:-|$)/i.test(environment.WTP_DB_ROLE ?? "") || contexts.some(context => context !== "production")) return "deploy";
  return contexts.includes("production") ? "site" : "deploy";
}

const netlifyIO: ResultFeedJSONIO = {
  async read(key) { return (await netlifyStore()).get(key, { type: "json", consistency: "strong" }); },
  async write(key, value) { await (await netlifyStore()).setJSON(key, value); },
};

export interface ResultFeedBlobClient {
  get(key: string, options: { type: "json"; consistency: "strong" }): Promise<unknown | null>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}

/** A native request uses the platform's context and automatic credentials, without opening saved keys. */
export function nativeResultFeedScope(deployContext?: string): "site" | "deploy" {
  return deployContext === "production" ? "site" : "deploy";
}

async function automaticBlobsStore(scope: "site" | "deploy"): Promise<ResultFeedBlobClient> {
  const { getStore, getDeployStore } = await import("@netlify/blobs");
  const options = { name: "meanwhile-election-results", consistency: "strong" as const };
  return scope === "site" ? getStore(options) : getDeployStore(options);
}

export function nativeResultFeedStore(deployContext?: string,
  open: (scope: "site" | "deploy") => Promise<ResultFeedBlobClient> = automaticBlobsStore): ElectionResultFeedStore {
  if (installed) return installed;
  const local = process.env.WTP_ELECTION_RESULTS_TEST_FEED_DIR;
  if (local && deployContext !== "production") return localElectionResultFeedStore(local);
  const scope = nativeResultFeedScope(deployContext);
  return createElectionResultFeedStore({
    read: async key => (await open(scope)).get(key, { type: "json", consistency: "strong" }),
    write: async (key, value) => { await (await open(scope)).setJSON(key, value); },
  });
}

async function netlifyStore() {
  const { getStore, getDeployStore } = await import("@netlify/blobs");
  const siteID = process.env.WTP_BLOBS_SITE_ID, token = storedKeyValue("WTP_BLOBS_TOKEN");
  const options = { name: "meanwhile-election-results", consistency: "strong" as const, ...(siteID && token ? { siteID, token } : {}) };
  // Site stores are shared by every deploy. A preview must never open this one.
  return resultFeedScope() === "site" ? getStore(options) : getDeployStore(options);
}

/** A native test-copy server can replay feeds from its own temporary directory. Never available in production. */
export function localElectionResultFeedStore(root: string): ElectionResultFeedStore {
  if (resultFeedScope() === "site") throw new Error("ELECTION_RESULT_TEST_FEED_FORBIDDEN_IN_PRODUCTION");
  const path = async (key: string) => {
    const { temporaryPath } = await import("../civic-data/temporary-path.ts");
    return `${temporaryPath(root)}/${key}`;
  };
  return createElectionResultFeedStore({
    async read(key) {
      const { readFile } = await import("node:fs/promises");
      try { return JSON.parse(await readFile(await path(key), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    },
    async write(key, value) {
      const { mkdir, rename, writeFile } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      const destination = await path(key), temporary = `${destination}.${process.pid}.tmp`;
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(temporary, JSON.stringify(value));
      await rename(temporary, destination);
    },
  });
}

let installed: ElectionResultFeedStore | undefined;
export function installElectionResultFeedStore(store: ElectionResultFeedStore | undefined): void { installed = store; }
export function resultFeedStore(): ElectionResultFeedStore {
  if (installed) return installed;
  const local = process.env.WTP_ELECTION_RESULTS_TEST_FEED_DIR;
  return local ? localElectionResultFeedStore(local) : createElectionResultFeedStore(netlifyIO);
}
