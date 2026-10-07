import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const host = process.env.HOST || '127.0.0.1';
const app = express();
app.disable('x-powered-by');
app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
app.use('/api', (_request, response) =>
  response.status(404).json({ code: 'NOT_FOUND' }),
);
app.use('/socket.io', (_request, response) =>
  response.status(404).json({ code: 'NOT_FOUND' }),
);

if (process.env.NODE_ENV === 'production') {
  const webRoot = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  if (!existsSync(`${webRoot}/index.html`)) {
    throw new Error('Frontend build missing; run npm run build first');
  }
  app.use(express.static(webRoot));
  app.get('/{*path}', (_request, response) =>
    response.sendFile(`${webRoot}/index.html`),
  );
}

const httpServer = createServer(app);
const io = new Server(httpServer);
httpServer.listen(port, host, () =>
  console.log(`Server listening on ${host}:${port}`),
);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 5000);
  timeout.unref();
  io.close(() => {
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
