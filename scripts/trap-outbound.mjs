/**
 * **THE SERVER-SIDE OUTBOUND ACQUISITION TRAP.**
 * (Session C final, lane 1, 2026-09-01. RULING 229.)
 *
 * ```
 *   WTP_OUTBOUND_LOG=.scratch/outbound.log \
 *     node --import ./scripts/trap-outbound.mjs node_modules/next/dist/bin/next start
 * ```
 *
 * ## Why the browser layer alone would have proved nothing
 *
 * RULING 229's invariant is **ZERO REDUNDANT INTERNET HUNT WHEN A NEW ZIP IS
 * ACTIVATED**. A Playwright `context.route` interceptor can see what the PAGE
 * requests and cannot see what the SERVER requests: a route handler that fetches
 * a government API during render is exactly the hunt the invariant forbids, and
 * it is invisible from the browser. A test that trapped only the browser would
 * have reported ZERO OUTBOUND over a render that hunted.
 *
 * So this is preloaded into the Next server process. Every outbound attempt is
 * APPENDED TO A FILE FIRST and only then refused — the record survives the
 * refusal, because a trap that throws without writing turns a violation into a
 * 500 with no name on it.
 *
 * ## What it covers, and what it does not — stated rather than discovered later
 *
 * It wraps `globalThis.fetch` and `http`/`https`'s `request` and `get`, which is
 * every client this repository's route handlers use. It does NOT cover a raw
 * `net.Socket`, a native addon, or a child process. Those are real ways to reach
 * the network and this does not see them, so a clean log is evidence about the
 * clients named here and never a proof that no packet left.
 *
 * Loopback is allowed: the page talking to its own server is the render, not an
 * acquisition.
 */
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const LOG = process.env.WTP_OUTBOUND_LOG;
if (!LOG) {
  throw new Error(
    "trap-outbound: WTP_OUTBOUND_LOG is not set. A trap with nowhere to write is a trap that " +
      "reports nothing, and a silent trap reads as a clean render.",
  );
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLocal(hostname) {
  return LOCAL.has(String(hostname ?? "").toLowerCase());
}

function record(kind, url) {
  appendFileSync(LOG, `${new Date().toISOString()}\t${kind}\t${url}\n`, "utf8");
}

const realFetch = globalThis.fetch;
globalThis.fetch = async function trappedFetch(input, init) {
  const raw = typeof input === "string" ? input : String(input?.url ?? input);
  let hostname = "";
  try {
    hostname = new URL(raw, "http://localhost").hostname;
  } catch {
    hostname = raw;
  }
  if (!isLocal(hostname)) {
    record("fetch", raw);
    throw new Error(
      `OUTBOUND ACQUISITION REFUSED during a trapped render: ${raw}. RULING 229 — activating a ZIP ` +
        "may not start a network hunt for a record the authority already published.",
    );
  }
  return realFetch(input, init);
};

for (const [name, mod] of [
  ["http", http],
  ["https", https],
]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn].bind(mod);
    mod[fn] = function trapped(...args) {
      const first = args[0];
      let hostname = "";
      let shown = "";
      if (typeof first === "string" || first instanceof URL) {
        const u = new URL(String(first), "http://localhost");
        hostname = u.hostname;
        shown = u.toString();
      } else if (first && typeof first === "object") {
        hostname = first.hostname ?? first.host ?? "";
        shown = `${name}://${hostname}${first.path ?? ""}`;
      }
      if (!isLocal(hostname)) {
        record(`${name}.${fn}`, shown || String(first));
        throw new Error(
          `OUTBOUND ACQUISITION REFUSED during a trapped render: ${shown || String(first)}`,
        );
      }
      return real(...args);
    };
  }
}

record("trap", "installed");
