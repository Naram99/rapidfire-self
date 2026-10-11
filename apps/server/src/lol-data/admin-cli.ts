import { createDatabase } from '../database/client.js';
import { LolRepository } from './repository.js';

const [action, userId, extra] = process.argv.slice(2);
if (
  !['grant', 'revoke'].includes(action ?? '') ||
  !userId ||
  extra ||
  !/^[0-9a-f-]{36}$/i.test(userId)
) {
  console.error(
    'Usage: npm run admin:access -- grant|revoke <verified-user-uuid>',
  );
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing; run npm run env:init');
  const database = createDatabase(url);
  try {
    await new LolRepository(database.db).setAdmin(userId, action === 'grant');
    console.info(
      action === 'grant' ? 'Admin access granted.' : 'Admin access revoked.',
    );
  } catch {
    console.error(
      'Admin access could not be changed. Check the database and the verified user ID.',
    );
    process.exitCode = 1;
  } finally {
    await database.close();
  }
}
