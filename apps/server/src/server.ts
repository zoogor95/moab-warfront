import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as IoServer } from 'socket.io';
import { createApp } from './app';
import type { Config } from './config';
import type { Pool } from './db';
import { JobWorker } from './jobs';
import { MatchService } from './matches';
import { attachRealtime, SocketNotifier, type Io } from './realtime';

export interface RunningServer {
  http: HttpServer;
  io: Io;
  port: number;
  matches: MatchService;
  jobs: JobWorker;
  /** Stops the clock, stops accepting connections and closes open sockets. The pool is the caller's to end. */
  close(): Promise<void>;
}

export interface ServerOptions {
  /** How often the clock worker looks for due turns. Tests turn it off and call `jobs.tick()`. */
  jobIntervalMs?: number | null;
}

export async function startServer(
  config: Pick<Config, 'port' | 'clientOrigins' | 'authSecret'>,
  pool: Pool,
  options: ServerOptions = {},
): Promise<RunningServer> {
  // Socket.IO must see the request listener when it attaches, so it can pass on everything
  // outside /socket.io/; the app needs the io server, so the listener delegates to it once built.
  let app: ReturnType<typeof createApp> | undefined;
  const http = createServer((req, res) => app!(req, res));
  // Views are large and repetitive, so compressing them pays off.
  const io: Io = new IoServer(http, { cors: { origin: config.clientOrigins }, perMessageDeflate: { threshold: 1024 } });
  const notify = new SocketNotifier(io);
  const matches = new MatchService(pool, notify);
  app = createApp({ pool, matches, notify, authSecret: config.authSecret, clientOrigins: config.clientOrigins });
  attachRealtime(io, pool, matches, config.authSecret);

  const jobs = new JobWorker(pool, (job) => matches.runClock(job), options.jobIntervalMs ?? 1000);
  if (options.jobIntervalMs !== null) jobs.start();

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
    matches,
    jobs,
    close: async () => {
      await jobs.stop();
      await matches.idle();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
