/** Shared Node entry loader. Credential bytes come only from the Keys box. */
import { loadEnvLocal } from "../scripts/load-env-local.mjs";
loadEnvLocal();
if (process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test")) {
  for (const name of ["DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL", "WTP_SAVED_KEYS_DATABASE_SOURCE"]) delete process.env[name];
  await import("../tests/helpers/install-fixture-keys.ts");
} else if (process.env.WTP_RUNTIME_MODE === "staging") {
  const { installLocalDatabaseFixture } = await import("../lib/core/keys-local-fixture.ts");
  installLocalDatabaseFixture(process.env.DATABASE_URL);
} else if (!["deploy-preview", "branch-deploy"].includes(process.env.CONTEXT ?? "")) {
  const productionBuild = process.env.NETLIFY === "true" && process.env.CONTEXT === "production" && process.env.BRANCH === "main";
  const runner = process.env.WTP_RUNTIME_MODE === "production";
  const configured = process.env.WTP_CONTROL_PLANE_DATABASE_URL && process.env.WTP_KEYS_ENCRYPTION_KEY;
  if (runner || productionBuild || configured) {
    const { refreshSavedKeys } = await import("../lib/core/keys-runtime.ts");
    await refreshSavedKeys(productionBuild ? "build" : "runner");
  }
}
