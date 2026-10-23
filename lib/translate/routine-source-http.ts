import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { FleetSafetyController } from "../control-plane/fleet-safety.ts";
import { EMPTY_SPEND } from "../control-plane/spend-window.ts";
import { websiteSizeFromHoldings } from "../control-plane/scheduler/host-supervision.ts";
import { measureTranslationRoutineId } from "./routine-contract.ts";

/** The existing free publisher guards, with one deadline and redirect history
 * for the whole retrieval rather than a fresh deadline for every redirect. */
export function routineMeasureSourceOpener(input: {
  readonly repos: Pick<ControlPlaneRepositories, "websitePacing">;
  readonly state: string;
  readonly root: string;
  readonly now: () => string;
  readonly fetch?: typeof fetch;
}) {
  const fleet = new FleetSafetyController({ now: input.now(), spend: EMPTY_SPEND,
    modelHold: "Source acquisition uses plain code.", websitePacing: input.repos.websitePacing,
    websiteSize: websiteSizeFromHoldings([input.state.toLowerCase()], input.root) });
  return async (url: string): Promise<Response> => {
    const seen = new Set<string>(), signal = AbortSignal.timeout(30_000);
    let finalUrl = url;
    const open = fleet.guardedOpenBytes("official-measure-text", measureTranslationRoutineId(input.state), async (target, init) => {
      const address = String(target);
      if (seen.has(address)) throw new Error("The official source redirects in a loop.");
      seen.add(address);
      finalUrl = address;
      return (input.fetch ?? fetch)(target, { ...init, signal });
    });
    const result = await open({ url, headers: { accept: "application/pdf,text/html,text/plain" }, timeoutMs: 30_000 });
    if (result.transportError || result.status === null) throw new Error(result.transportError ?? "The official text could not be read.");
    const response = new Response(result.bytes as BodyInit, { status: result.status, headers: { "content-type": result.contentType } });
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  };
}
