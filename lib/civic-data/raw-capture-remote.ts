import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";

/** Raw source bytes live in the shared remote vault, outside the candidate store; reader routes never load this client. */
export function rawCaptureVault(): EvidenceStore {
  const vault = netlifyEvidenceStoreFromEnv();
  if (!vault) throw Error("The shared raw-capture evidence vault is unavailable.");
  return vault;
}
