/**
 * The chain suites' harness is the canary's isolated plane (PRDY-6): one
 * construction, in `lib/control-plane/promotion/isolated-plane.ts`, so a test
 * and the sanctioned canary exercise the same real procedures the same way.
 */
import { isolatedFactPlane, PIMA_LEGISTAR_CONTRACT, type IsolatedPlane } from "../lib/control-plane/promotion/isolated-plane.ts";

export const PIMA_CONTRACT = PIMA_LEGISTAR_CONTRACT;
export const HARNESS_START = "2026-09-05T18:00:00.000Z";
export type FactChainHarness = IsolatedPlane;

export async function factChainHarness(options: { startAt?: string } = {}): Promise<FactChainHarness> {
  return isolatedFactPlane({ root: process.cwd(), startAt: options.startAt ?? HARNESS_START });
}
