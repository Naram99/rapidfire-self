import { createDatabase } from '../database/client.js';
import { fileSource } from './file-source.js';
import { LolImporter } from './importer.js';
import { LolRepository } from './repository.js';

const [userId, directory, mode = 'latest', extra] = process.argv.slice(2);
if (
  !userId ||
  !directory ||
  extra ||
  !/^[0-9a-f-]{36}$/i.test(userId) ||
  !['latest', 'reimport'].includes(mode)
) {
  console.error(
    'Usage: npm run lol:import-files -- <admin-user-uuid> <directory> [latest|reimport]',
  );
  process.exitCode = 1;
} else {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing; run npm run env:init');
  const database = createDatabase(url);
  const repository = new LolRepository(database.db);
  const importer = new LolImporter(repository, fileSource(directory));
  try {
    if (!(await repository.isAdmin(userId)))
      throw new Error('Verified admin account required.');
    const run = await importer.start(
      userId,
      mode === 'reimport' ? 'reimport' : 'latest',
    );
    await importer.idle();
    const completed = await repository.run(run.id);
    console.info(
      'LOL_IMPORT',
      run.id,
      completed?.status,
      completed?.errorCode ?? '',
    );
    if (!completed || !['succeeded', 'unchanged'].includes(completed.status))
      process.exitCode = 1;
  } catch {
    console.error(
      'Import could not start. Check the admin account, directory and database.',
    );
    process.exitCode = 1;
  } finally {
    await importer.close();
    await database.close();
  }
}
