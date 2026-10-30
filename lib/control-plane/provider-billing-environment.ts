/** The billing collector opens its own five reporting keys; ordinary workers do not inherit them. */
import { BILLING_SECRET_NAMES, withoutBillingSecrets } from "./provider-billing.ts";
import { productionKeysStore, type KeysStore } from "../core/keys-store.ts";
import { storedKeyEnvironment } from "../core/keys-values.ts";

export async function billingCollectorEnvironment(parent: NodeJS.ProcessEnv = storedKeyEnvironment(),
  store: Pick<KeysStore, "read"> = productionKeysStore()): Promise<NodeJS.ProcessEnv> {
  const env = withoutBillingSecrets(parent), at = new Date().toISOString();
  await Promise.all(BILLING_SECRET_NAMES.map(async name => {
    const value = await store.read(name, true, at, "runner");
    if (value) env[name] = value;
  }));
  return env;
}
