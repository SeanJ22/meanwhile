import { createBoundaryReader, type BoundaryRequest } from "./boundary-reader.ts";
import { createOfficeLocator } from "./office-locator.ts";
import { officeOwners, directoryOffices } from "./office-pins.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { ReaderStateResponse } from "../reader/client.ts";

export type ReaderWorkerRequest = BoundaryRequest
  | { kind: "state"; url: string }
  | { kind: "office"; url: string; address: string };

const read = createBoundaryReader();
const locate = createOfficeLocator();
async function readWorker(request: ReaderWorkerRequest, signal: AbortSignal) {
  if (request.kind === "office") return locate(request.address);
  if (request.kind !== "state") return read(request, signal);
  const response = await fetch(request.url, { signal, headers: { accept: "application/json" } });
  const value = await response.json() as ReaderStateResponse;
  if (response.ok && value.coverage && value.memberDirectories) {
    for (const owner of officeOwners(value.coverage)) {
      const keys = personIdentityKeys(owner.holder);
      const directory = value.memberDirectories.find(row => row.ids.some(id => keys.has(id)))?.directory;
      if (!directory) continue;
      for (const office of directoryOffices(owner, directory)) if (!office.point) void locate(office.address);
    }
  }
  return { value, status: response.status, headers: [...response.headers] };
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
