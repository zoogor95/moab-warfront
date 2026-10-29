export interface Config {
  port: number;
  databaseUrl: string;
  clientOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy apps/server/.env.example to apps/server/.env.');
  }
  const port = Number(env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, got "${env.PORT}".`);
  }
  const clientOrigins = (env.CLIENT_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return { port, databaseUrl, clientOrigins };
}

/** Loads apps/server/.env when present; real environment variables win. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the environment.
  }
}
