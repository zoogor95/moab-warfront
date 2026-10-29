import { loadConfig, loadEnvFile } from './config';
import { createPool } from './db';
import { migrate } from './migrate';

loadEnvFile();
const pool = createPool(loadConfig().databaseUrl);
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `Applied ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}
