import { batchEnabledFor } from "../control-plane/model-batch.ts";
import type { ModelRequest } from "../control-plane/scheduler/scout-executor.ts";

const TRANSLATION_TOOLS = new Set([
  "write_measure_translation", "write_text_translation", "check_measure_translation",
]);

/** Each translation turn is a self-contained source/proposal request. Tool
 * conversations and reader synthesis continue on their existing transport. */
export function translationBatchEnabled(request: ModelRequest,
  env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return request.tools.length === 1 && TRANSLATION_TOOLS.has(request.tools[0].name) &&
    request.messages.length === 1 && request.messages[0].role === "user" &&
    batchEnabledFor("background-translation", env);
}
