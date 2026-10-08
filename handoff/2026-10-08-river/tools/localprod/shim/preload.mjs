// node --import <this file>: send every Neon request for the fake local hosts to the local shim,
// whichever copy of @neondatabase/serverless makes it (plain node, tsx, or a Next server bundle).
//  - fetch to https://*.<LOCALPROD_DOMAIN>/sql  -> http://127.0.0.1:<shim>/sql   (neon() HTTP queries)
//  - new WebSocket(wss://*.<LOCALPROD_DOMAIN>/v2?address=...) -> ws://127.0.0.1:<shim>/v2?... (Pool / Client)
//  - any fetch or WebSocket to a host in LOCALPROD_BLOCK_HOSTS (default neon.tech) throws, so a stray
//    production URL in the environment cannot be reached from a local run.
const SHIM = new URL(process.env.LOCALPROD_SHIM_URL ?? "http://127.0.0.1:54330");
const DOMAIN = (process.env.LOCALPROD_DOMAIN ?? "localprod.test").toLowerCase();
const BLOCK = (process.env.LOCALPROD_BLOCK_HOSTS ?? "neon.tech").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const matches = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);
const isLocal = (host) => matches(host.toLowerCase(), DOMAIN);
const blocked = (host) => BLOCK.some((b) => matches(host.toLowerCase(), b));

if (!globalThis.__localprodPreload) {
  globalThis.__localprodPreload = { fetches: 0, sockets: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = function localprodFetch(input, init) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url); } catch { return realFetch(input, init); }
    if (isLocal(url.hostname)) {
      globalThis.__localprodPreload.fetches++;
      const target = new URL(url.pathname + url.search, SHIM);
      if (typeof input === "string" || input instanceof URL) return realFetch(target, init);
      return realFetch(new Request(target, input), init);
    }
    if (blocked(url.hostname)) {
      return Promise.reject(new Error(`localprod: refused a request to ${url.hostname} (LOCALPROD_BLOCK_HOSTS)`));
    }
    return realFetch(input, init);
  };

  const RealWebSocket = globalThis.WebSocket;
  if (RealWebSocket) {
    class LocalprodWebSocket extends RealWebSocket {
      constructor(address, protocols) {
        const url = new URL(String(address));
        if (isLocal(url.hostname)) {
          globalThis.__localprodPreload.sockets++;
          const target = new URL(url.pathname + url.search, SHIM);
          target.protocol = SHIM.protocol === "https:" ? "wss:" : "ws:";
          super(target, protocols);
          return;
        }
        if (blocked(url.hostname)) throw new Error(`localprod: refused a WebSocket to ${url.hostname} (LOCALPROD_BLOCK_HOSTS)`);
        super(address, protocols);
      }
    }
    globalThis.WebSocket = LocalprodWebSocket;
  }
}
