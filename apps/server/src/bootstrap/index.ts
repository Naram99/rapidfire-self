import { fileURLToPath } from 'node:url';
import { createDatabase } from '../database/client.js';
import { interruptAbandonedGames } from '../database/persistence.js';
import { resendEmailPort } from '../email/resend.js';
import { runtimeDependencies } from '../infrastructure/runtime.js';
import { createApplication } from './application.js';
import { serverConfig } from './config.js';
import { LolRepository } from '../lol-data/repository.js';

const config = serverConfig();
const { port, host } = config;
const database = createDatabase(config.databaseUrl);
try {
  const recovered = await interruptAbandonedGames(database.db);
  if (recovered) console.info('ABANDONED_GAMES_INTERRUPTED', recovered);
  const imports = await new LolRepository(database.db).recover();
  if (imports) console.info('ABANDONED_LOL_IMPORTS_ABORTED', imports);
} catch {
  await database.close();
  throw new Error(
    'Database initialization failed. Start PostgreSQL and run npm run db:migrate.',
  );
}
if (!config.resend) console.warn('RESEND_NOT_CONFIGURED');
const { httpServer, io, service, email, lolImporter } = createApplication({
  db: database.db,
  dependencies: runtimeDependencies(),
  emailPort: resendEmailPort(config.resend),
  secret: config.secret,
  publicUrl: config.publicUrl,
  allowedOrigins: config.allowedOrigins,
  ...(process.env.NODE_ENV === 'production'
    ? { webRoot: fileURLToPath(new URL('../../../web/dist/', import.meta.url)) }
    : {}),
});
httpServer.listen(port, host, () =>
  console.log(`Server listening on ${host}:${port}`),
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 15000);
  timeout.unref();
  await service.shutdown();
  await service.persistenceIdle();
  email.close();
  await lolImporter.close();
  await database.close();
  io.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
