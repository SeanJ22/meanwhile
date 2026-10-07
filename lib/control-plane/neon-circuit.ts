/** Host-local circuit: Neon cannot record its own quota refusal, so a hard refusal is remembered here and not probed again. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { neonConfig } from "@neondatabase/serverless";

import { classifyProviderFailure, operationalNightAt, type ProviderCircuit } from "./fleet-safety.ts";
import { ModelTransportError } from "./scheduler/scout-executor.ts";

export const neonCircuitPath = (root: string): string => join(root, ".mirror", "fleet-provider-circuits.json");

export function readNeonCircuit(root: string, now: string): ProviderCircuit | null {
  try {
    const circuit = JSON.parse(readFileSync(neonCircuitPath(root), "utf8")) as ProviderCircuit;
    return circuit.provider === "neon" && Date.parse(circuit.eligibleAt) > Date.parse(now) ? circuit : null;
  } catch {
    return null;
  }
}

export function latchNeonCircuit(root: string, condition: string, at: string): ProviderCircuit {
  const existing = readNeonCircuit(root, at);
  const circuit: ProviderCircuit = existing ?? {
    provider: "neon",
    condition,
    firstObservedAt: at,
    workDeferred: ["standing Pilot Runner control-plane-dependent cycle"],
    eligibleAt: operationalNightAt(at).end,
  };
  const path = neonCircuitPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(circuit, null, 2)}\n`, "utf8");
  return circuit;
}

/** Install before constructing the Neon client. One hard response closes the seam synchronously. */
export function installNeonCircuitBreaker(root: string, now: () => string = () => new Date().toISOString()): void {
  const underlying = neonConfig.fetchFunction ?? fetch;
  neonConfig.fetchFunction = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const active = readNeonCircuit(root, now());
    if (active) throw new Error(`PROVIDER_CIRCUIT_BROKEN: neon is latched until ${active.eligibleAt}: ${active.condition}`);
    const response = await underlying(input, init);
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.clone().text()).slice(0, 1_000);
      } catch {
        detail = "response body unreadable";
      }
      const failure = classifyProviderFailure(new ModelTransportError(`HTTP ${response.status}: ${detail}`, response.status));
      if (failure.class === "HARD") {
        const circuit = latchNeonCircuit(root, failure.condition, now());
        throw new Error(`PROVIDER_CIRCUIT_BROKEN: neon hard-refused the control plane; no automated retry before ${circuit.eligibleAt}: ${failure.condition}`);
      }
    }
    return response;
  };
}
