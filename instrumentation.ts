import { storedKeyValue } from "./lib/core/keys-values.ts";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  // A published answer reads no saved key, so a cold start does not wait on the control-plane database. The keys load in the
  // background, and a route that needs one awaits that same load through loadWebsiteSavedKeys.
  void (async () => {
    if (process.env.WTP_BUILD_CONTEXT === "production") await (await import("./lib/core/keys-runtime.ts")).refreshSavedKeys("website");
    if (process.env.NODE_ENV === "production" && storedKeyValue("DATABASE_URL")) await (await import("./lib/reader/database")).warmReaderConnections();
  })().catch(() => {});
}
