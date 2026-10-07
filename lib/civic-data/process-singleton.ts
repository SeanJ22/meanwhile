import { createServer, type Server } from "node:net";

/** A listening loopback socket is an OS-held mutex: the kernel releases it if the process crashes. */
export const PILOT_RUNNER_SINGLETON_PORT = 49_371;
export const ROUTINE_DATA_RUNNER_SINGLETON_PORT = 49_372;

export class ProcessSingletonHeldError extends Error {
  readonly singletonName: string;
  readonly port: number;

  constructor(singletonName: string, port: number) {
    super(`PROCESS_SINGLETON_HELD:${singletonName}:127.0.0.1:${port}`);
    this.name = "ProcessSingletonHeldError";
    this.singletonName = singletonName;
    this.port = port;
  }
}

export interface ProcessSingletonLease {
  readonly name: string;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly release: () => Promise<void>;
}

/** `port = 0` is for tests only. */
export async function acquireProcessSingleton(
  name: string,
  port: number,
): Promise<ProcessSingletonLease> {
  if (!name.trim()) throw new Error("PROCESS_SINGLETON_NAME_REQUIRED");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PROCESS_SINGLETON_PORT_INVALID:${port}`);
  }
  const server = createServer((socket) => socket.destroy());
  let released = false;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(error.code === "EADDRINUSE" ? new ProcessSingletonHeldError(name, port) : error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port, exclusive: true });
  });

    // The socket only excludes a second writer; it must never keep a finished process alive.
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error(`PROCESS_SINGLETON_ADDRESS_UNAVAILABLE:${name}`);
  }

  return {
    name,
    host: "127.0.0.1",
    port: address.port,
    release: async () => {
      if (released) return;
      released = true;
      await closeServer(server);
    },
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error ? reject(error) : resolve());
  });
}
