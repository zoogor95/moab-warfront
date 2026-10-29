import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as IoServer } from 'socket.io';
import { createApp } from './app';
import type { Config } from './config';
import type { Pool } from './db';

export interface RunningServer {
  http: HttpServer;
  io: IoServer;
  port: number;
  /** Stops accepting connections and closes open sockets. The pool is the caller's to end. */
  close(): Promise<void>;
}

export async function startServer(config: Pick<Config, 'port' | 'clientOrigins'>, pool: Pool): Promise<RunningServer> {
  const http = createServer(createApp(pool));
  // Match rooms and per-seat views arrive with the realtime step of phase 2.
  const io = new IoServer(http, { cors: { origin: config.clientOrigins } });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, () => {
      http.off('error', reject);
      resolve();
    });
  });

  return {
    http,
    io,
    port: (http.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}
