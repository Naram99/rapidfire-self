import { createDatabase } from './client.js';
import { migrateDatabase } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL missing; run npm run env:init');
const database = createDatabase(url);
try {
  await migrateDatabase(database.db);
  console.log(
    'Database migrations applied. Existing migrations were preserved.',
  );
} catch {
  console.error(
    'Migration failed. Check database readiness and the versioned migration files.',
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
