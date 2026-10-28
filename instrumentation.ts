export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build" && process.env.DATABASE_URL) {
    const { warmReaderConnections } = await import("./lib/reader/database");
    void warmReaderConnections().catch(() => {});
  }
}
