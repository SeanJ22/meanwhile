import { refreshSavedKeys } from "./keys-runtime.ts";

export interface KeyFunctionContext { readonly deploy?: { readonly context?: string } }
/** The platform supplies deploy context to native Functions; no Admin request or owner session is involved. */
export async function loadNativeSavedKeys(context?: KeyFunctionContext, load: typeof refreshSavedKeys = refreshSavedKeys): Promise<void> {
  if (context?.deploy?.context === "production") await load("website");
}
