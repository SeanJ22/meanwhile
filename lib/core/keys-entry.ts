/** Next compiles its build context into server bundles; preview/local entry points stay offline. */
export async function loadWebsiteSavedKeys(): Promise<void> {
  if (process.env.WTP_BUILD_CONTEXT === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { refreshSavedKeys } = await import("./keys-runtime.ts");
    await refreshSavedKeys("website");
  }
}
