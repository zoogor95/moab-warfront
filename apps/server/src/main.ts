import { loadConfig, loadEnvFile } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { startServer } from './server';

loadEnvFile();
const config = loadConfig();
const pool = createPool(config.databaseUrl);

const applied = await migrate(pool);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

const server = await startServer(config, pool);
console.log(`Server listening on http://localhost:${server.port}`);

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  await server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
