import { X509Certificate } from "node:crypto";
import tls from "node:tls";

/** Node 24's trust-store calls; the repository's Node 20 type package predates them. */
export const trustStore = tls as typeof tls & { getCACertificates(type: "default"): string[]; setDefaultCACertificates(certs: readonly string[]): void };

/** How the missing issuer is found: the server's own leaf certificate, then the issuer file that leaf names. */
export interface IssuerChainReads {
  readonly leaf: (host: string, port: number) => Promise<X509Certificate>;
  readonly download: (url: string) => Promise<Uint8Array>;
}

const incompleteChain = (error: unknown) => (error as { cause?: { code?: unknown } } | null)?.cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";

// The handshake is only read for the certificate the server presents; nothing is sent, and the page itself is fetched verified.
const presentedLeaf: IssuerChainReads["leaf"] = (host, port) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: 10_000 }, () => {
    const leaf = socket.getPeerX509Certificate(); socket.destroy();
    if (leaf) resolve(leaf); else reject(new Error("The server presented no certificate"));
  });
  socket.once("error", reject).once("timeout", () => { socket.destroy(); reject(new Error("The server's certificate was not presented in time")); });
});
const downloadIssuer: IssuerChainReads["download"] = async url => new Uint8Array(await (await fetch(url, { signal: AbortSignal.timeout(10_000) })).arrayBuffer());

/**
 * Some official sites send their certificate without the intermediate that signed it. Browsers fetch that issuer from the
 * address the certificate names; Node refuses the page instead. This adds the named issuer to the process's trust store only
 * when it signed the server's certificate and a trusted root signed it, so every connection still verifies to a root.
 */
export function issuerCompletingFetch(base: typeof fetch = fetch, { leaf: readLeaf = presentedLeaf, download = downloadIssuer }: Partial<IssuerChainReads> = {}): typeof fetch {
  return async (input, init) => {
    try { return await base(input, init); } catch (error) {
      if (!incompleteChain(error)) throw error;
      const url = new URL(input instanceof Request ? input.url : String(input));
      const leaf = await readLeaf(url.hostname, Number(url.port) || 443);
      const named = /CA Issuers - URI:(\S+)/.exec(leaf.infoAccess ?? "")?.[1];
      if (!named) throw error;
      const issuer = new X509Certificate(await download(named));
      const trusted = trustStore.getCACertificates("default");
      if (!leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey) || !trusted.some(pem => {
        const root = new X509Certificate(pem);
        return issuer.checkIssued(root) && issuer.verify(root.publicKey);
      })) throw error;
      if (!trusted.includes(issuer.toString())) trustStore.setDefaultCACertificates([...trusted, issuer.toString()]);
      return base(input, init);
    }
  };
}
