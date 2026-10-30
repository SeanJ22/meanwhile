import { storedKeyValue } from "./lib/core/keys-values.ts";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WTP_BUILD_CONTEXT === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { refreshSavedKeys } = await import("./lib/core/keys-runtime.ts");
    await refreshSavedKeys("website");
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build" && storedKeyValue("DATABASE_URL")) {
    const { warmReaderConnections } = await import("./lib/reader/database");
    void warmReaderConnections().catch(() => {});
  }
}
