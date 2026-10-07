import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { expect, test } from 'vitest';

test('PostgreSQL and Drizzle support a parameterized transaction', async () => {
  if (!process.env.DATABASE_URL)
    throw new Error(
      'DATABASE_URL missing; run npm run env:init and npm run db:up',
    );
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const db = drizzle(client);
    await db.execute(sql`BEGIN`);
    const version = await db.execute<{ server_version_num: string }>(
      sql`SHOW server_version_num`,
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeGreaterThanOrEqual(
      170000,
    );
    expect(Number(version.rows[0]?.server_version_num)).toBeLessThan(180000);
    await db.execute(
      sql`CREATE TEMPORARY TABLE setup_probe (value uuid NOT NULL) ON COMMIT DROP`,
    );
    const value = randomUUID();
    await db.execute(sql`INSERT INTO setup_probe (value) VALUES (${value})`);
    const result = await db.execute<{ value: string }>(
      sql`SELECT value FROM setup_probe`,
    );
    expect(result.rows).toEqual([{ value }]);
    await db.execute(sql`ROLLBACK`);
    const cleanup = await db.execute<{ relation: string | null }>(
      sql`SELECT to_regclass('pg_temp.setup_probe')::text AS relation`,
    );
    expect(cleanup.rows[0]?.relation).toBeNull();
  } finally {
    await client.end();
  }
});
