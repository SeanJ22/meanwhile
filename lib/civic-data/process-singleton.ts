import { createServer, type Server } from "node:net";

/**
 * Fixed loopback leases for the one standing host. A listening socket is an
 * operating-system-held mutex: it is acquired atomically and the kernel
 * releases it if the process crashes, so there is no stale pid file for the
 * owner to repair. These ports carry no network protocol and accept no data.
 */
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

/**
 * Acquire one process-lifetime execution door on this host. `port = 0` exists
 * only for deterministic tests; production callers use their fixed port.
 */
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

  // The runner's own timers/work keep it alive. This socket exists only to
  // exclude a second writer and must never keep an otherwise finished process.
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
