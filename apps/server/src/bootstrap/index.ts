import { fileURLToPath } from 'node:url';
import { GameService } from '../application/game-service.js';
import { runtimeDependencies } from '../infrastructure/runtime.js';
import { createGameServer } from './create-server.js';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const host = process.env.HOST || '127.0.0.1';
const service = new GameService(runtimeDependencies());
const publicPort =
  process.env.NODE_ENV === 'production'
    ? port
    : Number(process.env.WEB_PORT || 5173);
const configuredOrigins = process.env.GAME_ALLOWED_ORIGINS?.trim();
const allowedOrigins = configuredOrigins
  ? configuredOrigins.split(',').map((origin) => new URL(origin.trim()).origin)
  : [`http://127.0.0.1:${publicPort}`, `http://localhost:${publicPort}`];
const { httpServer, io } = createGameServer({
  service,
  allowedOrigins,
  // M3 supplies the cookie/session adapter; the M2 production default denies all identities.
  authenticate: async () => null,
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
  const timeout = setTimeout(() => process.exit(1), 5000);
  timeout.unref();
  await service.shutdown();
  io.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
