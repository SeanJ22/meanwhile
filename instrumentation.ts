export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.CONTEXT === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { importExistingKeys } = await import("./lib/core/keys-import.ts");
    await importExistingKeys(process.env, undefined, new Date().toISOString(), "website").catch(() => console.error("Saved keys could not be imported. Check the Keys box in Settings."));
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build" && process.env.DATABASE_URL) {
    const { warmReaderConnections } = await import("./lib/reader/database");
    void warmReaderConnections().catch(() => {});
  }
}
