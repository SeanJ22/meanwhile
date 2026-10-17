"use client";

import { useRememberedAddress } from "@/hooks/use-session-address";
import { clearSessionAddress, type SessionAddressScope } from "@/lib/geo/session-address";

/** The same remembered address and Forget control on every reader surface. */
export function RememberedAddress({
  scope,
  onForget,
  className = "",
}: {
  scope?: SessionAddressScope;
  onForget?: () => void;
  className?: string;
}) {
  const remembered = useRememberedAddress();
  const address = scope ?? remembered;
  if (!address) return null;

  return (
    <div className={`address-prompt address-prompt-settled ${className}`} data-remembered-address>
      <p className="address-prompt-confirmed">Remembered address: {address.streetLabel}</p>
      {(address.divisionLabels?.length ?? 0) > 0 && (
        <p className="address-prompt-confirmed">Your districts: {address.divisionLabels!.join(", ")}.</p>
      )}
      <p className="address-prompt-kept">Kept on this device until you forget it.</p>
      <button type="button" className="address-prompt-undo" onClick={() => {
        clearSessionAddress();
        onForget?.();
      }}>Forget this address</button>
    </div>
  );
}
