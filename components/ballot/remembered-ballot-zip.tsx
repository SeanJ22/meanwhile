"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRememberedAddress } from "@/hooks/use-session-address";
import { RememberedAddress } from "@/components/address/remembered-address";

/** An unqualified ballot opens the ZIP already resolved on this device. */
export function RememberedBallotZip({ zip }: { zip: string | null }) {
  const address = useRememberedAddress();
  const router = useRouter();
  useEffect(() => {
    if (zip === null && address) router.replace(`/ballot?zip=${address.zip}`);
  }, [address, router, zip]);
  return zip === null ? <RememberedAddress /> : null;
}
