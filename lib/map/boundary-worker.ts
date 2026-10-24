import { createBoundaryReader, type BoundaryRequest } from "./boundary-reader.ts";
import { createOfficeLocator } from "./office-locator.ts";
import type { ReaderStateResponse } from "../reader/client.ts";

export type ReaderWorkerRequest = BoundaryRequest
  | { kind: "bootstrap"; body: ArrayBuffer; status: number; headers: [string,string][] }
  | { kind: "office"; url: string; address: string };

const read = createBoundaryReader();
const locate = createOfficeLocator();
async function readWorker(request: ReaderWorkerRequest, signal: AbortSignal) {
  if (request.kind === "office") return locate(request.address);
  if (request.kind !== "bootstrap") return read(request, signal);
  const place = JSON.parse(new TextDecoder().decode(request.body)) as {stateResponse?:{value:ReaderStateResponse;status:number;headers:[string,string][]}};
  const state = place.stateResponse ?? {value:{error:"The state's information could not be loaded"},status:503,headers:[["cache-control","no-store"]]};
  delete place.stateResponse;
  return {state,place:{value:place,status:request.status,headers:request.headers}};
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
