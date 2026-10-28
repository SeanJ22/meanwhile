import { createBoundaryReader, type BoundaryRequest } from "./boundary-reader.ts";
import { createOfficeLocator } from "./office-locator.ts";

export type ReaderWorkerRequest = BoundaryRequest
  | { kind: "json"; body: ArrayBuffer }
  | { kind: "office"; url: string; address: string };

const read = createBoundaryReader();
const locate = createOfficeLocator();
async function readWorker(request: ReaderWorkerRequest, signal: AbortSignal) {
  if (request.kind === "office") return locate(request.address);
  if (request.kind !== "json") return read(request, signal);
  return JSON.parse(new TextDecoder().decode(request.body));
}
const active = new Map<number, AbortController>();
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; request?: ReaderWorkerRequest; cancel?: boolean }>) => void;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = ({ data }) => {
  if (data.cancel) { active.get(data.id)?.abort(); return; }
  if (!data.request) return;
  const controller = new AbortController(); active.set(data.id, controller);
  void readWorker(data.request, controller.signal).then(value => {
    if (controller.signal.aborted) return;
    if (value && "data" in value) {
      const bytes = value.data instanceof ArrayBuffer ? value.data : new Uint8Array(value.data).buffer;
      worker.postMessage({ id: data.id, value: { ...value, data: bytes } }, [bytes]);
    } else worker.postMessage({ id: data.id, value });
  }).catch(error => {
    if (!controller.signal.aborted) worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }).finally(() => active.delete(data.id));
};
