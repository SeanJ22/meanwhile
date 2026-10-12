/** The asset store's public address; a restore is verified by hash, never by status code. */
import { createHash } from "node:crypto";

/** The public store, overridable by `WTP_ASSET_REMOTE`; it has a working default so a restore never silently skips. */
export const DEFAULT_ASSET_REMOTE =
  "https://raw.githubusercontent.com/SeanJ22/wtp-assets/main";

export function assetRemoteBase(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.WTP_ASSET_REMOTE?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_ASSET_REMOTE).replace(
    /\/+$/,
    "",
  );
}

/** The remote address of one asset, sharded by the first two hex characters exactly as the local store is. */
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

/** Fetch one asset and prove it is the asset asked for; a transport failure is a refusal, never a throw. */
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
    // The transport succeeded and the bytes are wrong: an error page, an interstitial, a truncated read or a replaced file.
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
