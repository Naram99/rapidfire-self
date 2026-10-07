import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../src/database/client.js';
import { migrateDatabase } from '../src/database/migrate.js';

export async function isolatedDatabase() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl)
    throw new Error('DATABASE_URL missing; start the development database');
  const name = `rapidfire_m3_test_${randomUUID().replaceAll('-', '')}`;
  const admin = createDatabase(baseUrl);
  await admin.db.execute(sql`CREATE DATABASE ${sql.identifier(name)}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  const database = createDatabase(url.href);
  const close = async () => {
    await database.close();
    // Only a database created by this helper is ever removed, never the user's DB.
    await admin.db.execute(
      sql`DROP DATABASE ${sql.identifier(name)} WITH (FORCE)`,
    );
    await admin.close();
  };
  try {
    await migrateDatabase(database.db);
    return { ...database, close };
  } catch (error) {
    await close();
    throw error;
  }
}
