/** Next compiles its build context into server bundles; preview/local entry points stay offline. */
export async function loadWebsiteSavedKeys(load?: typeof import("./keys-runtime.ts").refreshSavedKeys): Promise<void> {
  if (process.env.WTP_BUILD_CONTEXT === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const read = load ?? (await import("./keys-runtime.ts")).refreshSavedKeys;
    await read("website");
  }
}
