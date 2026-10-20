/** Measurement-only Neon factory. Real reader clients retain their exact native object. */
import { neon as nativeNeon } from "@neondatabase/serverless";
export * from "@neondatabase/serverless";

export function neon(connection, options) {
  const target = new URL(connection);
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname);
  if (!local) return nativeNeon(connection, options);
  if (decodeURIComponent(target.username) !== "wtp_cp_release_readonly" ||
      !process.env.WTP_RH01_FACTS_URL || new URL(process.env.WTP_RH01_FACTS_URL).hostname !== "127.0.0.1") {
    throw Error("RH01_LOOPBACK_NEON_COORDINATOR_REQUIRED");
  }
  const original = nativeNeon(connection, options);
  const unsupported = () => { throw Error("RH01_UNSUPPORTED_LOOPBACK_NEON_API: only the reached native query(text,params) API is implemented"); };
  return new Proxy(original, {
    apply: unsupported,
    get(client, key) {
      if (key === "transaction" || key === "unsafe") return unsupported;
      if (key !== "query") return Reflect.get(client, key);
      return async (text, params = [], queryOptions) => {
        if (options && Object.keys(options).length || queryOptions && Object.keys(queryOptions).some(key => key !== "fetchOptions") ||
            queryOptions?.fetchOptions && Object.keys(queryOptions.fetchOptions).some(key => key !== "signal") ||
            queryOptions?.fetchOptions?.signal !== undefined && !(queryOptions.fetchOptions.signal instanceof AbortSignal)) unsupported();
        const { controlSql } = await import("./rh01-readonly-runtime.mts");
        return controlSql(original).query(text, params, queryOptions);
      };
    },
  });
}
