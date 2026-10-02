/**
 * **RULING 117 — THE ASSET STORE HAS A PUBLIC ADDRESS, AND A RESTORE IS
 * VERIFIED BY HASH RATHER THAN BY STATUS CODE.** (Sean's decision of
 * 2026-08-24, closing `R57`.)
 *
 * ## What was open, and for how long
 *
 * `RULING 20` moved portrait and PDF bytes out of git and into a
 * content-addressed store, and it worked: 956 rows, every one carrying its
 * hash, its size and the provenance the photo rule requires. What it could not
 * do was finish, because the store was **a local path on one development
 * machine** and Netlify cannot reach a local path. So the committed portraits
 * were deliberately NOT deleted — removing them would have blanked every
 * candidate and official card in production — and the repo carried both the
 * bytes and the mechanism built to replace them.
 *
 * The cost was not only repository size. `NH101` had **97 sitting members of
 * Congress** whose portraits were retrieved, licence-confirmed (CC0 1.0
 * Universal, GPO works, door 1) and byte-verified, and **could not ship**,
 * because there was nowhere to put them that a build could read.
 *
 * The design: a dedicated **public** GitHub repository, created automatically.
 * It is <https://github.com/SeanJ22/wtp-assets>.
 *
 * ## Public is the correct posture, not a convenience
 *
 * Everything in the store was already published — by a government body, by a
 * campaign about itself, or under an explicit open licence. A private store
 * would need a credential in the build, and a credential is a thing that
 * expires, leaks, or sits unused while somebody hits a rate limit beside it
 * (RULING 90.5). There is nothing here to protect that publication has not
 * already given away.
 *
 * ## Why the hash is checked and the status code is not trusted
 *
 * A 200 that is not the thing is not a document. GitHub serves a styled HTML
 * page for a missing raw path in some configurations, and a proxy or a captive
 * network can answer 200 with anything at all. A content-addressed store makes
 * the check free and total: **the name of the file IS the hash of its correct
 * contents**, so bytes that do not hash to the name they were requested under
 * are refused, whatever the transport said. This is the control-query
 * discipline (RULING 68) applied where it costs nothing.
 *
 * A refusal here is a **CANNOT RUN for that row**, never a decision to serve
 * nothing (RULING 24).
 */
import { createHash } from "node:crypto";

/**
 * The public store. Overridable by `WTP_ASSET_REMOTE` so a fork, a mirror or a
 * test can point elsewhere — but it has a working default, because a default
 * that must be configured is a restore path that silently does not run.
 */
export const DEFAULT_ASSET_REMOTE =
  "https://raw.githubusercontent.com/SeanJ22/wtp-assets/main";

export function assetRemoteBase(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WTP_ASSET_REMOTE?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_ASSET_REMOTE).replace(
    /\/+$/,
    "",
  );
}

/**
 * The remote address of one asset.
 *
 * The shard is the first two hex characters, which is the same layout the
 * local store uses — so the same hash resolves to the same relative path in
 * both places and neither can drift from the other.
 */
export function remoteAssetUrl(
  sha256: string,
  extension: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `not a sha-256: ${JSON.stringify(sha256)} — a guessed identifier is a LEAD, never an address`,
    );
  }
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${assetRemoteBase(env)}/${sha256.slice(0, 2)}/${sha256}${ext}`;
}

export interface RemoteAssetResult {
  ok: boolean;
  status: number | null;
  bytes: number;
  /** What the bytes actually hashed to. Null when nothing was read. */
  sha256: string | null;
  url: string;
  /** Present only on a refusal, and it says which half failed. */
  refusal?: string;
}

/**
 * Fetch one asset and prove it is the asset asked for.
 *
 * Never throws on a transport failure — it returns a refusal carrying what it
 * saw, because a caller restoring 900 files needs a per-row verdict rather
 * than an exception that ends the run.
 */
export async function fetchAssetFromRemote(
  sha256: string,
  extension: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<RemoteAssetResult & { body?: Buffer }> {
  const env = options.env ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const url = remoteAssetUrl(sha256, extension, env);

  let response: Response;
  try {
    response = await doFetch(url, {
      headers: {
        // The identified User-Agent the public-records rule requires.
        "user-agent": "we-the-people-asset-restore (+https://github.com/SeanJ22/we-the-people)",
      },
    });
  } catch (cause) {
    return {
      ok: false,
      status: null,
      bytes: 0,
      sha256: null,
      url,
      refusal: `the request did not complete: ${(cause as Error).message}`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      bytes: 0,
      sha256: null,
      url,
      refusal: `the host answered HTTP ${response.status}`,
    };
  }

  const body = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(body).digest("hex");

  if (got !== sha256) {
    /*
     * THIS is the branch a status-code check cannot reach. The transport
     * succeeded and the bytes are wrong — an error page, a proxy interstitial,
     * a truncated read, a file replaced at the same name.
     */
    return {
      ok: false,
      status: response.status,
      bytes: body.length,
      sha256: got,
      url,
      refusal:
        `HTTP ${response.status} carried ${body.length} byte(s) hashing to ${got}, ` +
        `which is not the ${sha256} it was requested under — a 200 that is not the thing is not a document`,
    };
  }

  return { ok: true, status: response.status, bytes: body.length, sha256: got, url, body };
}
