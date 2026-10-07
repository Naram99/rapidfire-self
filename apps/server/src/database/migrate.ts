import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, {
    // Same relative location in src/database and dist/database.
    migrationsFolder: fileURLToPath(
      new URL('../../migrations/', import.meta.url),
    ),
  });
}
