import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as authSchema from './auth-schema.js';
import * as domainSchema from './schema.js';

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 5000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 5000,
  });
  // pg emits background connection errors separately from query rejections.
  // Acquired transaction clients are temporarily outside the pool's idle-error
  // listener. A server-side transaction timeout must not become an uncaught event.
  pool.on('connect', (client) => {
    client.on('error', () => console.warn('DATABASE_CLIENT_CONNECTION_LOST'));
  });
  pool.on('error', () => console.warn('DATABASE_CONNECTION_LOST'));
  const db = drizzle(pool, { schema: { ...authSchema, ...domainSchema } });
  return { db, close: () => pool.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
